// SmartListBuilder — pick ONE source store, filter it, preview the count, then save
// as a smart_lists row + its materialized smart_list_members (snapshot of
// business/contact/phone/email). v1 is one-source-per-list ('mixed' is deferred).
//
// Filter idioms mirror the UCC Harvester (ph_ucc_leads) and Lead Machine (lead_records)
// pages so the numbers here match those consoles. Save is capped at MAX_MEMBERS to keep
// a single build bounded; the exact filter is stored in criteria so it can be rebuilt.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FunnelIcon,
  BookmarkIcon,
  MagnifyingGlassIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
} from "@heroicons/react/24/outline";
import supabase from "@/supabase";
import { mustWrite } from "@/supabase/writes";
import {
  SOURCE_META,
  SNAPSHOT_SELECT,
  snapshotFromRow,
  currentProfileId,
  isMissingRelation,
  type SmartList,
  type SmartListSource,
} from "./hygiene";

type BuildSource = Exclude<SmartListSource, "mixed">;

const MAX_MEMBERS = 5000; // a single build materializes at most this many members
const PAGE = 1000; // pagination window when gathering rows

/* Status option lists (mirror the sibling pages). */
const UCC_STATUSES = ["matched", "needs_skiptrace", "needs_scrub", "ready", "loaded", "email_only", "no_match"];
const LEAD_TYPES = ["ucc", "aged", "trigger"];
const LEAD_STATUSES = ["loaded", "pushed", "skipped", "error"];
const CUSTOMER_STATUSES = [
  "lead",
  "contacted",
  "application_submitted",
  "in_review",
  "approved",
  "funded",
  "renewed",
  "declined",
  "follow_up",
];

const input =
  "px-2.5 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100";
const lbl = "text-[11px] font-semibold uppercase tracking-wide text-gray-400";

export default function SmartListBuilder({ onSaved }: { onSaved: (list: SmartList) => void }) {
  const [source, setSource] = useState<BuildSource>("ph_ucc");

  // Name / description of the list being saved.
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  // ── UCC filters ──
  const [uccState, setUccState] = useState("");
  const [uccStatus, setUccStatus] = useState("");
  const [uccMinStack, setUccMinStack] = useState("");
  const [uccSearch, setUccSearch] = useState("");
  const [uccHasContact, setUccHasContact] = useState(true); // phone OR email present

  // ── lead_records filters ──
  const [lrType, setLrType] = useState("");
  const [lrStatus, setLrStatus] = useState("");
  const [lrState, setLrState] = useState("");
  const [lrSearch, setLrSearch] = useState("");

  // ── customers filters ──
  const [custStatus, setCustStatus] = useState("");
  const [custSearch, setCustSearch] = useState("");

  const [count, setCount] = useState<number | null>(null);
  const [countErr, setCountErr] = useState<string | null>(null);
  const [counting, setCounting] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  /* The saved filter (criteria jsonb) for the current source + inputs. */
  const criteria = useMemo((): Record<string, unknown> => {
    if (source === "ph_ucc")
      return { state: uccState || null, status: uccStatus || null, min_stack: uccMinStack || null, search: uccSearch.trim() || null, has_contact: uccHasContact };
    if (source === "lead_records")
      return { lead_type: lrType || null, status: lrStatus || null, state: lrState || null, search: lrSearch.trim() || null };
    return { status: custStatus || null, search: custSearch.trim() || null };
  }, [source, uccState, uccStatus, uccMinStack, uccSearch, uccHasContact, lrType, lrStatus, lrState, lrSearch, custStatus, custSearch]);

  /* Build the filtered query for the current source. Callers add .range()/count opts. */
  const buildQuery = useCallback(
    (select: string, opts: { count?: "exact"; head?: boolean } = {}) => {
      if (source === "ph_ucc") {
        let q = supabase.from("ph_ucc_leads").select(select, opts).order("score", { ascending: false, nullsFirst: false });
        if (uccState.trim()) q = q.eq("state", uccState.trim().toUpperCase());
        if (uccStatus) q = q.eq("status", uccStatus);
        else q = q.neq("status", "suppressed"); // hide junk by default
        if (uccMinStack) q = q.gte("stack_depth", Number(uccMinStack) || 0);
        if (uccSearch.trim()) q = q.ilike("debtor_name", `%${uccSearch.trim()}%`);
        if (uccHasContact) q = q.or("phone.not.is.null,email.not.is.null");
        return q;
      }
      if (source === "lead_records") {
        let q = supabase.from("lead_records").select(select, opts).order("created_at", { ascending: false });
        if (lrType) q = q.eq("lead_type", lrType);
        if (lrStatus) q = q.eq("status", lrStatus);
        if (lrState.trim()) q = q.eq("state", lrState.trim().toUpperCase());
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

  // A filter change invalidates a stale count (a save must follow a fresh preview).
  useEffect(() => {
    setCount(null);
    setCountErr(null);
    setSaveMsg(null);
  }, [criteria]);

  const runPreview = useCallback(async () => {
    setCounting(true);
    setCountErr(null);
    setCount(null);
    try {
      const { count: c, error } = await buildQuery("id", { count: "exact", head: true });
      if (error) {
        if (isMissingRelation(error)) throw new Error(`${SOURCE_META[source].table} is not available yet.`);
        throw error;
      }
      setCount(c ?? 0);
    } catch (e) {
      setCountErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCounting(false);
    }
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
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Filters ── */}
      <div>
        <p className={`${lbl} mb-2 flex items-center gap-1.5`}>
          <FunnelIcon className="w-3.5 h-3.5" /> 2 · Filter the {SOURCE_META[source].label.toLowerCase()}
        </p>
        <div className="flex flex-wrap items-end gap-3">
          {source === "ph_ucc" && (
            <>
              <Field label="State">
                <input className={`${input} w-24`} placeholder="e.g. TX" value={uccState} onChange={(e) => setUccState(e.target.value)} />
              </Field>
              <Field label="Status">
                <select className={`${input} w-44`} value={uccStatus} onChange={(e) => setUccStatus(e.target.value)}>
                  <option value="">any (not suppressed)</option>
                  {UCC_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Min open advances">
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
              <Field label="Lead type">
                <select className={`${input} w-40`} value={lrType} onChange={(e) => setLrType(e.target.value)}>
                  <option value="">any type</option>
                  {LEAD_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Status">
                <select className={`${input} w-40`} value={lrStatus} onChange={(e) => setLrStatus(e.target.value)}>
                  <option value="">any status</option>
                  {LEAD_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="State (UCC lists)">
                <input className={`${input} w-24`} placeholder="e.g. TX" value={lrState} onChange={(e) => setLrState(e.target.value)} />
              </Field>
              <Field label="Company name">
                <input className={`${input} w-52`} placeholder="contains…" value={lrSearch} onChange={(e) => setLrSearch(e.target.value)} />
              </Field>
            </>
          )}
          {source === "customers" && (
            <>
              <Field label="Pipeline status">
                <select className={`${input} w-48`} value={custStatus} onChange={(e) => setCustStatus(e.target.value)}>
                  <option value="">any status</option>
                  {CUSTOMER_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Business name">
                <input className={`${input} w-52`} placeholder="contains…" value={custSearch} onChange={(e) => setCustSearch(e.target.value)} />
              </Field>
            </>
          )}
          <button onClick={runPreview} disabled={counting} className="btn-ghost btn-sm inline-flex items-center gap-1.5">
            <MagnifyingGlassIcon className="w-4 h-4" /> {counting ? "Counting…" : "Preview count"}
          </button>
        </div>

        {countErr && (
          <p className="mt-2 text-xs text-rose-600 dark:text-rose-400 inline-flex items-center gap-1">
            <ExclamationTriangleIcon className="w-3.5 h-3.5" /> {countErr}
          </p>
        )}
        {count != null && !countErr && (
          <p className="mt-2 text-sm text-gray-700 dark:text-gray-200">
            <strong className="text-gray-900 dark:text-white">{count.toLocaleString()}</strong> matching{" "}
            {SOURCE_META[source].label.toLowerCase()}
            {count > MAX_MEMBERS && (
              <span className="text-amber-600 dark:text-amber-400"> · this build saves the first {MAX_MEMBERS.toLocaleString()}</span>
            )}
          </p>
        )}
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
            title={count == null ? "Preview the count first" : count === 0 ? "No rows match" : "Save this audience"}
          >
            <BookmarkIcon className="w-4 h-4" /> {saving ? "Saving…" : "Save as smart list"}
          </button>
        </div>
        {count == null && !saving && <p className="text-[11px] text-gray-400">Preview the count before saving.</p>}
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className={lbl}>{label}</span>
      {children}
    </div>
  );
}
