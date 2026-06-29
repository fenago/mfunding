import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  MapIcon,
  ArrowRightIcon,
  ChatBubbleLeftRightIcon,
  ClockIcon,
  DocumentCheckIcon,
  ExclamationTriangleIcon,
  TrophyIcon,
  BoltIcon,
  ArrowsRightLeftIcon,
  Squares2X2Icon,
  SparklesIcon,
  ComputerDesktopIcon,
} from "@heroicons/react/24/outline";
import { PLAYBOOKS, type Playbook, type PlaybookStep } from "../../data/playbooks";
import { MCA_PIPELINE, VCF_PIPELINE } from "../../data/pipelines";
import { getDealStats, getAllDeals } from "../../services/dealService";
import type { DealWithCustomer, DealStatus } from "../../types/deals";

const STAGE_LABELS: Record<"mca" | "vcf", Record<string, string>> = {
  mca: Object.fromEntries(MCA_PIPELINE.stages.map((s) => [s.key, s.label])),
  vcf: Object.fromEntries(VCF_PIPELINE.stages.map((s) => [s.key, s.label])),
};

const toneStyles: Record<string, { ring: string; chip: string; label: string; icon: React.ComponentType<{ className?: string }> }> = {
  leak: { ring: "border-red-300 dark:border-red-800", chip: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300", label: "Biggest leak", icon: ExclamationTriangleIcon },
  win: { ring: "border-emerald-300 dark:border-emerald-800", chip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300", label: "Win", icon: TrophyIcon },
  branch: { ring: "border-amber-300 dark:border-amber-800", chip: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300", label: "Decision point", icon: ArrowsRightLeftIcon },
  speed: { ring: "border-blue-300 dark:border-blue-800", chip: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300", label: "Speed", icon: BoltIcon },
};

export default function PlaybooksPage() {
  const [active, setActive] = useState<Playbook>(PLAYBOOKS[0]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <MapIcon className="w-6 h-6 text-ocean-blue" /> Revenue Playbooks
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          The 3 flows that make money — exactly what to do, what to say, and where to click, step by step.
        </p>
      </div>

      {/* Flow selector */}
      <div className="grid gap-4 sm:grid-cols-3">
        {PLAYBOOKS.map((p) => {
          const on = p.id === active.id;
          return (
            <button
              key={p.id}
              onClick={() => setActive(p)}
              className={`text-left rounded-xl border p-4 transition-shadow ${
                on
                  ? "border-ocean-blue ring-2 ring-ocean-blue/30 bg-white dark:bg-gray-800"
                  : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:shadow-md"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-gray-900 dark:text-white">{p.name}</span>
                <span className={`text-[10px] uppercase px-2 py-0.5 rounded-full ${p.pipeline === "vcf" ? "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300" : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"}`}>
                  {p.pipeline.toUpperCase()}
                </span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{p.tagline}</p>
              <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400 mt-2">{p.revenue}</p>
            </button>
          );
        })}
      </div>

      {/* Steps */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-4">
          <span className="font-semibold text-gray-700 dark:text-gray-200">{active.name}</span>
          <ArrowRightIcon className="w-4 h-4" />
          <span>{active.entry}</span>
        </div>

        {/* Grounding: the screen the closer keeps open for this whole flow */}
        <div className="mb-6 rounded-xl border-2 border-ocean-blue/30 bg-ocean-blue/5 dark:bg-ocean-blue/10 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ComputerDesktopIcon className="w-5 h-5 text-ocean-blue" />
              <span className="text-sm font-semibold text-gray-900 dark:text-white">
                Work this from: {active.workFrom.screen}
              </span>
            </div>
            <Link
              to={active.workFrom.route}
              className="inline-flex items-center gap-1 px-4 py-2 rounded-lg bg-ocean-blue text-white text-sm font-semibold hover:opacity-90"
            >
              Open the page <ArrowRightIcon className="w-4 h-4" />
            </Link>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-300 mt-2">{active.workFrom.appNote}</p>
        </div>

        <ol className="relative space-y-4">
          {active.steps.map((s, i) => (
            <StepCard
              key={s.n}
              step={s}
              last={i === active.steps.length - 1}
              stageLabel={s.stageKey ? STAGE_LABELS[active.pipeline][s.stageKey] : undefined}
            />
          ))}
        </ol>
      </div>

      {/* Live funnel */}
      <FunnelBoard />
    </div>
  );
}

function StepCard({ step, last, stageLabel }: { step: PlaybookStep; last: boolean; stageLabel?: string }) {
  const tone = step.tone ? toneStyles[step.tone] : null;
  return (
    <li className="relative pl-12">
      {/* connector */}
      {!last && <span className="absolute left-[18px] top-9 bottom-[-16px] w-px bg-gray-200 dark:bg-gray-700" />}
      <span className="absolute left-0 top-0 flex items-center justify-center w-9 h-9 rounded-full bg-ocean-blue text-white text-sm font-bold">
        {step.n}
      </span>
      <div className={`rounded-lg border ${tone ? tone.ring : "border-gray-200 dark:border-gray-700"} bg-gray-50 dark:bg-gray-900 p-4`}>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold text-gray-900 dark:text-white">{step.title}</h3>
          {tone && (
            <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full ${tone.chip}`}>
              <tone.icon className="w-3 h-3" /> {tone.label}
            </span>
          )}
          {step.sla && (
            <span className="inline-flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400">
              <ClockIcon className="w-3.5 h-3.5" /> {step.sla}
            </span>
          )}
        </div>

        {/* pipeline stage + supporting automation for context */}
        {(stageLabel || step.automation) && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {stageLabel && (
              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-ocean-blue/10 text-ocean-blue">
                <Squares2X2Icon className="w-3 h-3" /> Stage: {stageLabel}
              </span>
            )}
            {step.automation && (
              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-teal/10 text-teal dark:text-teal-300">
                <SparklesIcon className="w-3 h-3" /> {step.automation}
              </span>
            )}
          </div>
        )}

        <ul className="mt-2 space-y-1 text-sm text-gray-700 dark:text-gray-300 list-disc pl-5">
          {step.do.map((d, idx) => (
            <li key={idx}>{d}</li>
          ))}
        </ul>

        {step.say && (
          <div className="mt-3 flex gap-2 rounded-md bg-ocean-blue/5 dark:bg-ocean-blue/10 border-l-4 border-ocean-blue px-3 py-2">
            <ChatBubbleLeftRightIcon className="w-4 h-4 text-ocean-blue shrink-0 mt-0.5" />
            <p className="text-sm italic text-gray-700 dark:text-gray-200">"{step.say}"</p>
          </div>
        )}

        {step.collect && step.collect.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <DocumentCheckIcon className="w-4 h-4 text-gray-400" />
            {step.collect.map((c) => (
              <span key={c} className="text-[11px] px-2 py-0.5 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200">
                {c}
              </span>
            ))}
          </div>
        )}

        {step.note && <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">{step.note}</p>}

        {step.route && (
          <Link to={step.route.to} className="mt-3 inline-flex items-center gap-1 text-sm text-ocean-blue hover:underline">
            {step.route.label} <ArrowRightIcon className="w-3.5 h-3.5" />
          </Link>
        )}
      </div>
    </li>
  );
}

// ───────────────────────── Live funnel (real deals) ─────────────────────────

const TERMINAL = ["nurture", "declined", "dead"];

function FunnelBoard() {
  const [pipe, setPipe] = useState<"mca" | "vcf">("mca");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openStage, setOpenStage] = useState<string | null>(null);
  const [stageDeals, setStageDeals] = useState<DealWithCustomer[]>([]);
  const [dealsLoading, setDealsLoading] = useState(false);

  useEffect(() => {
    getDealStats()
      .then((s) => setCounts(s.byStatus))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load funnel"))
      .finally(() => setLoading(false));
  }, []);

  const def = pipe === "mca" ? MCA_PIPELINE : VCF_PIPELINE;
  const coreStages = def.stages.filter((s) => !TERMINAL.includes(s.key));
  const max = useMemo(() => Math.max(1, ...coreStages.map((s) => counts[s.key] ?? 0)), [counts, pipe]);

  async function openStageDeals(stageKey: string) {
    if (openStage === stageKey) {
      setOpenStage(null);
      return;
    }
    setOpenStage(stageKey);
    setDealsLoading(true);
    try {
      const deals = await getAllDeals({ status: stageKey as DealStatus, deal_type: pipe });
      setStageDeals(deals);
    } catch {
      setStageDeals([]);
    } finally {
      setDealsLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Where every lead is right now</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Live deal counts by stage. Click a stage to see the leads and jump into one.</p>
        </div>
        <div className="inline-flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden text-sm">
          {(["mca", "vcf"] as const).map((p) => (
            <button
              key={p}
              onClick={() => {
                setPipe(p);
                setOpenStage(null);
              }}
              className={`px-3 py-1.5 ${pipe === p ? "bg-ocean-blue text-white" : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"}`}
            >
              {p.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading ? (
        <p className="text-sm text-gray-400">Loading funnel…</p>
      ) : (
        <div className="space-y-1.5">
          {coreStages.map((s) => {
            const c = counts[s.key] ?? 0;
            const pct = Math.round((c / max) * 100);
            const open = openStage === s.key;
            return (
              <div key={s.key}>
                <button
                  onClick={() => openStageDeals(s.key)}
                  className="w-full group flex items-center gap-3 text-left"
                >
                  <span className="w-36 shrink-0 text-sm text-gray-700 dark:text-gray-200 truncate">{s.label}</span>
                  <span className="flex-1 h-7 rounded bg-gray-100 dark:bg-gray-900 overflow-hidden relative">
                    <span
                      className={`absolute inset-y-0 left-0 rounded ${open ? "bg-ocean-blue" : "bg-ocean-blue/70 group-hover:bg-ocean-blue"}`}
                      style={{ width: `${Math.max(pct, c > 0 ? 8 : 0)}%` }}
                    />
                  </span>
                  <span className="w-10 shrink-0 text-right text-sm font-semibold text-gray-900 dark:text-white">{c}</span>
                </button>

                {open && (
                  <div className="ml-36 mt-1 mb-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-2">
                    {dealsLoading ? (
                      <p className="text-xs text-gray-400 px-2 py-1">Loading…</p>
                    ) : stageDeals.length === 0 ? (
                      <p className="text-xs text-gray-400 px-2 py-1">No deals in this stage.</p>
                    ) : (
                      <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                        {stageDeals.map((d) => (
                          <li key={d.id}>
                            <Link to={`/admin/deals/${d.id}`} className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm hover:bg-white dark:hover:bg-gray-800 rounded">
                              <span className="text-gray-700 dark:text-gray-200 truncate">
                                {d.customer?.business_name || [d.customer?.first_name, d.customer?.last_name].filter(Boolean).join(" ") || d.deal_number}
                              </span>
                              <span className="text-xs text-gray-400 shrink-0">
                                {d.amount_requested ? `$${Math.round(d.amount_requested).toLocaleString()}` : ""} →
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-4 text-xs text-gray-400">
        Stages shown exclude Nurture / Declined / Dead. Open a deal to see its full pipeline and next action.
      </p>
    </div>
  );
}
