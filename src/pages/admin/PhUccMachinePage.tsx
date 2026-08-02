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
} from "@heroicons/react/24/outline";
import supabase from "@/supabase";
import { mustWrite } from "@/supabase/writes";

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
type SourceStatus = "active" | "awaiting_purchase" | "error";
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
  | "suppressed";
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
}

interface UccAlias {
  id: string;
  alias: string;
  canonical_name: string | null;
  source: string | null; // "lenders" | "curated"
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
};

const SOURCE_STATUS_META: Record<SourceStatus, { label: string; chip: string; dot: string }> = {
  active: { label: "active", chip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300", dot: "bg-emerald-500" },
  awaiting_purchase: { label: "awaiting purchase", chip: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300", dot: "bg-amber-500" },
  error: { label: "error", chip: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300", dot: "bg-rose-500" },
};

const PAGE_SIZE = 25;

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
  const [loading, setLoading] = useState(true);
  const [backendMissing, setBackendMissing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [sources, setSources] = useState<UccSource[]>([]);
  const [aliases, setAliases] = useState<UccAlias[]>([]);
  const [settings, setSettings] = useState<PhUccSettings>(DEFAULT_SETTINGS);
  const [funnel, setFunnel] = useState<Record<string, number>>({});
  const [medianIngestDays, setMedianIngestDays] = useState<number | null>(null);

  // Lead browser state.
  const [leads, setLeads] = useState<UccLead[]>([]);
  const [leadCount, setLeadCount] = useState(0);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [fState, setFState] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fMinStack, setFMinStack] = useState("");

  // Pull-now progress, keyed by source id.
  const [pulling, setPulling] = useState<Record<string, string>>({});
  // Alias add form.
  const [newAlias, setNewAlias] = useState("");
  const [newCanonical, setNewCanonical] = useState("");
  const [aliasSaving, setAliasSaving] = useState(false);
  const [aliasErr, setAliasErr] = useState<string | null>(null);

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

    const statuses: LeadStatus[] = ["matched", "needs_skiptrace", "needs_scrub", "ready", "loaded"];
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

      await Promise.all([loadFunnel(), loadFreshness()]);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [loadFunnel, loadFreshness]);

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
      const aliasRes = await supabase.from("ph_ucc_funder_aliases").select("*").order("alias", { ascending: true });
      if (!aliasRes.error) setAliases((aliasRes.data as UccAlias[]) ?? []);
    } catch (e) {
      setAliasErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAliasSaving(false);
    }
  }, [newAlias, newCanonical]);

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
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Sources</h2>
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
                      {s.status === "error" && s.error_note && (
                        <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{s.error_note}</p>
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

          {/* ── 5. Freshness SLA tile (placed near the funnel for context) ── */}
          <section>
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 flex items-center gap-4 max-w-md">
              <ClockIcon className="w-8 h-8 text-ocean-blue shrink-0" />
              <div>
                <div className="text-2xl font-bold text-gray-900 dark:text-white">
                  {medianIngestDays == null ? "—" : `${medianIngestDays}d`}
                  <span className="text-sm font-normal text-gray-400 ml-2">median days filing → ingest</span>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Target <strong>≤ 7 days</strong>.{" "}
                  {medianIngestDays != null && (
                    <span className={medianIngestDays <= 7 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>
                      {medianIngestDays <= 7 ? "On target." : "Behind target."}
                    </span>
                  )}
                </p>
              </div>
            </div>
          </section>

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
              </div>
            </div>

            <div className="overflow-x-auto bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-400 border-b border-gray-100 dark:border-gray-700">
                    <th className="py-3 px-4">Score</th>
                    <th className="py-3 px-4">Debtor</th>
                    <th className="py-3 px-4">State</th>
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
                      <td colSpan={9} className="py-8 text-center text-gray-400">
                        Loading…
                      </td>
                    </tr>
                  ) : leads.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-gray-400">
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
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 -mt-1">
              Teach the matcher new names funders file UCCs under. Aliases from the lenders table are auto-loaded; add
              curated ones here.
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
                      </tr>
                    </thead>
                    <tbody>
                      {aliases.map((a) => (
                        <tr key={a.id} className="border-b border-gray-50 dark:border-gray-700/50">
                          <td className="py-2 px-3 text-gray-900 dark:text-gray-100">{a.alias}</td>
                          <td className="py-2 px-3 text-gray-500 dark:text-gray-400">{a.canonical_name || "—"}</td>
                          <td className="py-2 px-3">
                            <span
                              className={`text-xs px-2 py-0.5 rounded-full ${
                                a.source === "curated"
                                  ? "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300"
                                  : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"
                              }`}
                            >
                              {a.source || "lenders"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
