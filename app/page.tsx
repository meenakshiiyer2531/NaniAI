"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { buildRecipe, portionOf, prepTipFor } from "@/lib/recipes";
import { dayTotals } from "@/lib/nutrition";
import { supabaseBrowser, supabaseConfigured, type Profile } from "@/lib/supabase/client";
import { slotForHour, nextSlotFor, scalePortion, readSchedule, DEFAULT_SCHEDULE, type MealSchedule, type Slot } from "@/lib/schedule";

// ---------- shapes mirroring the API ----------
type Dish = {
  id: string; name: string; cuisine: string; blurb: string;
  ingredients: string[]; tags: string[];
  nutrition: { kcal: number; sugar_g: number; sodium_mg: number; carbs_g: number; potassium_mg?: number };
};
type Alt = { dish: Dish; familiarity: number; receipt: string[]; sides?: Dish[] };
type PlanItem = { slot: string; dish: Dish; sides?: Dish[]; familiarity: number; receipt: string[]; alternatives?: Alt[] };
type PlanResponse = {
  plan: { items: PlanItem[]; avgFamiliarity: number; violationCount: number };
  substitutions: { fromDishId: string; toDishId: string; tradeoff: string }[];
  negotiation: { agent: string; message: string }[];
  meta: { modelProvider: string; modelName: string; qlooLive: boolean; latencyMs: number; estCostUsd: number | null };
};
type Care = {
  specialists: { condition: string; specialist: string; why: string; searchUrl: string }[];
  ice: { name: string; age: number; conditions: string[]; medications: string[]; allergies: string[]; note: string };
  emergencyScenarios: { id: string; title: string; whenToCall: string; firstSteps: string[] }[];
};
type Comparison = {
  persona: any; grounded: PlanResponse; baseline: PlanResponse;
  rejected: { id: string; name: string; cuisine: string; loved: boolean; violations: string[] }[];
  care: Care;
};
type Catalog = {
  dishes: { id: string; name: string; cuisine: string; slots: string[] }[];
  cuisines: string[]; cuisineOptions?: string[]; regions: string[];
  conditions: { id: string; label: string }[];
  conditionOptions?: string[]; medicationOptions?: string[];
  lifestyleRoles?: string[]; goalOptions?: string[];
  allergies: string[]; medications: string[];
};

const COND_LABEL: Record<string, string> = {
  type_2_diabetes: "Type 2 diabetes", hypertension: "hypertension",
  chronic_kidney_disease: "kidney disease", dysphagia: "swallowing difficulty",
};
const PREP_SLOTS = ["breakfast", "lunch", "snack", "dinner"] as const;

function profileToPersona(p: Profile) {
  return {
    name: p.preferred_name || "You",
    age: p.age ?? 30,
    // All cuisines the user enjoys — no cuisine is ever defaulted. An empty list
    // means "open to everything" (the engine prefers none).
    cuisines: p.cuisines || [],
    cuisine: (p.cuisines && p.cuisines[0]) || "",
    region: p.region || undefined,
    conditions: p.conditions || [],
    medications: p.medications || [],
    allergies: p.allergies || [],
    textureMax: p.texture_max ?? 7,
    lovedDishIds: [],
    lovedFreeText: p.loved_dishes || [],
  };
}

function avatarEmoji(p: Profile): string {
  const g = ((p.lifestyle as any)?.gender) || "";
  if (g === "female") return "👩";
  if (g === "male") return "👨";
  return "🧑";
}

/** Turn the real Qloo/affinity evidence into a clean, readable "why" sentence
 *  (strips internal popularity numbers/tag jargon). */
function mealWhy(dishName: string, receipt: string[], side?: string): string {
  const parts = (receipt || [])
    .map((s) =>
      s
        .replace(/Qloo Taste AI:\s*recognized as\s*[“"']?([^“"']+?)[”"']?\s*\(popularity[^)]*\)/i, "a well-loved $1")
        .replace(/\(popularity[^)]*\)/gi, "")
        .replace(/Qloo Taste AI:\s*/gi, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
  const base = parts.length ? parts.join("; ") : "it matches the cuisines and dishes you enjoy";
  return `Why ${dishName}${side ? ` with ${side}` : ""}: ${base}. It also fits within every health limit we track for you.`;
}

function currentSlot(schedule?: MealSchedule): Slot {
  return slotForHour(new Date().getHours(), schedule);
}
function timeGreeting(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return "Good morning";
  if (h >= 12 && h < 17) return "Good afternoon";
  if (h >= 17 && h < 21) return "Good evening";
  return "Good night";
}
const SLOT_EMOJI: Record<string, string> = { breakfast: "🌅", lunch: "☀️", snack: "🫖", dinner: "🌙" };
function fmtHour(h: number): string {
  const hr = ((Math.round(h) % 24) + 24) % 24;
  const ap = hr < 12 ? "am" : "pm";
  const h12 = hr % 12 === 0 ? 12 : hr % 12;
  return `${h12}:00 ${ap}`;
}
/** Human time-window label for a slot, from the user's schedule. */
function slotTime(slot: Slot, s: MealSchedule): string {
  const nextStart: Record<Slot, number> = { breakfast: s.lunch, lunch: s.snack, snack: s.dinner, dinner: s.breakfast };
  return `${fmtHour((s as any)[slot])}–${fmtHour(nextStart[slot])}`;
}

export default function Home() {
  const configured = supabaseConfigured();
  const supabase = useMemo(() => (configured ? supabaseBrowser() : null), [configured]);

  const [userId, setUserId] = useState<string | null | undefined>(undefined); // undefined = loading
  const [profile, setProfile] = useState<Profile | null>(null);
  const [catalog, setCatalog] = useState<Catalog>();
  const [status, setStatus] = useState<{ modelProvider: string; qlooConfigured: boolean }>();

  const [day, setDay] = useState(0);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Comparison | null>(null);
  const [error, setError] = useState("");
  const [swapIdx, setSwapIdx] = useState<Record<string, number>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [feedback, setFeedback] = useState<Record<string, "up" | "down">>({});
  const [showEmergency, setShowEmergency] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showFullDay, setShowFullDay] = useState(false);
  const [servings, setServings] = useState(1);
  const [prepared, setPrepared] = useState<Record<string, boolean>>({});

  // Always-current authenticated user id, readable inside async callbacks so a
  // response that arrives AFTER an account switch can be discarded (a stale
  // fetch from the previous user must never write into the new user's view).
  const userIdRef = useRef(userId);
  useEffect(() => { userIdRef.current = userId; }, [userId]);

  useEffect(() => {
    fetch("/api/personas").then((r) => r.json()).then((d) => setStatus(d.status)).catch(() => {});
    fetch("/api/catalog").then((r) => r.json()).then(setCatalog).catch(() => {});
    if (!supabase) { setUserId(null); return; }
    supabase.auth.getSession().then(({ data: { session } }) => setUserId(session?.user?.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user?.id ?? null);
      // On sign-out, wipe EVERY piece of per-user state so nothing from the
      // previous account can linger in memory or flash to the next user who
      // signs in on this device.
      if (!session) {
        setProfile(null);
        setData(null);
        setFeedback({});
        setPrepared({});
        setServings(1);
        setSwapIdx({});
        setExpanded({});
        setShowProfile(false);
        setShowEmergency(false);
        setShowFullDay(false);
        setError("");
        setLoading(false);
      }
    });
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // load profile when signed in
  useEffect(() => {
    if (!supabase || !userId) return;
    let cancel = false;
    // Clear the previous user's transient plan/state before loading this user's
    // data, so a fast account switch never shows another person's meal plan.
    setData(null);
    setFeedback({});
    setPrepared({});
    setSwapIdx({});
    setExpanded({});
    (async () => {
      const { data: row } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
      if (cancel) return;
      if (row) { setProfile(row as Profile); setFeedback(((row as any).feedback as Record<string, "up" | "down">) ?? {}); }
      else {
        // trigger may not have run yet — create the row
        await supabase.from("profiles").insert({ id: userId });
        const { data: row2 } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
        if (!cancel) setProfile((row2 as Profile) ?? null);
      }
    })();
    return () => { cancel = true; };
  }, [supabase, userId]);

  // default the serving-size selector from the saved household size
  useEffect(() => {
    const raw = (profile?.lifestyle as any)?.servings;
    if (!raw) return;
    if (raw === "Just me") setServings(1);
    else if (raw === "5+") setServings(5);
    else { const n = parseInt(String(raw).replace(/[^\d]/g, ""), 10); if (Number.isFinite(n) && n > 0) setServings(n); }
  }, [profile]);

  // load today's prep checklist from the database (per-user, RLS-enforced)
  useEffect(() => {
    if (!supabase || !userId) return;
    let cancel = false;
    (async () => {
      const day = new Date().toISOString().slice(0, 10);
      const { data } = await supabase.from("meal_prep").select("slot,prepared").eq("user_id", userId).eq("day", day);
      if (cancel || !data) return;
      const map: Record<string, boolean> = {};
      for (const r of data as any[]) if (r.prepared) map[`${day}:${r.slot}`] = true;
      setPrepared(map);
    })();
    return () => { cancel = true; };
  }, [supabase, userId]);

  const todayKey = () => new Date().toISOString().slice(0, 10);
  async function markPrepared(slot: string, dishId?: string) {
    if (!supabase || !userId) return;
    const day = todayKey();
    const key = `${day}:${slot}`;
    const nextVal = !prepared[key];
    setPrepared((prev) => ({ ...prev, [key]: nextVal })); // optimistic
    const { error } = await supabase.from("meal_prep").upsert(
      { user_id: userId, day, slot, dish_id: dishId ?? null, prepared: nextVal, updated_at: new Date().toISOString() },
      { onConflict: "user_id,day,slot" },
    );
    if (error) { // honest rollback — never show "saved" when the write failed
      setPrepared((prev) => ({ ...prev, [key]: !nextVal }));
      setError("Couldn't save prep status: " + error.message);
    }
  }
  const isPrepared = (slot: string) => !!prepared[`${todayKey()}:${slot}`];

  function rate(dishId: string, v: "up" | "down") {
    const next = { ...feedback };
    if (next[dishId] === v) delete next[dishId]; else next[dishId] = v;
    setFeedback(next); // optimistic
    if (supabase && userId) {
      supabase.from("profiles").update({ feedback: next }).eq("id", userId).then(({ error }) => {
        if (error) setError("Couldn't save your feedback: " + error.message);
      });
    }
  }

  async function run(nextDay = 0) {
    if (!profile) return;
    const callUser = userIdRef.current; // whose request this is
    setLoading(true); setError(""); setData(null); setSwapIdx({}); setExpanded({});
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      // Attach the session token so the server can use THIS user's own API key
      // (BYOK) if they configured one. Never exposes the key to the client.
      const tok = supabase ? (await supabase.auth.getSession()).data.session?.access_token : null;
      if (tok) headers.authorization = `Bearer ${tok}`;
      const res = await fetch("/api/plan", {
        method: "POST", headers,
        body: JSON.stringify({ persona: profileToPersona(profile), day: nextDay }),
      });
      const json = await res.json();
      // Account switched (or signed out) while this was in flight — drop it.
      if (userIdRef.current !== callUser) return;
      if (!res.ok) throw new Error(json.error ?? "request failed");
      setData(json);
      setExpanded({ [slotForHour(new Date().getHours(), readSchedule((profile?.lifestyle as any)?.schedule))]: true }); // auto-open the meal for right now
    } catch (e) {
      if (userIdRef.current !== callUser) return; // don't surface a stale error either
      setError((e as Error).message);
    }
    finally { setLoading(false); } // always clear the spinner (carries no user data)
  }

  async function saveProfile(patch: Partial<Profile>) {
    if (!supabase || !userId) return;
    const { data: row, error: e } = await supabase.from("profiles").update(patch).eq("id", userId).select("*").maybeSingle();
    if (e) throw new Error(e.message);
    if (row) setProfile(row as Profile);
  }

  function openEmergency() {
    const phone = (profile?.emergency_phone || "").replace(/\D/g, "");
    if (phone.length >= 8) {
      const msg = "Hi, I need your help urgently. Please contact me as soon as you can. If you can, please call me now.";
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank", "noopener");
    }
    setShowEmergency(true);
  }

  const effItems: PlanItem[] = useMemo(() => {
    if (!data) return [];
    const items = data.grounded.plan.items.map((it) => {
      const opts = [it, ...(it.alternatives ?? []).map((a) => ({ ...it, dish: a.dish, sides: a.sides, familiarity: a.familiarity, receipt: a.receipt }))];
      const idx = (swapIdx[it.slot] ?? 0) % opts.length;
      return opts[idx];
    });
    const now = slotForHour(new Date().getHours(), readSchedule((profile?.lifestyle as any)?.schedule));
    const ord: Record<string, number> = { breakfast: 0, lunch: 1, snack: 2, dinner: 3 };
    return [...items].sort((a, b) => (a.slot === now ? -1 : b.slot === now ? 1 : (ord[a.slot] ?? 9) - (ord[b.slot] ?? 9)));
  }, [data, swapIdx, profile]);
  const allDishes = useMemo(() => effItems.flatMap((it) => [it.dish, ...(it.sides ?? [])]), [effItems]);
  const schedule = useMemo(() => readSchedule((profile?.lifestyle as any)?.schedule), [profile]);
  const nowSlot = currentSlot(schedule);
  const visibleItems = useMemo(() => (showFullDay ? effItems : effItems.filter((it) => it.slot === nowSlot)), [effItems, showFullDay, nowSlot]);
  const nextSlot = nextSlotFor(nowSlot);
  const nextItem = useMemo(() => effItems.find((it) => it.slot === nextSlot), [effItems, nextSlot]);
  // At dinner, "next" is tomorrow's breakfast.
  const nextIsTomorrow = nowSlot === "dinner";
  const totals = useMemo(() => (allDishes.length ? dayTotals(allDishes.map((d) => ({ dish: d })) as any) : null), [allDishes]);
  const grocery = useMemo(() => {
    const set = new Set<string>();
    const dishes = showFullDay ? allDishes : visibleItems.flatMap((it) => [it.dish, ...(it.sides ?? [])]);
    dishes.forEach((d) => d.ingredients.forEach((i) => set.add(i)));
    if (!showFullDay && nextItem) { // include what to buy for the next meal you'll prep
      nextItem.dish.ingredients.forEach((i) => set.add(i));
      (nextItem.sides ?? []).forEach((s) => s.ingredients.forEach((i) => set.add(i)));
    }
    return Array.from(set).sort();
  }, [allDishes, visibleItems, showFullDay, nextItem]);

  // ---------- gates ----------
  if (!configured) return <ConfigNotice />;
  if (userId === undefined) return <div className="boot" />;
  if (!userId) return <Auth supabase={supabase!} />;
  if (!profile) return <div className="boot" />;
  if (!profile.onboarding_done) {
    return <Onboarding catalog={catalog} initial={profile} onDone={async (p) => { await saveProfile({ ...p, onboarding_done: true }); }} onSignOut={() => supabase!.auth.signOut()} />;
  }
  if (showProfile && catalog) {
    return <ProfilePage catalog={catalog} profile={profile} onBack={() => setShowProfile(false)} onSave={saveProfile} onSignOut={() => supabase!.auth.signOut()} />;
  }

  return (
    <div className="wrap">
      <header className="header">
        <div className="brand">
          <h1>Nani<span className="accent">AI</span></h1>
          <p>Meals that respect your <b>health limits</b> and your <b>culture</b> — safe advice that still tastes like home.</p>
        </div>
        <nav className="topnav">
          <button className="navbtn danger" onClick={openEmergency}>🚨 Emergency</button>
          <button className="avatar-btn" onClick={() => setShowProfile(true)} title="My profile" aria-label="My profile">
            <span className="avatar">{avatarEmoji(profile)}</span>
            <span className="avatar-name">{profile.preferred_name || "You"}</span>
          </button>
          <button className="navbtn ghost" onClick={() => supabase!.auth.signOut()}>Sign out</button>
        </nav>
      </header>

      {showEmergency && <EmergencyScreen profile={profile} onClose={() => setShowEmergency(false)} onSave={saveProfile} onReopen={openEmergency} />}

      <div className="greeting">{timeGreeting()}, <b>{profile.preferred_name || "friend"}</b> {avatarEmoji(profile)} — it&rsquo;s <b>{nowSlot}</b> time ({slotTime(nowSlot, schedule)}). Let&rsquo;s plan meals that feel like home and keep you well.</div>

      <div className="cta">
        <button className="run" onClick={() => { setDay(0); run(0); }} disabled={loading}>{loading ? "Planning…" : "Plan a day"}</button>
        {data && <button className="run ghost" onClick={() => { const d = day + 1; setDay(d); run(d); }} disabled={loading}>↻ Another day&rsquo;s ideas</button>}
      </div>

      {error && <div className="err">⚠ {error}</div>}
      {loading && <div className="spinner">Building a safe, familiar day…</div>}

      {!data && !loading && (
        <div className="home-cards">
          <button className="hcard primary" onClick={() => { setDay(0); run(0); }}>
            <div className="hc-emoji">{SLOT_EMOJI[nowSlot]}</div>
            <div className="hc-title">Plan today&rsquo;s meals</div>
            <div className="hc-sub">It&rsquo;s {nowSlot} time — get a safe, familiar {nowSlot} plus the rest of your day.</div>
          </button>
          <button className="hcard" onClick={() => setShowProfile(true)}>
            <div className="hc-emoji">⚙️</div>
            <div className="hc-title">My profile</div>
            <div className="hc-sub">Tune cuisines, favourites, health & lifestyle anytime.</div>
          </button>
          <button className="hcard danger" onClick={openEmergency}>
            <div className="hc-emoji">🚨</div>
            <div className="hc-title">Emergency</div>
            <div className="hc-sub">Reach your trusted contact & helplines fast.</div>
          </button>
          <div className="hcard flat">
            <div className="hc-emoji">💬</div>
            <div className="hc-title">Ask NaniAI</div>
            <div className="hc-sub">Questions about food, swaps or nutrition? Tap the chat button, bottom-right.</div>
          </div>
        </div>
      )}

      {data && totals && (
        <>
          <div className="section-label">{showFullDay ? "Your full day" : `Right now — your ${nowSlot}`} — tap a meal for recipe, video &amp; options <InfoTip text={"Chosen to match the cuisines and dishes you enjoy, then checked against your health limits."} /></div>
          <div className="servings-row">
            <span>Cooking for</span>
            <div className="seg">
              {[1, 2, 3, 4, 6].map((n) => (
                <button key={n} className={servings === n ? "on" : ""} onClick={() => setServings(n)}>{n === 6 ? "6+" : n}</button>
              ))}
            </div>
            <span className="servings-note">{servings === 1 ? "just you" : `${servings} people`} · quantities below scale to this</span>
          </div>
          <div className="day-grid">
            {visibleItems.map((it) => {
              const recipe = buildRecipe(it.dish as any);
              const isOpen = expanded[it.slot];
              const orig = data.grounded.plan.items.find((o) => o.slot === it.slot)!;
              const optCount = 1 + (orig.alternatives?.length ?? 0);
              const isNow = it.slot === nowSlot;
              return (
                <div className={`meal ${isNow ? "now" : ""}`} key={it.slot}>
                  <div className="meal-top" onClick={() => setExpanded((e) => ({ ...e, [it.slot]: !e[it.slot] }))}>
                    <div>
                      <div className="slot">{SLOT_EMOJI[it.slot]} {it.slot} {isNow && <span className="now-badge">now</span>}</div>
                      <div className="dish">{it.dish.name}{it.sides?.length ? <span className="with"> thali</span> : ""} <InfoTip text={mealWhy(it.dish.name, it.receipt, (it.sides ?? []).map((s) => s.name).join(", "))} /></div>
                      <div className="mchips">
                        <span className="mchip">🍽 {it.dish.cuisine}</span>
                        <span className="mchip">⏰ {slotTime(it.slot as Slot, schedule)}</span>
                        <span className="mchip">⏱ prep {recipe.prep}</span>
                      </div>
                    </div>
                    <div className="chev">{isOpen ? "▾" : "▸"}</div>
                  </div>
                  <div className="fam-row">
                    <div className="fam"><span style={{ width: `${it.familiarity}%` }} /></div>
                    <span className="fam-label">familiarity {it.familiarity}</span>
                  </div>
                  {isOpen && (() => {
                    const plate = [it.dish, ...(it.sides ?? [])];
                    const sum = (k: "kcal" | "sugar_g" | "sodium_mg" | "carbs_g") => plate.reduce((a, d) => a + ((d.nutrition as any)[k] ?? 0), 0);
                    return (
                    <div className="meal-detail">
                      <div className="recipe-h">On your plate — serves {servings}</div>
                      <div className="plate">
                        {plate.map((d, i) => (
                          <div className="plate-row" key={d.id}>
                            <span className="pr-name">{i === 0 ? "🍛 " : "🥄 "}{d.name}{i === 0 ? " (main)" : ""}</span>
                            <span className="pr-qty">{scalePortion(portionOf(d), servings)}</span>
                          </div>
                        ))}
                      </div>
                      <div className="nut">
                        <span className="nut-est">Estimated</span>
                        <span>{sum("kcal")} kcal</span>
                        <span>{sum("sugar_g").toFixed(1)}g sugar</span>
                        <span>{sum("sodium_mg")}mg sodium</span>
                        <span>{sum("carbs_g")}g carbs</span>
                      </div>
                      <div className="plate-note">🛡 Every component was checked against your limits; together they stay in a safe range. Quantities are approximate guidance, not a medical prescription.</div>
                      <Link className="run ghost recipe-link" href={`/recipes/${it.dish.id}?sides=${(it.sides ?? []).map((s) => s.id).join(",")}&servings=${servings}`}>📖 View full recipe &amp; method →</Link>

                      {optCount > 1 && (
                        <>
                          <div className="recipe-h">Prefer a different main? <InfoTip text={"Swap the main dish of this plate — your accompaniments stay. All options are safe for you."} /></div>
                          <div className="choices">
                            {[orig, ...(orig.alternatives ?? []).map((a) => ({ ...orig, dish: a.dish, familiarity: a.familiarity, receipt: a.receipt }))].map((opt, oi) => {
                              const chosen = ((swapIdx[it.slot] ?? 0) % optCount) === oi;
                              return (
                                <button key={opt.dish.id} className={`choice ${chosen ? "on" : ""}`} onClick={() => setSwapIdx((s) => ({ ...s, [it.slot]: oi }))}>
                                  <span className="cname">{opt.dish.name}</span>
                                  <span className="cfam">familiarity {opt.familiarity}</span>
                                  {feedback[opt.dish.id] === "up" && <span className="cliked">♥</span>}
                                </button>
                              );
                            })}
                          </div>
                        </>
                      )}
                      <div className="recipe-h">Recipe — {it.dish.name}</div>
                      <ol className="recipe">{recipe.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
                      <div className="recipe-h">Prep ahead ({recipe.prep})</div>
                      <ul className="prep-steps">
                        <li>Set aside: {plate.flatMap((d) => d.ingredients).filter((v, i, a) => a.indexOf(v) === i).join(", ")}.</li>
                        <li>{prepTipFor(it.dish)}</li>
                        <li>Keep anything perishable covered in the fridge — never left out overnight.</li>
                      </ul>
                      <div className="recipe-h">Watch how to make it</div>
                      <a className="videocard" href={recipe.youtubeUrl} target="_blank" rel="noreferrer">
                        <div className="vc-thumb"><span className="vc-play">▶</span></div>
                        <div className="vc-meta">
                          <div className="vc-title">{it.dish.name} — recipe videos</div>
                          <div className="vc-sub">Opens hand-picked YouTube results · step-by-step</div>
                        </div>
                      </a>
                      <div className="fb">
                        <button className={`fb-btn prep-btn ${isPrepared(it.slot) ? "up" : ""}`} onClick={() => markPrepared(it.slot, it.dish.id)}>{isPrepared(it.slot) ? "✓ Prepared" : "Mark prepared"}</button>
                        <span className="fb-q">· How was {it.dish.name}?</span>
                        <button className={`fb-btn ${feedback[it.dish.id] === "up" ? "up" : ""}`} onClick={() => rate(it.dish.id, "up")}>👍</button>
                        <button className={`fb-btn ${feedback[it.dish.id] === "down" ? "down" : ""}`} onClick={() => rate(it.dish.id, "down")}>👎</button>
                      </div>
                    </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>

          <div className="cta">
            <button className="run ghost" onClick={() => setShowFullDay((s) => !s)}>
              {showFullDay ? `Show only my ${nowSlot}` : "Show my full day ▾"}
            </button>
          </div>

          {!showFullDay && nextItem && (
            <div className="prep-card">
              <div className="prep-emoji">{SLOT_EMOJI[nextSlot]}</div>
              <div style={{ flex: 1 }}>
                <div className="prep-h">Prepare next — {nextIsTomorrow ? "tomorrow's" : "your"} {nextSlot}</div>
                <div className="prep-dish"><b>{nextItem.dish.name}</b>{nextItem.sides?.length ? ` + ${nextItem.sides.map((s) => s.name).join(", ")}` : ""} · {nextItem.dish.cuisine} · {buildRecipe(nextItem.dish as any).prep}</div>
                <ul className="prep-steps">
                  <li>Set aside: {[nextItem.dish, ...(nextItem.sides ?? [])].flatMap((d) => d.ingredients).filter((v, i, a) => a.indexOf(v) === i).join(", ")}.</li>
                  <li>{prepTipFor(nextItem.dish)}</li>
                  <li>Keep anything perishable (curd, cooked dal, cut vegetables) <b>covered in the fridge</b> — never left out overnight.</li>
                </ul>
              </div>
            </div>
          )}

          <div className="panels">
            <div className="panel">
              <h3>📊 Today&rsquo;s nutrition <span className="est-badge">estimated</span> <InfoTip text={`Combined totals for your shown meals${showFullDay ? "" : " (just your " + nowSlot + ")"}. These are approximate estimates from a curated reference, not lab-measured values — use them as guidance, not exact figures. Every dish was still checked against your per-meal limits before it was suggested.`} /></h3>
              <div className="nutgrid">
                <div className="nutcell"><div className="nv">{totals.kcal}</div><div className="nl">kcal</div></div>
                <div className="nutcell"><div className="nv">{totals.sugar_g.toFixed(1)}g</div><div className="nl">sugar</div></div>
                <div className="nutcell"><div className="nv">{totals.sodium_mg}mg</div><div className="nl">sodium</div></div>
                <div className="nutcell"><div className="nv">{totals.carbs_g}g</div><div className="nl">carbs</div></div>
              </div>
              <div className="ok">✓ every meal is within the limits set for your health.</div>
              <div className="est-note">Nutrition figures are approximate estimates for guidance, not medical or lab-verified values.</div>
            </div>
            <div className="panel">
              <h3>🛒 Grocery list <InfoTip text={"Ingredients for the meal you're having now plus what you'll prep for your next meal, merged into one shopping list."} /></h3>
              <div className="grocery">{grocery.map((g) => <span key={g} className="gitem">{g}</span>)}</div>
            </div>
          </div>

          <div className="panels">
            <div className="panel">
              <h3>🛡 Kept out for your safety <InfoTip text={"These dishes crossed a limit we track for you — e.g., sugar, sodium, potassium, texture, or an allergy — so deterministic safety rules (not the AI) kept them off your plan."} /></h3>
              {data.rejected.length === 0 && <div className="rej">Nothing was left out — everything fits your needs.</div>}
              {data.rejected.map((r) => (
                <div className="rej" key={r.id}><div className="n">{r.name}{r.loved && <span className="loved">♥ a favorite</span>}</div><div className="v">{r.violations.join(" · ")}</div></div>
              ))}
            </div>
            <div className="panel">
              <h3>⏰ Suggested times today</h3>
              <div className="timerows">
                {(["breakfast", "lunch", "snack", "dinner"] as const).map((s) => (
                  <div className={`timerow ${s === nowSlot ? "now" : ""}`} key={s}>
                    <span>{SLOT_EMOJI[s]} {s}</span><span className="tt">{slotTime(s, schedule)}</span>
                  </div>
                ))}
              </div>
              <div className="explain-src">Have breakfast early and dinner before 8 pm for steadier energy.</div>
            </div>
          </div>

          <div className="cta"><button className="run ghost" onClick={() => window.print()}>🖨 Print / share this day</button></div>
          <div className="foot">Your meals stay within the limits that matter for your health, enforced by deterministic safety code. A wellness companion, not medical advice — always consult your clinician.</div>
        </>
      )}

      <ChatWidget profile={{ name: profile.preferred_name, cuisine: (profile.cuisines || []).join(", "), region: profile.region, conditions: profile.conditions, allergies: profile.allergies, lovedDishIds: profile.loved_dishes, disliked: profile.disliked, dietary_pattern: profile.dietary_pattern, goals: profile.goals, lifestyle: profile.lifestyle }} />
    </div>
  );
}

// ---------------- config notice ----------------
function ConfigNotice() {
  return (
    <div className="welcome"><div className="welcome-card">
      <div className="wbrand">Nani<span className="accent">AI</span></div>
      <h2 className="wtitle">Almost there</h2>
      <p className="wlede">Sign-in is awaiting configuration. Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>, run <code>supabase/migrations/0001_init.sql</code>, and reload.</p>
    </div></div>
  );
}

// ---------------- auth (login / signup) ----------------
function Auth({ supabase }: { supabase: ReturnType<typeof supabaseBrowser> }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setBusy(true);
    const em = email.trim().toLowerCase();
    try {
      if (mode === "signup") {
        const res = await fetch("/api/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: em, password }) });
        const j = await res.json();
        // If the account already exists, don't dead-end — just sign in below.
        if (!res.ok && !/already/i.test(j.error ?? "")) throw new Error(j.error ?? "Sign-up failed.");
      }
      const { error } = await supabase.auth.signInWithPassword({ email: em, password });
      if (error) {
        if (/invalid login|credentials/i.test(error.message)) {
          throw new Error(mode === "login"
            ? "Incorrect email or password. New here? Switch to Sign up."
            : "That email already has an account with a different password. Switch to Log in.");
        }
        throw new Error(error.message);
      }
      // onAuthStateChange handles the redirect into the app.
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="welcome"><div className="welcome-card">
      <div className="wbrand">Nani<span className="accent">AI</span></div>
      <h2 className="wtitle">Eat like yourself again.</h2>
      <p className="wlede">Your private food companion — safe for your health, familiar to your culture. Sign in with your email, or create an account to save your profile securely.</p>
      <div className="authtabs">
        <button type="button" className={mode === "login" ? "on" : ""} onClick={() => { setMode("login"); setErr(""); }}>Log in</button>
        <button type="button" className={mode === "signup" ? "on" : ""} onClick={() => { setMode("signup"); setErr(""); }}>Sign up</button>
      </div>
      <form className="wform single" onSubmit={submit}>
        <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required /></label>
        <label>Password
          <span className="pwwrap">
            <input type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === "signup" ? "at least 8 characters" : "your password"} autoComplete={mode === "signup" ? "new-password" : "current-password"} required />
            <button type="button" className="pwtoggle" onClick={() => setShow((s) => !s)}>{show ? "hide" : "show"}</button>
          </span>
        </label>
        {email && !emailOk && <div className="tsearch-note">Enter a valid email address.</div>}
        {err && <div className="err">⚠ {err}</div>}
        <div className="wactions"><button className="run" type="submit" disabled={busy || !emailOk || password.length < 8}>{busy ? "Please wait…" : mode === "signup" ? "Create account →" : "Log in →"}</button></div>
      </form>
    </div></div>
  );
}

// ---------------- onboarding (one question at a time) ----------------
type Draft = Partial<Profile>;
const SPICE = ["mild", "medium", "hot"];
const DIET = [
  { v: "vegetarian", l: "Vegetarian" }, { v: "vegan", l: "Vegan" },
  { v: "egg", l: "Eggetarian" }, { v: "non_veg", l: "Non-vegetarian" }, { v: "other", l: "Other" },
];

// Optional per-user BYOK: add/replace/remove your own NVIDIA or Nebius API key.
// The key is sent once over HTTPS, encrypted at rest (AES-256-GCM), and NEVER
// returned to the browser — only a masked "Configured ••••abcd" status comes back.
// A Nebius key routes the user's requests through Nebius Token Factory.
function AiKeyManager({ compact }: { compact?: boolean }) {
  const [status, setStatus] = useState<{ configured: boolean; last4: string | null; provider?: string; model?: string | null; encryptionReady?: boolean } | null>(null);
  const [provider, setProvider] = useState<"nvidia" | "nebius">("nvidia");
  const [val, setVal] = useState("");
  const [model, setModel] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  async function token(): Promise<string | null> {
    const sb = supabaseConfigured() ? supabaseBrowser() : null;
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    return data.session?.access_token ?? null;
  }
  async function load() {
    const t = await token();
    if (!t) return;
    try {
      const r = await fetch("/api/ai-key", { headers: { authorization: `Bearer ${t}` } });
      if (r.ok) { const j = await r.json(); setStatus(j); if (j.provider) setProvider(j.provider); }
    } catch { /* non-fatal */ }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function save() {
    setBusy(true); setMsg(""); setErr("");
    try {
      const t = await token();
      if (!t) { setErr("Please sign in first."); return; }
      const r = await fetch("/api/ai-key", { method: "POST", headers: { authorization: `Bearer ${t}`, "content-type": "application/json" }, body: JSON.stringify({ key: val, provider, model: provider === "nebius" ? model : undefined }) });
      const j = await r.json();
      if (!r.ok) { setErr(j.error ?? "Could not save key."); return; }
      setVal(""); setShow(false); setMsg(`Saved. Your ${provider === "nebius" ? "Nebius" : "NVIDIA"} key is encrypted on the server.`); setStatus({ configured: true, last4: j.last4, provider: j.provider, model: j.model, encryptionReady: true });
    } catch { setErr("Could not save key."); }
    finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true); setMsg(""); setErr("");
    try {
      const t = await token();
      if (!t) { setErr("Please sign in first."); return; }
      const r = await fetch("/api/ai-key", { method: "DELETE", headers: { authorization: `Bearer ${t}` } });
      if (!r.ok) { const j = await r.json().catch(() => ({})); setErr(j.error ?? "Could not remove key."); return; }
      setStatus({ configured: false, last4: null, encryptionReady: true }); setMsg("Removed. NaniAI will use the default AI.");
    } catch { setErr("Could not remove key."); }
    finally { setBusy(false); }
  }

  const unavailable = status?.encryptionReady === false;
  return (
    <div className="aikey">
      <div className="aikey-head">
        <b>Your AI provider key</b> <span className="est-badge">optional</span>
      </div>
      <p className="ob-hint" style={{ marginTop: 0 }}>
        NaniAI works out of the box with its built-in AI — you don&rsquo;t need a key. Add your own
        key to use it instead: an <b>NVIDIA</b> key, or a <b>Nebius Token Factory</b> key (which runs
        your requests on Nebius). We encrypt it on our server and never show it again.
      </p>
      {unavailable && <div className="err">⚠ Key storage isn&rsquo;t enabled on this deployment yet. You can still use the default AI.</div>}
      {status?.configured
        ? <div className="aikey-status">✓ Configured ••••{status.last4} <span className="est-badge">{status.provider === "nebius" ? "Nebius" : "NVIDIA"}</span>
            <button type="button" className="run ghost" disabled={busy} onClick={remove} style={{ marginLeft: 8 }}>Remove</button>
          </div>
        : <div className="aikey-status muted">Using NaniAI&rsquo;s default AI (no personal key set).</div>}
      {!unavailable && (
        <>
          <div className="checks" style={{ marginTop: 8 }}>
            <button type="button" className={`check ${provider === "nvidia" ? "on" : ""}`} onClick={() => setProvider("nvidia")}>NVIDIA API</button>
            <button type="button" className={`check ${provider === "nebius" ? "on" : ""}`} onClick={() => setProvider("nebius")}>Nebius Token Factory</button>
          </div>
          {provider === "nebius" && (
            <input className="ob-input" style={{ marginTop: 8 }} value={model} onChange={(e) => setModel(e.target.value)}
              placeholder="Nebius model id (optional, e.g. an NVIDIA model Token Factory serves)" />
          )}
          <div className="dishadd" style={{ marginTop: 8 }}>
            <input className="ob-input" type={show ? "text" : "password"} value={val} autoComplete="off"
              onChange={(e) => setVal(e.target.value)} placeholder={status?.configured ? "enter a new key to replace" : provider === "nebius" ? "your Nebius API key" : "nvapi-…"} />
            <button type="button" className="run ghost" onClick={() => setShow((s) => !s)}>{show ? "hide" : "show"}</button>
            <button type="button" className="run" disabled={busy || val.trim().length < 8} onClick={save}>{busy ? "Saving…" : status?.configured ? "Replace" : "Save"}</button>
          </div>
        </>
      )}
      {msg && <div className="ok" style={{ marginTop: 6 }}>{msg}</div>}
      {err && <div className="err" style={{ marginTop: 6 }}>⚠ {err}</div>}
      {!compact && <p className="est-note">Keys are stored encrypted (AES-256-GCM) and used only server-side. We never log or display your full key.</p>}
    </div>
  );
}

function Onboarding({ catalog, initial, onDone, onSignOut }: { catalog?: Catalog; initial: Profile; onDone: (p: Draft) => Promise<void>; onSignOut: () => void }) {
  const [step, setStep] = useState(0);
  const [d, setD] = useState<Draft>({
    preferred_name: initial.preferred_name ?? "", age: initial.age ?? null,
    dietary_pattern: initial.dietary_pattern ?? "", cuisines: initial.cuisines ?? [],
    region: initial.region ?? "", loved_dishes: initial.loved_dishes ?? [],
    allergies: initial.allergies ?? [], conditions: initial.conditions ?? [],
    medications: initial.medications ?? [], spice_tolerance: initial.spice_tolerance ?? "",
    texture_max: initial.texture_max ?? 7, emergency_name: initial.emergency_name ?? "", emergency_phone: initial.emergency_phone ?? "",
  });
  const [ageStr, setAgeStr] = useState<string>(initial.age != null ? String(initial.age) : "");
  const [dishInput, setDishInput] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (patch: Draft) => setD((x) => ({ ...x, ...patch }));
  const setLife = (k: string, v: any) => setD((x) => ({ ...x, lifestyle: { ...((x.lifestyle as any) || {}), [k]: v } }));
  const toggle = (key: keyof Draft, v: string) => {
    const arr = (d[key] as string[]) ?? [];
    set({ [key]: arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v] } as Draft);
  };
  const life = (d.lifestyle as any) || {};
  const cuisineList = catalog?.cuisineOptions?.length ? catalog.cuisineOptions : (catalog?.cuisines ?? []);

  const steps = [
    { key: "name", required: true, bg: "bg-warm", q: "What should we call you?",
      body: <input className="ob-input" value={d.preferred_name ?? ""} onChange={(e) => set({ preferred_name: e.target.value })} placeholder="e.g. Lakshmi" autoFocus /> },
    { key: "age", required: false, bg: "bg-sun", q: "How old are you?", hint: "Helps tailor portions and nutrition.",
      body: <input className="ob-input" inputMode="numeric" value={ageStr} onChange={(e) => { const v = e.target.value; if (v === "" || /^\d{1,3}$/.test(v)) { setAgeStr(v); set({ age: v === "" ? null : parseInt(v, 10) }); } }} placeholder="e.g. 68" /> },
    { key: "gender", required: false, bg: "bg-spice", q: "How should we picture you?", hint: "Sets your avatar. Optional — pick whatever feels right.",
      body: <div className="checks">{[{ e: "👩", v: "female", l: "Woman" }, { e: "👨", v: "male", l: "Man" }, { e: "🧑", v: "other", l: "Prefer not to say" }].map((o) => <button key={o.v} className={`check ${life.gender === o.v ? "on" : ""}`} onClick={() => setLife("gender", o.v)}>{o.e} {o.l}</button>)}</div> },
    { key: "stage", required: false, bg: "bg-warm", q: "Anything special about right now?", hint: "So we can be extra helpful. Optional.",
      body: <div className="checks">{["New mom / breastfeeding", "Recovering from illness", "Pregnant", "Managing weight", "Just want to eat better", "None of these"].map((v) => <button key={v} className={`check ${life.stage === v ? "on" : ""}`} onClick={() => setLife("stage", v)}>{v}</button>)}</div> },
    { key: "diet", required: false, bg: "bg-leaf", q: "How do you eat?",
      body: <div className="checks">{DIET.map((o) => <button key={o.v} className={`check ${d.dietary_pattern === o.v ? "on" : ""}`} onClick={() => set({ dietary_pattern: o.v })}>{o.l}</button>)}</div> },
    { key: "cuisines", required: false, bg: "bg-spice", q: "Which cuisines do you love?", hint: "Pick any — we never guess from where you live.",
      body: <SearchMulti options={cuisineList} selected={(d.cuisines as string[]) ?? []} onToggle={(v) => toggle("cuisines", v)} placeholder="search or type a cuisine…" /> },
    { key: "region", required: false, bg: "bg-warm", q: "Where do you call home?", hint: "Optional — sharpens local taste. Doesn't decide your cuisine.",
      body: <><input className="ob-input" list="ob-regions" value={d.region ?? ""} onChange={(e) => set({ region: e.target.value })} placeholder="state / UT (optional)" /><datalist id="ob-regions">{(catalog?.regions ?? []).map((r) => <option key={r} value={r} />)}</datalist></> },
    { key: "loved", required: false, bg: "bg-sun", q: "Any favourite dishes?", hint: "Type ANY dish in your own words.",
      body: <>
        <div className="dishadd"><input className="ob-input" value={dishInput} onChange={(e) => setDishInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && dishInput.trim()) { e.preventDefault(); toggle("loved_dishes", dishInput.trim()); setDishInput(""); } }} placeholder="e.g. Hyderabadi biryani" /><button type="button" className="run ghost" onClick={() => { if (dishInput.trim()) { toggle("loved_dishes", dishInput.trim()); setDishInput(""); } }}>Add</button></div>
        <div className="checks" style={{ marginTop: 8 }}>{((d.loved_dishes as string[]) ?? []).map((f) => <button key={f} className="check on" onClick={() => toggle("loved_dishes", f)}>♥ {f} ✕</button>)}</div>
      </> },
    { key: "allergies", required: false, bg: "bg-leaf", q: "Any allergies or intolerances?", hint: "Important for safety. Type any — search or add your own. Skip if none.",
      body: <SearchMulti options={catalog?.allergies ?? []} selected={(d.allergies as string[]) ?? []} onToggle={(v) => toggle("allergies", v)} placeholder="search / type an allergy…" /> },
    { key: "conditions", required: false, bg: "bg-spice", q: "Any health conditions to respect?", hint: "Optional and private — type ANY condition in your own words. Selecting one is not a diagnosis.",
      body: <SearchMultiRemote type="conditions" selected={(d.conditions as string[]) ?? []} onToggle={(v) => toggle("conditions", v)} placeholder="e.g. hypothyroidism, celiac disease…" /> },
    { key: "meds", required: false, bg: "bg-warm", q: "Any medications?", hint: "Only if you'd like us to watch for food interactions. Type any — search or add your own. Optional.",
      body: <SearchMultiRemote type="medications" selected={(d.medications as string[]) ?? []} onToggle={(v) => toggle("medications", v)} placeholder="search a medicine or type your own…" /> },
    { key: "lifestyle", required: false, bg: "bg-sun", q: "Tell us about your day", hint: "So meals fit your real routine — not everyone cooks at home at fixed times.",
      body: <>
        <div className="ob-sub">You are a…</div>
        <div className="checks">{(catalog?.lifestyleRoles ?? ["Working professional", "Student", "Homemaker", "Retired", "Other"]).map((r) => <button key={r} className={`check ${life.role === r ? "on" : ""}`} onClick={() => setLife("role", r)}>{r}</button>)}</div>
        <div className="ob-sub" style={{ marginTop: 12 }}>You live…</div>
        <div className="checks">{["With parents/family", "With spouse/kids", "Alone", "Shared / PG / hostel"].map((v) => <button key={v} className={`check ${life.livesWith === v ? "on" : ""}`} onClick={() => setLife("livesWith", v)}>{v}</button>)}</div>
        <div className="ob-sub" style={{ marginTop: 12 }}>Does work/college provide food?</div>
        <div className="checks">{["Yes, cafeteria/canteen", "Sometimes", "No, I arrange my own"].map((v) => <button key={v} className={`check ${life.workplaceFood === v ? "on" : ""}`} onClick={() => setLife("workplaceFood", v)}>{v}</button>)}</div>
        <div className="ob-sub" style={{ marginTop: 12 }}>Time you have to cook</div>
        <div className="checks">{["Under 15 min", "15–30 min", "30–60 min", "I don't cook"].map((v) => <button key={v} className={`check ${life.cooking === v ? "on" : ""}`} onClick={() => setLife("cooking", v)}>{v}</button>)}</div>
        <div className="ob-sub" style={{ marginTop: 12 }}>How active is your day?</div>
        <div className="checks">{["Mostly sitting", "Moderately active", "On my feet a lot"].map((v) => <button key={v} className={`check ${life.activity === v ? "on" : ""}`} onClick={() => setLife("activity", v)}>{v}</button>)}</div>
        <div className="ob-sub" style={{ marginTop: 12 }}>Cooking for how many?</div>
        <div className="checks">{["Just me", "2", "3–4", "5+"].map((v) => <button key={v} className={`check ${life.servings === v ? "on" : ""}`} onClick={() => setLife("servings", v)}>{v}</button>)}</div>
      </> },
    { key: "disliked", required: false, bg: "bg-spice", q: "Anything you'd rather avoid?", hint: "Ingredients or dishes you dislike — type any. We'll keep them off your plate.",
      body: <SearchMulti options={[]} selected={(d.disliked as string[]) ?? []} onToggle={(v) => toggle("disliked", v)} placeholder="e.g. bitter gourd, mushrooms…" /> },
    { key: "goals", required: false, bg: "bg-leaf", q: "What do you want help with?", hint: "Pick any — we'll shape suggestions around these.",
      body: <div className="checks">{(catalog?.goalOptions ?? []).map((g) => <button key={g} className={`check ${((d.goals as string[]) ?? []).includes(g) ? "on" : ""}`} onClick={() => toggle("goals", g)}>{g}</button>)}</div> },
    { key: "pref", required: false, bg: "bg-leaf", q: "Taste & texture",
      body: <>
        <div className="ob-sub">Spice</div>
        <div className="checks">{SPICE.map((s) => <button key={s} className={`check ${d.spice_tolerance === s ? "on" : ""}`} onClick={() => set({ spice_tolerance: s })}>{s}</button>)}</div>
        <div className="ob-sub" style={{ marginTop: 12 }}>Chewing / swallowing ease: <b>{d.texture_max}</b> <small>(0 = liquids only, 7 = any)</small></div>
        <input type="range" min={0} max={7} value={d.texture_max ?? 7} onChange={(e) => set({ texture_max: +e.target.value })} style={{ width: "100%", accentColor: "var(--saffron)" }} />
      </> },
    { key: "emergency", required: false, bg: "bg-leaf", q: "A trusted emergency contact?", hint: "Optional. Lets you message them fast from the 🚨 button. We never message anyone automatically.",
      body: <>
        <input className="ob-input" value={d.emergency_name ?? ""} onChange={(e) => set({ emergency_name: e.target.value })} placeholder="Contact name (e.g. Priya, daughter)" />
        <input className="ob-input" style={{ marginTop: 8 }} value={d.emergency_phone ?? ""} onChange={(e) => set({ emergency_phone: e.target.value.replace(/[^\d+]/g, "") })} placeholder="+9198XXXXXXXX (with country code)" />
      </> },
    { key: "aikey", required: false, bg: "bg-sun", q: "Bring your own AI key? (optional)", hint: "Totally optional — NaniAI already includes AI. Add your own NVIDIA or Nebius key only if you want to use it.",
      body: <AiKeyManager compact /> },
  ];

  const cur = steps[step];
  const pct = Math.round(((step + 1) / steps.length) * 100);
  const canNext = !cur.required || !!(d.preferred_name && String(d.preferred_name).trim());

  async function finish() {
    setBusy(true);
    try { await onDone(d); } finally { setBusy(false); }
  }

  return (
    <div className={`onboard ${cur.bg}`}>
      <div className="ob-topbar">
        <div className="wbrand">Nani<span className="accent">AI</span></div>
        <button className="signout" onClick={onSignOut}>sign out</button>
      </div>
      <div className="ob-card">
        <div className="ob-progress"><span style={{ width: `${pct}%` }} /></div>
        <div className="ob-step">Step {step + 1} of {steps.length}</div>
        <h2 className="ob-q">{cur.q}</h2>
        {cur.hint && <p className="ob-hint">{cur.hint}</p>}
        <div className="ob-body">{cur.body}</div>
        <div className="ob-nav">
          {step > 0 && <button className="run ghost" onClick={() => setStep((s) => s - 1)}>← Back</button>}
          <span style={{ flex: 1 }} />
          {!cur.required && step < steps.length - 1 && <button className="run ghost" onClick={() => setStep((s) => s + 1)}>Skip</button>}
          {step < steps.length - 1
            ? <button className="run" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>Continue →</button>
            : <button className="run" disabled={busy} onClick={finish}>{busy ? "Saving…" : "Finish & plan meals"}</button>}
        </div>
      </div>
    </div>
  );
}

// ---------------- remote terminology search (NLM Clinical Tables) ----------------
function SearchMultiRemote({ type, selected, onToggle, placeholder }: { type: "conditions" | "medications"; selected: string[]; onToggle: (v: string) => void; placeholder?: string }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<string[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const abortRef = useRef<AbortController | null>(null);
  const listId = useId();
  useEffect(() => {
    const ql = q.trim();
    if (ql.length < 2) { setResults([]); setState("idle"); return; }
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setState("loading");
      try {
        const r = await fetch(`/api/terminology?type=${type}&q=${encodeURIComponent(ql)}`, { signal: ctrl.signal });
        const j = await r.json();
        setResults(Array.isArray(j.results) ? j.results : []);
        setState(j.error ? "error" : "idle");
      } catch (e) {
        if ((e as any)?.name !== "AbortError") setState("error");
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [q, type]);

  const ql = q.trim();
  const lowerSel = selected.map((s) => s.toLowerCase());
  const canAdd = ql.length >= 2 && !results.some((r) => r.toLowerCase() === ql.toLowerCase()) && !lowerSel.includes(ql.toLowerCase());
  const add = (v: string) => { if (selected.length >= 30 || lowerSel.includes(v.toLowerCase())) return; onToggle(v); setQ(""); setResults([]); };

  return (
    <>
      <input className="ob-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder}
        role="combobox" aria-expanded={results.length > 0} aria-controls={listId} aria-autocomplete="list" aria-label={placeholder}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); const top = results.find((r) => !lowerSel.includes(r.toLowerCase())); if (top) add(top); else if (canAdd) add(ql); } }} />
      {selected.length > 0 && <div className="checks" style={{ marginTop: 8 }}>{selected.map((s) => <button key={s} className="check on" onClick={() => onToggle(s)}>{s} ✕</button>)}</div>}
      <div className="checks" id={listId} role="listbox" aria-label={placeholder} style={{ marginTop: 8 }}>
        {state === "loading" && <span className="tsearch-note">Searching…</span>}
        {state === "error" && <span className="tsearch-note">Search is unavailable right now — you can still type your own below.</span>}
        {canAdd && <button className="check" onClick={() => add(ql)}>+ Add “{ql}” <span className="tbadge custom">your words</span></button>}
        {results.filter((r) => !lowerSel.includes(r.toLowerCase())).map((r) => <button key={r} className="check" onClick={() => add(r)}>{r} <span className="tbadge cat">catalog</span></button>)}
        {state === "idle" && ql.length >= 2 && results.length === 0 && !canAdd && <span className="tsearch-note">No match — your entry is kept as typed.</span>}
      </div>
      <div className="disclaimer">Suggestions from NLM Clinical Tables (US terminology) — not every condition/medicine worldwide. Your own words are always accepted and kept exactly.</div>
    </>
  );
}

function SearchMulti({ options, selected, onToggle, placeholder }: { options: string[]; selected: string[]; onToggle: (v: string) => void; placeholder?: string }) {
  const [q, setQ] = useState("");
  const ql = q.trim().toLowerCase();
  const filtered = ql ? options.filter((o) => o.toLowerCase().includes(ql)).slice(0, 10) : options.slice(0, 10);
  const canAdd = ql && !options.some((o) => o.toLowerCase() === ql) && !selected.some((s) => s.toLowerCase() === ql);
  return (
    <>
      <input className="ob-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          const top = filtered.find((o) => !selected.includes(o));
          if (top) { onToggle(top); setQ(""); }
          else if (canAdd) { onToggle(q.trim()); setQ(""); }
        }} />
      {selected.length > 0 && <div className="checks" style={{ marginTop: 8 }}>{selected.map((s) => <button key={s} className="check on" onClick={() => onToggle(s)}>{s} ✕</button>)}</div>}
      <div className="checks" style={{ marginTop: 8 }}>
        {canAdd && <button className="check" onClick={() => { onToggle(q.trim()); setQ(""); }}>+ Add “{q.trim()}”</button>}
        {filtered.filter((o) => !selected.includes(o)).map((o) => <button key={o} className="check" onClick={() => onToggle(o)}>{o}</button>)}
      </div>
    </>
  );
}

// ---------------- profile page (dedicated full-screen) ----------------
function ProfilePage({ catalog, profile, onBack, onSave, onSignOut }: { catalog: Catalog; profile: Profile; onBack: () => void; onSave: (p: Partial<Profile>) => Promise<void>; onSignOut: () => void }) {
  const [d, setD] = useState<Partial<Profile>>({ ...profile, lifestyle: profile.lifestyle || {} });
  const [ageStr, setAgeStr] = useState(profile.age != null ? String(profile.age) : "");
  const [dishInput, setDishInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const set = (patch: Partial<Profile>) => setD((x) => ({ ...x, ...patch }));
  const setLife = (k: string, v: any) => setD((x) => ({ ...x, lifestyle: { ...(x.lifestyle || {}), [k]: v } }));
  const toggle = (key: keyof Profile, v: string) => { const arr = (d[key] as string[]) ?? []; set({ [key]: arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v] } as Partial<Profile>); };
  const cuisineList = catalog.cuisineOptions?.length ? catalog.cuisineOptions : catalog.cuisines;
  const life = (d.lifestyle || {}) as Record<string, any>;

  async function save() {
    setBusy(true); setMsg("");
    try {
      await onSave({
        preferred_name: d.preferred_name, age: ageStr === "" ? null : parseInt(ageStr, 10),
        dietary_pattern: d.dietary_pattern, cuisines: d.cuisines, region: d.region,
        loved_dishes: d.loved_dishes, allergies: d.allergies, conditions: d.conditions,
        medications: d.medications, spice_tolerance: d.spice_tolerance, texture_max: d.texture_max,
        lifestyle: d.lifestyle, goals: d.goals,
        emergency_name: d.emergency_name, emergency_phone: d.emergency_phone,
      });
      setMsg("Saved ✓");
    } catch (e) { setMsg("Could not save: " + (e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="wrap">
      <header className="header">
        <div className="brand"><h1>My profile</h1><p>Everything NaniAI uses to keep your meals safe and familiar. Edit anytime.</p></div>
        <nav className="topnav">
          <button className="navbtn" onClick={onBack}>← Back</button>
          <button className="navbtn ghost" onClick={onSignOut}>Sign out</button>
        </nav>
      </header>

      <div className="profile-grid">
        <section className="pcard">
          <h3>Personal</h3>
          <div className="brow">
            <label>Name<input value={d.preferred_name ?? ""} onChange={(e) => set({ preferred_name: e.target.value })} /></label>
            <label>Age<input inputMode="numeric" value={ageStr} onChange={(e) => { const v = e.target.value; if (v === "" || /^\d{1,3}$/.test(v)) setAgeStr(v); }} placeholder="e.g. 68" /></label>
            <label>Home region<input list="pe-regions" value={d.region ?? ""} onChange={(e) => set({ region: e.target.value })} /><datalist id="pe-regions">{catalog.regions.map((r) => <option key={r} value={r} />)}</datalist></label>
          </div>
        </section>

        <section className="pcard">
          <h3>Taste</h3>
          <div className="bfield"><span>Cuisines you love</span><SearchMulti options={cuisineList} selected={(d.cuisines as string[]) ?? []} onToggle={(v) => toggle("cuisines", v)} placeholder="search / add a cuisine…" /></div>
          <div className="bfield"><span>Favourite dishes <small>(type any)</small></span>
            <div className="dishadd"><input value={dishInput} onChange={(e) => setDishInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && dishInput.trim()) { e.preventDefault(); toggle("loved_dishes", dishInput.trim()); setDishInput(""); } }} placeholder="e.g. Hyderabadi biryani" /><button type="button" className="run ghost" onClick={() => { if (dishInput.trim()) { toggle("loved_dishes", dishInput.trim()); setDishInput(""); } }}>Add</button></div>
            <div className="checks" style={{ marginTop: 8 }}>{((d.loved_dishes as string[]) ?? []).map((f) => <button key={f} className="check on" onClick={() => toggle("loved_dishes", f)}>♥ {f} ✕</button>)}</div>
          </div>
          <div className="bfield"><span>Dietary pattern</span><div className="checks">{DIET.map((o) => <button key={o.v} className={`check ${d.dietary_pattern === o.v ? "on" : ""}`} onClick={() => set({ dietary_pattern: o.v })}>{o.l}</button>)}</div></div>
          <div className="bfield"><span>Spice</span><div className="checks">{SPICE.map((s) => <button key={s} className={`check ${d.spice_tolerance === s ? "on" : ""}`} onClick={() => set({ spice_tolerance: s })}>{s}</button>)}</div></div>
          <div className="bfield"><span>Chewing / swallowing ease: <b>{d.texture_max ?? 7}</b></span><input type="range" min={0} max={7} value={d.texture_max ?? 7} onChange={(e) => set({ texture_max: +e.target.value })} style={{ width: "100%", accentColor: "var(--saffron)" }} /></div>
        </section>

        <section className="pcard">
          <h3>Health <small>(private)</small></h3>
          <div className="bfield"><span>Allergies &amp; intolerances</span><SearchMulti options={catalog.allergies} selected={(d.allergies as string[]) ?? []} onToggle={(v) => toggle("allergies", v)} placeholder="search / type an allergy…" /></div>
          <div className="bfield"><span>Health conditions</span><SearchMultiRemote type="conditions" selected={(d.conditions as string[]) ?? []} onToggle={(v) => toggle("conditions", v)} placeholder="search / type any condition…" /></div>
          <div className="bfield"><span>Medications</span><SearchMultiRemote type="medications" selected={(d.medications as string[]) ?? []} onToggle={(v) => toggle("medications", v)} placeholder="search / type a medication…" /></div>
          <div className="disclaimer">Only diabetes, hypertension, kidney disease and swallowing difficulty currently drive automatic safety limits; other entries are saved so the assistant and your clinician can see them. Not a diagnosis.</div>
        </section>

        <section className="pcard">
          <h3>Lifestyle &amp; routine</h3>
          <div className="bfield"><span>You are a…</span><div className="checks">{(catalog.lifestyleRoles ?? []).map((r) => <button key={r} className={`check ${life.role === r ? "on" : ""}`} onClick={() => setLife("role", r)}>{r}</button>)}</div></div>
          <div className="bfield"><span>Where do you live?</span><div className="checks">{["With parents/family", "With spouse/kids", "Alone", "Shared / PG / hostel"].map((v) => <button key={v} className={`check ${life.livesWith === v ? "on" : ""}`} onClick={() => setLife("livesWith", v)}>{v}</button>)}</div></div>
          <div className="bfield"><span>Does your workplace/college provide food?</span><div className="checks">{["Yes, cafeteria/canteen", "Sometimes", "No, I arrange my own"].map((v) => <button key={v} className={`check ${life.workplaceFood === v ? "on" : ""}`} onClick={() => setLife("workplaceFood", v)}>{v}</button>)}</div></div>
          <div className="bfield"><span>Cooking time you usually have</span><div className="checks">{["Under 15 min", "15–30 min", "30–60 min", "I don't cook"].map((v) => <button key={v} className={`check ${life.cooking === v ? "on" : ""}`} onClick={() => setLife("cooking", v)}>{v}</button>)}</div></div>
          <div className="bfield"><span>Your meal times <small>(0–23h; drives what the dashboard shows now)</small></span>
            <div className="sched-grid">
              {(["breakfast", "lunch", "snack", "dinner"] as const).map((s) => (
                <label key={s} className="sched-cell">{SLOT_EMOJI[s]} {s}
                  <input type="number" min={0} max={23} value={(readSchedule(life.schedule) as any)[s]}
                    onChange={(e) => { const h = Math.max(0, Math.min(23, parseInt(e.target.value, 10) || 0)); setLife("schedule", { ...readSchedule(life.schedule), [s]: h }); }} />
                </label>
              ))}
            </div>
          </div>
          <div className="bfield"><span>A note about your typical day <small>(optional)</small></span><textarea className="ob-input" rows={2} value={life.routine ?? ""} onChange={(e) => setLife("routine", e.target.value)} placeholder="e.g. Long office hours, dinner late, skip breakfast…" /></div>
        </section>

        <section className="pcard">
          <h3>Goals</h3>
          <div className="checks">{(catalog.goalOptions ?? []).map((g) => <button key={g} className={`check ${((d.goals as string[]) ?? []).includes(g) ? "on" : ""}`} onClick={() => toggle("goals", g)}>{g}</button>)}</div>
        </section>

        <section className="pcard">
          <h3>Emergency contact</h3>
          <div className="brow">
            <label>Name<input value={d.emergency_name ?? ""} onChange={(e) => set({ emergency_name: e.target.value })} placeholder="e.g. Priya (daughter)" /></label>
            <label>Phone (with country code)<input value={d.emergency_phone ?? ""} onChange={(e) => set({ emergency_phone: e.target.value.replace(/[^\d+]/g, "") })} placeholder="+9198XXXXXXXX" /></label>
          </div>
        </section>

        <section className="pcard">
          <h3>AI Provider &amp; API keys</h3>
          <AiKeyManager />
        </section>
      </div>

      <div className="cta sticky-save">
        <button className="run" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save changes"}</button>
        <button className="run ghost" onClick={onBack}>Done</button>
        {msg && <span className={msg.startsWith("Saved") ? "ok" : "err"} style={{ padding: "0 8px" }}>{msg}</span>}
      </div>
    </div>
  );
}

// ---------------- emergency ----------------
function isValidPhone(p: string): boolean { const d = (p || "").replace(/\D/g, ""); return d.length >= 8 && d.length <= 15; }

function EmergencyScreen({ profile, onClose, onSave, onReopen }: { profile: Profile; onClose: () => void; onSave: (p: Partial<Profile>) => Promise<void>; onReopen: () => void }) {
  const hasContact = isValidPhone(profile.emergency_phone ?? "");
  const [editing, setEditing] = useState(!hasContact);
  const [eName, setEName] = useState(profile.emergency_name ?? "");
  const [ePhone, setEPhone] = useState(profile.emergency_phone ?? "");
  const [busy, setBusy] = useState(false);
  const phoneOk = isValidPhone(ePhone);

  const HELPLINES = [
    { n: "112", l: "National emergency (India)" },
    { n: "108", l: "Ambulance (India)" },
    { n: "104", l: "Health advice (India)" },
    { n: "14416", l: "Tele-MANAS mental health (India)" },
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal emg-screen" role="dialog" aria-label="Emergency" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><b>🚨 You&rsquo;re not alone</b><button className="signout" onClick={onClose}>close</button></div>

        <div className="emg-alert">If this is life-threatening, call your local emergency number now. Numbers below are for <b>India</b> — if you&rsquo;re elsewhere, use your country&rsquo;s emergency number.</div>

        {hasContact && !editing && (
          <div className="emg-opened">✓ WhatsApp opened in a new tab for <b>{profile.emergency_name || "your contact"}</b> — press send there to alert them. Opening it doesn&rsquo;t send it automatically.
            <button className="run ghost" style={{ marginTop: 8 }} onClick={onReopen}>Open WhatsApp again</button>
          </div>
        )}

        <div className="breathe">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/breathe.gif" alt="A calming animation guiding you to breathe in deeply, hold, and breathe out" />
          <p>While help is on the way, breathe with the animation — in… hold… out. You&rsquo;re doing the right thing.</p>
        </div>

        <div className="helplines">
          {HELPLINES.map((h) => (
            <a key={h.n} className="helpline" href={`tel:${h.n}`}><span className="hn">{h.n}</span><span className="hl">{h.l}</span></a>
          ))}
        </div>

        {editing ? (
          <div className="emg-edit">
            <div className="emg-sub">Add a trusted contact so you can reach them in one tap next time:</div>
            <label>Contact name<input value={eName} onChange={(e) => setEName(e.target.value)} placeholder="e.g. Priya (daughter)" /></label>
            <label>Phone with country code<input value={ePhone} onChange={(e) => setEPhone(e.target.value.replace(/[^\d+]/g, ""))} placeholder="+9198XXXXXXXX" /></label>
            {!phoneOk && ePhone.length > 0 && <div className="emg-err">Enter a valid number with country code (8–15 digits).</div>}
            <div className="cta">
              <button className="run" disabled={!phoneOk || busy} onClick={async () => { setBusy(true); try { await onSave({ emergency_name: eName.trim() || null, emergency_phone: ePhone }); setEditing(false); } finally { setBusy(false); } }}>{busy ? "Saving…" : "Save contact"}</button>
              {hasContact && <button className="run ghost" onClick={() => setEditing(false)}>Cancel</button>}
            </div>
          </div>
        ) : (
          <button className="signout" style={{ marginTop: 10 }} onClick={() => setEditing(true)}>edit emergency contact</button>
        )}
      </div>
    </div>
  );
}

// ---------------- info popover (tap/hover) ----------------
function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="infotip"
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
      onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
      onBlur={() => setOpen(false)} tabIndex={0} role="button" aria-label="Why these meals were suggested">
      <span className="infotip-i">i</span>
      {open && <span className="infotip-pop">{text}</span>}
    </span>
  );
}

// ---------------- hover info tooltip end ----------------
// ---------------- Ask NaniAI chat widget ----------------
type ChatMsg = { role: "user" | "assistant"; content: string };
const SUGGESTED = ["What can I eat that's quick and familiar?", "What's a good swap for a dish I can't have?", "What's in Uttapam?", "Give me a light dinner idea"];

function ChatWidget({ profile }: { profile: any }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<ChatMsg[]>([{ role: "assistant", content: "Hi! I'm NaniAI. Ask me about meals, ingredients, substitutions, cooking, or general nutrition. For anything medical, I'll point you to your clinician." }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  async function send(text: string) {
    const q = text.trim(); if (!q || busy) return;
    const next = [...msgs, { role: "user" as const, content: q }];
    setMsgs(next); setInput(""); setBusy(true);
    try {
      const chHeaders: Record<string, string> = { "content-type": "application/json" };
      const chTok = supabaseConfigured() ? (await supabaseBrowser().auth.getSession()).data.session?.access_token : null;
      if (chTok) chHeaders.authorization = `Bearer ${chTok}`;
      const res = await fetch("/api/chat", { method: "POST", headers: chHeaders, body: JSON.stringify({ messages: next, profile }) });
      const j = await res.json();
      setMsgs((m) => [...m, { role: "assistant", content: j.reply ?? j.error ?? "Sorry, I couldn't answer that." }]);
    } catch { setMsgs((m) => [...m, { role: "assistant", content: "I'm having trouble connecting right now. Please try again." }]); }
    finally { setBusy(false); }
  }
  return (
    <>
      <button className="chat-fab" onClick={() => setOpen((o) => !o)} aria-label="Ask NaniAI">{open ? "✕" : "💬 Ask NaniAI"}</button>
      {open && (
        <div className="chat-panel" role="dialog" aria-label="Ask NaniAI assistant">
          <div className="chat-head"><b>Ask NaniAI</b></div>
          <div className="chat-body">
            {msgs.map((m, i) => <div key={i} className={`bubble ${m.role}`}>{m.content}</div>)}
            {busy && <div className="bubble assistant typing">NaniAI is thinking…</div>}
            {msgs.length <= 1 && <div className="suggest">{SUGGESTED.map((s) => <button key={s} onClick={() => send(s)}>{s}</button>)}</div>}
          </div>
          <form className="chat-input" onSubmit={(e) => { e.preventDefault(); send(input); }}>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask anything about food…" aria-label="Message" />
            <button type="submit" disabled={busy || !input.trim()}>Send</button>
          </form>
        </div>
      )}
    </>
  );
}

// ---------------- care panel ----------------
function CarePanel({ care }: { care: Care }) {
  const [scenario, setScenario] = useState<string>("");
  const active = care.emergencyScenarios.find((s) => s.id === scenario);
  return (
    <div className="panels">
      <div className="panel">
        <h3>🩺 Connect with the right specialist</h3>
        {care.specialists.length === 0 && <div className="rej">No condition-specific specialist needed.</div>}
        {care.specialists.map((s) => (
          <div className="rej" key={s.condition}><div className="n">{s.specialist}</div><div className="v" style={{ color: "var(--text-dim)" }}>for {s.why}</div><a className="yt" href={s.searchUrl} target="_blank" rel="noreferrer">Find one near you →</a></div>
        ))}
        <div className="disclaimer">We link you to a real local search — we never fake a booking.</div>
      </div>
      <div className="panel emergency">
        <h3>🚨 In case of emergency</h3>
        <div className="ice">
          <b>{care.ice.name}, {care.ice.age}</b>
          <div>Conditions: {care.ice.conditions.map((c) => COND_LABEL[c] ?? c).join(", ") || "none"}</div>
          <div>Medications: {care.ice.medications.join(", ") || "none"}</div>
          <div>Allergies: {care.ice.allergies.join(", ")}</div>
        </div>
        <div className="checks">{care.emergencyScenarios.map((s) => <button key={s.id} className={`check ${scenario === s.id ? "on" : ""}`} onClick={() => setScenario(scenario === s.id ? "" : s.id)}>{s.title.split(" (")[0]}</button>)}</div>
        {active && <div className="scenario"><div className="when">{active.whenToCall}</div><ol>{active.firstSteps.map((f, i) => <li key={i}>{f}</li>)}</ol></div>}
        <div className="disclaimer">{care.ice.note}</div>
      </div>
    </div>
  );
}
