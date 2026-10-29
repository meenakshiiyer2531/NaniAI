// Live end-to-end test of the BYOK /api/ai-key storage path (LOCAL only).
// Verifies: save -> masked status, DB holds CIPHERTEXT (not plaintext),
// cross-user isolation (B can't see A's key), replace, delete, and the
// unauthenticated 401. Uses throwaway accounts and deletes them after.
// Requires a running server (next start) + .env.local with BYOK_ENCRYPTION_KEY.
//   node --env-file=.env.local scripts/test-aikey-e2e.mjs

import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BASE = process.env.TEST_BASE_URL || "http://localhost:3131";
const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

const results = [];
const check = (n, ok, d = "") => { results.push({ n, ok: !!ok }); console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); };

const stamp = Date.now();
const A = { email: `aikey-a-${stamp}@test.local`, password: "aikey-pass-A-123" };
const B = { email: `aikey-b-${stamp}@test.local`, password: "aikey-pass-B-123" };
const A_KEY = "nvapi-SECRETKEY-AAAA-1234";
let aId, bId;

async function mkUser(u) { const { data, error } = await admin.auth.admin.createUser({ email: u.email, password: u.password, email_confirm: true }); if (error) throw new Error(error.message); return data.user.id; }
async function tokenFor(u) { const c = createClient(URL, ANON, { auth: { persistSession: false } }); const { data, error } = await c.auth.signInWithPassword({ email: u.email, password: u.password }); if (error) throw new Error(error.message); return data.session.access_token; }
const api = (path, token, opts = {}) => fetch(`${BASE}${path}`, { ...opts, headers: { ...(opts.headers || {}), ...(token ? { authorization: `Bearer ${token}` } : {}) } });

async function main() {
  try {
    aId = await mkUser(A); bId = await mkUser(B);
    const aTok = await tokenFor(A); const bTok = await tokenFor(B);

    // unauthenticated -> 401
    const anon = await api("/api/ai-key", null);
    check("unauthenticated GET is 401", anon.status === 401, `status=${anon.status}`);

    // A: initially not configured
    let r = await (await api("/api/ai-key", aTok)).json();
    check("A starts unconfigured", r.configured === false);

    // A: save key
    r = await (await api("/api/ai-key", aTok, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: A_KEY }) })).json();
    check("A save returns configured + last4 (no full key)", r.configured === true && r.last4 === "1234" && !JSON.stringify(r).includes("SECRETKEY"), JSON.stringify(r));

    // DB holds ciphertext, not plaintext
    const row = (await admin.from("user_api_keys").select("ciphertext,iv,auth_tag,last4").eq("user_id", aId).maybeSingle()).data;
    check("DB row exists with ciphertext (not plaintext)", !!row && !row.ciphertext.includes("SECRETKEY") && !row.ciphertext.includes(A_KEY) && row.last4 === "1234", row ? `cipher≠plain` : "no row");

    // GET A: masked, never full key
    const aGetText = await (await api("/api/ai-key", aTok)).text();
    check("A GET is masked, no full key in response", aGetText.includes("1234") && !aGetText.includes("SECRETKEY"));

    // B cannot see A's key (isolation): B's own status is unconfigured
    const bGet = await (await api("/api/ai-key", bTok)).json();
    check("B cannot see A's key (B unconfigured)", bGet.configured === false);

    // B saves its own; A still sees only its own
    await api("/api/ai-key", bTok, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: "nvapi-BBBB-0000-9999" }) });
    const aStill = await (await api("/api/ai-key", aTok)).json();
    check("A still sees only its own key after B saves", aStill.last4 === "1234");
    const bRow = (await admin.from("user_api_keys").select("last4").eq("user_id", bId).maybeSingle()).data;
    check("B's row is separate", bRow?.last4 === "9999");

    // A deletes
    const del = await (await api("/api/ai-key", aTok, { method: "DELETE" })).json();
    check("A delete -> unconfigured", del.configured === false);
    const goneRow = (await admin.from("user_api_keys").select("user_id").eq("user_id", aId).maybeSingle()).data;
    check("A's row removed from DB", !goneRow);
  } finally {
    for (const id of [aId, bId]) if (id) await admin.auth.admin.deleteUser(id);
    console.log("cleanup: test accounts deleted");
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n==== ${results.length - failed.length}/${results.length} BYOK e2e checks passed ====`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error("error:", e.message); process.exit(1); });
