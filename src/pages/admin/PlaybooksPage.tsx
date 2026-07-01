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
  CheckCircleIcon,
  UserCircleIcon,
  XMarkIcon,
  LockClosedIcon,
} from "@heroicons/react/24/outline";
import { PLAYBOOKS, type Playbook, type PlaybookStep, type StepField } from "../../data/playbooks";
import { MCA_PIPELINE, VCF_PIPELINE, PIPELINES } from "../../data/pipelines";
import PlaybookCapture from "../../components/admin/PlaybookCapture";
import { getDealStats, getAllDeals, getDealById, updateDealStatus } from "../../services/dealService";
import { useActivityLog } from "../../hooks/useActivityLog";
import supabase from "../../supabase";
import type { DealWithCustomer, DealStatus, Deal } from "../../types/deals";
import { DEAL_STATUS_CONFIG } from "../../types/deals";
import { expectedCommissionInPlay } from "../../types/commissions";

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

const TERMINAL = ["nurture", "declined", "dead"];
const pipelineOf = (dealType: string): "mca" | "vcf" => (dealType === "vcf" ? "vcf" : "mca");
const dealName = (d: DealWithCustomer) =>
  d.customer?.business_name ||
  [d.customer?.first_name, d.customer?.last_name].filter(Boolean).join(" ") ||
  d.deal_number ||
  "Lead";

export default function PlaybooksPage() {
  const [active, setActive] = useState<Playbook>(PLAYBOOKS[0]);
  const [deal, setDeal] = useState<DealWithCustomer | null>(null);
  const [busyStep, setBusyStep] = useState<number | null>(null);
  const { addActivity } = useActivityLog("customer", deal?.customer_id);

  // The deal is "live" in this playbook only when its pipeline matches the open tab.
  const dealMatchesPlaybook = !!deal && pipelineOf(deal.deal_type) === active.pipeline;
  const order = PIPELINES[active.pipeline].stages.map((s) => s.key);
  const currentIdx = deal ? order.indexOf(deal.status) : -1;

  async function refreshDeal(id: string) {
    const res = await getDealById(id);
    if (res) setDeal(res.deal);
  }

  // Persist a step's structured fields + checklist + note, log it, and advance
  // the stage — everything in one click, without leaving the page.
  async function completeStep(
    step: PlaybookStep,
    values: Record<string, string>,
    note: string,
    outcome: string,
    checked: string[],
  ) {
    if (!deal) return;
    setBusyStep(step.n);
    try {
      const custUpdates: Record<string, unknown> = {};
      const dealUpdates: Record<string, unknown> = {};
      for (const f of step.fields ?? []) {
        const raw = (values[f.key] ?? "").trim();
        if (raw === "") continue;
        const v = f.kind === "number" || f.kind === "money" ? Number(raw) : raw;
        (f.target === "customer" ? custUpdates : dealUpdates)[f.column] = v;
      }
      if (Object.keys(custUpdates).length) {
        await supabase.from("customers").update(custUpdates).eq("id", deal.customer_id);
      }
      if (Object.keys(dealUpdates).length) {
        await supabase.from("deals").update(dealUpdates).eq("id", deal.id);
      }

      // Log it to the deal's activity feed (the same feed the deal page shows).
      const parts: string[] = [];
      if (note.trim()) parts.push(note.trim());
      if (checked.length) parts.push(`Collected: ${checked.join(", ")}`);
      const changed = (step.fields ?? [])
        .filter((f) => (values[f.key] ?? "").trim() !== "")
        .map((f) => `${f.label}: ${values[f.key]}`);
      if (changed.length) parts.push(changed.join(" · "));
      if (parts.length) {
        await addActivity({
          interaction_type: outcome || "note",
          subject: `Playbook · ${step.title}`,
          content: parts.join("\n"),
        });
      }

      // Advance the stage (forward only) — this also syncs GHL and, on Funded,
      // auto-creates the commission.
      if (step.stageKey) {
        const tgt = order.indexOf(step.stageKey);
        if (tgt > currentIdx) await updateDealStatus(deal.id, step.stageKey as DealStatus);
      }

      await refreshDeal(deal.id);
    } catch (e) {
      console.error("completeStep failed:", e);
      alert(e instanceof Error ? e.message : "Could not save this step. Please try again.");
    } finally {
      setBusyStep(null);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <MapIcon className="w-6 h-6 text-ocean-blue" /> Revenue Playbooks
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Pick a flow, start or load a lead, then just fill in each step as you talk — the page saves the data, logs the
          call, advances the stage, and updates GoHighLevel for you.
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

        {/* Who you're working — capture a new lead, load one, or the pinned context */}
        {dealMatchesPlaybook && deal ? (
          <DealContextBar deal={deal} pipeline={active.pipeline} onClear={() => setDeal(null)} />
        ) : (
          <div className="mb-6 space-y-3">
            {deal && !dealMatchesPlaybook && (
              <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-800 dark:text-amber-200 flex items-center justify-between gap-3">
                <span>
                  You're working <b>{dealName(deal)}</b> (a {pipelineOf(deal.deal_type).toUpperCase()} deal) — switch to
                  the {pipelineOf(deal.deal_type).toUpperCase()} playbook to log against it.
                </span>
                <button onClick={() => setDeal(null)} className="shrink-0 underline">Clear</button>
              </div>
            )}
            <PlaybookCapture key={active.id} playbook={active} onCreated={(d: Deal) => refreshDeal(d.id)} />
            <ResumePicker pipeline={active.pipeline} onPick={(d) => setDeal(d)} />
          </div>
        )}

        {/* Grounding note (reference) */}
        <div className="mb-6 rounded-xl border border-ocean-blue/30 bg-ocean-blue/5 dark:bg-ocean-blue/10 p-4">
          <div className="flex items-center gap-2">
            <ComputerDesktopIcon className="w-5 h-5 text-ocean-blue" />
            <span className="text-sm font-semibold text-gray-900 dark:text-white">{active.workFrom.screen}</span>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-300 mt-2">{active.workFrom.appNote}</p>
        </div>

        <ol className="relative space-y-4">
          {active.steps.map((s, i) => {
            const stageIdx = s.stageKey ? order.indexOf(s.stageKey) : -1;
            const done = dealMatchesPlaybook && stageIdx >= 0 && stageIdx <= currentIdx;
            const current =
              dealMatchesPlaybook && stageIdx >= 0 && stageIdx === currentIdx + 1;
            return (
              <StepCard
                key={s.n}
                step={s}
                last={i === active.steps.length - 1}
                stageLabel={s.stageKey ? STAGE_LABELS[active.pipeline][s.stageKey] : undefined}
                interactive={dealMatchesPlaybook}
                deal={dealMatchesPlaybook ? deal : null}
                done={done}
                current={current}
                busy={busyStep === s.n}
                onComplete={completeStep}
              />
            );
          })}
        </ol>
      </div>

      {/* Live funnel */}
      <FunnelBoard />
    </div>
  );
}

// ───────────────────────── Deal context bar ─────────────────────────

function DealContextBar({ deal, pipeline, onClear }: { deal: DealWithCustomer; pipeline: "mca" | "vcf"; onClear: () => void }) {
  const stages = PIPELINES[pipeline].stages.filter((s) => !TERMINAL.includes(s.key));
  const idx = stages.findIndex((s) => s.key === deal.status);
  const cfg = DEAL_STATUS_CONFIG[deal.status];
  return (
    <div className="mb-6 rounded-xl border-2 border-emerald-400 dark:border-emerald-700 bg-emerald-50/70 dark:bg-emerald-900/15 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <UserCircleIcon className="w-9 h-9 text-emerald-600 dark:text-emerald-400" />
          <div>
            <p className="font-semibold text-gray-900 dark:text-white">{dealName(deal)}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {[deal.customer?.phone, deal.customer?.email].filter(Boolean).join(" · ") || "No contact info yet"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {deal.amount_requested ? (
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
              title="Potential gross commission at the requested amount (amount × points)">
              ≈ ${Math.round(expectedCommissionInPlay(deal.amount_requested, deal.is_renewal)).toLocaleString()} in play
            </span>
          ) : null}
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${cfg?.bgColor} ${cfg?.color}`}>
            {cfg?.label ?? deal.status}
            {idx >= 0 ? ` · ${idx + 1}/${stages.length}` : ""}
          </span>
          <Link
            to={`/admin/deals/${deal.id}`}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-white dark:hover:bg-gray-700"
          >
            Full deal page
          </Link>
          <button
            onClick={onClear}
            title="Work a different lead"
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-white dark:hover:bg-gray-700"
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
      <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">
        You're working this lead. Fill in each step below — it saves to the deal, logs the call, and advances the stage.
      </p>
    </div>
  );
}

// ───────────────────────── Resume picker ─────────────────────────

function ResumePicker({ pipeline, onPick }: { pipeline: "mca" | "vcf"; onPick: (d: DealWithCustomer) => void }) {
  const [deals, setDeals] = useState<DealWithCustomer[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || deals.length) return;
    setLoading(true);
    getAllDeals({ deal_type: pipeline === "vcf" ? "vcf" : "mca" })
      .then((d) => setDeals(d.filter((x) => !TERMINAL.includes(x.status) && x.status !== "funded" && x.status !== "restructure_executed")))
      .catch(() => setDeals([]))
      .finally(() => setLoading(false));
  }, [open, pipeline, deals.length]);

  // refetch when the pipeline changes
  useEffect(() => {
    setDeals([]);
    setOpen(false);
  }, [pipeline]);

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-200 flex items-center justify-between"
      >
        <span>…or resume an in-progress {pipeline.toUpperCase()} lead</span>
        <ArrowRightIcon className={`w-4 h-4 text-gray-400 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="px-4 pb-4">
          {loading ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : deals.length === 0 ? (
            <p className="text-sm text-gray-400">No in-progress {pipeline.toUpperCase()} leads right now.</p>
          ) : (
            <ul className="max-h-64 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700">
              {deals.map((d) => {
                const cfg = DEAL_STATUS_CONFIG[d.status];
                return (
                  <li key={d.id}>
                    <button
                      onClick={() => onPick(d)}
                      className="w-full flex items-center justify-between gap-2 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded px-2"
                    >
                      <span className="text-sm text-gray-700 dark:text-gray-200 truncate">{dealName(d)}</span>
                      <span className={`text-[11px] shrink-0 px-2 py-0.5 rounded-full ${cfg?.bgColor} ${cfg?.color}`}>{cfg?.label ?? d.status}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ───────────────────────── Step card (interactive) ─────────────────────────

function fieldInitial(f: StepField, deal: DealWithCustomer | null): string {
  if (!deal) return "";
  const src: Record<string, unknown> =
    f.target === "customer" ? ((deal.customer ?? {}) as Record<string, unknown>) : (deal as unknown as Record<string, unknown>);
  const v = src[f.column];
  return v === null || v === undefined ? "" : String(v);
}

function StepCard({
  step,
  last,
  stageLabel,
  interactive,
  deal,
  done,
  current,
  busy,
  onComplete,
}: {
  step: PlaybookStep;
  last: boolean;
  stageLabel?: string;
  interactive: boolean;
  deal: DealWithCustomer | null;
  done: boolean;
  current: boolean;
  busy: boolean;
  onComplete: (step: PlaybookStep, values: Record<string, string>, note: string, outcome: string, checked: string[]) => void;
}) {
  const tone = step.tone ? toneStyles[step.tone] : null;

  const [values, setValues] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState("call");
  const [checked, setChecked] = useState<string[]>([]);

  // Prefill structured fields from the loaded deal so captured data shows
  // through; also clear the per-touch note/checklist after a save (the deal's
  // updated_at changes when we advance it).
  useEffect(() => {
    if (deal && step.fields) {
      setValues(Object.fromEntries(step.fields.map((f) => [f.key, fieldInitial(f, deal)])));
    }
    setNote("");
    setChecked([]);
  }, [deal?.id, deal?.updated_at, step.fields]); // eslint-disable-line react-hooks/exhaustive-deps

  // Show the capture fields whenever the step HAS them — even before a lead is
  // started — so the closer can see where each answer goes. The box also appears
  // for stage-only steps once a lead is live (so they can advance the stage).
  const hasCapture = !!step.fields?.length || !!step.collect?.length;
  const showBox = hasCapture || (interactive && !!step.stageKey);

  const circle = done
    ? "bg-emerald-500"
    : current
      ? "bg-ocean-blue ring-4 ring-ocean-blue/20"
      : "bg-ocean-blue";

  return (
    <li className="relative pl-12">
      {!last && <span className="absolute left-[18px] top-9 bottom-[-16px] w-px bg-gray-200 dark:bg-gray-700" />}
      <span className={`absolute left-0 top-0 flex items-center justify-center w-9 h-9 rounded-full text-white text-sm font-bold ${circle}`}>
        {done ? <CheckCircleIcon className="w-5 h-5" /> : step.n}
      </span>
      <div
        className={`rounded-lg border ${
          current ? "border-ocean-blue ring-1 ring-ocean-blue/30" : tone ? tone.ring : "border-gray-200 dark:border-gray-700"
        } bg-gray-50 dark:bg-gray-900 p-4`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold text-gray-900 dark:text-white">{step.title}</h3>
          {done && (
            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
              <CheckCircleIcon className="w-3 h-3" /> Done
            </span>
          )}
          {current && !done && (
            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-ocean-blue/10 text-ocean-blue">
              You're here
            </span>
          )}
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

        {step.note && <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">{step.note}</p>}

        {/* ───── Capture area — the fields live HERE, at the step where you ask ───── */}
        {showBox ? (
          <div className={`mt-4 rounded-lg border border-dashed p-3 space-y-3 ${interactive ? "border-ocean-blue/40 bg-white dark:bg-gray-800" : "border-gray-300 dark:border-gray-700 bg-gray-100/70 dark:bg-gray-800/40"}`}>
            {!interactive && (
              <p className="text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                <LockClosedIcon className="w-3.5 h-3.5 shrink-0" />
                Start the lead at the top (name + phone) — then type each answer right here as you ask, and saving logs the call and advances the stage.
              </p>
            )}

            {/* Structured fields — visible always; editable once a lead is live */}
            {step.fields?.length ? (
              <div className="grid sm:grid-cols-2 gap-3">
                {step.fields.map((f) => (
                  <div key={f.key}>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                      {f.label}
                    </label>
                    <input
                      className="input-field w-full disabled:opacity-60 disabled:cursor-not-allowed"
                      type={f.kind === "number" || f.kind === "money" ? "number" : "text"}
                      value={values[f.key] ?? ""}
                      onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                      placeholder={f.placeholder}
                      disabled={!interactive}
                    />
                    {f.hint && <p className="mt-1 text-[11px] text-gray-400">{f.hint}</p>}
                  </div>
                ))}
              </div>
            ) : null}

            {/* Stips / info checklist */}
            {step.collect?.length ? (
              <div>
                <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 flex items-center gap-1">
                  <DocumentCheckIcon className="w-4 h-4 text-gray-400" /> Check off what you collected
                </p>
                <div className="flex flex-wrap gap-2">
                  {step.collect.map((c) => {
                    const on = checked.includes(c);
                    return (
                      <button
                        key={c}
                        type="button"
                        disabled={!interactive}
                        onClick={() => setChecked((arr) => (on ? arr.filter((x) => x !== c) : [...arr, c]))}
                        className={`text-[11px] px-2 py-1 rounded-full border transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                          on
                            ? "bg-emerald-100 border-emerald-300 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                            : "bg-gray-100 dark:bg-gray-700 border-transparent text-gray-700 dark:text-gray-200"
                        }`}
                      >
                        {on ? "✓ " : ""}
                        {c}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {/* Log + save — only once a live lead is loaded */}
            {interactive && (
              <>
                <div className="grid sm:grid-cols-[1fr_auto] gap-2 items-end">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Log the call / note</label>
                    <textarea
                      className="input-field w-full h-16"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="What happened on this touch? (optional)"
                    />
                  </div>
                  <select
                    className="input-field"
                    value={outcome}
                    onChange={(e) => setOutcome(e.target.value)}
                    title="Touch type"
                  >
                    <option value="call">Call</option>
                    <option value="email">Email</option>
                    <option value="note">Note</option>
                  </select>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] text-gray-400">
                    {step.stageKey && !done
                      ? `Saves the info, logs it, and moves the deal to “${stageLabel}”.`
                      : "Saves the info and logs it to the deal."}
                  </p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onComplete(step, values, note, outcome, checked)}
                    className={`text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed ${
                      done ? "border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200" : "bg-ocean-blue text-white hover:opacity-90"
                    }`}
                  >
                    {busy ? "Saving…" : done ? "Update this step" : step.stageKey ? `Save & mark ${stageLabel} done` : "Save & log"}
                  </button>
                </div>
              </>
            )}
          </div>
        ) : null}

        {/* Reference link to the screen for this step — always available */}
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
