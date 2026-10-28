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
}

export interface ChatRequest {
  system: string;
  user: string;
  /** Deterministic text to return in mock mode (keeps the app keyless-runnable). */
  mockText: string;
  maxTokens?: number;
}

function currentProvider(): ModelProvider {
  const p = (process.env.MODEL_PROVIDER ?? "mock").toLowerCase();
  if (p === "openai") return p;
  return "mock";
}

/** Optional, documented price estimate (USD per 1M tokens). Only emitted when
 *  LLM_PRICE_IN / LLM_PRICE_OUT are set, so we never invent a cost. */
function estCost(tin: number, tout: number): number | null {
  const pin = parseFloat(process.env.LLM_PRICE_IN ?? "");
  const pout = parseFloat(process.env.LLM_PRICE_OUT ?? "");
  if (isNaN(pin) || isNaN(pout)) return null;
  return +(((tin * pin) / 1_000_000 + (tout * pout) / 1_000_000)).toFixed(6);
}

async function callOpenAICompatible(req: ChatRequest): Promise<ModelResult> {
  const key = process.env.LLM_API_KEY ?? "";
  const base = (process.env.LLM_BASE_URL ?? "").replace(/\/$/, "");
  const model = process.env.LLM_MODEL ?? "";
  if (!key) throw new Error("LLM_API_KEY not set");
  if (!base) throw new Error("LLM_BASE_URL not set");
  if (!model) throw new Error("LLM_MODEL not set");

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
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 120)}`);
    const data = await res.json();
    const text = (data?.choices?.[0]?.message?.content ?? "").trim();
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
export async function chat(req: ChatRequest): Promise<ModelResult> {
  const provider = currentProvider();
  const start = Date.now();
  try {
    if (provider === "openai") return await callOpenAICompatible(req);
  } catch (err) {
    return {
      text: req.mockText,
      provider: "mock",
      modelName: `mock (fallback: ${(err as Error).message.slice(0, 70)})`,
      latencyMs: Date.now() - start,
      estCostUsd: 0,
    };
  }
  return {
    text: req.mockText,
    provider: "mock",
    modelName: "deterministic-mock",
    latencyMs: Date.now() - start,
    estCostUsd: 0,
  };
}

export function activeProvider(): ModelProvider {
  return currentProvider();
}

/** Server-only health probe for the configured LLM. Makes a tiny real request
 *  so a key/model can be validated without exposing secrets. */
export async function modelHealthCheck(): Promise<{
  provider: ModelProvider;
  configured: boolean;
  ok: boolean;
  detail: string;
}> {
  const provider = currentProvider();
  if (provider === "mock") {
    return { provider, configured: false, ok: false, detail: "No LLM configured — running deterministic mock." };
  }
  try {
    const r = await callOpenAICompatible({
      system: "You are a health check.",
      user: "Reply with the single word: ok",
      mockText: "ok",
      maxTokens: 5,
    });
    return { provider, configured: true, ok: true, detail: `Live: ${r.modelName} responded (${r.latencyMs}ms).` };
  } catch (err) {
    return { provider, configured: true, ok: false, detail: (err as Error).message };
  }
}
