import { useEffect, useMemo, useRef, useState } from "react";
import { normalizePhoneForStorage } from "@/lib/phone";
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
  DocumentArrowUpIcon,
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  MegaphoneIcon,
  PlusIcon,
  EnvelopeIcon,
} from "@heroicons/react/24/outline";
import { PLAYBOOKS, playbookIdForLeadSource, type Playbook, type PlaybookStep, type StepField } from "../../data/playbooks";
import { MCA_PIPELINE, VCF_PIPELINE, PIPELINES } from "../../data/pipelines";
import PlaybookCapture from "../../components/admin/PlaybookCapture";
import MerchantApplicationModal from "../../components/admin/MerchantApplicationModal";
import FunderPicker from "../../components/admin/FunderPicker";
import FunderResponsesBoard from "../../components/admin/FunderResponsesBoard";
import FunderAvailabilityChecklist from "../../components/admin/FunderAvailabilityChecklist";
import DocumentChecklist from "../../components/admin/DocumentChecklist";
import AIUnderwritingPanel from "../../components/shared/AIUnderwritingPanel";
import MyDayQueue from "../../components/admin/MyDayQueue";
import NewLeadToast from "../../components/admin/NewLeadToast";
import VendorEmailBanner from "../../components/admin/VendorEmailBanner";
import DealAssistant from "../../components/admin/DealAssistant";
import PipelineFlow from "../../components/shared/PipelineFlow";
import PortalAccessChip from "../../components/admin/PortalAccessChip";
import PortalInviteButton from "../../components/admin/PortalInviteButton";
import { DealDocumentsButton } from "../../components/admin/DealDocumentsModal";
import CompanyVoiceChip from "../../components/admin/CompanyVoiceChip";
import AdHocSendMenu from "../../components/admin/AdHocSendMenu";
import { dateTimeET } from "../../utils/time";
import EmailHealthChip from "../../components/admin/EmailHealthChip";
import EmailMerchantPanel from "../../components/admin/EmailMerchantPanel";
import CallHistoryPanel from "../../components/admin/CallHistoryPanel";
import LeadGradeChip from "../../components/admin/LeadGradeChip";
import EnrichmentCard from "../../components/admin/EnrichmentCard";
import { getDealStats, getAllDeals, getDealById, updateDealStatus, updateCustomerAdditionalEmails, listActiveCloserOptions, reassignDealCloser, type CloserOption } from "../../services/dealService";
import { useActivityLog } from "../../hooks/useActivityLog";
import { useNewLeadAlert } from "../../hooks/useNewLeadAlert";
import supabase from "../../supabase";
import { mustWrite } from "@/supabase/writes";
import { useSession } from "../../context/SessionContext";
import { hasSignedApplicationOnFile, uploadSignedApplication } from "../../services/signedApplication";
import type { DealWithCustomer, DealStatus, Deal, Market } from "../../types/deals";
import { DEAL_STATUS_CONFIG, MARKET_CONFIG } from "../../types/deals";
import { listCampaigns, campaignLabel, type Campaign } from "../../services/campaignService";
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

// Single source of truth for the "money in play + where in the pipeline" numbers
// so the green context bar, the sticky money bar, and the momentum toasts all
// show the SAME figures. Company-lead split is the assumed default here.
function dealMoneyStats(deal: DealWithCustomer, pipeline: "mca" | "vcf", splits: CloserSplits) {
  const stages = PIPELINES[pipeline].stages.filter((s) => !TERMINAL.includes(s.key));
  const idx = stages.findIndex((s) => s.key === deal.status);
  const cfg = DEAL_STATUS_CONFIG[deal.status];
  const inPlay = expectedCommissionInPlay(deal.amount_requested, deal.is_renewal);
  const myCut = inPlay * (splits.company_lead_split / 100);
  return { stages, stageCount: stages.length, idx, cfg, inPlay, myCut };
}
const money0 = (n: number) => `$${Math.round(n).toLocaleString()}`;

// supabase.functions.invoke stashes a non-2xx response's JSON body in
// error.context (a Response) — which no caller reads, so the closer sees the
// generic "Edge Function returned a non-2xx status code" instead of the server's
// hand-written message (the 422 no-email block, the 502 "the document was NOT
// sent"). This pulls the server's { error } out of that body (falling back to the
// raw message) and throws it, so the real reason reaches the closer verbatim.
// Call it on any functions.invoke error path: `if (err) await invokeThrow(err)`.
async function invokeThrow(error: unknown): Promise<never> {
  const ctx = (error as { context?: { json?: () => Promise<unknown> } } | null)?.context;
  if (ctx && typeof ctx.json === "function") {
    const body = (await ctx.json().catch(() => null)) as { error?: string } | null;
    if (body?.error) throw new Error(body.error);
  }
  throw new Error((error as { message?: string } | null)?.message ?? "Request failed.");
}

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
  // Bottom-right status notifications (deal closed, errors). Replaces the native
  // alert() calls this page used to fire.
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const notify = (text: string, tone: "ok" | "error" = "ok") => setToast({ text, tone });
  // Bottom-center momentum toast + confetti for a stage advance / funding.
  const [celebrate, setCelebrate] = useState<string | null>(null);
  const [confetti, setConfetti] = useState(false);
  // Promise-free confirm dialog (replaces window.confirm) — the action lives in
  // onConfirm; the dialog closes itself once it resolves.
  const [confirmState, setConfirmState] = useState<
    | { title: string; body?: string; confirmLabel: string; onConfirm: () => void | Promise<void> }
    | null
  >(null);
  // Focus mode: when a deal is loaded, only the active step is expanded. A closer
  // can flip to the old "everything expanded" view; the preference persists.
  const [expandAll, setExpandAll] = useState<boolean>(() => {
    try {
      return localStorage.getItem("playbooks:expandAll") === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("playbooks:expandAll", expandAll ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [expandAll]);
  // Sticky money bar visibility — driven by an IntersectionObserver on the green
  // context bar (below).
  const [showSticky, setShowSticky] = useState(false);
  const contextBarRef = useRef<HTMLDivElement>(null);
  // The close-deal modal is lifted to the page so BOTH the top context bar and
  // every playbook step can open the SAME flow. Rendered once at the bottom.
  const [showCloseDeal, setShowCloseDeal] = useState(false);
  // Edit-lead + fill-application modals are lifted to the page so the top context
  // bar AND the "Send the application" step can both open them.
  const [showEditLead, setShowEditLead] = useState(false);
  const [showApplication, setShowApplication] = useState(false);
  const { addActivity } = useActivityLog("customer", deal?.customer_id);
  // Campaigns — loaded once so the context bar can show the loaded deal's
  // campaign code (or the loud "no campaign" prompt when it's missing).
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  useEffect(() => {
    listCampaigns().then(setCampaigns).catch(() => setCampaigns([]));
  }, []);
  const dealCampaign = deal ? campaigns.find((c) => c.id === deal.campaign_id) ?? null : null;
  const { splits, hasCloser, renewalsEnabled } = useCloserSplits();
  const { isSuperAdmin, profile, effectiveUserId } = useUserProfile();
  // Renewals are gated per closer: super_admin always, a closer by their flag,
  // anyone without a closer row keeps default access.
  const canRenew = isSuperAdmin || !hasCloser || renewalsEnabled;

  // Realtime alerts for the playbook: (1) the SECOND a live-transfer / real-time
  // lead becomes a deal, chime + a persistent bottom-right toast; (2) when a
  // Synergy vendor email dedupes into a deal, either the special in-playbook
  // banner (if it's the deal on screen — it also auto-refreshes it) or a calm
  // corner toast (if it's another deal). Clicking a corner card loads that deal
  // (openAlertDeal below). My Day self-refreshes off the same realtime stream.
  // openDealId + onRefreshOpenDeal are passed by ref inside the hook, so this
  // doesn't resubscribe every time the loaded deal changes.
  const { alerts, dismiss: dismissAlert, matchBanner, dismissBanner, desktopEnabled, enableDesktop } =
    useNewLeadAlert({ openDealId: deal?.id ?? null, onRefreshOpenDeal: refreshDeal });

  // Auto-dismiss the "deal closed" toast.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  // Momentum toast (bottom-center) auto-clears; confetti self-removes sooner.
  useEffect(() => {
    if (!celebrate) return;
    const t = setTimeout(() => setCelebrate(null), 3500);
    return () => clearTimeout(t);
  }, [celebrate]);
  useEffect(() => {
    if (!confetti) return;
    const t = setTimeout(() => setConfetti(false), 2500);
    return () => clearTimeout(t);
  }, [confetti]);

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

  // Show the slim sticky money bar once the green context bar scrolls out of view.
  useEffect(() => {
    const el = contextBarRef.current;
    if (!el || !dealMatchesPlaybook) {
      setShowSticky(false);
      return;
    }
    const obs = new IntersectionObserver(([entry]) => setShowSticky(!entry.isIntersecting), {
      threshold: 0,
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [deal?.id, dealMatchesPlaybook]);

  const currentIdx = deal ? order.indexOf(deal.status) : -1;

  // The step a closer should be working (the one focus mode expands): the FIRST
  // step whose stage comes AFTER the deal's current status — being AT a stage
  // means that stage's step is finished, so the work is the step that ADVANCES
  // the deal. This is NOT simply "current stage + 1": a pipeline stage can have
  // no dedicated step (MCA's docs_collected sits between application_sent and the
  // bank_statements step), so +1 would land on a stageless gap and nothing would
  // expand. If the deal is at/after the final stage, focus the last stage-bearing
  // step. Steps with no stageKey are never auto-focused (they stay teasers).
  const activeStepN: number | null = (() => {
    if (!dealMatchesPlaybook || currentIdx < 0) return null;
    const next = flowSteps.find((s) => s.stageKey && order.indexOf(s.stageKey) > currentIdx);
    if (next) return next.n;
    const staged = flowSteps.filter((s) => s.stageKey);
    if (staged.length) return staged[staged.length - 1].n;
    return flowSteps.length ? flowSteps[flowSteps.length - 1].n : null;
  })();

  async function refreshDeal(id: string) {
    const res = await getDealById(id);
    if (res) setDeal(res.deal);
  }

  // ── Attribution from the closer's ONLY screen ──────────────────────────
  // An unassigned deal pays nobody. Rather than send the closer to another page
  // to fix it, the context bar claims it inline. A closer may ONLY claim an
  // unassigned deal for themselves; handing a deal to a DIFFERENT closer is an
  // admin/super_admin action. (Render-gate — see the RLS note in the report.)
  const canReassignDeal = profile?.role === "admin" || profile?.role === "super_admin";
  const isCloserRole = profile?.role === "closer";
  const [closerOptions, setCloserOptions] = useState<CloserOption[]>([]);

  useEffect(() => {
    if (!canReassignDeal) return;
    listActiveCloserOptions().then(setCloserOptions).catch(() => setCloserOptions([]));
  }, [canReassignDeal]);

  async function assignCloser(dealId: string, closerProfileId: string | null) {
    try {
      await reassignDealCloser(dealId, closerProfileId);
      await refreshDeal(dealId);
      notify(closerProfileId ? "Closer assigned — this deal is attributed." : "Closer cleared.");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Couldn't assign the closer.", "error");
    }
  }

  // The DocumentChecklist persists doc_checklist itself; this just mirrors the
  // change into the loaded deal so FunderAvailabilityChecklist recomputes live.
  function onDocChecklistChange(next: Record<string, boolean>) {
    setDeal((d) => (d ? { ...d, doc_checklist: next } : d));
  }

  // Click a pipeline stage to move the lead there — updates the deal + syncs GHL.
  // FORWARD keeps the existing celebratory flow. BACKWARD (admin/super_admin
  // only, enforced in updateDealStatus) is a pipeline correction: nothing is
  // sent to the merchant (no email, no docs, no notification — doc sends are
  // enrollment-only), stage timestamps are preserved, the GHL opportunity is
  // synced to the earlier stage, and the rewind is written to the activity log.
  function advanceDeal(stageKey: string) {
    if (!deal || stageKey === deal.status) return;
    const label = STAGE_LABELS[active.pipeline][stageKey] ?? stageKey;
    const prevIdx = currentIdx;
    const targetIdx = order.indexOf(stageKey);
    const isBackward = targetIdx !== -1 && prevIdx !== -1 && targetIdx < prevIdx;
    setConfirmState({
      title: isBackward ? `Move ${dealName(deal)} BACK to "${label}"?` : `Move ${dealName(deal)} to "${label}"?`,
      body: isBackward
        ? "This rewinds the pipeline stage. Nothing is sent to the merchant — no email, no docs, no notification. GHL moves to the earlier stage too, and the rewind is logged."
        : "This updates the deal and fires the GoHighLevel automation for that stage.",
      confirmLabel: isBackward ? "Move it back" : "Move the deal",
      onConfirm: async () => {
        try {
          await updateDealStatus(deal.id, stageKey as DealStatus);
          await refreshDeal(deal.id);
          if (isBackward) {
            notify(`Moved back to ${label} — nothing was sent to the merchant.`);
          } else {
            celebrateAdvance(stageKey, prevIdx);
          }
        } catch (e) {
          notify(e instanceof Error ? e.message : "Could not move the deal. Please try again.", "error");
        }
      },
    });
  }

  // Fire the momentum toast (+ confetti on funding) for a forward stage move.
  // Shared by the pipeline stepper (advanceDeal) and the step buttons (completeStep).
  function celebrateAdvance(stageKey: string, prevIdx: number) {
    const core = PIPELINES[active.pipeline].stages.filter((s) => !TERMINAL.includes(s.key));
    const newNum = core.findIndex((s) => s.key === stageKey) + 1;
    if (newNum <= 0) return; // terminal / off-pipeline move — no momentum toast
    const prevKey = order[prevIdx];
    const prevNum = prevKey ? core.findIndex((s) => s.key === prevKey) + 1 : 0;
    const label = STAGE_LABELS[active.pipeline][stageKey] ?? stageKey;
    const cut = deal ? expectedCommissionInPlay(deal.amount_requested, deal.is_renewal) * (splits.company_lead_split / 100) : 0;
    if (stageKey === "funded") {
      setCelebrate(`FUNDED 🎉${cut > 0 ? ` your cut ≈ ${money0(cut)}` : ""}`);
      setConfetti(true);
      return;
    }
    const from = prevNum > 0 ? `Stage ${prevNum} → ${newNum}` : `Stage ${newNum}`;
    setCelebrate(`${from} · ${label} ✓${cut > 0 ? ` · closer to your ≈ ${money0(cut)}` : ""}`);
  }

  // "Send the ORIGINAL docs" path — no prefill. The merchant gets the blank
  // application + disclosure + upload link and fills it themselves (the way it
  // worked before the in-app fill flow). resend=true re-fires MCA 04 even if the
  // deal is already at Application Sent. Either way the email guard runs server
  // side (push-application-to-ghl blocks + heals an emailless/mismatched contact).
  function sendDocs(resend: boolean) {
    if (!deal) return;
    const verb = resend ? "Resend the original application + docs (no prefill)" : "Send the application + docs now — the merchant fills it out";
    const prevIdx = currentIdx;
    setConfirmState({
      title: `${verb} to ${dealName(deal)}?`,
      body: "MCA 04 emails the merchant the application to e-sign plus the secure upload link.",
      confirmLabel: resend ? "Resend the docs" : "Send the docs",
      onConfirm: async () => {
        try {
          const { data, error } = await supabase.functions.invoke("push-application-to-ghl", {
            body: { dealId: deal.id, blank: true, resend },
          });
          if (error) await invokeThrow(error);
          const res = data as { error?: string; reenrolled?: boolean };
          if (res?.error) throw new Error(res.error);
          // First send: advancing to Application Sent fires MCA 04 via the stage move.
          // Resend: the server already re-enrolled the contact, so don't move the stage.
          if (!resend) await updateDealStatus(deal.id, "application_sent");
          await refreshDeal(deal.id);
          if (resend && res?.reenrolled === false) {
            notify(
              "Contact is ready, but GHL rejected the MCA 04 re-enrollment, so the docs did NOT re-send. Re-send the document manually from GHL → Documents & Contracts (move the old doc to Draft first).",
              "error",
            );
          } else if (resend) {
            notify("Original docs re-sent — the merchant will get the application to fill + e-sign.");
          } else {
            notify("Docs sent — the merchant will fill and e-sign.");
            celebrateAdvance("application_sent", prevIdx);
          }
        } catch (e) {
          notify(e instanceof Error ? e.message : "Could not send the docs.", "error");
        }
      },
    });
  }

  // "Send PARTIAL" (04C) — the fastest path and the default for a normal lead.
  // We push the ~14 values the LEAD already gave us (straight from lead_qual, no
  // application form involved) and the merchant completes the rest — EIN, SSN,
  // addresses, banking — as fillable fields on the document itself, then signs.
  // The closer types NOTHING. Same confirm dialog as the other two paths.
  function sendPartialDocs(resendArg: boolean) {
    if (!deal) return;
    // A deal already at Application Sent means the contact may still be sitting in
    // the 04C workflow — a plain re-enroll silently no-ops there. Treat any send on
    // an already-sent deal as a resend so the server removes + re-enrolls.
    const resend = resendArg || deal.status === "application_sent" || !!deal.application_sent_at;
    const prevIdx = currentIdx;
    setConfirmState({
      title: `Send the PARTIAL application to ${dealName(deal)}?`,
      body: "We prefill what the lead already told us (name, business, amounts). The merchant completes the rest — EIN, SSN, address, banking — right on the document, then signs. You type nothing.",
      confirmLabel: resend ? "Resend partial" : "Send partial",
      onConfirm: async () => {
        try {
          const { data, error } = await supabase.functions.invoke("push-application-to-ghl", {
            body: { dealId: deal.id, partial: true, resend },
          });
          if (error) await invokeThrow(error);
          const res = data as { error?: string; verification?: string; verified_template?: string | null };
          if (res?.error) throw new Error(res.error);
          if (!resend) await updateDealStatus(deal.id, "application_sent");
          await refreshDeal(deal.id);
          notify(
            res?.verification === "confirmed"
              ? `Partial application sent — GHL confirmed "${res.verified_template}". The merchant completes the rest and signs.`
              : "Partial application sent — awaiting GHL confirmation. The merchant completes the rest and signs.",
          );
          if (!resend) celebrateAdvance("application_sent", prevIdx);
        } catch (e) {
          notify(e instanceof Error ? e.message : "Could not send the partial application.", "error");
        }
      },
    });
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
      const prevIdx = currentIdx;
      let didAdvance = false;
      if (advance && step.stageKey) {
        const tgt = order.indexOf(step.stageKey);
        if (tgt > currentIdx) {
          await updateDealStatus(deal.id, step.stageKey as DealStatus);
          didAdvance = true;
        }
      }

      await refreshDeal(deal.id);
      if (didAdvance && step.stageKey) celebrateAdvance(step.stageKey, prevIdx);
    } catch (e) {
      console.error("completeStep failed:", e);
      notify(e instanceof Error ? e.message : "Could not save this step. Please try again.", "error");
    } finally {
      setBusyStep(null);
    }
  }

  // Load a deal picked from the "My Day" queue: switch to the playbook tab that
  // matches its pipeline (preferring the Renewal flow for renewal deals when the
  // user may work them), then load the deal into the workspace.
  // Used by BOTH My Day and the ResumePicker so loading a deal ALWAYS lands on
  // the flow matching how the lead arrived (a website lead must never render
  // under the Live Transfer tab's step numbering just because that tab is the
  // default).
  function pickFromQueue(d: DealWithCustomer) {
    const pipe = pipelineOf(d.deal_type);
    // Fallback for an UNMAPPED lead source must be deliberate — the generic
    // inbound flow ("website") for MCA — NOT "the first tab in the sorted list".
    // (When Live Transfer became the first/default tab, the old first-tab
    // fallback silently rendered unmapped website_apply deals as live transfers.)
    let target =
      (pipe === "mca" ? visiblePlaybooks.find((p) => p.id === "website") : undefined) ??
      visiblePlaybooks.find((p) => p.pipeline === pipe) ??
      active;
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

  // Open a deal straight from a new-lead alert: fetch the full record, then route
  // it through pickFromQueue so it lands on the RIGHT flow tab (live transfer /
  // real-time) exactly as a My Day click would. Dismisses the alert immediately.
  async function openAlertDeal(dealId: string) {
    dismissAlert(dealId);
    const res = await getDealById(dealId);
    if (res) {
      pickFromQueue(res.deal);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      notify("Couldn't open that lead — it may have just changed. Find it in My Day.", "error");
    }
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
      notify(
        outcome === "nurture"
          ? `${name} moved to Nurture — the re-engage drip will keep working it.`
          : `${name} closed as ${label}.`,
      );
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not close the deal. Please try again.", "error");
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <MapIcon className="w-6 h-6 text-ocean-blue" /> Revenue Playbooks
          </h1>
          {!deal && (
            <p className="text-gray-500 dark:text-gray-400 mt-1">
              Work each deal step-by-step — it saves, logs, advances the stage, and syncs GoHighLevel.
            </p>
          )}
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
          {/* Floating escape hatch — deep in the steps there was no way to switch
              leads without a page refresh (the ✕ lives in the non-sticky context
              bar at the top). Fixed bottom-right: jump to top, or clear the deal
              and land back on the picker. z-40 so modals (z-50) stay above. */}
          <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-2">
            <button
              type="button"
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              title="Scroll to the top"
              className="rounded-full shadow-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              ↑ Top
            </button>
            <button
              type="button"
              onClick={() => { setDeal(null); window.scrollTo({ top: 0, behavior: "smooth" }); }}
              title="Clear this lead and pick another"
              className="rounded-full shadow-lg bg-ocean-blue px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              ⇄ Switch lead
            </button>
          </div>
          {/* SPECIAL: the vendor email for the deal on screen just landed + merged.
              Shown only for the deal currently loaded (the hook gates on openDealId,
              and we double-check the id in case the closer switched deals mid-fire). */}
          {matchBanner && matchBanner.dealId === deal.id && (
            <VendorEmailBanner banner={matchBanner} onDismiss={dismissBanner} />
          )}
          {showSticky && <StickyMoneyBar deal={deal} pipeline={active.pipeline} splits={splits} campaign={dealCampaign} />}
          <div ref={contextBarRef}>
            <DealContextBar
              deal={deal}
              pipeline={active.pipeline}
              campaign={dealCampaign}
              onClear={() => setDeal(null)}
              onAdvance={advanceDeal}
              onRefresh={() => refreshDeal(deal.id)}
              openCloseDeal={() => setShowCloseDeal(true)}
              openEditLead={() => setShowEditLead(true)}
              splits={splits}
              hasCloser={hasCloser}
              canReassign={canReassignDeal}
              closerOptions={closerOptions}
              canClaim={isCloserRole && !!effectiveUserId}
              onAssignCloser={(profileId) => assignCloser(deal.id, profileId)}
              myProfileId={effectiveUserId}
            />
          </div>
          {/* Deal-desk AI — scoped to THIS deal. The closer is often on the phone
              with a funder who's asking for things; this answers instantly from
              the deal's full record (stips, funders + what they said, pipeline). */}
          <DealAssistant deal={deal} />
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
            <ResumePicker pipeline={active.pipeline} onPick={pickFromQueue} />
          </div>
        )}

        {/* Grounding note (reference) — onboarding text, so it only shows while
            browsing. Once a deal is loaded the closer is working, not reading. */}
        {!deal && (
          <div className="mb-6 rounded-xl border border-ocean-blue/30 bg-ocean-blue/5 dark:bg-ocean-blue/10 p-4">
            <div className="flex items-center gap-2">
              <ComputerDesktopIcon className="w-5 h-5 text-ocean-blue" />
              <span className="text-sm font-semibold text-gray-900 dark:text-white">{active.workFrom.screen}</span>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-300 mt-2">{active.workFrom.appNote}</p>
          </div>
        )}

        {/* The step-by-step flow is an accordion — DEFAULT CLOSED so the page
            leads with My Day + the flow picker; expand (or load a deal) to work. */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setFlowOpen((o) => !o)}
            className="flex-1 flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-4 py-3 text-left"
          >
            <ArrowRightIcon className={`w-4 h-4 text-gray-400 transition-transform ${flowOpen ? "rotate-90" : ""}`} />
            <span className="font-semibold text-gray-900 dark:text-white">
              {flowOpen ? "Hide" : "View"} the {active.name} flow
            </span>
            <span className="text-xs text-gray-400">{flowSteps.length} steps</span>
          </button>
          {/* Focus mode shows only the live step; a closer can flip to the old
              "everything expanded" view. Only relevant while working a deal. */}
          {dealMatchesPlaybook && flowOpen && (
            <button
              type="button"
              onClick={() => setExpandAll((v) => !v)}
              title={expandAll ? "Focus on just the current step" : "Show every step expanded"}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-3 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              {expandAll ? "Focus mode" : "Expand all"}
            </button>
          )}
        </div>

        {flowOpen && (
        <ol className="relative space-y-4 mt-4">
          {flowSteps.map((s, i) => {
            const stageIdx = s.stageKey ? order.indexOf(s.stageKey) : -1;
            const done = dealMatchesPlaybook && stageIdx >= 0 && stageIdx <= currentIdx;
            // The active step = the next actionable one (computed above), so the
            // "You're here" highlight and focus-mode expansion land on the step
            // that advances the deal — not on a stageless gap after the current one.
            const current = dealMatchesPlaybook && s.n === activeStepN;
            return (
              <StepCard
                key={s.n}
                step={s}
                last={i === flowSteps.length - 1}
                stageLabel={s.stageKey ? STAGE_LABELS[active.pipeline][s.stageKey] : undefined}
                stageNum={s.stageKey ? order.indexOf(s.stageKey) + 1 : undefined}
                interactive={dealMatchesPlaybook}
                focus={dealMatchesPlaybook && !expandAll}
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
                onSendDocs={sendDocs}
                onSendPartial={sendPartialDocs}
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

      {/* Status toast (deal closed, errors) — bottom-right */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 max-w-sm rounded-lg bg-gray-900 dark:bg-gray-700 text-white shadow-xl px-4 py-3 flex items-start gap-3">
          {toast.tone === "error" ? (
            <ExclamationTriangleIcon className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          ) : (
            <CheckCircleIcon className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
          )}
          <p className="text-sm">{toast.text}</p>
          <button onClick={() => setToast(null)} className="shrink-0 text-gray-400 hover:text-white">
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Momentum toast — bottom-center, celebrates a stage advance / funding */}
      {celebrate && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-full bg-emerald-600 text-white shadow-2xl px-5 py-2.5 text-sm font-semibold flex items-center gap-2">
          {celebrate}
        </div>
      )}

      {/* Confetti burst on funding — no dependency, self-removes */}
      {confetti && <Confetti />}

      {/* Realtime new-lead alert stack — persists until clicked/dismissed */}
      <NewLeadToast
        alerts={alerts}
        onOpen={openAlertDeal}
        onDismiss={dismissAlert}
        desktopEnabled={desktopEnabled}
        onEnableDesktop={enableDesktop}
      />

      {/* Confirm dialog — replaces window.confirm for stage moves / doc sends */}
      {confirmState && (
        <ConfirmDialog
          title={confirmState.title}
          body={confirmState.body}
          confirmLabel={confirmState.confirmLabel}
          onCancel={() => setConfirmState(null)}
          onConfirm={async () => {
            await confirmState.onConfirm();
            setConfirmState(null);
          }}
        />
      )}
    </div>
  );
}

// ───────────────────────── Confetti + momentum ─────────────────────────
// ~36 absolutely-positioned pieces animated by an inline keyframe — no library.
// The parent unmounts it after ~2.5s.
function Confetti() {
  const pieces = useMemo(() => {
    const colors = ["#059669", "#0ea5e9", "#f59e0b", "#ef4444", "#8b5cf6", "#10b981"];
    return Array.from({ length: 36 }, (_, i) => ({
      left: Math.random() * 100,
      delay: Math.random() * 0.35,
      dur: 1.8 + Math.random() * 0.9,
      rot: Math.random() * 360,
      bg: colors[i % colors.length],
      w: 6 + Math.round(Math.random() * 6),
    }));
  }, []);
  return (
    <div className="pointer-events-none fixed inset-0 z-[60] overflow-hidden">
      <style>{`@keyframes confetti-fall{0%{transform:translateY(-12vh) rotate(0);opacity:1}100%{transform:translateY(112vh) rotate(720deg);opacity:.9}}`}</style>
      {pieces.map((p, i) => (
        <span
          key={i}
          style={{
            position: "absolute",
            top: 0,
            left: `${p.left}%`,
            width: p.w,
            height: p.w * 1.6,
            background: p.bg,
            borderRadius: 1,
            transform: `rotate(${p.rot}deg)`,
            animation: `confetti-fall ${p.dur}s ${p.delay}s ease-in forwards`,
          }}
        />
      ))}
    </div>
  );
}

// ───────────────────────── Sticky money bar ─────────────────────────
// Appears when the green context bar scrolls out of view — keeps the deal name,
// where it is in the pipeline, and the closer's cut in front of them. Sticks to
// the top of the content scroll area; z below modals (z-50) and floating buttons.
function StickyMoneyBar({ deal, pipeline, splits, campaign }: { deal: DealWithCustomer; pipeline: "mca" | "vcf"; splits: CloserSplits; campaign: Campaign | null }) {
  const { idx, stageCount, cfg, myCut } = dealMoneyStats(deal, pipeline, splits);
  return (
    <div className="sticky top-0 z-30 -mx-5 mb-4 flex items-center gap-2 border-b border-emerald-300 dark:border-emerald-800 bg-emerald-50/95 dark:bg-emerald-900/40 px-5 py-2 backdrop-blur">
      <span className="truncate text-sm font-semibold text-gray-900 dark:text-white">{dealName(deal)}</span>
      {/* Tiny attribution marker — mirrors the context-bar chip so a scrolled
          closer still sees when a deal is untracked. */}
      {campaign ? (
        <span className="shrink-0 text-[11px] font-medium text-gray-500 dark:text-gray-400" title={campaign.name}>
          · {campaignLabel(campaign)}
        </span>
      ) : (
        <span className="shrink-0 text-[11px] font-semibold text-amber-700 dark:text-amber-300" title="No campaign attached — this deal isn't tracked">
          · ⚠ no campaign
        </span>
      )}
      {idx >= 0 && (
        <span className="shrink-0 text-xs text-gray-600 dark:text-gray-300">
          · Stage {idx + 1} of {stageCount} — {cfg?.label ?? deal.status}
        </span>
      )}
      {myCut > 0 && (
        <span className="shrink-0 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
          · your cut ≈ {money0(myCut)}
        </span>
      )}
      <button
        type="button"
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        title="Jump to the top"
        className="ml-auto shrink-0 rounded-md border border-emerald-300 dark:border-emerald-700 px-2 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300 hover:bg-white dark:hover:bg-gray-800"
      >
        ▲
      </button>
    </div>
  );
}

// ───────────────────────── Confirm dialog ─────────────────────────
function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  title: string;
  body?: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div
        className="w-full max-w-sm rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-bold text-gray-900 dark:text-white">{title}</h3>
        {body && <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{body}</p>}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="text-sm px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
            className="text-sm font-semibold px-4 py-2 rounded-lg bg-ocean-blue text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ───────────────────── Docs back from the merchant ─────────────────────
// Live e-sign + upload status pulled from GHL (ghl-docs-status function):
// what's signed (with view links + timestamps) and what files they uploaded.
type GhlDoc = { name: string; status: string; signed: boolean; updatedAt: string | null; url: string | null };
type DocGroup = { key: string; latest: GhlDoc; older: GhlDoc[]; count: number };

// GHL re-sends the same document when a closer edits/re-issues it (e.g. fields
// were filled in late), so the raw list can carry several copies of the same
// doc — some stale, some signed. Collapse copies of the SAME document into one
// group so the closer sees a single, unambiguous "latest" status instead of a
// flat pile with no hierarchy.
const normalizeDocName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "");
const docTs = (d: GhlDoc) => (d.updatedAt ? new Date(d.updatedAt).getTime() : 0);
function groupDocs(docs: GhlDoc[]): DocGroup[] {
  const map = new Map<string, GhlDoc[]>(); // insertion order = first-appearance order (stable)
  for (const d of docs) {
    const key = normalizeDocName(d.name);
    (map.get(key) ?? map.set(key, []).get(key)!).push(d);
  }
  return [...map.entries()].map(([key, arr]) => {
    const sorted = [...arr].sort((a, b) => docTs(b) - docTs(a)); // newest first
    return { key, latest: sorted[0], older: sorted.slice(1), count: sorted.length };
  });
}

const ghlDocsUrl = `https://app.vibereach.io/v2/location/${GHL_LOCATION}/payments/proposals-estimates`;

// One document group: the latest copy up top, older copies collapsed underneath.
// The loud case is an amber warning — the newest copy is unsigned but an older
// copy WAS signed, so it's ambiguous whether anything still needs a signature.
function DocGroupRow({ group }: { group: DocGroup }) {
  const [open, setOpen] = useState(false);
  const { latest, older, count } = group;
  const olderSigned = older.some((o) => o.signed);
  const warn = !latest.signed && olderSigned; // newest unsigned, an older one signed
  return (
    <div className="text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span>{latest.signed ? "✅" : warn ? "⚠️" : "⏳"}</span>
        <span className="font-medium text-gray-800 dark:text-gray-100">{latest.name}</span>
        {count > 1 && (
          <span className="rounded bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 text-[10px] text-gray-500 dark:text-gray-300">
            sent {count}×
          </span>
        )}
        <span className={latest.signed ? "text-emerald-600 font-semibold" : warn ? "text-amber-700 font-semibold" : "text-amber-600"}>
          {latest.signed ? "Signed" : latest.status}
        </span>
        {latest.updatedAt && <span className="text-gray-400">· {fmtWhen(latest.updatedAt)}</span>}
        {/* The doc's own link is the SIGNER's (permission-bound to the merchant) —
            staff view the signed copy in the GHL dashboard instead. */}
        <a
          href={ghlDocsUrl}
          target="_blank" rel="noreferrer" className="text-ocean-blue hover:underline"
          title={latest.signed ? "Opens GHL → Documents & Contracts → Completed tab" : "Opens GHL → Documents & Contracts"}
        >
          View in GHL{latest.signed ? " (Completed tab)" : ""} ↗
        </a>
      </div>
      {warn && (
        <div className="mt-1 flex items-start gap-1.5 rounded border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-2 py-1 text-[11px] font-medium text-amber-800 dark:text-amber-300">
          <span>⚠</span>
          <span>Newest copy is unsigned — the merchant signed an older version. Confirm which copy is valid before advancing.</span>
        </div>
      )}
      {older.length > 0 && (
        <div className="mt-1 ml-6">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:underline"
          >
            {open ? "Hide earlier copies ▲" : `${older.length} earlier ${older.length === 1 ? "copy" : "copies"} ▼`}
          </button>
          {open && (
            <div className="mt-1 space-y-1 border-l-2 border-gray-200 dark:border-gray-700 pl-2">
              {older.map((o, i) => (
                <div key={i} className="flex flex-wrap items-center gap-1.5 text-[11px] text-gray-400">
                  <span className="rounded bg-gray-100 dark:bg-gray-700 px-1 py-0.5 text-[9px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    Superseded
                  </span>
                  <span>{o.signed ? "Signed" : o.status}</span>
                  {o.updatedAt && <span>· {fmtWhen(o.updatedAt)}</span>}
                  <a href={ghlDocsUrl} target="_blank" rel="noreferrer" className="text-ocean-blue/70 hover:underline">
                    View in GHL ↗
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Step 5's UNMISSABLE step: the merchant e-signs the application in GHL, but that
// signed PDF lives ONLY in GHL and the API can't fetch it — so a human must
// download it and re-upload it here, or submit-to-funders HARD-BLOCKS the fan-out
// (funder emails attach docs from OUR storage, not GHL). Loud amber until it's on
// file; flips green once it is. Renders directly under the application doc's row.
function SignedAppActionBanner({ customerId, attached, onUploaded }: { customerId: string; attached: boolean; onUploaded: () => void }) {
  const { session } = useSession();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function doUpload() {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      await uploadSignedApplication({ file, customerId, uploadedBy: session?.user?.id });
      setFile(null);
      onUploaded();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  if (attached) {
    return (
      <div className="mt-1.5 ml-6 flex items-center gap-1.5 rounded-md border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-2 text-[12px] font-medium text-emerald-800 dark:text-emerald-200">
        <CheckCircleIcon className="w-4 h-4 shrink-0" />
        Signed application attached — it now goes out with every funder submission.
      </div>
    );
  }

  return (
    <div className="mt-1.5 ml-6 rounded-md border-2 border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/25 px-3 py-2.5 space-y-2">
      <p className="text-[12px] font-semibold text-amber-900 dark:text-amber-200 flex items-start gap-1.5">
        <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" />
        Signed application is in GHL but NOT attached in the system — funder submissions are BLOCKED until it's uploaded.
      </p>
      <ol className="list-decimal pl-5 text-[11px] text-amber-800 dark:text-amber-300 space-y-0.5">
        <li>Open in GHL → Completed</li>
        <li>Download the signed PDF</li>
        <li>Upload it here</li>
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={ghlDocsUrl}
          target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded border border-ocean-blue/50 text-ocean-blue hover:bg-ocean-blue/5"
        >
          Open in GHL (Completed tab) <ArrowTopRightOnSquareIcon className="w-3 h-3" />
        </a>
        <input
          type="file"
          accept="application/pdf"
          onChange={(e) => { setFile(e.target.files?.[0] ?? null); setErr(null); }}
          className="text-[11px] text-gray-600 dark:text-gray-300 file:mr-2 file:rounded file:border-0 file:bg-ocean-blue/10 file:px-2 file:py-1 file:text-ocean-blue"
        />
        <button
          type="button"
          disabled={!file || busy}
          onClick={doUpload}
          className="text-[11px] font-semibold px-2 py-1 rounded bg-ocean-blue text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1"
        >
          {busy ? <ArrowPathIcon className="w-3 h-3 animate-spin" /> : <DocumentArrowUpIcon className="w-3 h-3" />}
          {busy ? "Uploading…" : "Upload signed PDF"}
        </button>
      </div>
      {err && <p className="text-[11px] text-red-600 dark:text-red-400">{err}</p>}
    </div>
  );
}

// Compact e-sign status for the CONTEXT BAR — the answer to "did they sign the
// disclosure and the application?" without scrolling to the full panel below.
// Same data source as DocsBackPanel (ghl-docs-status), rendered as one chip per
// document group: ✓ signed (emerald) / ⏳ current status (amber).
function DocsBackChips({ ghlContactId }: { ghlContactId: string }) {
  const [groups, setGroups] = useState<DocGroup[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    setGroups(null);
    supabase.functions.invoke("ghl-docs-status", { body: { ghl_contact_id: ghlContactId } })
      .then(({ data }) => {
        if (cancelled || data?.error) return;
        setGroups(groupDocs((data?.documents ?? []) as GhlDoc[]));
      })
      .catch(() => { /* the full panel below surfaces errors; chips stay quiet */ });
    return () => { cancelled = true; };
  }, [ghlContactId]);

  if (!groups || groups.length === 0) return null;
  const short = (name: string) =>
    /broker\s*compensation|broker\s*agreement/i.test(name) ? "Broker agmt"
    : /application|04b|04c/i.test(name) ? "Application"
    : /tcpa|consent/i.test(name) ? "Consent"
    : name.length > 16 ? `${name.slice(0, 14)}…` : name;
  return (
    <>
      {groups.map((g) => (
        <span
          key={g.key}
          title={`${g.latest.name} — ${g.latest.signed ? "signed" : g.latest.status}${g.latest.updatedAt ? ` · ${dateTimeET(g.latest.updatedAt)}` : ""}`}
          className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${
            g.latest.signed
              ? "bg-emerald-50 dark:bg-emerald-900/30 border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300"
              : "bg-amber-50 dark:bg-amber-900/30 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300"
          }`}
        >
          {g.latest.signed ? "✍️" : "⏳"} {short(g.latest.name)} {g.latest.signed ? "✓ signed" : `· ${g.latest.status}`}
          {/* THIS merchant's signing link — copy it to text them ("just tap this
              and sign"). Bearer link straight from the GHL doc record. */}
          {!g.latest.signed && g.latest.url && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void navigator.clipboard.writeText(g.latest.url!);
                const el = e.currentTarget;
                el.textContent = "✓";
                setTimeout(() => { el.textContent = "📋"; }, 1500);
              }}
              title={`Copy ${short(g.latest.name)}'s signing link for this merchant — paste it into a text`}
              className="ml-0.5 hover:opacity-70"
            >
              📋
            </button>
          )}
        </span>
      ))}
    </>
  );
}

function DocsBackPanel({ ghlContactId, customerId }: { ghlContactId: string; customerId: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [docs, setDocs] = useState<GhlDoc[]>([]);
  const [uploads, setUploads] = useState<{ field: string; files: { name: string; url: string | null }[] }[]>([]);
  // Whether the signed application is attached APP-SIDE (customer_documents) —
  // ground truth for the action banner. Null until the first check resolves, so
  // the LOUD banner never flashes before we know.
  const [appAttached, setAppAttached] = useState<boolean | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase.functions.invoke("ghl-docs-status", {
        body: { ghl_contact_id: ghlContactId },
      });
      if (data?.error) throw new Error(data.error);
      if (error) await invokeThrow(error);
      setDocs(data?.documents ?? []);
      setUploads(data?.uploads ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load doc status");
    }
    setLoading(false);
  }
  // App-side attachment is checked independently of the GHL peek so a GHL error
  // never hides the banner (and vice-versa).
  async function checkAttached() {
    try {
      setAppAttached(await hasSignedApplicationOnFile(customerId));
    } catch {
      /* leave prior value; the banner just won't flip until the next check */
    }
  }
  useEffect(() => { load(); checkAttached(); }, [ghlContactId, customerId]); // eslint-disable-line react-hooks/exhaustive-deps

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
          {groupDocs(docs).map((g) => {
            // The application group's LATEST copy signed in GHL is the trigger for
            // the unmissable "upload it here" banner (only once the check resolves,
            // so the LOUD state never flashes). Not-signed-yet shows no banner — the
            // doc-chase sequence handles that.
            const isAppGroup = /application/i.test(g.latest.name);
            return (
              <div key={g.key} className="space-y-1">
                <DocGroupRow group={g} />
                {isAppGroup && g.latest.signed && appAttached !== null && (
                  <SignedAppActionBanner customerId={customerId} attached={appAttached} onUploaded={checkAttached} />
                )}
              </div>
            );
          })}
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

// ───────────────────────── Additional-emails editor ─────────────────────────
// Extra addresses that ride along as CC on every merchant email + the application
// cover note (the primary stays customers.email, always the To:). Inline chip UI —
// the closer never leaves the playbook to add the owner's bookkeeper or a partner.

const emailShape = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

function AdditionalEmailsEditor({
  customerId,
  primaryEmail,
  emails,
  onRefresh,
}: {
  customerId: string;
  primaryEmail: string | null;
  emails: string[];
  onRefresh: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const persist = async (next: string[]) => {
    setBusy(true);
    setError(null);
    try {
      await updateCustomerAdditionalEmails(customerId, next);
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const e = value.trim().toLowerCase();
    if (!emailShape(e)) { setError("Enter a valid email."); return; }
    if (e === (primaryEmail ?? "").trim().toLowerCase()) { setError("That's already the primary email."); return; }
    if (emails.some((x) => x.toLowerCase() === e)) { setError("Already added."); return; }
    setValue("");
    setAdding(false);
    await persist([...emails, e]);
  };

  const remove = (e: string) => persist(emails.filter((x) => x !== e));

  return (
    <>
      {emails.map((e) => (
        <span
          key={e}
          className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-ocean-blue/10 text-ocean-blue dark:text-blue-300 border border-ocean-blue/30"
          title={`Also CC'd on merchant email: ${e}`}
        >
          <EnvelopeIcon className="w-3 h-3" />
          {e}
          <button
            type="button"
            onClick={() => remove(e)}
            disabled={busy}
            title="Remove this address"
            className="ml-0.5 hover:text-red-600 disabled:opacity-50"
          >
            <XMarkIcon className="w-3 h-3" />
          </button>
        </span>
      ))}

      {adding ? (
        <span className="inline-flex items-center gap-1">
          <input
            autoFocus
            type="email"
            value={value}
            onChange={(e) => { setValue(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void add(); } if (e.key === "Escape") { setAdding(false); setValue(""); setError(null); } }}
            placeholder="bookkeeper@acme.com"
            className="text-[11px] rounded-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 px-2 py-0.5 w-44"
          />
          <button
            type="button"
            onClick={() => void add()}
            disabled={busy}
            className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-ocean-blue text-white hover:bg-deep-sea disabled:opacity-50"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => { setAdding(false); setValue(""); setError(null); }}
            className="text-[11px] text-gray-400 hover:text-gray-600"
          >
            cancel
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          title="Add another address that gets CC'd on merchant email"
          className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border border-dashed border-ocean-blue/50 text-ocean-blue dark:text-blue-300 hover:bg-ocean-blue/10"
        >
          <PlusIcon className="w-3 h-3" /> email
        </button>
      )}

      {error && <span className="text-[11px] text-red-600 dark:text-red-400">{error}</span>}
    </>
  );
}

// ───────────────────────── Deal context bar ─────────────────────────

function DealContextBar({ deal, pipeline, campaign, onClear, onAdvance, onRefresh, openCloseDeal, openEditLead, splits, hasCloser, canReassign, closerOptions, canClaim, onAssignCloser, myProfileId }: { deal: DealWithCustomer; pipeline: "mca" | "vcf"; campaign: Campaign | null; onClear: () => void; onAdvance: (stageKey: string) => void; onRefresh: () => void; openCloseDeal: () => void; openEditLead: () => void; splits: CloserSplits; hasCloser: boolean; canReassign: boolean; closerOptions: CloserOption[]; canClaim: boolean; onAssignCloser: (profileId: string | null) => void; myProfileId: string | null }) {
  const { stages, stageCount, idx, cfg, inPlay, myCut } = dealMoneyStats(deal, pipeline, splits);
  const terminal = TERMINAL.includes(deal.status);
  const closerName = deal.closer
    ? `${deal.closer.first_name || ""} ${deal.closer.last_name || ""}`.trim()
    : null;
  const isMine = !!myProfileId && deal.assigned_closer_id === myProfileId;
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

            {/* Who gets paid for this deal. Unassigned = nobody, so it's a red
                chip with the fix RIGHT HERE — a closer never leaves this screen. */}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {deal.assigned_closer_id ? (
                <span
                  className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                  title="The closer this deal is attributed to — drives commission and analytics"
                >
                  {isMine ? "Yours" : `Closer: ${closerName || "Assigned"}`}
                </span>
              ) : (
                <span
                  className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                  title="No closer owns this deal — it can't pay a commission and won't show in closer analytics"
                >
                  ⚠ Unassigned
                </span>
              )}

              {/* A closer may CLAIM an unassigned deal — never take someone else's. */}
              {!deal.assigned_closer_id && canClaim && (
                <button
                  onClick={() => onAssignCloser(myProfileId)}
                  title="Attribute this deal to you — your commission and your numbers"
                  className="text-[11px] font-medium px-2 py-0.5 rounded-full border border-emerald-400 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 hover:bg-white dark:hover:bg-gray-700"
                >
                  This is mine
                </button>
              )}

              {/* Admin/super: hand the deal to any active closer. */}
              {canReassign && (
                <select
                  value={deal.assigned_closer_id ?? ""}
                  onChange={(e) => onAssignCloser(e.target.value || null)}
                  title="Assign or reassign the owning closer"
                  className="text-[11px] rounded-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 px-2 py-0.5"
                >
                  <option value="">Unassigned</option>
                  {closerOptions.map((c) => (
                    <option key={c.closerId} value={c.profileId}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}

              {/* Portal access — a merchant with no portal account can't sign in,
                  can't upload, can't e-sign. The state AND the one-click fix live
                  here so the closer never leaves the playbook to grant access. */}
              {deal.customer?.id && <PortalAccessChip customerId={deal.customer.id} />}
              {/* Send portal invite as a FIRST-CLASS button (not just buried in the
                  chip popover) — the one press that grants portal access, right on
                  the bar. The chip above still shows/repairs the access STATE. */}
              {deal.customer?.id && <PortalInviteButton customerId={deal.customer.id} compact />}
              {/* Every document on the deal — view, upload, and "what is this?" per
                  file — without leaving the playbook. */}
              {deal.customer?.id && (
                <DealDocumentsButton customerId={deal.customer.id} merchantName={dealName(deal)} />
              )}
              {/* Send any document RIGHT NOW, at any stage — the application paths
                  plus the registered agreements (broker/TCPA consent). */}
              <AdHocSendMenu dealId={deal.id} merchantEmail={deal.customer?.email} ghlContactId={deal.ghl_contact_id} />
              {/* Signature status at a glance — did they sign the disclosure + the
                  application? No scrolling to the Docs-back panel to find out. */}
              {deal.ghl_contact_id && <DocsBackChips ghlContactId={deal.ghl_contact_id} />}

              {/* The shared company Google Voice line — call/text on the company
                  number, with the staff-only login one reveal away. */}
              <CompanyVoiceChip />
              <LeadGradeChip grade={deal.lead_grade} expectedValue={deal.expected_value} reasons={deal.score_reasons} />
              {/* A DEAD merchant email is worth more than a warning — it's the whole
                  deal. A vendor-supplied mailbox that never existed (or that already
                  hard-bounced) will reject the application, the docs and every e-sign.
                  Verified at intake; silent unless the address is actually a problem;
                  and the fix — a new address — is one input box away, right here. */}
              {deal.customer?.id && <EmailHealthChip customerId={deal.customer.id} />}
              {/* Email the merchant WITHOUT leaving the playbook. This is the 5-minute
                  speed-to-lead touch on a real-time lead — if it lives three screens
                  away in Comms, it doesn't get sent inside the window. */}
              <EmailMerchantPanel
                dealId={deal.id}
                merchantEmail={deal.customer?.email}
                additionalEmails={deal.customer?.additional_emails ?? []}
                merchantFirstName={deal.customer?.first_name}
                businessName={deal.customer?.business_name}
                leadSource={deal.lead_source}
                bestTime={
                  (deal as unknown as { lead_qual?: Record<string, unknown> | null }).lead_qual?.[
                    "best_time"
                  ] as string | undefined
                }
              />

              {/* Add/remove extra addresses that ride along as CC on every
                  merchant email + the application cover note — the owner's
                  bookkeeper, a second partner. Primary stays deal.customer.email. */}
              {deal.customer?.id && (
                <AdditionalEmailsEditor
                  customerId={deal.customer.id}
                  primaryEmail={deal.customer.email}
                  emails={deal.customer.additional_emails ?? []}
                  onRefresh={onRefresh}
                />
              )}

              {/* Campaign attribution — a subtle chip with the code when it's
                  attached, a loud amber prompt (opens Edit lead → campaign picker)
                  when it isn't, so no deal quietly goes untracked. */}
              {campaign ? (
                <span
                  className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"
                  title={`Attributed to ${campaign.name}`}
                >
                  <MegaphoneIcon className="w-3 h-3" /> {campaignLabel(campaign)}
                </span>
              ) : (
                <button
                  onClick={openEditLead}
                  title="This deal isn't attributed to any campaign — attach one so it's tracked"
                  className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/60"
                >
                  <ExclamationTriangleIcon className="w-3 h-3" /> No campaign — attach one
                </button>
              )}
            </div>
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
            {idx >= 0 ? `Stage ${idx + 1} of ${stageCount} — ` : ""}
            {cfg?.label ?? deal.status}
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

      {/* Animated pipeline — shows where the lead is; click any stage to move it there.
          Forward fires that stage's automation; backward (admins) rewinds silently. */}
      <div className="mt-4 rounded-lg bg-white/70 dark:bg-gray-800/60 border border-emerald-200 dark:border-emerald-800 px-3 py-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Where this lead is in the pipeline</span>
          <span className="text-[11px] text-gray-400">Click any stage — forward fires its automation; an earlier stage moves the lead back (admins, sends nothing)</span>
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

      {/* Business research (Firecrawl) — read-only surface here: findings + verdict,
          no "Use" buttons. Applying values to the record happens inside the
          application form, where the closer can see the side-by-side. */}
      <div className="mt-3">
        <EnrichmentCard dealId={deal.id} customerId={deal.customer_id} />
      </div>
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
  // Advanced (deal) fields — these live on the DEAL, not the customer.
  const [market, setMarket] = useState<Market | "">((deal.market as Market | null) ?? "");
  const [leadSource, setLeadSource] = useState(deal.lead_source ?? "");
  const [campaignId, setCampaignId] = useState(deal.campaign_id ?? "");
  const [closerId, setCloserId] = useState(deal.assigned_closer_id ?? "");
  const [moreOpen, setMoreOpen] = useState(false);
  // Option sources for the advanced selects (loaded on open, mirroring the intake).
  const [closers, setClosers] = useState<{ id: string; user_id: string | null; first_name: string | null; last_name: string | null }[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load closers + campaigns the same way PlaybookCapture does.
  useEffect(() => {
    listCampaigns().then(setCampaigns).catch(() => setCampaigns([]));
    supabase
      .from("closers")
      .select("id, user_id, first_name, last_name")
      .eq("status", "active")
      .order("first_name", { ascending: true })
      .then(({ data }) => setClosers(data || []));
  }, []);

  // Attachable campaigns are the active ones. Editing keeps whatever campaign is
  // already on the deal (no smart re-derive here — we don't want to silently swap
  // an intentional attribution), but a deal with none must get one when active
  // campaigns exist — same required-with-sanity rule as the intake.
  const activeCampaigns = useMemo(() => campaigns.filter((cp) => cp.status === "active"), [campaigns]);
  const campaignRequired = activeCampaigns.length > 0;

  // Same required set as the intake — plus last name (confirmed required to save)
  // and the campaign when there's an active one to attach.
  const canSave =
    firstName.trim() !== "" && lastName.trim() !== "" && email.trim() !== "" && phone.trim() !== "" &&
    (!campaignRequired || campaignId !== "");

  async function save() {
    if (!canSave) {
      setError(
        campaignRequired && campaignId === ""
          ? "Attach a campaign — every lead must be tracked. Pick one below, or create it under Campaigns."
          : "First name, last name, business email, and cell phone are all required.",
      );
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Customer identity → customers table.
      await mustWrite(
        "update lead",
        supabase
          .from("customers")
          .update({
            first_name: firstName.trim(),
            last_name: lastName.trim(),
            business_name: businessName.trim() || null,
            email: email.trim(),
            phone: normalizePhoneForStorage(phone.trim()),
          })
          .eq("id", deal.customer_id),
      );
      // Attribution / routing → the DEAL (market, lead_source, campaign, closer).
      await mustWrite(
        "update deal routing",
        supabase
          .from("deals")
          .update({
            market: market || null,
            lead_source: leadSource || null,
            campaign_id: campaignId || null,
            assigned_closer_id: closerId || null,
          })
          .eq("id", deal.id),
      );

      // Push the edited identity to the deal's EXISTING GHL contact so delivery
      // (the MCA 04 e-sign automation, cover notes) follows the fix — GHL is the
      // delivery system. This UPDATES the linked contact by id (never upsert-by-
      // email, which forks a second contact). If GHL rejects the email because
      // another contact already holds it, we surface that clearly WITHOUT rolling
      // back the DB save (the local record is correct; only GHL couldn't follow).
      try {
        const { data: sync, error: syncErr } = await supabase.functions.invoke("sync-lead-to-ghl", {
          body: { customerId: deal.customer_id, dealId: deal.id },
        });
        if (syncErr) await invokeThrow(syncErr);
        const sres = sync as { error?: string; warning?: string } | null;
        if (sres?.error) throw new Error(sres.error);
        if (sres?.warning) {
          // Saved, but GHL couldn't take one field (e.g. a phone another contact
          // squats on). Keep the modal open so the closer sees it.
          setError(`Saved. Heads up: ${sres.warning}`);
          setSaving(false);
          return;
        }
      } catch (ge) {
        // DB save already landed — do NOT roll back. Tell the closer GHL didn't
        // follow so they know delivery may still go to the old contact/email.
        setError(
          `Saved locally, but the change didn't sync to GoHighLevel: ${ge instanceof Error ? ge.message : String(ge)} — GHL delivery (e-sign docs, emails) may still use the old info until this is resolved.`,
        );
        setSaving(false);
        return;
      }

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

          {/* Campaign — promoted OUT of "More details" so a deal that arrived
              untracked is fixed right here. Required when an active campaign
              exists; we keep whatever's already attached (no smart re-derive). */}
          <div className="rounded-lg border-2 border-ocean-blue/40 dark:border-ocean-blue/50 bg-ocean-blue/5 dark:bg-ocean-blue/10 p-3">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-white">
                <MegaphoneIcon className="w-4 h-4 text-ocean-blue" /> Campaign {campaignRequired && <Req />}
              </span>
              <Link to="/admin/campaigns" className="text-[11px] font-medium text-ocean-blue hover:underline">
                Manage campaigns ↗
              </Link>
            </div>
            {activeCampaigns.length > 0 ? (
              <select className="input-field w-full" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
                <option value="">Select a campaign…</option>
                {activeCampaigns.map((cp) => (
                  <option key={cp.id} value={cp.id}>{cp.code ? `${cp.code} — ${cp.name}` : cp.name}</option>
                ))}
              </select>
            ) : (
              <div className="flex items-start gap-1.5 rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-2.5 py-2 text-[11px] text-amber-800 dark:text-amber-300">
                <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  No active campaigns — this lead won't be tracked.{" "}
                  <Link to="/admin/campaigns" className="underline font-medium">Create one in Campaigns</Link>.
                </span>
              </div>
            )}
          </div>

          {/* Advanced routing/attribution — these save to the DEAL, not the
              customer. Collapsed by default so identity stays the fast path. */}
          <button
            type="button"
            onClick={() => setMoreOpen((o) => !o)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
          >
            {moreOpen ? <ChevronUpIcon className="w-4 h-4" /> : <ChevronDownIcon className="w-4 h-4" />}
            More details (closer, market, source) — optional
          </button>

          {moreOpen && (
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Assigned closer</span>
                <select className="input-field w-full mt-1" value={closerId} onChange={(e) => setCloserId(e.target.value)}>
                  <option value="">Unassigned</option>
                  {closers.filter((cl) => cl.user_id).map((cl) => (
                    // value MUST be the profile id (deals.assigned_closer_id → profiles.id).
                    <option key={cl.id} value={cl.user_id!}>{cl.first_name} {cl.last_name}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Market</span>
                <select className="input-field w-full mt-1" value={market} onChange={(e) => setMarket(e.target.value as Market | "")}>
                  <option value="">Select market</option>
                  {Object.entries(MARKET_CONFIG).map(([v, cfg]) => (
                    <option key={v} value={v}>{cfg.label}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Lead source</span>
                <select className="input-field w-full mt-1" value={leadSource} onChange={(e) => setLeadSource(e.target.value)}>
                  <option value="">Select source</option>
                  <option value="live_transfer">Live Transfer</option>
                  <option value="google_ads">Google Ads</option>
                  <option value="website">Website</option>
                  <option value="aged_lead">Aged Lead</option>
                  <option value="ucc_lead">UCC Filing</option>
                  <option value="referral">Referral</option>
                  <option value="cold_call">Cold Call</option>
                  <option value="repeat_customer">Repeat Customer</option>
                  <option value="other">Other</option>
                </select>
              </label>
            </div>
          )}
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
  // Vendor-junk signal: the merchant denies ever asking for funding info. Counted
  // per campaign in the Campaign Audit to prove a lead source is selling garbage.
  { value: "bogus_never_requested", label: "Bogus — says they never requested info" },
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
  focus,
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
  onSendDocs,
  onSendPartial,
}: {
  step: PlaybookStep;
  last: boolean;
  stageLabel?: string;
  stageNum?: number;
  interactive: boolean;
  focus: boolean;
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
  onSendDocs: (resend: boolean) => void;
  onSendPartial: (resend: boolean) => void;
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

  // The step-level `note` (onboarding prose) hides behind a per-step toggle so it
  // doesn't wall off the happy path. Closed by default; open state is local only.
  const [showNote, setShowNote] = useState(false);

  // Accordion. FOCUS MODE (working a deal, focus on): only the ACTIVE step is
  // expanded — completed steps collapse to a receipt, future steps to a teaser.
  // Expand-all (interactive, focus off): completed fold, everything else open —
  // the previous working view. Browsing: ORIGINAL flows stay fully expanded; the
  // NEW lead paths fold the SHARED close (4–9) and keep the unique intake (1–3).
  const [openCard, setOpenCard] = useState(true);
  useEffect(() => {
    setOpenCard(
      focus
        ? current
        : interactive
          ? !done || current
          : foldCloseOnBrowse
            ? step.n <= 3
            : true,
    );
  }, [interactive, focus, done, current, deal?.id, step.n, foldCloseOnBrowse]); // eslint-disable-line react-hooks/exhaustive-deps

  // When a step becomes the active one (auto-advance), scroll it into view. Skips
  // the initial mount so loading a deal doesn't yank the page around.
  const liRef = useRef<HTMLLIElement>(null);
  const wasCurrent = useRef(current);
  useEffect(() => {
    if (focus && current && !wasCurrent.current) {
      liRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    wasCurrent.current = current;
  }, [current, focus]);

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

  // In focus mode a collapsed, not-yet-reached step is a muted teaser; a collapsed
  // completed step stays full-strength (it's a green-check receipt).
  const teaser = focus && !openCard && !done && !current;

  return (
    <li ref={liRef} className={`relative pl-12 ${teaser ? "opacity-60 hover:opacity-100 transition-opacity" : ""}`}>
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

        {step.note && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setShowNote((v) => !v)}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              ⓘ why this matters {showNote ? "▲" : "▼"}
            </button>
            {showNote && <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{step.note}</p>}
          </div>
        )}

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
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {/* Path 3 — 04C PARTIAL, the DEFAULT: we prefill the lead's info, the
                  merchant completes EIN/SSN/banking on the doc. Closer types nothing. */}
              <button
                type="button"
                onClick={() => onSendPartial(false)}
                title="Prefills everything the lead told us; the merchant completes EIN, SSN, address and banking on the document, then signs. You type nothing."
                className="inline-flex items-center gap-1.5 rounded-lg bg-mint-green px-3 py-1.5 text-white font-semibold hover:opacity-90"
              >
                ⚡ Send partial <span className="font-normal opacity-90">(they finish the rest)</span>
              </button>
              {/* Path 1 — send the ORIGINAL docs, no prefill (the merchant fills it all). */}
              <button
                type="button"
                onClick={() => onSendDocs(false)}
                title="Send the application + disclosure + upload link as-is — the merchant fills out everything and e-signs. No prefilling."
                className="inline-flex items-center gap-1.5 rounded-lg bg-ocean-blue px-3 py-1.5 text-white font-semibold hover:opacity-90"
              >
                📨 Send blank <span className="font-normal opacity-90">(they fill everything)</span>
              </button>
              {/* Path 2 — white-glove: closer fills it all, merchant just signs. */}
              <button
                type="button"
                onClick={onFillApplication}
                title="Fill the application for the merchant (pre-filled from what we know), then send — all they do is tap to sign."
                className="inline-flex items-center gap-1.5 rounded-lg border border-ocean-blue/50 text-ocean-blue px-3 py-1.5 font-semibold hover:bg-ocean-blue/5"
              >
                <DocumentTextIcon className="w-4 h-4" /> Fill it in for them first
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-gray-500 dark:text-gray-400">
              Three ways to send: <b>Send partial</b> prefills what the lead told us and the merchant completes the
              rest — the fastest path, use it by default. <b>Send blank</b> emails the empty application for them to
              fill entirely. <b>Fill it in for them first</b> is white-glove — you type everything, they just sign.
            </p>
          </div>
        )}

        {/* Live doc status — what's signed + what they uploaded, straight from GHL */}
        {(step.stageKey === "application_sent" || step.stageKey === "bank_statements") && interactive && deal?.ghl_contact_id && (
          <DocsBackPanel ghlContactId={deal.ghl_contact_id} customerId={deal.customer_id} />
        )}

        {/* Real dials through GHL/VibeReach — audited call history. Shown on the
            contact step (where the board asks "did anyone call?") and alongside
            the docs panel. Loading it also SYNCS: outbound calls the system
            hasn't seen stamp the deal's timeline + call telemetry, record-once. */}
        {/* Every FIRST-TOUCH and chase stage — a call can happen at any of them, and
            "logged only where we happened to mount the panel" is how the owner's PRB
            dial went invisible. (The 5-min cron sweep is the real net; this poll is
            just the instant path while someone is looking.) */}
        {["new", "contacted", "qualifying", "application_sent", "bank_statements", "docs_collected"].includes(step.stageKey ?? "") &&
          interactive && deal?.ghl_contact_id && (
          <CallHistoryPanel ghlContactId={deal.ghl_contact_id} dealId={deal.id} />
        )}

        {/* Docs receipt — when the send-docs step fired. "Sent" only means it LEFT
            our system; the DocsBackPanel above is the source of truth for whether
            the merchant actually got it. Always offer a Resend (first send skipped,
            merchant lost the email, wrong contact fixed, etc.). */}
        {step.stageKey === "application_sent" && done && (
          <div className="mt-3 rounded-md bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-3 py-2 text-xs space-y-1.5">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-medium text-emerald-700 dark:text-emerald-300">
                📨 Application sent to e-sign{doneAt ? ` ${fmtWhen(doneAt)}` : ""} — app + disclosure + upload link
              </span>
              <button
                type="button"
                onClick={() => onSendDocs(true)}
                title="Re-send the ORIGINAL application + disclosure + upload link, no prefill (e.g. it never arrived, or you fixed their email)"
                className="inline-flex items-center gap-1 rounded-lg border border-ocean-blue/50 text-ocean-blue px-2.5 py-1 font-semibold hover:bg-ocean-blue/5"
              >
                ↻ Resend original docs
              </button>
              <button
                type="button"
                onClick={onFillApplication}
                title="Edit / pre-fill the application, then re-send it to sign"
                className="inline-flex items-center gap-1 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 px-2.5 py-1 font-semibold hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                ✍️ Fill &amp; resend
              </button>
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
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              “Sent” means it left our system — <b>confirm the merchant actually received it</b> in the live status above. If nothing shows there or they never got it, hit <b>Resend</b>.
            </p>
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

        {/* Internal AI underwriter — right where it matters: statements are in,
            and the NEXT step is submitting to funders. Run it here to get the
            affordability verdict + red flags + funder fit BEFORE burning
            submissions. Collapsible so the step stays scannable. */}
        {step.stageKey === "bank_statements" && interactive && deal && deal.deal_type === "mca" && (
          <details className="mt-4 rounded-lg border border-ocean-blue/40 bg-white dark:bg-gray-800">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              🧠 Internal AI underwriter — run BEFORE you submit
              <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
                reads the statements → affordability, padding, red flags, funder fit
              </span>
            </summary>
            <div className="px-4 pb-4">
              <AIUnderwritingPanel dealId={deal.id} />
            </div>
          </details>
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
                      type={f.kind === "number" || f.kind === "money" ? "number" : f.kind === "date" ? "date" : "text"}
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
        <>
        {/* Bars never reflow — the clicked stage's deals render in a single fixed
            area BELOW the chart (see below), not inserted between the bars. */}
        <div className="space-y-1.5">
          {coreStages.map((s) => {
            const c = counts[s.key] ?? 0;
            const pct = Math.round((c / max) * 100);
            const open = openStage === s.key;
            return (
              <button
                key={s.key}
                onClick={() => openStageDeals(s.key)}
                className={`w-full group flex items-center gap-3 text-left rounded ${open ? "ring-1 ring-ocean-blue/40 bg-ocean-blue/5" : ""}`}
              >
                <span className={`w-36 shrink-0 text-sm truncate ${open ? "font-semibold text-ocean-blue" : "text-gray-700 dark:text-gray-200"}`}>{s.label}</span>
                <span className="flex-1 h-7 rounded bg-gray-100 dark:bg-gray-900 overflow-hidden relative">
                  <span
                    className={`absolute inset-y-0 left-0 rounded ${open ? "bg-ocean-blue" : "bg-ocean-blue/70 group-hover:bg-ocean-blue"}`}
                    style={{ width: `${Math.max(pct, c > 0 ? 8 : 0)}%` }}
                  />
                </span>
                <span className="w-10 shrink-0 text-right text-sm font-semibold text-gray-900 dark:text-white">{c}</span>
              </button>
            );
          })}
        </div>

        {/* Single expansion area below the whole chart — appears/disappears here so
            the bars above stay put. Empty stages get a subtle note, not a panel. */}
        {openStage && (() => {
          const label = coreStages.find((s) => s.key === openStage)?.label ?? openStage;
          return (
            <div className="mt-3 rounded-lg border border-ocean-blue/30 bg-gray-50 dark:bg-gray-900 p-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                  Leads in <span className="text-ocean-blue">{label}</span>
                </span>
                <button
                  onClick={() => setOpenStage(null)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                  title="Close"
                >
                  <XMarkIcon className="w-4 h-4" />
                </button>
              </div>
              {dealsLoading ? (
                <p className="text-xs text-gray-400 px-1 py-1">Loading…</p>
              ) : stageDeals.length === 0 ? (
                <p className="text-xs text-gray-400 italic px-1 py-1">No leads in this stage right now.</p>
              ) : (
                <ul className="max-h-64 overflow-y-auto divide-y divide-gray-200 dark:divide-gray-700">
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
          );
        })()}
        </>
      )}
      <p className="mt-4 text-xs text-gray-400">
        Stages shown exclude Nurture / Declined / Dead. Open a deal to see its full pipeline and next action.
      </p>
    </div>
  );
}
