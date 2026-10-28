# NaniAI 🍲

**Meals that respect your health *and* your culture.**

NaniAI is a culturally-grounded meal agent for seniors living with health conditions. It pairs a **deterministic clinical-safety gate** with **Qloo's cultural taste graph** so its advice is simultaneously *safe* and *familiar* — the millet version of the dish your grandmother already loves, not a kale smoothie.

> Built for the **Qloo Hackathon**. Runs end-to-end with **no API keys** (deterministic mock mode), lights up the live Qloo taste graph the moment a Qloo key is present, and can route its language reasoning to **any OpenAI-compatible NVIDIA open-source model** (NVIDIA's own API, or Nebius Token Factory) via one env switch.

## Hackathon status (honest)

| Capability | State |
|---|---|
| Live Qloo Taste AI™ | **Active.** Each dish is resolved to its real Qloo specialty-dish tag + popularity; cuisines carry real regional affinity. Fetched from the live API and cached as a committed snapshot (`lib/qloo/snapshot.ts`) so the hosted app is instant and reliable. Validate the key live at `/api/qloo/health`. |
| Clinician safety gate | **Active.** Deterministic, model cannot override. |
| Reasoning LLM | **Provider-neutral, optional.** The model gateway speaks the OpenAI-compatible chat API; set `MODEL_PROVIDER=openai` + `LLM_BASE_URL` + `LLM_API_KEY` + `LLM_MODEL` to run a real NVIDIA open model. Without it the app uses a deterministic narrator, clearly labeled — never a fabricated model call. Validate live at `/api/model/health`. |

We never pass mock output off as a live integration: the UI and API always label the real source.


---

## The problem

Diet advice for seniors fails in practice not because the medicine is wrong, but because it is **culturally blind**. Telling a South Indian diabetic grandmother to eat oatmeal and kale is *technically functional*. Offering her a millet idli and a date-sweetened payasam is *actually good*. Adherence tracks familiarity, not nutritional correctness alone.

The hard part is reconciling two forces generic LLMs blur together:
- **Non-negotiable medical constraints** (sugar/sodium caps, drug–food interactions, chewing/swallowing ability)
- **Deeply personal cultural taste**

NaniAI puts a deterministic agent in charge of the first and Qloo in charge of the second, and makes them **negotiate**.

## Why this needs Qloo (the "worse without it" test)

Turn Qloo off and the agent collapses every user to a generic diet chart. Turn it on and it finds the person's *actual* taste neighborhood and the culturally-adjacent dishes nearby. The difference is **measured live in the app** as a side-by-side plan, and in the eval harness as a familiarity delta. On our demo personas, Qloo adds **+14 to +23 points** of cultural familiarity at **zero** medical-safety violations.

The irreplaceable moment: when a beloved dish is unsafe, Qloo substitutes the **culturally closest** safe dish (Masala Dosa → Vegetable *Uttapam*, the same fermented batter), while the culturally-blind baseline just drops it and suggests plain oatmeal.

## The agentic workflow (not a chatbot)

Three cooperating agents, with their reasoning shown in the UI:

1. **Clinician agent** — deterministic hard-constraint gate (`lib/agents/clinician.ts`). Enforces sugar/sodium/carb/potassium caps, texture (IDDSI-inspired), allergies, and drug–food interactions. **The LLM cannot widen this set.**
2. **Culture agent** — queries Qloo (`lib/agents/culture.ts` + `lib/qloo/`) for cultural familiarity of each *safe* candidate.
3. **Negotiator** — composes the day, and when a favorite is unsafe, proposes the **taste-preserving substitution** with a plain-language trade-off (`lib/agents/negotiator.ts`).

## Seven differentiators

1. **Taste-Preserving Substitution Engine** — nearest *culturally-adjacent* safe dish, not a random healthy one.
2. **Hard-Constraint Clinician Gate** — deterministic safety the model can't override.
3. **Multi-agent negotiation** with visible trade-off explanations.
4. **Live "Generic LLM vs Qloo-grounded" side-by-side** — the difference Qloo makes, on screen.
5. **Groundedness receipts** — every pick cites the Qloo evidence it used (honest "mock"/"unavailable" labels when the graph is off).
6. **Cultural Familiarity Score (0–100)** per dish and per plan — the measurable outcome.
7. **Portable Model Gateway** — one agent, a provider-neutral brain: deterministic keyless mock ↔ any OpenAI-compatible **NVIDIA open-source model**, selected by env var.

## Architecture

```
Frontend (Next.js) ── /api/plan ──> Orchestrator
                                      ├─ Clinician gate (deterministic)
                                      ├─ Culture agent ──> Qloo API  (lib/qloo/live.ts → mock fallback)
                                      └─ Negotiator  ──> Model Gateway ──> mock | OpenAI-compatible NVIDIA open model
```

See [`docs/superpowers/specs/2026-10-27-naniai-culturally-grounded-meal-agent-design.md`](docs/superpowers/specs/2026-10-27-naniai-culturally-grounded-meal-agent-design.md) for the full design, sequence diagram, and risk register.

## Run it locally

```bash
npm install
npm run dev          # http://localhost:3000  (works with NO keys — deterministic mock)
```

Evaluate the Qloo ablation (offline, reproducible):

```bash
npm run eval
```

## Light up the live integrations

Copy `.env.example` → `.env.local` and fill in what you have:

```bash
# Cultural intelligence (Qloo)
QLOO_API_KEY=...                 # request at the Qloo hackathon dev guide

# Reasoning LLM — a real NVIDIA open-source model via ANY OpenAI-compatible host.
MODEL_PROVIDER=openai
LLM_API_KEY=...
LLM_MODEL=nvidia/llama-3.1-nemotron-70b-instruct   # confirm the exact id in your provider's catalog

# Pick ONE base URL:
LLM_BASE_URL=https://integrate.api.nvidia.com/v1   # NVIDIA's API (free credits) — real NVIDIA open model
# LLM_BASE_URL=https://api.studio.nebius.ai/v1     # Nebius Token Factory — required for the Nebius × NVIDIA track
```

The app degrades gracefully: a missing/broken key falls back to the deterministic mock and **says so** in the UI — it never fabricates a Qloo number, a model call, or an unsafe plan. Validate a configured LLM at `/api/model/health` and Qloo at `/api/qloo/health`.

## Deploy

```bash
# Vercel (recommended): set the env vars in the project settings, then
vercel --prod
```

Secrets are read server-side only (API routes); nothing is exposed to the browser.

## Model provider options

The gateway is provider-neutral — any OpenAI-compatible endpoint works. To run a real **NVIDIA open-source model** (e.g. Nemotron):

| Host | `LLM_BASE_URL` | Notes |
|---|---|---|
| NVIDIA API | `https://integrate.api.nvidia.com/v1` | Free credits; quickest way to a real NVIDIA open model. |
| Nebius Token Factory | `https://api.studio.nebius.ai/v1` | **Required** to qualify for the Nebius × NVIDIA track (model must run on Nebius). |
| OpenRouter / vLLM / others | provider URL | Any OpenAI-compatible host. |

Set `MODEL_PROVIDER=openai`, `LLM_API_KEY`, `LLM_MODEL`, and the chosen `LLM_BASE_URL`. No code changes needed.

## License

[Apache 2.0](LICENSE).

> ⚕️ NaniAI is a decision-support prototype, not medical advice. Nutrition values are illustrative. Always consult a clinician.
