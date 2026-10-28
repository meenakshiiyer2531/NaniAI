// Pure, deterministic meal-time scheduling + portion scaling.
// No React, no I/O — so it is unit-testable (see lib/eval/schedule-test.ts).

export type Slot = "breakfast" | "lunch" | "snack" | "dinner";

/** Start hour (0–23) of each meal window. Dinner runs from its start through
 *  the night until the next day's breakfast start. */
export interface MealSchedule {
  breakfast: number;
  lunch: number;
  snack: number;
  dinner: number;
}

export const DEFAULT_SCHEDULE: MealSchedule = { breakfast: 5, lunch: 11, snack: 16, dinner: 19 };

/** Which meal is "now" for a given hour + schedule. Works for any ordering,
 *  including overnight / night-shift windows: it picks the meal whose start
 *  most recently passed (smallest forward distance around the 24h clock). */
export function slotForHour(hour: number, s: MealSchedule = DEFAULT_SCHEDULE): Slot {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  const windows: [Slot, number][] = [
    ["breakfast", s.breakfast],
    ["lunch", s.lunch],
    ["snack", s.snack],
    ["dinner", s.dinner],
  ];
  let best: Slot = "dinner";
  let bestDist = Infinity;
  for (const [slot, start] of windows) {
    const dist = (((h - start) % 24) + 24) % 24; // hours since this window began
    if (dist < bestDist) {
      bestDist = dist;
      best = slot;
    }
  }
  return best;
}

const NEXT: Record<Slot, Slot> = { breakfast: "lunch", lunch: "dinner", snack: "dinner", dinner: "breakfast" };
export function nextSlotFor(slot: Slot): Slot {
  return NEXT[slot];
}

/** Scale an approximate portion label by a serving count. Multiplies the leading
 *  number or range; falls back to "label × n" when there is no number. */
export function scalePortion(label: string, n: number): string {
  if (!label || n <= 1) return label;
  const m = label.match(/^(\d+)(?:–(\d+))?/);
  if (!m) return `${label} × ${n}`;
  const lo = parseInt(m[1], 10) * n;
  const hi = m[2] ? parseInt(m[2], 10) * n : null;
  return label.replace(/^\d+(–\d+)?/, hi ? `${lo}–${hi}` : `${lo}`);
}

/** Normalise a saved schedule object (from the profile) to a valid MealSchedule. */
export function readSchedule(raw: any): MealSchedule {
  const n = (v: any, d: number) => {
    const x = Math.round(Number(v));
    return Number.isFinite(x) && x >= 0 && x <= 23 ? x : d;
  };
  if (!raw || typeof raw !== "object") return DEFAULT_SCHEDULE;
  return {
    breakfast: n(raw.breakfast, DEFAULT_SCHEDULE.breakfast),
    lunch: n(raw.lunch, DEFAULT_SCHEDULE.lunch),
    snack: n(raw.snack, DEFAULT_SCHEDULE.snack),
    dinner: n(raw.dinner, DEFAULT_SCHEDULE.dinner),
  };
}
