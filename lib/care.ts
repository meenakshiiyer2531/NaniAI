import type { Persona } from "@/lib/types";

// Care-coordination helpers. DELIBERATELY NON-DIAGNOSTIC and integration-free:
// we never fake a booking or give AI medical triage. We map conditions to the
// right kind of specialist and hand off to a REAL local search, and we provide
// an In-Case-of-Emergency card plus safe, generic first-step guidance.

export interface SpecialistSuggestion {
  condition: string;
  specialist: string;
  why: string;
  searchUrl: string; // real maps search — no fake booking
}

const SPECIALIST_BY_CONDITION: Record<string, { specialist: string; why: string }> = {
  type_2_diabetes: {
    specialist: "Endocrinologist / Diabetologist",
    why: "ongoing blood-sugar management and medication review",
  },
  hypertension: {
    specialist: "Cardiologist",
    why: "blood-pressure monitoring and heart-health guidance",
  },
  chronic_kidney_disease: {
    specialist: "Nephrologist",
    why: "kidney-function monitoring and diet/potassium guidance",
  },
  dysphagia: {
    specialist: "Speech-Language Pathologist / ENT",
    why: "safe-swallowing assessment and texture recommendations",
  },
};

export function specialistSuggestions(
  persona: Persona,
  location?: string,
): SpecialistSuggestion[] {
  const where = location || persona.region || "";
  return persona.conditions
    .map((c) => {
      const s = SPECIALIST_BY_CONDITION[c];
      if (!s) return null;
      const q = `${s.specialist} near ${where}`.trim();
      return {
        condition: c,
        specialist: s.specialist,
        why: s.why,
        searchUrl: `https://www.google.com/maps/search/${encodeURIComponent(q)}`,
      };
    })
    .filter(Boolean) as SpecialistSuggestion[];
}

export interface EmergencyScenario {
  id: string;
  title: string;
  whenToCall: string;
  firstSteps: string[];
}

// Safe, widely-published first-aid orientation — NOT a substitute for emergency
// services. Shown as a calm checklist, never as AI diagnosis.
export const EMERGENCY_SCENARIOS: EmergencyScenario[] = [
  {
    id: "hypoglycemia",
    title: "Low blood sugar (shaky, sweaty, confused)",
    whenToCall: "Call emergency services if the person faints or can't swallow safely.",
    firstSteps: [
      "If awake and able to swallow, give 15g fast sugar (juice, glucose tablets).",
      "Wait 15 minutes; if no better, repeat once.",
      "Follow with a small snack once they improve.",
    ],
  },
  {
    id: "chest_pain",
    title: "Chest pain or pressure",
    whenToCall: "Call emergency services immediately — do not wait.",
    firstSteps: [
      "Have the person sit down and stay calm and still.",
      "Loosen tight clothing.",
      "If prescribed and advised by their doctor, help with their heart medication.",
    ],
  },
  {
    id: "fall",
    title: "A fall",
    whenToCall: "Call emergency services if there is head injury, severe pain, or they can't get up.",
    firstSteps: [
      "Do not rush to move them; check for pain or bleeding first.",
      "Keep them warm and reassured.",
      "If safe and they feel able, help them up slowly.",
    ],
  },
  {
    id: "choking",
    title: "Choking / trouble breathing",
    whenToCall: "Call emergency services immediately if they cannot breathe, cough, or speak.",
    firstSteps: [
      "Encourage coughing if they still can.",
      "Give back blows / abdominal thrusts if trained.",
      "Stay with them until help arrives.",
    ],
  },
];

export interface IceCard {
  name: string;
  age: number;
  conditions: string[];
  medications: string[];
  allergies: string[];
  note: string;
}

export function buildIceCard(persona: Persona): IceCard {
  return {
    name: persona.name,
    age: persona.age,
    conditions: persona.conditions,
    medications: persona.medications,
    allergies: persona.allergies.length ? persona.allergies : ["none reported"],
    note:
      "Show this card to responders. This is a prototype aid, not a medical record — " +
      "always call your local emergency number first.",
  };
}
