// Deterministic tests for meal scheduling + portion scaling.
// Run: npm run test:schedule
import { slotForHour, nextSlotFor, scalePortion, readSchedule, DEFAULT_SCHEDULE } from "@/lib/schedule";

let fail = 0;
function eq(actual: any, expected: any, msg: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}${ok ? "" : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
  if (!ok) fail++;
}

console.log("=== meal scheduling ===");
// default windows: breakfast 5-11, lunch 11-16, snack 16-19, dinner 19-5
eq(slotForHour(7), "breakfast", "7am -> breakfast");
eq(slotForHour(13), "lunch", "1pm -> lunch");
eq(slotForHour(17), "snack", "5pm -> snack");
eq(slotForHour(20), "dinner", "8pm -> dinner");
eq(slotForHour(23), "dinner", "11pm -> dinner");
eq(slotForHour(2), "dinner", "2am (overnight) -> dinner");
eq(slotForHour(11), "lunch", "boundary 11am -> lunch");
eq(slotForHour(5), "breakfast", "boundary 5am -> breakfast");

console.log("=== next-meal mapping (only one upcoming meal) ===");
eq(nextSlotFor("breakfast"), "lunch", "breakfast -> prep lunch");
eq(nextSlotFor("lunch"), "dinner", "lunch -> prep dinner");
eq(nextSlotFor("snack"), "dinner", "snack -> prep dinner");
eq(nextSlotFor("dinner"), "breakfast", "dinner -> prep tomorrow breakfast");

console.log("=== custom schedule overrides defaults (night-shift) ===");
const nightShift = { breakfast: 13, lunch: 18, snack: 22, dinner: 2 };
eq(slotForHour(14, nightShift), "breakfast", "night-shift 2pm -> breakfast");
eq(slotForHour(23, nightShift), "snack", "night-shift 11pm -> snack");
eq(slotForHour(4, nightShift), "dinner", "night-shift 4am -> dinner");

console.log("=== portion scaling across servings ===");
eq(scalePortion("1 cup cooked", 1), "1 cup cooked", "1 person unchanged");
eq(scalePortion("1 cup cooked", 2), "2 cup cooked", "rice x2");
eq(scalePortion("2 pieces", 3), "6 pieces", "pieces x3");
eq(scalePortion("2–3 tbsp", 2), "4–6 tbsp", "range x2");
eq(scalePortion("1 small bowl", 4), "4 small bowl", "bowl x4");
eq(scalePortion("1 serving", 2), "2 serving", "serving x2");

console.log("=== schedule normalisation ===");
eq(readSchedule(null), DEFAULT_SCHEDULE, "null -> defaults");
eq(readSchedule({ breakfast: 8, lunch: 13, snack: 17, dinner: 20 }), { breakfast: 8, lunch: 13, snack: 17, dinner: 20 }, "valid passes through");
eq(readSchedule({ breakfast: 99 }).breakfast, DEFAULT_SCHEDULE.breakfast, "out-of-range falls back");

console.log(`\n${fail === 0 ? "ALL PASS" : fail + " FAILED"}`);
process.exit(fail === 0 ? 0 : 1);
