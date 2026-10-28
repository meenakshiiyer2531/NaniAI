import { chromium } from "playwright";
import { setTimeout as s } from "node:timers/promises";
const b = await chromium.launch({ channel: "chrome", headless: true });
const p = await (await b.newContext({ viewport: { width: 1200, height: 1100 } })).newPage();
await p.goto("http://localhost:3100/recipes/curd_rice?sides=sambar,avial&servings=2", { waitUntil: "networkidle" });
await s(1200);
await p.screenshot({ path: "/tmp/naniai-recipe.png" });
console.log("plate rows:", await p.locator(".plate-row").count(), "| title:", await p.locator(".brand h1").first().innerText());
await b.close();
