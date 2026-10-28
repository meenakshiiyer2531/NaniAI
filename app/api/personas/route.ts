import { NextResponse } from "next/server";
import { PERSONAS } from "@/lib/data/personas";
import { getDish } from "@/lib/data/dishes";
import { activeProvider } from "@/lib/modelGateway";
import { qlooIsConfigured } from "@/lib/qloo/live";

export const runtime = "nodejs";

/** GET /api/personas — list personas (with loved-dish names) + runtime status. */
export async function GET() {
  const personas = PERSONAS.map((p) => ({
    ...p,
    lovedDishes: p.lovedDishIds.map((id) => getDish(id).name),
  }));
  return NextResponse.json({
    personas,
    status: {
      modelProvider: activeProvider(),
      qlooConfigured: qlooIsConfigured(),
    },
  });
}
