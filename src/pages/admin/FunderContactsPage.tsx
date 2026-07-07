import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  UserGroupIcon, ArrowPathIcon, CheckCircleIcon, LinkIcon,
  MagnifyingGlassIcon, ExclamationTriangleIcon, PhoneIcon,
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

// An UNKNOWN inbound number (a funder rep who called/texted from a line we don't
// have on file) that an admin can manually tie to a funder. Once tied, every
// future call/text from it auto-associates via the phone map.
interface UnmatchedPhone {
  contactId: string;
  phone: string;
  contactName: string;
  lastMessageAt: string | null;
  snippet: string;
}
interface UnmatchedRow extends UnmatchedPhone {
  lenderId: string;   // chosen funder
  editName: string;   // optional POC name ("Bob")
  tying: boolean;
  done?: { ok: boolean; text: string };
}
interface LenderOption { id: string; company_name: string }

export default function FunderContactsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [scanning, setScanning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [scanned, setScanned] = useState<number | null>(null);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Unknown inbound numbers awaiting a manual tie.
  const [lenders, setLenders] = useState<LenderOption[]>([]);
  const [unmatched, setUnmatched] = useState<UnmatchedRow[]>([]);
  const [loadingUnmatched, setLoadingUnmatched] = useState(false);
  const [unmatchedScanned, setUnmatchedScanned] = useState<number | null>(null);
  const [unmatchedError, setUnmatchedError] = useState<string | null>(null);

  // Funder list for the tie dropdown (read-only).
  useEffect(() => {
    supabase.from("lenders").select("id, company_name").order("company_name")
      .then(({ data }) => setLenders((data ?? []) as LenderOption[]));
  }, []);

  async function loadUnmatched() {
    setLoadingUnmatched(true); setUnmatchedError(null);
    try {
      const { data, error } = await supabase.functions.invoke("funder-reply-reconcile", {
        body: { action: "list-unmatched-phones" },
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error || "Lookup failed");
      const list = (data.unmatched ?? []) as UnmatchedPhone[];
      setUnmatched(list.map((u) => ({ ...u, lenderId: "", editName: "", tying: false })));
      setUnmatchedScanned(data.scanned ?? 0);
    } catch (e) {
      setUnmatchedError(e instanceof Error ? e.message : "Lookup failed");
    } finally {
      setLoadingUnmatched(false);
    }
  }

  function patchUnmatched(contactId: string, next: Partial<UnmatchedRow>) {
    setUnmatched((r) => r.map((row) => (row.contactId === contactId ? { ...row, ...next } : row)));
  }

  async function tie(row: UnmatchedRow) {
    if (!row.lenderId) return;
    patchUnmatched(row.contactId, { tying: true });
    try {
      const { data, error } = await supabase.functions.invoke("funder-reply-reconcile", {
        body: {
          action: "tie-phone",
          contactId: row.contactId,
          phone: row.phone,
          lenderId: row.lenderId,
          name: row.editName.trim() || undefined,
          contactName: row.contactName || undefined,
        },
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error || "Tie failed");
      // Remove the tied row after a brief confirmation.
      patchUnmatched(row.contactId, {
        tying: false,
        done: { ok: true, text: `Tied to ${data.lenderName ?? "funder"}` },
      });
      setTimeout(() => setUnmatched((r) => r.filter((x) => x.contactId !== row.contactId)), 1500);
    } catch (e) {
      patchUnmatched(row.contactId, {
        tying: false,
        done: { ok: false, text: e instanceof Error ? e.message : "Tie failed" },
      });
    }
  }

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

      {/* ── Unknown inbound numbers (manual tie) ─────────────────────────── */}
      <div className="pt-4 border-t border-gray-100 dark:border-gray-700 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <PhoneIcon className="w-5 h-5 text-ocean-blue" /> Unmatched inbound numbers
            </h2>
            <p className="text-gray-500 dark:text-gray-400 mt-1 max-w-2xl text-sm">
              Numbers that called or texted us but aren't on any funder's file. Tie one to a funder and
              every <strong>future</strong> call or text from it auto-associates.
            </p>
          </div>
          <button
            onClick={loadUnmatched}
            disabled={loadingUnmatched}
            className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg bg-ocean-blue text-white hover:opacity-90 disabled:opacity-50"
          >
            {loadingUnmatched ? <ArrowPathIcon className="w-4 h-4 animate-spin" /> : <MagnifyingGlassIcon className="w-4 h-4" />}
            {loadingUnmatched ? "Scanning GHL…" : unmatchedScanned === null ? "Find unmatched numbers" : "Rescan"}
          </button>
        </div>

        {unmatchedError && (
          <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-2">
            <ExclamationTriangleIcon className="w-5 h-5 shrink-0" /> {unmatchedError}
          </div>
        )}

        {unmatchedScanned !== null && (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Scanned <strong>{unmatchedScanned}</strong> conversations · <strong>{unmatched.length}</strong> unknown number{unmatched.length === 1 ? "" : "s"}
          </p>
        )}

        {unmatchedScanned === null ? (
          <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
            <PhoneIcon className="w-9 h-9 mx-auto text-gray-300 dark:text-gray-600" />
            <p className="text-gray-500 mt-3 text-sm">Scan to find unknown numbers that called or texted you.</p>
          </div>
        ) : unmatched.length === 0 ? (
          <div className="p-6 flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
            <CheckCircleIcon className="w-5 h-5" /> No unknown inbound numbers. Every caller is accounted for.
          </div>
        ) : (
          <div className="overflow-x-auto bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-100 dark:border-gray-700">
                  <th className="py-3 px-3">Number</th>
                  <th className="py-3 px-3">Last message</th>
                  <th className="py-3 px-3">Tie to funder</th>
                  <th className="py-3 px-3">Name (optional)</th>
                  <th className="py-3 px-3"></th>
                </tr>
              </thead>
              <tbody>
                {unmatched.map((r) => (
                  <tr key={r.contactId} className="border-b border-gray-50 dark:border-gray-800 align-top">
                    <td className="py-2.5 px-3">
                      <span className="block text-gray-900 dark:text-white font-medium">{r.phone}</span>
                      <span className="block text-xs text-gray-400">{r.contactName || "Unknown caller"}</span>
                    </td>
                    <td className="py-2.5 px-3 max-w-xs">
                      <span className="block text-xs text-gray-400">
                        {r.lastMessageAt ? new Date(r.lastMessageAt).toLocaleString() : "—"}
                      </span>
                      {r.snippet && <span className="block text-xs text-gray-500 dark:text-gray-400 truncate">{r.snippet}</span>}
                    </td>
                    <td className="py-2.5 px-3">
                      <input
                        list={`lenders-${r.contactId}`}
                        value={lenders.find((l) => l.id === r.lenderId)?.company_name ?? ""}
                        disabled={r.tying || r.done?.ok}
                        onChange={(e) => {
                          const match = lenders.find((l) => l.company_name === e.target.value);
                          patchUnmatched(r.contactId, { lenderId: match?.id ?? "" });
                        }}
                        placeholder="Search funder…"
                        className="input input-sm input-bordered w-52 bg-transparent dark:border-gray-600"
                      />
                      <datalist id={`lenders-${r.contactId}`}>
                        {lenders.map((l) => <option key={l.id} value={l.company_name} />)}
                      </datalist>
                    </td>
                    <td className="py-2.5 px-3">
                      <input
                        type="text"
                        value={r.editName}
                        disabled={r.tying || r.done?.ok}
                        onChange={(e) => patchUnmatched(r.contactId, { editName: e.target.value })}
                        placeholder="Bob"
                        className="input input-sm input-bordered w-32 bg-transparent dark:border-gray-600"
                      />
                    </td>
                    <td className="py-2.5 px-3">
                      {r.done ? (
                        <span className={`text-xs ${r.done.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
                          {r.done.ok ? "✓ " : "✕ "}{r.done.text}
                        </span>
                      ) : (
                        <button
                          onClick={() => tie(r)}
                          disabled={!r.lenderId || r.tying}
                          className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:opacity-90 disabled:opacity-50"
                        >
                          {r.tying ? <ArrowPathIcon className="w-4 h-4 animate-spin" /> : <LinkIcon className="w-4 h-4" />}
                          Tie
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
