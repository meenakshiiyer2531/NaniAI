import type { Dish, Affinity } from "@/lib/types";

// The cultural taste signal. In production this comes from Qloo's taste graph;
// here we also provide a deterministic MOCK that approximates Qloo's behavior
// so the whole product runs, deploys and demos with no API key — then swaps to
// the live graph the moment a key is present (see live.ts).
//
// The mock is NOT a stand-in we pass off as real: the UI always labels the
// source (`qloo` vs `qloo-mock` vs `unavailable`). Honesty under failure is
// itself novelty point #5.

export interface TasteAnchor {
  cuisine: string;
  /** All cuisines the person enjoys. The dish's cuisine affinity is the BEST
   *  match across this list (so multi-cuisine users get variety). Empty/absent
   *  means "open to everything" — every cuisine scores equally neutral. */
  cuisines?: string[];
  /** Optional sub-regional place that sharpens preferences. */
  region?: string;
  lovedDishes: Dish[];
}

/** How culturally close two cuisines are, 0..1. Hand-curated adjacency used by
 *  the mock; the live graph replaces this with real Qloo affinities. */
const CUISINE_ADJACENCY: Record<string, Record<string, number>> = {
  "South Indian": { "South Indian": 1.0, "North Indian": 0.55, Western: 0.08 },
  "North Indian": { "North Indian": 1.0, "South Indian": 0.55, Western: 0.1 },
  Western: { Western: 1.0, "South Indian": 0.08, "North Indian": 0.1 },
};

/** Region -> the taste traits most associated with dishes from that place.
 *  Lets "I'm from Kerala" nudge toward coconut/rice dishes specifically. */
const REGION_SIGNATURE: Record<string, string[]> = {
  "Tamil Nadu": ["rice", "fermented", "tamarind", "lentil", "pepper"],
  Kerala: ["coconut", "rice", "curry leaf", "vegetable"],
  Karnataka: ["rice", "lentil", "millet", "mild"],
  Punjab: ["paneer", "spinach", "creamy", "wheat"],
  "Andhra Pradesh": ["tamarind", "pepper", "rice", "savory"],
};

/** Cuisines whose everyday staples (oats, yogurt, fruit, green salad, clear
 *  soup) are culturally "neutral" — they sit comfortably on a plate of any
 *  cuisine. This lets a user whose own cuisine has no breakfast/snack in the
 *  catalog fall back to a neutral option instead of a foreign ethnic dish. */
const NEUTRAL_CUISINES = new Set(["Western", "American"]);
/** The Indian sub-cuisines, which are mutually adjacent. */
const INDIAN_FAMILY = new Set([
  "South Indian",
  "North Indian",
  "West Indian",
  "East Indian",
]);

function cuisineAffinity(a: string, b: string): number {
  if (a === b) return 1.0;
  const explicit = CUISINE_ADJACENCY[a]?.[b];
  if (explicit != null) return explicit;
  if (INDIAN_FAMILY.has(a) && INDIAN_FAMILY.has(b)) return 0.55;
  // Neutral everyday foods pair with any cuisine (a Western yogurt/oats breakfast
  // is a sensible default for anyone when their own cuisine offers none).
  if (NEUTRAL_CUISINES.has(a) || NEUTRAL_CUISINES.has(b)) return 0.45;
  return 0.08;
}

/** Overlap coefficient: |∩| / min(|a|,|b|). More generous than Jaccard for
 *  comparing a dish against one specific favorite. */
function overlap(a: string[], b: string[]): { score: number; shared: string[] } {
  const sa = new Set(a);
  const sb = new Set(b);
  const shared = [...sa].filter((x) => sb.has(x));
  const denom = Math.min(sa.size, sb.size) || 1;
  return { score: shared.length / denom, shared };
}

/**
 * Deterministic approximation of Qloo affinity between a persona's taste anchor
 * and each candidate dish. Blends cuisine adjacency with similarity to the
 * person's SPECIFIC favorite dishes (not just the cuisine average), so dishes
 * close to what they actually love score highest. Pure and stable.
 */
export function computeMockAffinities(
  anchor: TasteAnchor,
  candidates: Dish[],
): Affinity[] {
  // The person's cuisines (multi-select). Fall back to the single `cuisine`.
  // Empty = "open to everything": no cuisine is preferred, so every dish gets a
  // neutral cuisine score and variety/health drive the picks (never an Indian
  // or any other default).
  let anchorCuisines: string[] = [];
  if (anchor.cuisines && anchor.cuisines.length > 0) anchorCuisines = anchor.cuisines;
  else if (anchor.cuisine) anchorCuisines = [anchor.cuisine];
  const openToEverything = anchorCuisines.length === 0;

  return candidates.map((dish) => {
    // Best cuisine affinity across ALL the person's cuisines.
    const cAff = openToEverything
      ? 0.5
      : Math.max(...anchorCuisines.map((c) => cuisineAffinity(c, dish.cuisine)));

    // Similarity to the closest individual favorite.
    let bestLovedSim = 0;
    let bestLoved: Dish | undefined;
    let bestShared: string[] = [];
    for (const loved of anchor.lovedDishes) {
      const { score, shared } = overlap(dish.tags, loved.tags);
      if (score > bestLovedSim) {
        bestLovedSim = score;
        bestLoved = loved;
        bestShared = shared;
      }
    }

    // Regional nudge: dishes carrying the signature traits of the person's
    // home region score a little higher (and earn a "popular in ..." receipt).
    const signature = anchor.region ? REGION_SIGNATURE[anchor.region] ?? [] : [];
    const regionHits = signature.filter((t) => dish.tags.includes(t));
    const regionBonus = Math.min(0.15, regionHits.length * 0.05);

    const raw = 0.45 * cAff + 0.55 * bestLovedSim + regionBonus;
    const score = Math.max(0, Math.min(1, raw));

    const evidence: string[] = [];
    if (openToEverything) {
      evidence.push(`open to all cuisines — ${dish.cuisine} is a fair match`);
    } else if (anchorCuisines.includes(dish.cuisine)) {
      evidence.push(`one of your cuisines (${dish.cuisine})`);
    } else if (cAff >= 0.4) {
      evidence.push(`${dish.cuisine} is culturally close to ${anchorCuisines.join("/")}`);
    } else {
      evidence.push(`${dish.cuisine} is culturally distant from ${anchorCuisines.join("/")}`);
    }
    if (bestLoved && bestShared.length > 0) {
      evidence.push(
        `resembles favorite "${bestLoved.name}" (${bestShared.slice(0, 3).join(", ")})`,
      );
    }
    if (anchor.region && regionHits.length > 0) {
      evidence.push(`popular in ${anchor.region} (${regionHits.slice(0, 3).join(", ")})`);
    }

    return { dishId: dish.id, score, evidence, source: "qloo-mock" as const };
  });
}

export { cuisineAffinity, overlap };
