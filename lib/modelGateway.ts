import type { ModelProvider } from "@/lib/types";

// Provider-neutral Model Gateway. The agent's language reasoning (explaining a
// plan, the Ask-NaniAI replies) flows through here so the brain is swappable.
//
//   MODEL_PROVIDER=mock    -> deterministic, keyless (default)
//   MODEL_PROVIDER=openai  -> any OpenAI-compatible chat/completions endpoint
//
// The single `openai` provider covers every OpenAI-compatible host, so the same
// code runs a real NVIDIA open-source model (Nemotron) on either:
//   - NVIDIA's own API  : LLM_BASE_URL=https://integrate.api.nvidia.com/v1   (free credits)
//   - Nebius Token Factory: LLM_BASE_URL=https://api.studio.nebius.ai/v1     (required for the Nebius track)
// plus OpenRouter, vLLM, etc. Configure LLM_BASE_URL + LLM_API_KEY + LLM_MODEL.
//
// Medical safety NEVER routes through here — that is the deterministic clinician
// gate. Honesty rule: every result carries the REAL provider + model that
// produced it. If no endpoint is configured, or a live call fails, we return the
// deterministic mock text labeled "mock" — never mock output posing as inference.

export interface ModelResult {
  text: string;
  provider: ModelProvider;
  modelName: string;
  latencyMs: number;
  estCostUsd: number | null;
  tokensIn?: number;
  tokensOut?: number;
  /** Which real provider served this ("nvidia"/"nebius"), or the fallback path. */
  source?: "nvidia" | "nebius" | "fallback";
}

export interface ChatRequest {
  system: string;
  user: string;
  /** Deterministic text to return in mock mode (keeps the app keyless-runnable). */
  mockText: string;
  maxTokens?: number;
}

type ProviderSource = "nvidia" | "nebius" | "none";

interface ResolvedEndpoint {
  base: string;
  key: string;
  model: string;
  source: ProviderSource;
}

/** Explicit, owner-configured provider selection (never guessed from a model
 *  name). Precedence:
 *   - MODEL_PROVIDER=nebius        -> Nebius Token Factory (NEBIUS_* vars)
 *   - MODEL_PROVIDER=nvidia|openai -> the default NVIDIA/OpenAI-compatible path (LLM_* vars)
 *   - MODEL_PROVIDER=mock          -> deterministic mock
 *   - unset -> auto: Nebius if its key+model are set, else the NVIDIA path if
 *             configured, else mock. This keeps end users key-free whenever the
 *             deployment owner has configured ANY provider. */
function resolveEndpoint(): ResolvedEndpoint {
  const explicit = (process.env.MODEL_PROVIDER ?? "").toLowerCase();
  const neb = {
    base: (process.env.NEBIUS_BASE_URL ?? "https://api.tokenfactory.nebius.com/v1").replace(/\/$/, ""),
    key: process.env.NEBIUS_API_KEY ?? "",
    model: process.env.NEBIUS_MODEL ?? "",
  };
  const nv = {
    base: (process.env.LLM_BASE_URL ?? "").replace(/\/$/, ""),
    key: process.env.LLM_API_KEY ?? "",
    model: process.env.LLM_MODEL ?? "",
  };
  if (explicit === "mock") return { base: "", key: "", model: "", source: "none" };
  if (explicit === "nebius") return { ...neb, source: "nebius" };
  if (explicit === "nvidia" || explicit === "openai") return { ...nv, source: "nvidia" };
  // auto-detect when MODEL_PROVIDER is unset
  if (neb.key && neb.model) return { ...neb, source: "nebius" };
  if (nv.key && nv.base && nv.model) return { ...nv, source: "nvidia" };
  return { base: "", key: "", model: "", source: "none" };
}

function currentProvider(): ModelProvider {
  return resolveEndpoint().source === "none" ? "mock" : "openai";
}

/** Optional, documented price estimate (USD per 1M tokens). Only emitted when
 *  LLM_PRICE_IN / LLM_PRICE_OUT are set, so we never invent a cost. */
function estCost(tin: number, tout: number): number | null {
  const pin = parseFloat(process.env.LLM_PRICE_IN ?? "");
  const pout = parseFloat(process.env.LLM_PRICE_OUT ?? "");
  if (isNaN(pin) || isNaN(pout)) return null;
  return +(((tin * pin) / 1_000_000 + (tout * pout) / 1_000_000)).toFixed(6);
}

/** A per-request endpoint override — used to run inference with a specific
 *  USER's own API key (BYOK) instead of the deployment default. The key is
 *  passed in-memory for this request only; it is never stored or logged here. */
export interface EndpointOverride {
  apiKey: string;
  baseUrl: string;
  model: string;
  source: "nvidia" | "nebius";
}

async function callOpenAICompatible(req: ChatRequest, override?: EndpointOverride): Promise<ModelResult> {
  let base: string, key: string, model: string, source: "nvidia" | "nebius";
  if (override?.apiKey) {
    base = override.baseUrl.replace(/\/$/, "");
    key = override.apiKey;
    model = override.model;
    source = override.source;
    if (!base) throw new Error("override base URL not set");
    if (!model) throw new Error("override model not set");
  } else {
    const r = resolveEndpoint();
    if (r.source === "none") throw new Error("No provider configured (set MODEL_PROVIDER + NEBIUS_* or LLM_*)");
    if (!r.key) throw new Error(`${r.source.toUpperCase()} API key not set`);
    if (!r.base) throw new Error(`${r.source.toUpperCase()} base URL not set`);
    if (!r.model) throw new Error(`${r.source.toUpperCase()} model not set`);
    base = r.base; key = r.key; model = r.model; source = r.source;
  }

  const start = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: req.maxTokens ?? 500,
        temperature: 1,
        top_p: 0.95,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 120)}`);
    const data = await res.json();
    const msg = data?.choices?.[0]?.message ?? {};
    // Some NVIDIA/Nemotron "reasoning" models return the answer in
    // reasoning_content when content is empty — accept either.
    const text = (msg.content || msg.reasoning_content || "").trim();
    if (!text) throw new Error("LLM returned empty content");
    const tin = data?.usage?.prompt_tokens ?? 0;
    const tout = data?.usage?.completion_tokens ?? 0;
    return {
      text,
      provider: "openai",
      modelName: model,
      latencyMs: Date.now() - start,
      estCostUsd: estCost(tin, tout),
      tokensIn: tin,
      tokensOut: tout,
      source,
    };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Generate text through the configured brain. Falls back to the supplied
 * deterministic mock text if the provider is `mock` OR a live call fails — so a
 * missing/broken endpoint degrades gracefully instead of breaking the app.
 */
export async function chat(req: ChatRequest, override?: EndpointOverride): Promise<ModelResult> {
  const live = !!override?.apiKey || currentProvider() === "openai";
  const start = Date.now();
  try {
    if (live) return await callOpenAICompatible(req, override);
  } catch (err) {
    return {
      text: req.mockText,
      provider: "mock",
      modelName: `mock (fallback: ${(err as Error).message.slice(0, 70)})`,
      latencyMs: Date.now() - start,
      estCostUsd: 0,
      source: "fallback",
    };
  }
  return {
    text: req.mockText,
    provider: "mock",
    modelName: "deterministic-mock",
    latencyMs: Date.now() - start,
    estCostUsd: 0,
    source: "fallback",
  };
}

export function activeProvider(): ModelProvider {
  return currentProvider();
}

/** Build an override that runs inference with a USER's own NVIDIA key, using the
 *  deployment's NVIDIA base URL + model defaults (falling back to NVIDIA's public
 *  API host). The key is used for this request only — never persisted here. */
export function nvidiaUserOverride(apiKey: string): EndpointOverride {
  return {
    apiKey,
    baseUrl: (process.env.LLM_BASE_URL ?? "https://integrate.api.nvidia.com/v1").replace(/\/$/, ""),
    model: process.env.LLM_MODEL ?? "nvidia/llama-3.1-nemotron-70b-instruct",
    source: "nvidia",
  };
}

/** Classify the configured endpoint's HOST so diagnostics are honest about
 *  WHERE inference actually runs. This matters for the Nebius hackathon track:
 *  NVIDIA's own API is NOT Nebius infrastructure. Never returns the key. */
export function endpointInfo(): { host: string; infra: "nebius" | "nvidia-api" | "other" | "none"; source: ProviderSource; model: string } {
  const { base, model, source } = resolveEndpoint();
  if (source === "none" || !base) return { host: "", infra: "none", source, model: "" };
  let host = base;
  try { host = new URL(base).host; } catch { /* keep raw */ }
  let infra: "nebius" | "nvidia-api" | "other" = "other";
  if (/nebius/i.test(host)) infra = "nebius";
  else if (/integrate\.api\.nvidia\.com/i.test(host)) infra = "nvidia-api";
  return { host, infra, source, model };
}

/** Server-only health probe for the configured LLM. Makes a tiny real request
 *  so a key/model can be validated without exposing secrets. */
export async function modelHealthCheck(): Promise<{
  provider: ModelProvider;
  configured: boolean;
  ok: boolean;
  detail: string;
  host: string;
  infra: "nebius" | "nvidia-api" | "other" | "none";
  source: ProviderSource;
  model: string;
}> {
  const provider = currentProvider();
  const { host, infra, source, model } = endpointInfo();
  if (provider === "mock") {
    return { provider, configured: false, ok: false, detail: "No provider configured — running deterministic mock.", host, infra, source, model };
  }
  try {
    const r = await callOpenAICompatible({
      system: "You are a health check.",
      user: "Reply with the single word: ok",
      mockText: "ok",
      maxTokens: 24,
    });
    return { provider, configured: true, ok: true, detail: `Live: ${r.modelName} responded (${r.latencyMs}ms) via ${host || "?"} [${source}].`, host, infra, source, model };
  } catch (err) {
    return { provider, configured: true, ok: false, detail: (err as Error).message, host, infra, source, model };
  }
}
