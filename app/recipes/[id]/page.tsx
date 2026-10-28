"use client";

import { useEffect, useMemo, useState } from "react";
import { use } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { scalePortion } from "@/lib/schedule";

type Comp = {
  id: string; name: string; cuisine: string; ingredients: string[]; allergens: string[];
  nutrition: { kcal: number; sugar_g: number; sodium_mg: number; carbs_g: number; potassium_mg?: number };
  portion: string;
  recipe: { steps: string[]; youtubeUrl: string; prep: string };
};
type RecipeData = { main: Comp; sides: Comp[]; mealType: string };

export default function RecipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const sp = useSearchParams();
  const sides = sp.get("sides") ?? "";
  const [data, setData] = useState<RecipeData | null>(null);
  const [error, setError] = useState("");
  const [servings, setServings] = useState(Math.max(1, parseInt(sp.get("servings") ?? "1", 10) || 1));

  useEffect(() => {
    const qs = new URLSearchParams({ id, ...(sides ? { sides } : {}) });
    fetch(`/api/recipe?${qs}`)
      .then((r) => (r.ok ? r.json() : r.json().then((j) => Promise.reject(new Error(j.error ?? "Not found")))))
      .then(setData)
      .catch((e) => setError(e.message));
  }, [id, sides]);

  const plate = useMemo(() => (data ? [data.main, ...data.sides] : []), [data]);
  const totals = useMemo(() => {
    const sum = (k: "kcal" | "sugar_g" | "sodium_mg" | "carbs_g") => plate.reduce((a, c) => a + ((c.nutrition as any)[k] ?? 0), 0);
    return plate.length ? { kcal: sum("kcal"), sugar_g: sum("sugar_g"), sodium_mg: sum("sodium_mg"), carbs_g: sum("carbs_g") } : null;
  }, [plate]);
  const allergens = useMemo(() => Array.from(new Set(plate.flatMap((c) => c.allergens))).filter(Boolean), [plate]);

  if (error) {
    return (
      <div className="wrap">
        <div className="welcome-card" style={{ maxWidth: 520, margin: "60px auto" }}>
          <h2 className="wtitle">Recipe not found</h2>
          <p className="wlede">We couldn&rsquo;t find that recipe. It may have been removed.</p>
          <Link className="run" href="/">← Back to planner</Link>
        </div>
      </div>
    );
  }
  if (!data || !totals) return <div className="boot" />;

  return (
    <div className="wrap">
      <header className="header">
        <div className="brand">
          <h1>{data.main.name}{data.sides.length ? <span className="with"> thali</span> : ""}</h1>
          <p>{data.mealType} · {data.main.cuisine} · serves {servings} · prep {data.main.recipe.prep}</p>
        </div>
        <nav className="topnav"><Link className="navbtn" href="/">← Back to planner</Link></nav>
      </header>

      <div className="servings-row">
        <span>Cooking for</span>
        <div className="seg">{[1, 2, 3, 4, 6].map((n) => <button key={n} className={servings === n ? "on" : ""} onClick={() => setServings(n)}>{n === 6 ? "6+" : n}</button>)}</div>
        <span className="servings-note">quantities scale to this</span>
      </div>

      <div className="panels">
        <div className="panel">
          <h3>🍽 On your plate — serves {servings}</h3>
          <div className="plate">
            {plate.map((c, i) => (
              <div className="plate-row" key={c.id}>
                <span className="pr-name">{i === 0 ? "🍛 " : "🥄 "}{c.name}{i === 0 ? " (main)" : ""}</span>
                <span className="pr-qty">{scalePortion(c.portion, servings)}</span>
              </div>
            ))}
          </div>
          <div className="nut">
            <span>{totals.kcal} kcal</span><span>{totals.sugar_g.toFixed(1)}g sugar</span>
            <span>{totals.sodium_mg}mg sodium</span><span>{totals.carbs_g}g carbs</span>
          </div>
          <div className="explain-src">Quantities are approximate per-person guidance scaled for {servings}, not a medical prescription.</div>
        </div>
        <div className="panel">
          <h3>🧺 Ingredients by component</h3>
          {plate.map((c) => (
            <div key={c.id} className="rc-group">
              <div className="rc-group-h">{c.name} <span className="pr-qty">{scalePortion(c.portion, servings)}</span></div>
              <div className="grocery">{c.ingredients.map((g) => <span key={g} className="gitem">{g}</span>)}</div>
            </div>
          ))}
          {allergens.length > 0 && <div className="disclaimer">Contains: {allergens.join(", ")}. Always check labels for your allergies.</div>}
        </div>
      </div>

      {plate.map((c) => (
        <div className="panel" key={c.id} style={{ marginTop: 14 }}>
          <h3>👩‍🍳 {c.name} — method</h3>
          <ol className="recipe">{c.recipe.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
          <div className="recipe-h">Prep ahead ({c.recipe.prep})</div>
          <ul className="prep-steps">
            <li>Set aside: {c.ingredients.join(", ")}.</li>
            <li>Keep anything perishable covered in the fridge — never left out overnight.</li>
          </ul>
          <a className="videocard" href={c.recipe.youtubeUrl} target="_blank" rel="noreferrer">
            <div className="vc-thumb"><span className="vc-play">▶</span></div>
            <div className="vc-meta"><div className="vc-title">{c.name} — recipe videos</div><div className="vc-sub">Opens hand-picked YouTube results</div></div>
          </a>
        </div>
      ))}

      <div className="cta"><Link className="run ghost" href="/">← Back to planner</Link></div>
      <div className="foot">A wellness companion, not medical advice — always consult your clinician.</div>
    </div>
  );
}
