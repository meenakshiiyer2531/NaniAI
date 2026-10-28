# NaniAI 🍲

**Meals that respect your health *and* your culture.**

NaniAI is a personalized food & wellness companion. It pairs a **deterministic clinical-safety gate** with **Qloo's cultural taste graph** and a real **NVIDIA open-source model**, so its advice is simultaneously *safe* and *familiar* — the millet version of the dish your grandmother already loves, not a kale smoothie.

Built for real, different lives: **seniors with health conditions, new mothers, students in PGs/hostels, busy professionals**, and anyone who wants to eat well without giving up the food they love. It learns your cuisines, favourite dishes, allergies, conditions, medications, lifestyle and daily routine during onboarding, then plans a safe, familiar day — and highlights the right meal for the time of day (breakfast in the morning, dinner at night).

> Runs end-to-end with **no API keys** (deterministic mock mode), lights up the live Qloo taste graph the moment a Qloo key is present, and routes its language reasoning to **any OpenAI-compatible model** (e.g. NVIDIA's API, or Nebius) via one env switch.

## What you can do

- **Create a private account** (email/password) — your health profile is stored per-user with database Row Level Security.
- **Onboard conversationally**, one question at a time: name, age, gender (sets your avatar), cuisines you love (all-India + international, searchable + free text), favourite dishes (type anything), allergies, **any** health condition or medication (free-text search, not a fixed list), spice/texture, lifestyle (working/student, living arrangement, workplace food, cook time), and an optional emergency contact.
- **Plan a safe, familiar day** — breakfast, lunch, snack, dinner — with the current time's meal auto-highlighted and suggested meal times.
- **Swap any meal** between safe, culturally-close options; see the recipe, nutrition, and a recipe-video link.
- **Ask NaniAI** anything about food, swaps, ingredients, and general nutrition — answered by a real NVIDIA open model, using your profile for context, with safety guardrails (medication/emergency questions are routed, never model-cleared).
- **Emergency**: one tap opens WhatsApp to your trusted contact with a prefilled message, alongside a calming breathing guide and verified helpline numbers.
- **Edit everything** anytime on a dedicated profile page.

## Integration status (honest)

| Capability | State |
|---|---|
| Live Qloo Taste AI™ | **Active.** Each dish is resolved to its real Qloo specialty-dish tag + popularity; cuisines carry real regional affinity. Fetched from the live API and cached as a committed snapshot (`lib/qloo/snapshot.ts`) so the hosted app is instant and reliable. Validate the key live at `/api/qloo/health`. |
| Clinician safety gate | **Active.** Deterministic, model cannot override. |
| Reasoning LLM | **Provider-neutral, optional.** The model gateway speaks the OpenAI-compatible chat API; set `MODEL_PROVIDER=openai` + `LLM_BASE_URL` + `LLM_API_KEY` + `LLM_MODEL` to run a real NVIDIA open model. Without it the app uses a deterministic narrator, clearly labeled — never a fabricated model call. Validate live at `/api/model/health`. |
| Auth + user profiles | **Active when Supabase is configured.** Email/password auth + per-user profiles in Supabase Postgres with Row Level Security (own-row only). Falls back to a clear "awaiting configuration" screen if env vars are absent. See [Authentication & user data](#authentication--user-data-supabase). |

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

Three cooperating steps run **server-side**; the customer UI shows a friendly explanation (via a hover ⓘ), never internal agent traces:

1. **Clinician agent** — deterministic hard-constraint gate (`lib/agents/clinician.ts`). Enforces sugar/sodium/carb/potassium caps, texture (IDDSI-inspired), allergies, and drug–food interactions. **The LLM cannot widen this set.**
2. **Culture agent** — queries Qloo (`lib/agents/culture.ts` + `lib/qloo/`) for cultural familiarity of each *safe* candidate.
3. **Negotiator** — composes the day, and when a favorite is unsafe, proposes the **taste-preserving substitution**, then narrates the plan in plain language via the configured model (`lib/agents/negotiator.ts`).

## Differentiators

1. **Taste-Preserving Substitution Engine** — nearest *culturally-adjacent* safe dish, not a random healthy one.
2. **Hard-Constraint Clinician Gate** — deterministic safety the model can't override.
3. **Any-condition / any-medication** — free-text search, not a fixed list; mapped to safety rules where we have them, saved as context otherwise. Never a diagnosis.
4. **Qloo-grounded ranking** — measured in the eval harness as a familiarity delta vs a culturally-blind baseline (`npm run eval`).
5. **Honest sourcing** — the app never presents mock data as a live Qloo or model result; `/api/qloo/health` and `/api/model/health` verify the real integrations.
6. **Time-aware & personalized** — current meal highlighted by time of day; plans shaped by cuisines, favourites, lifestyle, and routine.
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
QLOO_API_KEY=...                 # your Qloo API key

# Reasoning LLM — a real NVIDIA open-source model via ANY OpenAI-compatible host.
MODEL_PROVIDER=openai
LLM_API_KEY=...
LLM_MODEL=nvidia/llama-3.1-nemotron-70b-instruct   # confirm the exact id in your provider's catalog

# Pick ONE base URL:
LLM_BASE_URL=https://integrate.api.nvidia.com/v1   # NVIDIA's API (free credits) — real NVIDIA open model
# LLM_BASE_URL=https://api.studio.nebius.ai/v1     # Nebius (OpenAI-compatible) — alternative host
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
| Nebius | `https://api.studio.nebius.ai/v1` | OpenAI-compatible host; also serves NVIDIA open models. |
| OpenRouter / vLLM / others | provider URL | Any OpenAI-compatible host. |

Set `MODEL_PROVIDER=openai`, `LLM_API_KEY`, `LLM_MODEL`, and the chosen `LLM_BASE_URL`. No code changes needed.

## Authentication & user data (Supabase)

Email/password auth and per-user profiles are backed by **Supabase** (Postgres + Auth). Each user's data is isolated by **Row Level Security** — enforced in the database, not the app — so one account can never read or write another's profile.

**Setup:**

1. Create a free project at [supabase.com](https://supabase.com).
2. Run the schema + RLS policies: open the SQL editor and paste [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) (or `node --env-file=.env.local scripts/run-migration.mjs supabase/migrations/0001_init.sql`).
3. Set these env vars (URL + anon key are browser-safe; the service-role key is **server-only**):

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...        # server only — never exposed to the client
```

**How it works:**
- Sign-up runs server-side (`/api/auth/signup`) with the service-role key and marks the user email-confirmed, so there's no email round-trip for the demo. (Leave Supabase's "Confirm email" off, or remove that route to require confirmation.)
- Login/session use the public anon key in the browser; the user's JWT drives RLS.
- The `profiles` table auto-provisions a row per new user (trigger) and holds the full onboarding profile; identity is always derived from the verified session, never a browser-supplied id.
- If the Supabase env vars are absent, the app shows a clear "awaiting configuration" screen instead of a fake login.

**Verify the data path** (auth + RLS isolation + CRUD) against a running local server:

```bash
node --env-file=.env.local scripts/test-auth-flow.mjs
```

## License

[Apache 2.0](LICENSE).

> ⚕️ NaniAI is a decision-support prototype, not medical advice. Nutrition values are illustrative. Always consult a clinician.
