// NaniAI — STAGING-ONLY Supabase RLS verification.
//
// Proves, through REAL authenticated requests (not by reading SQL), that Row
// Level Security isolates users on a DEDICATED STAGING project. It creates two
// disposable accounts, signs in as each, and asserts that one user cannot read,
// update, or delete the other's rows, that unauthenticated access is blocked,
// then deletes both accounts (cascade removes their data).
//
// SAFETY GUARDS:
//   * Requires STAGING_* env vars — it will NOT read your production keys.
//   * Refuses to run if STAGING_SUPABASE_URL === NEXT_PUBLIC_SUPABASE_URL
//     (i.e. if it is pointed at production).
//   * Only touches the two throwaway accounts it creates.
//
// Run (against a staging project only):
//   node --env-file=.env.staging scripts/verify-rls-staging.mjs
//
// Required in .env.staging:
//   STAGING_SUPABASE_URL=...
//   STAGING_SUPABASE_ANON_KEY=...
//   STAGING_SUPABASE_SERVICE_ROLE_KEY=...

import { createClient } from "@supabase/supabase-js";

const URL = process.env.STAGING_SUPABASE_URL;
const ANON = process.env.STAGING_SUPABASE_ANON_KEY;
const SERVICE = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY;
const PROD_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

if (!URL || !ANON || !SERVICE) {
  console.error("Missing STAGING_SUPABASE_URL / STAGING_SUPABASE_ANON_KEY / STAGING_SUPABASE_SERVICE_ROLE_KEY.");
  console.error("This script runs ONLY against a dedicated staging project. See STAGING.md.");
  process.exit(2);
}
if (PROD_URL && URL === PROD_URL) {
  console.error("REFUSING TO RUN: STAGING_SUPABASE_URL equals the production URL. Use a separate staging project.");
  process.exit(2);
}

const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const anonClient = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });

const results = [];
const check = (name, pass, detail = "") => { results.push({ name, pass: !!pass }); console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };

const stamp = Date.now();
const A = { email: `rls-a-${stamp}@staging.test`, password: "staging-pass-A-123" };
const B = { email: `rls-b-${stamp}@staging.test`, password: "staging-pass-B-123" };
let aId, bId;

async function makeUser(u) {
  const { data, error } = await admin.auth.admin.createUser({ email: u.email, password: u.password, email_confirm: true });
  if (error) throw new Error("createUser: " + error.message);
  return data.user.id;
}
async function signIn(u) {
  const c = anonClient();
  const { data, error } = await c.auth.signInWithPassword({ email: u.email, password: u.password });
  if (error) throw new Error("signIn: " + error.message);
  return c; // authenticated client (session persisted in memory)
}

async function main() {
  try {
    aId = await makeUser(A);
    bId = await makeUser(B);
    console.log(`Created staging users A=${aId} B=${bId}`);

    const aClient = await signIn(A);
    const bClient = await signIn(B);

    // Each profile row is auto-created by the app on first load; here create explicitly.
    await aClient.from("profiles").upsert({ id: aId, preferred_name: "StagingA", onboarding_done: true });
    await bClient.from("profiles").upsert({ id: bId, preferred_name: "StagingB", onboarding_done: true });
    await aClient.from("meal_prep").upsert({ user_id: aId, day: "2026-01-01", slot: "lunch", prepared: true }, { onConflict: "user_id,day,slot" });

    // 4. Each account reads its OWN rows.
    const aSelf = await aClient.from("profiles").select("*").eq("id", aId).maybeSingle();
    check("A can read its own profile", aSelf.data && aSelf.data.id === aId);
    const aPrep = await aClient.from("meal_prep").select("*").eq("user_id", aId);
    check("A can read its own meal_prep", Array.isArray(aPrep.data) && aPrep.data.length === 1);

    // 5. A cannot SELECT B's rows (RLS filters them out -> empty, not error).
    const aReadB = await aClient.from("profiles").select("*").eq("id", bId);
    check("A cannot read B's profile", Array.isArray(aReadB.data) && aReadB.data.length === 0, `got ${aReadB.data?.length ?? "err"}`);

    // A cannot UPDATE B's row (0 rows affected / not visible).
    const aUpdB = await aClient.from("profiles").update({ preferred_name: "HACKED" }).eq("id", bId).select("*");
    check("A cannot update B's profile", !aUpdB.data || aUpdB.data.length === 0);
    const bCheck = await bClient.from("profiles").select("preferred_name").eq("id", bId).maybeSingle();
    check("B's profile unchanged after A's update attempt", bCheck.data && bCheck.data.preferred_name === "StagingB", bCheck.data?.preferred_name);

    // A cannot DELETE B's row.
    const aDelB = await aClient.from("profiles").delete().eq("id", bId).select("*");
    check("A cannot delete B's profile", !aDelB.data || aDelB.data.length === 0);
    const bStill = await bClient.from("profiles").select("id").eq("id", bId).maybeSingle();
    check("B's profile still exists after A's delete attempt", !!bStill.data);

    // 6. Unauthenticated access is blocked by RLS (no auth.uid()).
    const noauth = anonClient();
    const anonRead = await noauth.from("profiles").select("*");
    check("unauthenticated read returns no rows", Array.isArray(anonRead.data) && anonRead.data.length === 0, `got ${anonRead.data?.length ?? "err"}`);
    const anonWrite = await noauth.from("profiles").insert({ id: aId, preferred_name: "anon" }).select("*");
    check("unauthenticated write is rejected", !!anonWrite.error || !anonWrite.data || anonWrite.data.length === 0);
  } finally {
    // 7. Cleanup — delete both users (cascade removes their profiles + meal_prep).
    for (const id of [aId, bId]) if (id) { const { error } = await admin.auth.admin.deleteUser(id); console.log(`cleanup ${id}: ${error ? "FAILED " + error.message : "deleted"}`); }
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n==== ${results.length - failed.length}/${results.length} RLS checks passed ====`);
  if (failed.length) process.exit(1);
  console.log("ALL STAGING RLS CHECKS PASSED");
}

main().catch((e) => { console.error(e); process.exit(1); });
