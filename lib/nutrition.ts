import type { PlanItem, Nutrition, Constraints } from "@/lib/types";

// Nutrition roll-ups for the "check calories" dashboard. Pure functions over
// the already-chosen plan — no new data source, so numbers are consistent with
// what the clinician gate enforced.

export function emptyNutrition(): Nutrition {
  return { kcal: 0, sugar_g: 0, sodium_mg: 0, carbs_g: 0, potassium_mg: 0 };
}

export function dayTotals(items: { dish: { nutrition: Nutrition } }[]): Nutrition {
  return items.reduce((acc, it) => {
    acc.kcal += it.dish.nutrition.kcal;
    acc.sugar_g += it.dish.nutrition.sugar_g;
    acc.sodium_mg += it.dish.nutrition.sodium_mg;
    acc.carbs_g += it.dish.nutrition.carbs_g;
    acc.potassium_mg = (acc.potassium_mg ?? 0) + (it.dish.nutrition.potassium_mg ?? 0);
    return acc;
  }, emptyNutrition());
}

/** Daily reference caps = per-meal cap × meals, for a readable dashboard target. */
export function dailyCaps(c: Constraints, mealCount: number) {
  return {
    sugar_g: c.maxSugarPerMeal_g * mealCount,
    sodium_mg: c.maxSodiumPerMeal_mg * mealCount,
    carbs_g: c.maxCarbsPerMeal_g * mealCount,
  };
}
