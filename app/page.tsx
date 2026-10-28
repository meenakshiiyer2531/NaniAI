"use client";

import { useEffect, useMemo, useState } from "react";
import { buildRecipe } from "@/lib/recipes";
import { dayTotals } from "@/lib/nutrition";

// ---------- shapes mirroring the API ----------
type Dish = {
  id: string;
  name: string;
  cuisine: string;
  blurb: string;
  ingredients: string[];
  tags: string[];
  nutrition: { kcal: number; sugar_g: number; sodium_mg: number; carbs_g: number; potassium_mg?: number };
};
type Alt = { dish: Dish; familiarity: number; receipt: string[] };
type PlanItem = { slot: string; dish: Dish; familiarity: number; receipt: string[]; alternatives?: Alt[] };
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
  persona: any;
  grounded: PlanResponse;
  baseline: PlanResponse;
  rejected: { id: string; name: string; cuisine: string; loved: boolean; violations: string[] }[];
  care: Care;
};
type PresetPersona = {
  id: string; name: string; age: number; cuisine: string; region?: string;
  conditions: string[]; textureMax: number; lovedDishes: string[]; story: string;
};
type Catalog = {
  dishes: { id: string; name: string; cuisine: string; slots: string[] }[];
  cuisines: string[]; regions: string[];
  conditions: { id: string; label: string }[];
  allergies: string[]; medications: string[];
};
type CustomProfile = {
  id: string; name: string; age: number; cuisine: string; region?: string;
  conditions: string[]; medications: string[]; textureMax: number;
  allergies: string[]; lovedDishIds: string[]; story?: string;
};
type Account = { name: string; city?: string; createdAt: number; guest?: boolean };

const COND_LABEL: Record<string, string> = {
  type_2_diabetes: "Type 2 diabetes",
  hypertension: "hypertension",
  chronic_kidney_disease: "kidney disease",
  dysphagia: "swallowing difficulty",
};
const LS_KEY = "naniai.profiles.v1";
const FB_KEY = "naniai.feedback.v1"; // dishId -> "up" | "down"
const ACCT_KEY = "naniai.account.v1";

export default function Home() {
  const [presets, setPresets] = useState<PresetPersona[]>([]);
  const [status, setStatus] = useState<{ modelProvider: string; qlooConfigured: boolean }>();
  const [catalog, setCatalog] = useState<Catalog>();
  const [profiles, setProfiles] = useState<CustomProfile[]>([]);
  const [showBuilder, setShowBuilder] = useState(false);

  // current selection
  const [sel, setSel] = useState<{ kind: "preset"; id: string } | { kind: "custom"; profile: CustomProfile }>();

  const [day, setDay] = useState(0);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Comparison | null>(null);
  const [error, setError] = useState("");

  // interactive swap: slot -> index into [original, ...alternatives]
  const [swapIdx, setSwapIdx] = useState<Record<string, number>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // meal feedback: dishId -> "up" | "down", stored privately on device
  const [feedback, setFeedback] = useState<Record<string, "up" | "down">>({});
  // local-first account (name/city stored privately on this device)
  const [account, setAccount] = useState<Account | null>(null);
  const [acctLoaded, setAcctLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/personas").then((r) => r.json()).then((d) => {
      setPresets(d.personas);
      setStatus(d.status);
      if (!sel) setSel({ kind: "preset", id: d.personas[0]?.id });
    }).catch((e) => setError(String(e)));
    fetch("/api/catalog").then((r) => r.json()).then(setCatalog).catch(() => {});
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) setProfiles(JSON.parse(raw));
      const fb = localStorage.getItem(FB_KEY);
      if (fb) setFeedback(JSON.parse(fb));
      const ac = localStorage.getItem(ACCT_KEY);
      if (ac) setAccount(JSON.parse(ac));
    } catch {}
    setAcctLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function signIn(a: Account) {
    setAccount(a);
    try { localStorage.setItem(ACCT_KEY, JSON.stringify(a)); } catch {}
  }
  function signOut() {
    setAccount(null);
    try { localStorage.removeItem(ACCT_KEY); } catch {}
  }

  function saveProfiles(next: CustomProfile[]) {
    setProfiles(next);
    try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch {}
  }

  function rate(dishId: string, v: "up" | "down") {
    setFeedback((prev) => {
      const next = { ...prev };
      if (next[dishId] === v) delete next[dishId];
      else next[dishId] = v;
      try { localStorage.setItem(FB_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  async function run(nextDay = 0) {
    if (!sel) return;
    setLoading(true); setError(""); setData(null); setSwapIdx({}); setExpanded({});
    try {
      const body = sel.kind === "preset"
        ? { personaId: sel.id, day: nextDay }
        : { persona: sel.profile, day: nextDay };
      const res = await fetch("/api/plan", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "request failed");
      setData(json);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }

  // effective grounded items after interactive swaps
  const effItems: PlanItem[] = useMemo(() => {
    if (!data) return [];
    return data.grounded.plan.items.map((it) => {
      const opts = [it, ...(it.alternatives ?? []).map((a) => ({ ...it, dish: a.dish, familiarity: a.familiarity, receipt: a.receipt }))];
      const idx = (swapIdx[it.slot] ?? 0) % opts.length;
      return opts[idx];
    });
  }, [data, swapIdx]);

  const totals = useMemo(() => (effItems.length ? dayTotals(effItems) : null), [effItems]);
  const grocery = useMemo(() => {
    const set = new Set<string>();
    effItems.forEach((it) => it.dish.ingredients.forEach((i) => set.add(i)));
    return Array.from(set).sort();
  }, [effItems]);

  const delta = data ? data.grounded.plan.avgFamiliarity - data.baseline.plan.avgFamiliarity : 0;

  if (!acctLoaded) return <div className="boot" />;
  if (!account) return <Welcome onSignIn={signIn} />;

  return (
    <div className="wrap">
      <header className="header">
        <div className="brand">
          <h1>Nani<span className="accent">AI</span></h1>
          <p>Meals that respect your <b>health limits</b> and your <b>culture</b>. A deterministic
            clinical-safety gate negotiates with Qloo&rsquo;s cultural taste graph — safe advice that
            still tastes like home. Built for grandmothers; works for your whole family.</p>
        </div>
        <div className="chips">
          <span className="chip acct">👤 <b>{account.name}</b>{account.city ? ` · ${account.city}` : ""}<button className="signout" onClick={signOut}>sign out</button></span>
          <span className={`chip ${status?.qlooConfigured ? "live" : "mock"}`}>Qloo:&nbsp;<b>{status?.qlooConfigured ? "live key" : "mock graph"}</b></span>
          <span className="chip">Brain:&nbsp;<b>{status?.modelProvider ?? "…"}</b></span>
          <span className="chip">🔒 data stays on device</span>
        </div>
      </header>

      <div className="greeting">Welcome back, <b>{account.name}</b> 👋 — let&rsquo;s plan meals that feel like home and keep you well.</div>

      {/* ---------- profile selection ---------- */}
      <div className="section-label">1 · Choose a person</div>
      <div className="personas">
        {presets.map((p) => (
          <button key={p.id} className={`persona ${sel?.kind === "preset" && sel.id === p.id ? "active" : ""}`}
            onClick={() => { setSel({ kind: "preset", id: p.id }); setData(null); }}>
            <div className="name">{p.name}, {p.age}</div>
            <div className="meta">{p.region ? `${p.region} · ` : ""}{p.cuisine} · chewing ≤ {p.textureMax}</div>
            <div className="tags">
              {p.conditions.length === 0 && <span className="tag">no medical limits</span>}
              {p.conditions.map((c) => <span key={c} className="tag cond">{COND_LABEL[c] ?? c}</span>)}
              {p.lovedDishes.slice(0, 2).map((d) => <span key={d} className="tag loves">♥ {d}</span>)}
            </div>
          </button>
        ))}
      </div>

      <div className="section-label">
        2 · Your Kitchen <span style={{ textTransform: "none", letterSpacing: 0, color: "var(--text-faint)" }}>— build &amp; save a profile (stored privately on this device)</span>
      </div>
      <div className="personas">
        {profiles.map((p) => (
          <div key={p.id} className={`persona ${sel?.kind === "custom" && sel.profile.id === p.id ? "active" : ""}`}
            onClick={() => { setSel({ kind: "custom", profile: p }); setData(null); }} style={{ cursor: "pointer" }}>
            <div className="name">{p.name}, {p.age}</div>
            <div className="meta">{p.region ? `${p.region} · ` : ""}{p.cuisine} · chewing ≤ {p.textureMax}</div>
            <div className="tags">
              {p.conditions.length === 0 && <span className="tag">no medical limits</span>}
              {p.conditions.map((c) => <span key={c} className="tag cond">{COND_LABEL[c] ?? c}</span>)}
            </div>
            <button className="mini-del" onClick={(e) => { e.stopPropagation(); saveProfiles(profiles.filter((x) => x.id !== p.id)); if (sel?.kind === "custom" && sel.profile.id === p.id) setSel(undefined); }}>remove</button>
          </div>
        ))}
        <button className="persona add" onClick={() => setShowBuilder((s) => !s)}>
          <div className="name">＋ New profile</div>
          <div className="meta">for yourself or someone you care for</div>
        </button>
      </div>

      {showBuilder && catalog && (
        <ProfileBuilder catalog={catalog} onCancel={() => setShowBuilder(false)}
          onSave={(prof) => { const next = [...profiles, prof]; saveProfiles(next); setShowBuilder(false); setSel({ kind: "custom", profile: prof }); setData(null); }} />
      )}

      {/* ---------- run ---------- */}
      <div className="cta">
        <button className="run" onClick={() => { setDay(0); run(0); }} disabled={loading || !sel}>
          {loading ? "Agents negotiating…" : "Plan a day"}
        </button>
        {data && <button className="run ghost" onClick={() => { const d = day + 1; setDay(d); run(d); }} disabled={loading}>↻ Another day&rsquo;s ideas</button>}
        <span className="chip">Clinician → Culture → Negotiator</span>
      </div>

      {error && <div className="err">⚠ {error}</div>}
      {loading && <div className="spinner">Running the three-agent workflow…</div>}

      {data && totals && (
        <>
          <div className="section-label">The difference Qloo makes</div>
          <div className="headline">
            <div className="metric win"><div className="big">{data.grounded.plan.avgFamiliarity}</div><div className="lbl">Familiarity — with Qloo</div></div>
            <div className="metric lose"><div className="big">{data.baseline.plan.avgFamiliarity}</div><div className="lbl">Familiarity — generic chart</div></div>
            <div className="metric win"><div className="big">+{delta}</div><div className="lbl">Gained from Qloo</div></div>
            <div className="metric"><div className="big" style={{ color: "var(--teal)" }}>{data.grounded.plan.violationCount}</div><div className="lbl">Safety violations</div></div>
          </div>

          {/* baseline contrast (compact) */}
          <div className="baseline-strip">
            <b>Generic diet chart would serve:</b> {data.baseline.plan.items.map((i) => `${i.dish.name}`).join(" · ")}
            {data.baseline.substitutions.length > 0 && <span className="blind-note"> — and drops favorites for {data.baseline.substitutions.map((s) => s.tradeoff.match(/suggests "([^"]+)"/)?.[1]).filter(Boolean).join(", ")}.</span>}
          </div>

          {/* ---------- interactive day ---------- */}
          <div className="section-label">Your day — tap a meal for recipe, video &amp; swap</div>
          <div className="day-grid">
            {effItems.map((it) => {
              const recipe = buildRecipe(it.dish as any);
              const isOpen = expanded[it.slot];
              const orig = data.grounded.plan.items.find((o) => o.slot === it.slot)!;
              const optCount = 1 + (orig.alternatives?.length ?? 0);
              return (
                <div className="meal" key={it.slot}>
                  <div className="meal-top" onClick={() => setExpanded((e) => ({ ...e, [it.slot]: !e[it.slot] }))}>
                    <div>
                      <div className="slot">{it.slot}</div>
                      <div className="dish">{it.dish.name}</div>
                      <div className="cuis">{it.dish.cuisine} · familiarity {it.familiarity}</div>
                    </div>
                    <div className="chev">{isOpen ? "▾" : "▸"}</div>
                  </div>
                  <div className="fam"><span style={{ width: `${it.familiarity}%` }} /></div>
                  {it.receipt.length > 0 && <div className="receipt"><span className="qloo">Qloo:</span> {it.receipt.join(" · ")}</div>}

                  {isOpen && (
                    <div className="meal-detail">
                      <div className="nut">
                        <span>{it.dish.nutrition.kcal} kcal</span>
                        <span>{it.dish.nutrition.sugar_g}g sugar</span>
                        <span>{it.dish.nutrition.sodium_mg}mg sodium</span>
                        <span>{it.dish.nutrition.carbs_g}g carbs</span>
                      </div>

                      {optCount > 1 && (
                        <>
                          <div className="recipe-h">Choose this meal — {optCount} safe options</div>
                          <div className="choices">
                            {[orig, ...(orig.alternatives ?? []).map((a) => ({ ...orig, dish: a.dish, familiarity: a.familiarity, receipt: a.receipt }))].map((opt, oi) => {
                              const chosen = ((swapIdx[it.slot] ?? 0) % optCount) === oi;
                              return (
                                <button key={opt.dish.id} className={`choice ${chosen ? "on" : ""}`}
                                  onClick={() => setSwapIdx((s) => ({ ...s, [it.slot]: oi }))}>
                                  <span className="cname">{opt.dish.name}</span>
                                  <span className="cfam">familiarity {opt.familiarity}</span>
                                  {feedback[opt.dish.id] === "up" && <span className="cliked">♥</span>}
                                </button>
                              );
                            })}
                          </div>
                        </>
                      )}

                      <div className="recipe-h">Recipe</div>
                      <ol className="recipe">{recipe.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
                      <div className="recipe-h">Watch how to make it</div>
                      <a className="videocard" href={recipe.youtubeUrl} target="_blank" rel="noreferrer">
                        <div className="vc-thumb"><span className="vc-play">▶</span></div>
                        <div className="vc-meta">
                          <div className="vc-title">{it.dish.name} — recipe videos</div>
                          <div className="vc-sub">Opens hand-picked YouTube results · step-by-step</div>
                        </div>
                      </a>

                      <div className="fb">
                        <span className="fb-q">How was {it.dish.name}?</span>
                        <button className={`fb-btn ${feedback[it.dish.id] === "up" ? "up" : ""}`}
                          onClick={() => rate(it.dish.id, "up")}>👍 Loved it</button>
                        <button className={`fb-btn ${feedback[it.dish.id] === "down" ? "down" : ""}`}
                          onClick={() => rate(it.dish.id, "down")}>👎 Not for me</button>
                        {feedback[it.dish.id] && <span className="fb-saved">saved on this device</span>}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* ---------- nutrition dashboard ---------- */}
          <div className="panels">
            <div className="panel">
              <h3>📊 Today&rsquo;s nutrition</h3>
              <div className="nutgrid">
                <div className="nutcell"><div className="nv">{totals.kcal}</div><div className="nl">kcal</div></div>
                <div className="nutcell"><div className="nv">{totals.sugar_g.toFixed(1)}g</div><div className="nl">sugar</div></div>
                <div className="nutcell"><div className="nv">{totals.sodium_mg}mg</div><div className="nl">sodium</div></div>
                <div className="nutcell"><div className="nv">{totals.carbs_g}g</div><div className="nl">carbs</div></div>
              </div>
              <div className="ok">✓ every meal is within the medical limits the clinician set.</div>
            </div>
            <div className="panel">
              <h3>🛒 Grocery list</h3>
              <div className="grocery">{grocery.map((g) => <span key={g} className="gitem">{g}</span>)}</div>
            </div>
          </div>

          {/* ---------- friendly explanation + safety ---------- */}
          <div className="panels">
            <div className="panel">
              <h3>🍽 Why these meals</h3>
              <p className="explain">Here&rsquo;s a day of meals tailored to your tastes and dietary needs — chosen to feel
                familiar while staying within every limit that matters for your health. Tap any meal above for
                the recipe, a video, and other safe options you can swap in.</p>
            </div>
            <div className="panel">
              <h3>🛡 Kept out for your safety</h3>
              {data.rejected.length === 0 && <div className="rej">Nothing was left out — everything fits your needs.</div>}
              {data.rejected.map((r) => (
                <div className="rej" key={r.id}>
                  <div className="n">{r.name}{r.loved && <span className="loved">♥ a favorite</span>}</div>
                  <div className="v">{r.violations.join(" · ")}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ---------- care coordination ---------- */}
          <CarePanel care={data.care} />

          <div className="cta">
            <button className="run ghost" onClick={() => window.print()}>🖨 Print / share this day</button>
          </div>

          <div className="foot">
            Your meals stay within the limits that matter for your health, enforced by deterministic safety code.
            This is a wellness companion, not medical advice — always consult your clinician.
          </div>
        </>
      )}
    </div>
  );
}

// ---------------- profile builder ----------------
function ProfileBuilder({ catalog, onSave, onCancel }: { catalog: Catalog; onSave: (p: CustomProfile) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [age, setAge] = useState<string>("65"); // string so deleting leaves it empty (no forced 0)
  const [cuisine, setCuisine] = useState(catalog.cuisines[0] ?? "South Indian");
  const [region, setRegion] = useState("");
  const [conditions, setConditions] = useState<string[]>([]);
  const [medications, setMedications] = useState<string[]>([]);
  const [textureMax, setTextureMax] = useState(7);
  const [allergies, setAllergies] = useState<string[]>([]);
  const [loved, setLoved] = useState<string[]>([]);

  const toggle = (arr: string[], v: string, set: (x: string[]) => void) =>
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const cuisineDishes = catalog.dishes.filter((d) => d.cuisine === cuisine);

  return (
    <div className="builder">
      <div className="brow">
        <label>Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Amma" /></label>
        <label>Age<input type="text" inputMode="numeric" value={age} onChange={(e) => { const v = e.target.value; if (v === "" || /^\d{1,3}$/.test(v)) setAge(v); }} placeholder="e.g. 65" /></label>
        <label>Cuisine<select value={cuisine} onChange={(e) => { setCuisine(e.target.value); setLoved([]); }}>{catalog.cuisines.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label>Region<select value={region} onChange={(e) => setRegion(e.target.value)}>{catalog.regions.map((r) => <option key={r} value={r}>{r || "— any —"}</option>)}</select></label>
      </div>

      <div className="bfield"><span>Health conditions</span><div className="checks">
        {catalog.conditions.map((c) => <button key={c.id} className={`check ${conditions.includes(c.id) ? "on" : ""}`} onClick={() => toggle(conditions, c.id, setConditions)}>{c.label}</button>)}
      </div></div>

      <div className="bfield"><span>Medications</span><div className="checks">
        {catalog.medications.map((m) => <button key={m} className={`check ${medications.includes(m) ? "on" : ""}`} onClick={() => toggle(medications, m, setMedications)}>{m}</button>)}
      </div></div>

      <div className="bfield"><span>Allergies</span><div className="checks">
        {catalog.allergies.map((a) => <button key={a} className={`check ${allergies.includes(a) ? "on" : ""}`} onClick={() => toggle(allergies, a, setAllergies)}>{a}</button>)}
      </div></div>

      <div className="bfield"><span>Chewing / swallowing ease: <b>{textureMax}</b> <small>(0 = liquids only, 7 = any texture)</small></span>
        <input type="range" min={0} max={7} value={textureMax} onChange={(e) => setTextureMax(+e.target.value)} /></div>

      <div className="bfield"><span>Favorite dishes <small>(anchors the cultural match)</small></span><div className="checks">
        {cuisineDishes.map((d) => <button key={d.id} className={`check ${loved.includes(d.id) ? "on" : ""}`} onClick={() => toggle(loved, d.id, setLoved)}>♥ {d.name}</button>)}
      </div></div>

      <div className="cta">
        <button className="run" disabled={!name} onClick={() => onSave({
          id: `c_${Date.now()}`, name, age: Math.max(1, Math.min(120, parseInt(age, 10) || 30)), cuisine, region: region || undefined,
          conditions, medications, textureMax, allergies, lovedDishIds: loved,
        })}>Save &amp; use profile</button>
        <button className="run ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ---------------- welcome / sign-in ----------------
function Welcome({ onSignIn }: { onSignIn: (a: Account) => void }) {
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  return (
    <div className="welcome">
      <div className="welcome-card">
        <div className="wbrand">Nani<span className="accent">AI</span></div>
        <h2 className="wtitle">Eat like yourself again.</h2>
        <p className="wlede">
          Your personal food companion. It keeps every meal inside your <b>health limits</b> and
          still tastes like <b>home</b> — powered by a clinical-safety gate and Qloo&rsquo;s cultural
          taste graph. Built for grandparents, students far from home, busy professionals and new parents.
        </p>
        <div className="wfeat">
          <span>🛡 Doctor-safe by design</span>
          <span>🍲 Culturally familiar</span>
          <span>▶ Recipes &amp; videos</span>
          <span>🔒 Private on your device</span>
        </div>
        <div className="wform">
          <label>Your name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lakshmi" onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) onSignIn({ name: name.trim(), city: city.trim() || undefined, createdAt: Date.now() }); }} />
          </label>
          <label>City <small>(optional — sharpens local taste)</small>
            <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Chennai" />
          </label>
        </div>
        <div className="wactions">
          <button className="run" disabled={!name.trim()} onClick={() => onSignIn({ name: name.trim(), city: city.trim() || undefined, createdAt: Date.now() })}>Create my profile →</button>
          <button className="run ghost" onClick={() => onSignIn({ name: "Guest", createdAt: Date.now(), guest: true })}>Continue as guest</button>
        </div>
        <p className="wnote">Your profile is stored only in this browser — nothing is uploaded. No password needed.</p>
      </div>
    </div>
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
          <div className="rej" key={s.condition}>
            <div className="n">{s.specialist}</div>
            <div className="v" style={{ color: "var(--text-dim)" }}>for {s.why}</div>
            <a className="yt" href={s.searchUrl} target="_blank" rel="noreferrer">Find one near you →</a>
          </div>
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
        <div className="checks">
          {care.emergencyScenarios.map((s) => <button key={s.id} className={`check ${scenario === s.id ? "on" : ""}`} onClick={() => setScenario(scenario === s.id ? "" : s.id)}>{s.title.split(" (")[0]}</button>)}
        </div>
        {active && (
          <div className="scenario">
            <div className="when">{active.whenToCall}</div>
            <ol>{active.firstSteps.map((f, i) => <li key={i}>{f}</li>)}</ol>
          </div>
        )}
        <div className="disclaimer">{care.ice.note}</div>
      </div>
    </div>
  );
}
