import { NextResponse } from "next/server";
import { modelHealthCheck } from "@/lib/modelGateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** GET /api/model/health — validate the configured LLM with a tiny real call.
 *  Never exposes the key; reports provider + model + outcome only. */
export async function GET() {
  const result = await modelHealthCheck();
  return NextResponse.json(result);
}
