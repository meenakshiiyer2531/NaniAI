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

// Map free-text condition names (what users type) to the enum the deterministic
// gate has rules for. Unrecognized conditions are kept out of the gate (saved as
// context elsewhere) — we never invent a safety rule we don't actually have.
function toConditionEnum(raw: string): Condition | null {
  const s = raw.toLowerCase();
  if (VALID_CONDITIONS.includes(raw as Condition)) return raw as Condition;
  if (/diabet|sugar|\bt2d\b|prediab|gestational/.test(s)) return "type_2_diabetes";
  if (/hypertens|blood pressure|\bbp\b/.test(s)) return "hypertension";
  if (/kidney|renal|\bckd\b|dialysis|nephro/.test(s)) return "chronic_kidney_disease";
  if (/dysphag|swallow/.test(s)) return "dysphagia";
  return null;
}

/** Build a safe Persona from untrusted client input (the "Your Kitchen" form). */
function sanitizePersona(input: any): Persona {
  const clampTexture = (n: any): TextureLevel => {
    const v = Math.round(Number(n));
    return (Math.max(0, Math.min(7, isNaN(v) ? 7 : v)) as TextureLevel);
  };
  const conditions: Condition[] = Array.isArray(input?.conditions)
    ? Array.from(new Set<Condition>(
        input.conditions
          .filter((c: any) => typeof c === "string")
          .map((c: string) => toConditionEnum(c))
          .filter((c: Condition | null): c is Condition => c !== null),
      ))
    : [];
  // Cuisines the person enjoys (multi-select). No cuisine is ever defaulted:
  // an empty list means "open to everything" and the engine prefers none.
  const cuisines: string[] = Array.isArray(input?.cuisines)
    ? Array.from(
        new Set(
          input.cuisines
            .filter((c: any) => typeof c === "string" && c.trim())
            .map((c: string) => c.trim().slice(0, 40)),
        ),
      ).slice(0, 12) as string[]
    : [];
  // Back-compat: a single `cuisine` string still works; fold it into the list.
  const single = typeof input?.cuisine === "string" ? input.cuisine.trim().slice(0, 40) : "";
  if (single && !cuisines.includes(single)) cuisines.unshift(single);

  const lovedDishIds = Array.isArray(input?.lovedDishIds)
    ? input.lovedDishIds.filter((id: any) => typeof id === "string" && DISHES_BY_ID[id])
    : [];

  // Free-text favorites: sanitize to short strings, and opportunistically resolve
  // any that name a dish we actually have (so they can influence the safe plan).
  const lovedFreeText: string[] = Array.isArray(input?.lovedFreeText)
    ? input.lovedFreeText
        .filter((s: any) => typeof s === "string" && s.trim())
        .map((s: string) => s.trim().slice(0, 60))
        .slice(0, 20)
    : [];
  for (const txt of lovedFreeText) {
    const lc = txt.toLowerCase();
    const match = DISHES.find(
      (d) => d.name.toLowerCase() === lc || d.name.toLowerCase().includes(lc) || lc.includes(d.name.toLowerCase()),
    );
    if (match && !lovedDishIds.includes(match.id)) lovedDishIds.push(match.id);
  }

  return {
    id: "custom",
    name: String(input?.name ?? "You").slice(0, 40) || "You",
    age: Math.max(1, Math.min(120, Math.round(Number(input?.age)) || 30)),
    cuisine: cuisines[0] ?? "",
    cuisines,
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
    lovedFreeText,
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
