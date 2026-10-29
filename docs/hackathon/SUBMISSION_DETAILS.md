# NaniAI — Full Submission Details

_Last verified: production live, NVIDIA Nemotron inference `ok:true` (~230ms)._

## Accounts & links
| Item | Value |
|---|---|
| **GitHub (source)** | https://github.com/meenakshiiyer2531/NaniAI (public) |
| **GitHub account** | `meenakshiiyer2531` |
| **Live demo (Vercel)** | https://naniai-vi-me.vercel.app |
| **Vercel project** | `naniai` (team `vi-me`); aliases `naniai-vi-me.vercel.app`, `naniai-topaz.vercel.app` |
| **Latest commit** | `fc1c75c` on `main` |

## Project
- **Name:** NaniAI — Your Personal Global Food Companion
- **Tagline:** Meals that respect your health limits and your culture — safe, personalized, worldwide.
- **Track:** Coding & Agentic Engineering (Best Apps & Agents).

## One-paragraph description
NaniAI is a culturally-aware, health-safe meal-planning web app. A deterministic clinical safety
gate filters every dish against the user's conditions, allergies, medications, and texture limits
*first*; a taste model (Qloo) then ranks the safe options by cultural familiarity; and an NVIDIA
Nemotron model explains the plan in the user's voice and powers the Ask-NaniAI chatbot. It's global
by default (multi-cuisine, no Indian default, cuisine-coherent plates), honest about data (nutrition
labeled as estimates), and private (per-user data isolated by Supabase RLS; optional encrypted BYOK).

## Features that actually work (verified)
**Accounts & onboarding**
- Real Supabase email auth; new users get the full 16-step onboarding; returning users recover their
  profile + plan; logout wipes per-user state; **cross-account isolation** (18-check Playwright suite + negative control).

**Global personalization**
- Multi-cuisine selection; no cuisine defaulted; "open to everything" rotates globally; cuisine-coherent
  plates (no Indian sides on non-Indian mains); day-rotation reduces repetition.

**Meals & prep**
- Complete plates (main + accompaniments), serving-size scaling, merged grocery list, recipe-detail page,
  time-aware "current meal + next prep", DB-persisted prep checklist and meal feedback.

**Health & safety**
- Deterministic clinical safety gate (eval: **0 violations / 100% receipts**, 6 personas); allergy/diet
  rules enforced in code, never overridden by the LLM; NLM Clinical Tables search for conditions/medications
  (sends only the typed term).

**AI**
- **Live NVIDIA Nemotron** (`nvidia/nemotron-3.5-bolt-e4b`) via OpenAI-compatible gateway: chatbot + plan
  explanations. Honest diagnostics at `/api/model/health` (provider, model, host, infra, latency).
- **Explicit provider selection** (`MODEL_PROVIDER=nvidia|nebius|mock`); **Nebius Token Factory is a ready,
  separate path** (`NEBIUS_*` env) with a strict verifier (`npm run verify:nebius`).
- **Per-user BYOK**: optional NVIDIA key, AES-256-GCM encrypted at rest (server-only key), owner-only RLS,
  never returned/logged; onboarding step + profile section. (Enable in prod by setting `BYOK_ENCRYPTION_KEY`.)

## Tech stack
Next.js 15 (App Router) + React 19 + TypeScript · Supabase (Postgres + Auth + RLS) · Qloo Taste AI ·
NVIDIA Nemotron (OpenAI-compatible) · Vercel.

## AI architecture (real request flow)
User → Next API route (input validation) → deterministic clinician constraints → Qloo affinity (safe
candidates) → negotiator composes plates → **NVIDIA Nemotron narration/chat** (per-user key if provided,
else deployment default) → deterministic safety re-check → plan + Supabase persistence.
The model never overrides safety; failures degrade to deterministic text **labeled "mock"** (never faked as AI).

## Migrations
`0001_init` (profiles+RLS), `0002_meal_prep`, `0003_profile_feedback`, `0004_user_api_keys` (encrypted BYOK) — all applied.

## Tests (actual)
`tsc` clean · ESLint no errors · `test:schedule` ALL PASS · `eval` 0 violations · `test:isolation` 18/18 ·
`test:aikey` 10/10 (live DB+auth, ciphertext-at-rest + cross-user isolation) · `build` ✓ ·
`verify:nebius` strict (fails on NVIDIA host) · staging RLS harness ready (`verify-rls-staging`).

## ⚠️ Hackathon eligibility — the honest gap
The rule requires running on **Nebius Token Factory or Nebius AI Cloud** AND an NVIDIA open-source model.
NaniAI uses a real NVIDIA open model (Nemotron) ✅, but currently via **NVIDIA's own API, not Nebius** ❌.
Nebius onboarding requires a payment card that could not be added from India (confirmed on Nebius Discord).
**As deployed, the Nebius-infrastructure requirement is NOT met.** The code is Nebius-ready: set
`NEBIUS_API_KEY` + `NEBIUS_MODEL` (an NVIDIA model Token Factory serves) and `MODEL_PROVIDER=nebius`, then
`npm run verify:nebius` must PASS and `/api/model/health` shows `infra:"nebius"`.

## What YOU must do on Devpost / to finish
1. **Add `BYOK_ENCRYPTION_KEY`** in Vercel (production) to enable the BYOK feature end-to-end:
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` → Vercel → Settings → Env → redeploy.
2. **For Nebius eligibility:** obtain Nebius Token Factory access (teammate with a card, or Nebius Discord
   India billing escalation), set the `NEBIUS_*` env, verify, redeploy.
3. **Add a LICENSE** file (e.g. MIT) if you hold the rights.
4. **Record + upload the <3-min demo** (see `DEMO_SCRIPT.md`); don't present fallback text as live AI.
5. **Fill the Devpost form** with the links above; only claim Nebius usage if step 2 is done and verified.
6. Do not submit/accept terms on anyone's behalf — that's your action.
