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
    // Broad cuisine preference options (searchable in the UI). The vetted dish
    // catalog is currently India-focused; these let users state preferences
    // honestly even where we don't yet have matching vetted dishes.
    cuisineOptions: [
      "North Indian", "South Indian", "East Indian", "West Indian",
      "Northeast Indian", "Central Indian", "Himalayan", "Coastal Indian",
      "Mughlai", "Awadhi", "Chettinad", "Udupi", "Malvani", "Goan",
      "Bengali", "Gujarati", "Rajasthani", "Maharashtrian", "Punjabi",
      "Kashmiri", "Hyderabadi", "Andhra", "Kerala", "Tamil", "Karnataka",
      "Italian", "Mediterranean", "Mexican", "American", "French",
      "Chinese", "Thai", "Japanese", "Middle Eastern", "Continental",
    ],
    // All Indian states + union territories (+ "" = any), used as the regional anchor.
    regions: [
      "", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
      "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka",
      "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram",
      "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu",
      "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
      "Andaman and Nicobar Islands", "Chandigarh", "Dadra and Nagar Haveli and Daman and Diu",
      "Delhi", "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
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
