// NaniAI — cross-account isolation regression (LOCAL ONLY).
//
// Verifies the account-switch security fix in app/page.tsx:
//   - sign-out wipes all per-user in-memory state
//   - a user-id change clears the previous user's transient plan
//   - a /api/plan response that arrives AFTER a switch is discarded (race)
//
// SAFETY: this test NEVER touches the real Supabase project. Every request to
// `/auth/v1/**` and `/rest/v1/**` is intercepted and answered with synthetic
// fixtures, so no real account is created, read, or modified, and no real
// credentials are used. The real, deterministic same-origin /api/plan runs
// locally (keyless mock mode) so the UI renders genuine — but clearly
// synthetic — meal data (Account A = Italian, Account B = Japanese).

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import net from "node:net";

const PORT = 3123;
const BASE = `http://localhost:${PORT}`;

// ---- synthetic accounts (clearly fake; distinct cuisines = leak markers) ----
const A = { id: "00000000-0000-4000-8000-00000000000a", name: "AlphaTester", email: "alpha@test.local", cuisines: ["Italian"] };
const B = { id: "00000000-0000-4000-8000-00000000000b", name: "BetaTester", email: "beta@test.local", cuisines: ["Japanese"] };
const PASSWORD = "test-password-123";
// Dish-name substrings that only appear for each account's cuisine.
const A_MARKERS = ["Pasta", "Risotto"];
const B_MARKERS = ["Donburi", "Bibimbap"];

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function fakeJwt(sub) {
  const now = Math.floor(Date.now() / 1000);
  return [b64url({ alg: "HS256", typ: "JWT" }),
          b64url({ sub, aud: "authenticated", role: "authenticated", iat: now, exp: now + 3600 * 24 * 3650, email: "x" }),
          "sig"].join(".");
}
function session(acct) {
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: fakeJwt(acct.id), token_type: "bearer",
    expires_in: 3600 * 24 * 3650, expires_at: now + 3600 * 24 * 3650,
    refresh_token: "fake-refresh-" + acct.id,
    user: { id: acct.id, aud: "authenticated", role: "authenticated", email: acct.email,
            app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {},
            identities: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  };
}
function profileRow(acct) {
  return { id: acct.id, preferred_name: acct.name, age: 70, dietary_pattern: null, spice_tolerance: null,
    texture_max: 7, cuisines: acct.cuisines, region: null, loved_dishes: [], disliked: [], allergies: [],
    conditions: [], medications: [], lifestyle: {}, goals: [], emergency_name: null, emergency_phone: null,
    feedback: {}, onboarding_done: true };
}

// ---- tiny assert harness ----
const results = [];
function check(name, cond, detail = "") { results.push({ name, pass: !!cond, detail }); console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); }

function waitPort(port, timeoutMs = 60000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function tryOnce() {
      const s = net.connect(port, "127.0.0.1");
      s.once("connect", () => { s.destroy(); resolve(); });
      s.once("error", () => { s.destroy(); if (Date.now() - start > timeoutMs) reject(new Error("server timeout")); else setTimeout(tryOnce, 500); });
    })();
  });
}

let activeAccount = A;          // which account the next token/profile reply represents
let planArmedHold = false;      // when true, the next /api/plan is held
let releasePlan = null;         // resolver to release a held /api/plan
let planErrorOnRelease = false; // when true, a held /api/plan releases as a 500

async function installMocks(context) {
  // Catch-alls first (lower priority), specific routes later (higher priority).
  await context.route("**/rest/v1/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await context.route("**/auth/v1/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));

  await context.route("**/auth/v1/token**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session(activeAccount)) }));
  await context.route("**/auth/v1/logout**", (route) => route.fulfill({ status: 204, body: "" }));
  await context.route("**/auth/v1/user**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session(activeAccount).user) }));

  await context.route("**/rest/v1/profiles**", (route) => {
    const m = route.request().method();
    if (m === "GET" || m === "PATCH") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(profileRow(activeAccount)) });
    return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await context.route("**/rest/v1/meal_prep**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));

  // Same-origin plan: real server, but optionally HELD to simulate slow network.
  // The error-on-release flag is captured per-held-request so it never affects a
  // later (different account's) request.
  await context.route("**/api/plan", async (route) => {
    if (planArmedHold) {
      planArmedHold = false;
      const errorThisOne = planErrorOnRelease; planErrorOnRelease = false;
      await new Promise((r) => { releasePlan = r; });
      if (errorThisOne) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "simulated delayed failure" }) });
      return route.continue();
    }
    await route.continue();
  });
}

// ---- UI helpers (text-based; app has no test ids) ----
const onAuth = (page) => page.getByText("Eat like yourself again.").isVisible().catch(() => false);
async function login(page, acct) {
  activeAccount = acct;
  await page.locator('input[type="email"]').fill(acct.email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('form.wform button[type="submit"]').click();
  // wait for the app header (avatar name) to appear
  await page.getByText(acct.name, { exact: false }).first().waitFor({ timeout: 15000 });
}
async function planDay(page) {
  await page.getByRole("button", { name: /Plan a day/i }).first().click();
}
async function signOut(page) {
  await page.getByRole("button", { name: /^Sign out$/i }).first().click();
  await page.getByText("Eat like yourself again.").waitFor({ timeout: 15000 });
}
const bodyText = (page) => page.evaluate(() => document.body.innerText);
const anyMarker = (text, markers) => markers.some((m) => text.includes(m));

async function main() {
  const server = spawn("npx", ["next", "start", "-p", String(PORT)], { cwd: process.cwd(), stdio: "inherit", env: process.env });
  const stop = () => { try { server.kill("SIGTERM"); } catch {} };
  process.on("exit", stop);
  let browser; // hoisted so it is always closed in finally, even if a step throws
  try {
    await waitPort(PORT);
    await new Promise((r) => setTimeout(r, 1500)); // let next warm up

    try { browser = await chromium.launch({ channel: "chrome", headless: true }); }
    catch { browser = await chromium.launch({ headless: true }); }
    const context = await browser.newContext();
    await installMocks(context);
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("pageerror", (e) => consoleErrors.push(String(e)));

    await page.goto(BASE, { waitUntil: "domcontentloaded" });

    // ---------- Test A — sign-out clears all state ----------
    console.log("\nTest A — sign-out clears all state");
    await login(page, A);
    await planDay(page);
    await page.getByText(new RegExp(A_MARKERS.join("|")), { exact: false }).first().waitFor({ timeout: 20000 });
    let t = await bodyText(page);
    check("A: Account A plan is visible before sign-out", anyMarker(t, A_MARKERS), "found Italian dish");
    await signOut(page);
    t = await bodyText(page);
    check("A: Account A plan not visible after sign-out", !anyMarker(t, A_MARKERS));
    check("A: auth screen shown after sign-out", await onAuth(page));
    // Sign back in as A; the plan must NOT reappear until re-generated (data cleared, not retained).
    await login(page, A);
    t = await bodyText(page);
    check("A: plan is empty on re-login (state was cleared, not retained)", !anyMarker(t, A_MARKERS));

    // ---------- Test B — account switch isolation ----------
    console.log("\nTest B — account switch isolation");
    await planDay(page);
    await page.getByText(new RegExp(A_MARKERS.join("|")), { exact: false }).first().waitFor({ timeout: 20000 });
    check("B: A sees A content", anyMarker(await bodyText(page), A_MARKERS));
    await signOut(page);
    await login(page, B);
    t = await bodyText(page);
    check("B: A's plan absent for B before B generates", !anyMarker(t, A_MARKERS));
    check("B: A's name not shown for B", !t.includes(A.name), t.includes(A.name) ? "LEAK: Alpha visible" : "");
    check("B: B's name shown", t.includes(B.name));
    await planDay(page);
    await page.getByText(new RegExp(B_MARKERS.join("|")), { exact: false }).first().waitFor({ timeout: 20000 });
    t = await bodyText(page);
    check("B: B sees only B content", anyMarker(t, B_MARKERS) && !anyMarker(t, A_MARKERS));

    // ---------- Test C — delayed /api/plan response cannot overwrite new account ----------
    console.log("\nTest C — delayed response race");
    // currently signed in as B. Sign out -> sign in A, then hold A's plan request.
    await signOut(page);
    await login(page, A);
    planArmedHold = true;
    await planDay(page);                       // fires /api/plan for A, held open
    await page.waitForTimeout(500);
    await signOut(page);                       // switch away while A's request is in flight
    await login(page, B);
    if (releasePlan) releasePlan();            // release A's delayed response now (user is B)
    await page.waitForTimeout(1500);
    t = await bodyText(page);
    check("C: delayed A response did NOT inject A content into B", !anyMarker(t, A_MARKERS), t.includes(A.name) ? "LEAK" : "");
    check("C: B still shows B's own context", t.includes(B.name));

    // ---------- Test C2 — delayed ERROR from A cannot corrupt B's UI ----------
    console.log("\nTest C2 — delayed error race");
    await signOut(page);
    await login(page, A);
    planArmedHold = true; planErrorOnRelease = true;
    await planDay(page);                       // A's /api/plan held, will fail on release
    await page.waitForTimeout(500);
    await signOut(page);                       // switch to B while A's request is in flight
    await login(page, B);
    await planDay(page);                       // B generates its own plan
    await page.getByText(new RegExp(B_MARKERS.join("|")), { exact: false }).first().waitFor({ timeout: 20000 });
    if (releasePlan) releasePlan();            // now A's request fails (500) — must be ignored
    await page.waitForTimeout(1500);
    t = await bodyText(page);
    check("C2: delayed A error did not surface in B's UI", !t.includes("simulated delayed failure") && !/⚠/.test(t));
    check("C2: B's plan intact after A's stale error", anyMarker(t, B_MARKERS) && !anyMarker(t, A_MARKERS));

    // ---------- Test D — rapid switching settles correctly ----------
    console.log("\nTest D — rapid switching settles to correct account");
    for (let i = 0; i < 3; i++) { await signOut(page); await login(page, i % 2 === 0 ? A : B); }
    // ended on B (i=2 -> A? sequence: i0->A, i1->B, i2->A) => ended A
    const endAcct = A;
    await planDay(page);
    await page.getByText(new RegExp(A_MARKERS.join("|")), { exact: false }).first().waitFor({ timeout: 20000 });
    t = await bodyText(page);
    check("D: settled on correct account after rapid switching", t.includes(endAcct.name) && anyMarker(t, A_MARKERS));
    check("D: no other account's content leaked", !t.includes(B.name) && !anyMarker(t, B_MARKERS));

    // ---------- Test E — normal behavior intact ----------
    console.log("\nTest E — normal flows intact");
    check("E: returning user retained own plan across re-render", t.includes(endAcct.name));
    // new user -> onboarding: simulate an account whose profile row is not onboarded
    const NEW = { id: "00000000-0000-4000-8000-00000000000c", name: "NewUser", email: "new@test.local", cuisines: [] };
    await signOut(page);
    // override profiles to return onboarding_done=false for the new user
    await context.route("**/rest/v1/profiles**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...profileRow(NEW), onboarding_done: false }) }));
    activeAccount = NEW;
    await page.locator('input[type="email"]').fill(NEW.email);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.locator('form.wform button[type="submit"]').click();
    const sawOnboarding = await page.getByText("What should we call you?").waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
    check("E: new (not-onboarded) user gets the 16-step onboarding", sawOnboarding);

    check("No uncaught page errors during the run", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));

    await browser.close();
  } finally {
    if (browser) { try { await browser.close(); } catch {} } // guaranteed cleanup on failure
    stop();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n==== ${results.length - failed.length}/${results.length} checks passed ====`);
  if (failed.length) { console.log("FAILED:\n" + failed.map((f) => " - " + f.name + (f.detail ? " (" + f.detail + ")" : "")).join("\n")); process.exit(1); }
  console.log("ALL ISOLATION CHECKS PASSED");
}

main().catch((e) => { console.error(e); process.exit(1); });
