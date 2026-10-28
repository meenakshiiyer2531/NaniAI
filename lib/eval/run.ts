import { PERSONAS } from "@/lib/data/personas";
import { runComparison } from "@/lib/agents/orchestrator";

// Reproducible evaluation harness (Phase 7).
// Runs the full agentic workflow over every persona and reports the measurable
// value of Qloo as a fair ablation: the grounded and baseline plans are drawn
// from the SAME clinician-approved candidate set, differing only in whether the
// Qloo cultural signal is used to rank.
//
// Runs fully offline in mock mode (no keys). With live keys set, it reports the
// same metrics against the live Qloo graph + chosen model. No numbers are
// fabricated — everything below is computed from actual runs.
//
//   npm run eval

type Row = {
  persona: string;
  groundedFam: number;
  baselineFam: number;
  delta: number;
  groundedViolations: number;
  baselineViolations: number;
  receiptCoverage: number; // % of grounded items carrying a Qloo receipt
  substitutions: number;
};

async function main() {
  const rows: Row[] = [];
  let qlooLive = false;
  let provider = "";

  for (const persona of PERSONAS) {
    const c = await runComparison(persona);
    qlooLive = c.grounded.meta.qlooLive;
    provider = c.grounded.meta.modelProvider;

    const items = c.grounded.plan.items;
    const withReceipt = items.filter((i) => i.receipt.length > 0).length;

    rows.push({
      persona: `${persona.name} (${persona.conditions.join("+")})`,
      groundedFam: c.grounded.plan.avgFamiliarity,
      baselineFam: c.baseline.plan.avgFamiliarity,
      delta: c.grounded.plan.avgFamiliarity - c.baseline.plan.avgFamiliarity,
      groundedViolations: c.grounded.plan.violationCount,
      baselineViolations: c.baseline.plan.violationCount,
      receiptCoverage: items.length ? Math.round((withReceipt / items.length) * 100) : 0,
      substitutions: c.grounded.substitutions.length,
    });
  }

  const n = rows.length;
  const mean = (f: (r: Row) => number) =>
    Math.round((rows.reduce((s, r) => s + f(r), 0) / n) * 10) / 10;

  console.log("\n=== NaniAI evaluation ===");
  console.log(
    `Qloo source: ${qlooLive ? "LIVE taste graph" : "deterministic mock"} · reasoning brain: ${provider}`,
  );
  console.log(`Personas evaluated: ${n}\n`);

  const pad = (s: string, w: number) => s.padEnd(w).slice(0, w);
  console.log(
    pad("persona", 34) +
      pad("Qloo", 6) +
      pad("base", 6) +
      pad("Δfam", 6) +
      pad("viol", 6) +
      pad("receipts", 10) +
      "subs",
  );
  console.log("-".repeat(74));
  for (const r of rows) {
    console.log(
      pad(r.persona, 34) +
        pad(String(r.groundedFam), 6) +
        pad(String(r.baselineFam), 6) +
        pad(`+${r.delta}`, 6) +
        pad(String(r.groundedViolations), 6) +
        pad(`${r.receiptCoverage}%`, 10) +
        String(r.substitutions),
    );
  }
  console.log("-".repeat(74));
  console.log(
    `MEAN familiarity: Qloo ${mean((r) => r.groundedFam)} vs baseline ${mean(
      (r) => r.baselineFam,
    )}  (Δ +${mean((r) => r.delta)})`,
  );
  console.log(
    `MEAN Qloo-receipt coverage: ${mean((r) => r.receiptCoverage)}%  ·  ` +
      `medical violations (both arms): ${rows.reduce(
        (s, r) => s + r.groundedViolations + r.baselineViolations,
        0,
      )}`,
  );
  console.log(
    "\nInterpretation: a positive Δfamiliarity with zero violations is the claim —",
  );
  console.log(
    "Qloo makes safe plans feel like home; the clinician gate guarantees safety.\n",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
