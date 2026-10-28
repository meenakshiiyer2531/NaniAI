import { NextResponse } from "next/server";
import { qlooHealthCheck } from "@/lib/qloo/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/qloo/health — validate the Qloo key the moment it arrives. */
export async function GET() {
  const result = await qlooHealthCheck();
  return NextResponse.json(result);
}
