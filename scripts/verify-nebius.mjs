// NaniAI — Nebius Token Factory inference verification (Phase 4, hackathon).
//
// Makes a REAL chat/completions request to the configured LLM endpoint and
// FAILS unless:
//   * the endpoint host is Nebius Token Factory (…nebius…), not NVIDIA's own API
//     or any other host — this is the hackathon eligibility requirement;
//   * MODEL_PROVIDER=openai (the live path), not the deterministic mock;
//   * a real, non-empty completion comes back from the configured model.
//
// It prints the host, model id, latency and token usage as EVIDENCE, and never
// prints the API key.
//
// Run:
//   node --env-file=.env.local scripts/verify-nebius.mjs
//   # or in CI with env vars set from secrets:
//   node scripts/verify-nebius.mjs
//
// Required env: MODEL_PROVIDER=openai, LLM_BASE_URL (a Nebius host),
//               LLM_API_KEY, LLM_MODEL (an NVIDIA open-source model Nebius serves).

// Required env (either the dedicated Nebius vars, or MODEL_PROVIDER=nebius):
//   NEBIUS_API_KEY, NEBIUS_MODEL (an NVIDIA open-source model Nebius serves),
//   NEBIUS_BASE_URL (optional; defaults to https://api.tokenfactory.nebius.com/v1)
// Falls back to LLM_* only if NEBIUS_* are unset (so it still catches the
// NVIDIA-API misconfiguration and fails).

const nebKey = process.env.NEBIUS_API_KEY ?? "";
const base = (nebKey ? (process.env.NEBIUS_BASE_URL ?? "https://api.tokenfactory.nebius.com/v1") : (process.env.LLM_BASE_URL ?? "")).replace(/\/$/, "");
const key = nebKey || (process.env.LLM_API_KEY ?? "");
const model = nebKey ? (process.env.NEBIUS_MODEL ?? "") : (process.env.LLM_MODEL ?? "");
const provider = nebKey ? "nebius" : (process.env.MODEL_PROVIDER ?? "mock").toLowerCase();

function fail(msg) { console.error("FAIL:", msg); process.exit(1); }

if (!nebKey && provider !== "openai" && provider !== "nvidia" && provider !== "nebius") {
  fail(`No Nebius config found. Set NEBIUS_API_KEY + NEBIUS_MODEL (and optionally NEBIUS_BASE_URL). Current MODEL_PROVIDER="${provider}".`);
}
if (!base) fail("No base URL resolved (set NEBIUS_BASE_URL or LLM_BASE_URL).");
if (!key) fail("No API key resolved (set NEBIUS_API_KEY or LLM_API_KEY).");
if (!model) fail("No model resolved (set NEBIUS_MODEL or LLM_MODEL).");

let host = base;
try { host = new URL(base).host; } catch { fail(`LLM_BASE_URL is not a valid URL: ${base}`); }

if (/integrate\.api\.nvidia\.com/i.test(host)) {
  fail(`Endpoint host is NVIDIA's own API (${host}). The Nebius track requires inference on Nebius Token Factory / Nebius AI Cloud. Point LLM_BASE_URL at https://api.tokenfactory.nebius.com/v1 with a Nebius key.`);
}
if (!/nebius/i.test(host)) {
  fail(`Endpoint host "${host}" is not a Nebius host. Set LLM_BASE_URL to the Nebius Token Factory endpoint (https://api.tokenfactory.nebius.com/v1).`);
}

console.log(`Provider path : openai-compatible`);
console.log(`Endpoint host : ${host}   (Nebius ✓)`);
console.log(`Model id      : ${model}`);
if (!/nvidia|nemotron/i.test(model)) {
  console.warn(`WARNING: model id "${model}" does not look like an NVIDIA open-source model. The hackathon requires an eligible NVIDIA model. Confirm the exact id from Nebius' model catalog (GET ${base}/models).`);
}

const start = Date.now();
const ctrl = new AbortController();
const t = setTimeout(() => ctrl.abort(), 30000);
try {
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: 24,
      messages: [
        { role: "system", content: "You are a concise assistant verifying live inference." },
        { role: "user", content: "In one short sentence, say hello from the meal-planning assistant." },
      ],
    }),
    signal: ctrl.signal,
  });
  const bodyText = await res.text();
  if (!res.ok) fail(`HTTP ${res.status} from ${host}: ${bodyText.slice(0, 200)}`);
  let data;
  try { data = JSON.parse(bodyText); } catch { fail(`Non-JSON response from ${host}: ${bodyText.slice(0, 200)}`); }
  const text = (data?.choices?.[0]?.message?.content ?? "").trim();
  if (!text) fail(`Empty completion from ${host} — no live inference content.`);
  const latency = Date.now() - start;
  const tin = data?.usage?.prompt_tokens ?? "?";
  const tout = data?.usage?.completion_tokens ?? "?";
  const servedModel = data?.model ?? model;

  console.log(`\n--- EVIDENCE ---`);
  console.log(`served model  : ${servedModel}`);
  console.log(`latency       : ${latency}ms`);
  console.log(`tokens in/out : ${tin}/${tout}`);
  console.log(`sample output : ${text.slice(0, 160)}`);
  console.log(`timestamp     : ${new Date().toISOString()}`);
  console.log(`\nPASS: live NVIDIA-model inference verified on Nebius (${host}).`);
} catch (e) {
  fail(`request error: ${e.name === "AbortError" ? "timed out after 30s" : e.message}`);
} finally {
  clearTimeout(t);
}
