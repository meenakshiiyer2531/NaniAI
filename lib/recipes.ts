import type { Dish } from "@/lib/types";

// Lightweight, honest recipe generator + a real YouTube deep-link.
// We do NOT claim a tested chef recipe; we derive sensible steps from the
// dish's ingredients and preparation tags, and link to a live YouTube search
// so the user can watch someone actually make it. No API key, no quota.

export interface Recipe {
  steps: string[];
  youtubeQuery: string;
  youtubeUrl: string;
  /** Rough, approximate prep guidance (labelled with ~ in the UI). */
  prep: string;
}

function estimatePrep(dish: Dish): string {
  if (dish.tags.includes("fermented")) return "~15 min active · soak/ferment ahead";
  if (dish.tags.includes("fried")) return "~25 min";
  if (dish.tags.includes("steamed")) return "~15 min + steam";
  if (dish.tags.includes("griddled")) return "~20 min";
  if (dish.tags.includes("soup") || dish.tags.includes("liquid")) return "~15 min";
  if (dish.tags.includes("dessert")) return "~20 min";
  if (dish.tags.includes("rice")) return "~20 min";
  return "~15 min";
}

export function buildRecipe(dish: Dish): Recipe {
  const steps: string[] = [];
  steps.push(`Gather your ingredients: ${dish.ingredients.join(", ")}.`);

  if (dish.tags.includes("fermented"))
    steps.push("Soak and grind to a batter, then let it ferment 8–12 hours until airy.");
  if (dish.tags.includes("steamed"))
    steps.push("Pour into greased moulds and steam 10–12 minutes until a toothpick comes out clean.");
  if (dish.tags.includes("griddled"))
    steps.push("Ladle onto a hot griddle, spread, and cook until the edges lift and the base is golden.");
  if (dish.tags.includes("fried"))
    steps.push("Shape and fry until crisp — use an air-fryer or minimal oil for a lighter version.");
  if (dish.tags.includes("soup") || dish.tags.includes("liquid"))
    steps.push("Simmer everything together until the flavors meld; keep it at a comfortable, sippable consistency.");
  if (dish.tags.includes("rice") && !dish.tags.includes("fermented"))
    steps.push("Cook the rice soft, then gently fold through the other ingredients.");
  if (dish.tags.includes("dessert"))
    steps.push("Sweeten gently — prefer dates or jaggery alternatives — and warm through until fragrant.");

  steps.push("Season lightly: go easy on salt and sugar, and taste as you go.");
  steps.push("Serve warm, at a texture that's comfortable to chew and swallow.");

  const youtubeQuery = `how to make ${dish.name} recipe`;
  const youtubeUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(
    youtubeQuery,
  )}`;
  return { steps, youtubeQuery, youtubeUrl, prep: estimatePrep(dish) };
}

/** Approximate serving size per dish — honest guidance, not a prescription. */
export function portionOf(d: { id: string; tags: string[] }): string {
  const t = d.tags, id = d.id;
  if (t.includes("flatbread") || /paratha|thepla|chapati/.test(id)) return "2 pieces";
  if (/^idli|millet_idli/.test(id)) return "3 pieces";
  if (id.includes("dosa")) return "1–2";
  if (id === "uttapam" || id === "appam") return "1–2";
  if (id === "medu_vada") return "2 pieces";
  if (t.includes("rice")) return "1 cup cooked";
  if (t.includes("yogurt")) return "2–3 tbsp";
  if (t.includes("accompaniment") || t.includes("soup") || t.includes("liquid")) return "1 small bowl";
  if (t.includes("dessert")) return "small bowl (~½ cup)";
  return "1 serving";
}

/** How to prep a dish ahead of time (recipe-specific, not generic). */
export function prepTipFor(d: { tags: string[] }): string {
  const t = d.tags;
  if (t.includes("fermented")) return "Soak and grind the batter tonight and leave it to ferment overnight.";
  if (t.includes("flatbread") || t.includes("wheat")) return "Knead the dough ahead, cover, and rest it so it's ready to roll.";
  if (t.includes("rice") || t.includes("lentil")) return "Rinse and soak the rice/lentils ahead so the cook is quick.";
  return "Chop and portion the ingredients ahead to save time.";
}
