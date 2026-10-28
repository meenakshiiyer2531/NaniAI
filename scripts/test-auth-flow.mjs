// End-to-end test of the REAL client data path (same anon key + user session the
// browser uses). Verifies: signup, login, session, profile CRUD persistence, and
// — critically — Row Level Security cross-user isolation. Not a pixel test.
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SIGNUP = "http://localhost:3100/api/auth/signup";
const pass = "testpass12345";
const ts = Date.now();
const emailA = `flow-a-${ts}@example.com`;
const emailB = `flow-b-${ts}@example.com`;

let failures = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) failures++; };

async function signup(email) {
  const r = await fetch(SIGNUP, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: pass }) });
  return r.ok;
}
function client() { return createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } }); }

const sa = await signup(emailA);
const sb = await signup(emailB);
ok(sa && sb, "signup: two users created via server route");

// --- user A signs in ---
const A = client();
const { data: aAuth, error: aErr } = await A.auth.signInWithPassword({ email: emailA, password: pass });
ok(!aErr && aAuth.session, "login A: session issued");
const aId = aAuth.user.id;

// wrong password rejected
const Wp = client();
const { error: wpErr } = await Wp.auth.signInWithPassword({ email: emailA, password: "wrongpass999" });
ok(!!wpErr, "login A with wrong password rejected");

// A reads own profile (trigger-provisioned)
const { data: aProf } = await A.from("profiles").select("*").eq("id", aId).maybeSingle();
ok(aProf && aProf.id === aId, "A sees own auto-provisioned profile row");

// A updates own profile (CRUD persistence)
const { error: upErr } = await A.from("profiles").update({
  preferred_name: "Lakshmi", age: 68, cuisines: ["South Indian", "Chettinad"],
  region: "Tamil Nadu", loved_dishes: ["dosa", "pongal"], allergies: ["peanut"],
  conditions: ["type_2_diabetes"], onboarding_done: true,
}).eq("id", aId);
ok(!upErr, "A updates own profile");
const { data: aProf2 } = await A.from("profiles").select("*").eq("id", aId).maybeSingle();
ok(aProf2?.preferred_name === "Lakshmi" && aProf2?.age === 68 && aProf2?.onboarding_done === true, "A profile changes persisted");
ok(Array.isArray(aProf2?.cuisines) && aProf2.cuisines.includes("Chettinad"), "A cuisines persisted (multi, free)");

// --- user B signs in ---
const B = client();
const { data: bAuth } = await B.auth.signInWithPassword({ email: emailB, password: pass });
const bId = bAuth.user.id;
await B.from("profiles").update({ preferred_name: "Ahmed" }).eq("id", bId);

// RLS isolation: A selecting ALL profiles sees ONLY A's row
const { data: aAll } = await A.from("profiles").select("id");
ok(aAll && aAll.length === 1 && aAll[0].id === aId, `RLS: A sees only own row (got ${aAll?.length})`);

// RLS: A cannot read B's row by id
const { data: aReadB } = await A.from("profiles").select("*").eq("id", bId).maybeSingle();
ok(aReadB === null, "RLS: A cannot read B's profile by id");

// RLS: A cannot update B's row (0 rows affected, no error)
const { data: aWriteB } = await A.from("profiles").update({ preferred_name: "HACKED" }).eq("id", bId).select("id");
ok(!aWriteB || aWriteB.length === 0, "RLS: A cannot update B's profile");
const { data: bCheck } = await B.from("profiles").select("preferred_name").eq("id", bId).maybeSingle();
ok(bCheck?.preferred_name === "Ahmed", "RLS: B's data unchanged by A's attempt");

// logout
await A.auth.signOut();
const { data: aAfter } = await A.from("profiles").select("id");
ok(!aAfter || aAfter.length === 0, "after logout, no authed rows visible");

console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
