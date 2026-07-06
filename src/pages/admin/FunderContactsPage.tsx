import { useState } from "react";
import { Link } from "react-router-dom";
import {
  UserGroupIcon, ArrowPathIcon, CheckCircleIcon, LinkIcon,
  MagnifyingGlassIcon, ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import supabase from "../../supabase";

// One matched funder reply awaiting review. Mirrors the edge fn's Proposal, plus
// local UI state (checkbox + inline-edited name/phone the reviewer can correct).
interface Extracted { name: string | null; title: string | null; phone: string | null; email: string | null }
interface Proposal {
  conversationId: string;
  contactId: string;
  contactEmail: string;
  contactName: string;
  lenderId: string;
  lenderName: string;
  domain: string;
  extracted: Extracted;
  alreadyLinked: boolean;
  lenderLinked: boolean;
}
interface Row extends Proposal {
  selected: boolean;
  editName: string;
  editPhone: string;
  editTitle: string;
  result?: { ok: boolean; text: string };
}

export default function FunderContactsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [scanning, setScanning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [scanned, setScanned] = useState<number | null>(null);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function scan() {
    setScanning(true); setError(null);
    try {
      const { data, error } = await supabase.functions.invoke("funder-reply-reconcile", {
        body: { action: "scan" },
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error || "Scan failed");
      const proposals = (data.proposals ?? []) as Proposal[];
      setRows(proposals.map((p) => ({
        ...p,
        // Pre-select clean, new matches (a name was extracted and it's not already saved).
        selected: !p.alreadyLinked && !!p.extracted.name,
        editName: p.extracted.name ?? "",
        editPhone: p.extracted.phone ?? "",
        editTitle: p.extracted.title ?? "",
      })));
      setScanned(data.scanned ?? proposals.length);
      setConflicts((data.conflicts ?? []) as string[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  }

  function patch(idx: number, next: Partial<Row>) {
    setRows((r) => r.map((row, i) => (i === idx ? { ...row, ...next } : row)));
  }

  async function applySelected() {
    const chosen = rows.filter((r) => r.selected);
    if (!chosen.length) return;
    setApplying(true); setError(null);
    try {
      const approved = chosen.map((r) => ({
        lenderId: r.lenderId,
        contactId: r.contactId,
        contactEmail: r.contactEmail,
        extracted: {
          name: r.editName.trim() || null,
          title: r.editTitle.trim() || null,
          phone: r.editPhone.trim() || null,
          email: r.extracted.email,
        },
      }));
      const { data, error } = await supabase.functions.invoke("funder-reply-reconcile", {
        body: { action: "apply", approved },
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error || "Apply failed");
      const results = (data.results ?? []) as Array<{ lenderId: string; ok: boolean; error?: string; contactAdded?: boolean; linked?: boolean; primarySet?: boolean }>;
      // Stamp each applied row with its result, mark it linked/saved, deselect.
      setRows((r) => r.map((row) => {
        if (!row.selected) return row;
        const res = results.find((x) => x.lenderId === row.lenderId);
        if (!res) return row;
        const bits = [res.contactAdded && "contact saved", res.linked && "GHL linked", res.primarySet && "primary set"].filter(Boolean).join(", ");
        return {
          ...row,
          selected: false,
          alreadyLinked: res.ok ? true : row.alreadyLinked,
          lenderLinked: res.ok && res.linked ? true : row.lenderLinked,
          result: { ok: res.ok, text: res.ok ? (bits || "already up to date") : (res.error || "failed") },
        };
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Apply failed");
    } finally {
      setApplying(false);
    }
  }

  const selectedCount = rows.filter((r) => r.selected).length;
  const allSelectable = rows.filter((r) => !r.alreadyLinked);
  const allChecked = allSelectable.length > 0 && allSelectable.every((r) => r.selected);

  function toggleAll() {
    const next = !allChecked;
    setRows((r) => r.map((row) => (row.alreadyLinked ? row : { ...row, selected: next })));
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <UserGroupIcon className="w-6 h-6 text-ocean-blue" /> Funder Contacts
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1 max-w-2xl">
            Funder replies land in GHL Conversations as loose contacts. This matches each one to a
            lender by the sender's email domain and pulls the point-of-contact from the signature.
            Review, correct, and approve — approving links the lender so <strong>future</strong> replies
            auto-associate.
          </p>
        </div>
        <button
          onClick={scan}
          disabled={scanning}
          className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg bg-ocean-blue text-white hover:opacity-90 disabled:opacity-50"
        >
          {scanning ? <ArrowPathIcon className="w-4 h-4 animate-spin" /> : <MagnifyingGlassIcon className="w-4 h-4" />}
          {scanning ? "Scanning GHL…" : "Scan for funder replies"}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-2">
          <ExclamationTriangleIcon className="w-5 h-5 shrink-0" /> {error}
        </div>
      )}

      {conflicts.length > 0 && (
        <div className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-2">
          <strong>Domain conflicts</strong> (a domain maps to more than one lender — first wins, fix the duplicate):
          <ul className="list-disc ml-5 mt-1">{conflicts.map((c) => <li key={c}>{c}</li>)}</ul>
        </div>
      )}

      {scanned !== null && (
        <div className="flex items-center justify-between flex-wrap gap-3">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Scanned <strong>{scanned}</strong> conversations · <strong>{rows.length}</strong> funder match{rows.length === 1 ? "" : "es"}
            {selectedCount > 0 && <> · <strong>{selectedCount}</strong> selected</>}
          </p>
          {rows.length > 0 && (
            <button
              onClick={applySelected}
              disabled={applying || selectedCount === 0}
              className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg bg-emerald-600 text-white hover:opacity-90 disabled:opacity-50"
            >
              {applying ? <ArrowPathIcon className="w-4 h-4 animate-spin" /> : <CheckCircleIcon className="w-4 h-4" />}
              Apply selected ({selectedCount})
            </button>
          )}
        </div>
      )}

      {scanned === null ? (
        <div className="text-center py-16 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <UserGroupIcon className="w-10 h-10 mx-auto text-gray-300 dark:text-gray-600" />
          <p className="text-gray-500 mt-3">Run a scan to find funder replies waiting to be associated.</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="p-8 flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <CheckCircleIcon className="w-5 h-5" /> No unassociated funder replies found. Everything is linked.
        </div>
      ) : (
        <div className="overflow-x-auto bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b border-gray-100 dark:border-gray-700">
                <th className="py-3 px-3 w-8">
                  <input type="checkbox" className="checkbox checkbox-sm" checked={allChecked} onChange={toggleAll} aria-label="Select all" />
                </th>
                <th className="py-3 px-3">Funder reply</th>
                <th className="py-3 px-3">Matched lender</th>
                <th className="py-3 px-3">Contact name</th>
                <th className="py-3 px-3">Title</th>
                <th className="py-3 px-3">Phone</th>
                <th className="py-3 px-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={r.contactId + r.lenderId} className="border-b border-gray-50 dark:border-gray-800 align-top">
                  <td className="py-2.5 px-3">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-sm"
                      checked={r.selected}
                      disabled={r.alreadyLinked}
                      onChange={(e) => patch(idx, { selected: e.target.checked })}
                      aria-label={`Select ${r.contactEmail}`}
                    />
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="block text-gray-900 dark:text-white font-medium">{r.contactEmail}</span>
                    <span className="block text-xs text-gray-400">{r.contactName || "—"} · @{r.domain}</span>
                  </td>
                  <td className="py-2.5 px-3">
                    <Link to={`/admin/lenders/${r.lenderId}`} className="text-ocean-blue hover:underline font-medium">
                      {r.lenderName}
                    </Link>
                    {r.lenderLinked && (
                      <span className="ml-2 inline-flex items-center gap-1 text-[11px] text-gray-400">
                        <LinkIcon className="w-3 h-3" /> already linked
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-3">
                    <input
                      type="text"
                      value={r.editName}
                      disabled={r.alreadyLinked}
                      onChange={(e) => patch(idx, { editName: e.target.value })}
                      placeholder="—"
                      className="input input-sm input-bordered w-36 bg-transparent dark:border-gray-600"
                    />
                  </td>
                  <td className="py-2.5 px-3">
                    <input
                      type="text"
                      value={r.editTitle}
                      disabled={r.alreadyLinked}
                      onChange={(e) => patch(idx, { editTitle: e.target.value })}
                      placeholder="—"
                      className="input input-sm input-bordered w-40 bg-transparent dark:border-gray-600"
                    />
                  </td>
                  <td className="py-2.5 px-3">
                    <input
                      type="text"
                      value={r.editPhone}
                      disabled={r.alreadyLinked}
                      onChange={(e) => patch(idx, { editPhone: e.target.value })}
                      placeholder="—"
                      className="input input-sm input-bordered w-32 bg-transparent dark:border-gray-600"
                    />
                  </td>
                  <td className="py-2.5 px-3 text-xs">
                    {r.result ? (
                      <span className={r.result.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}>
                        {r.result.ok ? "✓ " : "✕ "}{r.result.text}
                      </span>
                    ) : r.alreadyLinked ? (
                      <span className="inline-flex items-center gap-1 text-gray-400">
                        <CheckCircleIcon className="w-4 h-4" /> saved
                      </span>
                    ) : (
                      <span className="text-amber-600 dark:text-amber-400">new</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
