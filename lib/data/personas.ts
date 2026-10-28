import type { Persona } from "@/lib/types";

// Demo personas. The hero persona (Lakshmi) is the one we perfect for the live
// demo: a combination that makes the culturally-blind baseline visibly fail.

export const PERSONAS: Persona[] = [
  {
    id: "lakshmi",
    name: "Lakshmi",
    age: 72,
    cuisine: "South Indian",
    region: "Tamil Nadu",
    conditions: ["type_2_diabetes", "hypertension"],
    medications: ["metformin", "amlodipine"],
    textureMax: 5, // mild chewing difficulty — crispy/fried items are unsafe
    allergies: [],
    lovedDishIds: ["masala_dosa", "payasam", "ven_pongal", "idli"],
    story:
      "Lakshmi is 72, lives in Chennai with her son's family, and has had Type 2 diabetes for nine years plus high blood pressure. Her dentures make crispy food hard. She finds the hospital's printed diet chart — oatmeal, salad, grilled fish — impossible to live with. She wants to eat like herself.",
  },
  {
    id: "ahmed",
    name: "Ahmed",
    age: 68,
    cuisine: "North Indian",
    region: "Punjab",
    conditions: ["type_2_diabetes", "chronic_kidney_disease"],
    medications: ["metformin"],
    textureMax: 6,
    allergies: ["peanut"],
    lovedDishIds: ["palak_paneer", "moong_dal_khichdi"],
    story:
      "Ahmed, 68, manages diabetes and early kidney disease. He must watch both sugar and potassium, and he's allergic to peanuts — a combination most diet apps ignore entirely.",
  },
  {
    id: "meena",
    name: "Meena",
    age: 80,
    cuisine: "South Indian",
    region: "Tamil Nadu",
    conditions: ["dysphagia", "hypertension"],
    medications: ["amlodipine"],
    textureMax: 2, // post-stroke swallowing difficulty: soft/liquid only
    allergies: [],
    lovedDishIds: ["masala_dosa", "medu_vada", "curd_rice"],
    story:
      "Meena, 80, had a stroke and can only safely swallow soft, near-liquid food. She still craves the dosa and vada she ate her whole life. Keeping her safe without erasing her favorites is the daily struggle her daughter faces.",
  },
  {
    id: "ravi",
    name: "Ravi",
    age: 24,
    cuisine: "South Indian",
    region: "Kerala",
    conditions: [],
    medications: [],
    textureMax: 7,
    allergies: [],
    lovedDishIds: ["avial", "idli", "sambar", "rasam"],
    story:
      "Ravi, 24, moved from Kerala to a Bangalore PG for his first job. He's homesick and tired of greasy takeout. He doesn't need a medical diet — he needs meals that taste like home and keep him well. (Proof the same engine helps healthy young people too.)",
  },
  {
    id: "priya",
    name: "Priya",
    age: 31,
    cuisine: "North Indian",
    region: "Punjab",
    conditions: ["hypertension"],
    medications: [],
    textureMax: 7,
    allergies: [],
    lovedDishIds: ["palak_paneer", "moong_dal_khichdi"],
    story:
      "Priya, 31, works long hours in Bangalore and has borderline high blood pressure from years of salty takeout. She wants quick, familiar North Indian meals that quietly keep her sodium in check.",
  },
  {
    id: "anjali",
    name: "Anjali",
    age: 29,
    cuisine: "South Indian",
    region: "Tamil Nadu",
    conditions: [],
    medications: [],
    textureMax: 7,
    allergies: [],
    lovedDishIds: ["ven_pongal", "curd_rice", "sambar", "payasam"],
    story:
      "Anjali, 29, just had her first baby and is breastfeeding. She's exhausted, has little time to cook, and wants warm, nourishing, easy-to-digest meals like the ones her mother made after childbirth — comfort food that keeps her energy and milk supply up. (Proof the engine serves new mothers, not just patients.)",
  },
];

export const PERSONAS_BY_ID: Record<string, Persona> = Object.fromEntries(
  PERSONAS.map((p) => [p.id, p]),
);

export function getPersona(id: string): Persona {
  const p = PERSONAS_BY_ID[id];
  if (!p) throw new Error(`Unknown persona id: ${id}`);
  return p;
}
