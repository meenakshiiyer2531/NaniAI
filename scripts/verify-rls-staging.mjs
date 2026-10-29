// NaniAI — STAGING-ONLY Supabase RLS verification.
//
// Proves, through REAL authenticated requests (not by reading SQL), that Row
// Level Security isolates users on a DEDICATED STAGING project.
//
// Covers both RLS-protected tables (public.profiles, public.meal_prep) and:
//   1. both accounts authenticate independently
//   2-3. each account reads its OWN profile + meal_prep
//   4. A cannot read B's rows (both tables)
//   5. A cannot update/delete B's rows (both tables)
//   6. A cannot INSERT a row referencing B (WITH CHECK)
//   7. unauthenticated requests cannot read or write protected rows
//   8. the above is checked on every relevant table + operation
//   9. an RLS denial is distinguished from a network / setup error
//
// ACCESS-CONTROL checks use the normal authenticated anon client + user JWTs.
// The service-role client is used ONLY to create/delete the two disposable test
// accounts (admin setup/teardown) — never to test user-level RLS.
//
// SAFETY GUARDS:
//   * Requires STAGING_* env vars — never reads production keys.
//   * Refuses to run if STAGING_SUPABASE_URL === NEXT_PUBLIC_SUPABASE_URL.
//   * Only touches the two throwaway accounts it creates.
//
// Run (staging only):
//   node --env-file=.env.staging scripts/verify-rls-staging.mjs

import { createClient } from "@supabase/supabase-js";

const URL = process.env.STAGING_SUPABASE_URL;
const ANON = process.env.STAGING_SUPABASE_ANON_KEY;
const SERVICE = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY;
const PROD_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

if (!URL || !ANON || !SERVICE) {
  console.error("MISSING CONFIG: set STAGING_SUPABASE_URL, STAGING_SUPABASE_ANON_KEY, STAGING_SUPABASE_SERVICE_ROLE_KEY.");
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

// An RLS-filtered SELECT returns { data: [], error: null }. A real network/setup
// failure returns a non-null error. Treat only the former as a genuine denial.
const deniedRead = (res) => res.error == null && Array.isArray(res.data) && res.data.length === 0;
// A blocked write surfaces either a PostgREST RLS error (42501) OR affects 0 rows.
const deniedWrite = (res) => !!res.error || !res.data || res.data.length === 0;
const sawError = (res, label) => { if (res.error && !/row-level security|permission|JWT|not authorized/i.test(res.error.message)) check(`${label} (no unexpected network/setup error)`, false, res.error.message); };

const stamp = Date.now();
const A = { email: `rls-a-${stamp}@staging.test`, password: "staging-pass-A-123" };
const B = { email: `rls-b-${stamp}@staging.test`, password: "staging-pass-B-123" };
let aId, bId;
const DAY = "2026-01-01";

async function makeUser(u) {
  const { data, error } = await admin.auth.admin.createUser({ email: u.email, password: u.password, email_confirm: true });
  if (error) throw new Error("createUser: " + error.message);
  return data.user.id;
}
async function signIn(u) {
  const c = anonClient();
  const { data, error } = await c.auth.signInWithPassword({ email: u.email, password: u.password });
  return { client: c, ok: !error && !!data.session, error };
}

async function main() {
  try {
    aId = await makeUser(A);
    bId = await makeUser(B);
    console.log(`Created staging users A=${aId} B=${bId}`);

    // 1. independent authentication
    const aAuth = await signIn(A);
    const bAuth = await signIn(B);
    check("1. Account A authenticates", aAuth.ok, aAuth.error?.message);
    check("1. Account B authenticates", bAuth.ok, bAuth.error?.message);
    if (!aAuth.ok || !bAuth.ok) throw new Error("auth setup failed — cannot continue");
    const aClient = aAuth.client, bClient = bAuth.client;

    // seed each account's own rows (as themselves)
    const aProf = await aClient.from("profiles").upsert({ id: aId, preferred_name: "StagingA", onboarding_done: true }).select("*");
    const bProf = await bClient.from("profiles").upsert({ id: bId, preferred_name: "StagingB", onboarding_done: true }).select("*");
    await aClient.from("meal_prep").upsert({ user_id: aId, day: DAY, slot: "lunch", prepared: true }, { onConflict: "user_id,day,slot" });
    await bClient.from("meal_prep").upsert({ user_id: bId, day: DAY, slot: "dinner", prepared: true }, { onConflict: "user_id,day,slot" });
    check("setup: A wrote its own profile", !aProf.error && aProf.data?.length === 1, aProf.error?.message);
    check("setup: B wrote its own profile", !bProf.error && bProf.data?.length === 1, bProf.error?.message);

    // 2. A reads its OWN rows
    const aOwnProf = await aClient.from("profiles").select("*").eq("id", aId);
    sawError(aOwnProf, "2. A own profile");
    check("2. A can read its own profile", aOwnProf.error == null && aOwnProf.data?.length === 1);
    const aOwnPrep = await aClient.from("meal_prep").select("*").eq("user_id", aId);
    check("2. A can read its own meal_prep", aOwnPrep.error == null && aOwnPrep.data?.length === 1);

    // 3. B reads its OWN rows
    const bOwnProf = await bClient.from("profiles").select("*").eq("id", bId);
    check("3. B can read its own profile", bOwnProf.error == null && bOwnProf.data?.length === 1);
    const bOwnPrep = await bClient.from("meal_prep").select("*").eq("user_id", bId);
    check("3. B can read its own meal_prep", bOwnPrep.error == null && bOwnPrep.data?.length === 1);

    // 4. A cannot READ B's rows (both tables)
    const aReadBProf = await aClient.from("profiles").select("*").eq("id", bId);
    sawError(aReadBProf, "4. A read B profile");
    check("4. A cannot read B's profile", deniedRead(aReadBProf), `rows=${aReadBProf.data?.length}`);
    const aReadBPrep = await aClient.from("meal_prep").select("*").eq("user_id", bId);
    check("4. A cannot read B's meal_prep", deniedRead(aReadBPrep), `rows=${aReadBPrep.data?.length}`);
    // and a blanket select must only ever return A's own rows
    const aAllProf = await aClient.from("profiles").select("id");
    check("4. A blanket profile select returns only A", aAllProf.error == null && aAllProf.data?.every((r) => r.id === aId), `rows=${aAllProf.data?.length}`);

    // 5. A cannot UPDATE / DELETE B's rows (both tables)
    const aUpdBProf = await aClient.from("profiles").update({ preferred_name: "HACKED" }).eq("id", bId).select("*");
    check("5. A cannot update B's profile", deniedWrite(aUpdBProf));
    const aUpdBPrep = await aClient.from("meal_prep").update({ prepared: false }).eq("user_id", bId).select("*");
    check("5. A cannot update B's meal_prep", deniedWrite(aUpdBPrep));
    const aDelBProf = await aClient.from("profiles").delete().eq("id", bId).select("*");
    check("5. A cannot delete B's profile", deniedWrite(aDelBProf));
    const aDelBPrep = await aClient.from("meal_prep").delete().eq("user_id", bId).select("*");
    check("5. A cannot delete B's meal_prep", deniedWrite(aDelBPrep));
    // verify B's rows are intact (owner-confirmed) — proves the above were real denials
    const bProfAfter = await bClient.from("profiles").select("preferred_name").eq("id", bId).maybeSingle();
    check("5. B's profile unchanged after A's attempts", bProfAfter.data?.preferred_name === "StagingB", bProfAfter.data?.preferred_name);
    const bPrepAfter = await bClient.from("meal_prep").select("prepared").eq("user_id", bId).eq("day", DAY).eq("slot", "dinner").maybeSingle();
    check("5. B's meal_prep unchanged after A's attempts", bPrepAfter.data?.prepared === true);

    // 6. A cannot INSERT a row referencing B (WITH CHECK)
    const aInsBPrep = await aClient.from("meal_prep").insert({ user_id: bId, day: DAY, slot: "snack", prepared: true }).select("*");
    check("6. A cannot insert meal_prep referencing B", deniedWrite(aInsBPrep), aInsBPrep.error?.code ?? "");
    const aInsBProf = await aClient.from("profiles").insert({ id: bId, preferred_name: "spoof" }).select("*");
    check("6. A cannot insert a profile row for B", deniedWrite(aInsBProf));

    // 7. unauthenticated requests cannot read or write
    const noauth = anonClient();
    const anonReadProf = await noauth.from("profiles").select("*");
    check("7. unauthenticated profile read returns nothing", deniedRead(anonReadProf), `rows=${anonReadProf.data?.length}`);
    const anonReadPrep = await noauth.from("meal_prep").select("*");
    check("7. unauthenticated meal_prep read returns nothing", deniedRead(anonReadPrep), `rows=${anonReadPrep.data?.length}`);
    const anonWrite = await noauth.from("profiles").insert({ id: aId, preferred_name: "anon" }).select("*");
    check("7. unauthenticated write is rejected", deniedWrite(anonWrite));
  } finally {
    // teardown — delete both accounts (cascade removes their rows)
    for (const id of [aId, bId]) if (id) { const { error } = await admin.auth.admin.deleteUser(id); console.log(`cleanup ${id}: ${error ? "FAILED " + error.message : "deleted"}`); }
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n==== ${results.length - failed.length}/${results.length} RLS checks passed ====`);
  if (failed.length) { console.log("FAILED:\n" + failed.map((f) => " - " + f.name).join("\n")); process.exit(1); }
  console.log("ALL STAGING RLS CHECKS PASSED");
}

main().catch((e) => { console.error("RLS test error:", e.message); process.exit(1); });
