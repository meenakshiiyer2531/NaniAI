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
