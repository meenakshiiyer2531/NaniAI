import { NextResponse } from "next/server";
import { DISHES } from "@/lib/data/dishes";

export const runtime = "nodejs";

/** GET /api/catalog — data the "Your Kitchen" profile builder needs:
 *  the dish list (to pick favorites) plus the option vocabularies. */
export async function GET() {
  const cuisines = Array.from(new Set(DISHES.map((d) => d.cuisine))).sort();
  return NextResponse.json({
    dishes: DISHES.map((d) => ({
      id: d.id,
      name: d.name,
      cuisine: d.cuisine,
      slots: d.slots,
    })),
    cuisines,
    regions: [
      "Tamil Nadu",
      "Kerala",
      "Karnataka",
      "Andhra Pradesh",
      "Punjab",
      "",
    ],
    conditions: [
      { id: "type_2_diabetes", label: "Type 2 diabetes" },
      { id: "hypertension", label: "Hypertension" },
      { id: "chronic_kidney_disease", label: "Kidney disease" },
      { id: "dysphagia", label: "Swallowing difficulty" },
    ],
    allergies: ["peanut", "nuts", "dairy", "gluten", "fish"],
    medications: ["metformin", "amlodipine", "warfarin"],
  });
}
