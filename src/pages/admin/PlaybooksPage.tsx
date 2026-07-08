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
  PencilSquareIcon,
  DocumentTextIcon,
} from "@heroicons/react/24/outline";
import { PLAYBOOKS, playbookIdForLeadSource, type Playbook, type PlaybookStep, type StepField } from "../../data/playbooks";
import { MCA_PIPELINE, VCF_PIPELINE, PIPELINES } from "../../data/pipelines";
import PlaybookCapture from "../../components/admin/PlaybookCapture";
import MerchantApplicationModal from "../../components/admin/MerchantApplicationModal";
import FunderPicker from "../../components/admin/FunderPicker";
import FunderResponsesBoard from "../../components/admin/FunderResponsesBoard";
import FunderAvailabilityChecklist from "../../components/admin/FunderAvailabilityChecklist";
import DocumentChecklist from "../../components/admin/DocumentChecklist";
import MyDayQueue from "../../components/admin/MyDayQueue";
import PipelineFlow from "../../components/shared/PipelineFlow";
import { getDealStats, getAllDeals, getDealById, updateDealStatus, type QueueDeal } from "../../services/dealService";
import { useActivityLog } from "../../hooks/useActivityLog";
import supabase from "../../supabase";
import { mustWrite } from "@/supabase/writes";
import type { DealWithCustomer, DealStatus, Deal } from "../../types/deals";
import { DEAL_STATUS_CONFIG } from "../../types/deals";
import { expectedCommissionInPlay, COMMISSION_DEFAULTS } from "../../types/commissions";
import { useCloserSplits, type CloserSplits } from "../../hooks/useCloserSplits";
import { useUserProfile } from "../../context/UserProfileContext";
import { CalculatorIcon } from "@heroicons/react/24/outline";

// The NEW lead-path playbooks (Synergy imports/email + cold email). Only these
// fold their shared close steps when browsing; the original flows are untouched.
const NEW_LEAD_PLAYBOOKS = new Set(["web-lead", "aged-transfer", "realtime", "cold-email"]);

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

// Stage → the deal timestamp column stamped when the deal reached that stage
// (written by updateDealStatus). Lets each step show WHEN it was completed —
// e.g. step 4's "Done · Jul 1, 10:47 PM" is the moment the docs went out.
const STAGE_DONE_AT: Record<string, keyof Deal> = {
  contacted: "contacted_at",
  qualifying: "qualified_at",
  application_sent: "application_sent_at",
  docs_collected: "docs_collected_at",
  bank_statements: "bank_statements_at",
  submitted_to_funder: "submitted_at",
  offer_received: "offer_received_at",
  offer_presented: "offer_presented_at",
  offer_accepted: "offer_accepted_at",
  funded: "funded_at",
};
const GHL_LOCATION = "t7NmVR4WCy927j4Zon4b";
const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const pipelineOf = (dealType: string): "mca" | "vcf" => (dealType === "vcf" ? "vcf" : "mca");
const dealName = (d: DealWithCustomer) =>
  d.customer?.business_name ||
  [d.customer?.first_name, d.customer?.last_name].filter(Boolean).join(" ") ||
  d.deal_number ||
  "Lead";

export default function PlaybooksPage() {
  // Live Transfer is the DEFAULT flow — the merchant is on the line the instant
  // the page opens, so it must be pre-selected with zero clicks. Speed > all.
  const [active, setActive] = useState<Playbook>(
    PLAYBOOKS.find((p) => p.id === "live-transfer") ?? PLAYBOOKS[0],
  );
  const [deal, setDeal] = useState<DealWithCustomer | null>(null);
  // The flow's step list is an accordion, DEFAULT CLOSED (My Day above stays
  // open). It auto-opens when a deal is loaded — you're here to work it.
  const [flowOpen, setFlowOpen] = useState(false);
  // Flow picker (the grid of flow cards) is an accordion, DEFAULT CLOSED.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busyStep, setBusyStep] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // The close-deal modal is lifted to the page so BOTH the top context bar and
  // every playbook step can open the SAME flow. Rendered once at the bottom.
  const [showCloseDeal, setShowCloseDeal] = useState(false);
  // Edit-lead + fill-application modals are lifted to the page so the top context
  // bar AND the "Send the application" step can both open them.
  const [showEditLead, setShowEditLead] = useState(false);
  const [showApplication, setShowApplication] = useState(false);
  const { addActivity } = useActivityLog("customer", deal?.customer_id);
  const { splits, hasCloser, renewalsEnabled } = useCloserSplits();
  const { isSuperAdmin } = useUserProfile();
  // Renewals are gated per closer: super_admin always, a closer by their flag,
  // anyone without a closer row keeps default access.
  const canRenew = isSuperAdmin || !hasCloser || renewalsEnabled;

  // Auto-dismiss the "deal closed" toast.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  // Only render the renewal picker card for users allowed to work renewals.
  // Tab order: Live Transfer first, then Website — the speed-critical flows lead
  // so a closer never burns a click to reach them. The rest keep array order
  // (V8 sort is stable, so unlisted flows stay in place).
  const PLAYBOOK_TAB_ORDER = ["live-transfer", "website"];
  const visiblePlaybooks = PLAYBOOKS
    .filter((p) => p.id !== "renewal" || canRenew)
    .slice()
    .sort((a, b) => {
      const ai = PLAYBOOK_TAB_ORDER.indexOf(a.id);
      const bi = PLAYBOOK_TAB_ORDER.indexOf(b.id);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

  // Live Transfer: the greeting already happens IN the intake capture when the
  // closer creates the lead, so its step is removed from the data entirely — here
  // we just renumber so the guided steps read 1..n starting at Qualify.
  const flowSteps =
    active.id === "live-transfer"
      ? active.steps.map((s, idx) => ({ ...s, n: idx + 1 }))
      : active.steps;

  // The deal is "live" in this playbook only when its pipeline matches the open tab.
  const dealMatchesPlaybook = !!deal && pipelineOf(deal.deal_type) === active.pipeline;
  const order = PIPELINES[active.pipeline].stages.map((s) => s.key);

  // Auto-open the flow accordion when a deal is loaded (you're here to work it);
  // it defaults closed when just browsing.
  useEffect(() => {
    if (deal) setFlowOpen(true);
  }, [deal?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const currentIdx = deal ? order.indexOf(deal.status) : -1;

  async function refreshDeal(id: string) {
    const res = await getDealById(id);
    if (res) setDeal(res.deal);
  }

  // The DocumentChecklist persists doc_checklist itself; this just mirrors the
  // change into the loaded deal so FunderAvailabilityChecklist recomputes live.
  function onDocChecklistChange(next: Record<string, boolean>) {
    setDeal((d) => (d ? { ...d, doc_checklist: next } : d));
  }

  // Click a pipeline stage to move the lead there — updates the deal + syncs GHL,
  // which fires that stage's automation (e.g. Application Sent → MCA 04 sends the docs).
  async function advanceDeal(stageKey: string) {
    if (!deal || stageKey === deal.status) return;
    const label = STAGE_LABELS[active.pipeline][stageKey] ?? stageKey;
    if (!window.confirm(`Move ${dealName(deal)} to "${label}"?\n\nThis updates the deal and fires the GoHighLevel automation for that stage.`)) return;
    try {
      await updateDealStatus(deal.id, stageKey as DealStatus);
      await refreshDeal(deal.id);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not move the deal. Please try again.");
    }
  }

  // Persist a step's structured fields + checklist + note, log it, and advance
  // the stage — everything in one click, without leaving the page.
  async function completeStep(
    step: PlaybookStep,
    values: Record<string, string>,
    note: string,
    outcome: string,
    checked: string[],
    advance = true, // false = "Save note" only: log the touch, DON'T move the stage
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
      // Persist the "collected" chips so they stay checked when the closer
      // comes back to this deal (they used to reset after every save).
      if (step.collect?.length) {
        dealUpdates.playbook_checklist = {
          ...(deal.playbook_checklist ?? {}),
          [`${active.id}:${step.n}`]: checked,
        };
      }
      if (Object.keys(custUpdates).length) {
        await mustWrite(
          "Couldn't save merchant fields",
          supabase.from("customers").update(custUpdates).eq("id", deal.customer_id),
        );
      }
      if (Object.keys(dealUpdates).length) {
        await mustWrite("Couldn't save the step", supabase.from("deals").update(dealUpdates).eq("id", deal.id));
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
      // auto-creates the commission. Skipped for "Save note"-only touches.
      if (advance && step.stageKey) {
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

  // Load a deal picked from the "My Day" queue: switch to the playbook tab that
  // matches its pipeline (preferring the Renewal flow for renewal deals when the
  // user may work them), then load the deal into the workspace.
  function pickFromQueue(d: QueueDeal) {
    const pipe = pipelineOf(d.deal_type);
    let target = visiblePlaybooks.find((p) => p.pipeline === pipe) ?? active;
    // Prefer the playbook that matches the deal's lead_source (real-time, web
    // lead, aged transfer, cold outreach/email, live transfer…), so the closer
    // lands on the RIGHT intake for how this lead arrived — not just any MCA tab.
    const bySource = playbookIdForLeadSource(d.lead_source);
    const sourceMatch = bySource && visiblePlaybooks.find((p) => p.id === bySource);
    if (sourceMatch && sourceMatch.pipeline === pipe) target = sourceMatch;
    if (d.is_renewal && canRenew) {
      const renewal = visiblePlaybooks.find((p) => p.id === "renewal");
      if (renewal) target = renewal;
    }
    setActive(target);
    refreshDeal(d.id);
  }

  // Close a deal to a terminal state from the green context bar. updateDealStatus
  // allows terminal moves (backward-lock exempts declined/dead/nurture) and fires
  // the C/D GHL sequences; we then persist the reason/note, log it, and clear the
  // workspace with a confirmation toast.
  async function closeDeal(outcome: DealStatus, reason: string, note: string) {
    if (!deal) return;
    const label = DEAL_STATUS_CONFIG[outcome]?.label ?? outcome;
    const name = dealName(deal);
    try {
      await updateDealStatus(deal.id, outcome);
      await mustWrite(
        "save deal close reason",
        supabase
          .from("deals")
          .update({ closed_reason: reason, closed_note: note.trim() || null })
          .eq("id", deal.id),
      );
      await addActivity({
        interaction_type: "note",
        subject: `Deal closed · ${label}`,
        content: [`Outcome: ${label}`, `Reason: ${reason.replace(/_/g, " ")}`, note.trim()]
          .filter(Boolean)
          .join("\n"),
      });
      setDeal(null);
      setToast(
        outcome === "nurture"
          ? `${name} moved to Nurture — the re-engage drip will keep working it.`
          : `${name} closed as ${label}.`,
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not close the deal. Please try again.");
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <MapIcon className="w-6 h-6 text-ocean-blue" /> Revenue Playbooks
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Pick a flow, start or load a lead, then just fill in each step as you talk — the page saves the data, logs the
            call, advances the stage, and updates GoHighLevel for you.
          </p>
        </div>
        {/* The Pipeline Playbook is the stage-by-stage reference/onboarding map
            (MCA web, MCA live-transfer, VCF) — kept as a companion to this
            action console rather than duplicated here. */}
        <Link
          to="/admin/pipeline-playbook"
          className="shrink-0 inline-flex items-center gap-1.5 text-sm font-medium text-ocean-blue hover:underline whitespace-nowrap"
        >
          Reference: full pipeline guide
          <ArrowRightIcon className="w-4 h-4" />
        </Link>
      </div>

      {/* My Day — ranked work queue; a card loads that deal + switches the flow tab */}
      <MyDayQueue onPick={pickFromQueue} />

      {/* Flow selector — accordion, DEFAULT CLOSED. Collapsed it shows the active
          flow; expand to pick a different one. */}
      <button
        type="button"
        onClick={() => setPickerOpen((o) => !o)}
        className="w-full flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3 text-left"
      >
        <ArrowRightIcon className={`w-4 h-4 text-gray-400 transition-transform ${pickerOpen ? "rotate-90" : ""}`} />
        <span className="text-xs text-gray-500 dark:text-gray-400">Flow:</span>
        <span className="font-semibold text-gray-900 dark:text-white">{active.name}</span>
        <span className="ml-auto text-xs text-gray-400">{pickerOpen ? "hide" : "change"}</span>
      </button>

      {pickerOpen && (
      <div className="grid gap-4 sm:grid-cols-3">
        {visiblePlaybooks.map((p) => {
          const on = p.id === active.id;
          return (
            <button
              key={p.id}
              onClick={() => { setActive(p); setPickerOpen(false); }}
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
      )}

      {/* My commission calculator */}
      <CommissionCalculator splits={splits} hasCloser={hasCloser} canRenew={canRenew} />

      {/* Steps */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-4">
          <span className="font-semibold text-gray-700 dark:text-gray-200">{active.name}</span>
          <ArrowRightIcon className="w-4 h-4" />
          <span>{active.entry}</span>
        </div>

        {/* Who you're working — capture a new lead, load one, or the pinned context */}
        {dealMatchesPlaybook && deal ? (<>
          <DealContextBar deal={deal} pipeline={active.pipeline} onClear={() => setDeal(null)} onAdvance={advanceDeal} openCloseDeal={() => setShowCloseDeal(true)} openEditLead={() => setShowEditLead(true)} splits={splits} hasCloser={hasCloser} />
          {deal.merchant_reply_at && Date.now() - Date.parse(deal.merchant_reply_at) < 3 * 24 * 60 * 60 * 1000 && (
            <div className="mt-2 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-2 text-[12px] text-emerald-800 dark:text-emerald-200 flex flex-wrap items-center gap-1.5">
              <span className="font-semibold">💬 Merchant replied {(() => { const m = Math.round((Date.now() - Date.parse(deal.merchant_reply_at!)) / 60000); return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; })()}</span>
              {deal.merchant_reply_summary && <span>— {deal.merchant_reply_summary}</span>}
              <Link to="/admin/comms" className="underline font-medium ml-auto">read the thread in Comms →</Link>
            </div>
          )}
        </>) : (
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
            <PlaybookCapture
              key={active.id}
              playbook={active}
              onCreated={(d: Deal) => refreshDeal(d.id)}
            />
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

        {/* The step-by-step flow is an accordion — DEFAULT CLOSED so the page
            leads with My Day + the flow picker; expand (or load a deal) to work. */}
        <button
          type="button"
          onClick={() => setFlowOpen((o) => !o)}
          className="w-full flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-4 py-3 text-left"
        >
          <ArrowRightIcon className={`w-4 h-4 text-gray-400 transition-transform ${flowOpen ? "rotate-90" : ""}`} />
          <span className="font-semibold text-gray-900 dark:text-white">
            {flowOpen ? "Hide" : "View"} the {active.name} flow
          </span>
          <span className="text-xs text-gray-400">{flowSteps.length} steps</span>
        </button>

        {flowOpen && (
        <ol className="relative space-y-4 mt-4">
          {flowSteps.map((s, i) => {
            const stageIdx = s.stageKey ? order.indexOf(s.stageKey) : -1;
            const done = dealMatchesPlaybook && stageIdx >= 0 && stageIdx <= currentIdx;
            const current =
              dealMatchesPlaybook && stageIdx >= 0 && stageIdx === currentIdx + 1;
            return (
              <StepCard
                key={s.n}
                step={s}
                last={i === flowSteps.length - 1}
                stageLabel={s.stageKey ? STAGE_LABELS[active.pipeline][s.stageKey] : undefined}
                stageNum={s.stageKey ? order.indexOf(s.stageKey) + 1 : undefined}
                interactive={dealMatchesPlaybook}
                deal={dealMatchesPlaybook ? deal : null}
                checklistKey={`${active.id}:${s.n}`}
                done={done}
                current={current}
                foldCloseOnBrowse={NEW_LEAD_PLAYBOOKS.has(active.id)}
                busy={busyStep === s.n}
                onComplete={completeStep}
                onDocChecklistChange={onDocChecklistChange}
                onCloseDeal={() => setShowCloseDeal(true)}
                onFillApplication={() => setShowApplication(true)}
              />
            );
          })}
        </ol>
        )}
      </div>

      {/* Live funnel */}
      <FunnelBoard />

      {/* Shared close-deal modal — opened from the top context bar OR from any
          playbook step. Single instance, single close flow. */}
      {showCloseDeal && deal && (
        <CloseDealModal
          dealName={dealName(deal)}
          onCancel={() => setShowCloseDeal(false)}
          onConfirm={async (outcome, reason, note) => {
            await closeDeal(outcome, reason, note);
            setShowCloseDeal(false);
          }}
        />
      )}

      {/* Edit lead info — a LIGHTWEIGHT modal that edits exactly the intake fields
          (name / business / email / cell), mirroring the live-transfer capture.
          NOT the heavy CustomerEditModal: closers just need to fix or add the same
          fields they'd type when starting a lead. Refreshes the deal on save. */}
      {showEditLead && deal && (
        <LeadQuickEditModal
          deal={deal}
          onClose={() => setShowEditLead(false)}
          onSaved={() => { setShowEditLead(false); refreshDeal(deal.id); }}
        />
      )}

      {/* Fill the MCA application in-app (pre-filled from the customer + deal),
          then send it to the merchant to e-sign — replaces the old "open the GHL
          contact" busywork on the Send-the-application step. */}
      {showApplication && deal && (
        <MerchantApplicationModal
          deal={deal}
          onClose={() => setShowApplication(false)}
          onSent={() => { setShowApplication(false); refreshDeal(deal.id); }}
        />
      )}

      {/* Deal-closed confirmation toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 max-w-sm rounded-lg bg-gray-900 dark:bg-gray-700 text-white shadow-xl px-4 py-3 flex items-start gap-3">
          <CheckCircleIcon className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
          <p className="text-sm">{toast}</p>
          <button onClick={() => setToast(null)} className="shrink-0 text-gray-400 hover:text-white">
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

// ───────────────────── Docs back from the merchant ─────────────────────
// Live e-sign + upload status pulled from GHL (ghl-docs-status function):
// what's signed (with view links + timestamps) and what files they uploaded.
function DocsBackPanel({ ghlContactId }: { ghlContactId: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [docs, setDocs] = useState<{ name: string; status: string; signed: boolean; updatedAt: string | null; url: string | null }[]>([]);
  const [uploads, setUploads] = useState<{ field: string; files: { name: string; url: string | null }[] }[]>([]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase.functions.invoke("ghl-docs-status", {
        body: { ghl_contact_id: ghlContactId },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      setDocs(data?.documents ?? []);
      setUploads(data?.uploads ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load doc status");
    }
    setLoading(false);
  }
  useEffect(() => { load(); }, [ghlContactId]); // eslint-disable-line react-hooks/exhaustive-deps

  const fileCount = uploads.reduce((n, u) => n + u.files.length, 0);

  return (
    <div className="mt-3 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-gray-700 dark:text-gray-200 flex items-center gap-1.5">
          <DocumentCheckIcon className="w-4 h-4 text-ocean-blue" /> Docs back from the merchant
        </span>
        <button type="button" onClick={load} className="text-[11px] text-ocean-blue hover:underline">↻ Refresh</button>
      </div>
      {loading ? (
        <p className="text-xs text-gray-400">Checking GHL…</p>
      ) : error ? (
        <p className="text-xs text-red-500">{error}</p>
      ) : (
        <div className="space-y-2">
          {docs.length === 0 && <p className="text-xs text-gray-400">No documents sent yet.</p>}
          {docs.map((d, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 text-xs">
              <span>{d.signed ? "✅" : "⏳"}</span>
              <span className="font-medium text-gray-800 dark:text-gray-100">{d.name}</span>
              <span className={d.signed ? "text-emerald-600 font-semibold" : "text-amber-600"}>
                {d.signed ? "Signed" : d.status}
              </span>
              {d.updatedAt && <span className="text-gray-400">· {fmtWhen(d.updatedAt)}</span>}
              {/* The doc's own link is the SIGNER's (permission-bound to the merchant) —
                  staff view the signed copy in the GHL dashboard instead. */}
              <a
                href={`https://app.vibereach.io/v2/location/${GHL_LOCATION}/payments/proposals-estimates`}
                target="_blank" rel="noreferrer" className="text-ocean-blue hover:underline"
                title={d.signed ? "Opens GHL → Documents & Contracts → Completed tab" : "Opens GHL → Documents & Contracts"}
              >
                View in GHL{d.signed ? " (Completed tab)" : ""} ↗
              </a>
            </div>
          ))}
          {uploads.length > 0 && (
            <div className="pt-2 border-t border-gray-100 dark:border-gray-700">
              <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1">
                📎 Uploaded files ({fileCount})
              </p>
              {uploads.map((u, i) => (
                <div key={i} className="text-xs mb-1">
                  <span className="text-gray-500">{u.field}:</span>{" "}
                  {u.files.map((f, j) => (
                    <span key={j}>
                      {j > 0 && " · "}
                      {f.url ? (
                        <a href={f.url} target="_blank" rel="noreferrer" className="text-ocean-blue hover:underline">{f.name}</a>
                      ) : (
                        <span className="text-gray-700 dark:text-gray-200">{f.name}</span>
                      )}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ───────────────────────── Intake script ─────────────────────────
// On a live-transfer intake the merchant is ALREADY on the phone, so the
// opening greeting has to sit right next to the capture fields — the closer
// reads it while typing name + phone, not after the record exists. Pulls the
// words straight from the playbook's first step (say + its do bullets) so
// playbooks.ts stays the single source of truth. Renders nothing for a step
// with no script (so it's safe to pass for any flow).

// ───────────────────────── Deal context bar ─────────────────────────

function DealContextBar({ deal, pipeline, onClear, onAdvance, openCloseDeal, openEditLead, splits, hasCloser }: { deal: DealWithCustomer; pipeline: "mca" | "vcf"; onClear: () => void; onAdvance: (stageKey: string) => void; openCloseDeal: () => void; openEditLead: () => void; splits: CloserSplits; hasCloser: boolean }) {
  const stages = PIPELINES[pipeline].stages.filter((s) => !TERMINAL.includes(s.key));
  const idx = stages.findIndex((s) => s.key === deal.status);
  const cfg = DEAL_STATUS_CONFIG[deal.status];
  const terminal = TERMINAL.includes(deal.status);
  const inPlay = expectedCommissionInPlay(deal.amount_requested, deal.is_renewal);
  // Company-lead split is the assumed default here (lead-source-aware later).
  const myCut = inPlay * (splits.company_lead_split / 100);
  return (
    <div className="mb-6 rounded-xl border-2 border-emerald-400 dark:border-emerald-700 bg-emerald-50/70 dark:bg-emerald-900/15 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <UserCircleIcon className="w-9 h-9 text-emerald-600 dark:text-emerald-400" />
          <div>
            <div className="flex items-center gap-2">
              <p className="font-semibold text-gray-900 dark:text-white">{dealName(deal)}</p>
              <button
                onClick={openEditLead}
                title="Fix or add the lead's info — name, business name, email, phone"
                className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 hover:bg-white dark:hover:bg-gray-700"
              >
                <PencilSquareIcon className="w-3.5 h-3.5" /> Edit lead info
              </button>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {[deal.customer?.phone, deal.customer?.email].filter(Boolean).join(" · ") || "No contact info yet"}
              {!deal.customer?.email && (
                <span className="ml-1 text-amber-600 dark:text-amber-400">— add an email so you can send the application</span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {deal.amount_requested ? (
            <>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                title="Potential gross commission at the requested amount (amount × points)">
                ≈ ${Math.round(inPlay).toLocaleString()} in play
              </span>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-600 text-white dark:bg-emerald-600"
                title={`Your cut at your ${splits.company_lead_split}% company-lead split${hasCloser ? "" : " (default rate)"}`}>
                your cut ≈ ${Math.round(myCut).toLocaleString()}
                <span className="ml-1 font-normal opacity-90">· {splits.company_lead_split}% company-lead split</span>
              </span>
            </>
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
          {!terminal && (
            <button
              onClick={openCloseDeal}
              title="Close this deal — nurture, declined, or dead"
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700"
            >
              Close deal…
            </button>
          )}
          <button
            onClick={onClear}
            title="Work a different lead"
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-white dark:hover:bg-gray-700"
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Animated pipeline — shows where the lead is; click a stage to move it there (fires the GHL automation). */}
      <div className="mt-4 rounded-lg bg-white/70 dark:bg-gray-800/60 border border-emerald-200 dark:border-emerald-800 px-3 py-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Where this lead is in the pipeline</span>
          <span className="text-[11px] text-gray-400">Click a stage to move the lead → it fires that stage's automation</span>
        </div>
        {/* Use the SAME terminal-filtered stages as the badge (no "Nurture" node —
            that's a close-deal off-ramp, not a forward step), so the stepper count
            matches the "N/12" badge instead of showing a phantom 13th stage. */}
        <PipelineFlow pipeline={{ ...PIPELINES[pipeline], stages }} currentKey={deal.status} onStageClick={onAdvance} terminal={terminal} />
      </div>
      <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">
        You're working this lead. Fill in each step below — it saves to the deal, logs the call, and advances the stage. Or
        click a stage above to jump the lead there.
      </p>
    </div>
  );
}

// ───────────────────────── Lead quick-edit modal ─────────────────────────
// The live-transfer intake captures the bare minimum (first name + cell), so a
// closer often needs to fix a wrong business name or add the email that later
// steps require. This edits EXACTLY those intake fields — the same ones on
// PlaybookCapture (name / business / business email / cell) — nothing else. The
// deal already carries the slim customer projection with all five, so no extra
// fetch is needed; we write straight to the customers table and refresh the deal.
function LeadQuickEditModal({ deal, onClose, onSaved }: { deal: DealWithCustomer; onClose: () => void; onSaved: () => void }) {
  const c = deal.customer;
  const [firstName, setFirstName] = useState(c?.first_name ?? "");
  const [lastName, setLastName] = useState(c?.last_name ?? "");
  const [businessName, setBusinessName] = useState(c?.business_name ?? "");
  const [email, setEmail] = useState(c?.email ?? "");
  const [phone, setPhone] = useState(c?.phone ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Same required set as the intake — plus last name (confirmed required to save).
  const canSave =
    firstName.trim() !== "" && lastName.trim() !== "" && email.trim() !== "" && phone.trim() !== "";

  async function save() {
    if (!canSave) {
      setError("First name, last name, business email, and cell phone are all required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await mustWrite(
        "update lead",
        supabase
          .from("customers")
          .update({
            first_name: firstName.trim(),
            last_name: lastName.trim(),
            business_name: businessName.trim() || null,
            email: email.trim(),
            phone: phone.trim(),
          })
          .eq("id", deal.customer_id),
      );
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the lead. Please try again.");
      setSaving(false);
    }
  }

  const Req = () => <span className="text-red-500">*</span>;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <PencilSquareIcon className="w-5 h-5 text-emerald-600" /> Edit lead info
          </h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Fix or add what you captured at intake. <Req /> = required to save; the email is how you send the application.
        </p>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400">First name <Req /></span>
              <input className="input-field w-full mt-1" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Jane" autoFocus />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Last name <Req /></span>
              <input className="input-field w-full mt-1" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Doe" />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Business name <span className="text-gray-400">(optional)</span></span>
            <input className="input-field w-full mt-1" value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Acme Co." />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Business email <Req /></span>
            <input className="input-field w-full mt-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@acme.com" />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Cell phone <Req /></span>
            <input className="input-field w-full mt-1" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 123-4567" />
          </label>
        </div>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="text-sm px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || !canSave}
            className="text-sm font-semibold px-4 py-2 rounded-lg bg-ocean-blue text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Saving…" : "Save lead info"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── Close-deal modal ─────────────────────────
// A dignified exit: move the deal to a terminal state, capture WHY, and
// (for nurture/declined) let the GHL C/D sequences take over.

const CLOSE_OUTCOMES: { value: DealStatus; label: string; hint: string }[] = [
  { value: "nurture", label: "Nurture — long-term drip", hint: "Stays in the funnel; the re-engage sequence keeps checking in." },
  { value: "declined", label: "Declined by funders", hint: "Funders passed — the declined sequence works alternatives." },
  { value: "dead", label: "Dead — do not contact", hint: "Closes the file. No further automated outreach." },
];

const CLOSE_REASONS: { value: string; label: string }[] = [
  { value: "unresponsive", label: "Unresponsive" },
  { value: "rate_too_high", label: "Rate too high" },
  { value: "went_with_competitor", label: "Went with competitor" },
  { value: "not_qualified", label: "Not qualified" },
  { value: "too_many_positions", label: "Too many positions" },
  { value: "docs_never_arrived", label: "Docs never arrived" },
  { value: "funders_declined", label: "Funders declined" },
  { value: "other", label: "Other" },
];

function CloseDealModal({
  dealName,
  onCancel,
  onConfirm,
}: {
  dealName: string;
  onCancel: () => void;
  onConfirm: (outcome: DealStatus, reason: string, note: string) => Promise<void>;
}) {
  const [outcome, setOutcome] = useState<DealStatus>("nurture");
  const [reason, setReason] = useState<string>(CLOSE_REASONS[0].value);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const active = CLOSE_OUTCOMES.find((o) => o.value === outcome);

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm(outcome, reason, note);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div
        className="w-full max-w-md rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">Close deal</h3>
          <button onClick={onCancel} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Give <b className="text-gray-700 dark:text-gray-200">{dealName}</b> a dignified exit and record why.
        </p>

        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">Outcome</label>
        <div className="space-y-2 mb-4">
          {CLOSE_OUTCOMES.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setOutcome(o.value)}
              className={`w-full text-left rounded-lg border px-3 py-2 transition ${
                outcome === o.value
                  ? "border-ocean-blue ring-1 ring-ocean-blue/30 bg-ocean-blue/5"
                  : "border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50"
              }`}
            >
              <p className="text-sm font-medium text-gray-900 dark:text-white">{o.label}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{o.hint}</p>
            </button>
          ))}
        </div>

        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">Reason</label>
        <select className="input-field w-full mb-4" value={reason} onChange={(e) => setReason(e.target.value)}>
          {CLOSE_REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>

        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">Note (optional)</label>
        <textarea
          className="input-field w-full h-20 mb-5"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Anything worth remembering when we re-engage…"
        />

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="text-sm px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={confirm}
            disabled={busy}
            className="text-sm font-semibold px-4 py-2 rounded-lg bg-ocean-blue text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Closing…" : `Close as ${active?.label.split(" —")[0] ?? "…"}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── Commission calculator ─────────────────────────
// Compact "what do I make on this deal?" calculator for the signed-in closer.
// Uses their own splits (or default 30/65/30 when they have no closers row).

function CommissionCalculator({ splits, hasCloser, canRenew }: { splits: CloserSplits; hasCloser: boolean; canRenew: boolean }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<number>(COMMISSION_DEFAULTS.AVERAGE_DEAL_SIZE);
  const [isRenewal, setIsRenewal] = useState(false);
  const [selfGen, setSelfGen] = useState(false);

  // Closers without the renewals flag never work renewals — force New and hide
  // the Renewal option entirely.
  useEffect(() => {
    if (!canRenew && isRenewal) setIsRenewal(false);
  }, [canRenew, isRenewal]);

  const points = isRenewal ? COMMISSION_DEFAULTS.RENEWAL_POINTS : COMMISSION_DEFAULTS.NEW_DEAL_POINTS;
  const gross = expectedCommissionInPlay(amount, isRenewal);
  // Renewals always use the renewal split; new deals use company vs. self-gen.
  const splitPct = isRenewal
    ? splits.renewal_split
    : selfGen
      ? splits.self_gen_split
      : splits.company_lead_split;
  const myCut = gross * (splitPct / 100);
  const house = gross - myCut;

  const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full px-5 py-3 flex items-center justify-between text-left"
      >
        <span className="flex items-center gap-2 font-semibold text-gray-900 dark:text-white">
          <CalculatorIcon className="w-5 h-5 text-emerald-600" /> 💰 My commission calculator
        </span>
        <span className="flex items-center gap-2">
          {!hasCloser && (
            <span className="text-[10px] uppercase px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300">
              default rates
            </span>
          )}
          <ArrowRightIcon className={`w-4 h-4 text-gray-400 transition-transform ${open ? "rotate-90" : ""}`} />
        </span>
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            {/* Funded amount */}
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Funded amount</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                <input
                  type="number"
                  min={0}
                  value={amount}
                  onChange={(e) => setAmount(Math.max(0, Number(e.target.value)))}
                  className="input-field w-full pl-6"
                />
              </div>
            </div>

            {/* Deal kind — Renewal option hidden for closers without the renewals flag */}
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Deal kind</label>
              <div className="inline-flex w-full rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden text-sm">
                <button
                  type="button"
                  onClick={() => setIsRenewal(false)}
                  className={`flex-1 px-3 py-2 ${!isRenewal ? "bg-ocean-blue text-white" : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"}`}
                >
                  New · {COMMISSION_DEFAULTS.NEW_DEAL_POINTS} pts
                </button>
                {canRenew && (
                  <button
                    type="button"
                    onClick={() => setIsRenewal(true)}
                    className={`flex-1 px-3 py-2 ${isRenewal ? "bg-ocean-blue text-white" : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"}`}
                  >
                    Renewal · {COMMISSION_DEFAULTS.RENEWAL_POINTS} pts
                  </button>
                )}
              </div>
            </div>

            {/* Lead type */}
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Lead type {isRenewal && <span className="text-gray-400">(renewal split)</span>}
              </label>
              <div className={`inline-flex w-full rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden text-sm ${isRenewal ? "opacity-50 pointer-events-none" : ""}`}>
                <button
                  type="button"
                  onClick={() => setSelfGen(false)}
                  className={`flex-1 px-3 py-2 ${!selfGen ? "bg-ocean-blue text-white" : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"}`}
                >
                  Company lead
                </button>
                <button
                  type="button"
                  onClick={() => setSelfGen(true)}
                  className={`flex-1 px-3 py-2 ${selfGen ? "bg-ocean-blue text-white" : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"}`}
                >
                  Self-generated
                </button>
              </div>
            </div>
          </div>

          {/* Output */}
          <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-900/15 p-4">
            <div className="grid gap-4 sm:grid-cols-3 items-end">
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Gross commission</p>
                <p className="text-lg font-semibold text-gray-900 dark:text-white">{money(gross)}</p>
                <p className="text-[11px] text-gray-400">{money(amount)} × {points} pts</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">My cut</p>
                <p className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">{money(myCut)}</p>
                <p className="text-[11px] text-gray-400">at your {splitPct}% split{hasCloser ? "" : " (default)"}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">House keeps</p>
                <p className="text-lg font-semibold text-gray-700 dark:text-gray-200">{money(house)}</p>
                <p className="text-[11px] text-gray-400">{100 - splitPct}% of gross</p>
              </div>
            </div>
          </div>
          <p className="text-[11px] text-gray-400">
            {hasCloser
              ? "Uses your personal splits from Admin → Closers."
              : "You have no closer profile yet — showing default rates (30% company-lead, 65% self-gen, 30% renewal)."}
          </p>
        </div>
      )}
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
  stageNum,
  interactive,
  deal,
  checklistKey,
  done,
  current,
  foldCloseOnBrowse,
  busy,
  onComplete,
  onDocChecklistChange,
  onCloseDeal,
  onFillApplication,
}: {
  step: PlaybookStep;
  last: boolean;
  stageLabel?: string;
  stageNum?: number;
  interactive: boolean;
  deal: DealWithCustomer | null;
  checklistKey: string;
  done: boolean;
  current: boolean;
  foldCloseOnBrowse: boolean;
  busy: boolean;
  onComplete: (step: PlaybookStep, values: Record<string, string>, note: string, outcome: string, checked: string[], advance?: boolean) => void;
  onDocChecklistChange: (next: Record<string, boolean>) => void;
  onCloseDeal: () => void;
  onFillApplication: () => void;
}) {
  const tone = step.tone ? toneStyles[step.tone] : null;

  // When did the deal reach this step's stage? (e.g. when the docs were sent)
  const tsCol = step.stageKey ? STAGE_DONE_AT[step.stageKey] : undefined;
  const doneAt = deal && tsCol ? (deal[tsCol] as string | null) : null;

  const [values, setValues] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState("call");
  const [checked, setChecked] = useState<string[]>([]);

  // Tiny jargon popovers ("What's BANT-F?", sizing rules) — toggled from the
  // title row; a step can carry several.
  const explains = step.explain ? (Array.isArray(step.explain) ? step.explain : [step.explain]) : [];
  const [showExplain, setShowExplain] = useState<number | null>(null);

  // Accordion. Working a deal: completed steps fold up so the closer lands on the
  // live one (all flows). Browsing (no lead): ORIGINAL flows stay fully expanded
  // (untouched). Only the NEW lead paths (foldCloseOnBrowse) fold the SHARED close
  // (4–9) and keep the unique intake (1–3) open, so they read as their distinctive
  // part. Click any title to toggle.
  const [openCard, setOpenCard] = useState(true);
  useEffect(() => {
    setOpenCard(interactive ? (!done || current) : (foldCloseOnBrowse ? step.n <= 3 : true));
  }, [interactive, done, current, deal?.id, step.n, foldCloseOnBrowse]); // eslint-disable-line react-hooks/exhaustive-deps

  // Prefill structured fields + the saved "collected" chips from the loaded
  // deal so captured data shows through. The note clears after each save (it's
  // a per-touch log); the checklist persists (it's collected-state, not a log).
  useEffect(() => {
    if (deal && step.fields) {
      setValues(Object.fromEntries(step.fields.map((f) => [f.key, fieldInitial(f, deal)])));
    }
    setNote("");
    setChecked(deal?.playbook_checklist?.[checklistKey] ?? []);
  }, [deal?.id, deal?.updated_at, step.fields, checklistKey]); // eslint-disable-line react-hooks/exhaustive-deps

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
        <div
          className="flex flex-wrap items-center gap-2 cursor-pointer select-none"
          onClick={() => setOpenCard((o) => !o)}
          title={openCard ? "Collapse this step" : "Expand this step"}
        >
          <ArrowRightIcon className={`w-3.5 h-3.5 text-gray-400 transition-transform ${openCard ? "rotate-90" : ""}`} />
          <h3 className="font-semibold text-gray-900 dark:text-white">{step.title}</h3>
          {explains.map((ex, i) => (
            <button
              key={i}
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowExplain((s) => (s === i ? null : i)); }}
              className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${showExplain === i ? "bg-ocean-blue text-white border-ocean-blue" : "border-ocean-blue/40 text-ocean-blue hover:bg-ocean-blue/10"}`}
              title={ex.label}
            >
              ⓘ {ex.label}
            </button>
          ))}
          {done && (
            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
              <CheckCircleIcon className="w-3 h-3" /> Done{doneAt ? ` · ${fmtWhen(doneAt)}` : ""}
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

        {/* Jargon popover — renders even when the card is folded */}
        {showExplain !== null && explains[showExplain] && (
          <div className="mt-3 rounded-lg border border-ocean-blue/30 bg-ocean-blue/5 dark:bg-ocean-blue/10 p-3">
            {explains[showExplain].intro && (
              <p className="text-xs font-medium text-gray-700 dark:text-gray-200 mb-2">{explains[showExplain].intro}</p>
            )}
            <table className="w-full text-xs">
              <tbody>
                {explains[showExplain].rows.map(([term, means, q], i) => (
                  <tr key={i} className="align-top border-t border-ocean-blue/10 first:border-t-0">
                    <td className="py-1.5 pr-3 font-semibold text-ocean-blue whitespace-nowrap">{term}</td>
                    <td className="py-1.5 pr-3 text-gray-700 dark:text-gray-200">{means}</td>
                    <td className="py-1.5 text-gray-500 dark:text-gray-400 italic">{q}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {openCard && (<>
        {(stageLabel || step.automation) && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {stageLabel && (
              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-ocean-blue/10 text-ocean-blue" title="Where this step sits in the pipeline stepper above">
                <Squares2X2Icon className="w-3 h-3" /> {stageNum ? `Pipeline stage ${stageNum} · ` : "Stage: "}{stageLabel}
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

        {/* Fold-out how-to for rare-but-important maneuvers */}
        {step.howto && (
          <details className="mt-3 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2">
            <summary className="cursor-pointer text-xs font-semibold text-gray-700 dark:text-gray-200">
              🛠 {step.howto.title}
            </summary>
            <ol className="mt-2 list-decimal pl-5 space-y-1 text-xs text-gray-600 dark:text-gray-300">
              {step.howto.steps.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ol>
            {step.howto.warn && (
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">⚠ {step.howto.warn}</p>
            )}
          </details>
        )}

        {/* Fill the application IN-APP, then send it to e-sign. This is the real
            work of this step — the closer fills as much as they can while the
            merchant is on the phone (pre-filled from what we know), saves it to
            our own system, and one click sends it out (and moves the deal to
            Application Sent). Replaces the old "open the GHL contact" busywork. */}
        {step.stageKey === "application_sent" && interactive && !done && (
          <div className="mt-3 rounded-md bg-ocean-blue/5 dark:bg-ocean-blue/10 border border-ocean-blue/30 px-3 py-3 text-xs text-gray-700 dark:text-gray-200">
            <p>
              <span className="font-semibold text-ocean-blue">Do it here:</span> fill the merchant's application while
              they're on the phone — it comes pre-filled with everything we already know, so you're just confirming and
              adding SSN, DOB, driver's license, and address as they read them to you. Then send it and all they do is{" "}
              <b>tap to sign</b>.
            </p>
            <button
              type="button"
              onClick={onFillApplication}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-ocean-blue px-3 py-1.5 text-white font-semibold hover:opacity-90"
            >
              <DocumentTextIcon className="w-4 h-4" /> Fill the application &amp; send to e-sign
            </button>
          </div>
        )}

        {/* Live doc status — what's signed + what they uploaded, straight from GHL */}
        {(step.stageKey === "application_sent" || step.stageKey === "bank_statements") && interactive && deal?.ghl_contact_id && (
          <DocsBackPanel ghlContactId={deal.ghl_contact_id} />
        )}

        {/* Docs receipt — when the send-docs step fired, show when + where to view them */}
        {step.stageKey === "application_sent" && done && (
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-3 py-2 text-xs">
            <span className="font-medium text-emerald-700 dark:text-emerald-300">
              📨 Docs sent{doneAt ? ` ${fmtWhen(doneAt)}` : ""} — application + disclosure + upload link
            </span>
            {deal?.ghl_contact_id ? (
              <a
                href={`https://app.vibereach.io/v2/location/${GHL_LOCATION}/contacts/detail/${deal.ghl_contact_id}`}
                target="_blank" rel="noreferrer"
                className="text-ocean-blue hover:underline font-medium"
              >
                View the docs on their GHL contact ↗
              </a>
            ) : (
              <a
                href={`https://app.vibereach.io/v2/location/${GHL_LOCATION}/payments/proposals-estimates`}
                target="_blank" rel="noreferrer"
                className="text-ocean-blue hover:underline font-medium"
              >
                View in GHL → Documents &amp; Contracts ↗
              </a>
            )}
          </div>
        )}

        {/* Manual doc checklist — closer ticks what they've collected; this is the
            SOURCE OF TRUTH for funder availability. Shown on the doc-collection
            steps, above the availability panel it feeds. MCA deals only. */}
        {(step.stageKey === "docs_collected" || step.stageKey === "bank_statements") &&
          interactive &&
          deal &&
          deal.deal_type === "mca" && (
            <DocumentChecklist deal={deal} onChange={onDocChecklistChange} />
          )}

        {/* Funder availability — as docs come in and at the submission step, show
            which live MCA funders are READY to submit vs NEED which docs, from the
            structured lender_programs requirements. Advisory only; doesn't gate. */}
        {(step.stageKey === "docs_collected" ||
          step.stageKey === "bank_statements" ||
          step.stageKey === "submitted_to_funder") &&
          interactive &&
          deal &&
          deal.deal_type === "mca" && <FunderAvailabilityChecklist deal={deal} />}

        {/* Funder fan-out — check the funders, hit Submit, each gets your package
            in their own recipe format. Stage advance stays on the step button. */}
        {step.stageKey === "submitted_to_funder" && interactive && deal && (
          <FunderPicker deal={deal} />
        )}

        {/* Funder responses — one card per funder the deal went to, moving through
            ⏳ Awaiting → ✉ Replied → 💰 Offer → ✅ Accepted / 🙅 Merchant declined /
            ❌ Funder declined. Log offers/declines inline; the stage move stays on
            the step button. Rendered on both offer steps that exist in the flow. */}
        {(step.stageKey === "offer_received" || step.stageKey === "offer_presented") && interactive && deal && (
          <>
            <FunderResponsesBoard deal={deal} />
            {/* Second-wave submissions: declines happen, new funders get added —
                the same picker as Step 6 (already-submitted rows gray out; the
                signed-app gate still applies) in a collapsed accordion so the
                closer can widen the net without leaving Step 7. */}
            <details className="mt-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-800/40">
              <summary className="cursor-pointer select-none px-3 py-2 text-[12px] font-semibold text-gray-700 dark:text-gray-200">
                ➕ Submit to more funders — declines came back or new funders went live? Widen the net.
              </summary>
              <div className="p-3 pt-1">
                <FunderPicker deal={deal} />
              </div>
            </details>
          </>
        )}

        {/* Accepted-offer summary as context for the Accept + e-sign step. */}
        {step.stageKey === "offer_accepted" && interactive && deal && (
          <FunderResponsesBoard deal={deal} mode="accepted" />
        )}

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
                      ? `Save note = log only. “${step.cta ? step.cta : `Mark ${stageLabel} done`}” moves the deal + fires the automation.`
                      : "Saves the info and logs it to the deal."}
                  </p>
                  <div className="flex items-center gap-2">
                    {/* Log-only save — for touches that shouldn't move the deal */}
                    {step.stageKey && !done && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onComplete(step, values, note, outcome, checked, false)}
                        className="text-sm font-semibold px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {busy ? "Saving…" : "Save note"}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onComplete(step, values, note, outcome, checked, !done)}
                      className={`text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed ${
                        done ? "border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200" : "bg-ocean-blue text-white hover:opacity-90"
                      }`}
                    >
                      {busy ? "Saving…" : done ? "Update this step" : step.cta ?? (step.stageKey ? `Mark ${stageLabel} done` : "Save & log")}
                    </button>
                  </div>
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

        {/* A deal can die at ANY step — let the closer close it from right here.
            Opens the SAME shared close-deal flow the top context bar uses. Live
            deals only (hidden in reference/browse mode). */}
        {interactive && (
          <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700 flex justify-end">
            <button
              type="button"
              onClick={onCloseDeal}
              title="Deal died here? Close it — nurture, declined, or dead"
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
            >
              <XMarkIcon className="w-3.5 h-3.5" /> Close deal
            </button>
          </div>
        )}
        </>)}
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
    const load = () =>
      getDealStats()
        .then((s) => setCounts(s.byStatus))
        .catch((e) => setError(e instanceof Error ? e.message : "Failed to load funnel"))
        .finally(() => setLoading(false));
    load();
    // Live-ish: stage moves show up without a manual refresh.
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
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
