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

function cuisineAffinity(a: string, b: string): number {
  return CUISINE_ADJACENCY[a]?.[b] ?? (a === b ? 1 : 0.05);
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
  return candidates.map((dish) => {
    const cAff = cuisineAffinity(anchor.cuisine, dish.cuisine);

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
    if (dish.cuisine === anchor.cuisine) {
      evidence.push(`same cuisine as favorites (${dish.cuisine})`);
    } else if (cAff >= 0.4) {
      evidence.push(`${dish.cuisine} is culturally adjacent to ${anchor.cuisine}`);
    } else {
      evidence.push(`${dish.cuisine} is culturally distant from ${anchor.cuisine}`);
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
