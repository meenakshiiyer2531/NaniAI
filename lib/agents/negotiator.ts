import type {
  Persona,
  Constraints,
  Dish,
  Affinity,
  ComplianceResult,
  Plan,
  PlanItem,
  Substitution,
  NegotiationStep,
  MealSlot,
  PlanResponse,
} from "@/lib/types";
import { getDish, DISHES } from "@/lib/data/dishes";
import { checkDish } from "@/lib/agents/clinician";
import { familiarityOf } from "@/lib/agents/culture";
import { overlap } from "@/lib/qloo/mock";
import { chat, type EndpointOverride } from "@/lib/modelGateway";

const SLOTS: MealSlot[] = ["breakfast", "lunch", "dinner", "snack"];

export type PlanMode = "grounded" | "baseline";

interface Ctx {
  persona: Persona;
  constraints: Constraints;
  affById: Map<string, Affinity>;
  compById: Map<string, ComplianceResult>;
}

/** Generic "diet-chart" desirability used by the culturally-BLIND baseline:
 *  rewards low sugar/sodium/calories, ignores who the person is. */
function genericHealthScore(d: Dish): number {
  return -(d.nutrition.sugar_g * 3 + d.nutrition.sodium_mg / 80 + d.nutrition.kcal / 60);
}

const isDessert = (d: Dish) => d.tags.includes("dessert");
const isThin = (d: Dish) => d.tags.includes("soup") || d.tags.includes("liquid");
/** Accompaniments (dals, chutneys, raitas, sabzis, sambar/rasam…) and thin
 *  broths are SIDES — they round out a plate but are never a standalone meal.
 *  Tag-based so the catalog can grow without editing this file. */
const isSideDish = (d: Dish) => d.tags.includes("accompaniment") || isThin(d);
/** Cuisines whose sides are culturally "neutral" (green salad, clear soup,
 *  yogurt) — safe to pair with a main of ANY cuisine. Everything else may only
 *  accompany a main of its OWN cuisine, so we never bolt an Indian chutney onto
 *  an Italian pasta. Mirrors NEUTRAL_CUISINES in lib/qloo/mock.ts. */
const NEUTRAL_SIDE_CUISINES = new Set(["Western", "American"]);
/** May this side sit on this main's plate? Same cuisine, or a neutral side. */
const sideMatchesMain = (side: Dish, main: Dish) =>
  side.cuisine === main.cuisine || NEUTRAL_SIDE_CUISINES.has(side.cuisine);
/** A "main" is a substantial dish — not a dessert, not a side/broth. */
const isMainDish = (d: Dish) => !isDessert(d) && !isSideDish(d);

/** Would main + all chosen sides together still respect every per-meal cap + texture? */
function plateFits(main: Dish, sides: Dish[], ctx: Ctx): boolean {
  const c = ctx.constraints;
  const all = [main, ...sides];
  const sugar = all.reduce((s, d) => s + d.nutrition.sugar_g, 0);
  const sodium = all.reduce((s, d) => s + d.nutrition.sodium_mg, 0);
  const carbs = all.reduce((s, d) => s + d.nutrition.carbs_g, 0);
  const potassium = all.reduce((s, d) => s + (d.nutrition.potassium_mg ?? 0), 0);
  if (sugar > c.maxSugarPerMeal_g) return false;
  if (sodium > c.maxSodiumPerMeal_mg) return false;
  if (carbs > c.maxCarbsPerMeal_g) return false;
  if (c.maxPotassiumPerMeal_mg != null && potassium > c.maxPotassiumPerMeal_mg) return false;
  if (sides.some((s) => s.texture > ctx.persona.textureMax)) return false;
  return true;
}

function pickForSlots(
  ctx: Ctx,
  mode: PlanMode,
  day = 0,
): { items: PlanItem[]; used: Set<string> } {
  const used = new Set<string>();
  const items: PlanItem[] = [];

  // Day-rotated cuisine preference: the catalog's cuisines are rotated by `day`
  // so a DIFFERENT cuisine leads each day. This is the tiebreaker among
  // equally-familiar dishes — it gives genuine global variety for "open to
  // everything" and multi-cuisine users and stops any one cuisine (Indian or
  // otherwise) from winning every tie just because it scores well on a generic
  // health chart. Returns 0..1, higher = favoured today.
  const ALL_CUISINES = Array.from(new Set(DISHES.map((d) => d.cuisine))).sort();
  const rotationBonus = (cuisine: string): number => {
    const n = ALL_CUISINES.length;
    if (n === 0) return 0;
    const idx = ALL_CUISINES.indexOf(cuisine);
    if (idx < 0) return 0;
    const pos = (idx - (day % n) + n) % n; // 0 = this cuisine leads today
    return (n - pos) / n;
  };

  const rank = (a: Dish, b: Dish) => {
    if (mode === "grounded") {
      const fa = familiarityOf(ctx.affById.get(a.id));
      const fb = familiarityOf(ctx.affById.get(b.id));
      if (fb !== fa) return fb - fa;
      // Equal taste familiarity → rotate cuisines for variety, then health.
      const ra = rotationBonus(a.cuisine);
      const rb = rotationBonus(b.cuisine);
      if (rb !== ra) return rb - ra;
      return genericHealthScore(b) - genericHealthScore(a);
    }
    return genericHealthScore(b) - genericHealthScore(a);
  };

  for (const slot of SLOTS) {
    const compliantPool = DISHES.filter(
      (d) => d.slots.includes(slot) && ctx.compById.get(d.id)!.compliant && !used.has(d.id),
    );
    if (compliantPool.length === 0) continue;

    // Primary pick for a real meal (breakfast/lunch/dinner) must be a substantial
    // main; snacks may be lighter. Fall back to the full pool if no main exists.
    const mains = slot === "snack" ? compliantPool : compliantPool.filter(isMainDish);
    const primaryPool = mains.length > 0 ? mains : compliantPool;
    primaryPool.sort(rank);

    let dish: Dish;
    if (mode === "grounded") {
      const topK = primaryPool.slice(0, Math.min(5, primaryPool.length));
      dish = topK[day % topK.length];
    } else {
      dish = primaryPool[0];
    }
    used.add(dish.id);

    const aff = ctx.affById.get(dish.id);
    const item: PlanItem = {
      slot,
      dish,
      familiarity: familiarityOf(aff),
      receipt: aff?.evidence ?? [],
    };

    // Build a full plate (thali): add complementary accompaniments one at a time,
    // keeping the WHOLE plate within every safety cap. Snacks stay single.
    // `markUsed` reserves sides for the primary; alternatives may reuse them
    // (only one option is served at a time) so EVERY option is a complete plate.
    const composeSides = (main: Dish, markUsed: boolean): Dish[] => {
      if (slot === "snack") return [];
      const sides: Dish[] = [];
      const cands = compliantPool
        .filter((d) => d.id !== main.id && isSideDish(d) && sideMatchesMain(d, main) && (!markUsed || !used.has(d.id)))
        .sort(rank);
      for (const cand of cands) {
        if (sides.length >= 3) break;
        if (plateFits(main, [...sides, cand], ctx)) {
          sides.push(cand);
          if (markUsed) used.add(cand.id);
        }
      }
      return sides;
    };

    const primarySides = composeSides(dish, true);
    if (primarySides.length) item.sides = primarySides;

    if (mode === "grounded") {
      item.alternatives = primaryPool
        .filter((d) => d.id !== dish.id)
        .slice(0, 3)
        .map((d) => ({
          dish: d,
          familiarity: familiarityOf(ctx.affById.get(d.id)),
          receipt: ctx.affById.get(d.id)?.evidence ?? [],
          sides: composeSides(d, false),
        }));
    }
    items.push(item);
  }
  return { items, used };
}

/** For each loved dish that the gate rejected, find the nearest SAFE dish that
 *  is most culturally familiar — the Taste-Preserving Substitution (novelty #1).
 *  Ranks by similarity to THAT specific favorite (shared traits + meal slot),
 *  not a generic "healthy" pick. */
function buildGroundedSubstitutions(ctx: Ctx): Substitution[] {
  const subs: Substitution[] = [];
  for (const lovedId of ctx.persona.lovedDishIds) {
    const comp = ctx.compById.get(lovedId);
    if (!comp || comp.compliant) continue;

    const loved = getDish(lovedId);
    const candidates = DISHES.filter(
      (d) => d.id !== lovedId && ctx.compById.get(d.id)!.compliant,
    );
    let best: Dish | undefined;
    let bestScore = -1;
    let bestShared: string[] = [];
    for (const cand of candidates) {
      const { score: taste, shared } = overlap(cand.tags, loved.tags);
      const slotBonus = cand.slots.some((s) => loved.slots.includes(s)) ? 0.2 : 0;
      const fam = familiarityOf(ctx.affById.get(cand.id)) / 100;
      const total = 0.6 * taste + slotBonus + 0.2 * fam;
      if (total > bestScore) {
        bestScore = total;
        best = cand;
        bestShared = shared;
      }
    }
    if (!best) continue;

    subs.push({
      fromDishId: lovedId,
      toDishId: best.id,
      familiarity: familiarityOf(ctx.affById.get(best.id)),
      reasonUnsafe: comp.violations,
      tradeoff:
        `"${loved.name}" isn't safe (${comp.violations.join("; ")}). ` +
        `Closest safe match: "${best.name}"` +
        (bestShared.length
          ? ` — shares ${bestShared.slice(0, 3).join(", ")}, so it still tastes like home.`
          : "."),
    });
  }
  return subs;
}

/** What a culturally-BLIND assistant does with an unsafe favorite: reach for the
 *  generically "healthiest" dish, with no idea what the person actually loves. */
function buildBaselineSubstitutions(ctx: Ctx): Substitution[] {
  const subs: Substitution[] = [];
  for (const lovedId of ctx.persona.lovedDishIds) {
    const comp = ctx.compById.get(lovedId);
    if (!comp || comp.compliant) continue;

    const loved = getDish(lovedId);
    const candidates = DISHES.filter(
      (d) => d.id !== lovedId && ctx.compById.get(d.id)!.compliant,
    ).sort((a, b) => genericHealthScore(b) - genericHealthScore(a));
    const best = candidates[0];
    if (!best) continue;

    subs.push({
      fromDishId: lovedId,
      toDishId: best.id,
      familiarity: familiarityOf(ctx.affById.get(best.id)),
      reasonUnsafe: comp.violations,
      tradeoff:
        `Drops "${loved.name}" and suggests "${best.name}" — a generically healthy ` +
        `choice, chosen with no knowledge of the person's taste.`,
    });
  }
  return subs;
}

function buildNegotiation(
  ctx: Ctx,
  rejected: Dish[],
  grounded: PlanItem[],
  subs: Substitution[],
): NegotiationStep[] {
  const steps: NegotiationStep[] = [];

  const rejectedLoved = rejected.filter((d) =>
    ctx.persona.lovedDishIds.includes(d.id),
  );
  steps.push({
    agent: "clinician",
    message:
      rejected.length === 0
        ? "All candidate dishes are within safe limits."
        : `Blocked ${rejected.length} dish(es) as unsafe` +
          (rejectedLoved.length
            ? `, including favorite(s): ${rejectedLoved.map((d) => d.name).join(", ")}.`
            : "."),
  });

  const top = [...grounded].sort((a, b) => b.familiarity - a.familiarity).slice(0, 3);
  steps.push({
    agent: "culture",
    message:
      `Among the safe dishes, these score highest on cultural familiarity for ` +
      `${ctx.persona.name}: ` +
      top.map((i) => `${i.dish.name} (${i.familiarity})`).join(", ") + ".",
  });

  if (subs.length > 0) {
    for (const s of subs) {
      steps.push({
        agent: "negotiator",
        message:
          `Favorite "${getDish(s.fromDishId).name}" is unsafe, so I'm swapping in ` +
          `"${getDish(s.toDishId).name}" — the nearest safe dish that preserves the taste (familiarity ${s.familiarity}).`,
      });
    }
  } else {
    steps.push({
      agent: "negotiator",
      message: "No favorites needed substituting — the plan keeps the dishes they love.",
    });
  }
  return steps;
}

async function narrate(
  ctx: Ctx,
  items: PlanItem[],
  subs: Substitution[],
  mode: PlanMode,
  modelOverride?: EndpointOverride,
) {
  const planText = items.map((i) => `${i.slot}: ${i.dish.name}`).join(", ");
  const subText = subs
    .map((s) => `${getDish(s.fromDishId).name} -> ${getDish(s.toDishId).name}`)
    .join("; ");

  const mockText =
    mode === "grounded"
      ? `Here is a day of meals chosen to feel familiar to ${ctx.persona.name} while respecting ` +
        `every medical limit: ${planText}.` +
        (subs.length
          ? ` Where a favorite wasn't safe, we kept the spirit of it (${subText}).`
          : ` It keeps the dishes they already love.`)
      : `A standard diet-chart day: ${planText}.`;

  const system =
    "You are a warm, concise clinical-nutrition guide for an elderly patient. " +
    "You are given an ALREADY-SAFE, ALREADY-CHOSEN meal plan — do not change dishes or add medical claims. " +
    "In 3-4 sentences, explain the plan in the patient's cultural voice, note any favorite that was swapped and why, " +
    "and add one gentle, practical tip. Never invent nutrition numbers.";
  const user =
    `Patient: ${ctx.persona.name}, ${ctx.persona.age}, ${ctx.persona.cuisine}` +
    (ctx.persona.region ? ` (${ctx.persona.region})` : "") +
    `, conditions: ${ctx.persona.conditions.join(", ") || "none"}.\n` +
    `Plan: ${planText}.\nSubstitutions: ${subText || "none"}.\n` +
    `Mode: ${mode}.`;

  // Language reasoning flows through the provider-neutral model gateway (real
  // NVIDIA open model when configured, deterministic mock otherwise).
  const detail = await chat({ system, user, mockText, maxTokens: 300 }, modelOverride);
  return detail;
}

/** Run the negotiation for one mode and return a full PlanResponse. */
export async function negotiate(
  persona: Persona,
  constraints: Constraints,
  affById: Map<string, Affinity>,
  mode: PlanMode,
  day = 0,
  modelOverride?: EndpointOverride,
): Promise<PlanResponse> {
  const compById = new Map<string, ComplianceResult>(
    DISHES.map((d) => [d.id, checkDish(d, constraints)]),
  );
  const ctx: Ctx = { persona, constraints, affById, compById };

  const { items } = pickForSlots(ctx, mode, day);
  const rejected = DISHES.filter((d) => !compById.get(d.id)!.compliant);
  const subs =
    mode === "grounded"
      ? buildGroundedSubstitutions(ctx)
      : buildBaselineSubstitutions(ctx);

  // Attach substitution provenance onto the matching plan item (if present).
  for (const s of subs) {
    const target = items.find((i) => i.dish.id === s.toDishId);
    if (target) target.substitutedFor = s;
  }

  const negotiation =
    mode === "grounded"
      ? buildNegotiation(ctx, rejected, items, subs)
      : [
          {
            agent: "culture" as const,
            message:
              "Baseline mode: cultural familiarity is ignored — dishes are picked purely by a generic diet chart.",
          },
        ];

  const avgFamiliarity =
    items.length === 0
      ? 0
      : Math.round(items.reduce((s, i) => s + i.familiarity, 0) / items.length);

  const narration = await narrate(ctx, items, subs, mode, modelOverride);

  const plan: Plan = {
    items,
    avgFamiliarity,
    violationCount: 0, // guaranteed by the clinician gate
  };

  return {
    plan,
    substitutions: subs,
    negotiation: [
      ...negotiation,
      { agent: "negotiator", message: narration.text },
    ],
    meta: {
      modelProvider: narration.provider,
      modelName: narration.modelName,
      qlooLive: false, // set by orchestrator (it knows the culture result)
      latencyMs: narration.latencyMs,
      estCostUsd: narration.estCostUsd,
    },
  };
}
