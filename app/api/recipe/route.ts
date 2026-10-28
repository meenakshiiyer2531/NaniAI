import { NextRequest, NextResponse } from "next/server";
import { DISHES_BY_ID } from "@/lib/data/dishes";
import { buildRecipe, portionOf } from "@/lib/recipes";

export const runtime = "nodejs";

/** GET /api/recipe?id=<dishId>&sides=<id,id> — the full plate for a recipe-detail
 *  page. Returns the real catalog dish(es) + derived recipe + approximate portion.
 *  Catalog data only (no user data), so no auth needed here. */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const sidesParam = req.nextUrl.searchParams.get("sides") ?? "";
  const main = DISHES_BY_ID[id];
  if (!main) return NextResponse.json({ error: "Recipe not found" }, { status: 404 });

  const sides = sidesParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((sid) => DISHES_BY_ID[sid])
    .filter(Boolean);

  const toComp = (d: typeof main) => ({
    id: d.id,
    name: d.name,
    cuisine: d.cuisine,
    ingredients: d.ingredients,
    allergens: d.allergens,
    nutrition: d.nutrition,
    portion: portionOf(d),
    recipe: buildRecipe(d),
  });

  return NextResponse.json({
    main: toComp(main),
    sides: sides.map(toComp),
    mealType: main.slots[0] ?? "meal",
  });
}
