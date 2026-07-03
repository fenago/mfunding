// FunderPicker — the one-click "submit to funders" box that lives on Revenue
// Playbook Step 6 (Submitted to Funder). The closer sees the funders scored
// against THIS deal, checks the ones to send to, and hits Submit — the
// submit-to-funders engine then emails each funder in its own recipe format
// (or returns a guided portal flow for portal-only funders). Results render
// live per funder. Stage advancement stays on the step's own button so a
// partial fan-out never strands the deal.
import { useEffect, useMemo, useState } from "react";
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
} from "@heroicons/react/24/outline";
import { TrophyIcon } from "@heroicons/react/24/solid";
import supabase from "../../supabase";
import { useSession } from "../../context/SessionContext";
import { getMatchingLenders } from "../../services/lenderMatchingService";
import { updateSubmission } from "../../services/dealService";
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
}

interface ProfileMeta {
  method: Exclude<Method, "none">;
  required_stips: string[];
  to_email: string | null;
}

type Fit = "strong" | "possible" | "poor";
interface AiRec {
  lender_id: string;
  lender_name: string;
  fit: Fit;
  reasons: string[];
  watch_outs: string[];
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
  const [profiles, setProfiles] = useState<Record<string, ProfileMeta>>({});
  const [lenderDest, setLenderDest] = useState<Record<string, { email: string | null; portal: string | null }>>({});
  // App-side (Supabase customer_documents) and GHL-side doc types are tracked
  // SEPARATELY: the stips guard uses the union (docsPresent), but the signed-app
  // slot needs to know whether the signed application lives app-side (attaches
  // automatically) vs only in GHL (must be downloaded + re-uploaded here).
  const [appDocs, setAppDocs] = useState<Set<string>>(new Set());
  const [ghlDocs, setGhlDocs] = useState<Set<string>>(new Set());
  // Signed-application upload slot.
  const [signedAppFile, setSignedAppFile] = useState<File | null>(null);
  const [uploadingApp, setUploadingApp] = useState(false);
  const [uploadAppError, setUploadAppError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Record<string, FunderResult>>({});
  const [existing, setExisting] = useState<Record<string, ExistingSub>>({});
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
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiRan, setAiRan] = useState(false);

  // Rehydrate persisted AI analysis (saved on the deal by recommend-lenders)
  // so a page reload never throws away paid tokens.
  useEffect(() => {
    const saved = deal.ai_lender_recommendations as { summary?: string; recommendations?: AiRec[] } | null;
    if (saved && (saved.recommendations?.length || saved.summary)) {
      setAiRecs((saved.recommendations ?? []) as AiRec[]);
      setAiSummary(saved.summary ?? "");
      setAiRan(true);
    }
  }, [deal.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const m = await getMatchingLenders({
          deal_type: deal.deal_type,
          amount_requested: deal.amount_requested,
          monthly_revenue: deal.customer?.monthly_revenue ?? null,
          time_in_business: deal.customer?.time_in_business ?? null,
          industry: deal.customer?.industry ?? null,
        });
        const ids = m.map((x) => x.id);
        const [profRes, lendRes, docRes, subRes] = await Promise.all([
          ids.length ? supabase.from("funder_submission_profiles").select("lender_id, method, required_stips, to_email").in("lender_id", ids) : Promise.resolve({ data: [] }),
          ids.length ? supabase.from("lenders").select("id, submission_email, submission_portal_url").in("id", ids) : Promise.resolve({ data: [] }),
          deal.customer_id ? supabase.from("customer_documents").select("document_type").eq("customer_id", deal.customer_id) : Promise.resolve({ data: [] }),
          supabase.from("deal_submissions").select("id, lender_id, status, submission_method, error, portal_confirmed_at, response_at, offer_amount, factor_rate, term_months, daily_payment, weekly_payment, total_payback, decline_reason").eq("deal_id", deal.id),
        ]);
        if (cancelled) return;
        setMatches(m.map((x) => ({ id: x.id, company_name: x.company_name, score: x.score, reasons: x.reasons })));
        const pmap: Record<string, ProfileMeta> = {};
        for (const p of (profRes.data ?? []) as { lender_id: string; method: ProfileMeta["method"]; required_stips: string[] | null; to_email: string | null }[]) {
          pmap[p.lender_id] = { method: p.method, required_stips: p.required_stips ?? [], to_email: p.to_email };
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
        const appPresent = new Set(((docRes.data ?? []) as { document_type: string }[]).map((d) => d.document_type));
        const ghlPresent = new Set<string>();
        if (deal.ghl_contact_id) {
          try {
            const { data: ghl } = await supabase.functions.invoke("ghl-docs-status", {
              body: { ghl_contact_id: deal.ghl_contact_id },
            });
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
          } catch { /* GHL peek is best-effort; app docs still count */ }
        }
        if (!cancelled) { setAppDocs(appPresent); setGhlDocs(ghlPresent); }
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
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load funders");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [deal.id, deal.customer_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Union of both rails — this is what the stips guard reads (unchanged behavior).
  const docsPresent = useMemo(() => new Set<string>([...appDocs, ...ghlDocs]), [appDocs, ghlDocs]);
  const signedAppInApp = appDocs.has("application");
  const signedAppInGhl = ghlDocs.has("application");

  // Re-read app-side customer_documents after an upload so the slot flips to ✅
  // and any per-funder "forward the signed application" warning goes moot.
  async function reloadAppDocs() {
    if (!deal.customer_id) return;
    const { data } = await supabase.from("customer_documents").select("document_type").eq("customer_id", deal.customer_id);
    setAppDocs(new Set(((data ?? []) as { document_type: string }[]).map((d) => d.document_type)));
  }

  // Upload the signed application PDF the closer downloaded from GHL. Mirrors the
  // shared DocumentUploader conventions exactly: same bucket, same path shape,
  // same customer_documents insert — so the submit-to-funders engine picks it up
  // automatically and attaches it (as an expiring link) to every funder.
  async function uploadSignedApp() {
    const file = signedAppFile;
    if (!file || !deal.customer_id) return;
    setUploadingApp(true);
    setUploadAppError(null);
    try {
      const ext = file.name.split(".").pop();
      const path = `customer/${deal.customer_id}/${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;
      const { error: upErr } = await supabase.storage.from("customer-documents").upload(path, file, {
        cacheControl: "3600",
        upsert: false,
      });
      if (upErr) throw upErr;
      const { error: dbErr } = await supabase.from("customer_documents").insert({
        document_type: "application",
        filename: file.name,
        storage_path: path,
        file_size: file.size,
        mime_type: file.type,
        uploaded_by: session?.user?.id,
        customer_id: deal.customer_id,
      });
      if (dbErr) throw dbErr;
      setSignedAppFile(null);
      await reloadAppDocs();
    } catch (e) {
      setUploadAppError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploadingApp(false);
    }
  }

  const methodOf = (lenderId: string): Method => {
    const p = profiles[lenderId];
    if (p) return p.method;
    const d = lenderDest[lenderId];
    if (d?.email) return "email";
    if (d?.portal) return "portal";
    return "none";
  };
  const missingStipsOf = (lenderId: string): string[] =>
    (profiles[lenderId]?.required_stips ?? []).filter((s) => !docsPresent.has(s));

  // An existing active (non-failed) submission means "already went out".
  const isAlreadyOut = (lenderId: string) => {
    const e = existing[lenderId];
    if (!e) return false;
    if (results[lenderId]) return false; // a fresh action supersedes the stale row
    return !e.hasError && e.status !== "withdrawn" && e.status !== "pending";
  };

  const { primary, secondary } = useMemo(() => {
    const p: Match[] = [], s: Match[] = [];
    for (const m of matches) (m.score >= 40 ? p : s).push(m);
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

  async function submit(ids: string[], resubmit = false) {
    if (ids.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("submit-to-funders", {
        body: { dealId: deal.id, lenderIds: ids, resubmit },
      });
      if (fnErr) throw fnErr;
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

  // A lender the closer can actually check right now: it's in the scored list,
  // has a destination, isn't missing stips, and hasn't already gone out.
  function isSelectable(lenderId: string): boolean {
    if (!matches.some((m) => m.id === lenderId)) return false;
    return methodOf(lenderId) !== "none" && missingStipsOf(lenderId).length === 0 && !isAlreadyOut(lenderId);
  }

  async function recommend() {
    setAiLoading(true);
    setAiError(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("recommend-lenders", {
        body: { deal_id: deal.id },
      });
      if (fnErr) throw fnErr;
      if (data?.error) throw new Error(data.error);
      const recs = (data?.recommendations ?? []) as AiRec[];
      setAiSummary(typeof data?.summary === "string" ? data.summary : "");
      setAiRecs(recs);
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
    const { error: upErr } = await supabase
      .from("deal_submissions")
      .update({ status: "submitted", submitted_at: nowIso, portal_confirmed_at: nowIso })
      .eq("id", r.submissionId);
    if (upErr) { setError(`Could not mark submitted: ${upErr.message}`); return; }
    setResults((prev) => ({ ...prev, [r.lenderId]: { ...r, status: "portal_confirmed" } }));
  }

  async function viewPayload(r: FunderResult) {
    if (!r.submissionId) return;
    if (payloadOpen[r.lenderId] !== undefined) {
      setPayloadOpen((p) => { const n = { ...p }; delete n[r.lenderId]; return n; });
      return;
    }
    const { data } = await supabase.from("deal_submissions").select("sent_payload").eq("id", r.submissionId).maybeSingle();
    setPayloadOpen((p) => ({ ...p, [r.lenderId]: data?.sent_payload ?? null }));
  }

  const nameOf = (lenderId: string) => matches.find((m) => m.id === lenderId)?.company_name ?? "Funder";

  // Best-effort activity trail entry against this deal — mirrors useActivityLog's
  // insert shape so it shows up in the deal's Activity tab.
  async function logActivity(interaction_type: string, subject: string, content: string, newStatus?: string) {
    try {
      await supabase.from("activity_log").insert({
        entity_type: "deal", entity_id: deal.id,
        interaction_type, subject, content,
        new_status: newStatus ?? null,
        logged_by: session?.user?.id ?? null,
      });
    } catch { /* the trail is nice-to-have; never block the offer save on it */ }
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
    const alreadyOut = isAlreadyOut(m.id);
    const noDest = method === "none";
    const disabled = noDest || missing.length > 0 || alreadyOut;
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
          {noDest && <span className="block text-[11px] text-gray-400 mt-0.5">no submission email or portal on file</span>}
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

      {loading ? (
        <p className="text-sm text-gray-400">Scoring funders…</p>
      ) : matches.length === 0 ? (
        <p className="text-sm text-gray-500">No matching funders. Add funders to your network (Admin → Lenders) first.</p>
      ) : (
        <>
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
                {aiLoading ? "Analyzing funders…" : aiRan ? "AI: re-run recommendations" : "AI: recommend lenders"}
              </button>
              {aiError && <span className="text-[11px] text-red-600 dark:text-red-400 text-right flex-1">{aiError}</span>}
            </div>

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
                          {r.fit === "strong" && checkable && <span className="text-[10px] text-emerald-600">auto-selected</span>}
                          {blockReason && <span className="text-[10px] text-amber-600">{blockReason}</span>}
                        </summary>
                        <div className="px-3 pb-2">
                          {r.reasons.length > 0 && (
                            <ul className="mt-1 list-disc pl-4 text-[11px] text-gray-600 dark:text-gray-300 space-y-0.5">
                              {r.reasons.map((s, i) => <li key={i}>{s}</li>)}
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

          {/* Signed application slot — download the signed PDF from GHL once, drop
              it here, and the engine attaches it to every funder submission. */}
          {signedAppInApp ? (
            <div className="rounded-md border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-2 text-[12px] text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1.5">
              <CheckCircleIcon className="w-4 h-4 flex-shrink-0" />
              Signed application on file — attaches to every submission.
            </div>
          ) : signedAppInGhl ? (
            <div className="rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 space-y-2">
              <p className="text-[12px] text-amber-700 dark:text-amber-300">
                Signed in GHL — download it once and drop it here so it attaches to every funder submission.
              </p>
              <a
                href={GHL_COMPLETED_DOCS_URL}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-ocean-blue hover:underline inline-flex items-center gap-1"
              >
                Open GHL → Documents &amp; Contracts (Completed) <ArrowTopRightOnSquareIcon className="w-3 h-3" />
              </a>
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
                  {uploadingApp ? "Uploading…" : "Upload signed application"}
                </button>
              </div>
              {uploadAppError && <p className="text-[11px] text-red-600 dark:text-red-400">{uploadAppError}</p>}
            </div>
          ) : (
            <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 py-2 text-[12px] text-gray-400">
              No signed application yet.
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

          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              disabled={submitting || selected.size === 0 || !signedAppInApp}
              title={!signedAppInApp ? "Upload the signed application first — it must attach to every submission" : undefined}
              onClick={() => submit([...selected])}
              className="text-sm font-semibold px-4 py-2 rounded-lg bg-ocean-blue text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
            >
              {submitting ? <ArrowPathIcon className="w-4 h-4 animate-spin" /> : <PaperAirplaneIcon className="w-4 h-4" />}
              {submitting ? "Sending…" : !signedAppInApp ? "Upload the signed application to submit" : `Submit to ${selected.size || 0} selected`}
            </button>
            {error && <span className="text-[11px] text-amber-600 dark:text-amber-400 text-right flex-1">{error}</span>}
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
    </div>
  );
}
