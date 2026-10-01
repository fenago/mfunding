// FunderPicker — the one-click "submit to funders" box that lives on Revenue
// Playbook Step 6 (Submitted to Funder). The closer sees the funders scored
// against THIS deal, checks the ones to send to, and hits Submit — the
// submit-to-funders engine then emails each funder in its own recipe format
// (or returns a guided portal flow for portal-only funders). Results render
// live per funder. Stage advancement stays on the step's own button so a
// partial fan-out never strands the deal.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  PaperAirplaneIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ArrowTopRightOnSquareIcon,
  ArrowPathIcon,
  EnvelopeIcon,
  GlobeAltIcon,
  SparklesIcon,
  DocumentArrowUpIcon,
  CurrencyDollarIcon,
  XMarkIcon,
  HandThumbDownIcon,
  EyeIcon,
  PaperClipIcon,
  LinkIcon,
  ArrowUturnLeftIcon,
} from "@heroicons/react/24/outline";
import { TrophyIcon } from "@heroicons/react/24/solid";
import supabase from "../../supabase";
import { mustWrite, tryWrite } from "@/supabase/writes";
import { useSession } from "../../context/SessionContext";
import { getMatchingLendersRead } from "../../services/lenderMatchingService";
import { getFunderAvailability } from "../../services/funderAvailability";
import { updateSubmission } from "../../services/dealService";
import { uploadSignedApplication } from "../../services/signedApplication";
import { readDocsStatus, type GhlDocsStatus } from "@/lib/ghlDocs";
import { dealFieldOf } from "@/lib/maskedDeal";
import { invokeThrow } from "@/utils/invokeError";
import type { DealWithCustomer } from "../../types/deals";

// GHL Documents & Contracts (Completed e-sign) for the MFunding sub-account —
// where the closer downloads the signed application PDF once to re-upload here.
const GHL_COMPLETED_DOCS_URL =
  "https://app.vibereach.io/v2/location/t7NmVR4WCy927j4Zon4b/payments/proposals-estimates";

type Method = "email" | "portal" | "email_and_portal" | "none";

interface Match {
  id: string;
  company_name: string;
  score: number;
  reasons: string[];
  /** True when the scorer matched nothing and this row came from the funder
   *  AVAILABILITY list instead. Carried so the row can say where it came from
   *  and so the score partition below doesn't bury it — never faked into a
   *  score, because a number nobody computed is the thing this file keeps
   *  getting burned by. */
  fromAvailability?: boolean;
}

interface ProfileMeta {
  method: Exclude<Method, "none">;
  required_stips: string[];
  to_email: string | null;
  portal_url: string | null;
}

type Fit = "strong" | "possible" | "poor";
interface AiRec {
  lender_id: string;
  lender_name: string;
  fit: Fit;
  reasons: string[];
  watch_outs: string[];
  // Ground-truth doc readiness attached server-side by recommend-lenders
  // (additive — older persisted recs may not carry these).
  docsReady?: boolean;
  docsMissing?: string[];
  // Ground-truth qualification (hard criteria: revenue/TIB/amount). A false here
  // means the merchant fails the funder's minimums — a hard disqualifier, unlike
  // a missing doc (which is just a stipulation to collect).
  qualifies?: boolean;
  disqualifiers?: string[];
  // Parallel verdict on bank-statement-VERIFIED revenue (null / absent when no
  // underwriting run exists). flip = stated and verified verdicts disagree.
  qualifiesVerified?: boolean | null;
  disqualifiersVerified?: string[];
  flip?: boolean;
  docsAdvisory?: string[];
}

// Snapshot of the latest AI-underwriting run, attached by recommend-lenders so
// the closer sees stated vs verified side by side.
interface UwSnapshot {
  version: number;
  months_covered: number | null;
  stated_monthly_revenue: number | null;
  verified_monthly_revenue: number | null;
  revenue_delta_pct: number | null;
  nsf_total: number | null;
  negative_days: number | null;
  est_open_positions: number | null;
  max_affordable_advance: number | null;
  risk_rating: string | null;
}

interface FunderResult {
  lenderId: string;
  name?: string;
  method?: Method;
  status: "sent" | "send_failed" | "portal_pending" | "portal_confirmed" | "blocked" | "already_submitted";
  to?: string;
  error?: string;
  warning?: string;
  blocked?: string[];
  blockedLabels?: string[];
  portal?: { url: string | null; steps: string[]; hint: string | null };
  submissionId?: string;
}

// One selected funder's rendered email, returned by action:"preview" — exactly
// what the real send would produce (the server ran the same render/gather path).
interface PreviewDoc { label: string; filename: string; delivery: "attached" | "link" }
interface PreviewFunder {
  lenderId: string;
  name: string;
  method: Method;
  isPortalOnly?: boolean;
  to?: string;
  cc?: string[];
  subject?: string;
  body?: string;
  docs?: PreviewDoc[];
  docsWarning?: string;
  portal?: { url: string | null; steps: string[]; hint: string | null };
  blocked?: string[];
  blockedLabels?: string[];
  /** Open standing instructions this funder has sent us (see FunderDirective). */
  directives?: FunderDirective[];
  /** Set when `to` is an address the funder told us to stop using — HARD BLOCK. */
  directiveBlock?: FunderDirective | null;
  /** Non-null when the instruction check could not RUN. Never an all-clear. */
  directivesUnreadable?: string | null;
}

/**
 * A standing instruction a funder emailed us — "send submissions to X", "stop
 * using Y", "use the portal", "we now require Z", "your rep has changed".
 *
 * Shown here, at the To line of the preview, because this is the last moment
 * before the package leaves. Uplyft told us on 2026-09-17 to stop using
 * underwriting@uplyftcapital.com; on 2026-09-29 two real deals went there
 * anyway and got silence. The instruction was in the database the whole time
 * and no surface between it and the Send button ever read it.
 *
 * NOTHING HERE OFFERS TO APPLY THE CHANGE. An inbound email asking us to
 * redirect submissions is untrusted input — a reply inside a known thread from
 * a known domain is exactly what a spoof looks like, and the package being
 * redirected contains the merchant's signed application and bank statements. So
 * this panel reports the funder's own words and sends the reader to
 * /admin/funder-instructions to decide. Resolving is deliberately NOT one click
 * from here: a dismiss button next to a Send button is a rubber stamp.
 */
export interface FunderDirective {
  id: string;
  kind: "submission_email_change" | "use_portal" | "new_required_docs" | "contact_change";
  summary: string;
  retired_email: string | null;
  new_email: string | null;
  evidence_quote: string;
  received_at: string | null;
  from_email: string | null;
}

const DIRECTIVE_LABELS: Record<FunderDirective["kind"], string> = {
  submission_email_change: "Submission address changed",
  use_portal: "Portal submission requested",
  new_required_docs: "New required documents",
  contact_change: "Contact changed",
};

/**
 * The funder-instruction panel for one previewed funder.
 *
 * Three states, kept distinct on purpose:
 *   • blocked    — the recipe still points at an inbox the funder retired. Red,
 *                  and the server refuses the send too.
 *   • warning    — open instructions that need a human to interpret. Amber, and
 *                  the send is NOT blocked: stopping a real deal on a detection
 *                  we cannot verify is the worse failure.
 *   • unreadable — the check could not RUN. Also red, and worded so it can never
 *                  be mistaken for "nothing on file". A guard that did not run
 *                  is not a guard that passed.
 */
function DirectiveNotice({ p }: { p: PreviewFunder }) {
  const blocked = p.directiveBlock ?? null;
  const unreadable = p.directivesUnreadable ?? null;
  // The blocking row is rendered in its own box, so drop it from the warn list.
  const warns = (p.directives ?? []).filter((d) => d.id !== blocked?.id);
  if (!blocked && !unreadable && warns.length === 0) return null;

  return (
    <div className="space-y-1.5">
      {unreadable && (
        <div className="rounded-md border-2 border-rose-500 bg-rose-50 dark:bg-rose-900/30 px-2.5 py-2">
          <p className="text-[12px] font-bold text-rose-800 dark:text-rose-200">
            ⚠ The funder-instruction check could not run — this is NOT an all-clear
          </p>
          <p className="mt-0.5 text-[11px] text-rose-700 dark:text-rose-300">
            {unreadable}. {p.name} may have asked us to change where submissions go and
            nothing has verified it. Check /admin/funder-instructions before sending.
          </p>
        </div>
      )}

      {blocked && (
        <div className="rounded-md border-2 border-rose-500 bg-rose-50 dark:bg-rose-900/30 px-2.5 py-2">
          <p className="text-[12px] font-bold text-rose-800 dark:text-rose-200">
            ⛔ This will not send — {p.name} retired this inbox
          </p>
          <p className="mt-1 text-[11px] text-rose-700 dark:text-rose-300">
            The recipe still points at <span className="font-mono font-semibold">{blocked.retired_email}</span>, which they
            told us to stop using{blocked.received_at ? ` on ${blocked.received_at.slice(0, 10)}` : ""}.
            {blocked.new_email && (
              <> They said to use <span className="font-mono font-semibold">{blocked.new_email}</span> instead.</>
            )}
          </p>
          {/* The funder's OWN WORDS. A human changes a submission destination on
              the strength of this quote, never on the strength of our summary. */}
          <blockquote className="mt-1.5 border-l-2 border-rose-400 pl-2 text-[11px] italic text-rose-800 dark:text-rose-200">
            “{blocked.evidence_quote}”
            {blocked.from_email && <span className="not-italic"> — {blocked.from_email}</span>}
          </blockquote>
          <p className="mt-1.5 text-[11px] font-semibold text-rose-800 dark:text-rose-200">
            Fix the funder's recipe first, then mark it applied on{" "}
            <Link to="/admin/funder-instructions" className="underline">Funder instructions</Link>.
            Nothing changes a submission address automatically.
          </p>
        </div>
      )}

      {warns.map((d) => (
        <div key={d.id} className="rounded-md border border-amber-400 bg-amber-50 dark:bg-amber-900/25 px-2.5 py-2">
          <p className="text-[12px] font-semibold text-amber-800 dark:text-amber-200">
            ⚠ {DIRECTIVE_LABELS[d.kind] ?? "Standing instruction"} — not yet applied
          </p>
          <p className="mt-0.5 text-[11px] text-amber-800 dark:text-amber-200">{d.summary}</p>
          <blockquote className="mt-1.5 border-l-2 border-amber-400 pl-2 text-[11px] italic text-amber-900 dark:text-amber-200">
            “{d.evidence_quote.slice(0, 300)}”
            {d.from_email && <span className="not-italic"> — {d.from_email}</span>}
          </blockquote>
          <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
            This does not block the send. Decide on{" "}
            <Link to="/admin/funder-instructions" className="underline">Funder instructions</Link>.
          </p>
        </div>
      ))}
    </div>
  );
}

const DOC_LABELS: Record<string, string> = {
  application: "Signed application",
  bank_statement: "Bank statements",
  id: "Photo ID",
  voided_check: "Voided check",
  credit_authorization: "Credit authorization",
  business_license: "Business license",
  personal_guarantee: "Personal guarantee",
  tax_return: "Tax return",
  other: "Other",
};
const docLabel = (s: string) => DOC_LABELS[s] ?? s.replace(/_/g, " ");

// Compact "3h ago" / "2d ago" for the funder-reply chip.
function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return "";
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}
// The core package the checklist surfaces (customer_document_type enum values).
const CORE_STIPS = ["application", "bank_statement", "id", "voided_check"];
// Doc types pre-checked in the "Package contents" picker — the standard funder
// package. Everything else on file starts unchecked (the closer opts it in).
const DEFAULT_PACKAGE_TYPES = new Set(["application", "bank_statement", "id", "voided_check"]);

interface InventoryDoc { id: string; document_type: string; filename: string | null }

// Everything the FunderPicker tracks per existing submission — includes the
// offer economics so a logged offer renders inline and in the compare strip
// without a page refetch.
interface ExistingSub {
  status: string;
  method: string | null;
  submissionId: string;
  hasError: boolean;
  portalConfirmed: boolean;
  responseAt: string | null;
  offerAmount: number | null;
  factorRate: number | null;
  termMonths: number | null;
  dailyPayment: number | null;
  weeklyPayment: number | null;
  totalPayback: number | null;
  declineReason: string | null;
}

type Frequency = "daily" | "weekly";
// Roughly how many payments hit per month on each retrieval cadence — used only
// for the "% of monthly revenue" burden hint, not for any stored math.
const PAYMENTS_PER_MONTH: Record<Frequency, number> = { daily: 21, weekly: 4.33 };

const money = (n: number | null | undefined) =>
  n == null ? "—" : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

// Merchant-side monthly burden of an offer + its share of monthly revenue.
// amber when the pull eats >15% of revenue (a common affordability red line).
function burden(payment: number | null, freq: Frequency, monthlyRevenue: number | null | undefined) {
  if (!payment) return null;
  const monthly = payment * PAYMENTS_PER_MONTH[freq];
  const pct = monthlyRevenue ? (monthly / monthlyRevenue) * 100 : null;
  return { monthly, pct, hot: pct != null && pct > 15 };
}

const FIT_STYLE: Record<Fit, { label: string; cls: string }> = {
  strong: { label: "STRONG FIT", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  possible: { label: "POSSIBLE", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  poor: { label: "POOR FIT", cls: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" },
};

function methodBadge(m: Method) {
  if (m === "portal") return { label: "PORTAL", icon: GlobeAltIcon, cls: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300" };
  if (m === "email_and_portal") return { label: "email + portal", icon: EnvelopeIcon, cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" };
  if (m === "email") return { label: "email", icon: EnvelopeIcon, cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" };
  return { label: "no destination", icon: ExclamationTriangleIcon, cls: "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400" };
}

export default function FunderPicker({ deal }: { deal: DealWithCustomer }) {
  const { session } = useSession();
  const [matches, setMatches] = useState<Match[]>([]);
  // "We couldn't read the funder network" and "the network has nothing for this
  // deal" are different sentences and must never share a rendering. The old code
  // printed "No matching funders. Add funders to your network (Admin → Lenders)
  // first." for BOTH — on a screen that, two inches higher, was listing 27
  // funders as ready. A processor read that as her network being empty.
  const [matchesErr, setMatchesErr] = useState<string | null>(null);
  // Set when the rows below came from the availability list rather than the
  // scorer, so the panel can say so instead of passing them off as matches.
  const [usedAvailability, setUsedAvailability] = useState(false);
  // Bumped by "Try again" on the unreadable banner. A read that failed once is
  // often just a read that failed once, and making her reload the whole playbook
  // to find out is how a transient turns into a day of not submitting.
  const [reloadKey, setReloadKey] = useState(0);
  // The availability fallback can fail on its own. Held separately so the empty
  // state can say "and we couldn't check the other list either" rather than
  // reporting a check that never completed as a check that found nothing.
  const [fallbackErr, setFallbackErr] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Record<string, ProfileMeta>>({});
  const [lenderDest, setLenderDest] = useState<Record<string, { email: string | null; portal: string | null }>>({});
  // App-side (Supabase customer_documents) and GHL-side doc types are tracked
  // SEPARATELY: the stips guard uses the union (docsPresent), but the signed-app
  // slot needs to know whether the signed application lives app-side (attaches
  // automatically) vs only in GHL (must be downloaded + re-uploaded here).
  const [appDocs, setAppDocs] = useState<Set<string>>(new Set());
  const [ghlDocs, setGhlDocs] = useState<Set<string>>(new Set());
  // ⚠ The GHL half of that union CAN FAIL, and its failure used to be swallowed
  // whole. That is not cosmetic here: `docsPresent` feeds the stips guard, so an
  // unread VibeReach turns into "Blocked — missing: bank statements" on a
  // merchant whose statements are sitting on his contact. The block stays (we
  // genuinely cannot see the file, so claiming it is present would be the same
  // lie in reverse) — but it must SAY that it was computed blind, or the closer
  // reads a read failure as the merchant's failure.
  const [ghlDocsError, setGhlDocsError] = useState<string | null>(null);
  // The deal's app-side document inventory + which of them ride with the next
  // submission (pick-and-choose). Passed to submit-to-funders as documentIds.
  const [inventory, setInventory] = useState<InventoryDoc[]>([]);
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());
  // Signed-application upload slot.
  const [signedAppFile, setSignedAppFile] = useState<File | null>(null);
  const [uploadingApp, setUploadingApp] = useState(false);
  const [uploadAppError, setUploadAppError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Record<string, FunderResult>>({});
  const [existing, setExisting] = useState<Record<string, ExistingSub>>({});
  // The deal_submissions read is the ONLY thing that knows what already went
  // out. When it fails, `existing` is empty — which renders identically to
  // "nothing has been submitted yet" and invites a duplicate submission to a
  // funder who already has the file. An unread answer is not a zero: hold the
  // error and block Submit until it reads.
  const [existingErr, setExistingErr] = useState<string | null>(null);
  // Inline offer capture: which submitted row's "Log offer" form is open, its
  // field values, and which row's "Funder declined" reason box is open.
  const [offerFormFor, setOfferFormFor] = useState<string | null>(null);
  const [offerForm, setOfferForm] = useState<{ amount: string; factor: string; term: string; payment: string; frequency: Frequency }>({ amount: "", factor: "", term: "", payment: "", frequency: "daily" });
  const [savingOffer, setSavingOffer] = useState(false);
  const [offerError, setOfferError] = useState<string | null>(null);
  const [declineFor, setDeclineFor] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [acceptedHint, setAcceptedHint] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showMisfits, setShowMisfits] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payloadOpen, setPayloadOpen] = useState<Record<string, unknown | null>>({});
  // AI funder recommendations (analyst short-list rendered above the checkboxes).
  const [aiRecs, setAiRecs] = useState<AiRec[]>([]);
  const [aiSummary, setAiSummary] = useState<string>("");
  const [aiUw, setAiUw] = useState<UwSnapshot | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiRan, setAiRan] = useState(false);
  // TRUE when the money wall withheld any saved AI analysis from THIS reader.
  // Distinct from "no analysis exists" — the bare null looked identical, and the
  // button then offered to spend a fresh paid LLM call on work already done.
  const [aiWithheld, setAiWithheld] = useState(false);
  // TRUE when the ask was withheld from this reader, which means the scorer
  // below ranked WITHOUT checking any funder's min/max funding box.
  const [askWithheld, setAskWithheld] = useState(false);
  // Box-fit reasons per lender (from funderAvailability) — surfaced as a
  // non-blocking 🟡 "out of box" tag so the owner can submit knowingly anyway.
  const [boxReasons, setBoxReasons] = useState<Record<string, string[]>>({});
  // Per-funder stip overrides — the owner knowingly submits a doc-blocked funder
  // with the missing stip "to follow". stipOverrides[lenderId] = the doc slugs
  // being waived for THIS funder only; armedOverride is the two-step arm (house
  // rule: no browser popups). The server skips the gate for exactly these slugs
  // and appends a "to follow" line to that funder's email.
  const [stipOverrides, setStipOverrides] = useState<Record<string, string[]>>({});
  const [armedOverride, setArmedOverride] = useState<string | null>(null);

  // Rehydrate persisted AI analysis (saved on the deal by recommend-lenders)
  // so a page reload never throws away paid tokens.
  //
  // ⚠ `ai_lender_recommendations` is one of the eighteen the money wall nulls
  // for a reader who isn't assigned the deal. Read bare, a withheld analysis is
  // indistinguishable from one that was never run — so the panel vanished and
  // the button read "AI: recommend lenders", inviting a closer to spend a fresh
  // paid LLM call reproducing a shortlist the deal already holds. Withheld is
  // its own state: don't rehydrate (we have nothing), don't claim it never ran.
  useEffect(() => {
    const rec = dealFieldOf<{ summary?: string; recommendations?: AiRec[]; underwriting?: UwSnapshot | null }>(
      deal, "ai_lender_recommendations",
    );
    if (rec.kind === "withheld") { setAiWithheld(true); return; }
    setAiWithheld(false);
    const saved = rec.value;
    if (saved && (saved.recommendations?.length || saved.summary)) {
      setAiRecs((saved.recommendations ?? []) as AiRec[]);
      setAiSummary(saved.summary ?? "");
      setAiUw(saved.underwriting ?? null);
      setAiRan(true);
    }
  }, [deal.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // ⚠ THE SCORER SILENTLY SKIPS THE AMOUNT-FIT CHECK ON A NULL ASK.
        // `if (dealProfile.amount_requested)` in lenderMatchingService guards the
        // whole min/max block, so a WITHHELD ask means no `-10` and no "Amount
        // outside typical range" chip — funders whose box the real ask would FAIL
        // come back looking clean, and a human submits from that list. The scorer
        // is right to skip a value it doesn't have; what was wrong was presenting
        // the result as a complete ranking. So we pass the same null and SAY SO.
        const askField = dealFieldOf<number>(deal, "amount_requested");
        const askHidden = askField.kind === "withheld";
        setAskWithheld(askHidden);
        const read = await getMatchingLendersRead({
          deal_type: deal.deal_type,
          amount_requested: askHidden ? null : askField.value,
          monthly_revenue: deal.customer?.monthly_revenue ?? null,
          time_in_business: deal.customer?.time_in_business ?? null,
          industry: deal.customer?.industry ?? null,
        });
        let m: Match[] = read.kind === "ok" ? read.value.map((x) => ({ id: x.id, company_name: x.company_name, score: x.score, reasons: x.reasons })) : [];
        let viaAvailability = false;
        let availErr: string | null = null;
        // FALLBACK, and it has to happen HERE — before `ids` — not in a derived
        // list further down. Everything the rows need (submission profiles,
        // destination email/portal, what's already been sent) is loaded by id in
        // the Promise.all below. Fall back later and every row renders "no
        // destination" and blocks: an empty panel traded for a dead one.
        //
        // The scorer reads `lenders`; availability reads `lender_programs` for
        // the same live funders. When they disagree, the merchant is not the
        // one who should pay for it.
        if (m.length === 0 && read.kind === "ok") {
          try {
            const { rows } = await getFunderAvailability(deal);
            if (rows.length > 0) {
              viaAvailability = true;
              m = rows.map((r) => ({
                id: r.lenderId,
                company_name: r.name,
                score: 0,
                reasons: ["Live for this deal per the funder-availability check — the scorer matched none"],
                fromAvailability: true,
              }));
            }
          } catch (e) {
            // The fallback failing is its own fact. Swallow it and the empty
            // copy below claims we checked the availability list and it had
            // nothing — when we never got an answer from it at all.
            availErr = e instanceof Error ? e.message : "the funder-availability check didn't answer";
          }
        }
        const ids = m.map((x) => x.id);
        const [profRes, lendRes, docRes, subRes] = await Promise.all([
          // `active` and `portal_url` are read because the badge below depends on
          // BOTH: an inactive recipe is not a destination, and a recipe whose
          // method is "portal" with no portal_url has nowhere to send either.
          ids.length ? supabase.from("funder_submission_profiles").select("lender_id, method, required_stips, to_email, portal_url, active").eq("active", true).in("lender_id", ids) : Promise.resolve({ data: [] }),
          ids.length ? supabase.from("lenders").select("id, submission_email, submission_portal_url").in("id", ids) : Promise.resolve({ data: [] }),
          deal.customer_id ? supabase.from("customer_documents").select("id, document_type, filename").eq("customer_id", deal.customer_id) : Promise.resolve({ data: [] }),
          supabase.from("deal_submissions").select("id, lender_id, status, submission_method, error, portal_confirmed_at, response_at, offer_amount, factor_rate, term_months, daily_payment, weekly_payment, total_payback, decline_reason").eq("deal_id", deal.id),
        ]);
        if (cancelled) return;
        setMatches(m);
        setUsedAvailability(viaAvailability);
        setFallbackErr(availErr);
        setMatchesErr(read.kind === "unreadable" ? read.why : null);
        const pmap: Record<string, ProfileMeta> = {};
        for (const p of (profRes.data ?? []) as { lender_id: string; method: ProfileMeta["method"]; required_stips: string[] | null; to_email: string | null; portal_url: string | null }[]) {
          pmap[p.lender_id] = { method: p.method, required_stips: p.required_stips ?? [], to_email: p.to_email, portal_url: p.portal_url };
        }
        setProfiles(pmap);
        const dmap: Record<string, { email: string | null; portal: string | null }> = {};
        for (const l of (lendRes.data ?? []) as { id: string; submission_email: string | null; submission_portal_url: string | null }[]) {
          dmap[l.id] = { email: l.submission_email, portal: l.submission_portal_url };
        }
        setLenderDest(dmap);
        // Package check sees BOTH rails: app-side customer_documents AND the
        // GHL side (signed e-sign docs + files from the upload form) — a signed
        // application in GHL counts, statements uploaded to GHL count. Kept in
        // two sets so the signed-app slot can tell app-side from GHL-only.
        const invRows = (docRes.data ?? []) as InventoryDoc[];
        if (!cancelled) {
          setInventory(invRows);
          // Pre-check the standard package; extras start off.
          setSelectedDocIds(new Set(invRows.filter((d) => DEFAULT_PACKAGE_TYPES.has(d.document_type)).map((d) => d.id)));
        }
        const appPresent = new Set(invRows.map((d) => d.document_type));
        const ghlPresent = new Set<string>();
        let ghlErr: string | null = null;
        if (deal.ghl_contact_id) {
          try {
            const { data: ghl, error: ghlInvokeErr } = await supabase.functions.invoke("ghl-docs-status", {
              body: { ghl_contact_id: deal.ghl_contact_id },
            });
            // invokeThrow recovers the server's real reason from error.context;
            // readDocsStatus is the one definition of unreadable-vs-empty and
            // also catches a truncated crawl / unidentifiable merchant, both of
            // which arrive here looking like a contact with no documents.
            if (ghlInvokeErr) await invokeThrow(ghlInvokeErr);
            const st = readDocsStatus(ghl as GhlDocsStatus, null);
            if (st.kind === "unreadable") throw new Error(st.why);
            if (st.caveat) ghlErr = st.caveat;
            // The uploads half fails independently of the documents half.
            const upErr = (ghl as GhlDocsStatus)?.uploads_error ?? null;
            if (upErr) ghlErr = ghlErr ? `${ghlErr}; ${upErr}` : upErr;
            for (const doc of (ghl?.documents ?? []) as { name?: string; signed?: boolean }[]) {
              if (doc.signed && /application/i.test(doc.name ?? "")) ghlPresent.add("application");
            }
            for (const u of (ghl?.uploads ?? []) as { field: string; files: unknown[] }[]) {
              if (!u.files?.length) continue;
              if (/bank/i.test(u.field)) ghlPresent.add("bank_statement");
              else {
                // Stips uploads (ID / voided check / ownership) — the upload form
                // can't tag types, so files here unlock both; closers verify
                // visually in the Docs-back panel.
                ghlPresent.add("id");
                ghlPresent.add("voided_check");
              }
            }
          } catch (e) {
            // Best-effort for the DATA, never for the VERDICT: app docs still
            // count, but the missing-stip list below is now known to be blind.
            ghlErr = e instanceof Error ? e.message : "VibeReach didn't answer";
          }
        }
        if (!cancelled) { setAppDocs(appPresent); setGhlDocs(ghlPresent); setGhlDocsError(ghlErr); }
        setExistingErr(
          subRes.error
            ? subRes.error.message
            : subRes.data == null
              ? "The submissions read came back empty."
              : null,
        );
        const emap: Record<string, ExistingSub> = {};
        for (const s of (subRes.data ?? []) as { id: string; lender_id: string; status: string; submission_method: string | null; error: string | null; portal_confirmed_at: string | null; response_at: string | null; offer_amount: number | null; factor_rate: number | null; term_months: number | null; daily_payment: number | null; weekly_payment: number | null; total_payback: number | null; decline_reason: string | null }[]) {
          emap[s.lender_id] = {
            status: s.status, method: s.submission_method, submissionId: s.id, hasError: !!s.error,
            portalConfirmed: !!s.portal_confirmed_at, responseAt: s.response_at,
            offerAmount: s.offer_amount, factorRate: s.factor_rate, termMonths: s.term_months,
            dailyPayment: s.daily_payment, weeklyPayment: s.weekly_payment, totalPayback: s.total_payback,
            declineReason: s.decline_reason,
          };
        }
        setExisting(emap);
      } catch (e) {
        if (!cancelled) {
          const why = e instanceof Error ? e.message : "Failed to load funders";
          setError(why);
          // AND matchesErr. `error` is rendered only inside the branch that
          // requires matches to exist, so on a throw it is unreachable — the
          // panel would fall through to the empty copy and assert "we read the
          // funder network and none of it fits", which is a STRONGER false
          // claim than the sentence this whole change replaced. Caught by
          // docs-absence-fix on review; it was live in the first version.
          setMatchesErr(why);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [deal.id, deal.customer_id, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load box-fit reasons once per deal (advisory only — never gates Submit).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { rows } = await getFunderAvailability(deal);
        if (cancelled) return;
        const map: Record<string, string[]> = {};
        for (const r of rows) if (r.tier === "out_of_box" && r.boxReasons.length) map[r.lenderId] = r.boxReasons;
        setBoxReasons(map);
      } catch { /* advisory; ignore */ }
    })();
    return () => { cancelled = true; };
  }, [deal.id, deal.customer_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-disarm a pending override after 5s (matches the modal send's arm timeout).
  useEffect(() => {
    if (!armedOverride) return;
    const t = setTimeout(() => setArmedOverride(null), 5000);
    return () => clearTimeout(t);
  }, [armedOverride]);

  // Union of both rails — this is what the stips guard reads (unchanged behavior).
  const docsPresent = useMemo(() => new Set<string>([...appDocs, ...ghlDocs]), [appDocs, ghlDocs]);
  const signedAppInApp = appDocs.has("application");
  const signedAppInGhl = ghlDocs.has("application");

  // Re-read app-side customer_documents after an upload so the slot flips to ✅
  // and any per-funder "forward the signed application" warning goes moot.
  async function reloadAppDocs() {
    if (!deal.customer_id) return;
    const { data, error } = await supabase.from("customer_documents").select("document_type").eq("customer_id", deal.customer_id);
    // A failed re-read must not empty the set: the slot would flip back to "not
    // on file" moments after the closer watched the upload succeed, and the
    // stips guard would re-block a funder over a document that is right there.
    // Keep what we had; the next open re-reads it.
    if (error) return;
    setAppDocs(new Set(((data ?? []) as { document_type: string }[]).map((d) => d.document_type)));
  }

  // Upload the signed application PDF the closer downloaded from GHL. The shared
  // helper owns the storage-path + customer_documents conventions (same ones the
  // Step 5 action banner uses) so the submit-to-funders engine picks it up
  // automatically and attaches it to every funder.
  async function uploadSignedApp() {
    const file = signedAppFile;
    if (!file || !deal.customer_id) return;
    setUploadingApp(true);
    setUploadAppError(null);
    try {
      await uploadSignedApplication({ file, customerId: deal.customer_id, uploadedBy: session?.user?.id });
      setSignedAppFile(null);
      await reloadAppDocs();
    } catch (e) {
      setUploadAppError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploadingApp(false);
    }
  }

  // A RECIPE THAT EXISTS IS NOT A RECIPE THAT HAS SOMEWHERE TO SEND.
  //
  // This used to be `if (p) return p.method` — the profile row's mere existence
  // decided the badge, so a recipe with an empty to_email rendered "email" and
  // the funder was selectable. Lendini did exactly that for weeks: an active
  // profile with no destination of its own, which only ever sent because
  // submit-to-funders falls back to `lenders.submission_email`
  // (submit-to-funders/index.ts, `recipe?.to_email || lender.submission_email`).
  // It worked by luck. A funder with a profile and no lender fallback would have
  // been offered, selected, and failed at send with the package already built.
  //
  // So the client now resolves a destination the SAME WAY the server does:
  // recipe first, lender row as the fallback, and "none" only when neither has
  // one. Found by funder-destinations, 2026-09-30.
  const methodOf = (lenderId: string): Method => {
    const p = profiles[lenderId];
    const d = lenderDest[lenderId];
    const email = p?.to_email || d?.email || null;
    const portal = p?.portal_url || d?.portal || null;
    if (email && portal) return p?.method === "email" ? "email" : "email_and_portal";
    if (email) return "email";
    if (portal) return "portal";
    return "none";
  };
  const missingStipsOf = (lenderId: string): string[] =>
    // voided_check is NEVER a blocker — a bank-portal screenshot satisfies it,
    // so it can't gate Submit even if a recipe lists it as required.
    (profiles[lenderId]?.required_stips ?? [])
      .filter((s) => s !== "voided_check" && !docsPresent.has(s));
  // Slugs the owner has knowingly waived for this funder, and what's STILL missing
  // after the waiver (the effective gate the checkbox/selectability reads).
  const overriddenStipsOf = (lenderId: string): string[] => stipOverrides[lenderId] ?? [];
  const effectiveMissingStipsOf = (lenderId: string): string[] =>
    missingStipsOf(lenderId).filter((s) => !overriddenStipsOf(lenderId).includes(s));

  // An existing active (non-failed) submission means "already went out".
  const isAlreadyOut = (lenderId: string) => {
    const e = existing[lenderId];
    if (!e) return false;
    if (results[lenderId]) return false; // a fresh action supersedes the stale row
    return !e.hasError && e.status !== "withdrawn" && e.status !== "pending";
  };

  const { primary, secondary } = useMemo(() => {
    const p: Match[] = [], s: Match[] = [];
    // A fallback row has no score, so `score >= 40` would file every one of them
    // under "show misfits" and the panel would look empty all over again.
    for (const m of matches) (m.fromAvailability || m.score >= 40 ? p : s).push(m);
    return { primary: p, secondary: s };
  }, [matches]);

  const toggle = (id: string, disabled: boolean) => {
    if (disabled) return;
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleDoc = (id: string) => {
    setSelectedDocIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Arm-then-fire (no browser popups): first click arms, second click within 5s
  // commits the override — waiving THIS funder's still-missing required stips for
  // this submission only, then auto-selecting the now-unblocked row.
  function overrideStips(lenderId: string, slugs: string[]) {
    if (slugs.length === 0) return;
    if (armedOverride === lenderId) {
      setStipOverrides((prev) => ({ ...prev, [lenderId]: Array.from(new Set([...(prev[lenderId] ?? []), ...slugs])) }));
      setArmedOverride(null);
      setSelected((prev) => new Set(prev).add(lenderId));
    } else {
      setArmedOverride(lenderId);
    }
  }
  // Undo an override — the row re-blocks, so drop it from the selection too.
  function clearOverride(lenderId: string) {
    setStipOverrides((prev) => { const n = { ...prev }; delete n[lenderId]; return n; });
    setSelected((prev) => { const n = new Set(prev); n.delete(lenderId); return n; });
    setArmedOverride((cur) => (cur === lenderId ? null : cur));
  }
  // The doc-slug overrides for exactly the funders being sent to (empty dropped) —
  // mirrors the server's stipOverrides shape.
  function buildStipOverrides(ids: string[]): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const id of ids) {
      const ov = stipOverrides[id];
      if (ov && ov.length) out[id] = ov;
    }
    return out;
  }

  async function submit(ids: string[], resubmit = false, overridesArg?: Record<string, { subject?: string; body?: string }>) {
    if (ids.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("submit-to-funders", {
        // documentIds = the picked "Package contents". Empty → engine falls back
        // to its default attach set (backward compatible), so uncheck-all never
        // sends a zero-doc package. overrides = per-funder subject/body edits made
        // in the preview (only funders the owner actually changed are included).
        body: {
          dealId: deal.id, lenderIds: ids, resubmit, documentIds: [...selectedDocIds],
          ...(overridesArg && Object.keys(overridesArg).length ? { overrides: overridesArg } : {}),
          ...(Object.keys(buildStipOverrides(ids)).length ? { stipOverrides: buildStipOverrides(ids) } : {}),
        },
      });
      // Not `throw fnErr` — invoke() collapses every non-2xx into "Edge Function
      // returned a non-2xx status code" and hides the server's actual sentence in
      // error.context. That is what a processor saw instead of being told the deal
      // wasn't assigned to her.
      if (fnErr) await invokeThrow(fnErr);
      const rows = (data?.results ?? []) as FunderResult[];
      setResults((prev) => {
        const next = { ...prev };
        for (const r of rows) next[r.lenderId] = r;
        return next;
      });
      if (data?.warning) setError(data.warning);
      // Clear the just-submitted ones from the checkbox selection.
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setSubmitting(false);
    }
  }

  // ---- Preview + edit before send -----------------------------------------
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previews, setPreviews] = useState<PreviewFunder[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  // Per-funder editable subject/body, seeded from the server-rendered originals.
  const [edits, setEdits] = useState<Record<string, { subject: string; body: string }>>({});
  const [originals, setOriginals] = useState<Record<string, { subject: string; body: string }>>({});
  // Two-step arm/fire for the in-modal send (no browser popups — house rule).
  const [armedSend, setArmedSend] = useState(false);
  useEffect(() => {
    if (!armedSend) return;
    const t = setTimeout(() => setArmedSend(false), 5000);
    return () => clearTimeout(t);
  }, [armedSend]);

  // Ask the engine to render (not send) every selected funder, then open the
  // editable preview. Same render/gather path as the real send — the truth.
  async function openPreview() {
    const ids = [...selected];
    if (ids.length === 0) return;
    setPreviewLoading(true);
    setPreviewError(null);
    setArmedSend(false);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("submit-to-funders", {
        body: { dealId: deal.id, lenderIds: ids, action: "preview", documentIds: [...selectedDocIds], ...(Object.keys(buildStipOverrides(ids)).length ? { stipOverrides: buildStipOverrides(ids) } : {}) },
      });
      // Not `throw fnErr` — invoke() collapses every non-2xx into "Edge Function
      // returned a non-2xx status code" and hides the server's actual sentence in
      // error.context. That is what a processor saw instead of being told the deal
      // wasn't assigned to her.
      if (fnErr) await invokeThrow(fnErr);
      const rows = (data?.previews ?? []) as PreviewFunder[];
      const seedEdits: Record<string, { subject: string; body: string }> = {};
      const seedOrig: Record<string, { subject: string; body: string }> = {};
      for (const p of rows) {
        if (p.blocked) continue;
        const s = p.subject ?? "", b = p.body ?? "";
        seedEdits[p.lenderId] = { subject: s, body: b };
        seedOrig[p.lenderId] = { subject: s, body: b };
      }
      setPreviews(rows);
      setEdits(seedEdits);
      setOriginals(seedOrig);
      setPreviewOpen(true);
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setPreviewLoading(false);
    }
  }

  // Only funders whose subject/body the owner actually changed carry an override.
  function buildOverrides(): Record<string, { subject?: string; body?: string }> {
    const out: Record<string, { subject?: string; body?: string }> = {};
    for (const p of previews) {
      if (p.blocked) continue;
      const e = edits[p.lenderId], o = originals[p.lenderId];
      if (!e || !o) continue;
      const entry: { subject?: string; body?: string } = {};
      if (e.subject !== o.subject) entry.subject = e.subject;
      if (e.body !== o.body) entry.body = e.body;
      if (entry.subject !== undefined || entry.body !== undefined) out[p.lenderId] = entry;
    }
    return out;
  }

  const previewSendable = previews.filter((p) => !p.blocked && !p.isPortalOnly);
  const previewPortalOnly = previews.filter((p) => !p.blocked && p.isPortalOnly);
  const previewSendCount = previews.filter((p) => !p.blocked).length;

  function isPreviewEdited(lenderId: string): boolean {
    const e = edits[lenderId], o = originals[lenderId];
    return !!e && !!o && (e.subject !== o.subject || e.body !== o.body);
  }

  function resetPreview(lenderId: string) {
    const o = originals[lenderId];
    if (!o) return;
    setEdits((prev) => ({ ...prev, [lenderId]: { subject: o.subject, body: o.body } }));
  }

  // Fire the real submit for every non-blocked previewed funder, carrying edits.
  async function sendFromPreview() {
    const ids = previews.filter((p) => !p.blocked).map((p) => p.lenderId);
    if (ids.length === 0) return;
    await submit(ids, false, buildOverrides());
    setPreviewOpen(false);
    setArmedSend(false);
  }

  // A lender the closer can actually check right now: it's in the scored list,
  // has a destination, isn't missing stips, and hasn't already gone out.
  function isSelectable(lenderId: string): boolean {
    if (!matches.some((m) => m.id === lenderId)) return false;
    return methodOf(lenderId) !== "none" && effectiveMissingStipsOf(lenderId).length === 0 && !isAlreadyOut(lenderId);
  }

  async function recommend() {
    setAiLoading(true);
    setAiError(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("recommend-lenders", {
        body: { deal_id: deal.id },
      });
      // Not `throw fnErr` — invoke() collapses every non-2xx into "Edge Function
      // returned a non-2xx status code" and hides the server's actual sentence in
      // error.context. That is what a processor saw instead of being told the deal
      // wasn't assigned to her.
      if (fnErr) await invokeThrow(fnErr);
      if (data?.error) throw new Error(data.error);
      const recs = (data?.recommendations ?? []) as AiRec[];
      setAiSummary(typeof data?.summary === "string" ? data.summary : "");
      setAiRecs(recs);
      setAiUw((data?.underwriting ?? null) as UwSnapshot | null);
      setAiRan(true);
      // Auto-check the strong fits that are actually selectable right now.
      setSelected((prev) => {
        const next = new Set(prev);
        for (const r of recs) if (r.fit === "strong" && isSelectable(r.lender_id)) next.add(r.lender_id);
        return next;
      });
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "AI recommendation failed");
    } finally {
      setAiLoading(false);
    }
  }

  async function markPortalSubmitted(r: FunderResult) {
    if (!r.submissionId) return;
    const nowIso = new Date().toISOString();
    try {
      await mustWrite("mark portal submitted", supabase
        .from("deal_submissions")
        .update({ status: "submitted", submitted_at: nowIso, portal_confirmed_at: nowIso })
        .eq("id", r.submissionId));
    } catch (e) {
      setError(`Could not mark submitted: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    setResults((prev) => ({ ...prev, [r.lenderId]: { ...r, status: "portal_confirmed" } }));
  }

  async function viewPayload(r: FunderResult) {
    if (!r.submissionId) return;
    if (payloadOpen[r.lenderId] !== undefined) {
      setPayloadOpen((p) => { const n = { ...p }; delete n[r.lenderId]; return n; });
      return;
    }
    const { data, error } = await supabase.from("deal_submissions").select("sent_payload").eq("id", r.submissionId).maybeSingle();
    // "null" here reads as "we sent them nothing". Say which it is.
    setPayloadOpen((p) => ({
      ...p,
      [r.lenderId]: error
        ? { error: `Couldn't read what was sent — ${error.message}. This is not "nothing was sent".` }
        : (data?.sent_payload ?? null),
    }));
  }

  const nameOf = (lenderId: string) => matches.find((m) => m.id === lenderId)?.company_name ?? "Funder";

  // Best-effort activity trail entry against this deal — mirrors useActivityLog's
  // insert shape so it shows up in the deal's Activity tab.
  async function logActivity(interaction_type: string, subject: string, content: string, newStatus?: string) {
    // the trail is nice-to-have; never block the offer save on it
    await tryWrite("deal activity log", supabase.from("activity_log").insert({
      entity_type: "deal", entity_id: deal.id,
      interaction_type, subject, content,
      new_status: newStatus ?? null,
      logged_by: session?.user?.id ?? null,
    }));
  }

  function openOfferForm(lenderId: string) {
    const e = existing[lenderId];
    setDeclineFor(null);
    setOfferError(null);
    setOfferFormFor(lenderId);
    // Prefill from any offer already on the row so "Log offer" doubles as edit.
    setOfferForm({
      amount: e?.offerAmount != null ? String(e.offerAmount) : "",
      factor: e?.factorRate != null ? String(e.factorRate) : "",
      term: e?.termMonths != null ? String(e.termMonths) : "",
      payment: e?.dailyPayment != null ? String(e.dailyPayment) : e?.weeklyPayment != null ? String(e.weeklyPayment) : "",
      frequency: e?.weeklyPayment != null ? "weekly" : "daily",
    });
  }

  // Persist a logged offer onto the submission row (status → offer_made) and
  // reflect it locally so the compare strip + row summary update immediately.
  async function saveOffer(lenderId: string) {
    const e = existing[lenderId];
    if (!e) return;
    const amount = parseFloat(offerForm.amount);
    const factor = parseFloat(offerForm.factor);
    if (!Number.isFinite(amount) || amount <= 0) { setOfferError("Enter the advance amount."); return; }
    if (!Number.isFinite(factor) || factor <= 0) { setOfferError("Enter the factor rate (e.g. 1.3)."); return; }
    const term = offerForm.term ? parseInt(offerForm.term, 10) : null;
    const payment = offerForm.payment ? parseFloat(offerForm.payment) : null;
    const totalPayback = Math.round(amount * factor);
    const daily = offerForm.frequency === "daily" ? payment : null;
    const weekly = offerForm.frequency === "weekly" ? payment : null;
    setSavingOffer(true);
    setOfferError(null);
    try {
      await updateSubmission(e.submissionId, {
        status: "offer_made",
        offer_amount: amount,
        factor_rate: factor,
        term_months: term,
        daily_payment: daily,
        weekly_payment: weekly,
        total_payback: totalPayback,
      });
      setExisting((prev) => ({
        ...prev,
        [lenderId]: { ...prev[lenderId], status: "offer_made", offerAmount: amount, factorRate: factor, termMonths: term, dailyPayment: daily, weeklyPayment: weekly, totalPayback },
      }));
      const freqLabel = offerForm.frequency;
      await logActivity(
        "offer_received",
        `Offer logged — ${nameOf(lenderId)}`,
        `${nameOf(lenderId)} offered ${money(amount)} at ${factor} factor (${money(totalPayback)} payback)${payment ? `, ${money(payment)} ${freqLabel}` : ""}${term ? `, ${term} mo` : ""}.`,
        "offer_made",
      );
      setOfferFormFor(null);
    } catch (err) {
      setOfferError(err instanceof Error ? err.message : "Could not save the offer.");
    } finally {
      setSavingOffer(false);
    }
  }

  // Funder declined the DEAL (distinct from the merchant declining an offer).
  async function markFunderDeclined(lenderId: string) {
    const e = existing[lenderId];
    if (!e) return;
    setRowBusy(lenderId);
    try {
      await updateSubmission(e.submissionId, { status: "declined", decline_reason: declineReason.trim() || null });
      setExisting((prev) => ({ ...prev, [lenderId]: { ...prev[lenderId], status: "declined", declineReason: declineReason.trim() || null } }));
      await logActivity("note", `Funder declined — ${nameOf(lenderId)}`, `${nameOf(lenderId)} declined the deal${declineReason.trim() ? `: ${declineReason.trim()}` : "."}`, "declined");
      setDeclineFor(null);
      setDeclineReason("");
    } catch (err) {
      setOfferError(err instanceof Error ? err.message : "Could not record the decline.");
    } finally {
      setRowBusy(null);
    }
  }

  // Merchant's call on a logged offer: accept THIS one (others untouched) or
  // decline it. Neither advances the deal stage — that stays on the step button.
  async function setOfferOutcome(lenderId: string, outcome: "offer_accepted" | "offer_declined") {
    const e = existing[lenderId];
    if (!e) return;
    setRowBusy(lenderId);
    try {
      await updateSubmission(e.submissionId, { status: outcome });
      setExisting((prev) => ({ ...prev, [lenderId]: { ...prev[lenderId], status: outcome } }));
      if (outcome === "offer_accepted") {
        await logActivity("note", `Offer accepted — ${nameOf(lenderId)}`, `Merchant accepted ${nameOf(lenderId)}'s offer of ${money(e.offerAmount)}.`, "offer_accepted");
        setAcceptedHint(true);
      } else {
        await logActivity("note", `Offer declined by merchant — ${nameOf(lenderId)}`, `Merchant declined ${nameOf(lenderId)}'s offer.`, "offer_declined");
      }
    } catch (err) {
      setOfferError(err instanceof Error ? err.message : "Could not update the offer.");
    } finally {
      setRowBusy(null);
    }
  }

  const renderRow = (m: Match) => {
    const method = methodOf(m.id);
    const missing = missingStipsOf(m.id);
    const overridden = overriddenStipsOf(m.id);
    const effectiveMissing = missing.filter((s) => !overridden.includes(s));
    const alreadyOut = isAlreadyOut(m.id);
    const noDest = method === "none";
    const disabled = noDest || effectiveMissing.length > 0 || alreadyOut;
    const badge = methodBadge(method);
    const checked = selected.has(m.id);
    const e = existing[m.id];
    return (
      <div key={m.id} className="space-y-1.5">
      <label
        className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
          disabled ? "border-gray-200 dark:border-gray-700 opacity-60" : checked ? "border-ocean-blue bg-ocean-blue/5" : "border-gray-200 dark:border-gray-700 hover:border-ocean-blue/50 cursor-pointer"
        }`}
      >
        <input
          type="checkbox"
          className="mt-0.5 w-4 h-4 text-ocean-blue rounded border-gray-300 focus:ring-ocean-blue disabled:cursor-not-allowed"
          checked={checked}
          disabled={disabled}
          onChange={() => toggle(m.id, disabled)}
        />
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-gray-900 dark:text-white">{m.company_name}</span>
            <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full ${badge.cls}`}>
              <badge.icon className="w-3 h-3" /> {badge.label}
            </span>
            <span className="text-[11px] text-gray-400">score {m.score}</span>
            {alreadyOut && e?.status === "offer_made" && <span className="text-[11px] font-medium text-orange-600">offer logged</span>}
            {alreadyOut && e?.status === "offer_accepted" && <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600"><TrophyIcon className="w-3 h-3" /> offer accepted</span>}
            {alreadyOut && e?.status === "offer_declined" && <span className="text-[11px] font-medium text-rose-600">offer declined by merchant</span>}
            {alreadyOut && e?.status === "declined" && <span className="text-[11px] font-medium text-rose-600">funder declined</span>}
            {alreadyOut && !["offer_made", "offer_accepted", "offer_declined", "declined"].includes(e?.status ?? "") && (existing[m.id]?.responseAt
              ? <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600">✉ replied {relTime(existing[m.id].responseAt!)}</span>
              : <span className="text-[11px] text-emerald-600">already submitted</span>)}
            {alreadyOut && existing[m.id]?.submissionId && (
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); viewPayload({ lenderId: m.id, submissionId: existing[m.id].submissionId, status: "already_submitted" }); }}
                className="text-[11px] text-ocean-blue hover:underline"
              >
                view payload
              </button>
            )}
            {alreadyOut && (
              <button
                type="button"
                disabled={submitting}
                onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); submit([m.id], true); }}
                title="Re-send this funder the current package (e.g. after the recipe or docs were fixed). No new merchant email goes out."
                className="text-[11px] font-medium text-orange-600 hover:underline disabled:opacity-50"
              >
                ↻ resend
              </button>
            )}
          </span>
          {payloadOpen[m.id] !== undefined && (
            <pre className="mt-1 max-h-64 overflow-auto rounded bg-gray-900 text-gray-100 text-[10px] p-2 whitespace-pre-wrap">
              {JSON.stringify(payloadOpen[m.id], null, 2)}
            </pre>
          )}
          {missing.length > 0 && (
            <span className="block text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">
              ⚠ needs: {missing.map(docLabel).join(", ")}
            </span>
          )}
          {overridden.length > 0 && (
            <span className="block text-[11px] text-orange-600 dark:text-orange-400 mt-0.5 font-medium">
              ⚠ overriding: {overridden.map(docLabel).join(", ")} — submitting without ("to follow")
              <button
                type="button"
                onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); clearOverride(m.id); }}
                className="ml-1.5 font-normal text-gray-400 hover:text-gray-600 underline"
              >
                undo
              </button>
            </span>
          )}
          {/* Owner override — knowingly submit past a doc-blocked funder, with the
              missing stip "to follow" (armed two-step, no browser popups). */}
          {effectiveMissing.length > 0 && !noDest && !alreadyOut && (
            <span className="block mt-1">
              <button
                type="button"
                onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); overrideStips(m.id, effectiveMissing); }}
                title="Knowingly submit this funder now with the missing stip to follow — the funder email will say it's coming under separate cover."
                className={`text-[11px] font-semibold px-2 py-0.5 rounded border inline-flex items-center gap-1 ${armedOverride === m.id ? "border-amber-500 bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" : "border-orange-300 text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-900/20"}`}
              >
                {armedOverride === m.id
                  ? `⚠️ Tap again — submit without ${effectiveMissing.map(docLabel).join(", ")}`
                  : `Override — submit without ${effectiveMissing.map(docLabel).join(", ")}`}
              </button>
            </span>
          )}
          {noDest && <span className="block text-[11px] text-gray-400 mt-0.5">no submission email or portal on file</span>}
          {boxReasons[m.id]?.length > 0 && (
            <span className="block text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">
              🟡 out of box: {boxReasons[m.id].join("; ")}
            </span>
          )}
        </span>
      </label>

      {/* Inline offer capture — only on rows already sent to the funder, so the
          closer logs the reply without leaving Step 6. */}
      {alreadyOut && e && renderOfferBlock(m, e)}
      </div>
    );
  };

  // The compact "Log offer / Funder declined" strip + inline forms that hang
  // under a submitted funder row.
  const renderOfferBlock = (m: Match, e: ExistingSub) => {
    const hasOffer = e.offerAmount != null;
    const freq: Frequency = e.weeklyPayment != null ? "weekly" : "daily";
    const payment = freq === "weekly" ? e.weeklyPayment : e.dailyPayment;
    const b = burden(payment, freq, deal.customer?.monthly_revenue ?? null);
    const busy = rowBusy === m.id;
    return (
      <div className="ml-6 rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 px-3 py-2 space-y-2">
        {/* Logged-offer summary */}
        {hasOffer && e.status !== "declined" && (
          <div className="flex items-center gap-2 flex-wrap text-[11px]">
            <span className="font-semibold text-gray-800 dark:text-gray-100">{money(e.offerAmount)}</span>
            <span className="text-gray-400">·</span>
            <span className="text-gray-600 dark:text-gray-300">{e.factorRate}x</span>
            <span className="text-gray-400">·</span>
            <span className="text-gray-600 dark:text-gray-300">{money(e.totalPayback)} payback</span>
            {payment != null && <><span className="text-gray-400">·</span><span className="text-gray-600 dark:text-gray-300">{money(payment)}/{freq === "weekly" ? "wk" : "day"}</span></>}
            {e.termMonths != null && <><span className="text-gray-400">·</span><span className="text-gray-600 dark:text-gray-300">{e.termMonths} mo</span></>}
            {b?.pct != null && (
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full font-medium ${b.hot ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" : "bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300"}`}>
                {b.pct.toFixed(0)}% of monthly revenue{b.hot ? " ⚠" : ""}
              </span>
            )}
          </div>
        )}
        {e.status === "declined" && (
          <p className="text-[11px] text-rose-600 dark:text-rose-400">Funder declined{e.declineReason ? ` — ${e.declineReason}` : ""}.</p>
        )}

        {/* Row actions */}
        {declineFor !== m.id && offerFormFor !== m.id && (
          <div className="flex items-center gap-2 flex-wrap">
            {e.status !== "declined" && (
              <button type="button" onClick={() => openOfferForm(m.id)} className="text-[11px] font-semibold px-2 py-1 rounded border border-ocean-blue/50 text-ocean-blue hover:bg-ocean-blue/5 inline-flex items-center gap-1">
                <CurrencyDollarIcon className="w-3.5 h-3.5" /> {hasOffer ? "Edit offer" : "Log offer"}
              </button>
            )}
            {e.status !== "declined" && !hasOffer && (
              <button type="button" onClick={() => { setDeclineFor(m.id); setDeclineReason(""); setOfferFormFor(null); }} className="text-[11px] font-semibold px-2 py-1 rounded border border-rose-300 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 inline-flex items-center gap-1">
                <HandThumbDownIcon className="w-3.5 h-3.5" /> Funder declined
              </button>
            )}
          </div>
        )}

        {/* Inline offer form */}
        {offerFormFor === m.id && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <label className="text-[10px] text-gray-500">Advance amount
                <input type="number" inputMode="decimal" value={offerForm.amount} onChange={(ev) => setOfferForm((f) => ({ ...f, amount: ev.target.value }))} placeholder="50000" className="mt-0.5 w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-[12px] text-gray-900 dark:text-white" />
              </label>
              <label className="text-[10px] text-gray-500">Factor rate
                <input type="number" inputMode="decimal" step="0.01" value={offerForm.factor} onChange={(ev) => setOfferForm((f) => ({ ...f, factor: ev.target.value }))} placeholder="1.30" className="mt-0.5 w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-[12px] text-gray-900 dark:text-white" />
              </label>
              <label className="text-[10px] text-gray-500">Term (months)
                <input type="number" inputMode="numeric" value={offerForm.term} onChange={(ev) => setOfferForm((f) => ({ ...f, term: ev.target.value }))} placeholder="6" className="mt-0.5 w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-[12px] text-gray-900 dark:text-white" />
              </label>
              <label className="text-[10px] text-gray-500">Payment
                <div className="mt-0.5 flex gap-1">
                  <input type="number" inputMode="decimal" value={offerForm.payment} onChange={(ev) => setOfferForm((f) => ({ ...f, payment: ev.target.value }))} placeholder="450" className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-[12px] text-gray-900 dark:text-white" />
                  <select value={offerForm.frequency} onChange={(ev) => setOfferForm((f) => ({ ...f, frequency: ev.target.value as Frequency }))} className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-1 py-1 text-[12px] text-gray-900 dark:text-white">
                    <option value="daily">daily</option>
                    <option value="weekly">weekly</option>
                  </select>
                </div>
              </label>
            </div>
            {/* Live payback + burden preview from the in-progress form values */}
            {(() => {
              const a = parseFloat(offerForm.amount), fac = parseFloat(offerForm.factor), pay = parseFloat(offerForm.payment);
              if (!Number.isFinite(a) || !Number.isFinite(fac)) return null;
              const pv = burden(Number.isFinite(pay) ? pay : null, offerForm.frequency, deal.customer?.monthly_revenue ?? null);
              return (
                <p className="text-[11px] text-gray-500">
                  Total payback {money(Math.round(a * fac))}
                  {pv?.pct != null && <span className={pv.hot ? "text-amber-600 font-medium" : ""}> · {pv.pct.toFixed(0)}% of monthly revenue{pv.hot ? " ⚠" : ""}</span>}
                </p>
              );
            })()}
            {offerError && <p className="text-[11px] text-red-600 dark:text-red-400">{offerError}</p>}
            <div className="flex items-center gap-2">
              <button type="button" disabled={savingOffer} onClick={() => saveOffer(m.id)} className="text-[11px] font-semibold px-2.5 py-1 rounded bg-ocean-blue text-white hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1">
                {savingOffer ? <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" /> : <CheckCircleIcon className="w-3.5 h-3.5" />} Save offer
              </button>
              <button type="button" onClick={() => { setOfferFormFor(null); setOfferError(null); }} className="text-[11px] text-gray-500 hover:text-gray-700 inline-flex items-center gap-1">
                <XMarkIcon className="w-3.5 h-3.5" /> Cancel
              </button>
            </div>
          </div>
        )}

        {/* Inline "funder declined" reason box */}
        {declineFor === m.id && (
          <div className="space-y-2">
            <input type="text" value={declineReason} onChange={(ev) => setDeclineReason(ev.target.value)} placeholder="Reason (optional) — e.g. too many positions, low deposits" className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-[12px] text-gray-900 dark:text-white" />
            <div className="flex items-center gap-2">
              <button type="button" disabled={busy} onClick={() => markFunderDeclined(m.id)} className="text-[11px] font-semibold px-2.5 py-1 rounded bg-rose-600 text-white hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1">
                {busy ? <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" /> : <HandThumbDownIcon className="w-3.5 h-3.5" />} Record decline
              </button>
              <button type="button" onClick={() => { setDeclineFor(null); setDeclineReason(""); }} className="text-[11px] text-gray-500 hover:text-gray-700 inline-flex items-center gap-1">
                <XMarkIcon className="w-3.5 h-3.5" /> Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const resultRows = matches
    .map((m) => results[m.id])
    .filter(Boolean) as FunderResult[];

  // Every submission that carries a logged offer (funder-declined ones drop out),
  // ranked cheapest-payback-first so the best economics sit at the front.
  const loggedOffers = useMemo(() => {
    const rows = Object.entries(existing)
      .filter(([, e]) => e.offerAmount != null && e.status !== "declined")
      .map(([lenderId, e]) => {
        const freq: Frequency = e.weeklyPayment != null ? "weekly" : "daily";
        const payment = freq === "weekly" ? e.weeklyPayment : e.dailyPayment;
        const payback = e.totalPayback ?? (e.offerAmount ?? 0) * (e.factorRate ?? 1);
        return { lenderId, e, freq, payment, payback, b: burden(payment, freq, deal.customer?.monthly_revenue ?? null) };
      });
    rows.sort((a, b) => (a.payback - b.payback) || ((a.e.factorRate ?? 99) - (b.e.factorRate ?? 99)));
    return rows;
  }, [existing, deal.customer?.monthly_revenue]);
  const bestOfferLender = loggedOffers[0]?.lenderId;

  return (
    <div className="mt-4 rounded-lg border border-ocean-blue/40 bg-white dark:bg-gray-800 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <PaperAirplaneIcon className="w-4 h-4 text-ocean-blue" />
        <span className="text-sm font-semibold text-gray-900 dark:text-white">Submit to funders</span>
        <span className="text-[11px] text-gray-400">each funder gets your package in their format</span>
      </div>

      {/* An unread submissions check is NOT "nothing has been submitted". Say so
          loudly, because the rows below would otherwise all read as un-submitted
          and the next click would double-send to a funder who already has it. */}
      {existingErr && (
        <div className="rounded-md border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          <span className="font-bold">Couldn&apos;t read what&apos;s already been submitted.</span> The rows below
          can&apos;t be trusted to show &ldquo;already submitted&rdquo;, so sending is blocked — this is an unread
          check, <span className="font-bold">not</span> an empty one.
          <div className="mt-0.5 font-mono text-[11px] opacity-80">{existingErr}</div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-400">Scoring funders…</p>
      ) : matchesErr ? (
        <div className="rounded-md border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          <span className="font-bold">Couldn&apos;t read the funder network.</span> This is a failed read,{" "}
          <span className="font-bold">not</span> an empty network — nothing here says anything about which funders
          you have or whether this deal fits them.
          <div className="mt-0.5 font-mono text-[11px] opacity-80">{matchesErr}</div>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="mt-1.5 rounded border border-red-400 dark:border-red-700 px-2 py-0.5 text-[11px] font-medium hover:bg-red-100 dark:hover:bg-red-900/40"
          >
            Try again
          </button>
        </div>
      ) : matches.length === 0 ? (
        fallbackErr ? (
          <div className="rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
            <span className="font-bold">Funder scoring matched nothing, and the availability check didn&apos;t
            answer</span> — so this is <span className="font-bold">not</span> a finding that no funder suits this
            deal. Try again, or work from the availability panel above.
            <div className="mt-0.5 font-mono text-[11px] opacity-80">{fallbackErr}</div>
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              className="mt-1.5 rounded border border-amber-400 dark:border-amber-700 px-2 py-0.5 text-[11px] font-medium hover:bg-amber-100 dark:hover:bg-amber-900/40"
            >
              Try again
            </button>
          </div>
        ) : (
          <p className="text-sm text-gray-500">
            We read the funder network and none of it fits this deal. Check the availability panel above for which
            funders are live and what they&apos;re waiting on.
          </p>
        )
      ) : (
        <>
          {/* These rows did not come from the scorer. Say it plainly — a closer
              who thinks these are ranked matches will read the order as a
              recommendation, and there is no ranking here to read. */}
          {usedAvailability && (
            <div className="rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
              <span className="font-bold">Funder scoring returned nothing for this deal, so these are the funders
              the availability check says are live for it</span> — unranked, and in name order. You can still submit;
              check the availability panel above for what each one is waiting on.
            </div>
          )}
          {/* The ranking below was computed WITHOUT the ask, so nothing here has
              been checked against any funder's min/max funding box. Saying it is
              the difference between an incomplete ranking and a wrong one. */}
          {askWithheld && !usedAvailability && (
            <div className="rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
              <span className="font-bold">Ranked without the requested amount</span> — it&apos;s hidden because this
              deal isn&apos;t assigned to you, so <span className="font-bold">no funder here was checked against its
              minimum or maximum funding size</span>. A funder can look like a clean fit and still be outside its box.
              Confirm the amount with the assigned closer before you submit.
            </div>
          )}
          {/* Package check */}
          <div className="rounded-md bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 px-3 py-2 text-[11px]">
            <span className="font-medium text-gray-600 dark:text-gray-300">Package on file: </span>
            {CORE_STIPS.map((s) => (
              <span key={s} className={`inline-flex items-center gap-0.5 mr-2 ${docsPresent.has(s) ? "text-emerald-600" : "text-gray-400"}`}>
                {docsPresent.has(s) ? "✓" : "○"} {docLabel(s)}
              </span>
            ))}
          </div>

          {/* AI recommendation short-list (renders above the checkbox list) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={recommend}
                disabled={aiLoading}
                className="text-sm font-semibold px-3 py-1.5 rounded-lg border border-ocean-blue/50 text-ocean-blue hover:bg-ocean-blue/5 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
              >
                {aiLoading ? <ArrowPathIcon className="w-4 h-4 animate-spin" /> : <SparklesIcon className="w-4 h-4" />}
                {aiLoading
                  ? "Analyzing funders…"
                  : aiRan
                    ? "AI: re-run recommendations"
                    : aiWithheld
                      ? "AI: run your own analysis"
                      : "AI: recommend lenders"}
              </button>
              {aiError && <span className="text-[11px] text-red-600 dark:text-red-400 text-right flex-1">{aiError}</span>}
            </div>

            {/* The analysis is HIDDEN, not absent. Without this the button reads
                as "none has ever been run" and a closer pays for a second one. */}
            {aiWithheld && !aiRan && (
              <p className="rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-2.5 py-1.5 text-[11px] text-amber-800 dark:text-amber-200">
                <span className="font-bold">Any saved AI analysis is hidden</span> — this deal isn&apos;t assigned to
                you. <span className="font-bold">This does not mean none has been run.</span> Ask the assigned closer
                before paying for another; running one here costs a fresh analysis either way.
              </p>
            )}

            {(aiSummary || aiRecs.length > 0) && (
              <details className="rounded-lg border border-ocean-blue/30 bg-ocean-blue/5">
                {/* Accordion, closed by default — the checkbox list below already
                    reflects the AI (strong fits pre-checked); open for the why. */}
                <summary className="cursor-pointer select-none px-3 py-2 text-[12px] font-semibold text-ocean-blue">
                  ✨ AI analysis — {aiRecs.length} funder{aiRecs.length === 1 ? "" : "s"} ranked
                  {aiRecs.some((r) => r.fit === "strong" && isSelectable(r.lender_id)) ? " · strong fits pre-checked below" : ""} (click to expand)
                </summary>
                <div className="px-3 pb-3 space-y-2">
                  {aiSummary && <p className="text-[12px] text-gray-700 dark:text-gray-200">{aiSummary}</p>}
                  {/* Stated vs bank-verified revenue, side by side. The hard gate runs on
                      STATED; the verified column shows what funders will compute from the
                      statements — loud when they disagree. */}
                  {aiUw && aiUw.verified_monthly_revenue != null && (() => {
                    const fmt$ = (n: number | null) => (n == null ? "—" : `$${Math.round(n).toLocaleString()}`);
                    const bigDelta = aiUw.revenue_delta_pct != null && Math.abs(aiUw.revenue_delta_pct) >= 15;
                    return (
                      <div className={`rounded-md border px-3 py-2 text-[11px] ${bigDelta ? "border-amber-300 bg-amber-50 dark:bg-amber-900/20" : "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900"}`}>
                        <span className="font-semibold text-gray-800 dark:text-gray-100">📊 Revenue — stated vs bank-verified:</span>{" "}
                        <span className="text-gray-700 dark:text-gray-200">
                          stated <b>{fmt$(aiUw.stated_monthly_revenue)}/mo</b> · verified <b>{fmt$(aiUw.verified_monthly_revenue)}/mo</b>
                          {aiUw.revenue_delta_pct != null && (
                            <span className={bigDelta ? "text-amber-700 dark:text-amber-300 font-semibold" : ""}>
                              {" "}(stated {aiUw.revenue_delta_pct > 0 ? "+" : ""}{aiUw.revenue_delta_pct}% vs verified)
                            </span>
                          )}
                        </span>
                        <span className="block mt-0.5 text-gray-500 dark:text-gray-400">
                          From {aiUw.months_covered ?? "?"} mo of statements (underwriting v{aiUw.version})
                          {aiUw.nsf_total != null && ` · NSFs ${aiUw.nsf_total}`}
                          {aiUw.negative_days != null && ` · negative days ${aiUw.negative_days}`}
                          {aiUw.est_open_positions != null && ` · open positions ${aiUw.est_open_positions}`}
                          {aiUw.max_affordable_advance != null && ` · max affordable ${fmt$(aiUw.max_affordable_advance)}`}
                          {aiUw.risk_rating && ` · risk ${aiUw.risk_rating}`}
                          {" "}— each funder below shows BOTH verdicts.
                        </span>
                      </div>
                    );
                  })()}
                  {aiRecs.map((r) => {
                    const fit = FIT_STYLE[r.fit];
                    const checkable = isSelectable(r.lender_id);
                    // Say WHY a recommended funder can't be checked right now.
                    const blockReason = checkable ? null
                      : isAlreadyOut(r.lender_id) ? "already submitted"
                      : missingStipsOf(r.lender_id).length ? `blocked — missing: ${missingStipsOf(r.lender_id).map(docLabel).join(", ")}`
                      : methodOf(r.lender_id) === "none" ? "no submission email/portal on file"
                      : "not in the match list below";
                    return (
                      <details key={r.lender_id} className="rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm">
                        <summary className="cursor-pointer select-none px-3 py-2 flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-gray-900 dark:text-white">{r.lender_name}</span>
                          <span className={`inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full ${fit.cls}`}>{fit.label}</span>
                          {/* Ground-truth doc readiness (from recommend-lenders). */}
                          {/* Dual verdict when an underwriting run exists: stated vs verified. */}
                          {r.qualifiesVerified != null ? (
                            <>
                              <span className={`inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full ${r.qualifies !== false ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"}`} title={(r.disqualifiers ?? []).join("; ") || "Meets minimums on stated revenue"}>
                                stated {r.qualifies !== false ? "✓" : "✕"}
                              </span>
                              <span className={`inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full ${r.qualifiesVerified ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"}`} title={(r.disqualifiersVerified ?? []).join("; ") || "Meets minimums on bank-verified revenue"}>
                                verified {r.qualifiesVerified ? "✓" : "✕"}
                              </span>
                              {r.flip && (
                                <span className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 font-semibold">
                                  ⚠ flips on verified
                                </span>
                              )}
                            </>
                          ) : (
                            r.qualifies === false && (
                              <span className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" title={(r.disqualifiers ?? []).join("; ")}>
                                ✕ doesn't qualify
                              </span>
                            )
                          )}
                          {r.docsReady === true && r.qualifies !== false && (
                            <span className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">docs ready</span>
                          )}
                          {r.docsReady === false && (r.docsMissing?.length ?? 0) > 0 && (
                            <span className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">needs: {r.docsMissing!.join(", ")}</span>
                          )}
                          {r.fit === "strong" && checkable && <span className="text-[10px] text-emerald-600">auto-selected</span>}
                          {blockReason && <span className="text-[10px] text-amber-600">{blockReason}</span>}
                        </summary>
                        <div className="px-3 pb-2">
                          {r.reasons.length > 0 && (
                            <ul className="mt-1 list-disc pl-4 text-[11px] text-gray-600 dark:text-gray-300 space-y-0.5">
                              {r.reasons.map((s, i) => <li key={i}>{s}</li>)}
                            </ul>
                          )}
                          {(r.disqualifiers?.length ?? 0) > 0 && (
                            <ul className="mt-1 list-disc pl-4 text-[11px] text-rose-600 dark:text-rose-400 space-y-0.5">
                              {r.disqualifiers!.map((s, i) => <li key={i}>✕ {s} <span className="text-gray-400">(stated revenue)</span></li>)}
                            </ul>
                          )}
                          {(r.disqualifiersVerified?.length ?? 0) > 0 && (
                            <ul className="mt-1 list-disc pl-4 text-[11px] text-rose-600 dark:text-rose-400 space-y-0.5">
                              {r.disqualifiersVerified!.map((s, i) => <li key={i}>✕ {s} <span className="text-gray-400">(bank-verified revenue)</span></li>)}
                            </ul>
                          )}
                          {r.watch_outs.length > 0 && (
                            <ul className="mt-1 list-disc pl-4 text-[11px] text-amber-600 dark:text-amber-400 space-y-0.5">
                              {r.watch_outs.map((s, i) => <li key={i}>⚠ {s}</li>)}
                            </ul>
                          )}
                        </div>
                      </details>
                    );
                  })}
                  <p className="text-[10px] text-gray-400">AI suggestion only — review each funder's criteria before submitting. Strong fits are pre-checked below.</p>
                </div>
              </details>
            )}
          </div>

          {/* Pre-emptive block notice — the submit-to-funders engine hard-rejects
              a fan-out when the signed application isn't attached app-side, so say
              so BEFORE the click (not after). Loud red when it's signed in GHL and
              just needs uploading; softer red when it isn't signed yet. */}
          {/* The FIX lives in the same box as the block. This banner used to point
              at "the slot below" — which only rendered when GHL showed the doc as
              signed, so in the commonest blocked state there was no upload control
              on the page at all. The banner IS the slot now. */}
          {!signedAppInApp && (
            <div className="rounded-md border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/20 px-3 py-2 space-y-2">
              <div className="flex items-start gap-2 text-[12px] text-rose-700 dark:text-rose-300">
                <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>
                  <span className="font-semibold">Submissions blocked</span> — the signed application isn't attached in the system.{" "}
                  {signedAppInGhl
                    ? "It's signed in GHL — download it once and upload it right here."
                    : "Nothing goes out to funders until it's on file. Have the signed PDF (e-signed, or scanned from email)? Upload it right here."}
                </span>
              </div>
              {signedAppInGhl && (
                <a
                  href={GHL_COMPLETED_DOCS_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-ocean-blue hover:underline inline-flex items-center gap-1"
                >
                  Open GHL → Documents &amp; Contracts (Completed) <ArrowTopRightOnSquareIcon className="w-3 h-3" />
                </a>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => { setSignedAppFile(e.target.files?.[0] ?? null); setUploadAppError(null); }}
                  className="text-[11px] text-gray-600 dark:text-gray-300 file:mr-2 file:rounded file:border-0 file:bg-ocean-blue/10 file:px-2 file:py-1 file:text-ocean-blue"
                />
                <button
                  type="button"
                  disabled={!signedAppFile || uploadingApp}
                  onClick={uploadSignedApp}
                  className="text-[11px] font-semibold px-2 py-1 rounded border border-ocean-blue/50 text-ocean-blue hover:bg-ocean-blue/5 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1"
                >
                  {uploadingApp ? <ArrowPathIcon className="w-3 h-3 animate-spin" /> : <DocumentArrowUpIcon className="w-3 h-3" />}
                  {uploadingApp ? "Uploading…" : "Upload signed application — unblocks submissions"}
                </button>
              </div>
              {uploadAppError && <p className="text-[11px] text-red-600 dark:text-red-400">{uploadAppError}</p>}
            </div>
          )}

          {/* Funder checkboxes */}
          <div className="space-y-1.5">
            {primary.map(renderRow)}
            {secondary.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setShowMisfits((v) => !v)}
                  className="text-[11px] text-ocean-blue hover:underline"
                >
                  {showMisfits ? "Hide" : `Show ${secondary.length}`} lower-match funder{secondary.length === 1 ? "" : "s"}
                </button>
                {showMisfits && secondary.map(renderRow)}
              </>
            )}
          </div>

          {/* Signed-application status — the upload lives in the blocked banner
              above; this is only the green all-clear once it's on file. */}
          {signedAppInApp && (
            <div className="rounded-md border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-2 text-[12px] text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1.5">
              <CheckCircleIcon className="w-4 h-4 flex-shrink-0" />
              Signed application on file — attaches to every submission.
            </div>
          )}

          {/* Offers compare strip — side-by-side once ≥1 offer is logged, best
              economics (cheapest payback) highlighted. Accept/decline here don't
              move the deal stage; that stays on the step button. */}
          {loggedOffers.length > 0 && (
            <div className="rounded-lg border border-ocean-blue/30 bg-ocean-blue/5 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <TrophyIcon className="w-4 h-4 text-emerald-500" />
                <span className="text-[12px] font-semibold text-gray-900 dark:text-white">Offers — {loggedOffers.length} logged</span>
                <span className="text-[10px] text-gray-400">ranked by total payback (cheapest for the merchant first)</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {loggedOffers.map(({ lenderId, e, freq, payment, payback, b }) => {
                  const isBest = lenderId === bestOfferLender;
                  const accepted = e.status === "offer_accepted";
                  const declined = e.status === "offer_declined";
                  const busy = rowBusy === lenderId;
                  return (
                    <div key={lenderId} className={`rounded-md border p-2.5 text-[11px] space-y-1.5 ${isBest ? "border-emerald-400 bg-emerald-50/70 dark:bg-emerald-900/15" : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"} ${declined ? "opacity-50" : ""}`}>
                      <div className="flex items-center gap-1 flex-wrap">
                        {isBest && <TrophyIcon className="w-3.5 h-3.5 text-emerald-500" />}
                        <span className="font-semibold text-gray-900 dark:text-white">{nameOf(lenderId)}</span>
                        {isBest && <span className="text-[9px] uppercase tracking-wide text-emerald-600 font-semibold">best value</span>}
                        {accepted && <span className="text-[9px] uppercase tracking-wide text-emerald-700 font-semibold">accepted</span>}
                        {declined && <span className="text-[9px] uppercase tracking-wide text-rose-600 font-semibold">declined</span>}
                      </div>
                      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-gray-600 dark:text-gray-300">
                        <span className="text-gray-400">Amount</span><span className="text-right font-medium">{money(e.offerAmount)}</span>
                        <span className="text-gray-400">Factor</span><span className="text-right">{e.factorRate}x</span>
                        <span className="text-gray-400">Payback</span><span className="text-right font-medium">{money(payback)}</span>
                        {payment != null && <><span className="text-gray-400">Payment</span><span className="text-right">{money(payment)}/{freq === "weekly" ? "wk" : "day"}</span></>}
                        {e.termMonths != null && <><span className="text-gray-400">Term</span><span className="text-right">{e.termMonths} mo</span></>}
                      </div>
                      {b?.pct != null && (
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full font-medium ${b.hot ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"}`}>
                          {b.pct.toFixed(0)}% of monthly revenue{b.hot ? " ⚠" : ""}
                        </span>
                      )}
                      {!accepted && !declined && (
                        <div className="flex items-center gap-1.5 pt-0.5">
                          <button type="button" disabled={busy} onClick={() => setOfferOutcome(lenderId, "offer_accepted")} className="text-[10px] font-semibold px-2 py-1 rounded bg-emerald-600 text-white hover:opacity-90 disabled:opacity-50">Mark accepted</button>
                          <button type="button" disabled={busy} onClick={() => setOfferOutcome(lenderId, "offer_declined")} className="text-[10px] font-semibold px-2 py-1 rounded border border-rose-300 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 disabled:opacity-50">Declined by merchant</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {acceptedHint && (
                <p className="text-[11px] text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 rounded px-2 py-1.5">
                  Offer accepted. Now advance the deal: <span className="font-medium">Offer Received → Offer Presented → Accepted</span> via the step buttons below — the stage move stays manual on purpose.
                </p>
              )}
            </div>
          )}

          {/* Package contents — pick exactly which documents ride with this
              submission. Standard package pre-checked; extras opt-in. GHL-side
              merchant uploads (bank statements, stips) still ride automatically. */}
          {inventory.length > 0 && (
            <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 py-2 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">Package contents</span>
                <span className="text-[10px] text-gray-400">{selectedDocIds.size} doc{selectedDocIds.size === 1 ? "" : "s"} selected</span>
              </div>
              <div className="space-y-1">
                {inventory.map((d) => (
                  <label key={d.id} className="flex items-center gap-2 text-[11px] cursor-pointer">
                    <input
                      type="checkbox"
                      className="w-3.5 h-3.5 text-ocean-blue rounded border-gray-300 focus:ring-ocean-blue"
                      checked={selectedDocIds.has(d.id)}
                      onChange={() => toggleDoc(d.id)}
                    />
                    <span className="text-gray-700 dark:text-gray-200 flex-shrink-0">{docLabel(d.document_type)}</span>
                    {d.filename && <span className="text-gray-400 truncate">— {d.filename}</span>}
                  </label>
                ))}
              </div>
              {inventory.some((d) => d.document_type === "other") && (
                <p className="text-[10px] text-amber-600 dark:text-amber-400">
                  ⚠ Unidentified docs on file — check the Documents popup to confirm what they are.
                </p>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                disabled={submitting || previewLoading || selected.size === 0}
                title="See (and edit) exactly what each funder will receive before anything sends"
                onClick={openPreview}
                className="text-sm font-semibold px-4 py-2 rounded-lg border border-ocean-blue/50 text-ocean-blue hover:bg-ocean-blue/5 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
              >
                {previewLoading ? <ArrowPathIcon className="w-4 h-4 animate-spin" /> : <EyeIcon className="w-4 h-4" />}
                {previewLoading ? "Rendering…" : `👁 Preview emails${selected.size ? ` (${selected.size})` : ""}`}
              </button>
              <button
                type="button"
                disabled={submitting || selected.size === 0 || !signedAppInApp || !!existingErr}
                title={existingErr ? "Blocked — we can't read what's already been submitted to these funders" : !signedAppInApp ? "Upload the signed application first — it must attach to every submission" : undefined}
                onClick={() => submit([...selected])}
                className="text-sm font-semibold px-4 py-2 rounded-lg bg-ocean-blue text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
              >
                {submitting ? <ArrowPathIcon className="w-4 h-4 animate-spin" /> : <PaperAirplaneIcon className="w-4 h-4" />}
                {submitting ? "Sending…" : !signedAppInApp ? "Upload the signed application to submit" : `Submit to ${selected.size || 0} selected`}
              </button>
            </div>
            {(error || previewError) && <span className="text-[11px] text-amber-600 dark:text-amber-400 text-right flex-1">{error || previewError}</span>}
          </div>

          {/* Live results */}
          {resultRows.length > 0 && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-3 space-y-2">
              {resultRows.map((r) => (
                <div key={r.lenderId} className="text-sm">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-900 dark:text-white">{r.name}</span>
                    {r.status === "sent" && <span className="text-emerald-600 inline-flex items-center gap-1"><CheckCircleIcon className="w-4 h-4" /> Sent</span>}
                    {r.status === "send_failed" && <span className="text-red-600 inline-flex items-center gap-1"><ExclamationTriangleIcon className="w-4 h-4" /> Send failed</span>}
                    {r.status === "portal_pending" && <span className="text-purple-600 inline-flex items-center gap-1"><GlobeAltIcon className="w-4 h-4" /> Portal — action needed</span>}
                    {r.status === "portal_confirmed" && <span className="text-emerald-600 inline-flex items-center gap-1"><CheckCircleIcon className="w-4 h-4" /> Portal submitted</span>}
                    {r.status === "blocked" && <span className="text-amber-600 inline-flex items-center gap-1"><ExclamationTriangleIcon className="w-4 h-4" /> Blocked</span>}
                    {r.status === "already_submitted" && <span className="text-gray-500">Already submitted</span>}
                    {(r.status === "sent" || r.status === "send_failed") && r.submissionId && (
                      <button type="button" onClick={() => viewPayload(r)} className="text-[11px] text-ocean-blue hover:underline">view payload</button>
                    )}
                    {r.status === "send_failed" && (
                      <button type="button" onClick={() => submit([r.lenderId], true)} className="text-[11px] text-ocean-blue hover:underline">retry</button>
                    )}
                  </div>
                  {r.error && <p className="text-[11px] text-red-500 mt-0.5">{r.error}</p>}
                  {r.warning && <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">⚠ {r.warning}</p>}
                  {r.status === "blocked" && (
                    <p className="text-[11px] text-amber-600 mt-0.5">missing: {(r.blockedLabels ?? r.blocked ?? []).join(", ")}</p>
                  )}
                  {r.status === "portal_pending" && r.portal && (
                    <div className="mt-1 ml-1 pl-3 border-l-2 border-purple-200 dark:border-purple-800 space-y-1">
                      {r.portal.url && (
                        <a href={r.portal.url.startsWith("http") ? r.portal.url : `https://${r.portal.url}`} target="_blank" rel="noreferrer" className="text-[11px] text-ocean-blue hover:underline inline-flex items-center gap-1">
                          Open portal <ArrowTopRightOnSquareIcon className="w-3 h-3" />
                        </a>
                      )}
                      {r.portal.hint && <p className="text-[11px] text-gray-400">{r.portal.hint}</p>}
                      {r.portal.steps.length > 0 && (
                        <ol className="list-decimal pl-4 text-[11px] text-gray-600 dark:text-gray-300">
                          {r.portal.steps.map((s, i) => <li key={i}>{s}</li>)}
                        </ol>
                      )}
                      <button
                        type="button"
                        onClick={() => markPortalSubmitted(r)}
                        className="mt-1 text-[11px] font-semibold px-2 py-1 rounded border border-purple-300 text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-900/20"
                      >
                        Mark submitted
                      </button>
                    </div>
                  )}
                  {payloadOpen[r.lenderId] !== undefined && (
                    <pre className="mt-1 max-h-40 overflow-auto rounded bg-gray-900 text-gray-100 text-[10px] p-2">
                      {JSON.stringify(payloadOpen[r.lenderId], null, 2)}
                    </pre>
                  )}
                </div>
              ))}
              <p className="text-[11px] text-gray-400 pt-1">
                Sent? Now hit the step's button below to advance the deal to Submitted — the fan-out and the stage move are kept separate on purpose.
              </p>
            </div>
          )}
        </>
      )}

      {/* Preview + edit modal — one section per selected funder, showing exactly
          what the engine will send (server-rendered; the same code path the real
          send runs). Subject/body are editable per funder; the attachments list
          shows the server's real attach-vs-link decision. No browser popups. */}
      {previewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !submitting && setPreviewOpen(false)}>
          <div className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-lg bg-white dark:bg-gray-800 shadow-xl border border-gray-200 dark:border-gray-700" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
              <span className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <EyeIcon className="w-4 h-4 text-ocean-blue" /> Preview funder emails — {previews.length} funder{previews.length === 1 ? "" : "s"}
              </span>
              <button type="button" onClick={() => !submitting && setPreviewOpen(false)} className="text-gray-400 hover:text-gray-600">
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                Edit any funder's subject or body below — changes apply to <span className="font-semibold">this submission only</span> and never touch the saved recipe. Attachments are decided by the funder's recipe.
              </p>

              {previews.map((p) => {
                const e = edits[p.lenderId] ?? { subject: "", body: "" };
                const badge = methodBadge(p.method);
                const edited = isPreviewEdited(p.lenderId);
                return (
                  <div key={p.lenderId} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40">
                    <div className="flex items-center gap-2 flex-wrap px-3 py-2 border-b border-gray-200 dark:border-gray-700">
                      <span className="font-semibold text-gray-900 dark:text-white text-sm">{p.name}</span>
                      <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full ${badge.cls}`}>
                        <badge.icon className="w-3 h-3" /> {badge.label}
                      </span>
                      {edited && <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">edited</span>}
                    </div>

                    {/* Standing instructions from this funder, ABOVE the three-way
                        branch so they render whatever else is going on — a funder
                        short a stip AND pointing at a retired inbox has two
                        independent reasons not to send, and the first must not
                        hide the second. */}
                    <div className="px-3 pt-2.5"><DirectiveNotice p={p} /></div>

                    {/* Blocked funder — no email, show the reason instead. */}
                    {p.blocked ? (
                      <div className="px-3 py-3 text-[12px] text-amber-700 dark:text-amber-300 inline-flex items-start gap-1.5">
                        <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        <span>
                          Blocked — missing: {(p.blockedLabels ?? p.blocked).join(", ")}. Nothing will be sent to this funder.
                          {ghlDocsError && (
                            <>
                              {" "}
                              <span className="font-bold underline decoration-2">
                                We could not read VibeReach ({ghlDocsError}), so this "missing" was worked out without seeing
                                anything the merchant uploaded there — check before you chase him for it.
                              </span>
                            </>
                          )}
                        </span>
                      </div>
                    ) : p.isPortalOnly ? (
                      /* Portal-only funder — no email is sent. */
                      <div className="px-3 py-3 space-y-1.5">
                        <p className="text-[12px] font-medium text-purple-700 dark:text-purple-300 inline-flex items-center gap-1.5">
                          <GlobeAltIcon className="w-4 h-4" /> Portal submission — no email is sent to this funder.
                        </p>
                        {p.portal?.url && (
                          <a href={p.portal.url.startsWith("http") ? p.portal.url : `https://${p.portal.url}`} target="_blank" rel="noreferrer" className="text-[11px] text-ocean-blue hover:underline inline-flex items-center gap-1">
                            {p.portal.url} <ArrowTopRightOnSquareIcon className="w-3 h-3" />
                          </a>
                        )}
                        {p.portal?.hint && <p className="text-[11px] text-gray-400">{p.portal.hint}</p>}
                        {(p.portal?.steps?.length ?? 0) > 0 && (
                          <ol className="list-decimal pl-4 text-[11px] text-gray-600 dark:text-gray-300">
                            {p.portal!.steps.map((s, i) => <li key={i}>{s}</li>)}
                          </ol>
                        )}
                      </div>
                    ) : (
                      <div className="px-3 py-3 space-y-2">
                        {/* To + CC — read-only */}
                        <div className="text-[11px] text-gray-600 dark:text-gray-300 space-y-0.5">
                          <div><span className="text-gray-400">To</span> <span className="font-medium text-gray-900 dark:text-white">{p.to || "— no email on file —"}</span></div>
                          {(p.cc?.length ?? 0) > 0 && <div><span className="text-gray-400">CC</span> <span className="text-gray-700 dark:text-gray-200">{p.cc!.join(", ")}</span></div>}
                        </div>

                        {/* Editable subject */}
                        <label className="block text-[11px] font-medium text-gray-500">Subject
                          <input
                            type="text"
                            value={e.subject}
                            onChange={(ev) => setEdits((prev) => ({ ...prev, [p.lenderId]: { ...prev[p.lenderId], subject: ev.target.value } }))}
                            className="mt-1 w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1.5 text-[13px] text-gray-900 dark:text-white"
                          />
                        </label>

                        {/* Editable body — monospace + tall */}
                        <label className="block text-[11px] font-medium text-gray-500">Body
                          <textarea
                            value={e.body}
                            onChange={(ev) => setEdits((prev) => ({ ...prev, [p.lenderId]: { ...prev[p.lenderId], body: ev.target.value } }))}
                            rows={14}
                            className="mt-1 w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1.5 text-[12px] font-mono text-gray-900 dark:text-white resize-y"
                          />
                        </label>

                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <button
                            type="button"
                            disabled={!edited}
                            onClick={() => resetPreview(p.lenderId)}
                            className="text-[11px] font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
                          >
                            <ArrowUturnLeftIcon className="w-3.5 h-3.5" /> Reset to template
                          </button>
                        </div>

                        {/* Attachments — server's real attach-vs-link decision */}
                        <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2.5 py-2">
                          <p className="text-[11px] font-medium text-gray-500 mb-1">Documents ({p.docs?.length ?? 0})</p>
                          {(p.docs?.length ?? 0) === 0 ? (
                            <p className="text-[11px] text-gray-400">No documents will ride with this email.</p>
                          ) : (
                            <ul className="space-y-1">
                              {p.docs!.map((d, i) => (
                                <li key={i} className="flex items-center gap-2 text-[11px] text-gray-700 dark:text-gray-200">
                                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${d.delivery === "attached" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"}`}>
                                    {d.delivery === "attached" ? <><PaperClipIcon className="w-3 h-3" /> attached</> : <><LinkIcon className="w-3 h-3" /> link</>}
                                  </span>
                                  <span className="font-medium">{d.label}</span>
                                  <span className="text-gray-400 truncate">— {d.filename}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                          {p.docsWarning && <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">⚠ {p.docsWarning}</p>}
                        </div>

                        {p.method === "email_and_portal" && p.portal?.url && (
                          <p className="text-[11px] text-purple-600 dark:text-purple-300 inline-flex items-center gap-1">
                            <GlobeAltIcon className="w-3.5 h-3.5" /> This funder also has a portal step after the email.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Footer — armed two-step send (fires the real submit with edits) */}
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex-shrink-0 flex-wrap">
              <span className="text-[11px] text-gray-500 dark:text-gray-400">
                {previewSendable.length} email{previewSendable.length === 1 ? "" : "s"}
                {previewPortalOnly.length > 0 ? ` · ${previewPortalOnly.length} portal` : ""}
                {!signedAppInApp && <span className="text-rose-500"> · upload the signed application first</span>}
              </span>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => { setPreviewOpen(false); setArmedSend(false); }} className="text-[12px] text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 inline-flex items-center gap-1">
                  <XMarkIcon className="w-4 h-4" /> Cancel
                </button>
                <button
                  type="button"
                  disabled={submitting || previewSendCount === 0 || !signedAppInApp || !!existingErr}
                  onClick={() => { if (armedSend) void sendFromPreview(); else setArmedSend(true); }}
                  className={`text-sm font-semibold px-4 py-2 rounded-lg text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2 ${armedSend ? "bg-amber-600" : "bg-ocean-blue"}`}
                >
                  {submitting ? <ArrowPathIcon className="w-4 h-4 animate-spin" /> : <PaperAirplaneIcon className="w-4 h-4" />}
                  {submitting ? "Sending…" : armedSend ? `⚠️ Tap again to send to ${previewSendCount} funder${previewSendCount === 1 ? "" : "s"} →` : `Send to ${previewSendCount} funder${previewSendCount === 1 ? "" : "s"}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
