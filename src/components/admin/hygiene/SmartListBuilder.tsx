// SmartListBuilder — pick ONE source store, filter it, watch the count update live,
// then save as a smart_lists row + its materialized smart_list_members (snapshot of
// business/contact/phone/email). v1 is one-source-per-list ('mixed' is deferred).
//
// UX contract (owner-driven):
//   • Each source card shows a plain-language "what this is" + a LIVE total count.
//     GoHighLevel is the FIRST / default card — the owner's primary use case is
//     searching his 162k CRM contacts by TAG.
//   • State is a MULTI-select keyed on the stored 2-letter code — typing "Florida"
//     can never silently return 0 (the old free-text bug). Picks render as chips.
//   • Status / lead-type render as human labels, not raw enum values.
//   • The count auto-updates as filters change; with NO filters set it shows the
//     FULL source count, never 0. A genuine empty combo says so ("0 match").
//
// The three Supabase sources (UCC Harvester / Lead Machine / Customers) are queried
// directly. GoHighLevel goes through the ghl-contacts-search edge fn: {action:'tags'}
// loads the tag list, {action:'preview'} gives the live count, and, on save,
// {action:'materialize'} pages the matches into smart_list_members (the backend caps
// and parks against the GHL daily call budget — we just surface what it reports).

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
  SNAPSHOT_SELECT,
  US_STATES,
  snapshotFromRow,
  currentProfileId,
  isMissingRelation,
  fnErrorMessage,
  type SmartList,
  type SmartListSource,
  type DbSource,
} from "./hygiene";

type BuildSource = Exclude<SmartListSource, "mixed">;
type Opt = { value: string; label: string };

const MAX_MEMBERS = 5000; // a single build materializes at most this many members
const PAGE = 1000; // pagination window when gathering rows

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

/* State options for the multi-select (value = stored 2-letter code). */
const STATE_OPTS: Opt[] = US_STATES.map((s) => ({ value: s.code, label: `${s.name} (${s.code})` }));

const input =
  "px-2.5 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100";
const lbl = "text-[11px] font-semibold uppercase tracking-wide text-gray-400";
const help = "text-[11px] text-gray-400 dark:text-gray-500 mt-1";

export default function SmartListBuilder({ onSaved }: { onSaved: (list: SmartList) => void }) {
  const [source, setSource] = useState<BuildSource>("ghl");

  // Live total per source (raw table count / GHL preview) — shown on the source cards.
  const [sourceCounts, setSourceCounts] = useState<Record<BuildSource, number | null>>({
    ghl: null,
    ph_ucc: null,
    lead_records: null,
    customers: null,
  });

  // Name / description of the list being saved.
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  // ── GoHighLevel (edge fn) filters ──
  const [ghlTags, setGhlTags] = useState<string[]>([]);
  const [ghlTagMode, setGhlTagMode] = useState<"and" | "or">("or");
  const [ghlQuery, setGhlQuery] = useState("");
  const [ghlTagList, setGhlTagList] = useState<{ id: string; name: string }[]>([]);
  const [ghlTagsLoading, setGhlTagsLoading] = useState(false);
  const [ghlTagsErr, setGhlTagsErr] = useState<string | null>(null);

  // ── UCC (ph_ucc_leads) filters ──
  const [uccStates, setUccStates] = useState<string[]>([]);
  const [uccStatus, setUccStatus] = useState("");
  const [uccMinStack, setUccMinStack] = useState("");
  const [uccCity, setUccCity] = useState("");
  const [uccSearch, setUccSearch] = useState("");
  const [uccHasPhone, setUccHasPhone] = useState(false);
  const [uccHasEmail, setUccHasEmail] = useState(false);

  // ── Purchased (lead_records) filters ──
  const [lrType, setLrType] = useState("");
  const [lrStatus, setLrStatus] = useState("");
  const [lrStates, setLrStates] = useState<string[]>([]);
  const [lrCity, setLrCity] = useState("");
  const [lrMinRevenue, setLrMinRevenue] = useState("");
  const [lrIndustry, setLrIndustry] = useState("");
  const [lrSearch, setLrSearch] = useState("");
  const [lrHasEmail, setLrHasEmail] = useState(false);

  // ── Customers filters ──
  const [custStatus, setCustStatus] = useState("");
  const [custStates, setCustStates] = useState<string[]>([]);
  const [custCity, setCustCity] = useState("");
  const [custIndustry, setCustIndustry] = useState("");
  const [custMinRevenue, setCustMinRevenue] = useState("");
  const [custSearch, setCustSearch] = useState("");
  const [custHasPhone, setCustHasPhone] = useState(false);
  const [custHasEmail, setCustHasEmail] = useState(false);

  const [count, setCount] = useState<number | null>(null);
  const [countErr, setCountErr] = useState<string | null>(null);
  const [counting, setCounting] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [busyNote, setBusyNote] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  /* The GHL filter payload for the edge fn (tags / mode / free text). */
  const ghlFilters = useMemo(
    () => ({ tags: ghlTags, tagMode: ghlTagMode, query: ghlQuery.trim() || undefined }),
    [ghlTags, ghlTagMode, ghlQuery],
  );

  /* Whether ANY filter is set for the current source (drives the empty-state copy). */
  const hasFilters = useMemo(() => {
    if (source === "ghl") return !!(ghlTags.length || ghlQuery.trim());
    if (source === "ph_ucc")
      return !!(uccStates.length || uccStatus || uccMinStack || uccCity.trim() || uccSearch.trim() || uccHasPhone || uccHasEmail);
    if (source === "lead_records")
      return !!(lrType || lrStatus || lrStates.length || lrCity.trim() || lrMinRevenue || lrIndustry.trim() || lrSearch.trim() || lrHasEmail);
    return !!(custStatus || custStates.length || custCity.trim() || custIndustry.trim() || custMinRevenue || custSearch.trim() || custHasPhone || custHasEmail);
  }, [
    source, ghlTags, ghlQuery,
    uccStates, uccStatus, uccMinStack, uccCity, uccSearch, uccHasPhone, uccHasEmail,
    lrType, lrStatus, lrStates, lrCity, lrMinRevenue, lrIndustry, lrSearch, lrHasEmail,
    custStatus, custStates, custCity, custIndustry, custMinRevenue, custSearch, custHasPhone, custHasEmail,
  ]);

  /* The saved filter (criteria jsonb) for the current source + inputs. */
  const criteria = useMemo((): Record<string, unknown> => {
    if (source === "ghl")
      return { tags: ghlTags, tag_mode: ghlTagMode, query: ghlQuery.trim() || null };
    if (source === "ph_ucc")
      return {
        states: uccStates, status: uccStatus || null, min_stack: uccMinStack || null,
        city: uccCity.trim() || null, search: uccSearch.trim() || null,
        has_phone: uccHasPhone, has_email: uccHasEmail,
      };
    if (source === "lead_records")
      return {
        lead_type: lrType || null, status: lrStatus || null, states: lrStates,
        city: lrCity.trim() || null, min_revenue: lrMinRevenue || null,
        industry: lrIndustry.trim() || null, search: lrSearch.trim() || null, has_email: lrHasEmail,
      };
    return {
      status: custStatus || null, states: custStates, city: custCity.trim() || null,
      industry: custIndustry.trim() || null, min_revenue: custMinRevenue || null,
      search: custSearch.trim() || null, has_phone: custHasPhone, has_email: custHasEmail,
    };
  }, [
    source, ghlTags, ghlTagMode, ghlQuery,
    uccStates, uccStatus, uccMinStack, uccCity, uccSearch, uccHasPhone, uccHasEmail,
    lrType, lrStatus, lrStates, lrCity, lrMinRevenue, lrIndustry, lrSearch, lrHasEmail,
    custStatus, custStates, custCity, custIndustry, custMinRevenue, custSearch, custHasPhone, custHasEmail,
  ]);

  /* Build the filtered query for a SUPABASE source (never GHL). Callers add
     .range()/count opts. No default filters are applied — an empty filter set
     returns the whole book, so the preview with nothing set equals the source's
     card total (never 0). */
  const buildQuery = useCallback(
    (select: string, opts: { count?: "exact"; head?: boolean } = {}) => {
      if (source === "ph_ucc") {
        let q = supabase.from("ph_ucc_leads").select(select, opts).order("score", { ascending: false, nullsFirst: false });
        if (uccStates.length) q = q.in("state", uccStates); // stored 2-letter codes
        if (uccStatus) q = q.eq("status", uccStatus);
        if (uccMinStack) q = q.gte("stack_depth", Number(uccMinStack) || 0);
        if (uccCity.trim()) q = q.ilike("debtor_city", `%${uccCity.trim()}%`);
        if (uccSearch.trim()) q = q.ilike("debtor_name", `%${uccSearch.trim()}%`);
        if (uccHasPhone) q = q.not("phone", "is", null);
        if (uccHasEmail) q = q.not("email", "is", null);
        return q;
      }
      if (source === "lead_records") {
        let q = supabase.from("lead_records").select(select, opts).order("created_at", { ascending: false });
        if (lrType) q = q.eq("lead_type", lrType);
        if (lrStatus) q = q.eq("status", lrStatus);
        if (lrStates.length) q = q.in("state", lrStates); // stored 2-letter codes
        if (lrCity.trim()) q = q.ilike("city", `%${lrCity.trim()}%`);
        if (lrMinRevenue) q = q.gte("revenue", Number(lrMinRevenue) || 0);
        if (lrIndustry.trim()) q = q.ilike("industry_bucket", `%${lrIndustry.trim()}%`);
        if (lrSearch.trim()) q = q.ilike("company", `%${lrSearch.trim()}%`);
        if (lrHasEmail) q = q.eq("has_any_email", true);
        return q;
      }
      // customers — address_state may hold a code OR a full name, so match both.
      let q = supabase.from("customers").select(select, opts).order("created_at", { ascending: false });
      if (custStatus) q = q.eq("status", custStatus);
      if (custStates.length) q = q.in("address_state", expandStates(custStates));
      if (custCity.trim()) q = q.ilike("address_city", `%${custCity.trim()}%`);
      if (custIndustry.trim()) q = q.ilike("industry", `%${custIndustry.trim()}%`);
      if (custMinRevenue) q = q.gte("monthly_revenue", Number(custMinRevenue) || 0);
      if (custSearch.trim()) q = q.ilike("business_name", `%${custSearch.trim()}%`);
      if (custHasPhone) q = q.not("phone", "is", null);
      if (custHasEmail) q = q.not("email", "is", null);
      return q;
    },
    [
      source,
      uccStates, uccStatus, uccMinStack, uccCity, uccSearch, uccHasPhone, uccHasEmail,
      lrType, lrStatus, lrStates, lrCity, lrMinRevenue, lrIndustry, lrSearch, lrHasEmail,
      custStatus, custStates, custCity, custIndustry, custMinRevenue, custSearch, custHasPhone, custHasEmail,
    ],
  );

  /* Live source totals (Supabase table counts) for the non-virtual source cards. */
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
    return () => {
      alive = false;
    };
  }, []);

  /* Live GHL card count — one preview call with no filters (the whole book). */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("ghl-contacts-search", {
          body: { action: "preview", filters: {} },
        });
        if (error || (data as { error?: string })?.error) return; // leave null; blurb still states the number
        if (alive) setSourceCounts((prev) => ({ ...prev, ghl: (data as { total?: number })?.total ?? null }));
      } catch {
        /* ignore — the card falls back to "counting…" and the blurb carries the number */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /* Load the GHL tag list the first time the GHL source is opened. */
  useEffect(() => {
    if (source !== "ghl" || ghlTagList.length > 0 || ghlTagsLoading) return;
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
    return () => {
      alive = false;
    };
  }, [source, ghlTagList.length, ghlTagsLoading]);

  /* Auto-preview: re-run the count whenever the source or any filter changes.
     Debounced so typing in a search box doesn't fire a query per keystroke. */
  useEffect(() => {
    setSaveMsg(null);
    setCounting(true);
    setCountErr(null);
    const t = setTimeout(async () => {
      try {
        if (source === "ghl") {
          const { data, error } = await supabase.functions.invoke("ghl-contacts-search", {
            body: { action: "preview", filters: ghlFilters },
          });
          if (error) throw new Error(await fnErrorMessage(error));
          const err = (data as { error?: string })?.error;
          if (err) throw new Error(err);
          setCount((data as { total?: number })?.total ?? 0);
        } else {
          const { count: c, error } = await buildQuery("id", { count: "exact", head: true });
          if (error) {
            if (isMissingRelation(error)) throw new Error(`${SOURCE_META[source].table} is not available yet.`);
            throw error;
          }
          setCount(c ?? 0);
        }
      } catch (e) {
        setCount(null);
        setCountErr(e instanceof Error ? e.message : String(e));
      } finally {
        setCounting(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [buildQuery, source, ghlFilters]);

  /* Save the GHL source: create the row, then materialize via the edge fn. */
  const saveGhl = useCallback(async () => {
    const createdBy = await currentProfileId();
    const [list] = await mustWrite<SmartList>(
      "create smart_list",
      supabase.from("smart_lists").insert({
        name: name.trim(),
        description: description.trim() || null,
        source: "ghl",
        criteria,
        created_by: createdBy,
        member_count: 0,
      }),
    );

    setBusyNote("Loading contacts from GoHighLevel… this can take a moment.");
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
    // Re-read the finalized row so the caller gets the backend-stamped count/time.
    const { data: fresh } = await supabase.from("smart_lists").select("*").eq("id", list.id).single();
    const updated = (fresh as SmartList | null) ?? { ...list, member_count: res.member_count ?? inserted };

    let msg = `Saved "${updated.name}" — ${inserted.toLocaleString()} contacts loaded (of ${total.toLocaleString()} matched).`;
    if (res.capped) msg += ` Capped at ${inserted.toLocaleString()} — narrow the tag to load the rest.`;
    else if (res.parked) msg += " Paused — GHL daily cap almost hit, resumes later.";
    setSaveMsg(msg);
    onSaved(updated);
  }, [name, description, criteria, ghlFilters, onSaved]);

  /* Save a Supabase source: gather rows client-side, insert list + members. */
  const saveDb = useCallback(async () => {
    const dbSource = source as DbSource;
    const createdBy = await currentProfileId();

    // 1) Gather up to MAX_MEMBERS matching rows (with snapshot columns).
    const rows: Record<string, unknown>[] = [];
    let offset = 0;
    while (rows.length < MAX_MEMBERS) {
      const want = Math.min(PAGE, MAX_MEMBERS - rows.length);
      const { data, error } = await buildQuery(SNAPSHOT_SELECT[dbSource]).range(offset, offset + want - 1);
      if (error) throw error;
      const chunk = (data as unknown as Record<string, unknown>[]) ?? [];
      rows.push(...chunk);
      if (chunk.length < want) break; // drained
      offset += chunk.length;
    }
    if (rows.length === 0) throw new Error("No rows match this filter — nothing to save.");

    // 2) Insert the smart_lists row (need its id back).
    const [list] = await mustWrite<SmartList>(
      "create smart_list",
      supabase.from("smart_lists").insert({
        name: name.trim(),
        description: description.trim() || null,
        source: dbSource,
        criteria,
        created_by: createdBy,
        member_count: 0,
      }),
    );

    // 3) Insert members in chunks with a denormalized snapshot.
    const CHUNK = 500;
    let inserted = 0;
    setProgress({ done: 0, total: rows.length });
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const members = slice.map((r) => ({
        smart_list_id: list.id,
        source: dbSource,
        source_id: String(r.id),
        snapshot: snapshotFromRow(dbSource, r),
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
  }, [source, name, description, criteria, buildQuery, onSaved]);

  const save = useCallback(async () => {
    if (!name.trim()) {
      setSaveErr("Give the list a name first.");
      return;
    }
    setSaving(true);
    setSaveErr(null);
    setSaveMsg(null);
    setBusyNote(null);
    setProgress(null);
    try {
      if (source === "ghl") await saveGhl();
      else await saveDb();
      // Reset name so the next save doesn't collide; keep filters for a quick re-save.
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
        <div className="flex flex-wrap items-start gap-3">
          {source === "ghl" && (
            <>
              <Field label="Tags" hint={ghlTagsErr ? ghlTagsErr : ghlTagsLoading ? "loading tags…" : "pick one or more CRM tags"}>
                <MultiSelect
                  options={ghlTagList.map((t) => ({ value: t.name, label: t.name }))}
                  selected={ghlTags}
                  onChange={setGhlTags}
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
                      onClick={() => setGhlTagMode(m)}
                      className={`px-3 py-1.5 text-sm ${
                        ghlTagMode === m
                          ? "bg-mint-green text-white"
                          : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300"
                      }`}
                    >
                      {m === "or" ? "ANY" : "ALL"}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Search" hint="name / email / phone contains">
                <input className={`${input} w-52`} placeholder="free text…" value={ghlQuery} onChange={(e) => setGhlQuery(e.target.value)} />
              </Field>
            </>
          )}
          {source === "ph_ucc" && (
            <>
              <Field label="States" hint="Matches the stored 2-letter code">
                <MultiSelect options={STATE_OPTS} selected={uccStates} onChange={setUccStates} placeholder="+ add a state" />
              </Field>
              <Field label="Status" hint="Where the lead is in cleaning">
                <SelectOpts className="w-52" value={uccStatus} onChange={setUccStatus} opts={UCC_STATUS_OPTS} />
              </Field>
              <Field label="Min open advances" hint="Stacking depth on file">
                <input type="number" min={0} className={`${input} w-32`} placeholder="any" value={uccMinStack} onChange={(e) => setUccMinStack(e.target.value)} />
              </Field>
              <Field label="City" hint="Debtor city contains">
                <input className={`${input} w-44`} placeholder="contains…" value={uccCity} onChange={(e) => setUccCity(e.target.value)} />
              </Field>
              <Field label="Business name">
                <input className={`${input} w-52`} placeholder="contains…" value={uccSearch} onChange={(e) => setUccSearch(e.target.value)} />
              </Field>
              <CheckRow>
                <Check checked={uccHasPhone} onChange={setUccHasPhone} label="Has phone" />
                <Check checked={uccHasEmail} onChange={setUccHasEmail} label="Has email" />
              </CheckRow>
            </>
          )}
          {source === "lead_records" && (
            <>
              <Field label="Lead type" hint="Aged, Trigger, or UCC">
                <SelectOpts className="w-44" value={lrType} onChange={setLrType} opts={LEAD_TYPE_OPTS} />
              </Field>
              <Field label="Status" hint="Loaded vs. pushed to the dialer">
                <SelectOpts className="w-52" value={lrStatus} onChange={setLrStatus} opts={LEAD_STATUS_OPTS} />
              </Field>
              <Field label="States" hint="Matches the stored 2-letter code">
                <MultiSelect options={STATE_OPTS} selected={lrStates} onChange={setLrStates} placeholder="+ add a state" />
              </Field>
              <Field label="City" hint="City contains">
                <input className={`${input} w-44`} placeholder="contains…" value={lrCity} onChange={(e) => setLrCity(e.target.value)} />
              </Field>
              <Field label="Min revenue" hint="Annual revenue on file (≥)">
                <input type="number" min={0} className={`${input} w-36`} placeholder="any" value={lrMinRevenue} onChange={(e) => setLrMinRevenue(e.target.value)} />
              </Field>
              <Field label="Industry" hint="Industry bucket contains">
                <input className={`${input} w-44`} placeholder="e.g. construction" value={lrIndustry} onChange={(e) => setLrIndustry(e.target.value)} />
              </Field>
              <Field label="Company name">
                <input className={`${input} w-52`} placeholder="contains…" value={lrSearch} onChange={(e) => setLrSearch(e.target.value)} />
              </Field>
              <CheckRow>
                <Check checked={lrHasEmail} onChange={setLrHasEmail} label="Has email" />
              </CheckRow>
            </>
          )}
          {source === "customers" && (
            <>
              <Field label="Pipeline status" hint="Stage in the CRM funnel">
                <SelectOpts className="w-52" value={custStatus} onChange={setCustStatus} opts={CUSTOMER_STATUS_OPTS} />
              </Field>
              <Field label="States" hint="2-letter code or full name — both match">
                <MultiSelect options={STATE_OPTS} selected={custStates} onChange={setCustStates} placeholder="+ add a state" />
              </Field>
              <Field label="City" hint="City contains">
                <input className={`${input} w-44`} placeholder="contains…" value={custCity} onChange={(e) => setCustCity(e.target.value)} />
              </Field>
              <Field label="Industry" hint="Industry contains">
                <input className={`${input} w-44`} placeholder="e.g. trucking" value={custIndustry} onChange={(e) => setCustIndustry(e.target.value)} />
              </Field>
              <Field label="Min monthly revenue" hint="Monthly revenue on file (≥)">
                <input type="number" min={0} className={`${input} w-36`} placeholder="any" value={custMinRevenue} onChange={(e) => setCustMinRevenue(e.target.value)} />
              </Field>
              <Field label="Business name">
                <input className={`${input} w-52`} placeholder="contains…" value={custSearch} onChange={(e) => setCustSearch(e.target.value)} />
              </Field>
              <CheckRow>
                <Check checked={custHasPhone} onChange={setCustHasPhone} label="Has phone" />
                <Check checked={custHasEmail} onChange={setCustHasEmail} label="Has email" />
              </CheckRow>
            </>
          )}
        </div>

        {/* Live count — auto-updates as filters change. */}
        <div className="mt-3 min-h-[1.25rem]">
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
                <strong className="text-gray-900 dark:text-white tabular-nums">{count.toLocaleString()}</strong>{" "}
                {hasFilters ? "match" : "in"} {SOURCE_META[source].label}
                {!hasFilters && <span className="text-gray-400"> (everything — add filters to narrow)</span>}
                {count > MAX_MEMBERS && (
                  <span className="text-amber-600 dark:text-amber-400"> · this build saves the first {MAX_MEMBERS.toLocaleString()}</span>
                )}
              </p>
            )
          ) : null}
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

/* Expand selected state codes to [code, full name] so customers rows that store
   the full state name ('Florida') match a 'FL' pick — and vice-versa. */
function expandStates(codes: string[]): string[] {
  const out = new Set<string>();
  for (const code of codes) {
    out.add(code);
    const name = US_STATES.find((s) => s.code === code)?.name;
    if (name) out.add(name);
  }
  return [...out];
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
   (keyed on the stored 2-letter code, so "Florida" always resolves to 'FL') and
   for GHL tags. Adding one at a time via a plain <select> keeps it robust in both
   light/dark with no popover/blur juggling. */
function MultiSelect({
  options,
  selected,
  onChange,
  placeholder,
  width = "w-44",
}: {
  options: Opt[];
  selected: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  width?: string;
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
        onChange={(e) => {
          if (e.target.value) onChange([...selected, e.target.value]);
        }}
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
