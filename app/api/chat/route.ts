import { NextRequest, NextResponse } from "next/server";
import { DISHES } from "@/lib/data/dishes";
import { chat } from "@/lib/modelGateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// "Ask NaniAI" assistant.
//  - Safety FIRST: emergency + medication/diagnosis questions are handled by
//    deterministic guardrails, never by the model, and never with medical
//    clearance. Emergencies are pointed at local services.
//  - General food/cooking/nutrition questions are answered from our REAL dish
//    data in deterministic (keyless) mode, and by the configured LLM (NVIDIA
//    Nemotron via Nebius) when a key is present — same model gateway.
//  - We never claim an LLM ran when it did not: the response carries the real
//    provider ("mock" | "nebius" | "anthropic").

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

interface ProfileLite {
  name?: string;
  cuisine?: string;
  region?: string;
  conditions?: string[];
  allergies?: string[];
  lovedDishIds?: string[];
}

const EMERGENCY_RE =
  /\b(emergency|can'?t breathe|cannot breathe|chest pain|choking|unconscious|collapsed|fainted|bleeding badly|heart attack|stroke|suicid|overdose|help me now)\b/i;
const MED_RE =
  /\b(medication|medicine|drug|dose|dosage|insulin|metformin|warfarin|amlodipine|interact|interaction|is it safe to take|stop taking|prescb|prescription)\b/i;

function findDish(text: string) {
  const t = text.toLowerCase();
  return DISHES.find((d) => t.includes(d.name.toLowerCase())) ||
    DISHES.find((d) => d.name.toLowerCase().split(/\s+/).some((w) => w.length > 3 && t.includes(w)));
}

/** Deterministic, grounded answer from REAL data. Used in keyless mode and as
 *  the safe fallback. Never diagnoses; never clears a drug/food combination. */
function groundedAnswer(message: string, profile?: ProfileLite): string {
  const t = message.toLowerCase().trim();

  if (!t) return "Ask me about meal ideas, ingredients, substitutions, cooking, or general nutrition.";

  const dish = findDish(t);

  if (/\b(ingredient|what'?s in|made of|made with|contains)\b/.test(t) && dish) {
    return `${dish.name} is typically made with: ${dish.ingredients.join(", ")}.` +
      (dish.allergens.length ? ` Heads up — it can contain: ${dish.allergens.join(", ")}.` : "");
  }
  if (/\b(nutrition|calorie|kcal|sugar|sodium|salt|carb|potassium)\b/.test(t) && dish) {
    const n = dish.nutrition;
    return `Per typical serving, ${dish.name} has about ${n.kcal} kcal, ${n.sugar_g}g sugar, ` +
      `${n.sodium_mg}mg sodium, ${n.carbs_g}g carbs${n.potassium_mg ? `, ${n.potassium_mg}mg potassium` : ""}. ` +
      `(Illustrative values — not a substitute for a dietitian.)`;
  }
  if (/\b(substitut|instead of|replace|swap|alternative)\b/.test(t)) {
    const ex = dish ? `For example, a crispy Masala Dosa can become a softer Uttapam — same fermented batter, gentler to chew.` : "";
    return `When a favorite doesn't fit your limits, I look for the closest safe dish that keeps the same flavours and style, not a random "healthy" pick. ${ex} Tell me the dish and what you need to avoid, and I'll suggest options.`;
  }
  if (/\b(why|how did you|how do you)\b/.test(t)) {
    return `Every plan is built safety-first: hard medical limits and allergies are enforced by deterministic code the AI can't override. Within what's safe, I rank dishes by how familiar they are to your tastes and cuisine. So you get meals that are both safe and feel like home.`;
  }
  if (dish) {
    return `${dish.name}: ${dish.blurb} It works for ${dish.slots.join(", ")}. Want the recipe, its nutrition, or a safe alternative?`;
  }
  const liked = profile?.lovedDishIds?.length ? ` You've told me you love ${profile.lovedDishIds.length} dish(es), so I can anchor ideas around those.` : "";
  return `I can help with meal ideas, what's in a dish, nutrition facts, substitutions, cooking tips, grocery planning, and general nutrition questions.${liked} What would you like to explore?`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const messages: ChatTurn[] = Array.isArray(body?.messages) ? body.messages.slice(-8) : [];
    const profile: ProfileLite | undefined = body?.profile;
    const last = messages.filter((m) => m.role === "user").pop()?.content ?? "";
    const text = String(last).slice(0, 1000);

    // 1) EMERGENCY — deterministic, never the model. Point to local services.
    if (EMERGENCY_RE.test(text)) {
      return NextResponse.json({
        reply:
          "⚠️ If this is a medical emergency, call your local emergency number right now (in India, 112 or 108) — " +
          "that comes first, before anything else. If you've set a trusted contact, use the Emergency button to message them too. " +
          "I can't handle emergencies myself, but I want you to get help fast.",
        provider: "guardrail",
        kind: "emergency",
      });
    }

    // 2) MEDICATION / drug-interaction — educational only, refer to a professional.
    if (MED_RE.test(text)) {
      return NextResponse.json({
        reply:
          "I can share general food information, but I can't give medication or drug–food safety clearance — " +
          "that needs your pharmacist or doctor, who knows your full history. Please check any medication or interaction " +
          "question with them. I'm happy to help with meal ideas that fit the dietary limits they've already given you.",
        provider: "guardrail",
        kind: "medication",
      });
    }

    // 3) General question — grounded deterministic answer, upgraded by the LLM when configured.
    const mockText = groundedAnswer(text, profile);
    const system =
      "You are NaniAI, a warm, concise food & wellness companion. Answer only about meals, ingredients, " +
      "substitutions, cooking, grocery planning, cuisine, and GENERAL nutrition education. " +
      "You must NOT diagnose, prescribe, change medication, or declare any food–drug combination safe — refer those to a clinician. " +
      "Never override a safety limit. Keep answers friendly and under 120 words. If unsure, say so.";
    const convo = messages.map((m) => `${m.role === "user" ? "User" : "NaniAI"}: ${m.content}`).join("\n");
    const user =
      (profile ? `User profile: name ${profile.name ?? "—"}, cuisine ${profile.cuisine ?? "—"}` +
        `${profile.region ? ` (${profile.region})` : ""}, conditions ${(profile.conditions ?? []).join(", ") || "none"}, ` +
        `allergies ${(profile.allergies ?? []).join(", ") || "none"}.\n` : "") +
      `Conversation so far:\n${convo}\n\nAnswer the user's latest message.`;

    const result = await chat({ system, user, mockText, maxTokens: 220, tier: "fast" });
    return NextResponse.json({ reply: result.text, provider: result.provider, kind: "general" });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message ?? "chat failed" }, { status: 500 });
  }
}
