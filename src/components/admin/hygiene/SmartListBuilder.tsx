// SmartListBuilder — pick ONE source store, slice it with rich grouped filters,
// watch the count update live, then save as a smart_lists row + its materialized
// smart_list_members. v1 is one-source-per-list ('mixed' is deferred).
//
// UX contract (owner-driven):
//   • Each source card shows a plain-language "what this is" + a LIVE total count.
//     VibeReach is the FIRST / default card — the owner's primary use case is
//     searching his CRM contacts.
//   • Filters are GROUPED (Location / Business / Contactability / Data quality) and
//     every field carries a one-line hint — no opaque "status" labels.
//   • States are a MULTI-select keyed on the stored 2-letter code, rendered as chips.
//   • The count auto-updates as filters change; with NO filter set it shows the FULL
//     source count, never 0. A genuine empty combo says so.
//   • A tiny sample of matches renders under the count so you can eyeball the slice.
//
// ── Where the counting happens ──
// The three Supabase sources (Purchased / UCC / Customers) are counted + paged
// through ONE SECURITY DEFINER RPC, smart_list_source(source, filters, mode). It
// applies filters PostgREST can't express — chiefly EFFECTIVE STATE for aged
// purchased leads (COALESCE(state, state_inferred): the "Aged + Florida = 0" bug is
// fixed here, the true answer is ~10,176) and AREA CODE (a digits-only phone
// prefix). The SAME filter jsonb is saved as smart_lists.criteria so materialize
// reproduces identical membership.
// VibeReach goes through the ghl-contacts-search edge fn: {action:'tags'} loads the
// tag list, {action:'preview'} the live count, {action:'materialize'} pages matches
// in (cap-aware against the 200k/day GHL budget).

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FunnelIcon,
  BookmarkIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import supabase from "@/supabase";
import { mustWrite } from "@/supabase/writes";
import {
  SOURCE_META,
  US_STATES,
  parseAreaCodes,
  currentProfileId,
  isMissingRelation,
  fnErrorMessage,
  type SmartList,
  type SmartListSource,
  type DbSource,
  type MemberSnapshot,
} from "./hygiene";

type BuildSource = Exclude<SmartListSource, "mixed">;
type Opt = { value: string; label: string };

const MAX_MEMBERS = 5000; // a single build materializes at most this many members
const PAGE = 1000; // pagination window when gathering rows via the RPC

/* Human-labeled option lists — values are the REAL enum/text values in prod;
   labels explain them in plain English. "" is always "any" (no filter). */
const LEAD_TYPE_OPTS: Opt[] = [
  { value: "", label: "Any type" },
  { value: "aged", label: "Aged" },
  { value: "trigger", label: "Trigger" },
  { value: "ucc", label: "UCC" },
];
const LEAD_STATUS_OPTS: Opt[] = [
  { value: "", label: "Any status" },
  { value: "loaded", label: "Loaded (not pushed yet)" },
  { value: "pushed", label: "Pushed to dialer" },
  { value: "error", label: "Errored" },
];
const UCC_STATUS_OPTS: Opt[] = [
  { value: "", label: "Any status" },
  { value: "needs_skiptrace", label: "Needs skip-trace" },
  { value: "loaded", label: "Loaded (raw)" },
  { value: "ready", label: "Ready to dial" },
  { value: "held", label: "Held" },
  { value: "suppressed", label: "Suppressed (hidden junk)" },
];
const CUSTOMER_STATUS_OPTS: Opt[] = [
  { value: "", label: "Any status" },
  { value: "lead", label: "Lead" },
  { value: "contacted", label: "Contacted" },
  { value: "application_submitted", label: "Application submitted" },
  { value: "in_review", label: "In review" },
  { value: "approved", label: "Approved" },
  { value: "funded", label: "Funded" },
  { value: "renewed", label: "Renewed" },
  { value: "declined", label: "Declined" },
  { value: "follow_up", label: "Follow-up" },
];
const ENTITY_TYPE_OPTS: Opt[] = [
  { value: "Corporation", label: "Corporation" },
  { value: "LLC", label: "LLC" },
  { value: "Professional Entity", label: "Professional Entity" },
  { value: "Ltd", label: "Ltd" },
  { value: "LLP", label: "LLP" },
];
const LINE_TYPE_OPTS: Opt[] = [
  { value: "Mobile", label: "Mobile" },
  { value: "Landline", label: "Landline" },
  { value: "VoIP", label: "VoIP" },
  { value: "Toll-Free", label: "Toll-Free" },
];
const PHONE_STATUS_OPTS: Opt[] = [
  { value: "", label: "Any" },
  { value: "reachable", label: "Reachable (validated live)" },
  { value: "disconnected", label: "Disconnected / dead" },
  { value: "unvalidated", label: "Not validated yet" },
];
const CUST_PHONE_STATUS_OPTS: Opt[] = [
  { value: "", label: "Any" },
  { value: "reachable", label: "Reachable (validated live)" },
  { value: "unvalidated", label: "Not validated yet" },
];
const ENRICHED_OPTS: Opt[] = [
  { value: "", label: "Any" },
  { value: "yes", label: "Enriched (skip-trace / Apollo)" },
  { value: "no", label: "Not enriched yet" },
];
const CONFIDENCE_OPTS: Opt[] = [
  { value: "confirmed", label: "Confirmed" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];
// deals.lead_source values — the Customers source filters on the merchant's deal
// lead source. Synergy purchases are live_transfer + realtime_appt.
const LEAD_SOURCE_OPTS: Opt[] = [
  { value: "live_transfer", label: "Synergy — Live transfer" },
  { value: "realtime_appt", label: "Synergy — Real-time" },
  { value: "aged_list", label: "Aged list" },
  { value: "ucc_list", label: "UCC list" },
  { value: "ph_setter", label: "PH setter" },
  { value: "referral", label: "Referral" },
  { value: "ghl_other", label: "VibeReach / other" },
];
const LEAD_CLASS_OPTS: Opt[] = [
  { value: "", label: "Any class" },
  { value: "named_funder", label: "Named funder on lien" },
  { value: "agent_masked", label: "Agent-masked (funder hidden)" },
];

/* State options for the multi-select (value = stored 2-letter code). */
const STATE_OPTS: Opt[] = US_STATES.map((s) => ({ value: s.code, label: `${s.name} (${s.code})` }));

const input =
  "px-2.5 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100";
const lbl = "text-[11px] font-semibold uppercase tracking-wide text-gray-400";
const help = "text-[11px] text-gray-400 dark:text-gray-500 mt-1";

/* ── Per-source filter shapes (mirror the RPC's filter jsonb keys). Raw UI values;
      area codes typed as a CSV string and parsed at criteria-build time. ── */
type LrFilters = {
  states: string[]; area_codes: string; zip_prefix: string; city: string;
  industry: string; entity_types: string[]; min_revenue: string; max_revenue: string;
  line_types: string[]; carrier: string; has_phone: boolean; has_email: boolean;
  phone_status: string; dial_score_min: string; enriched: string;
  lead_type: string; status: string; search: string;
};
type UccFilters = {
  states: string[]; area_codes: string; zip_prefix: string; city: string;
  min_stack: string; secured_party: string; filing_within_days: string;
  confidence: string[]; lead_class: string; status: string;
  has_phone: boolean; has_email: boolean; hide_litigator: boolean; search: string;
};
type CustFilters = {
  states: string[]; area_codes: string; zip_prefix: string; city: string;
  industry: string; entity_types: string[]; min_revenue: string; max_revenue: string;
  line_types: string[]; has_phone: boolean; has_email: boolean;
  phone_status: string; exclude_dnc: boolean; status: string; search: string;
  lead_sources: string[];
};
type GhlFilters = {
  tags: string[]; tagMode: "and" | "or"; query: string;
  state: string; city: string; postalCode: string; area_codes: string;
};

const LR_DEFAULT: LrFilters = {
  states: [], area_codes: "", zip_prefix: "", city: "", industry: "", entity_types: [],
  min_revenue: "", max_revenue: "", line_types: [], carrier: "", has_phone: false,
  has_email: false, phone_status: "", dial_score_min: "", enriched: "", lead_type: "",
  status: "", search: "",
};
const UCC_DEFAULT: UccFilters = {
  states: [], area_codes: "", zip_prefix: "", city: "", min_stack: "", secured_party: "",
  filing_within_days: "", confidence: [], lead_class: "", status: "", has_phone: false,
  has_email: false, hide_litigator: false, search: "",
};
const CUST_DEFAULT: CustFilters = {
  states: [], area_codes: "", zip_prefix: "", city: "", industry: "", entity_types: [],
  min_revenue: "", max_revenue: "", line_types: [], has_phone: false, has_email: false,
  phone_status: "", exclude_dnc: false, status: "", search: "", lead_sources: [],
};
const GHL_DEFAULT: GhlFilters = {
  tags: [], tagMode: "or", query: "", state: "", city: "", postalCode: "", area_codes: "",
};

const t = (s: string) => (s.trim() ? s.trim() : null);
const n = (s: string) => (s.trim() ? s.trim() : null);

/* Sample row the RPC / preview returns to eyeball the slice. */
type SampleRow = MemberSnapshot & { id?: string };

export default function SmartListBuilder({ onSaved }: { onSaved: (list: SmartList) => void }) {
  const [source, setSource] = useState<BuildSource>("ghl");

  // Live total per source (raw table count / VibeReach preview) — shown on the cards.
  const [sourceCounts, setSourceCounts] = useState<Record<BuildSource, number | null>>({
    ghl: null, ph_ucc: null, lead_records: null, customers: null,
  });

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  // Per-source filter state.
  const [ghl, setGhl] = useState<GhlFilters>(GHL_DEFAULT);
  const [lr, setLr] = useState<LrFilters>(LR_DEFAULT);
  const [ucc, setUcc] = useState<UccFilters>(UCC_DEFAULT);
  const [cust, setCust] = useState<CustFilters>(CUST_DEFAULT);

  // VibeReach tag list.
  const [ghlTagList, setGhlTagList] = useState<{ id: string; name: string }[]>([]);
  const [ghlTagsLoading, setGhlTagsLoading] = useState(false);
  const [ghlTagsErr, setGhlTagsErr] = useState<string | null>(null);

  const [count, setCount] = useState<number | null>(null);
  const [countErr, setCountErr] = useState<string | null>(null);
  const [counting, setCounting] = useState(false);
  const [approx, setApprox] = useState(false); // VibeReach area-code counts are approximate
  const [sample, setSample] = useState<SampleRow[]>([]);

  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [busyNote, setBusyNote] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const patchGhl = useCallback((p: Partial<GhlFilters>) => setGhl((s) => ({ ...s, ...p })), []);
  const patchLr = useCallback((p: Partial<LrFilters>) => setLr((s) => ({ ...s, ...p })), []);
  const patchUcc = useCallback((p: Partial<UccFilters>) => setUcc((s) => ({ ...s, ...p })), []);
  const patchCust = useCallback((p: Partial<CustFilters>) => setCust((s) => ({ ...s, ...p })), []);

  /* The VibeReach filter payload for the edge fn. */
  const ghlFilters = useMemo(
    () => ({
      tags: ghl.tags, tagMode: ghl.tagMode, query: t(ghl.query) ?? undefined,
      state: t(ghl.state) ?? undefined, city: t(ghl.city) ?? undefined,
      postalCode: t(ghl.postalCode) ?? undefined, areaCodes: parseAreaCodes(ghl.area_codes),
    }),
    [ghl],
  );

  /* The saved filter (criteria jsonb) for the current source — SAME shape the RPC
     reads, so materialize reproduces the exact membership. */
  const criteria = useMemo((): Record<string, unknown> => {
    if (source === "ghl")
      return {
        tags: ghl.tags, tag_mode: ghl.tagMode, query: t(ghl.query),
        state: t(ghl.state), city: t(ghl.city), postal_code: t(ghl.postalCode),
        area_codes: parseAreaCodes(ghl.area_codes),
      };
    if (source === "lead_records")
      return {
        states: lr.states, area_codes: parseAreaCodes(lr.area_codes), zip_prefix: t(lr.zip_prefix),
        city: t(lr.city), industry: t(lr.industry), entity_types: lr.entity_types,
        min_revenue: n(lr.min_revenue), max_revenue: n(lr.max_revenue), line_types: lr.line_types,
        carrier: t(lr.carrier), has_phone: lr.has_phone, has_email: lr.has_email,
        phone_status: lr.phone_status || null, dial_score_min: n(lr.dial_score_min),
        enriched: lr.enriched || null, lead_type: lr.lead_type || null,
        status: lr.status || null, search: t(lr.search),
      };
    if (source === "ph_ucc")
      return {
        states: ucc.states, area_codes: parseAreaCodes(ucc.area_codes), zip_prefix: t(ucc.zip_prefix),
        city: t(ucc.city), min_stack: n(ucc.min_stack), secured_party: t(ucc.secured_party),
        filing_within_days: n(ucc.filing_within_days), confidence: ucc.confidence,
        lead_class: ucc.lead_class || null, status: ucc.status || null,
        has_phone: ucc.has_phone, has_email: ucc.has_email, hide_litigator: ucc.hide_litigator,
        search: t(ucc.search),
      };
    return {
      states: cust.states, area_codes: parseAreaCodes(cust.area_codes), zip_prefix: t(cust.zip_prefix),
      city: t(cust.city), industry: t(cust.industry), entity_types: cust.entity_types,
      min_revenue: n(cust.min_revenue), max_revenue: n(cust.max_revenue), line_types: cust.line_types,
      has_phone: cust.has_phone, has_email: cust.has_email, phone_status: cust.phone_status || null,
      exclude_dnc: cust.exclude_dnc, status: cust.status || null, search: t(cust.search),
      lead_sources: cust.lead_sources,
    };
  }, [source, ghl, lr, ucc, cust]);

  /* Whether ANY filter is set for the current source (drives the empty-state copy). */
  const hasFilters = useMemo(() => {
    const c = criteria;
    return Object.entries(c).some(([k, v]) => {
      if (k === "tag_mode") return false; // mode alone isn't a filter
      if (Array.isArray(v)) return v.length > 0;
      if (typeof v === "boolean") return v;
      return v != null && v !== "";
    });
  }, [criteria]);

  /* Live source totals (Supabase table head counts) for the non-virtual cards. */
  useEffect(() => {
    let alive = true;
    (async () => {
      const entries = (Object.entries(SOURCE_META) as [BuildSource, (typeof SOURCE_META)[BuildSource]][]).filter(
        ([, meta]) => !meta.virtual,
      );
      await Promise.all(
        entries.map(async ([s, meta]) => {
          const { count: c, error } = await supabase.from(meta.table).select("id", { count: "exact", head: true });
          if (!alive) return;
          setSourceCounts((prev) => ({ ...prev, [s]: error ? null : c ?? 0 }));
        }),
      );
    })();
    return () => { alive = false; };
  }, []);

  /* Live VibeReach card count — one preview call with no filters (the whole book). */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("ghl-contacts-search", {
          body: { action: "preview", filters: {} },
        });
        if (error || (data as { error?: string })?.error) return;
        if (alive) setSourceCounts((prev) => ({ ...prev, ghl: (data as { total?: number })?.total ?? null }));
      } catch { /* card falls back to "counting…" */ }
    })();
    return () => { alive = false; };
  }, []);

  /* Load the VibeReach tag list the first time the source is opened.
     NOTE: ghlTagsLoading must NOT be in the guard or the deps. Setting it true
     inside the effect would otherwise re-fire the effect, run this run's cleanup
     (alive=false) on the in-flight fetch, and the finally would skip clearing
     loading — leaving the picker stuck on "loading tags…" forever. */
  useEffect(() => {
    if (source !== "ghl" || ghlTagList.length > 0) return;
    let alive = true;
    (async () => {
      setGhlTagsLoading(true);
      setGhlTagsErr(null);
      try {
        const { data, error } = await supabase.functions.invoke("ghl-contacts-search", { body: { action: "tags" } });
        if (error) throw new Error(await fnErrorMessage(error));
        const err = (data as { error?: string })?.error;
        if (err) throw new Error(err);
        if (alive) setGhlTagList(((data as { tags?: { id: string; name: string }[] })?.tags) ?? []);
      } catch (e) {
        if (alive) setGhlTagsErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setGhlTagsLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [source, ghlTagList.length]);

  /* Auto-preview: re-run the count whenever the source or any filter changes.
     Debounced so typing in a box doesn't fire a query per keystroke. */
  useEffect(() => {
    setSaveMsg(null);
    setCounting(true);
    setCountErr(null);
    setApprox(false);
    const timer = setTimeout(async () => {
      try {
        if (source === "ghl") {
          const { data, error } = await supabase.functions.invoke("ghl-contacts-search", {
            body: { action: "preview", filters: ghlFilters },
          });
          if (error) throw new Error(await fnErrorMessage(error));
          const res = (data ?? {}) as { error?: string; total?: number; approximate?: boolean };
          if (res.error) throw new Error(res.error);
          setCount(res.total ?? 0);
          setApprox(!!res.approximate);
          setSample([]);
        } else {
          const { data, error } = await supabase.rpc("smart_list_source", {
            p_source: source, p_filters: criteria, p_mode: "count",
          });
          if (error) {
            if (isMissingRelation(error)) throw new Error("The source query isn't available yet — apply the migration.");
            throw new Error(error.message);
          }
          const res = (data ?? {}) as { count?: number; sample?: SampleRow[] };
          setCount(res.count ?? 0);
          setSample(Array.isArray(res.sample) ? res.sample : []);
        }
      } catch (e) {
        setCount(null);
        setSample([]);
        setCountErr(e instanceof Error ? e.message : String(e));
      } finally {
        setCounting(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [source, criteria, ghlFilters]);

  /* Save the VibeReach source: create the row, then materialize via the edge fn. */
  const saveGhl = useCallback(async () => {
    const createdBy = await currentProfileId();
    const [list] = await mustWrite<SmartList>(
      "create smart_list",
      supabase.from("smart_lists").insert({
        name: name.trim(), description: description.trim() || null,
        source: "ghl", criteria, created_by: createdBy, member_count: 0,
      }),
    );

    setBusyNote("Loading contacts from VibeReach… this can take a moment.");
    const { data, error } = await supabase.functions.invoke("ghl-contacts-search", {
      body: { action: "materialize", smart_list_id: list.id, filters: ghlFilters },
    });
    if (error) throw new Error(await fnErrorMessage(error));
    const res = (data ?? {}) as {
      error?: string; inserted?: number; total?: number; member_count?: number; capped?: boolean; parked?: boolean;
    };
    if (res.error) throw new Error(res.error);

    const inserted = res.inserted ?? 0;
    const total = res.total ?? inserted;
    const { data: fresh } = await supabase.from("smart_lists").select("*").eq("id", list.id).single();
    const updated = (fresh as SmartList | null) ?? { ...list, member_count: res.member_count ?? inserted };

    let msg = `Saved "${updated.name}" — ${inserted.toLocaleString()} contacts loaded (of ${total.toLocaleString()} matched).`;
    if (res.capped) msg += ` Capped at ${inserted.toLocaleString()} — narrow the filter to load the rest.`;
    else if (res.parked) msg += " Paused — VibeReach daily cap almost hit, resumes later.";
    setSaveMsg(msg);
    onSaved(updated);
  }, [name, description, criteria, ghlFilters, onSaved]);

  /* Save a Supabase source: page rows from the RPC, insert list + members. */
  const saveDb = useCallback(async () => {
    const dbSource = source as DbSource;
    const createdBy = await currentProfileId();

    // 1) Gather up to MAX_MEMBERS matching rows (already snapshot-shaped by the RPC).
    const rows: SampleRow[] = [];
    let offset = 0;
    while (rows.length < MAX_MEMBERS) {
      const want = Math.min(PAGE, MAX_MEMBERS - rows.length);
      const { data, error } = await supabase.rpc("smart_list_source", {
        p_source: dbSource, p_filters: criteria, p_mode: "rows", p_limit: want, p_offset: offset,
      });
      if (error) throw new Error(error.message);
      const chunk = ((data as { rows?: SampleRow[] })?.rows) ?? [];
      rows.push(...chunk);
      if (chunk.length < want) break; // drained
      offset += chunk.length;
    }
    if (rows.length === 0) throw new Error("No rows match this filter — nothing to save.");

    // 2) Insert the smart_lists row (need its id back).
    const [list] = await mustWrite<SmartList>(
      "create smart_list",
      supabase.from("smart_lists").insert({
        name: name.trim(), description: description.trim() || null,
        source: dbSource, criteria, created_by: createdBy, member_count: 0,
      }),
    );

    // 3) Insert members in chunks with the denormalized snapshot.
    const CHUNK = 500;
    let inserted = 0;
    setProgress({ done: 0, total: rows.length });
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const members = slice.map((r) => ({
        smart_list_id: list.id,
        source: dbSource,
        source_id: String(r.id),
        snapshot: {
          business: r.business ?? null, contact: r.contact ?? null, phone: r.phone ?? null,
          email: r.email ?? null, state: r.state ?? null, city: r.city ?? null,
        },
      }));
      await mustWrite("insert smart_list_members", supabase.from("smart_list_members").insert(members));
      inserted += slice.length;
      setProgress({ done: inserted, total: rows.length });
    }

    // 4) Stamp the cached count + refreshed time.
    const [updated] = await mustWrite<SmartList>(
      "finalize smart_list",
      supabase
        .from("smart_lists")
        .update({ member_count: inserted, last_refreshed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", list.id),
    );

    const capped = rows.length >= MAX_MEMBERS;
    setSaveMsg(
      `Saved "${updated.name}" with ${inserted.toLocaleString()} members` +
        (capped ? ` (capped at ${MAX_MEMBERS.toLocaleString()} — narrow the filter to include more).` : "."),
    );
    onSaved(updated);
  }, [source, name, description, criteria, onSaved]);

  const save = useCallback(async () => {
    if (!name.trim()) { setSaveErr("Give the list a name first."); return; }
    setSaving(true);
    setSaveErr(null);
    setSaveMsg(null);
    setBusyNote(null);
    setProgress(null);
    try {
      if (source === "ghl") await saveGhl();
      else await saveDb();
      setName("");
      setDescription("");
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
      setBusyNote(null);
      setProgress(null);
    }
  }, [name, source, saveGhl, saveDb]);

  return (
    <div className="space-y-5">
      {/* ── Source picker ── */}
      <div>
        <p className={`${lbl} mb-2`}>1 · Pick a source</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {(Object.keys(SOURCE_META) as BuildSource[]).map((s) => {
            const meta = SOURCE_META[s];
            const active = source === s;
            const c = sourceCounts[s];
            const unit = s === "ghl" ? "contacts" : "leads";
            return (
              <button
                key={s}
                onClick={() => setSource(s)}
                className={`text-left rounded-xl border p-3 transition-all ${
                  active
                    ? "border-mint-green ring-1 ring-mint-green bg-mint-green/5"
                    : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${meta.chip}`}>{meta.label}</span>
                  {active && <CheckCircleIcon className="w-4 h-4 text-mint-green ml-auto" />}
                </div>
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{meta.blurb}</p>
                <p className="mt-2 text-xs font-semibold text-gray-700 dark:text-gray-200 tabular-nums">
                  {c == null ? "counting…" : `${c.toLocaleString()} ${unit}`}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Filters ── */}
      <div>
        <p className={`${lbl} mb-2 flex items-center gap-1.5`}>
          <FunnelIcon className="w-3.5 h-3.5" /> 2 · Filter {SOURCE_META[source].label}
          <span className="normal-case font-normal text-gray-400"> — leave everything blank to include the whole book</span>
        </p>

        {source === "ghl" && (
          <div className="space-y-4">
            <Group title="Tags">
              <Field label="Tags" hint={ghlTagsErr ? ghlTagsErr : ghlTagsLoading ? "loading tags…" : "pick one or more CRM tags"}>
                <MultiSelect
                  options={ghlTagList.map((tg) => ({ value: tg.name, label: tg.name }))}
                  selected={ghl.tags}
                  onChange={(v) => patchGhl({ tags: v })}
                  placeholder={ghlTagsLoading ? "loading tags…" : "+ add a tag"}
                  width="w-64"
                />
              </Field>
              <Field label="Match" hint="ANY = any selected tag · ALL = every selected tag">
                <div className="inline-flex rounded-md border border-gray-300 dark:border-gray-600 overflow-hidden">
                  {(["or", "and"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => patchGhl({ tagMode: m })}
                      className={`px-3 py-1.5 text-sm ${
                        ghl.tagMode === m ? "bg-mint-green text-white" : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300"
                      }`}
                    >
                      {m === "or" ? "ANY" : "ALL"}
                    </button>
                  ))}
                </div>
              </Field>
            </Group>
            <Group title="Location">
              <Field label="State" hint="matches the contact's State field (code or name)">
                <input className={`${input} w-32`} placeholder="e.g. FL" value={ghl.state} onChange={(e) => patchGhl({ state: e.target.value })} />
              </Field>
              <Field label="City" hint="City contains">
                <input className={`${input} w-44`} placeholder="contains…" value={ghl.city} onChange={(e) => patchGhl({ city: e.target.value })} />
              </Field>
              <Field label="Zip" hint="postal code (exact)">
                <input className={`${input} w-32`} placeholder="e.g. 33101" value={ghl.postalCode} onChange={(e) => patchGhl({ postalCode: e.target.value })} />
              </Field>
              <Field label="Area codes" hint="comma-separated · narrows after fetch (count is approximate)">
                <input className={`${input} w-44`} placeholder="e.g. 305, 786" value={ghl.area_codes} onChange={(e) => patchGhl({ area_codes: e.target.value })} />
              </Field>
            </Group>
            <Group title="Search">
              <Field label="Free text" hint="name / email / phone contains">
                <input className={`${input} w-64`} placeholder="free text…" value={ghl.query} onChange={(e) => patchGhl({ query: e.target.value })} />
              </Field>
            </Group>
          </div>
        )}

        {source === "lead_records" && (
          <div className="space-y-4">
            <Group title="Location">
              <Field label="States" hint="effective state — includes inferred state for aged leads">
                <MultiSelect options={STATE_OPTS} selected={lr.states} onChange={(v) => patchLr({ states: v })} placeholder="+ add a state" />
              </Field>
              <Field label="Area codes" hint="comma-separated 3-digit codes">
                <input className={`${input} w-44`} placeholder="e.g. 305, 786" value={lr.area_codes} onChange={(e) => patchLr({ area_codes: e.target.value })} />
              </Field>
              <Field label="Zip" hint="zip starts with">
                <input className={`${input} w-32`} placeholder="prefix…" value={lr.zip_prefix} onChange={(e) => patchLr({ zip_prefix: e.target.value })} />
              </Field>
              <Field label="City" hint="City contains">
                <input className={`${input} w-40`} placeholder="contains…" value={lr.city} onChange={(e) => patchLr({ city: e.target.value })} />
              </Field>
            </Group>
            <Group title="Business">
              <Field label="Industry" hint="industry bucket or SIC description contains">
                <input className={`${input} w-44`} placeholder="e.g. construction" value={lr.industry} onChange={(e) => patchLr({ industry: e.target.value })} />
              </Field>
              <Field label="Entity type" hint="pick one or more">
                <MultiSelect options={ENTITY_TYPE_OPTS} selected={lr.entity_types} onChange={(v) => patchLr({ entity_types: v })} placeholder="+ add a type" />
              </Field>
              <Field label="Min revenue" hint="annual revenue on file (≥)">
                <input type="number" min={0} className={`${input} w-32`} placeholder="any" value={lr.min_revenue} onChange={(e) => patchLr({ min_revenue: e.target.value })} />
              </Field>
              <Field label="Max revenue" hint="annual revenue on file (≤)">
                <input type="number" min={0} className={`${input} w-32`} placeholder="any" value={lr.max_revenue} onChange={(e) => patchLr({ max_revenue: e.target.value })} />
              </Field>
              <Field label="Lead type" hint="Aged, Trigger, or UCC">
                <SelectOpts className="w-40" value={lr.lead_type} onChange={(v) => patchLr({ lead_type: v })} opts={LEAD_TYPE_OPTS} />
              </Field>
              <Field label="Company name" hint="company contains">
                <input className={`${input} w-48`} placeholder="contains…" value={lr.search} onChange={(e) => patchLr({ search: e.target.value })} />
              </Field>
            </Group>
            <Group title="Contactability">
              <Field label="Line type" hint="mobile / landline / VoIP / toll-free">
                <MultiSelect options={LINE_TYPE_OPTS} selected={lr.line_types} onChange={(v) => patchLr({ line_types: v })} placeholder="+ add a line type" />
              </Field>
              <Field label="Carrier" hint="carrier name contains">
                <input className={`${input} w-40`} placeholder="e.g. Verizon" value={lr.carrier} onChange={(e) => patchLr({ carrier: e.target.value })} />
              </Field>
              <Field label="Phone status" hint="validated reachability">
                <SelectOpts className="w-52" value={lr.phone_status} onChange={(v) => patchLr({ phone_status: v })} opts={PHONE_STATUS_OPTS} />
              </Field>
              <CheckRow>
                <Check checked={lr.has_phone} onChange={(v) => patchLr({ has_phone: v })} label="Has a phone" />
                <Check checked={lr.has_email} onChange={(v) => patchLr({ has_email: v })} label="Has an email" />
              </CheckRow>
            </Group>
            <Group title="Data quality">
              <Field label="Enriched" hint="skip-trace / Apollo data present">
                <SelectOpts className="w-56" value={lr.enriched} onChange={(v) => patchLr({ enriched: v })} opts={ENRICHED_OPTS} />
              </Field>
              <Field label="Dial score ≥" hint="minimum dial score">
                <input type="number" min={0} className={`${input} w-28`} placeholder="any" value={lr.dial_score_min} onChange={(e) => patchLr({ dial_score_min: e.target.value })} />
              </Field>
              <Field label="Load status" hint="loaded vs. pushed to the dialer">
                <SelectOpts className="w-52" value={lr.status} onChange={(v) => patchLr({ status: v })} opts={LEAD_STATUS_OPTS} />
              </Field>
            </Group>
          </div>
        )}

        {source === "ph_ucc" && (
          <div className="space-y-4">
            <Group title="Location">
              <Field label="States" hint="matches the stored 2-letter code">
                <MultiSelect options={STATE_OPTS} selected={ucc.states} onChange={(v) => patchUcc({ states: v })} placeholder="+ add a state" />
              </Field>
              <Field label="Area codes" hint="comma-separated 3-digit codes">
                <input className={`${input} w-44`} placeholder="e.g. 305, 786" value={ucc.area_codes} onChange={(e) => patchUcc({ area_codes: e.target.value })} />
              </Field>
              <Field label="Zip" hint="debtor zip starts with">
                <input className={`${input} w-32`} placeholder="prefix…" value={ucc.zip_prefix} onChange={(e) => patchUcc({ zip_prefix: e.target.value })} />
              </Field>
              <Field label="City" hint="debtor city contains">
                <input className={`${input} w-40`} placeholder="contains…" value={ucc.city} onChange={(e) => patchUcc({ city: e.target.value })} />
              </Field>
            </Group>
            <Group title="UCC / business">
              <Field label="Min open advances" hint="stacking depth on file (≥)">
                <input type="number" min={0} className={`${input} w-32`} placeholder="any" value={ucc.min_stack} onChange={(e) => patchUcc({ min_stack: e.target.value })} />
              </Field>
              <Field label="Secured party" hint="funder on the lien contains">
                <input className={`${input} w-48`} placeholder="e.g. Kapitus" value={ucc.secured_party} onChange={(e) => patchUcc({ secured_party: e.target.value })} />
              </Field>
              <Field label="Filed within (days)" hint="latest filing recency (≤ N days)">
                <input type="number" min={0} className={`${input} w-32`} placeholder="any" value={ucc.filing_within_days} onChange={(e) => patchUcc({ filing_within_days: e.target.value })} />
              </Field>
              <Field label="Lead class" hint="named funder vs. agent-masked">
                <SelectOpts className="w-56" value={ucc.lead_class} onChange={(v) => patchUcc({ lead_class: v })} opts={LEAD_CLASS_OPTS} />
              </Field>
              <Field label="Business name" hint="debtor name contains">
                <input className={`${input} w-48`} placeholder="contains…" value={ucc.search} onChange={(e) => patchUcc({ search: e.target.value })} />
              </Field>
            </Group>
            <Group title="Contactability">
              <CheckRow>
                <Check checked={ucc.has_phone} onChange={(v) => patchUcc({ has_phone: v })} label="Has a phone" />
                <Check checked={ucc.has_email} onChange={(v) => patchUcc({ has_email: v })} label="Has an email" />
                <Check checked={ucc.hide_litigator} onChange={(v) => patchUcc({ hide_litigator: v })} label="Hide TCPA litigators" />
              </CheckRow>
            </Group>
            <Group title="Data quality">
              <Field label="Confidence" hint="match confidence tier(s)">
                <MultiSelect options={CONFIDENCE_OPTS} selected={ucc.confidence} onChange={(v) => patchUcc({ confidence: v })} placeholder="+ add a tier" />
              </Field>
              <Field label="Clean status" hint="where the lead is in cleaning">
                <SelectOpts className="w-52" value={ucc.status} onChange={(v) => patchUcc({ status: v })} opts={UCC_STATUS_OPTS} />
              </Field>
            </Group>
          </div>
        )}

        {source === "customers" && (
          <div className="space-y-4">
            <Group title="Location">
              <Field label="States" hint="2-letter code or full name — both match">
                <MultiSelect options={STATE_OPTS} selected={cust.states} onChange={(v) => patchCust({ states: v })} placeholder="+ add a state" />
              </Field>
              <Field label="Area codes" hint="comma-separated 3-digit codes">
                <input className={`${input} w-44`} placeholder="e.g. 305, 786" value={cust.area_codes} onChange={(e) => patchCust({ area_codes: e.target.value })} />
              </Field>
              <Field label="Zip" hint="zip starts with">
                <input className={`${input} w-32`} placeholder="prefix…" value={cust.zip_prefix} onChange={(e) => patchCust({ zip_prefix: e.target.value })} />
              </Field>
              <Field label="City" hint="City contains">
                <input className={`${input} w-40`} placeholder="contains…" value={cust.city} onChange={(e) => patchCust({ city: e.target.value })} />
              </Field>
            </Group>
            <Group title="Business">
              <Field label="Lead source" hint="how the merchant came in — Synergy live-transfer / real-time, etc.">
                <MultiSelect options={LEAD_SOURCE_OPTS} selected={cust.lead_sources} onChange={(v) => patchCust({ lead_sources: v })} placeholder="+ add a lead source" />
              </Field>
              <Field label="Industry" hint="industry contains">
                <input className={`${input} w-44`} placeholder="e.g. trucking" value={cust.industry} onChange={(e) => patchCust({ industry: e.target.value })} />
              </Field>
              <Field label="Entity type" hint="pick one or more">
                <MultiSelect options={ENTITY_TYPE_OPTS} selected={cust.entity_types} onChange={(v) => patchCust({ entity_types: v })} placeholder="+ add a type" />
              </Field>
              <Field label="Min monthly revenue" hint="monthly revenue on file (≥)">
                <input type="number" min={0} className={`${input} w-32`} placeholder="any" value={cust.min_revenue} onChange={(e) => patchCust({ min_revenue: e.target.value })} />
              </Field>
              <Field label="Max monthly revenue" hint="monthly revenue on file (≤)">
                <input type="number" min={0} className={`${input} w-32`} placeholder="any" value={cust.max_revenue} onChange={(e) => patchCust({ max_revenue: e.target.value })} />
              </Field>
              <Field label="Pipeline status" hint="stage in the CRM funnel">
                <SelectOpts className="w-52" value={cust.status} onChange={(v) => patchCust({ status: v })} opts={CUSTOMER_STATUS_OPTS} />
              </Field>
              <Field label="Business name" hint="business name contains">
                <input className={`${input} w-48`} placeholder="contains…" value={cust.search} onChange={(e) => patchCust({ search: e.target.value })} />
              </Field>
            </Group>
            <Group title="Contactability">
              <Field label="Line type" hint="mobile / landline / VoIP / toll-free">
                <MultiSelect options={LINE_TYPE_OPTS} selected={cust.line_types} onChange={(v) => patchCust({ line_types: v })} placeholder="+ add a line type" />
              </Field>
              <Field label="Phone status" hint="validated reachability">
                <SelectOpts className="w-52" value={cust.phone_status} onChange={(v) => patchCust({ phone_status: v })} opts={CUST_PHONE_STATUS_OPTS} />
              </Field>
              <CheckRow>
                <Check checked={cust.has_phone} onChange={(v) => patchCust({ has_phone: v })} label="Has a phone" />
                <Check checked={cust.has_email} onChange={(v) => patchCust({ has_email: v })} label="Has an email" />
                <Check checked={cust.exclude_dnc} onChange={(v) => patchCust({ exclude_dnc: v })} label="Exclude do-not-contact" />
              </CheckRow>
            </Group>
          </div>
        )}

        {/* Live count — auto-updates as filters change. */}
        <div className="mt-4 min-h-[1.25rem]">
          {countErr ? (
            <p className="text-xs text-rose-600 dark:text-rose-400 inline-flex items-center gap-1">
              <ExclamationTriangleIcon className="w-3.5 h-3.5" /> {countErr}
            </p>
          ) : counting ? (
            <p className="text-sm text-gray-400">Counting…</p>
          ) : count != null ? (
            count === 0 ? (
              <p className="text-sm text-amber-600 dark:text-amber-400 inline-flex items-center gap-1">
                <ExclamationTriangleIcon className="w-3.5 h-3.5" /> 0 match this filter — try widening it.
              </p>
            ) : (
              <p className="text-sm text-gray-700 dark:text-gray-200">
                {approx && <span className="text-gray-400">~</span>}
                <strong className="text-gray-900 dark:text-white tabular-nums">{count.toLocaleString()}</strong>{" "}
                {hasFilters ? "match" : "in"} {SOURCE_META[source].label}
                {!hasFilters && <span className="text-gray-400"> (everything — add filters to narrow)</span>}
                {approx && <span className="text-gray-400"> · before area-code filter (applied on save)</span>}
                {count > MAX_MEMBERS && (
                  <span className="text-amber-600 dark:text-amber-400"> · this build saves the first {MAX_MEMBERS.toLocaleString()}</span>
                )}
              </p>
            )
          ) : null}

          {/* Tiny sample so you can eyeball the slice before saving. */}
          {sample.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {sample.slice(0, 6).map((r, i) => (
                <span key={r.id ?? i} className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                  {r.business || r.contact || r.phone || "—"}
                  {r.state ? <span className="text-gray-400"> · {r.state}</span> : null}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Save ── */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
        <p className={lbl}>3 · Save as smart list</p>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="List name">
            <input className={`${input} w-64`} placeholder="e.g. TX stacked ≥2 — dialable" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Description (optional)">
            <input className={`${input} w-80`} placeholder="what this audience is for" value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <button
            onClick={save}
            disabled={saving || !name.trim() || count == null || count === 0}
            className="btn-primary inline-flex items-center gap-1.5"
            title={count == null ? "Waiting on the count" : count === 0 ? "No rows match" : "Save this audience"}
          >
            <BookmarkIcon className="w-4 h-4" /> {saving ? "Saving…" : "Save as smart list"}
          </button>
        </div>
        {count === 0 && !saving && <p className="text-[11px] text-gray-400">Nothing matches — widen the filter before saving.</p>}
        {busyNote && <p className="text-sm text-gray-500 dark:text-gray-400">{busyNote}</p>}
        {progress && (
          <div className="space-y-1">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
              <div
                className="h-full rounded-full bg-mint-green transition-all"
                style={{ width: `${progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0}%` }}
              />
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-300">
              saved {progress.done.toLocaleString()} / {progress.total.toLocaleString()} members…
            </p>
          </div>
        )}
        {saveMsg && <p className="text-sm text-emerald-700 dark:text-emerald-300">{saveMsg}</p>}
        {saveErr && <p className="text-sm text-rose-600 dark:text-rose-400">Save failed: {saveErr}</p>}
      </div>
    </div>
  );
}

/* A titled group of filter fields — keeps the builder scannable. */
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/30 p-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">{title}</p>
      <div className="flex flex-wrap items-start gap-3">{children}</div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className={lbl}>{label}</span>
      {children}
      {hint && <span className={help}>{hint}</span>}
    </div>
  );
}

function CheckRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-1.5 pt-4">{children}</div>;
}

function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="rounded" />
      {label}
    </label>
  );
}

function SelectOpts({ value, onChange, opts, className = "" }: { value: string; onChange: (v: string) => void; opts: Opt[]; className?: string }) {
  return (
    <select className={`${input} ${className}`} value={value} onChange={(e) => onChange(e.target.value)}>
      {opts.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/* Multi-select rendered as removable chips + an "add" dropdown. Used for states
   (keyed on the stored 2-letter code, so "Florida" always resolves to 'FL'),
   VibeReach tags, entity types, line types, and confidence tiers. */
function MultiSelect({
  options, selected, onChange, placeholder, width = "w-44",
}: {
  options: Opt[]; selected: string[]; onChange: (v: string[]) => void; placeholder: string; width?: string;
}) {
  const labelFor = (v: string) => options.find((o) => o.value === v)?.label ?? v;
  const available = options.filter((o) => !selected.includes(o.value));
  return (
    <div className="flex flex-col gap-1">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 max-w-[16rem]">
          {selected.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-mint-green/10 text-mint-green border border-mint-green/30"
            >
              {labelFor(v)}
              <button
                type="button"
                onClick={() => onChange(selected.filter((x) => x !== v))}
                className="hover:text-rose-500"
                aria-label={`Remove ${labelFor(v)}`}
              >
                <XMarkIcon className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <select
        className={`${input} ${width}`}
        value=""
        onChange={(e) => { if (e.target.value) onChange([...selected, e.target.value]); }}
        disabled={available.length === 0}
      >
        <option value="">{available.length === 0 ? "all added" : placeholder}</option>
        {available.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
