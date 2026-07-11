import { useCallback, useMemo, useRef, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from "recharts";
import { CubeTransparentIcon, ArrowPathIcon, ChevronDownIcon } from "@heroicons/react/24/outline";
import type { Campaign, CampaignMetrics } from "../../services/campaignService";

/*
 * Monte Carlo projection for a single campaign.
 *
 * MODEL — two layers of randomness per simulation:
 *   1. Parameter uncertainty. Each funnel stage rate is re-sampled from a Beta
 *      distribution centered on the knob value. Its width tightens with evidence:
 *      Beta(α, β) with α = k·p + 1, β = k·(1−p) + 1, where k is the observed
 *      sample size behind that rate (capped) when we have data, or a weak prior
 *      (k = BENCHMARK_K) when we're leaning on a playbook benchmark. More real
 *      leads ⇒ tighter bands; a campaign with ~no data ⇒ wide bands (correct).
 *   2. Sampling noise. With that sampled rate, leads flow through the funnel as
 *      binomial draws (Bernoulli loop for small n, Normal approx for large n).
 *
 * The funnel is a strict 5-stage chain:
 *   leads → contacted → qualified → app sent → submitted → funded
 * The final "close" knob is the submitted→funded conversion. The benchmark
 * chain (65·60·70·55·65 %) lands at ~9.8% OVERALL close (funded/leads), matching
 * the playbook's 8–12% target — we show that implied overall close read-only.
 *
 * Funded dollars per sim: each funded deal draws a lognormal around the avg
 * (CV ≈ 40%); for large deal counts we use a CLT Normal approx of the sum.
 * Revenue (our commission) = funded$ × points%. ROAS = revenue ÷ spend, where
 * spend = leadVolume × costPerLead (the money the knobs put at risk).
 *
 * RNG is a seeded mulberry32; the seed is derived from the knob-set hash so a
 * given configuration is fully reproducible.
 */

// ── Seeded RNG + distribution samplers ───────────────────────────────────────
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNormal(rng: () => number) {
  // Box–Muller with a cached second value.
  let cached: number | null = null;
  return function normal(): number {
    if (cached !== null) {
      const v = cached;
      cached = null;
      return v;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    const r = Math.sqrt(-2 * Math.log(u));
    cached = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
}

// Marsaglia–Tsang gamma sampler, valid for shape ≥ 1 (our α, β are always ≥ 1).
function makeGamma(rng: () => number, normal: () => number) {
  return function gamma(shape: number): number {
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let x = 0;
      let v = 0;
      do {
        x = normal();
        v = 1 + c * x;
      } while (v <= 0);
      v = v * v * v;
      const u = rng();
      if (u < 1 - 0.0331 * x * x * x * x) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  };
}

// ── Percentile over a pre-sorted ascending array ─────────────────────────────
function pctile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

// ── Knobs ────────────────────────────────────────────────────────────────────
interface Knobs {
  simulations: number;
  leadVolume: number;
  costPerLead: number;
  contactRate: number; // %
  qualifyRate: number; // %
  appRate: number; // %
  submissionRate: number; // %
  closeRate: number; // % submitted → funded
  avgFunded: number;
  points: number; // commission points
}

type RateKey = "contactRate" | "qualifyRate" | "appRate" | "submissionRate" | "closeRate";
type Source = "observed" | "benchmark";

const BENCHMARK: Record<RateKey, number> = {
  contactRate: 65,
  qualifyRate: 60,
  appRate: 70,
  submissionRate: 55,
  closeRate: 65, // submitted→funded; chains to ~9.8% overall close
};
const BENCHMARK_K = 8; // weak prior → wide bands when we have no data
const EVIDENCE_CAP = 500; // bound how tight real data lets the bands get
const MIN_SAMPLE = 20; // below this we fall back to the benchmark
const FUNDED_CV = 0.4; // lognormal spread on funded amounts

// Per-rate evidence: the sampled Beta pseudo-count k for the uncertainty width.
type RateMeta = Record<RateKey, { source: Source; k: number }>;

function computeDefaults(c: Campaign, m?: CampaignMetrics): { knobs: Knobs; meta: RateMeta } {
  const contractedCpl = c.cost_per_lead_contracted ?? null;
  const observedCpl = m?.acquisitionCpl ?? m?.costPerLead ?? null;
  const cpl = contractedCpl ?? observedCpl ?? 60;

  const remaining = (c.budget ?? 0) - (c.spent ?? 0);
  const leadVolume =
    remaining > 0 && cpl > 0 ? Math.round(remaining / cpl) : m?.leads && m.leads > 0 ? m.leads : 100;

  // Stage rate defaults: observed where the denominator clears MIN_SAMPLE, else benchmark.
  const closeObserved = m && m.submitted > 0 ? (m.funded / m.submitted) * 100 : null;
  const stages: Array<{ key: RateKey; observed: number | null; denom: number }> = [
    { key: "contactRate", observed: m?.contactPct ?? null, denom: m?.leads ?? 0 },
    { key: "qualifyRate", observed: m?.qualifyPct ?? null, denom: m?.contacted ?? 0 },
    { key: "appRate", observed: m?.applicationPct ?? null, denom: m?.qualified ?? 0 },
    { key: "submissionRate", observed: m?.submissionPct ?? null, denom: m?.appSent ?? 0 },
    { key: "closeRate", observed: closeObserved, denom: m?.submitted ?? 0 },
  ];

  const rates = {} as Record<RateKey, number>;
  const meta = {} as RateMeta;
  for (const s of stages) {
    const useObserved = s.observed != null && s.denom >= MIN_SAMPLE;
    if (useObserved) {
      rates[s.key] = Math.round(s.observed as number);
      meta[s.key] = { source: "observed", k: Math.min(s.denom, EVIDENCE_CAP) };
    } else {
      rates[s.key] = BENCHMARK[s.key];
      meta[s.key] = { source: "benchmark", k: BENCHMARK_K };
    }
  }

  return {
    knobs: {
      simulations: 5000,
      leadVolume,
      costPerLead: Math.round(cpl),
      contactRate: rates.contactRate,
      qualifyRate: rates.qualifyRate,
      appRate: rates.appRate,
      submissionRate: rates.submissionRate,
      closeRate: rates.closeRate,
      avgFunded: Math.round(m?.avgDealSize ?? 50000),
      points: 8,
    },
    meta,
  };
}

// ── Simulation engine ────────────────────────────────────────────────────────
interface StageStat {
  label: string;
  p10: number;
  p50: number;
  p90: number;
}
interface SimResult {
  n: number;
  seed: number;
  ms: number;
  ranAt: string;
  spend: number;
  impliedOverallClose: number; // % funded / leads at the knob midpoints
  funded: { p10: number; p50: number; p90: number };
  revenue: { p10: number; p50: number; p90: number };
  roas: { p10: number; p50: number; p90: number };
  costPerFunded: { p10: number; p50: number; p90: number } | null;
  pProfit: number;
  pAnyFunded: number;
  stages: StageStat[];
  histogram: Array<{ label: string; mid: number; count: number }>;
  refBuckets: { worst: string; likely: string; best: string };
}

function hashKnobs(k: Knobs): number {
  const str = JSON.stringify(k);
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function runSimulation(knobs: Knobs, meta: RateMeta): SimResult {
  const t0 = performance.now();
  const seed = hashKnobs(knobs);
  const rng = mulberry32(seed);
  const normal = makeNormal(rng);
  const gamma = makeGamma(rng, normal);

  const beta = (p: number, k: number): number => {
    const a = k * p + 1;
    const b = k * (1 - p) + 1;
    const ga = gamma(a);
    const gb = gamma(b);
    return ga / (ga + gb);
  };

  const binomial = (n: number, p: number): number => {
    if (n <= 0 || p <= 0) return 0;
    if (p >= 1) return n;
    if (n <= 200) {
      let c = 0;
      for (let i = 0; i < n; i++) if (rng() < p) c++;
      return c;
    }
    // Normal approximation for large n.
    const mean = n * p;
    const sd = Math.sqrt(n * p * (1 - p));
    const v = Math.round(mean + sd * normal());
    return Math.min(n, Math.max(0, v));
  };

  const sigma = Math.sqrt(Math.log(1 + FUNDED_CV * FUNDED_CV));
  const mu = Math.log(Math.max(1, knobs.avgFunded)) - (sigma * sigma) / 2;
  const fundedDollars = (count: number): number => {
    if (count <= 0) return 0;
    if (count <= 150) {
      let sum = 0;
      for (let i = 0; i < count; i++) sum += Math.exp(mu + sigma * normal());
      return sum;
    }
    // CLT Normal approx of the lognormal sum for large deal counts.
    const mean = count * knobs.avgFunded;
    const sd = Math.sqrt(count) * knobs.avgFunded * FUNDED_CV;
    return Math.max(0, mean + sd * normal());
  };

  const N = knobs.simulations;
  const leads = Math.max(0, Math.round(knobs.leadVolume));
  const spend = leads * knobs.costPerLead;
  const pointsFrac = knobs.points / 100;

  const rateP: Record<RateKey, number> = {
    contactRate: knobs.contactRate / 100,
    qualifyRate: knobs.qualifyRate / 100,
    appRate: knobs.appRate / 100,
    submissionRate: knobs.submissionRate / 100,
    closeRate: knobs.closeRate / 100,
  };

  const revenue = new Float64Array(N);
  const fundedArr = new Float64Array(N);
  const roasArr = new Float64Array(N);
  const contactedArr = new Float64Array(N);
  const qualifiedArr = new Float64Array(N);
  const appArr = new Float64Array(N);
  const submittedArr = new Float64Array(N);

  let profitCount = 0;
  let anyFundedCount = 0;

  for (let i = 0; i < N; i++) {
    const pc = beta(rateP.contactRate, meta.contactRate.k);
    const pq = beta(rateP.qualifyRate, meta.qualifyRate.k);
    const pa = beta(rateP.appRate, meta.appRate.k);
    const ps = beta(rateP.submissionRate, meta.submissionRate.k);
    const pf = beta(rateP.closeRate, meta.closeRate.k);

    const contacted = binomial(leads, pc);
    const qualified = binomial(contacted, pq);
    const appSent = binomial(qualified, pa);
    const submitted = binomial(appSent, ps);
    const funded = binomial(submitted, pf);

    const dollars = fundedDollars(funded);
    const rev = dollars * pointsFrac;

    revenue[i] = rev;
    fundedArr[i] = funded;
    roasArr[i] = spend > 0 ? rev / spend : 0;
    contactedArr[i] = contacted;
    qualifiedArr[i] = qualified;
    appArr[i] = appSent;
    submittedArr[i] = submitted;

    if (spend > 0 && rev > spend) profitCount++;
    if (funded >= 1) anyFundedCount++;
  }

  const sortedRev = Array.from(revenue).sort((a, b) => a - b);
  const sortedFunded = Array.from(fundedArr).sort((a, b) => a - b);
  const sortedRoas = Array.from(roasArr).sort((a, b) => a - b);

  // Cost per funded only over sims that actually funded ≥1 deal.
  const cpfVals: number[] = [];
  if (spend > 0) {
    for (let i = 0; i < N; i++) if (fundedArr[i] > 0) cpfVals.push(spend / fundedArr[i]);
    cpfVals.sort((a, b) => a - b);
  }

  const sortAsc = (arr: Float64Array) => Array.from(arr).sort((a, b) => a - b);
  const stageStat = (label: string, sorted: number[]): StageStat => ({
    label,
    p10: Math.round(pctile(sorted, 10)),
    p50: Math.round(pctile(sorted, 50)),
    p90: Math.round(pctile(sorted, 90)),
  });

  const stages: StageStat[] = [
    { label: "Leads", p10: leads, p50: leads, p90: leads },
    stageStat("Contacted", sortAsc(contactedArr)),
    stageStat("Qualified", sortAsc(qualifiedArr)),
    stageStat("Application", sortAsc(appArr)),
    stageStat("Submitted", sortAsc(submittedArr)),
    stageStat("Funded", sortedFunded),
  ];

  // Histogram of revenue — 30 buckets from 0 to P99 (keeps a long tail readable).
  const BUCKETS = 30;
  const hi = Math.max(pctile(sortedRev, 99), 1);
  const width = hi / BUCKETS;
  const counts = new Array(BUCKETS).fill(0);
  for (let i = 0; i < N; i++) {
    const idx = Math.min(BUCKETS - 1, Math.max(0, Math.floor(revenue[i] / width)));
    counts[idx]++;
  }
  const fmtK = (n: number) => (n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`);
  const histogram = counts.map((count, i) => {
    const mid = (i + 0.5) * width;
    return { label: fmtK(i * width), mid, count };
  });
  const bucketLabel = (v: number) =>
    histogram[Math.min(BUCKETS - 1, Math.max(0, Math.floor(v / width)))].label;

  const p10rev = pctile(sortedRev, 10);
  const p50rev = pctile(sortedRev, 50);
  const p90rev = pctile(sortedRev, 90);

  const impliedOverallClose =
    rateP.contactRate * rateP.qualifyRate * rateP.appRate * rateP.submissionRate * rateP.closeRate * 100;

  return {
    n: N,
    seed,
    ms: Math.round((performance.now() - t0) * 10) / 10,
    ranAt: new Date().toLocaleTimeString(),
    spend,
    impliedOverallClose,
    funded: {
      p10: Math.round(pctile(sortedFunded, 10)),
      p50: Math.round(pctile(sortedFunded, 50)),
      p90: Math.round(pctile(sortedFunded, 90)),
    },
    revenue: { p10: p10rev, p50: p50rev, p90: p90rev },
    roas: {
      p10: pctile(sortedRoas, 10),
      p50: pctile(sortedRoas, 50),
      p90: pctile(sortedRoas, 90),
    },
    costPerFunded:
      cpfVals.length > 0
        ? { p10: pctile(cpfVals, 10), p50: pctile(cpfVals, 50), p90: pctile(cpfVals, 90) }
        : null,
    pProfit: (profitCount / N) * 100,
    pAnyFunded: (anyFundedCount / N) * 100,
    stages,
    histogram,
    refBuckets: { worst: bucketLabel(p10rev), likely: bucketLabel(p50rev), best: bucketLabel(p90rev) },
  };
}

// ── Formatters ───────────────────────────────────────────────────────────────
const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const mult = (n: number) => `${n.toFixed(2)}×`;
const OCEAN = "#007EA7";
const RED = "#ef4444";
const GRAY = "#9ca3af";
const GREEN = "#10b981";

// ── Component ────────────────────────────────────────────────────────────────
export default function CampaignMonteCarlo({ campaign, metrics }: { campaign: Campaign; metrics?: CampaignMetrics }) {
  const [open, setOpen] = useState(false);
  const defaults = useMemo(() => computeDefaults(campaign, metrics), [campaign, metrics]);
  const [knobs, setKnobs] = useState<Knobs>(defaults.knobs);
  const [result, setResult] = useState<SimResult | null>(null);
  const [running, setRunning] = useState(false);
  const hasRun = useRef(false);

  const run = useCallback(
    (k: Knobs) => {
      setRunning(true);
      // Yield a frame so the "running" state paints before a heavy sync loop.
      requestAnimationFrame(() => {
        const res = runSimulation(k, defaults.meta);
        setResult(res);
        setRunning(false);
      });
    },
    [defaults.meta],
  );

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !hasRun.current) {
      hasRun.current = true;
      run(knobs);
    }
  }

  function reset() {
    setKnobs(defaults.knobs);
    run(defaults.knobs);
  }

  const set = (patch: Partial<Knobs>) => setKnobs((k) => ({ ...k, ...patch }));

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
      <button
        onClick={toggle}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700/40"
      >
        <span className="flex items-center gap-2 font-semibold text-gray-900 dark:text-white">
          <span className="text-lg">🎲</span> Monte Carlo projection
          <span className="text-xs font-normal text-gray-400">best / most likely / worst outcomes</span>
        </span>
        <ChevronDownIcon className={`w-5 h-5 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="border-t border-gray-100 dark:border-gray-700 p-4 space-y-5">
          {/* Knobs */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Knobs
              </h4>
              <div className="flex items-center gap-2">
                <button
                  onClick={reset}
                  className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-ocean-blue"
                >
                  <ArrowPathIcon className="w-3.5 h-3.5" /> Reset to defaults
                </button>
                <button onClick={() => run(knobs)} disabled={running} className="btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs disabled:opacity-50">
                  <CubeTransparentIcon className="w-4 h-4" /> {running ? "Running…" : "Run simulation"}
                </button>
              </div>
            </div>

            <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
              <Knob label="# simulations" value={knobs.simulations} min={500} max={200000} step={500} onChange={(v) => set({ simulations: Math.min(200000, Math.max(500, v)) })}
                hint="How many simulated futures of this campaign to run. More sims = smoother, more stable estimates (and a slightly longer run). 5,000 is plenty for a gut check; crank it up for final numbers." />
              <Knob label="Lead volume" value={knobs.leadVolume} min={0} onChange={(v) => set({ leadVolume: Math.max(0, v) })}
                hint="How many leads this campaign will deliver (e.g. the number of transfers you ordered)." />
              <Knob label="Cost per lead ($)" value={knobs.costPerLead} min={0} onChange={(v) => set({ costPerLead: Math.max(0, v) })}
                hint="What you pay per lead. Synergy examples: live transfers $20–40, real-time $10–20, aged $0.01–0.05." />
              <Knob label="Avg funded ($)" value={knobs.avgFunded} min={0} onChange={(v) => set({ avgFunded: Math.max(0, v) })}
                hint="Typical funded advance size. Your book's average deal is ~$50,000; a clean first position funds ≈ one month of the merchant's revenue." />
              <Knob label="Contact rate (%)" value={knobs.contactRate} min={0} max={100} source={defaults.meta.contactRate.source} onChange={(v) => set({ contactRate: clampPct(v) })}
                hint="Of the leads you get, how many you actually reach on the phone. Target: 65%+. Live transfers are ~100% by definition (they're already on the line); cold/aged lists run much lower." />
              <Knob label="Qualify rate (%)" value={knobs.qualifyRate} min={0} max={100} source={defaults.meta.qualifyRate.source} onChange={(v) => set({ qualifyRate: clampPct(v) })}
                hint="Of the people you reach, how many actually qualify — enough monthly revenue ($15K+), time in business (6+ months), a real funding need. Target: 55–65%." />
              <Knob label="Application rate (%)" value={knobs.appRate} min={0} max={100} source={defaults.meta.appRate.source} onChange={(v) => set({ appRate: clampPct(v) })}
                hint="Of qualified merchants, how many complete + sign the application. Target: 65–75% — best done on the first call while they're hot." />
              <Knob label="Submission rate (%)" value={knobs.submissionRate} min={0} max={100} source={defaults.meta.submissionRate.source} onChange={(v) => set({ submissionRate: clampPct(v) })}
                hint="Of signed applications, how many get their bank statements/docs in so you can submit to funders. Target: 50–60% — this is the #1 leak in the funnel (doc chasing)." />
              <Knob label="Close: submit→fund (%)" value={knobs.closeRate} min={0} max={100} source={defaults.meta.closeRate.source} onChange={(v) => set({ closeRate: clampPct(v) })}
                hint="Of submitted files, how many end up FUNDED (funder approves → merchant accepts → money moves). Target: ~65%. Combined with the other rates, a healthy campaign closes 8–12% of all leads." />
              <Knob label="Commission points" value={knobs.points} min={0} max={20} onChange={(v) => set({ points: Math.max(0, v) })}
                hint="Your commission as % of the funded amount. Standard: 8 points on new deals ($4,000 on a $50K deal), 6 on renewals." />
            </div>
            <p className="text-[11px] text-gray-400 mt-2">
              Spend at risk ={" "}
              <span className="font-semibold text-gray-600 dark:text-gray-300">{money(knobs.leadVolume * knobs.costPerLead)}</span>{" "}
              ({knobs.leadVolume.toLocaleString()} leads × {money(knobs.costPerLead)}). Rates tagged{" "}
              <span className="text-emerald-600 dark:text-emerald-400">observed</span> use this campaign's data;{" "}
              <span className="text-amber-600 dark:text-amber-400">benchmark</span> uses the playbook (wider bands).
            </p>
          </div>

          {running && !result && <p className="text-sm text-gray-400">Running simulation…</p>}

          {result && (
            <>
              {/* Headline cards */}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Outcome
                  title="Funded deals"
                  worst={`${result.funded.p10}`}
                  likely={`${result.funded.p50}`}
                  best={`${result.funded.p90}`}
                />
                <Outcome
                  title="Commission revenue"
                  worst={money(result.revenue.p10)}
                  likely={money(result.revenue.p50)}
                  best={money(result.revenue.p90)}
                />
                <Outcome
                  title="ROAS (rev ÷ spend)"
                  worst={mult(result.roas.p10)}
                  likely={mult(result.roas.p50)}
                  best={mult(result.roas.p90)}
                />
                <Outcome
                  title="⭐ Cost / funded"
                  worst={result.costPerFunded ? money(result.costPerFunded.p90) : "—"}
                  likely={result.costPerFunded ? money(result.costPerFunded.p50) : "—"}
                  best={result.costPerFunded ? money(result.costPerFunded.p10) : "—"}
                  invert
                />
              </div>

              {/* Probability callouts */}
              <div className="flex flex-wrap gap-2">
                <Callout
                  label="P(profit)"
                  value={`${result.pProfit.toFixed(0)}%`}
                  hint="ROAS > 1"
                  good={result.pProfit >= 50}
                />
                <Callout
                  label="P(≥1 funded deal)"
                  value={`${result.pAnyFunded.toFixed(0)}%`}
                  hint="at least one close"
                  good={result.pAnyFunded >= 50}
                />
                <div className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300">
                  Implied overall close{" "}
                  <span className="font-semibold text-gray-900 dark:text-white">
                    {result.impliedOverallClose.toFixed(1)}%
                  </span>
                  <span className="text-gray-400">target 8–12%</span>
                </div>
              </div>

              {/* Revenue distribution histogram */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    Commission revenue distribution
                  </h4>
                  <span className="text-[11px] text-gray-400">
                    {result.n.toLocaleString()} sims · seed {result.seed} · {result.ms} ms · ran {result.ranAt}
                  </span>
                </div>
                <div className="w-full overflow-x-auto">
                  <div className="min-w-[520px] h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={result.histogram} margin={{ top: 16, right: 12, left: 4, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.2} vertical={false} />
                        <XAxis
                          dataKey="label"
                          tick={{ fontSize: 10, fill: "#9CA3AF" }}
                          axisLine={{ stroke: "#374151", opacity: 0.3 }}
                          interval={4}
                        />
                        <YAxis
                          tick={{ fontSize: 10, fill: "#9CA3AF" }}
                          axisLine={{ stroke: "#374151", opacity: 0.3 }}
                          allowDecimals={false}
                        />
                        <Tooltip
                          cursor={{ fill: "#00000010" }}
                          contentStyle={{
                            backgroundColor: "#21262D",
                            border: "1px solid #30363D",
                            borderRadius: "8px",
                            fontSize: "12px",
                            color: "#F0F6FC",
                          }}
                          labelFormatter={(l) => `Revenue ≥ ${l}`}
                          formatter={(value) => [`${Number(value) || 0} sims`, "Frequency"]}
                        />
                        <ReferenceLine x={result.refBuckets.worst} stroke={RED} strokeDasharray="4 3" label={{ value: "worst", position: "top", fill: RED, fontSize: 10 }} />
                        <ReferenceLine x={result.refBuckets.likely} stroke={GRAY} strokeDasharray="4 3" label={{ value: "likely", position: "top", fill: GRAY, fontSize: 10 }} />
                        <ReferenceLine x={result.refBuckets.best} stroke={GREEN} strokeDasharray="4 3" label={{ value: "best", position: "top", fill: GREEN, fontSize: 10 }} />
                        <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                          {result.histogram.map((_, i) => (
                            <Cell key={i} fill={OCEAN} fillOpacity={0.75} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* Funnel table with ranges */}
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
                  Funnel — median with P10–P90 range
                </h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-gray-500 dark:text-gray-400 text-xs uppercase">
                      <tr>
                        <th className="py-1.5 pr-4 font-medium">Stage</th>
                        <th className="py-1.5 pr-4 font-medium text-right">Worst (P10)</th>
                        <th className="py-1.5 pr-4 font-medium text-right">Most likely (P50)</th>
                        <th className="py-1.5 font-medium text-right">Best (P90)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                      {result.stages.map((s) => (
                        <tr key={s.label}>
                          <td className="py-1.5 pr-4 text-gray-700 dark:text-gray-200">{s.label}</td>
                          <td className="py-1.5 pr-4 text-right text-red-600 dark:text-red-400">{s.p10.toLocaleString()}</td>
                          <td className="py-1.5 pr-4 text-right font-semibold text-gray-900 dark:text-white">{s.p50.toLocaleString()}</td>
                          <td className="py-1.5 text-right text-emerald-600 dark:text-emerald-400">{s.p90.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function clampPct(v: number) {
  return Math.min(100, Math.max(0, v));
}

// ── Small pieces ─────────────────────────────────────────────────────────────
function Knob({
  label,
  value,
  onChange,
  min,
  max,
  step,
  source,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  source?: Source;
  hint?: string;
}) {
  return (
    <label className="block text-[11px] text-gray-500 dark:text-gray-400">
      <span className="flex items-center gap-1.5">
        {label}
        {hint && (
          <span
            title={hint}
            className="cursor-help select-none inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-gray-300 dark:border-gray-500 text-[9px] font-semibold text-gray-400 hover:text-ocean-blue hover:border-ocean-blue"
            aria-label={hint}
          >
            i
          </span>
        )}
        {source && (
          <span
            className={`text-[9px] font-semibold px-1 py-0.5 rounded uppercase ${
              source === "observed"
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
            }`}
          >
            {source === "observed" ? "obs" : "bench"}
          </span>
        )}
      </span>
      <KnobInput value={value} min={min} max={max} step={step} onChange={onChange} />
    </label>
  );
}

// Free-typing numeric input: holds a local DRAFT while focused so the user can
// clear the field and type any number (e.g. "200000") without min/max clamping
// rewriting every keystroke. The clamped value commits on blur or Enter.
function KnobInput({
  value,
  onChange,
  min,
  max,
  step,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (raw: string) => {
    let v = Number(raw);
    if (!Number.isFinite(v) || raw.trim() === "") v = value;
    if (min != null) v = Math.max(min, v);
    if (max != null) v = Math.min(max, v);
    onChange(v);
    setDraft(null);
  };
  return (
    <input
      type="number"
      value={draft ?? value}
      min={min}
      max={max}
      step={step ?? 1}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      className="mt-1 w-full px-2 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100"
    />
  );
}

function Outcome({
  title,
  worst,
  likely,
  best,
  invert,
}: {
  title: string;
  worst: string;
  likely: string;
  best: string;
  invert?: boolean;
}) {
  // `invert` flips the color mapping for metrics where lower is better (cost/funded).
  const worstColor = invert ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";
  const bestColor = invert ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400";
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{title}</div>
      <div className="mt-2 space-y-1">
        <Row label="Worst" value={worst} cls={worstColor} />
        <Row label="Most likely" value={likely} cls="text-gray-900 dark:text-white" strong />
        <Row label="Best" value={best} cls={bestColor} />
      </div>
    </div>
  );
}

function Row({ label, value, cls, strong }: { label: string; value: string; cls: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[10px] uppercase tracking-wide text-gray-400">{label}</span>
      <span className={`${strong ? "text-lg font-bold" : "text-sm font-semibold"} ${cls}`}>{value}</span>
    </div>
  );
}

function Callout({ label, value, hint, good }: { label: string; value: string; hint: string; good: boolean }) {
  return (
    <div
      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs ${
        good
          ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300"
          : "border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300"
      }`}
    >
      <span className="font-medium">{label}</span>
      <span className="text-base font-bold">{value}</span>
      <span className="opacity-70">{hint}</span>
    </div>
  );
}
