import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  getCampaignMcInputs,
  type CampaignMcInputs,
  type McStageKey,
} from "../../services/campaignMonteCarloService";

/*
 * Monte Carlo projection for a single campaign — where is it HEADING as real,
 * week-2 data (small samples, zero funded) accumulates?
 *
 * The funnel is the campaign audit's HONEST 8-stage chain, grounded in signals a
 * closer can't fake with a click — call seconds and signed application docs:
 *   leads → dialed → connected(≥30s) → real conversation(≥2m) → app sent →
 *   app returned → submitted → offer → funded
 * (see campaignMonteCarloService for exactly how each is read from live tables).
 *
 * TWO layers of randomness per simulation, mirroring the app's other Monte Carlo:
 *   1. Parameter uncertainty. Each stage's pass-through rate is re-sampled from a
 *      Beta POSTERIOR that blends a playbook prior with the campaign's own
 *      observations: prior Beta(k·p₀+1, k·(1−p₀)+1) updated by s successes in n
 *      trials → Beta(k·p₀+1+s, k·(1−p₀)+1+(n−s)). More real leads behind a stage
 *      ⇒ the blend leans on data and the band tightens; ~no data ⇒ it leans on the
 *      prior and the band stays honestly wide. The (+1,+1) keeps every Gamma shape
 *      ≥ 1 so the sampler is valid — the same convention as the unit-economics MC.
 *   2. Sampling noise. With that sampled rate, leads flow through as binomial draws
 *      (Bernoulli loop for small n, Normal approx for large n).
 *
 * Funded dollars per sim: each funded deal draws a lognormal whose μ/σ are FITTED
 * from the campaign's own bank-verified advance sizes (max-affordable-advance, else
 * ~1 month verified revenue, else stated ask); with too few observations it falls
 * back to the book default ($50k, CV 40%). Revenue (our commission) = funded$ ×
 * points%. Cost-per-funded and ROAS only appear when a cost per lead is known.
 *
 * CLIENT-SIDE: Math.random-free seeded RNG (mulberry32) so a knob-set is fully
 * reproducible. This runs in the browser app — the no-Date/random rule is for
 * Workflow scripts, not app code.
 */

// ── Seeded RNG + distribution samplers (mirrors the unit-economics MC) ────────
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

function pctile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

// ── Playbook priors for the honest 8-stage chain ─────────────────────────────
// Prior MEANS for a generic cold campaign. Live-transfer campaigns observe
// near-100% dial/connect and their own data overrides these where samples exist.
const BENCHMARK: Record<McStageKey, number> = {
  dial: 0.9, // most leads get dialed
  connect: 0.5, // ≥30s pickup per dial
  conversation: 0.6, // ≥2-min talk per pickup
  appSent: 0.6, // app sent per real conversation
  appBack: 0.55, // app returned per app sent — the classic doc-chase leak
  submit: 0.8, // submitted per app returned
  offer: 0.6, // funder offer per submission
  fund: 0.65, // funded per offer
};
const FUNDED_CV_LABEL = 0.4;

// ── Knobs ────────────────────────────────────────────────────────────────────
interface Knobs {
  trials: number;
  projectedLeads: number;
  priorStrength: number; // k — pseudo-count weight of the playbook prior
  avgFunded: number; // shifts the fitted lognormal's center; σ stays data-fitted
  costPerLead: number; // 0 ⇒ unknown ⇒ cost metrics show "—"
  points: number; // commission points
}

interface StageParam {
  key: McStageKey;
  label: string;
  observed: number | null; // s/n
  blended: number; // posterior mean
  prior: number; // p₀
  n: number; // evidence (denominator)
  dataWeight: number; // n / (n + k) — share of the blend that's real data
  alpha: number;
  beta: number;
}

function computeDefaults(inputs: CampaignMcInputs, metrics?: CampaignMetrics): Knobs {
  const projectedLeads = inputs.weeklyPace
    ? Math.max(1, Math.round(inputs.weeklyPace * 4))
    : inputs.leads > 0
      ? inputs.leads
      : 100;
  const cpl =
    inputs.costPerLead ?? metrics?.acquisitionCpl ?? metrics?.costPerLead ?? 0;
  return {
    trials: 10_000,
    projectedLeads,
    priorStrength: 12,
    avgFunded: Math.round(inputs.dealSize.mean),
    costPerLead: Math.max(0, Math.round(cpl)),
    points: 8,
  };
}

// Posterior Beta per stage: prior Beta(k·p₀+1, k·(1−p₀)+1) updated by the campaign's
// observed s successes in n trials. Observed successes are clamped to the honest
// denominator so a non-monotone data blip can't push a rate past 100%.
function stageParams(inputs: CampaignMcInputs, k: number): StageParam[] {
  return inputs.stages.map((st) => {
    const p0 = BENCHMARK[st.key];
    const n = Math.max(0, st.denom);
    const s = Math.min(Math.max(0, st.num), n);
    const alpha = k * p0 + 1 + s;
    const beta = k * (1 - p0) + 1 + (n - s);
    return {
      key: st.key,
      label: st.label,
      observed: n > 0 ? s / n : null,
      blended: alpha / (alpha + beta),
      prior: p0,
      n,
      dataWeight: n > 0 ? n / (n + k) : 0,
      alpha,
      beta,
    };
  });
}

// ── Simulation ───────────────────────────────────────────────────────────────
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
  spend: number | null;
  impliedOverallClose: number; // % funded/leads at the blended stage means
  funded: { p10: number; p50: number; p90: number };
  revenue: { p10: number; p50: number; p90: number };
  roas: { p10: number; p50: number; p90: number } | null;
  costPerFunded: { p10: number; p50: number; p90: number } | null;
  pProfit: number | null;
  pAnyFunded: number;
  stages: StageStat[];
  histogram: Array<{ label: string; mid: number; count: number }>;
  refBuckets: { worst: string; likely: string; best: string };
}

function hashKnobs(k: Knobs, inputs: CampaignMcInputs): number {
  const str = JSON.stringify(k) + inputs.campaignId + inputs.stages.map((s) => `${s.num}/${s.denom}`).join(",");
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function runSimulation(knobs: Knobs, inputs: CampaignMcInputs, params: StageParam[]): SimResult {
  const t0 = performance.now();
  const seed = hashKnobs(knobs, inputs);
  const rng = mulberry32(seed);
  const normal = makeNormal(rng);
  const gamma = makeGamma(rng, normal);

  const betaSample = (a: number, b: number): number => {
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
    const mean = n * p;
    const sd = Math.sqrt(n * p * (1 - p));
    const v = Math.round(mean + sd * normal());
    return Math.min(n, Math.max(0, v));
  };

  // Deal-size lognormal: σ is the data-fitted shape; μ is re-centered on the knob's
  // avg-funded so the owner can shift the center while keeping the fitted spread.
  const sigma = inputs.dealSize.sigma;
  const mu = Math.log(Math.max(1, knobs.avgFunded)) - (sigma * sigma) / 2;
  const fundedDollars = (count: number): number => {
    if (count <= 0) return 0;
    if (count <= 150) {
      let sum = 0;
      for (let i = 0; i < count; i++) sum += Math.exp(mu + sigma * normal());
      return sum;
    }
    const mean = count * knobs.avgFunded;
    const sd = Math.sqrt(count) * knobs.avgFunded * (Math.exp(sigma * sigma) - 1 > 0 ? Math.sqrt(Math.exp(sigma * sigma) - 1) : FUNDED_CV_LABEL);
    return Math.max(0, mean + sd * normal());
  };

  const N = knobs.trials;
  const leads = Math.max(0, Math.round(knobs.projectedLeads));
  const cplKnown = knobs.costPerLead > 0;
  const spend = cplKnown ? leads * knobs.costPerLead : null;
  const pointsFrac = knobs.points / 100;

  const revenue = new Float64Array(N);
  const fundedArr = new Float64Array(N);
  const roasArr = new Float64Array(N);
  const stageArrs = params.map(() => new Float64Array(N));

  let profitCount = 0;
  let anyFundedCount = 0;

  for (let i = 0; i < N; i++) {
    let count = leads;
    for (let sIdx = 0; sIdx < params.length; sIdx++) {
      const p = betaSample(params[sIdx].alpha, params[sIdx].beta);
      count = binomial(count, p);
      stageArrs[sIdx][i] = count;
    }
    const funded = count;
    const dollars = fundedDollars(funded);
    const rev = dollars * pointsFrac;

    revenue[i] = rev;
    fundedArr[i] = funded;
    if (spend != null && spend > 0) {
      roasArr[i] = rev / spend;
      if (rev > spend) profitCount++;
    }
    if (funded >= 1) anyFundedCount++;
  }

  const sortedRev = Array.from(revenue).sort((a, b) => a - b);
  const sortedFunded = Array.from(fundedArr).sort((a, b) => a - b);

  const cpfVals: number[] = [];
  if (spend != null && spend > 0) {
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
    ...params.map((prm, idx) => stageStat(prm.label, sortAsc(stageArrs[idx]))),
  ];

  // Revenue histogram — 30 buckets from 0 to P99 (keeps the long tail readable).
  const BUCKETS = 30;
  const hi = Math.max(pctile(sortedRev, 99), 1);
  const width = hi / BUCKETS;
  const counts = new Array(BUCKETS).fill(0);
  for (let i = 0; i < N; i++) {
    const idx = Math.min(BUCKETS - 1, Math.max(0, Math.floor(revenue[i] / width)));
    counts[idx]++;
  }
  const fmtK = (n: number) => (n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`);
  const histogram = counts.map((count, i) => ({ label: fmtK(i * width), mid: (i + 0.5) * width, count }));
  const bucketLabel = (v: number) =>
    histogram[Math.min(BUCKETS - 1, Math.max(0, Math.floor(v / width)))].label;

  const p10rev = pctile(sortedRev, 10);
  const p50rev = pctile(sortedRev, 50);
  const p90rev = pctile(sortedRev, 90);

  const impliedOverallClose = params.reduce((acc, prm) => acc * prm.blended, 1) * 100;

  const sortedRoas = spend != null && spend > 0 ? Array.from(roasArr).sort((a, b) => a - b) : null;

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
    roas: sortedRoas
      ? { p10: pctile(sortedRoas, 10), p50: pctile(sortedRoas, 50), p90: pctile(sortedRoas, 90) }
      : null,
    costPerFunded:
      cpfVals.length > 0
        ? { p10: pctile(cpfVals, 10), p50: pctile(cpfVals, 50), p90: pctile(cpfVals, 90) }
        : null,
    pProfit: spend != null && spend > 0 ? (profitCount / N) * 100 : null,
    pAnyFunded: (anyFundedCount / N) * 100,
    stages,
    histogram,
    refBuckets: { worst: bucketLabel(p10rev), likely: bucketLabel(p50rev), best: bucketLabel(p90rev) },
  };
}

// ── Formatters ───────────────────────────────────────────────────────────────
const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const mult = (n: number) => `${n.toFixed(2)}×`;
const pct = (n: number | null) => (n == null ? "—" : `${(n * 100).toFixed(0)}%`);
const OCEAN = "#007EA7";
const RED = "#ef4444";
const GRAY = "#9ca3af";
const GREEN = "#10b981";

// ── Component ────────────────────────────────────────────────────────────────
export default function CampaignMonteCarlo({
  campaign,
  metrics,
}: {
  campaign: Campaign;
  metrics?: CampaignMetrics;
}) {
  const [open, setOpen] = useState(false);
  const [inputs, setInputs] = useState<CampaignMcInputs | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [knobs, setKnobs] = useState<Knobs | null>(null);
  const [result, setResult] = useState<SimResult | null>(null);
  const [running, setRunning] = useState(false);
  const hasLoaded = useRef(false);

  const params = useMemo(
    () => (inputs && knobs ? stageParams(inputs, knobs.priorStrength) : null),
    [inputs, knobs],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await getCampaignMcInputs(campaign);
      setInputs(data);
      setKnobs(computeDefaults(data, metrics));
      setResult(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load campaign data");
    } finally {
      setLoading(false);
    }
  }, [campaign, metrics]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !hasLoaded.current) {
      hasLoaded.current = true;
      void load();
    }
  }

  const run = useCallback(() => {
    if (!inputs || !knobs) return;
    const prm = stageParams(inputs, knobs.priorStrength);
    setRunning(true);
    requestAnimationFrame(() => {
      setResult(runSimulation(knobs, inputs, prm));
      setRunning(false);
    });
  }, [inputs, knobs]);

  // First simulation runs automatically once the data + defaults are in place.
  const autoRan = useRef(false);
  useEffect(() => {
    if (inputs && knobs && !autoRan.current) {
      autoRan.current = true;
      run();
    }
  }, [inputs, knobs, run]);

  function reset() {
    if (inputs) setKnobs(computeDefaults(inputs, metrics));
  }
  const set = (patch: Partial<Knobs>) => setKnobs((k) => (k ? { ...k, ...patch } : k));

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
      <button
        onClick={toggle}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700/40"
      >
        <span className="flex items-center gap-2 font-semibold text-gray-900 dark:text-white">
          <span className="text-lg">🎲</span> Monte Carlo projection
          <span className="text-xs font-normal text-gray-400">
            where this campaign is heading — best / likely / worst
          </span>
        </span>
        <ChevronDownIcon className={`w-5 h-5 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="border-t border-gray-100 dark:border-gray-700 p-4 space-y-5">
          {loading && <p className="text-sm text-gray-400">Reading this campaign's live funnel…</p>}
          {loadError && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-700 dark:text-red-300">
              <span>Couldn't load campaign data: {loadError}</span>
              <button onClick={() => void load()} className="underline hover:no-underline">
                Retry
              </button>
            </div>
          )}

          {inputs && knobs && params && (
            <>
              {/* Provenance line */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-500 dark:text-gray-400">
                <span>
                  <span className="font-semibold text-gray-700 dark:text-gray-200">{inputs.leads.toLocaleString()}</span>{" "}
                  leads observed
                </span>
                <span>
                  Pace:{" "}
                  <span className="font-semibold text-gray-700 dark:text-gray-200">
                    {inputs.weeklyPace ? `${inputs.weeklyPace.toFixed(1)}/wk` : "—"}
                  </span>
                </span>
                <span>
                  Deal size:{" "}
                  <span className="font-semibold text-gray-700 dark:text-gray-200">{money(inputs.dealSize.mean)}</span>{" "}
                  {inputs.dealSize.source === "fitted" ? (
                    <span className="text-emerald-600 dark:text-emerald-400">fitted · n={inputs.dealSize.n}</span>
                  ) : (
                    <span className="text-amber-600 dark:text-amber-400">book default</span>
                  )}
                </span>
                <span>
                  Cost/lead:{" "}
                  <span className="font-semibold text-gray-700 dark:text-gray-200">
                    {inputs.costPerLead ? money(inputs.costPerLead) : "—"}
                  </span>
                  {inputs.costSource && <span className="text-gray-400"> ({inputs.costSource})</span>}
                </span>
                <button onClick={() => void load()} className="inline-flex items-center gap-1 text-gray-400 hover:text-ocean-blue">
                  <ArrowPathIcon className="w-3.5 h-3.5" /> Refresh data
                </button>
              </div>

              {/* Controls */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Controls</h4>
                  <div className="flex items-center gap-2">
                    <button onClick={reset} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-ocean-blue">
                      <ArrowPathIcon className="w-3.5 h-3.5" /> Reset to defaults
                    </button>
                    <button
                      onClick={run}
                      disabled={running}
                      className="btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs disabled:opacity-50"
                    >
                      <CubeTransparentIcon className="w-4 h-4" /> {running ? "Running…" : "Run simulation"}
                    </button>
                  </div>
                </div>

                <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
                  <Knob
                    label="Projected leads"
                    value={knobs.projectedLeads}
                    min={0}
                    onChange={(v) => set({ projectedLeads: Math.max(0, v) })}
                    hint="How many leads this campaign delivers over the projection window. Default = current weekly pace × 4 (a month ahead)."
                  />
                  <Knob
                    label="# trials"
                    value={knobs.trials}
                    min={1000}
                    max={200000}
                    step={1000}
                    onChange={(v) => set({ trials: Math.min(200000, Math.max(1000, v)) })}
                    hint="How many simulated futures to run. More = smoother estimates, slightly longer run. 10,000 is a solid default."
                  />
                  <Knob
                    label="Prior strength (k)"
                    value={knobs.priorStrength}
                    min={0}
                    max={200}
                    onChange={(v) => set({ priorStrength: Math.max(0, v) })}
                    hint="How hard the playbook benchmark pulls a stage with little data. k is a pseudo-count: a stage blends toward its observed rate once its real sample size passes k. Low k = trust this campaign's thin data sooner; high k = stay anchored to the playbook until more leads land."
                  />
                  <Knob
                    label="Avg funded ($)"
                    value={knobs.avgFunded}
                    min={0}
                    onChange={(v) => set({ avgFunded: Math.max(0, v) })}
                    hint="Center of the funded-advance distribution. Defaults to a lognormal fitted from THIS campaign's bank-verified sizes; the spread stays fitted even if you shift the center."
                  />
                  <Knob
                    label="Cost / lead ($)"
                    value={knobs.costPerLead}
                    min={0}
                    onChange={(v) => set({ costPerLead: Math.max(0, v) })}
                    hint="What you pay per lead. Prefilled from the campaign's contracted or observed cost. Leave 0 if unknown — ROAS and cost-per-funded then show “—” rather than a made-up number."
                  />
                </div>
                <p className="text-[11px] text-gray-400 mt-2">
                  {knobs.costPerLead > 0 ? (
                    <>
                      Spend at risk ={" "}
                      <span className="font-semibold text-gray-600 dark:text-gray-300">
                        {money(knobs.projectedLeads * knobs.costPerLead)}
                      </span>{" "}
                      ({knobs.projectedLeads.toLocaleString()} leads × {money(knobs.costPerLead)}).{" "}
                    </>
                  ) : (
                    <>Cost per lead unknown — cost metrics show “—”. </>
                  )}
                  Commission = {knobs.points} points (8% of funded). Each stage rate blends a{" "}
                  <span className="text-amber-600 dark:text-amber-400">playbook prior</span> with this campaign's{" "}
                  <span className="text-emerald-600 dark:text-emerald-400">observed</span> data (below).
                </p>
              </div>

              {running && !result && <p className="text-sm text-gray-400">Running simulation…</p>}

              {result && (
                <>
                  {/* Headline cards */}
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Outcome title="Funded deals" worst={`${result.funded.p10}`} likely={`${result.funded.p50}`} best={`${result.funded.p90}`} />
                    <Outcome
                      title="Commission revenue"
                      worst={money(result.revenue.p10)}
                      likely={money(result.revenue.p50)}
                      best={money(result.revenue.p90)}
                    />
                    <Outcome
                      title="ROAS (rev ÷ spend)"
                      worst={result.roas ? mult(result.roas.p10) : "—"}
                      likely={result.roas ? mult(result.roas.p50) : "—"}
                      best={result.roas ? mult(result.roas.p90) : "—"}
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
                    {result.pProfit != null && (
                      <Callout label="P(profit)" value={`${result.pProfit.toFixed(0)}%`} hint="ROAS > 1" good={result.pProfit >= 50} />
                    )}
                    <Callout
                      label="P(≥1 funded deal)"
                      value={`${result.pAnyFunded.toFixed(0)}%`}
                      hint="at least one close"
                      good={result.pAnyFunded >= 50}
                    />
                    <div className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300">
                      Implied overall close{" "}
                      <span className="font-semibold text-gray-900 dark:text-white">{result.impliedOverallClose.toFixed(1)}%</span>
                      <span className="text-gray-400">funded ÷ leads (blended)</span>
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
                            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#9CA3AF" }} axisLine={{ stroke: "#374151", opacity: 0.3 }} interval={4} />
                            <YAxis tick={{ fontSize: 10, fill: "#9CA3AF" }} axisLine={{ stroke: "#374151", opacity: 0.3 }} allowDecimals={false} />
                            <Tooltip
                              cursor={{ fill: "#00000010" }}
                              contentStyle={{ backgroundColor: "#21262D", border: "1px solid #30363D", borderRadius: "8px", fontSize: "12px", color: "#F0F6FC" }}
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

                  {/* Observed vs blended per-stage table — how much is data vs prior */}
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
                      Stage rates — observed vs blended
                    </h4>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="text-gray-500 dark:text-gray-400 text-xs uppercase">
                          <tr>
                            <th className="py-1.5 pr-4 font-medium">Stage</th>
                            <th className="py-1.5 pr-4 font-medium text-right">Observed</th>
                            <th className="py-1.5 pr-4 font-medium text-right">Prior</th>
                            <th className="py-1.5 pr-4 font-medium text-right">Blended (used)</th>
                            <th className="py-1.5 font-medium text-right">Data weight</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                          {params.map((p) => (
                            <tr key={p.key}>
                              <td className="py-1.5 pr-4 text-gray-700 dark:text-gray-200">{p.label}</td>
                              <td className="py-1.5 pr-4 text-right text-emerald-600 dark:text-emerald-400">
                                {p.observed == null ? "—" : pct(p.observed)}
                                {p.n > 0 && <span className="text-gray-400"> (n={p.n})</span>}
                              </td>
                              <td className="py-1.5 pr-4 text-right text-amber-600 dark:text-amber-400">{pct(p.prior)}</td>
                              <td className="py-1.5 pr-4 text-right font-semibold text-gray-900 dark:text-white">{pct(p.blended)}</td>
                              <td className="py-1.5 text-right">
                                <DataWeightBar weight={p.dataWeight} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-[11px] text-gray-400 mt-1.5">
                      “Blended” is the posterior mean the sim uses: a stage with little data sits near its{" "}
                      <span className="text-amber-600 dark:text-amber-400">prior</span>; as leads accumulate it slides toward the{" "}
                      <span className="text-emerald-600 dark:text-emerald-400">observed</span> rate. Data weight = n ÷ (n + k).
                    </p>
                  </div>

                  {/* Projected funnel counts */}
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
                      Projected funnel — median with P10–P90 range
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

                  <p className="text-[11px] text-gray-400">
                    Deal size drawn lognormal ({inputs.dealSize.source === "fitted" ? "fitted σ" : `default CV ${FUNDED_CV_LABEL * 100}%`}) around{" "}
                    {money(knobs.avgFunded)}. Client-side, seeded — same knobs reproduce the same run.
                  </p>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Small pieces ─────────────────────────────────────────────────────────────
function DataWeightBar({ weight }: { weight: number }) {
  const pctW = Math.round(weight * 100);
  return (
    <span className="inline-flex items-center gap-1.5 justify-end">
      <span className="w-16 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
        <span className="block h-full bg-ocean-blue" style={{ width: `${pctW}%` }} />
      </span>
      <span className="text-[11px] tabular-nums text-gray-500 dark:text-gray-400 w-9">{pctW}%</span>
    </span>
  );
}

function Knob({
  label,
  value,
  onChange,
  min,
  max,
  step,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
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
      </span>
      <KnobInput value={value} min={min} max={max} step={step} onChange={onChange} />
    </label>
  );
}

// Free-typing numeric input: holds a local DRAFT while focused so the user can
// clear the field and type any number without min/max clamping rewriting every
// keystroke. The clamped value commits on blur or Enter.
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
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
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
