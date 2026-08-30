// TcpaStatusPanel — what's actually DIALABLE in a smart list. Surfaces DNC +
// TCPA-litigator suppression (from the BatchData results stored on
// ph_ucc_contacts.phones[] suppressed_dnc / tcpa_litigator) alongside the lead
// status, so the owner sees the clean-vs-blocked split before the floor dials.
//
// This is a UCC-source read (suppression is stamped by ph-ucc-skiptrace onto
// ph_ucc_leads / ph_ucc_contacts). For non-UCC lists it says so honestly.
//
// HONESTY (readers-must-distinguish): a failed read renders an explicit "couldn't
// read" state — never zeroes that would read as "all clean".

import { useCallback, useEffect, useState } from "react";
import { ShieldCheckIcon, ArrowPathIcon, ExclamationTriangleIcon, NoSymbolIcon } from "@heroicons/react/24/outline";
import supabase from "@/supabase";
import type { SmartList } from "./hygiene";

const IN_CHUNK = 300; // .in() chunk for count queries
const SCAN_CAP = 3000; // contacts phone-scan cap (DNC/TCPA tally)

interface Counts {
  members: number;
  dialable: number; // ph_ucc_leads with a clean (non-DNC) phone
  notTraced: number; // never skip-traced
  suppressed: number; // lead status = suppressed (TCPA/DNC/no-usable-contact)
  dncContacts: number; // persons with ≥1 phone flagged suppressed_dnc/dnc
  tcpaContacts: number; // persons with ≥1 TCPA-litigator phone (never dial)
  scanned: number; // how many ids the DNC/TCPA scan covered
  truncated: boolean; // members > SCAN_CAP → DNC/TCPA are from the first SCAN_CAP
}

interface ContactPhone {
  dnc?: boolean;
  suppressed_dnc?: boolean;
  tcpa_litigator?: boolean;
}

async function gatherUccIds(listId: string): Promise<string[]> {
  const ids: string[] = [];
  const PAGE = 1000;
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("smart_list_members")
      .select("source_id")
      .eq("smart_list_id", listId)
      .eq("source", "ph_ucc")
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    const rows = (data as { source_id: string }[]) ?? [];
    ids.push(...rows.map((r) => r.source_id));
    if (rows.length < PAGE) break;
    offset += rows.length;
  }
  return ids;
}

type CountKind = "dialable" | "notTraced" | "suppressed";
async function countLeads(ids: string[], kind: CountKind): Promise<number> {
  let total = 0;
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK);
    let q = supabase.from("ph_ucc_leads").select("id", { count: "exact", head: true }).in("id", chunk);
    if (kind === "dialable") q = q.not("phone", "is", null);
    else if (kind === "notTraced") q = q.is("traced_at", null);
    else q = q.eq("status", "suppressed");
    const { count, error } = await q;
    if (error) throw error;
    total += count ?? 0;
  }
  return total;
}

export default function TcpaStatusPanel({ list }: { list: SmartList }) {
  const isUcc = list.source === "ph_ucc";
  const [counts, setCounts] = useState<Counts | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isUcc) return;
    setLoading(true);
    setError(null);
    try {
      const ids = await gatherUccIds(list.id);
      if (ids.length === 0) {
        setCounts({ members: 0, dialable: 0, notTraced: 0, suppressed: 0, dncContacts: 0, tcpaContacts: 0, scanned: 0, truncated: false });
        return;
      }
      const [dialable, notTraced, suppressed] = await Promise.all([
        countLeads(ids, "dialable"),
        countLeads(ids, "notTraced"),
        countLeads(ids, "suppressed"),
      ]);

      // DNC / TCPA-litigator: tally from stored contact phones (capped scan).
      const scanIds = ids.slice(0, SCAN_CAP);
      let dncContacts = 0;
      let tcpaContacts = 0;
      for (let i = 0; i < scanIds.length; i += IN_CHUNK) {
        const chunk = scanIds.slice(i, i + IN_CHUNK);
        const { data, error: cErr } = await supabase.from("ph_ucc_contacts").select("phones").in("lead_id", chunk);
        if (cErr) throw cErr;
        for (const row of (data as { phones: ContactPhone[] | null }[]) ?? []) {
          const phones = row.phones ?? [];
          if (phones.some((p) => p?.tcpa_litigator)) tcpaContacts++;
          if (phones.some((p) => p?.suppressed_dnc || p?.dnc)) dncContacts++;
        }
      }

      setCounts({
        members: ids.length,
        dialable,
        notTraced,
        suppressed,
        dncContacts,
        tcpaContacts,
        scanned: scanIds.length,
        truncated: ids.length > SCAN_CAP,
      });
    } catch (e) {
      setCounts(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [isUcc, list.id]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheckIcon className="w-5 h-5 text-mint-green" />
          <h3 className="text-sm font-bold text-gray-900 dark:text-white">Dialability & TCPA/DNC</h3>
        </div>
        {isUcc && (
          <button onClick={load} disabled={loading} className="inline-flex items-center gap-1.5 text-xs text-ocean-blue hover:underline disabled:opacity-50">
            <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        )}
      </div>

      {!isUcc ? (
        <p className="text-xs text-gray-500 dark:text-gray-400 inline-flex items-start gap-1.5">
          <NoSymbolIcon className="w-4 h-4 shrink-0 mt-0.5" />
          DNC / TCPA-litigator suppression is stamped by BatchData skip-trace onto UCC leads. This list draws from{" "}
          {list.source ?? "another source"}, so run <strong>Phone validation</strong> to grade line type/reachability instead.
        </p>
      ) : error ? (
        <div className="text-xs rounded-lg px-3 py-2 bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-900/20 dark:text-amber-200 dark:border-amber-900/40 flex gap-2">
          <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" />
          <span>Couldn't read suppression counts (showing nothing rather than a false all-clear): {error}</span>
        </div>
      ) : loading && !counts ? (
        <p className="text-sm text-gray-400">Reading dialability…</p>
      ) : counts ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Stat label="Members" value={counts.members} />
            <Stat label="Dialable phone" value={counts.dialable} tone="ok" />
            <Stat label="Not traced yet" value={counts.notTraced} tone="neutral" />
            <Stat label="Suppressed leads" value={counts.suppressed} tone="bad" />
            <Stat label="DNC contacts" value={counts.dncContacts} tone="warn" />
            <Stat label="TCPA litigators" value={counts.tcpaContacts} tone="bad" />
          </div>
          {counts.truncated && (
            <p className="text-[11px] text-gray-400">
              DNC / TCPA tallied over the first {counts.scanned.toLocaleString()} of {counts.members.toLocaleString()} members.
            </p>
          )}
          <p className="text-[11px] text-gray-400">
            Numbers flagged DNC or TCPA-litigator are never dialable — TCPA litigators must never be called.
          </p>
        </>
      ) : null}
    </div>
  );
}

const TONE: Record<string, string> = {
  ok: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  bad: "text-red-600 dark:text-red-400",
  neutral: "text-gray-700 dark:text-gray-200",
};

function Stat({ label, value, tone = "neutral" }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg border border-gray-100 dark:border-gray-700 p-2.5">
      <p className="text-[11px] text-gray-400">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${TONE[tone] ?? TONE.neutral}`}>{value.toLocaleString()}</p>
    </div>
  );
}
