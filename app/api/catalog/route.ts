import { NextResponse } from "next/server";
import { DISHES } from "@/lib/data/dishes";

export const runtime = "nodejs";

/** GET /api/catalog — data the "Your Kitchen" profile builder needs:
 *  the dish list (to pick favorites) plus the option vocabularies. */
export async function GET() {
  const cuisines = Array.from(new Set(DISHES.map((d) => d.cuisine))).sort();
  return NextResponse.json({
    dishes: DISHES.map((d) => ({
      id: d.id,
      name: d.name,
      cuisine: d.cuisine,
      slots: d.slots,
    })),
    cuisines,
    // Broad, GLOBAL cuisine preference options (searchable in the UI). The vetted
    // dish catalog is smaller than this list; these let users state preferences
    // honestly across every region even where we don't yet have matching vetted dishes.
    cuisineOptions: [
      // Lead with a globally diverse mix (shown first in the picker)
      "Italian", "Mexican", "Japanese", "Chinese", "Thai", "Mediterranean",
      "North Indian", "French", "Korean", "American", "Middle Eastern", "Spanish",
      "Greek", "Vietnamese", "South Indian", "Ethiopian", "Nigerian", "Brazilian",
      "Lebanese", "Turkish", "Caribbean", "Moroccan", "German", "Peruvian",
      // South Asia
      "East Indian", "West Indian", "Northeast Indian", "Mughlai", "Bengali",
      "Gujarati", "Rajasthani", "Punjabi", "Kashmiri", "Hyderabadi", "Andhra",
      "Kerala", "Tamil", "Goan", "Chettinad", "Udupi",
      "Pakistani", "Bangladeshi", "Sri Lankan", "Nepali",
      // East & Southeast Asia
      "Sichuan", "Cantonese", "Taiwanese", "Indonesian", "Malaysian", "Filipino", "Singaporean",
      // Middle East & West Asia
      "Persian", "Israeli", "Syrian", "Gulf / Arabian",
      // Europe
      "Portuguese", "British", "Nordic", "Balkan", "Eastern European", "Continental",
      // Africa
      "Ghanaian", "Egyptian", "Kenyan", "Senegalese", "South African", "West African", "North African",
      // Americas
      "Southern US", "Cajun / Creole", "Canadian", "Colombian", "Argentinian", "Venezuelan",
      // Oceania & styles
      "Australian", "New Zealand", "Pacific Islander", "Fusion", "Vegan / Plant-based",
    ],
    // Countries (+ "" = any) — the user's home country, for a local taste nudge and
    // for country-appropriate emergency guidance. (We record country, not state.)
    regions: [
      "", "India", "Pakistan", "Bangladesh", "Sri Lanka", "Nepal",
      "United States", "Canada", "Mexico", "Brazil", "Argentina", "Colombia", "Peru", "Chile", "Venezuela",
      "United Kingdom", "Ireland", "France", "Germany", "Italy", "Spain", "Portugal", "Greece",
      "Netherlands", "Belgium", "Switzerland", "Sweden", "Norway", "Denmark", "Poland", "Russia", "Ukraine",
      "China", "Japan", "South Korea", "Taiwan", "Thailand", "Vietnam", "Indonesia", "Malaysia",
      "Singapore", "Philippines", "Australia", "New Zealand",
      "United Arab Emirates", "Saudi Arabia", "Qatar", "Turkey", "Iran", "Israel", "Lebanon", "Syria",
      "Egypt", "Morocco", "Nigeria", "Ghana", "Kenya", "Senegal", "South Africa", "Ethiopia",
    ],
    conditions: [
      { id: "type_2_diabetes", label: "Type 2 diabetes" },
      { id: "hypertension", label: "Hypertension" },
      { id: "chronic_kidney_disease", label: "Kidney disease" },
      { id: "dysphagia", label: "Swallowing difficulty" },
    ],
    // Broad, searchable condition suggestions (free text allowed). Only the four
    // above drive deterministic safety rules today; the rest are saved as context
    // for the assistant and your clinician — we never invent a rule we don't have.
    conditionOptions: [
      "Type 2 diabetes", "Type 1 diabetes", "Prediabetes", "Gestational diabetes",
      "Hypertension (high blood pressure)", "Kidney disease (CKD)", "Swallowing difficulty (dysphagia)",
      "High cholesterol", "Heart disease", "Heart failure", "Stroke history",
      "Celiac disease", "IBS", "IBD / Crohn's", "Ulcerative colitis", "GERD / acid reflux",
      "Hypothyroidism", "Hyperthyroidism", "PCOS", "Gout", "Anemia",
      "Osteoporosis", "Fatty liver (NAFLD)", "Lactose intolerance", "Obesity",
      "Pregnancy", "Breastfeeding", "Cancer (in treatment)", "Dialysis",
    ],
    allergies: ["peanut", "nuts", "dairy", "gluten", "fish", "shellfish", "soy", "egg", "sesame", "mustard", "wheat", "lactose"],
    medications: ["metformin", "amlodipine", "warfarin", "insulin", "losartan", "atorvastatin"],
    medicationOptions: [
      "metformin", "insulin", "glimepiride", "sitagliptin", "empagliflozin",
      "amlodipine", "losartan", "telmisartan", "lisinopril", "ramipril", "hydrochlorothiazide",
      "atorvastatin", "rosuvastatin", "warfarin", "aspirin", "clopidogrel",
      "levothyroxine", "omeprazole", "pantoprazole", "furosemide", "spironolactone",
      "allopurinol", "prednisone", "iron supplement", "calcium supplement", "vitamin D",
    ],
    lifestyleRoles: ["Working professional", "Student", "Homemaker", "Retired", "Other"],
    goalOptions: [
      "Find suitable meals", "Eat more consistently", "Explore new dishes",
      "Preserve familiar food traditions", "Plan grocery purchases",
      "Manage time & meal prep", "Understand nutrition", "Fit clinician's diet advice",
    ],
  });
}
