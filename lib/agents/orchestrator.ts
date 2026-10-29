import type { Persona, ComparisonResponse } from "@/lib/types";
import { DISHES } from "@/lib/data/dishes";
import { deriveConstraints } from "@/lib/agents/clinician";
import { runCultureAgent } from "@/lib/agents/culture";
import { negotiate } from "@/lib/agents/negotiator";
import type { EndpointOverride } from "@/lib/modelGateway";

// Orchestrator: the top-level agentic workflow for one request.
//   1. Clinician derives hard constraints (deterministic).
//   2. Culture agent fetches Qloo affinities ONCE (shared by both plans).
//   3. Negotiator composes two plans from the same safe candidate set:
//        - grounded : uses Qloo cultural familiarity
//        - baseline : ignores it (the culturally-blind control)
//   The two plans differ ONLY in whether Qloo's signal is used — a fair,
//   reproducible ablation that isolates exactly what Qloo adds.

export async function runComparison(
  persona: Persona,
  day = 0,
  modelOverride?: EndpointOverride,
): Promise<ComparisonResponse> {
  const constraints = deriveConstraints(persona);

  const culture = await runCultureAgent(persona, DISHES);

  const [grounded, baseline] = await Promise.all([
    negotiate(persona, constraints, culture.byId, "grounded", day, modelOverride),
    negotiate(persona, constraints, culture.byId, "baseline", day, modelOverride),
  ]);

  // Stamp the real Qloo-live status (the negotiator doesn't know it).
  grounded.meta.qlooLive = culture.live;
  baseline.meta.qlooLive = culture.live;

  if (culture.note) {
    grounded.negotiation.unshift({ agent: "culture", message: culture.note });
  }

  return { persona, constraints, grounded, baseline };
}
