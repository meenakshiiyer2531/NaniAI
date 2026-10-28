import { NextRequest, NextResponse } from "next/server";
import type { Persona, Condition, TextureLevel } from "@/lib/types";
import { getPersona } from "@/lib/data/personas";
import { DISHES, DISHES_BY_ID } from "@/lib/data/dishes";
import { deriveConstraints, checkDish } from "@/lib/agents/clinician";
import { runComparison } from "@/lib/agents/orchestrator";
import { specialistSuggestions, buildIceCard, EMERGENCY_SCENARIOS } from "@/lib/care";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Qloo Insights can be slow on a cold call; the app uses a cached snapshot so
// this is fast, but allow headroom in case a live refresh path is added.
export const maxDuration = 30;

const VALID_CONDITIONS: Condition[] = [
  "type_2_diabetes",
  "hypertension",
  "chronic_kidney_disease",
  "dysphagia",
];

/** Build a safe Persona from untrusted client input (the "Your Kitchen" form). */
function sanitizePersona(input: any): Persona {
  const clampTexture = (n: any): TextureLevel => {
    const v = Math.round(Number(n));
    return (Math.max(0, Math.min(7, isNaN(v) ? 7 : v)) as TextureLevel);
  };
  const conditions = Array.isArray(input?.conditions)
    ? input.conditions.filter((c: any): c is Condition => VALID_CONDITIONS.includes(c))
    : [];
  const lovedDishIds = Array.isArray(input?.lovedDishIds)
    ? input.lovedDishIds.filter((id: any) => typeof id === "string" && DISHES_BY_ID[id])
    : [];

  return {
    id: "custom",
    name: String(input?.name ?? "You").slice(0, 40) || "You",
    age: Math.max(1, Math.min(120, Math.round(Number(input?.age)) || 30)),
    cuisine: String(input?.cuisine ?? "South Indian").slice(0, 40),
    region: input?.region ? String(input.region).slice(0, 40) : undefined,
    conditions,
    medications: Array.isArray(input?.medications)
      ? input.medications.map((m: any) => String(m).slice(0, 40)).slice(0, 10)
      : [],
    textureMax: clampTexture(input?.textureMax),
    allergies: Array.isArray(input?.allergies)
      ? input.allergies.map((a: any) => String(a).slice(0, 30)).slice(0, 10)
      : [],
    lovedDishIds,
    story: String(input?.story ?? "").slice(0, 400),
  };
}

/**
 * POST /api/plan  { personaId } | { persona } , optional { day }
 * Runs the full agentic workflow and returns the grounded-vs-baseline
 * comparison, the clinician's rejected-dish report, and (honest, non-fake)
 * care-coordination info: specialist search links + an emergency card.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const day = Math.max(0, Math.round(Number(body?.day)) || 0);

    let persona: Persona;
    if (body?.persona) {
      persona = sanitizePersona(body.persona);
    } else if (body?.personaId) {
      persona = getPersona(body.personaId);
    } else {
      return NextResponse.json(
        { error: "provide personaId or persona" },
        { status: 400 },
      );
    }

    const comparison = await runComparison(persona, day);

    const constraints = deriveConstraints(persona);
    const rejected = DISHES.map((d) => ({ dish: d, result: checkDish(d, constraints) }))
      .filter((r) => !r.result.compliant)
      .map((r) => ({
        id: r.dish.id,
        name: r.dish.name,
        cuisine: r.dish.cuisine,
        loved: persona.lovedDishIds.includes(r.dish.id),
        violations: r.result.violations,
      }));

    return NextResponse.json({
      ...comparison,
      rejected,
      care: {
        specialists: specialistSuggestions(persona),
        ice: buildIceCard(persona),
        emergencyScenarios: EMERGENCY_SCENARIOS,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message ?? "internal error" },
      { status: 500 },
    );
  }
}
