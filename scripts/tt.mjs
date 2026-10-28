import { chromium } from "playwright";
import { setTimeout as s } from "node:timers/promises";
const b = await chromium.launch({ channel: "chrome", headless: true });
const p = await (await b.newContext({ viewport: { width: 1200, height: 1000 } })).newPage();
const email = `tt-${Date.now()}@example.com`;
await p.goto("http://localhost:3100", { waitUntil: "networkidle" }); await s(1200);
await p.fill('input[type=email]', email); await p.fill('input[type=password]', "testpass12345");
await p.getByRole("button", { name: /create account/i }).click();
await p.waitForSelector(".ob-card", { timeout: 15000 }); await s(500);
await p.fill(".ob-input", "Tester");
for (let i=0;i<24;i++){ const f=await p.getByRole("button",{name:/finish/i}).count(); if(f){await p.getByRole("button",{name:/finish/i}).click();break;} const c=p.getByRole("button",{name:/continue/i}); if(await c.count())await c.first().click(); else await p.getByRole("button",{name:/skip/i}).first().click(); await s(200);}
await p.waitForSelector(".greeting",{timeout:15000});
await p.getByRole("button",{name:/plan a day/i}).click();
await p.waitForSelector(".day-grid .meal",{timeout:30000}); await s(800);
const tip = p.locator(".section-label .infotip").first();
await tip.hover(); await s(500);
const popCount = await p.locator(".infotip-pop").count();
const popVisible = popCount ? await p.locator(".infotip-pop").first().isVisible() : false;
console.log("infotip-pop count after hover:", popCount, "visible:", popVisible);
if (popCount) {
  const box = await p.locator(".infotip-pop").first().boundingBox();
  console.log("pop box:", JSON.stringify(box));
}
await p.screenshot({ path: "/tmp/naniai-tooltip.png" });
await b.close();
