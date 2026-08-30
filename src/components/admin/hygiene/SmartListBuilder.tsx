// SmartListBuilder — pick ONE source store, filter it, watch the count update live,
// then save as a smart_lists row + its materialized smart_list_members (snapshot of
// business/contact/phone/email). v1 is one-source-per-list ('mixed' is deferred).
//
// UX contract (owner-driven):
//   • Each source card shows a plain-language "what this is" + a LIVE total count.
//   • State is a dropdown keyed on the stored 2-letter code — typing "Florida" can
//     never silently return 0 (the old free-text bug).
//   • Status / lead-type render as human labels, not raw enum values.
//   • The count auto-updates as filters change; with NO filters set it shows the
//     FULL source count, never 0. A genuine empty combo says so ("0 match").
//
// Filter idioms mirror the UCC Harvester (ph_ucc_leads) and Lead Machine (lead_records)
// pages so the numbers here match those consoles. Save is capped at MAX_MEMBERS to keep
// a single build bounded; the exact filter is stored in criteria so it can be rebuilt.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FunnelIcon,
  BookmarkIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
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
  type SmartList,
  type SmartListSource,
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

const input =
  "px-2.5 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100";
const lbl = "text-[11px] font-semibold uppercase tracking-wide text-gray-400";
const help = "text-[11px] text-gray-400 dark:text-gray-500 mt-1";

export default function SmartListBuilder({ onSaved }: { onSaved: (list: SmartList) => void }) {
  const [source, setSource] = useState<BuildSource>("lead_records");

  // Live total per source (raw table count) — shown on the source cards.
  const [sourceCounts, setSourceCounts] = useState<Record<BuildSource, number | null>>({
    ph_ucc: null,
    lead_records: null,
    customers: null,
  });

  // Name / description of the list being saved.
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  // ── UCC (ph_ucc_leads) filters ──
  const [uccState, setUccState] = useState("");
  const [uccStatus, setUccStatus] = useState("");
  const [uccMinStack, setUccMinStack] = useState("");
  const [uccSearch, setUccSearch] = useState("");
  const [uccHasContact, setUccHasContact] = useState(false); // opt-in: phone OR email present

  // ── Purchased (lead_records) filters ──
  const [lrType, setLrType] = useState("");
  const [lrStatus, setLrStatus] = useState("");
  const [lrState, setLrState] = useState("");
  const [lrSearch, setLrSearch] = useState("");

  // ── Customers filters ──
  const [custStatus, setCustStatus] = useState("");
  const [custSearch, setCustSearch] = useState("");

  const [count, setCount] = useState<number | null>(null);
  const [countErr, setCountErr] = useState<string | null>(null);
  const [counting, setCounting] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  /* Whether ANY filter is set for the current source (drives the empty-state copy). */
  const hasFilters = useMemo(() => {
    if (source === "ph_ucc") return !!(uccState || uccStatus || uccMinStack || uccSearch.trim() || uccHasContact);
    if (source === "lead_records") return !!(lrType || lrStatus || lrState || lrSearch.trim());
    return !!(custStatus || custSearch.trim());
  }, [source, uccState, uccStatus, uccMinStack, uccSearch, uccHasContact, lrType, lrStatus, lrState, lrSearch, custStatus, custSearch]);

  /* The saved filter (criteria jsonb) for the current source + inputs. */
  const criteria = useMemo((): Record<string, unknown> => {
    if (source === "ph_ucc")
      return { state: uccState || null, status: uccStatus || null, min_stack: uccMinStack || null, search: uccSearch.trim() || null, has_contact: uccHasContact };
    if (source === "lead_records")
      return { lead_type: lrType || null, status: lrStatus || null, state: lrState || null, search: lrSearch.trim() || null };
    return { status: custStatus || null, search: custSearch.trim() || null };
  }, [source, uccState, uccStatus, uccMinStack, uccSearch, uccHasContact, lrType, lrStatus, lrState, lrSearch, custStatus, custSearch]);

  /* Build the filtered query for the current source. Callers add .range()/count opts.
     No default filters are applied — an empty filter set returns the whole book, so
     the preview with nothing set equals the source's card total (never 0). */
  const buildQuery = useCallback(
    (select: string, opts: { count?: "exact"; head?: boolean } = {}) => {
      if (source === "ph_ucc") {
        let q = supabase.from("ph_ucc_leads").select(select, opts).order("score", { ascending: false, nullsFirst: false });
        if (uccState) q = q.eq("state", uccState); // already a stored 2-letter code
        if (uccStatus) q = q.eq("status", uccStatus);
        if (uccMinStack) q = q.gte("stack_depth", Number(uccMinStack) || 0);
        if (uccSearch.trim()) q = q.ilike("debtor_name", `%${uccSearch.trim()}%`);
        if (uccHasContact) q = q.or("phone.not.is.null,email.not.is.null");
        return q;
      }
      if (source === "lead_records") {
        let q = supabase.from("lead_records").select(select, opts).order("created_at", { ascending: false });
        if (lrType) q = q.eq("lead_type", lrType);
        if (lrStatus) q = q.eq("status", lrStatus);
        if (lrState) q = q.eq("state", lrState); // already a stored 2-letter code
        if (lrSearch.trim()) q = q.ilike("company", `%${lrSearch.trim()}%`);
        return q;
      }
      // customers
      let q = supabase.from("customers").select(select, opts).order("created_at", { ascending: false });
      if (custStatus) q = q.eq("status", custStatus);
      if (custSearch.trim()) q = q.ilike("business_name", `%${custSearch.trim()}%`);
      return q;
    },
    [source, uccState, uccStatus, uccMinStack, uccSearch, uccHasContact, lrType, lrStatus, lrState, lrSearch, custStatus, custSearch],
  );

  /* Live source totals (raw table counts) for the source cards. */
  useEffect(() => {
    let alive = true;
    (async () => {
      const entries = Object.entries(SOURCE_META) as [BuildSource, (typeof SOURCE_META)[BuildSource]][];
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

  /* Auto-preview: re-run the count whenever the source or any filter changes.
     Debounced so typing in a search box doesn't fire a query per keystroke. */
  useEffect(() => {
    setSaveMsg(null);
    setCounting(true);
    setCountErr(null);
    const t = setTimeout(async () => {
      try {
        const { count: c, error } = await buildQuery("id", { count: "exact", head: true });
        if (error) {
          if (isMissingRelation(error)) throw new Error(`${SOURCE_META[source].table} is not available yet.`);
          throw error;
        }
        setCount(c ?? 0);
      } catch (e) {
        setCount(null);
        setCountErr(e instanceof Error ? e.message : String(e));
      } finally {
        setCounting(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [buildQuery, source]);

  const save = useCallback(async () => {
    if (!name.trim()) {
      setSaveErr("Give the list a name first.");
      return;
    }
    setSaving(true);
    setSaveErr(null);
    setSaveMsg(null);
    setProgress(null);
    try {
      const createdBy = await currentProfileId();

      // 1) Gather up to MAX_MEMBERS matching rows (with snapshot columns).
      const rows: Record<string, unknown>[] = [];
      let offset = 0;
      while (rows.length < MAX_MEMBERS) {
        const want = Math.min(PAGE, MAX_MEMBERS - rows.length);
        const { data, error } = await buildQuery(SNAPSHOT_SELECT[source]).range(offset, offset + want - 1);
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
        supabase
          .from("smart_lists")
          .insert({
            name: name.trim(),
            description: description.trim() || null,
            source,
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
          source,
          source_id: String(r.id),
          snapshot: snapshotFromRow(source, r),
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
      // Reset name so the next save doesn't collide; keep filters for a quick re-save.
      setName("");
      setDescription("");
      onSaved(updated);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
      setProgress(null);
    }
  }, [name, description, source, criteria, buildQuery, onSaved]);

  return (
    <div className="space-y-5">
      {/* ── Source picker ── */}
      <div>
        <p className={`${lbl} mb-2`}>1 · Pick a source</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {(Object.keys(SOURCE_META) as BuildSource[]).map((s) => {
            const meta = SOURCE_META[s];
            const active = source === s;
            const c = sourceCounts[s];
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
                  {c == null ? "counting…" : `${c.toLocaleString()} leads`}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Filters ── */}
      <div>
        <p className={`${lbl} mb-2 flex items-center gap-1.5`}>
          <FunnelIcon className="w-3.5 h-3.5" /> 2 · Filter the {SOURCE_META[source].label.toLowerCase()}
          <span className="normal-case font-normal text-gray-400"> — leave everything blank to include the whole book</span>
        </p>
        <div className="flex flex-wrap items-end gap-3">
          {source === "ph_ucc" && (
            <>
              <Field label="State" hint="Matches the stored 2-letter code">
                <StateSelect value={uccState} onChange={setUccState} />
              </Field>
              <Field label="Status" hint="Where the lead is in cleaning">
                <SelectOpts className="w-52" value={uccStatus} onChange={setUccStatus} opts={UCC_STATUS_OPTS} />
              </Field>
              <Field label="Min open advances" hint="Stacking depth on file">
                <input type="number" min={0} className={`${input} w-32`} placeholder="any" value={uccMinStack} onChange={(e) => setUccMinStack(e.target.value)} />
              </Field>
              <Field label="Business name">
                <input className={`${input} w-52`} placeholder="contains…" value={uccSearch} onChange={(e) => setUccSearch(e.target.value)} />
              </Field>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200 pb-1.5">
                <input type="checkbox" checked={uccHasContact} onChange={(e) => setUccHasContact(e.target.checked)} className="rounded" />
                Has phone or email
              </label>
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
              <Field label="State" hint="Matches the stored 2-letter code">
                <StateSelect value={lrState} onChange={setLrState} />
              </Field>
              <Field label="Company name">
                <input className={`${input} w-52`} placeholder="contains…" value={lrSearch} onChange={(e) => setLrSearch(e.target.value)} />
              </Field>
            </>
          )}
          {source === "customers" && (
            <>
              <Field label="Pipeline status" hint="Stage in the CRM funnel">
                <SelectOpts className="w-52" value={custStatus} onChange={setCustStatus} opts={CUSTOMER_STATUS_OPTS} />
              </Field>
              <Field label="Business name">
                <input className={`${input} w-52`} placeholder="contains…" value={custSearch} onChange={(e) => setCustSearch(e.target.value)} />
              </Field>
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
                {hasFilters ? "match" : "in"} {SOURCE_META[source].label.toLowerCase()}
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

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className={lbl}>{label}</span>
      {children}
      {hint && <span className={help}>{hint}</span>}
    </div>
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

/* State dropdown keyed on the stored 2-letter code. A dropdown (not free text) is
   what guarantees "Florida" resolves to 'FL' and never silently returns 0. */
function StateSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select className={`${input} w-44`} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Any state</option>
      {US_STATES.map((s) => (
        <option key={s.code} value={s.code}>
          {s.name} ({s.code})
        </option>
      ))}
    </select>
  );
}
