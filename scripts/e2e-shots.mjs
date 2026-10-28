// Drives the REAL app in your installed Chrome (via Playwright channel) and
// screenshots each actual screen: login, onboarding steps, dashboard, meal plan,
// profile page, emergency. Not a refactor-and-declare — real pixels.
import { chromium } from "playwright";
import { setTimeout as sleep } from "node:timers/promises";

const BASE = process.env.BASE || "http://localhost:3100";
const OUT = "/tmp";
const email = `shot-${Date.now()}@example.com`;
const pass = "testpass12345";

const b = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await b.newContext({ viewport: { width: 1200, height: 1000 } });
const p = await ctx.newPage();
const shot = async (name) => { await p.screenshot({ path: `${OUT}/naniai-${name}.png` }); console.log("shot", name); };

try {
  await p.goto(BASE, { waitUntil: "networkidle" });
  await sleep(1500);
  await shot("01-login");

  // sign up
  await p.fill('input[type="email"]', email);
  await p.fill('input[type="password"]', pass);
  await p.getByRole("button", { name: /create account/i }).click();

  // onboarding — generic: fill the name step, then click through all steps
  await p.waitForSelector(".ob-card", { timeout: 15000 });
  await sleep(700);
  await shot("02-onboarding-name");
  await p.fill(".ob-input", "Lakshmi");
  for (let i = 0; i < 20; i++) {
    const finish = await p.getByRole("button", { name: /finish/i }).count();
    if (finish) { await shot(`05-onboarding-last`); await p.getByRole("button", { name: /finish/i }).click(); break; }
    const cont = p.getByRole("button", { name: /continue/i });
    if (await cont.count()) await cont.first().click();
    else await p.getByRole("button", { name: /skip/i }).first().click();
    await sleep(350);
    if (i === 2) await shot("03-onboarding-mid");
  }

  // dashboard
  await p.waitForSelector(".greeting", { timeout: 15000 });
  await sleep(800);
  await shot("06-dashboard");
  await p.getByRole("button", { name: /plan a day/i }).click();
  await p.waitForSelector(".day-grid .meal", { timeout: 30000 });
  await sleep(1000);
  await shot("07-meal-plan");
  // expand first meal
  await p.locator(".meal-top").first().click(); await sleep(600);
  await shot("07b-meal-expanded");

  // profile page
  await p.getByRole("button", { name: /my profile/i }).click();
  await p.waitForSelector(".profile-grid", { timeout: 10000 });
  await sleep(600);
  await shot("08-profile");

  // back + emergency
  await p.getByRole("button", { name: /back/i }).first().click();
  await p.waitForSelector(".greeting", { timeout: 10000 });
  await p.getByRole("button", { name: /emergency/i }).first().click();
  await p.waitForSelector(".emg-screen", { timeout: 10000 });
  await sleep(1000);
  await shot("09-emergency");
  await p.getByRole("button", { name: /^close$/i }).click(); await sleep(400);

  // chat
  await p.locator(".chat-fab").click();
  await sleep(700);
  await shot("10-chat");
  await p.locator(".chat-fab").click(); await sleep(300);

  // mobile dashboard
  await p.setViewportSize({ width: 390, height: 844 });
  await sleep(600);
  await shot("11-mobile");

  console.log("DONE");
} catch (e) {
  console.error("E2E error:", e.message);
  await shot("ERROR");
} finally {
  await b.close();
}
