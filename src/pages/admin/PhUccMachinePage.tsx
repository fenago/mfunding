import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RectangleStackIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  BoltIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  NoSymbolIcon,
  ClockIcon,
  MapIcon,
  ArrowDownTrayIcon,
  TrashIcon,
  BanknotesIcon,
  Cog6ToothIcon,
  ChevronDownIcon,
} from "@heroicons/react/24/outline";
import supabase from "@/supabase";
import { mustWrite } from "@/supabase/writes";
import { getSetting, saveSetting } from "@/services/platformService";
import { useUserProfile } from "@/context/UserProfileContext";

/* ------------------------------------------------------------------ */
/* PH — UCC Machine                                                    */
/* Internal dashboard for the outbound UCC lead engine: per-state      */
/* source health, the ingest→ready→loaded funnel, a ranked lead        */
/* browser, the funder-alias matcher dictionary, and freshness SLA.    */
/*                                                                     */
/* Built against the ph-ucc-machine backend contract (tables          */
/* ph_ucc_sources / ph_ucc_filings / ph_ucc_funder_aliases /          */
/* ph_ucc_leads; edge fn ph-ucc-ingest). Every query degrades to a    */
/* "backend not deployed yet" state when a table is missing, so this  */
/* page is safe to ship ahead of the backend.                         */
/*                                                                     */
/* Compliance: this is an internal surface, but still never "loan" —   */
/* MCA positions are "advances" / "funding".                          */
/* ------------------------------------------------------------------ */

/* ── Backend contract (mirror of ph-ucc-machine's schema) ── */
type SourceStatus = "active" | "awaiting_purchase" | "error" | "unusable";
interface UccSource {
  id: string;
  state: string; // 2-letter
  status: SourceStatus;
  last_pull_at: string | null;
  rows_ingested: number | null;
  cadence: string | null; // human label e.g. "weekly"
  newest_filing_date: string | null; // for freshness
  error_note?: string | null;
}

type LeadStatus =
  | "matched"
  | "needs_skiptrace"
  | "needs_scrub"
  | "ready"
  | "loaded"
  | "suppressed"
  | "email_only" // traced: only DNC phones, but has an email — terminal off-ramp
  | "no_match"; // traced: no usable phone, no email — terminal off-ramp
interface UccLead {
  id: string;
  debtor_name: string | null;
  state: string | null;
  matched_funders: string[] | null; // text[] of funder display names
  stack_depth: number | null;
  latest_filing_date: string | null;
  freshness_days: number | null;
  score: number | null;
  status: LeadStatus;
  person_name: string | null; // traced owner name (skip-trace)
  phone: string | null; // dialable NON-DNC number only, or null (DNC-safe by contract)
  email: string | null; // populated once skip-trace runs
  email_verify_status: EmailVerifyStatus | null; // Instantly verdict; only 'verified' is sendable
  apollo_business_email?: string | null; // optional Apollo enrichment (owner opt-in)
  apollo_owner_title?: string | null;
}

type EmailVerifyStatus = "verified" | "catch_all" | "risky" | "invalid" | "bounced" | "unknown";
/* Only 'verified' is sendable for cold email; the rest are graded warnings. */
const EMAIL_VERIFY_META: Record<EmailVerifyStatus, { label: string; chip: string }> = {
  verified: { label: "✓ verified", chip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  catch_all: { label: "catch-all", chip: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  risky: { label: "risky", chip: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  invalid: { label: "invalid", chip: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" },
  bounced: { label: "bounced", chip: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" },
  unknown: { label: "unknown", chip: "bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400" },
};

interface UccAlias {
  id: string;
  alias: string;
  canonical_name: string | null;
  source: string | null; // "lenders" | "curated"
  active?: boolean; // present once ph_ucc_funder_aliases has the column; undefined = treat as active
  created_at?: string | null;
}

/* Gating flags live in platform_settings under key "ph_ucc". */
interface PhUccSettings {
  ucc_load_enabled: boolean;
  skiptrace_provider_configured: boolean;
  scrub_provider_configured: boolean;
}
const DEFAULT_SETTINGS: PhUccSettings = {
  ucc_load_enabled: false,
  skiptrace_provider_configured: false,
  scrub_provider_configured: false,
};

/* Funnel stages, in order. Keys map onto lead statuses where applicable. */
const FUNNEL: { key: string; label: string }[] = [
  { key: "filings", label: "Filings ingested" },
  { key: "debtors", label: "Debtors" },
  { key: "matched", label: "MCA-matched leads" },
  { key: "needs_skiptrace", label: "Needs skip-trace" },
  { key: "needs_scrub", label: "Needs scrub" },
  { key: "ready", label: "Ready" },
  { key: "loaded", label: "Loaded" },
];

const LEAD_STATUS_META: Record<LeadStatus, { label: string; chip: string }> = {
  matched: { label: "matched", chip: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  needs_skiptrace: { label: "needs skip-trace", chip: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  needs_scrub: { label: "needs scrub", chip: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300" },
  ready: { label: "ready", chip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  loaded: { label: "loaded", chip: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300" },
  suppressed: { label: "suppressed", chip: "bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400" },
  email_only: { label: "email only", chip: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300" },
  no_match: { label: "no match", chip: "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300" },
};

const SOURCE_STATUS_META: Record<SourceStatus, { label: string; chip: string; dot: string }> = {
  active: { label: "active", chip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300", dot: "bg-emerald-500" },
  awaiting_purchase: { label: "awaiting purchase", chip: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300", dot: "bg-amber-500" },
  error: { label: "error", chip: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300", dot: "bg-rose-500" },
  // Source exists but its data can't be used (e.g. VA's format) — distinct from a
  // transient error; the "why" lives in error_note. No "Pull now" (not active).
  unusable: { label: "unusable", chip: "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300", dot: "bg-slate-400" },
};

const PAGE_SIZE = 25;

/* BatchData per-trace cost. The DISPLAY figure is the observed all-in average
   ($0.07) so the operator's estimate isn't inflated; the GUARD figure ($0.07 +
   margin) is what the hard budget block uses. Real spend always comes back from
   the edge fn (run_spend_usd). */
const TRACE_COST_DISPLAY = 0.07;
const TRACE_COST_GUARD = 0.1;
const FRESH_ONLY_DAYS = 90; // the highest-value scope for a skip-trace run
const DEFAULT_MAX_FRESHNESS_DAYS = 120; // the edge fn's default when fresh-only is off
const HARD_CALL_CAP = 100; // the edge fn traces at most 100 leads per call, regardless of limit

/* Stable CSV column order for the lead export. phone/email stay in the shape
   even though they're null until skip-trace is live — keeps the file layout
   constant across exports. */
const LEAD_CSV_COLUMNS = [
  "debtor_name",
  "state",
  "matched_funders",
  "stack_depth",
  "latest_filing_date",
  "freshness_days",
  "score",
  "status",
  "phone",
  "email",
] as const;

/* RFC-4180-ish escaping: wrap in quotes when the value contains a comma, quote,
   or newline; double any embedded quotes. */
function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function buildCsv(headers: readonly string[], rows: (unknown[])[]): string {
  const lines = [headers.map(csvCell).join(",")];
  for (const r of rows) lines.push(r.map(csvCell).join(","));
  return lines.join("\r\n");
}
function downloadCsv(filename: string, csv: string): void {
  // Prepend a UTF-8 BOM so Excel reads accented funder names correctly.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
function todayStamp(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

/* supabase-js returns a FunctionsHttpError on non-2xx, with the response body in
   error.context (a Response). Pull the {error} message out of it when present. */
async function fnErrorMessage(error: unknown): Promise<string> {
  const ctx = (error as { context?: { json?: () => Promise<unknown> } })?.context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const body = (await ctx.json()) as { error?: string } | null;
      if (body?.error) return body.error;
    } catch {
      /* body already consumed or not JSON — fall through to the generic message */
    }
  }
  return error instanceof Error ? error.message : String(error);
}

/* A PostgREST "table/relation not found" error → backend not deployed. */
function isMissingRelation(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return err.code === "PGRST205" || err.code === "42P01" || /does not exist|find the table/i.test(err.message || "");
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" });
}
function fmtRelative(d: string | null): string {
  if (!d) return "never";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "never";
  const days = Math.floor((Date.now() - dt.getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  return fmtDate(d);
}
function daysSince(d: string | null): number | null {
  if (!d) return null;
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - dt.getTime()) / 86400000));
}
/* Freshness clock: green ≤7d, amber 8–14d, red >14d (SLA target ≤7). */
function freshnessChip(days: number | null): string {
  if (days == null) return "bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400";
  if (days <= 7) return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300";
  if (days <= 14) return "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300";
  return "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300";
}

export default function PhUccMachinePage() {
  const { isSuperAdmin } = useUserProfile();
  const [loading, setLoading] = useState(true);
  const [backendMissing, setBackendMissing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [sources, setSources] = useState<UccSource[]>([]);
  const [aliases, setAliases] = useState<UccAlias[]>([]);
  const [settings, setSettings] = useState<PhUccSettings>(DEFAULT_SETTINGS);
  const [funnel, setFunnel] = useState<Record<string, number>>({});
  const [medianIngestDays, setMedianIngestDays] = useState<number | null>(null);
  // Skip-trace provider wallet (BatchData) — remaining spend.
  const [wallet, setWallet] = useState<{ balance: number; currency: string } | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletErr, setWalletErr] = useState<string | null>(null);
  // Skip-trace batch runner (spends the wallet — budget-guarded).
  const [batchLimit, setBatchLimit] = useState("100");
  const [batchMinScore, setBatchMinScore] = useState("");
  const [batchFreshOnly, setBatchFreshOnly] = useState(true); // ≤90d = highest-value scope, default on
  const [batchEligible, setBatchEligible] = useState<number | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchArmed, setBatchArmed] = useState(false);
  const [batchResult, setBatchResult] = useState<string | null>(null);
  const [batchErr, setBatchErr] = useState<string | null>(null);

  // Lead browser state.
  const [leads, setLeads] = useState<UccLead[]>([]);
  const [leadCount, setLeadCount] = useState(0);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [fState, setFState] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fMinStack, setFMinStack] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportFlash, setExportFlash] = useState<string | null>(null);
  // Raw filings export (nice-to-have): selected state + date range.
  const [filState, setFilState] = useState("");
  const [filFrom, setFilFrom] = useState("");
  const [filTo, setFilTo] = useState("");
  const [filExporting, setFilExporting] = useState(false);
  const [filFlash, setFilFlash] = useState<string | null>(null);

  // Pull-now progress, keyed by source id.
  const [pulling, setPulling] = useState<Record<string, string>>({});
  // Alias add form.
  const [newAlias, setNewAlias] = useState("");
  const [newCanonical, setNewCanonical] = useState("");
  const [aliasSaving, setAliasSaving] = useState(false);
  const [aliasErr, setAliasErr] = useState<string | null>(null);
  // Two-step inline confirm for the destructive alias delete (owner rule: no
  // browser popups). First tap arms the row, second fires; disarms after 5s.
  const [aliasArmed, setAliasArmed] = useState<string | null>(null);

  // ── PH UCC pipeline settings (super_admin only; platform_settings 'ph_settings') ──
  // Held as the FULL stored object so unknown keys (pipeline_id, setter_numbers,
  // workflow ids, …) are preserved on every save.
  const [phSettings, setPhSettings] = useState<Record<string, unknown> | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsArmed, setSettingsArmed] = useState<string | null>(null); // field key armed for write
  const [settingsSaving, setSettingsSaving] = useState<string | null>(null);
  const [settingsErr, setSettingsErr] = useState<string | null>(null);
  const [settingsFlash, setSettingsFlash] = useState<string | null>(null);
  const [batchCapInput, setBatchCapInput] = useState(""); // local edit: max_skiptrace_batch
  const [dncInput, setDncInput] = useState(""); // local edit: skiptrace_dnc_policy

  /* Funnel counts: filings + per-status lead counts via head/count queries. */
  const loadFunnel = useCallback(async () => {
    const counts: Record<string, number> = {};
    const filingsRes = await supabase.from("ph_ucc_filings").select("id", { count: "exact", head: true });
    if (!isMissingRelation(filingsRes.error)) counts.filings = filingsRes.count ?? 0;

    const debtorRes = await supabase
      .from("ph_ucc_filings")
      .select("debtor_name", { count: "exact", head: true })
      .not("debtor_name", "is", null);
    if (!isMissingRelation(debtorRes.error)) counts.debtors = debtorRes.count ?? 0;

    // Funnel stages + the two terminal off-ramps (rendered as separate tiles,
    // not in the funnel strip).
    const statuses: LeadStatus[] = [
      "matched",
      "needs_skiptrace",
      "needs_scrub",
      "ready",
      "loaded",
      "email_only",
      "no_match",
    ];
    const statusCounts = await Promise.all(
      statuses.map((s) =>
        supabase.from("ph_ucc_leads").select("id", { count: "exact", head: true }).eq("status", s),
      ),
    );
    statuses.forEach((s, i) => {
      if (!isMissingRelation(statusCounts[i].error)) counts[s] = statusCounts[i].count ?? 0;
    });
    setFunnel(counts);
  }, []);

  /* Freshness SLA: median days filing_date → ingested_at across recent filings. */
  const loadFreshness = useCallback(async () => {
    const res = await supabase
      .from("ph_ucc_filings")
      .select("filing_date, ingested_at")
      .order("ingested_at", { ascending: false })
      .limit(500);
    if (res.error || !res.data) return;
    const lags: number[] = [];
    for (const row of res.data as { filing_date: string | null; ingested_at: string | null }[]) {
      if (!row.filing_date || !row.ingested_at) continue;
      const f = new Date(row.filing_date).getTime();
      const g = new Date(row.ingested_at).getTime();
      if (isNaN(f) || isNaN(g)) continue;
      lags.push(Math.max(0, Math.floor((g - f) / 86400000)));
    }
    if (lags.length === 0) {
      setMedianIngestDays(null);
      return;
    }
    lags.sort((a, b) => a - b);
    const mid = Math.floor(lags.length / 2);
    setMedianIngestDays(lags.length % 2 ? lags[mid] : Math.round((lags[mid - 1] + lags[mid]) / 2));
  }, []);

  /* Skip-trace provider wallet balance (BatchData). Best-effort — a failure
     just leaves the tile in an error state, never blocks the page. */
  const loadWallet = useCallback(async () => {
    setWalletLoading(true);
    setWalletErr(null);
    try {
      const { data, error } = await supabase.functions.invoke("ph-ucc-skiptrace", { body: { action: "wallet" } });
      if (error) throw error;
      const res = data as { ok?: boolean; balance?: number; currency?: string } | null;
      if (!res?.ok || typeof res.balance !== "number") throw new Error("wallet unavailable");
      setWallet({ balance: res.balance, currency: res.currency || "USD" });
    } catch (e) {
      setWalletErr(e instanceof Error ? e.message : String(e));
      setWallet(null);
    } finally {
      setWalletLoading(false);
    }
  }, []);

  /* How many needs_skiptrace leads a run would actually hit, given the current
     batch filters (min_score / fresh≤90d). Shrinks as backend runs drain the
     backlog — the trace is idempotent so this is the honest "what a run touches". */
  const loadEligible = useCallback(async () => {
    // Mirror the edge fn's eligibility exactly: needs_skiptrace, not yet traced,
    // has a street address (can't trace without one), within the freshness window,
    // and above min_score when set.
    const maxFresh = batchFreshOnly ? FRESH_ONLY_DAYS : DEFAULT_MAX_FRESHNESS_DAYS;
    let q = supabase
      .from("ph_ucc_leads")
      .select("id", { count: "exact", head: true })
      .eq("status", "needs_skiptrace")
      .is("traced_at", null)
      .not("debtor_address", "is", null)
      .lte("freshness_days", maxFresh);
    const min = Number(batchMinScore);
    if (batchMinScore && !isNaN(min)) q = q.gte("score", min);
    const res = await q;
    if (isMissingRelation(res.error)) return;
    setBatchEligible(res.error ? null : res.count ?? 0);
  }, [batchFreshOnly, batchMinScore]);

  // Load the full 'ph_settings' object; seed the local number/text edit fields.
  const loadPhSettings = useCallback(async () => {
    const v = await getSetting<Record<string, unknown>>("ph_settings", {});
    setPhSettings(v);
    setBatchCapInput(String((v.max_skiptrace_batch as number | undefined) ?? 300));
    setDncInput(String((v.skiptrace_dnc_policy as string | undefined) ?? ""));
  }, []);

  /* ── Load the top-of-page data (sources, aliases, settings, funnel counts) ── */
  const loadOverview = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [srcRes, aliasRes, setRes] = await Promise.all([
        supabase.from("ph_ucc_sources").select("*").order("state", { ascending: true }),
        supabase.from("ph_ucc_funder_aliases").select("*").order("alias", { ascending: true }),
        supabase.from("platform_settings").select("value").eq("key", "ph_ucc").maybeSingle(),
      ]);

      if (isMissingRelation(srcRes.error)) {
        setBackendMissing(true);
        setLoading(false);
        return;
      }
      if (srcRes.error) throw srcRes.error;
      setBackendMissing(false);
      setSources((srcRes.data as UccSource[]) ?? []);
      if (!isMissingRelation(aliasRes.error)) setAliases((aliasRes.data as UccAlias[]) ?? []);
      setSettings({ ...DEFAULT_SETTINGS, ...((setRes.data?.value as Partial<PhUccSettings>) ?? {}) });

      await Promise.all([loadFunnel(), loadFreshness(), loadWallet(), loadEligible()]);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [loadFunnel, loadFreshness, loadWallet, loadEligible]);

  /* ── Lead browser (paginated, filtered, ranked by score) ── */
  const loadLeads = useCallback(async () => {
    setLeadsLoading(true);
    try {
      let q = supabase
        .from("ph_ucc_leads")
        .select("*", { count: "exact" })
        .order("score", { ascending: false, nullsFirst: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (fState) q = q.eq("state", fState);
      if (fStatus) q = q.eq("status", fStatus);
      else q = q.neq("status", "suppressed"); // hide junk by default
      if (fMinStack) q = q.gte("stack_depth", Number(fMinStack) || 0);

      const res = await q;
      if (isMissingRelation(res.error)) {
        setLeads([]);
        setLeadCount(0);
        return;
      }
      if (res.error) throw res.error;
      setLeads((res.data as UccLead[]) ?? []);
      setLeadCount(res.count ?? 0);
    } catch {
      setLeads([]);
      setLeadCount(0);
    } finally {
      setLeadsLoading(false);
    }
  }, [page, fState, fStatus, fMinStack]);

  /* Export the CURRENT filtered view (full result set, not just the visible
     page) as CSV. Client-side is fine at current volumes; if row counts ever
     make that impractical, move to a `ph-ucc-ingest`-style edge endpoint. */
  const exportLeadsCsv = useCallback(async () => {
    setExporting(true);
    setExportFlash(null);
    try {
      let q = supabase
        .from("ph_ucc_leads")
        .select(
          "debtor_name, state, matched_funders, stack_depth, latest_filing_date, freshness_days, score, status, phone, email",
        )
        .order("score", { ascending: false, nullsFirst: false });
      if (fState) q = q.eq("state", fState);
      if (fStatus) q = q.eq("status", fStatus);
      else q = q.neq("status", "suppressed");
      if (fMinStack) q = q.gte("stack_depth", Number(fMinStack) || 0);

      const res = await q;
      if (res.error) throw res.error;
      const data = (res.data as UccLead[]) ?? [];
      const rows = data.map((l) => [
        l.debtor_name,
        l.state,
        (l.matched_funders ?? []).join("|"), // pipe-joined so commas don't split columns
        l.stack_depth,
        l.latest_filing_date,
        l.freshness_days,
        l.score,
        l.status,
        l.phone,
        l.email,
      ]);
      downloadCsv(`ph-ucc-leads-${todayStamp()}.csv`, buildCsv(LEAD_CSV_COLUMNS, rows));
      setExportFlash(`exported ${rows.length} row${rows.length === 1 ? "" : "s"} ✓`);
      setTimeout(() => setExportFlash(null), 5000);
    } catch (e) {
      setExportFlash(`export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  }, [fState, fStatus, fMinStack]);

  /* Raw filings dump for a state + date range. Schema-agnostic: columns are
     derived from the returned rows, so it survives whatever ph_ucc_filings
     ends up holding. */
  const exportFilingsCsv = useCallback(async () => {
    setFilExporting(true);
    setFilFlash(null);
    try {
      let q = supabase.from("ph_ucc_filings").select("*").order("filing_date", { ascending: false }).limit(50000);
      if (filState) q = q.eq("state", filState);
      if (filFrom) q = q.gte("filing_date", filFrom);
      if (filTo) q = q.lte("filing_date", filTo);

      const res = await q;
      if (res.error) throw res.error;
      const data = (res.data as Record<string, unknown>[]) ?? [];
      if (data.length === 0) {
        setFilFlash("no filings match ✓");
        setTimeout(() => setFilFlash(null), 5000);
        return;
      }
      const headers = Object.keys(data[0]);
      const rows = data.map((r) => headers.map((h) => r[h]));
      const scope = [filState || "all", filFrom || "start", filTo || "today"].join("_");
      downloadCsv(`ph-ucc-filings-${scope}-${todayStamp()}.csv`, buildCsv(headers, rows));
      setFilFlash(`exported ${rows.length} row${rows.length === 1 ? "" : "s"} ✓`);
      setTimeout(() => setFilFlash(null), 5000);
    } catch (e) {
      setFilFlash(`export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setFilExporting(false);
    }
  }, [filState, filFrom, filTo]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);
  useEffect(() => {
    if (!backendMissing) loadLeads();
  }, [loadLeads, backendMissing]);
  // Reset to first page whenever a filter changes.
  useEffect(() => {
    setPage(0);
  }, [fState, fStatus, fMinStack]);
  // Auto-disarm a primed alias delete after 5s.
  useEffect(() => {
    if (!aliasArmed) return;
    const t = setTimeout(() => setAliasArmed(null), 5000);
    return () => clearTimeout(t);
  }, [aliasArmed]);
  // Recompute eligible-untraced count when the batch filters change; disarm on change.
  useEffect(() => {
    if (!backendMissing) loadEligible();
    setBatchArmed(false);
  }, [loadEligible, backendMissing]);
  // Auto-disarm a primed batch run after 5s.
  useEffect(() => {
    if (!batchArmed) return;
    const t = setTimeout(() => setBatchArmed(false), 5000);
    return () => clearTimeout(t);
  }, [batchArmed]);
  // Load pipeline settings for super_admins once the backend is present.
  useEffect(() => {
    if (isSuperAdmin && !backendMissing) loadPhSettings();
  }, [isSuperAdmin, backendMissing, loadPhSettings]);
  // Auto-disarm a primed settings write after 5s.
  useEffect(() => {
    if (!settingsArmed) return;
    const t = setTimeout(() => setSettingsArmed(null), 5000);
    return () => clearTimeout(t);
  }, [settingsArmed]);

  /* ── Actions ── */
  const pullNow = useCallback(
    async (src: UccSource) => {
      setPulling((p) => ({ ...p, [src.id]: "Pulling…" }));
      try {
        const { data, error } = await supabase.functions.invoke("ph-ucc-ingest", {
          body: { source_id: src.id, state: src.state },
        });
        if (error) throw error;
        const ingested = (data as { rows_ingested?: number } | null)?.rows_ingested;
        setPulling((p) => ({ ...p, [src.id]: ingested != null ? `+${ingested} rows` : "Done" }));
        await loadOverview();
      } catch (e) {
        setPulling((p) => ({ ...p, [src.id]: `Error: ${e instanceof Error ? e.message : String(e)}` }));
      } finally {
        setTimeout(() => setPulling((p) => {
          const rest = { ...p };
          delete rest[src.id];
          return rest;
        }), 6000);
      }
    },
    [loadOverview],
  );

  /* Run a skip-trace batch. Spends the wallet, so it's budget-guarded (blocked
     above when projected > balance) AND two-step armed at the call site. After
     the run we re-fetch the authoritative wallet balance for "wallet now $Y". */
  const runBatch = useCallback(async () => {
    setBatchRunning(true);
    setBatchErr(null);
    setBatchResult(null);
    const limit = Math.max(1, Math.floor(Number(batchLimit) || 0));
    try {
      // Send max_freshness_days explicitly (90 fresh-only, else the fn's 120
      // default) so what runs matches the eligible count we showed.
      const body: Record<string, unknown> = {
        limit,
        max_freshness_days: batchFreshOnly ? FRESH_ONLY_DAYS : DEFAULT_MAX_FRESHNESS_DAYS,
      };
      const min = Number(batchMinScore);
      if (batchMinScore && !isNaN(min)) body.min_score = min;

      const { data, error } = await supabase.functions.invoke("ph-ucc-skiptrace", { body });
      // Budget-abort (402) / wallet-lookup (502) come back as an invoke error with
      // the {ok:false,error} body in error.context — surface that, not "traced".
      if (error) {
        const msg = await fnErrorMessage(error);
        throw new Error(msg);
      }
      const res = (data as Record<string, unknown>) ?? {};
      if (res.ok === false) throw new Error(String(res.error || "skip-trace failed"));

      // Stage paused: skiptrace_enabled=false (no force) → skipped:true, not traced:0.
      if (res.skipped === true) {
        setBatchResult("stage paused by owner — skip-trace is disabled in Settings");
      } else if (res.balance_after == null && typeof res.message === "string") {
        // Nothing-eligible branch: {ok:true, traced:0, message, balance_before} —
        // no balance_after/run_spend_usd; show the message, leave the wallet as-is.
        setBatchResult(res.message);
      } else {
        const traced = Number(res.traced ?? 0) || 0;
        const spent = Number(res.run_spend_usd ?? 0) || 0;
        let nowStr = "";
        if (typeof res.balance_after === "number") {
          // balance_after is a genuine post-run wallet read — authoritative.
          setWallet((w) => ({ balance: res.balance_after as number, currency: w?.currency || "USD" }));
          nowStr = ` · wallet now $${(res.balance_after as number).toFixed(2)}`;
        }
        setBatchResult(`traced ${traced.toLocaleString()} · $${spent.toFixed(2)} spent${nowStr}`);
      }
      // Refresh the funnel / eligible / lead table to reflect the traced rows.
      await Promise.all([loadFunnel(), loadEligible(), loadLeads()]);
    } catch (e) {
      setBatchErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBatchRunning(false);
      setBatchArmed(false);
    }
  }, [batchLimit, batchMinScore, batchFreshOnly, loadFunnel, loadEligible, loadLeads]);

  const reloadAliases = useCallback(async () => {
    const aliasRes = await supabase.from("ph_ucc_funder_aliases").select("*").order("alias", { ascending: true });
    if (!aliasRes.error) setAliases((aliasRes.data as UccAlias[]) ?? []);
  }, []);

  // Persist ONE field, merged into the full object so peer keys survive.
  const savePhSetting = useCallback(
    async (key: string, value: unknown, label: string) => {
      if (!phSettings) return;
      setSettingsSaving(key);
      setSettingsErr(null);
      setSettingsFlash(null);
      try {
        const next = { ...phSettings, [key]: value };
        await saveSetting("ph_settings", next); // upserts whole value via mustWrite
        setPhSettings(next);
        setSettingsFlash(`${label} saved ✓`);
        setTimeout(() => setSettingsFlash(null), 4000);
      } catch (e) {
        setSettingsErr(e instanceof Error ? e.message : String(e));
      } finally {
        setSettingsSaving(null);
        setSettingsArmed(null);
      }
    },
    [phSettings],
  );

  const addAlias = useCallback(async () => {
    const alias = newAlias.trim();
    if (!alias) return;
    setAliasSaving(true);
    setAliasErr(null);
    try {
      await mustWrite(
        "add UCC funder alias",
        supabase.from("ph_ucc_funder_aliases").insert({
          alias,
          canonical_name: newCanonical.trim() || null,
          source: "curated",
        }),
      );
      setNewAlias("");
      setNewCanonical("");
      await reloadAliases();
    } catch (e) {
      setAliasErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAliasSaving(false);
    }
  }, [newAlias, newCanonical, reloadAliases]);

  /* Curated aliases can be deleted outright. Lenders-seeded aliases must NOT be
     deleted (the re-seed would resurrect them) — they get an `active` toggle so
     the matcher ignores them while the row survives re-seeding. */
  const removeAlias = useCallback(
    async (a: UccAlias) => {
      setAliasErr(null);
      const prev = aliases;
      setAliases((as) => as.filter((x) => x.id !== a.id)); // optimistic
      try {
        await mustWrite(
          "delete UCC funder alias",
          supabase.from("ph_ucc_funder_aliases").delete().eq("id", a.id),
        );
      } catch (e) {
        setAliases(prev); // revert
        setAliasErr(e instanceof Error ? e.message : String(e));
      }
    },
    [aliases],
  );

  const toggleAliasActive = useCallback(
    async (a: UccAlias) => {
      setAliasErr(null);
      const currentlyActive = a.active !== false;
      const next = !currentlyActive;
      setAliases((as) => as.map((x) => (x.id === a.id ? { ...x, active: next } : x))); // optimistic
      try {
        await mustWrite(
          "toggle UCC funder alias",
          supabase.from("ph_ucc_funder_aliases").update({ active: next }).eq("id", a.id),
        );
      } catch (e) {
        setAliasErr(e instanceof Error ? e.message : String(e));
        reloadAliases(); // revert to server truth (e.g. `active` column not present yet)
      }
    },
    [reloadAliases],
  );

  const toggleSuppress = useCallback(
    async (lead: UccLead) => {
      const next: LeadStatus = lead.status === "suppressed" ? "matched" : "suppressed";
      // Optimistic update.
      setLeads((ls) => ls.map((l) => (l.id === lead.id ? { ...l, status: next } : l)));
      try {
        await mustWrite(
          "suppress UCC lead",
          supabase.from("ph_ucc_leads").update({ status: next }).eq("id", lead.id),
        );
      } catch {
        // Revert on failure and reload the page of leads.
        loadLeads();
      }
    },
    [loadLeads],
  );

  const input =
    "px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100";

  const usStates = useMemo(() => {
    const set = new Set<string>();
    sources.forEach((s) => s.state && set.add(s.state));
    leads.forEach((l) => l.state && set.add(l.state));
    return Array.from(set).sort();
  }, [sources, leads]);

  const totalPages = Math.max(1, Math.ceil(leadCount / PAGE_SIZE));

  // Whether ph_ucc_funder_aliases carries the `active` column yet. If not, the
  // enable/disable toggle is gated off (the backend is adding it — see the
  // note to ph-ucc-machine) so we never fire an update against a missing column.
  const aliasHasActiveColumn = useMemo(() => aliases.some((a) => "active" in a), [aliases]);

  /** Two-step confirm for a settings write: arm on first call, fire on second. */
  const settingsArmOrFire = (key: string): boolean => {
    if (settingsArmed === key) {
      setSettingsArmed(null);
      return true;
    }
    setSettingsArmed(key);
    return false;
  };
  const sBool = (k: string) => phSettings?.[k] === true;
  const batchCapDirty = phSettings != null && batchCapInput !== String(phSettings.max_skiptrace_batch ?? 300);
  const dncDirty = phSettings != null && dncInput !== String(phSettings.skiptrace_dnc_policy ?? "");

  // A single call traces at most min(limit, 100, eligible) leads. Base both the
  // shown estimate (× $0.07) and the hard budget guard (× $0.10) on that true
  // per-call size so we neither overstate cost nor overrun the wallet.
  const parsedLimit = Math.max(0, Math.floor(Number(batchLimit) || 0));
  const effectiveRun = Math.min(parsedLimit, HARD_CALL_CAP, batchEligible ?? Infinity);
  const projectedCost = effectiveRun * TRACE_COST_DISPLAY;
  const guardCost = effectiveRun * TRACE_COST_GUARD;
  const overBudget = wallet != null && guardCost > wallet.balance;
  const canRunBatch =
    settings.skiptrace_provider_configured &&
    parsedLimit > 0 &&
    (batchEligible == null || batchEligible > 0) &&
    wallet != null && // never run blind — a hard budget guard needs a known balance
    !overBudget &&
    !batchRunning;

  /* ── Render ── */
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <RectangleStackIcon className="w-6 h-6 text-ocean-blue" /> PH — UCC Machine
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            State UCC filings → debtors → MCA-matched leads → ready to load. Source health, the ingest funnel, and the
            ranked lead book.
          </p>
        </div>
        <button
          onClick={loadOverview}
          className="btn-ghost inline-flex items-center gap-2 text-sm"
          disabled={loading}
        >
          <ArrowPathIcon className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {loadError && (
        <div className="rounded-lg border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/20 px-4 py-3 text-sm text-rose-700 dark:text-rose-300 flex items-center gap-2">
          <ExclamationTriangleIcon className="w-5 h-5 shrink-0" /> Failed to load: {loadError}
        </div>
      )}

      {backendMissing ? (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-6 py-12 text-center">
          <RectangleStackIcon className="w-10 h-10 mx-auto text-gray-300 dark:text-gray-600" />
          <h2 className="mt-3 font-semibold text-gray-900 dark:text-white">Backend not deployed yet</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto">
            The UCC Machine tables (<code>ph_ucc_sources</code>, <code>ph_ucc_leads</code>) aren't live yet. This
            dashboard will populate automatically once the ingest backend is deployed.
          </p>
        </div>
      ) : loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (
        <>
          {/* ── 1. Source status cards ── */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Sources</h2>
              {/* Raw filings export — state + date range dump. */}
              <div className="flex flex-wrap items-center gap-2">
                <select className={input} value={filState} onChange={(e) => setFilState(e.target.value)}>
                  <option value="">All states</option>
                  {usStates.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
                <input
                  type="date"
                  className={input}
                  value={filFrom}
                  onChange={(e) => setFilFrom(e.target.value)}
                  title="Filing date from"
                />
                <input
                  type="date"
                  className={input}
                  value={filTo}
                  onChange={(e) => setFilTo(e.target.value)}
                  title="Filing date to"
                />
                <button
                  onClick={exportFilingsCsv}
                  disabled={filExporting}
                  className="btn-ghost inline-flex items-center gap-1.5 text-sm"
                  title="Export raw filings for this state + date range"
                >
                  <ArrowDownTrayIcon className="w-4 h-4" />
                  {filExporting ? "Exporting…" : "Export filings"}
                </button>
                {filFlash && (
                  <span
                    className={`text-xs ${filFlash.startsWith("export failed") ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}`}
                  >
                    {filFlash}
                  </span>
                )}
              </div>
            </div>
            {sources.length === 0 ? (
              <p className="text-sm text-gray-400">No sources configured yet.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {sources.map((s) => {
                  const meta = SOURCE_STATUS_META[s.status] ?? SOURCE_STATUS_META.error;
                  const fresh = daysSince(s.newest_filing_date);
                  const prog = pulling[s.id];
                  return (
                    <div
                      key={s.id}
                      className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`w-2.5 h-2.5 rounded-full ${meta.dot}`} />
                          <span className="font-bold text-gray-900 dark:text-white">{s.state}</span>
                        </div>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${meta.chip}`}>{meta.label}</span>
                      </div>
                      <dl className="mt-3 space-y-1.5 text-sm">
                        <div className="flex justify-between">
                          <dt className="text-gray-400">Last pull</dt>
                          <dd className="text-gray-700 dark:text-gray-200">{fmtRelative(s.last_pull_at)}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-gray-400">Rows ingested</dt>
                          <dd className="font-semibold text-gray-900 dark:text-white">
                            {(s.rows_ingested ?? 0).toLocaleString()}
                          </dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-gray-400">Cadence</dt>
                          <dd className="text-gray-700 dark:text-gray-200">{s.cadence || "—"}</dd>
                        </div>
                        <div className="flex justify-between items-center">
                          <dt className="text-gray-400">Freshness</dt>
                          <dd>
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${freshnessChip(fresh)}`}>
                              {fresh == null ? "—" : `${fresh}d`}
                            </span>
                          </dd>
                        </div>
                      </dl>
                      {(s.status === "error" || s.status === "unusable") && s.error_note && (
                        <p
                          className={`mt-2 text-xs ${s.status === "error" ? "text-rose-600 dark:text-rose-400" : "text-slate-500 dark:text-slate-400"}`}
                        >
                          {s.error_note}
                        </p>
                      )}
                      {s.status === "active" && (
                        <button
                          onClick={() => pullNow(s)}
                          disabled={!!prog && prog === "Pulling…"}
                          className="btn-primary btn-sm w-full mt-3 inline-flex items-center justify-center gap-1.5"
                        >
                          <BoltIcon className="w-4 h-4" />
                          {prog || "Pull now"}
                        </button>
                      )}
                      {s.status === "active" && prog && prog !== "Pulling…" && (
                        <p className="mt-1 text-xs text-center text-gray-500 dark:text-gray-400">{prog}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ── 2. Machine funnel strip + honest gating banners ── */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">The machine</h2>
            <div className="overflow-x-auto">
              <div className="flex items-stretch gap-2 min-w-max">
                {FUNNEL.map((stage, i) => (
                  <div key={stage.key} className="flex items-center gap-2">
                    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3 text-center min-w-[7rem]">
                      <div className="text-xl font-bold text-gray-900 dark:text-white">
                        {(funnel[stage.key] ?? 0).toLocaleString()}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{stage.label}</div>
                    </div>
                    {i < FUNNEL.length - 1 && <span className="text-gray-300 dark:text-gray-600">›</span>}
                  </div>
                ))}
              </div>
            </div>

            {/* Gating callouts — tell the truth about where leads are stuck. */}
            {!settings.skiptrace_provider_configured && (funnel.needs_skiptrace ?? 0) > 0 && (
              <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-800 dark:text-amber-300 flex items-start gap-2">
                <ExclamationTriangleIcon className="w-5 h-5 shrink-0 mt-0.5" />
                <span>
                  <strong>{(funnel.needs_skiptrace ?? 0).toLocaleString()} leads parked at needs_skiptrace.</strong> No
                  skip-trace provider is configured — sign one up to advance them (see Phase U.4).
                </span>
              </div>
            )}
            {!settings.scrub_provider_configured && (funnel.needs_scrub ?? 0) > 0 && (
              <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-800 dark:text-amber-300 flex items-start gap-2">
                <ExclamationTriangleIcon className="w-5 h-5 shrink-0 mt-0.5" />
                <span>
                  <strong>{(funnel.needs_scrub ?? 0).toLocaleString()} leads parked at needs_scrub.</strong> No
                  TCPA-scrub provider is configured — sign one up to advance them (see Phase U.4).
                </span>
              </div>
            )}
            {!settings.ucc_load_enabled && (
              <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-800 dark:text-amber-300 flex items-start gap-2">
                <NoSymbolIcon className="w-5 h-5 shrink-0 mt-0.5" />
                <span>
                  <strong>Loading to GHL is disabled</strong> (<code>ucc_load_enabled = false</code>) until the
                  TCPA scrub is live. Ready leads will hold until it's turned on.
                </span>
              </div>
            )}
            {settings.ucc_load_enabled && settings.scrub_provider_configured && settings.skiptrace_provider_configured && (
              <div className="rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
                <CheckCircleIcon className="w-5 h-5 shrink-0" /> All gates open — skip-trace, scrub, and GHL loading are
                live.
              </div>
            )}
          </section>

          {/* ── 5. Metric tiles: freshness SLA · skip-trace wallet · off-ramps ── */}
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Freshness SLA */}
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 flex items-center gap-3">
              <ClockIcon className="w-8 h-8 text-ocean-blue shrink-0" />
              <div>
                <div className="text-2xl font-bold text-gray-900 dark:text-white">
                  {medianIngestDays == null ? "—" : `${medianIngestDays}d`}
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  median filing → ingest · target <strong>≤ 7d</strong>
                  {medianIngestDays != null && (
                    <span className={`ml-1 ${medianIngestDays <= 7 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                      {medianIngestDays <= 7 ? "on target" : "behind"}
                    </span>
                  )}
                </p>
              </div>
            </div>

            {/* Skip-trace wallet */}
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 flex items-center gap-3">
              <BanknotesIcon className="w-8 h-8 text-emerald-500 shrink-0" />
              <div className="min-w-0">
                <div className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  {walletLoading ? "…" : wallet ? `$${wallet.balance.toFixed(2)}` : "—"}
                  <button
                    onClick={loadWallet}
                    disabled={walletLoading}
                    className="text-gray-300 hover:text-gray-500 dark:hover:text-gray-300"
                    title="Refresh wallet balance"
                  >
                    <ArrowPathIcon className={`w-3.5 h-3.5 ${walletLoading ? "animate-spin" : ""}`} />
                  </button>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  {walletErr ? (
                    <span className="text-rose-600 dark:text-rose-400">wallet unavailable</span>
                  ) : (
                    "skip-trace wallet (BatchData)"
                  )}
                </p>
              </div>
            </div>

            {/* Off-ramp: email only */}
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <div className="text-2xl font-bold text-violet-600 dark:text-violet-400">
                {(funnel.email_only ?? 0).toLocaleString()}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">email only (DNC phones) — off-ramp</p>
            </div>

            {/* Off-ramp: no match */}
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <div className="text-2xl font-bold text-slate-500 dark:text-slate-400">
                {(funnel.no_match ?? 0).toLocaleString()}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">no match (no phone/email) — off-ramp</p>
            </div>
          </section>

          {/* ── Skip-trace runner (spends the wallet — budget-guarded) ── */}
          {settings.skiptrace_provider_configured && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-2">
                <BoltIcon className="w-4 h-4" /> Run skip-trace
              </h2>
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-3">
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Limit</label>
                    <input
                      type="number"
                      min={1}
                      className={`${input} w-24`}
                      value={batchLimit}
                      onChange={(e) => {
                        setBatchLimit(e.target.value);
                        setBatchArmed(false);
                      }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Min score (optional)</label>
                    <input
                      type="number"
                      min={0}
                      placeholder="any"
                      className={`${input} w-28`}
                      value={batchMinScore}
                      onChange={(e) => setBatchMinScore(e.target.value)}
                    />
                  </div>
                  <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200 pb-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-sm"
                      checked={batchFreshOnly}
                      onChange={(e) => setBatchFreshOnly(e.target.checked)}
                    />
                    fresh ≤90d only
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <span className="text-gray-500 dark:text-gray-400">
                    <strong className="text-gray-900 dark:text-white">
                      {batchEligible == null ? "—" : batchEligible.toLocaleString()}
                    </strong>{" "}
                    eligible untraced
                  </span>
                  <span className="text-gray-500 dark:text-gray-400">
                    est. <strong className="text-gray-900 dark:text-white">~${projectedCost.toFixed(2)}</strong>
                    <span className="text-gray-400"> ({effectiveRun === Infinity ? parsedLimit.toLocaleString() : effectiveRun.toLocaleString()} × ${TRACE_COST_DISPLAY.toFixed(2)})</span>
                  </span>
                  <span className="text-gray-500 dark:text-gray-400">
                    wallet{" "}
                    <strong className={overBudget ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}>
                      {wallet ? `$${wallet.balance.toFixed(2)}` : "—"}
                    </strong>
                  </span>
                </div>

                {overBudget && (
                  <p className="text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1">
                    <ExclamationTriangleIcon className="w-4 h-4 shrink-0" />
                    At the ${TRACE_COST_GUARD.toFixed(2)} guard rate this run could reach ${guardCost.toFixed(2)}, above
                    the ${wallet?.balance.toFixed(2)} wallet — lower the limit or top up.
                  </p>
                )}
                {batchEligible === 0 && (
                  <p className="text-xs text-gray-400">No eligible untraced leads for these filters right now.</p>
                )}
                {wallet == null && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                    <ExclamationTriangleIcon className="w-4 h-4 shrink-0" />
                    Wallet balance unavailable — runs are blocked until it can be read (refresh the wallet tile).
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => {
                      if (batchArmed) runBatch();
                      else setBatchArmed(true);
                    }}
                    disabled={!canRunBatch}
                    className={`inline-flex items-center gap-1.5 ${batchArmed ? "btn-warning" : "btn-primary"}`}
                  >
                    <BoltIcon className="w-4 h-4" />
                    {batchRunning
                      ? "Tracing…"
                      : batchArmed
                        ? `Confirm — trace up to ${(effectiveRun === Infinity ? parsedLimit : effectiveRun).toLocaleString()}`
                        : "Run skip-trace batch"}
                  </button>
                  {batchArmed && !batchRunning && (
                    <button onClick={() => setBatchArmed(false)} className="btn-ghost text-sm">
                      Cancel
                    </button>
                  )}
                  {batchResult && <span className="text-sm text-emerald-600 dark:text-emerald-400">{batchResult}</span>}
                  {batchErr && <span className="text-sm text-rose-600 dark:text-rose-400">run failed: {batchErr}</span>}
                </div>
                <p className="text-xs text-gray-400">
                  Traces only <code>needs_skiptrace</code> leads and is idempotent — already-traced leads are never
                  re-charged. Each call traces at most 100 (min with Max skip-trace batch); the weekly cron drains the rest.
                </p>
              </div>
            </section>
          )}

          {/* ── 3. Lead browser ── */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Lead book</h2>
              <div className="flex flex-wrap items-center gap-2">
                <select className={input} value={fState} onChange={(e) => setFState(e.target.value)}>
                  <option value="">All states</option>
                  {usStates.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
                <select className={input} value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
                  <option value="">All (excl. suppressed)</option>
                  {(Object.keys(LEAD_STATUS_META) as LeadStatus[]).map((s) => (
                    <option key={s} value={s}>
                      {LEAD_STATUS_META[s].label}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={0}
                  placeholder="Min stack"
                  className={`${input} w-28`}
                  value={fMinStack}
                  onChange={(e) => setFMinStack(e.target.value)}
                />
                <button
                  onClick={exportLeadsCsv}
                  disabled={exporting}
                  className="btn-ghost inline-flex items-center gap-1.5 text-sm"
                  title="Export the current filtered view to CSV"
                >
                  <ArrowDownTrayIcon className="w-4 h-4" />
                  {exporting ? "Exporting…" : "Export CSV"}
                </button>
                {exportFlash && (
                  <span
                    className={`text-xs ${exportFlash.startsWith("export failed") ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}`}
                  >
                    {exportFlash}
                  </span>
                )}
              </div>
            </div>

            <div className="overflow-x-auto bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-400 border-b border-gray-100 dark:border-gray-700">
                    <th className="py-3 px-4">Score</th>
                    <th className="py-3 px-4">Debtor</th>
                    <th className="py-3 px-4">State</th>
                    <th className="py-3 px-4">Contact</th>
                    <th className="py-3 px-4">Matched funders</th>
                    <th className="py-3 px-4">Stack</th>
                    <th className="py-3 px-4">Latest filing</th>
                    <th className="py-3 px-4">Freshness</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4"></th>
                  </tr>
                </thead>
                <tbody>
                  {leadsLoading ? (
                    <tr>
                      <td colSpan={10} className="py-8 text-center text-gray-400">
                        Loading…
                      </td>
                    </tr>
                  ) : leads.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-8 text-center text-gray-400">
                        <MagnifyingGlassIcon className="w-6 h-6 mx-auto mb-1 text-gray-300 dark:text-gray-600" />
                        No leads match these filters yet.
                      </td>
                    </tr>
                  ) : (
                    leads.map((l) => {
                      const sm = LEAD_STATUS_META[l.status] ?? LEAD_STATUS_META.matched;
                      const funders = l.matched_funders ?? [];
                      return (
                        <tr
                          key={l.id}
                          className={`border-b border-gray-50 dark:border-gray-700/50 ${l.status === "suppressed" ? "opacity-50" : ""}`}
                        >
                          <td className="py-3 px-4 font-semibold text-gray-900 dark:text-white">
                            {l.score == null ? "—" : Math.round(l.score)}
                          </td>
                          <td className="py-3 px-4 text-gray-900 dark:text-gray-100">{l.debtor_name || "—"}</td>
                          <td className="py-3 px-4 text-gray-500 dark:text-gray-400">{l.state || "—"}</td>
                          {/* Contact — post-skip-trace. l.phone is a dialable NON-DNC number by
                              contract (DNC-suppressed numbers are never surfaced here). */}
                          <td className="py-3 px-4">
                            {l.phone || l.person_name || l.email ? (
                              <div className="leading-tight space-y-0.5">
                                {l.person_name && (
                                  <div className="text-gray-700 dark:text-gray-200">{l.person_name}</div>
                                )}
                                {l.phone ? (
                                  <div className="text-gray-900 dark:text-gray-100">{l.phone}</div>
                                ) : l.email ? (
                                  <div className="text-xs text-violet-600 dark:text-violet-400">email only</div>
                                ) : null}
                                {/* Email deliverability verdict (Instantly) — shown whenever an
                                    email exists, since it drives cold-email eligibility. */}
                                {l.email && l.email_verify_status && EMAIL_VERIFY_META[l.email_verify_status] && (
                                  <span
                                    className={`inline-block text-xs px-1.5 py-0.5 rounded ${EMAIL_VERIFY_META[l.email_verify_status].chip}`}
                                    title={`email: ${l.email}`}
                                  >
                                    {EMAIL_VERIFY_META[l.email_verify_status].label}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-gray-300 dark:text-gray-600">not traced</span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex flex-wrap gap-1">
                              {funders.length === 0 ? (
                                <span className="text-gray-400">—</span>
                              ) : (
                                funders.slice(0, 4).map((f, i) => (
                                  <span
                                    key={i}
                                    className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
                                  >
                                    {f}
                                  </span>
                                ))
                              )}
                              {funders.length > 4 && (
                                <span className="text-xs text-gray-400">+{funders.length - 4}</span>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-gray-700 dark:text-gray-200">{l.stack_depth ?? "—"}</td>
                          <td className="py-3 px-4 text-gray-500 dark:text-gray-400">{fmtDate(l.latest_filing_date)}</td>
                          <td className="py-3 px-4">
                            <span
                              className={`text-xs font-medium px-2 py-0.5 rounded-full ${freshnessChip(l.freshness_days)}`}
                            >
                              {l.freshness_days == null ? "—" : `${l.freshness_days}d`}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${sm.chip}`}>{sm.label}</span>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button
                              onClick={() => toggleSuppress(l)}
                              className="text-xs text-gray-400 hover:text-rose-600 dark:hover:text-rose-400 inline-flex items-center gap-1"
                              title={l.status === "suppressed" ? "Un-suppress" : "Suppress junk row"}
                            >
                              <NoSymbolIcon className="w-4 h-4" />
                              {l.status === "suppressed" ? "Restore" : "Suppress"}
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {leadCount > PAGE_SIZE && (
              <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
                <span>
                  {leadCount.toLocaleString()} leads · page {page + 1} of {totalPages}
                </span>
                <div className="flex gap-2">
                  <button
                    className="btn-ghost btn-sm"
                    disabled={page === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    Prev
                  </button>
                  <button
                    className="btn-ghost btn-sm"
                    disabled={page + 1 >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* ── 4. Alias manager ── */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-2">
              <MapIcon className="w-4 h-4" /> Funder alias dictionary
              <span className="normal-case font-normal text-gray-400">· {aliases.length} total</span>
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 -mt-1">
              Teach the matcher new names funders file UCCs under. Aliases from the lenders table are auto-loaded; add
              curated ones here. Curated aliases can be removed; auto-seeded lenders aliases are disabled (not deleted)
              so a re-seed doesn't bring them back.
            </p>
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-3">
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex-1 min-w-[12rem]">
                  <label className="block text-xs text-gray-400 mb-1">Alias (as filed)</label>
                  <input
                    className={`${input} w-full`}
                    placeholder="e.g. FORA FINANCIAL LLC"
                    value={newAlias}
                    onChange={(e) => setNewAlias(e.target.value)}
                  />
                </div>
                <div className="flex-1 min-w-[12rem]">
                  <label className="block text-xs text-gray-400 mb-1">Maps to funder (optional)</label>
                  <input
                    className={`${input} w-full`}
                    placeholder="e.g. Fora Financial"
                    value={newCanonical}
                    onChange={(e) => setNewCanonical(e.target.value)}
                  />
                </div>
                <button
                  onClick={addAlias}
                  disabled={aliasSaving || !newAlias.trim()}
                  className="btn-primary inline-flex items-center gap-1.5"
                >
                  <PlusIcon className="w-4 h-4" /> {aliasSaving ? "Adding…" : "Add alias"}
                </button>
              </div>
              {aliasErr && <p className="text-xs text-rose-600 dark:text-rose-400">{aliasErr}</p>}

              {aliases.length === 0 ? (
                <p className="text-sm text-gray-400">No aliases yet.</p>
              ) : (
                <div className="overflow-x-auto max-h-80 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-white dark:bg-gray-800">
                      <tr className="text-left text-gray-400 border-b border-gray-100 dark:border-gray-700">
                        <th className="py-2 px-3">Alias</th>
                        <th className="py-2 px-3">Maps to</th>
                        <th className="py-2 px-3">Source</th>
                        <th className="py-2 px-3 text-right"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {aliases.map((a) => {
                        const isCurated = a.source === "curated";
                        const disabled = a.active === false;
                        return (
                          <tr
                            key={a.id}
                            className={`border-b border-gray-50 dark:border-gray-700/50 ${disabled ? "opacity-50" : ""}`}
                          >
                            <td className="py-2 px-3 text-gray-900 dark:text-gray-100">{a.alias}</td>
                            <td className="py-2 px-3 text-gray-500 dark:text-gray-400">{a.canonical_name || "—"}</td>
                            <td className="py-2 px-3">
                              <span
                                className={`text-xs px-2 py-0.5 rounded-full ${
                                  isCurated
                                    ? "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300"
                                    : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"
                                }`}
                              >
                                {a.source || "lenders"}
                              </span>
                              {disabled && (
                                <span className="ml-1 text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                                  disabled
                                </span>
                              )}
                            </td>
                            <td className="py-2 px-3 text-right">
                              {isCurated ? (
                                // Curated → true delete, two-step arm/fire (destructive).
                                <button
                                  onClick={() => {
                                    if (aliasArmed === a.id) {
                                      setAliasArmed(null);
                                      removeAlias(a);
                                    } else {
                                      setAliasArmed(a.id);
                                    }
                                  }}
                                  className={`text-xs inline-flex items-center gap-1 ${
                                    aliasArmed === a.id
                                      ? "text-rose-700 dark:text-rose-300 font-semibold"
                                      : "text-gray-400 hover:text-rose-600 dark:hover:text-rose-400"
                                  }`}
                                  title="Delete this curated alias"
                                >
                                  <TrashIcon className="w-4 h-4" />
                                  {aliasArmed === a.id ? "Tap to confirm" : "Remove"}
                                </button>
                              ) : aliasHasActiveColumn ? (
                                // Lenders-seeded → disable/enable toggle (never delete;
                                // the re-seed would resurrect a deleted row).
                                <button
                                  onClick={() => toggleAliasActive(a)}
                                  className="text-xs inline-flex items-center gap-1 text-gray-400 hover:text-amber-600 dark:hover:text-amber-400"
                                  title={disabled ? "Re-enable for the matcher" : "Disable — matcher ignores it, survives re-seed"}
                                >
                                  <NoSymbolIcon className="w-4 h-4" />
                                  {disabled ? "Enable" : "Disable"}
                                </button>
                              ) : (
                                <span className="text-xs text-gray-300 dark:text-gray-600" title="Needs the `active` column on ph_ucc_funder_aliases">
                                  —
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>

          {/* ── 6. Pipeline settings (super_admin only; collapsed) ── */}
          {isSuperAdmin && (
            <section>
              <button
                onClick={() => setSettingsOpen((o) => !o)}
                className="w-full flex items-center justify-between text-sm font-semibold uppercase tracking-wide text-gray-400 py-2"
              >
                <span className="flex items-center gap-2">
                  <Cog6ToothIcon className="w-4 h-4" /> Settings
                </span>
                <ChevronDownIcon className={`w-4 h-4 transition-transform ${settingsOpen ? "rotate-180" : ""}`} />
              </button>

              {settingsOpen &&
                (phSettings == null ? (
                  <p className="text-sm text-gray-400">Loading settings…</p>
                ) : (
                  <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-4">
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Pipeline configuration (<code>platform_settings.ph_settings</code>). Changes take effect on the next
                      run — each write is two-step confirmed.
                    </p>

                    {/* Boolean toggles */}
                    {[
                      {
                        key: "skiptrace_enabled",
                        label: "Skip-trace enabled",
                        desc: "Master switch for the BatchData skip-trace stage — off pauses all tracing.",
                        danger: false,
                        advisory: null,
                      },
                      {
                        key: "instantly_verify_emails",
                        label: "Verify emails (Instantly)",
                        desc: "Grade each traced email's deliverability before cold outreach.",
                        danger: false,
                        advisory: null,
                      },
                      {
                        key: "apollo_enrich_enabled",
                        label: "Apollo enrichment",
                        desc: "Apollo has a low hit rate on these merchants — BatchData is primary.",
                        danger: true,
                        advisory: null,
                      },
                    ].map(({ key, label, desc, danger, advisory }) => {
                      const cur = sBool(key);
                      const armed = settingsArmed === key;
                      const saving = settingsSaving === key;
                      return (
                        <div key={key} className="flex items-start justify-between gap-4 border-t border-gray-100 dark:border-gray-700/60 pt-3 first:border-t-0 first:pt-0">
                          <div>
                            <div className="text-sm font-medium text-gray-900 dark:text-white flex items-center gap-2">
                              {label}
                              {danger && (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
                                  spends credits
                                </span>
                              )}
                            </div>
                            <p className={`text-xs ${danger ? "text-rose-600 dark:text-rose-400" : "text-gray-500 dark:text-gray-400"}`}>
                              {desc}
                            </p>
                            {advisory && (
                              <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5 flex items-center gap-1">
                                <ExclamationTriangleIcon className="w-3.5 h-3.5 shrink-0" /> {advisory}
                              </p>
                            )}
                          </div>
                          <button
                            onClick={() => {
                              if (settingsArmOrFire(key)) savePhSetting(key, !cur, label);
                            }}
                            disabled={saving}
                            className={`shrink-0 text-xs px-3 py-1.5 rounded-lg border ${
                              armed
                                ? "border-amber-400 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 font-semibold"
                                : cur
                                  ? "border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300"
                                  : "border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400"
                            }`}
                          >
                            {saving ? "Saving…" : armed ? `Tap to confirm — turn ${cur ? "OFF" : "ON"}` : cur ? "ON" : "OFF"}
                          </button>
                        </div>
                      );
                    })}

                    {/* max_skiptrace_batch */}
                    <div className="border-t border-gray-100 dark:border-gray-700/60 pt-3 flex flex-wrap items-end gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-900 dark:text-white mb-1">Max skip-trace batch</label>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                          Effective per-call cap is min(100, this). Above 100 still chunks at 100/call; below 100 lowers
                          the per-call cap.
                        </p>
                        <input
                          type="number"
                          min={1}
                          className={`${input} w-32`}
                          value={batchCapInput}
                          onChange={(e) => setBatchCapInput(e.target.value)}
                        />
                      </div>
                      <button
                        onClick={() => {
                          if (settingsArmOrFire("max_skiptrace_batch"))
                            savePhSetting("max_skiptrace_batch", Math.max(1, Math.floor(Number(batchCapInput) || 0)), "Max batch");
                        }}
                        disabled={!batchCapDirty || settingsSaving === "max_skiptrace_batch"}
                        className={`text-sm inline-flex items-center gap-1.5 ${settingsArmed === "max_skiptrace_batch" ? "btn-warning" : "btn-primary"}`}
                      >
                        {settingsSaving === "max_skiptrace_batch"
                          ? "Saving…"
                          : settingsArmed === "max_skiptrace_batch"
                            ? "Confirm save"
                            : "Save"}
                      </button>
                    </div>

                    {/* skiptrace_dnc_policy */}
                    <div className="border-t border-gray-100 dark:border-gray-700/60 pt-3">
                      <label className="block text-sm font-medium text-gray-900 dark:text-white mb-1">DNC policy note</label>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                        Documents how DNC numbers are handled. Reference text — does not itself gate dialing.
                      </p>
                      <textarea
                        rows={4}
                        className={`${input} w-full`}
                        value={dncInput}
                        onChange={(e) => setDncInput(e.target.value)}
                      />
                      <button
                        onClick={() => {
                          if (settingsArmOrFire("skiptrace_dnc_policy")) savePhSetting("skiptrace_dnc_policy", dncInput, "DNC policy");
                        }}
                        disabled={!dncDirty || settingsSaving === "skiptrace_dnc_policy"}
                        className={`mt-2 text-sm inline-flex items-center gap-1.5 ${settingsArmed === "skiptrace_dnc_policy" ? "btn-warning" : "btn-primary"}`}
                      >
                        {settingsSaving === "skiptrace_dnc_policy"
                          ? "Saving…"
                          : settingsArmed === "skiptrace_dnc_policy"
                            ? "Confirm save"
                            : "Save"}
                      </button>
                    </div>

                    {settingsErr && <p className="text-xs text-rose-600 dark:text-rose-400">save failed: {settingsErr}</p>}
                    {settingsFlash && <p className="text-xs text-emerald-600 dark:text-emerald-400">{settingsFlash}</p>}
                  </div>
                ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
