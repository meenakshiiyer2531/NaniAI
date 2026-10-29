# NaniAI — Project Description

**NaniAI — Your Personal Global Food Companion.** Meals that respect your health limits and
your culture: safe, personalized, culturally-grounded meal planning for people managing
conditions like diabetes, hypertension, kidney disease, or swallowing difficulty — anywhere in
the world.

## The problem
Generic "diabetic diet" charts ignore who a person is. They suggest food no one in that
household actually eats, so people abandon them. Meanwhile, naïvely asking an LLM "what should I
eat with my conditions?" is unsafe — models hallucinate nutrition and can suggest harmful foods.

## Who it's for
Older adults and anyone managing chronic conditions or dietary restrictions, plus the family
members who help them — across cuisines and regions, not just one country.

## What makes it different
1. **Culture + safety, not one or the other.** A deterministic clinical safety gate filters every
   dish against the user's conditions, allergies, medications, and texture limits *first*; a taste
   model (Qloo) then ranks the safe options by how familiar/loved they are. Safety is never traded
   for familiarity.
2. **Truly global, no default cuisine.** Multi-cuisine selection; the recommender scores dishes by
   the user's cuisines with a day-rotated diversity tiebreak, so no cuisine (including Indian) is
   implicitly preferred. Sides are cuisine-coherent — no Indian chutney bolted onto an Italian pasta.
3. **Honest by construction.** Nutrition is labeled as estimates (not lab values); the AI provider
   and model are reported truthfully in diagnostics; a deterministic fallback is never presented as
   AI output.

## Features that actually work (verified this session)
- Real Supabase email auth; 16-step onboarding for new users; returning users recover their saved
  profile and plan; **cross-account isolation** (no user sees another's data) — covered by an
  18-check Playwright regression suite.
- Global, cuisine-coherent meal plates with serving-size scaling and a merged grocery list.
- Time-aware scheduling (current meal + next-meal prep), DB-persisted prep checklist and feedback.
- NLM Clinical Tables search for conditions/medications (sends only the search term).
- Ask-NaniAI chatbot and plan explanations powered by a live NVIDIA model.
- Deterministic clinical safety gate (evaluation: **0 medical violations** across 6 personas).

## The AI architecture (truthful)
- **Model:** NVIDIA **Nemotron** (`nvidia/nemotron-3.5-bolt-e4b`), an NVIDIA open-source model.
- **Where it runs today:** NVIDIA's own inference API (OpenAI-compatible), via a provider-neutral
  gateway (`lib/modelGateway.ts`). Live status is checkable at `/api/model/health`.
- **What the model does:** explains the chosen plan in the user's cultural voice and
  answers open-ended food questions in the chatbot. It operates **inside** deterministic
  constraints — it cannot override allergy, clinical, or texture decisions.
- **Nebius status:** **not integrated** — Nebius onboarding requires a payment card that could not
  be added from India. The gateway is already Token-Factory-ready and ships with a verification
  script (`npm run verify:nebius`) that *fails* unless inference truly runs on a Nebius host, so no
  false Nebius claim is possible.

## Safety & data integrity
- Clinical safety is deterministic application logic, not the LLM.
- Allergy/diet constraints are enforced in code; LLM suggestions can't bypass them.
- Nutrition figures are clearly labeled estimates; no fabricated calories, macros, or citations.
- Per-user data is isolated by Supabase Row-Level Security (`auth.uid()` policies on every table).

## What changed during the hackathon period
- Transformed an India-only planner into a **global, multi-cuisine** engine (removed the hardcoded
  Indian default; cuisine-coherent plates; day-rotated diversity).
- Added real auth-session persistence and fixed a **cross-account state-leak** (plus an 18-check
  isolation regression suite and a staging RLS verification harness).
- Added **honest nutrition-estimate labeling**, ESLint + CI, and truthful provider diagnostics
  with a reproducible Nebius inference verifier.

## Honest limitations
- Not running on Nebius infrastructure (blocked — see above); this is the mandatory requirement gap.
- Nutrition values are curated estimates, not sourced from USDA/Open Food Facts.
- Recipe catalog is a representative international set (~60 dishes), not exhaustive global coverage.
- No internationalization/RTL or formal accessibility audit yet.
