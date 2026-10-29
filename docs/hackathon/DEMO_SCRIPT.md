# NaniAI — 3-Minute Demo Video Plan (script + shot list)

Target: **under 3:00**, public YouTube, original footage only. No copyrighted music.
Show the **real app functioning** — never edit in mock results or present a recording as live
inference.

> Honesty note: do **not** claim or show "running on Nebius" unless/until the Nebius swap is done
> and `npm run verify:nebius` passes. If submitting with the NVIDIA-API integration only, say
> exactly that on screen.

| Time | Shot | On-screen / voiceover |
|---|---|---|
| 0:00–0:15 | App landing + one-line pitch | "NaniAI — safe, culturally-grounded meal planning for people managing health conditions, anywhere." |
| 0:15–0:40 | Sign up → first onboarding steps | "Real accounts. New users get a short setup — cuisines they love, conditions, allergies, schedule. We never guess from where you live." |
| 0:40–1:05 | Pick multiple cuisines (e.g. Japanese + Mexican + Mediterranean) → generate a plan | "Choose any cuisines. The plan draws from all of them — no default cuisine — and every plate is cuisine-coherent." |
| 1:05–1:35 | Open a meal: full plate, servings scaler, grocery list, recipe | "Complete plates with accompaniments, serving-size scaling, and a grocery list. Nutrition is shown as clearly-labeled estimates — honest, not lab values." |
| 1:35–2:05 | Trigger the safety gate: show a loved dish blocked for a condition + a safe swap; hover an ⓘ reason | "A deterministic clinical safety gate filters every dish for your conditions and allergies first — the AI can't override it. Here a favorite is swapped for the nearest safe, familiar match." |
| 2:05–2:35 | Ask-NaniAI chatbot: ask a real food question; then show `/api/model/health` in a browser tab | "The chatbot and plan explanations are powered by a live NVIDIA Nemotron model — here's the real health check: provider, model, latency." |
| 2:35–2:55 | Sign out → sign in as a different account → show no data leaks | "Your data is private and isolated per account — verified by an automated regression suite." |
| 2:55–3:00 | Close on landing + repo/demo URL | "NaniAI — your personal food companion, wherever you call home." |

## Capture checklist
- Use a seeded demo account with a vivid multi-cuisine profile so the plan is visually diverse.
- Keep the `/api/model/health` tab ready to show the **real** model response (evidence of live inference).
- Record the safety-gate block with a persona that actually triggers it (e.g. a high-sugar favorite under diabetes).
- No real patient data; use synthetic profiles only.
- If Nebius is integrated by demo time, add a 5s shot of `npm run verify:nebius` printing PASS and `/api/model/health` showing `infra: "nebius"`.
