import type { ModelProvider } from "@/lib/types";

// The Model Gateway is the single swap-point that lets ONE agent run on two
// interchangeable brains:
//   - Qloo edition      -> MODEL_PROVIDER=anthropic (or mock)
//   - Nebius edition    -> MODEL_PROVIDER=nebius  (NVIDIA Nemotron, OpenAI-compatible)
//
// Medical safety never routes through here (that is the deterministic clinician
// gate). The model's job is genuine language reasoning: explaining trade-offs
// and composing culturally-aware daily guidance from structured facts. Every
// call is timed and cost-estimated so the Nebius submission can PROVE the model
// ran, not just mention it (novelty point #7).

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
  /** Nemotron tiering per the Nebius brief: heavy reasoning on Ultra, quick
   *  everyday calls on Nano/Super, so the app stays responsive and credits last. */
  tier?: "reasoning" | "fast";
}

function currentProvider(): ModelProvider {
  const p = (process.env.MODEL_PROVIDER ?? "mock").toLowerCase();
  if (p === "anthropic" || p === "nebius") return p;
  return "mock";
}

// Rough public list prices (USD per 1M tokens) for a transparent ESTIMATE only.
const PRICE_PER_MTOK: Record<string, { in: number; out: number }> = {
  anthropic: { in: 3, out: 15 },
  nebius: { in: 0.4, out: 1.2 },
};

function estCost(provider: ModelProvider, tin = 0, tout = 0): number | null {
  const p = PRICE_PER_MTOK[provider];
  if (!p) return null;
  return +(((tin * p.in) / 1_000_000 + (tout * p.out) / 1_000_000)).toFixed(6);
}

async function callAnthropic(req: ChatRequest): Promise<ModelResult> {
  const key = process.env.ANTHROPIC_API_KEY ?? "";
  const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5";
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");

  const start = Date.now();
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: req.maxTokens ?? 500,
      system: req.system,
      messages: [{ role: "user", content: req.user }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = (data?.content ?? []).map((c: any) => c?.text ?? "").join("").trim();
  const tin = data?.usage?.input_tokens ?? 0;
  const tout = data?.usage?.output_tokens ?? 0;
  return {
    text,
    provider: "anthropic",
    modelName: model,
    latencyMs: Date.now() - start,
    estCostUsd: estCost("anthropic", tin, tout),
    tokensIn: tin,
    tokensOut: tout,
  };
}

async function callNebius(req: ChatRequest): Promise<ModelResult> {
  const key = process.env.NEBIUS_API_KEY ?? "";
  const base = process.env.NEBIUS_BASE_URL ?? "https://api.studio.nebius.ai/v1";
  // Nemotron tiering: heavy reasoning on Ultra, fast everyday calls on Nano/Super.
  const reasoningModel = process.env.NEBIUS_MODEL ?? "nvidia/llama-3.1-nemotron-70b-instruct";
  const fastModel = process.env.NEBIUS_MODEL_FAST ?? reasoningModel;
  const model = req.tier === "fast" ? fastModel : reasoningModel;
  if (!key) throw new Error("NEBIUS_API_KEY not set");

  const start = Date.now();
  const res = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: req.maxTokens ?? 500,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Nebius ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = (data?.choices?.[0]?.message?.content ?? "").trim();
  const tin = data?.usage?.prompt_tokens ?? 0;
  const tout = data?.usage?.completion_tokens ?? 0;
  return {
    text,
    provider: "nebius",
    modelName: model,
    latencyMs: Date.now() - start,
    estCostUsd: estCost("nebius", tin, tout),
    tokensIn: tin,
    tokensOut: tout,
  };
}

/**
 * Generate text through the configured brain. Falls back to the supplied
 * deterministic mock text if the provider is `mock` OR if a live call fails —
 * so a missing/broken key degrades gracefully instead of breaking the demo.
 */
export async function chat(req: ChatRequest): Promise<ModelResult> {
  const provider = currentProvider();
  const start = Date.now();
  try {
    if (provider === "anthropic") return await callAnthropic(req);
    if (provider === "nebius") return await callNebius(req);
  } catch (err) {
    return {
      text: req.mockText,
      provider: "mock",
      modelName: `mock (fallback: ${(err as Error).message.slice(0, 60)})`,
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
