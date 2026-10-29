# NaniAI — Submission Checklist (honest status)

Status legend: **VERIFIED** (checked with evidence) · **BLOCKED** (needs something unavailable) · **NOT DONE**.

> ⚠️ **Eligibility caveat — read first.** The Nebius × NVIDIA hackathon rule requires a
> submission to *run on Nebius Token Factory or Nebius AI Cloud* **and** use an NVIDIA
> open-source model. NaniAI genuinely uses an NVIDIA open-source model (Nemotron) in live
> inference, but it is **not** currently running on Nebius infrastructure — Nebius onboarding
> requires a payment card that could not be added from India (confirmed by the Nebius team on
> Discord). So the **mandatory Nebius-infrastructure condition is BLOCKED**, and this entry may
> be judged ineligible on that basis. Nothing in these materials claims Nebius usage.

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | Correct track selection | VERIFIED | Track 1 — Coding & Agentic Engineering |
| 2 | Working demo URL | VERIFIED | https://naniai-vi-me.vercel.app (routes 200; full user journey works) |
| 3 | Public source repository | VERIFIED | https://github.com/meenakshiiyer2531/NaniAI |
| 4 | Open-source license | NOT DONE | No LICENSE file yet — add one you have the rights to (e.g. MIT) |
| 5 | README + setup instructions | PARTIAL | README exists; a Nebius/NVIDIA + setup section should be finalized |
| 6 | **Runs on Nebius Token Factory / AI Cloud** | **BLOCKED** | Card required for Nebius onboarding; unavailable from India (Nebius Discord confirmed). Code is Token-Factory-ready (provider-neutral gateway + `npm run verify:nebius`), but no Nebius account exists |
| 7 | Uses an eligible NVIDIA open-source model | VERIFIED | `/api/model/health` → `Live: nvidia/nemotron-3.5-bolt-e4b responded (275ms)` — real inference, not mock |
| 8 | NVIDIA model used meaningfully in UX | VERIFIED | Powers the Ask-NaniAI chatbot and the natural-language plan explanations (not the safety gate) |
| 9 | Public YouTube demo < 3 min | NOT DONE | Script in `DEMO_SCRIPT.md`; recording/upload is yours to do |
| 10 | Project description | VERIFIED | `PROJECT_DESCRIPTION.md` |
| 11 | Hackathon-period changes explained | VERIFIED | See "What changed during the hackathon" in `PROJECT_DESCRIPTION.md` |
| 12 | Nebius/NVIDIA tool feedback | NOT DONE | Draft once Nebius access is (if ever) obtained; NVIDIA feedback can be written now |
| 13 | Public access for judging | VERIFIED | Repo + demo are public |
| 14 | Secrets / license review | VERIFIED | `.env*` and `.vercel/` gitignored; no secrets committed (verified each commit) |

## The one blocker that decides eligibility
**#6 — Nebius infrastructure.** Until a Nebius Token Factory key (or AI Cloud deployment) exists,
this submission does not meet the mandatory infra requirement. The fastest unblock is a teammate
in a billing-supported country creating the Token Factory account/key, or Nebius granting manual
access via the Discord billing-country escalation. Once any Nebius key exists, the swap is:
set `LLM_BASE_URL=https://api.tokenfactory.nebius.com/v1`, `LLM_API_KEY`, `LLM_MODEL=<an NVIDIA
model in the Token Factory catalog>`, then `npm run verify:nebius` must PASS, then redeploy.

## What you personally must do on Devpost
1. Decide whether to submit knowing #6 is unmet (risk: ineligible), or pursue the teammate/Discord unblock first.
2. Add a LICENSE file (#4).
3. Record + upload the <3-min demo (#9).
4. Fill the Devpost form; do not claim Nebius usage unless #6 becomes VERIFIED.
