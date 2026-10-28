import type { Persona, Dish, Affinity } from "@/lib/types";
import { getDish } from "@/lib/data/dishes";
import { getAffinities } from "@/lib/qloo/live";
import type { TasteAnchor } from "@/lib/qloo/mock";

// The Culture Agent turns a persona into a taste anchor and asks the Qloo graph
// (or mock) how culturally familiar each candidate dish is. It owns NO medical
// logic — that is the clinician's job. Keeping it thin makes it independently
// testable and makes the "Qloo on vs off" ablation trivial.

export interface CultureResult {
  affinities: Affinity[];
  byId: Map<string, Affinity>;
  live: boolean;
  note?: string;
}

export async function runCultureAgent(
  persona: Persona,
  candidates: Dish[],
): Promise<CultureResult> {
  const anchor: TasteAnchor = {
    cuisine: persona.cuisine,
    region: persona.region,
    lovedDishes: persona.lovedDishIds.map(getDish),
  };
  const { affinities, live, note } = await getAffinities(anchor, candidates);
  return {
    affinities,
    byId: new Map(affinities.map((a) => [a.dishId, a])),
    live,
    note,
  };
}

export function familiarityOf(a: Affinity | undefined): number {
  return a ? Math.round(a.score * 100) : 0;
}
