import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server-side proxy for the free, no-key US National Library of Medicine
// Clinical Tables Search Service.
//   conditions -> https://clinicaltables.nlm.nih.gov/api/conditions/v3/search
//   medications -> https://clinicaltables.nlm.nih.gov/api/rxterms/v3/search
//
// Privacy: we forward ONLY the short search term the user typed — never their
// name, profile, saved conditions, or medication list. NLM logs request URLs +
// IPs, so nothing identifying is embedded. Results are plain public terminology
// labels (no codes stored), clearly a US-focused catalog, not global coverage.

const ENDPOINTS: Record<string, string> = {
  conditions: "https://clinicaltables.nlm.nih.gov/api/conditions/v3/search",
  medications: "https://clinicaltables.nlm.nih.gov/api/rxterms/v3/search",
};

// tiny in-memory LRU-ish cache (term -> results) to cut repeat calls
const cache = new Map<string, { at: number; results: string[] }>();
const TTL = 10 * 60 * 1000;

export async function GET(req: NextRequest) {
  const type = (req.nextUrl.searchParams.get("type") ?? "").toLowerCase();
  const raw = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (!ENDPOINTS[type]) return NextResponse.json({ error: "bad type" }, { status: 400 });
  // input validation: short terms only; strip anything odd
  const q = raw.replace(/[^\p{L}\p{N}\s\-'/.]/gu, "").slice(0, 80);
  if (q.length < 2) return NextResponse.json({ results: [], source: "NLM Clinical Tables" });

  const key = `${type}:${q.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) {
    return NextResponse.json({ results: hit.results, source: "NLM Clinical Tables", cached: true });
  }

  const url = new URL(ENDPOINTS[type]);
  url.searchParams.set("terms", q);
  url.searchParams.set("maxList", "8");

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`NLM ${res.status}`);
    // Positional JSON: [ total, codes[], extra, displayRows[[name], ...] ]
    const data = await res.json();
    const rows: any[] = Array.isArray(data) && Array.isArray(data[3]) ? data[3] : [];
    const results = rows
      .map((r) => (Array.isArray(r) ? r[0] : typeof r === "string" ? r : ""))
      .filter((s): s is string => typeof s === "string" && s.length > 0)
      .slice(0, 8);
    cache.set(key, { at: Date.now(), results });
    if (cache.size > 500) cache.delete(cache.keys().next().value as string);
    return NextResponse.json({ results, source: "NLM Clinical Tables" });
  } catch (err) {
    // honest fallback — caller keeps free-text entry working
    return NextResponse.json({ results: [], source: "NLM Clinical Tables", error: (err as Error).message }, { status: 200 });
  } finally {
    clearTimeout(t);
  }
}
