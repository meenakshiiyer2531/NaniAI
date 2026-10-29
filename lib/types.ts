// Core domain types for NaniAI.
// The design keeps three concerns separable and independently testable:
//   - Dish / Persona / Constraints: the medical + cultural data model
//   - Qloo affinity: the cultural taste signal (external, mockable)
//   - Plan / Negotiation: the agent output exposed to the UI

export type MealSlot = "breakfast" | "lunch" | "dinner" | "snack";

/** IDDSI-inspired firmness / chewing demand.
 *  7 = regular (firm, needs full chewing), 0 = thin liquid.
 *  A persona sets `textureMax` = the highest firmness they can safely handle;
 *  a dish is texture-safe when `dish.texture <= persona.textureMax`. */
export type TextureLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface Nutrition {
  kcal: number;
  sugar_g: number;
  sodium_mg: number;
  carbs_g: number;
  potassium_mg?: number;
}

export interface Dish {
  id: string;
  name: string;
  cuisine: string;
  /** Flavor / ingredient / preparation tags, overlapping with Qloo-style tags. */
  tags: string[];
  ingredients: string[];
  allergens: string[];
  nutrition: Nutrition;
  texture: TextureLevel;
  slots: MealSlot[];
  /** Short human description used in the UI and by the narrator model. */
  blurb: string;
}

export type Condition =
  | "type_2_diabetes"
  | "hypertension"
  | "chronic_kidney_disease"
  | "dysphagia";

export interface Persona {
  id: string;
  name: string;
  age: number;
  cuisine: string;
  /** All cuisines the person enjoys (multi-select). The engine scores a dish by
   *  its BEST affinity across this list, so a user who likes Japanese + Mexican +
   *  Mediterranean gets variety from all three — not just the first. Empty means
   *  "open to everything": no cuisine is preferred (and none is defaulted). */
  cuisines?: string[];
  /** Sub-regional place (e.g. "Tamil Nadu", "Punjab", "Kerala"). Sharpens the
   *  Qloo taste signal toward dishes popular where the person is from. */
  region?: string;
  conditions: Condition[];
  /** Medication names; drive food-interaction rules in the clinician gate. */
  medications: string[];
  /** Highest texture level the person can safely eat. */
  textureMax: TextureLevel;
  allergies: string[];
  /** Dish ids the person loves — the cultural anchor for Qloo affinity. */
  lovedDishIds: string[];
  /** Free-text favorite dishes the person typed in their own words. Used as
   *  extra cultural/chat context; never gated on (no verified nutrition). */
  lovedFreeText?: string[];
  story: string;
}

/** Hard medical limits derived deterministically from conditions + meds.
 *  The LLM never sees a path to loosen these. */
export interface Constraints {
  maxSugarPerMeal_g: number;
  maxSodiumPerMeal_mg: number;
  maxCarbsPerMeal_g: number;
  /** Set when a condition (e.g. CKD) requires limiting potassium. */
  maxPotassiumPerMeal_mg?: number;
  textureMax: TextureLevel;
  /** Ingredients forbidden by allergy or drug-food interaction, with reason. */
  forbiddenIngredients: { ingredient: string; reason: string }[];
}

/** Result of checking a single dish against the clinician gate. */
export interface ComplianceResult {
  dishId: string;
  compliant: boolean;
  violations: string[];
}

/** A Qloo affinity edge: how culturally close `dishId` is to the persona's
 *  taste anchor, 0..1. `source` records provenance for groundedness receipts. */
export interface Affinity {
  dishId: string;
  score: number; // 0..1
  /** Entities/tags that produced this affinity — shown as a receipt. */
  evidence: string[];
  source: "qloo" | "qloo-mock" | "unavailable";
}

export interface ScoredDish {
  dish: Dish;
  /** 0..100 cultural familiarity, derived from Qloo affinity. */
  familiarity: number;
  affinity: Affinity;
  compliance: ComplianceResult;
}

/** When a loved dish is unsafe, the nearest compliant culturally-adjacent dish. */
export interface Substitution {
  fromDishId: string;
  toDishId: string;
  familiarity: number;
  reasonUnsafe: string[];
  tradeoff: string; // plain-language explanation (model-narrated when available)
}

export interface PlanItem {
  slot: MealSlot;
  dish: Dish;
  familiarity: number;
  receipt: string[]; // Qloo evidence for this pick
  /** Complementary accompaniments that make the slot a full plate (thali-style);
   *  only added while the combined plate still fits the safety caps. */
  sides?: Dish[];
  substitutedFor?: Substitution;
  /** Alternative COMPLETE plates for this slot (each a main + its own sides). */
  alternatives?: { dish: Dish; familiarity: number; receipt: string[]; sides?: Dish[] }[];
}

export interface Plan {
  items: PlanItem[];
  /** Mean familiarity across items, 0..100. */
  avgFamiliarity: number;
  violationCount: number;
}

/** The agent negotiation trace, surfaced in the UI so the workflow is visible. */
export interface NegotiationStep {
  agent: "clinician" | "culture" | "negotiator";
  message: string;
}

export type ModelProvider = "mock" | "openai";

export interface RunMeta {
  modelProvider: ModelProvider;
  modelName: string;
  qlooLive: boolean;
  latencyMs: number;
  estCostUsd: number | null;
}

/** Full response for one plan generation (either grounded or baseline). */
export interface PlanResponse {
  plan: Plan;
  substitutions: Substitution[];
  negotiation: NegotiationStep[];
  meta: RunMeta;
}

/** The side-by-side payload the UI renders: Qloo-grounded vs generic baseline. */
export interface ComparisonResponse {
  persona: Persona;
  constraints: Constraints;
  grounded: PlanResponse;
  baseline: PlanResponse;
}
