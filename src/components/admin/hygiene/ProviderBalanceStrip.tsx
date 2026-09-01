// ProviderBalanceStrip — remaining spend across every paid enrichment provider.
// SHARED by Data Hygiene (variant="page") and System Health (variant="health").
//
// HONESTY (readers-must-distinguish): each provider renders exactly one of —
//   • money      — a real balance ($X), colored by low-balance threshold
//   • gated      — keyed nothing yet (Twilio): amber "add the key" note
//   • na         — no balance API exists (Apollo): neutral grey
//   • unreadable — the read failed: neutral grey + the error, NEVER a fake $0
// A failed whole-call read (hook error) renders every row as unreadable.

import { useState } from "react";
import {
  BanknotesIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ArrowPathIcon,
  NoSymbolIcon,
  QuestionMarkCircleIcon,
} from "@heroicons/react/24/outline";
import supabase from "@/supabase";
import { mustWrite } from "@/supabase/writes";
import { useProviderBalances, type ProviderBalances } from "@/hooks/useProviderBalances";

type RowState = "money" | "gated" | "na" | "unreadable" | "unknown" | "setup";
type Tone = "ok" | "warn" | "bad" | "neutral";

interface BalRow {
  key: string;
  label: string;
  state: RowState;
  amount?: number | null;
  currency?: string | null;
  tone: Tone;
  note?: string;
}

// Low-balance thresholds (USD). At/under `red` = bad; at/under `amber` = warn.
const LOW: Record<string, { red: number; amber: number }> = {
  batchdata: { red: 5, amber: 20 },
  phone_validation: { red: 2, amber: 10 },
};

function moneyTone(v: number | null, key: string): Tone {
  if (v == null) return "neutral";
  const t = LOW[key];
  if (!t) return "ok";
  if (v <= t.red) return "bad";
  if (v <= t.amber) return "warn";
  return "ok";
}

const TONE_PILL: Record<Tone, string> = {
  ok: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  warn: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  bad: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  neutral: "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300",
};
const TONE_DOT: Record<Tone, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  bad: "bg-red-500",
  neutral: "bg-gray-400",
};

function fmtMoney(v: number | null, currency: string | null | undefined): string {
  if (v == null) return "—";
  const cur = currency || "USD";
  try {
    return v.toLocaleString(undefined, { style: "currency", currency: cur });
  } catch {
    return `$${v.toFixed(2)}`;
  }
}

function buildRows(data: ProviderBalances | null, error: string | null): BalRow[] {
  // Whole-call failure — we cannot read ANY provider. Never invent per-provider verdicts.
  if (error || !data) {
    const note = error ?? "balance read failed";
    return [
      { key: "batchdata", label: "BatchData (skip-trace)", state: "unreadable", tone: "neutral", note },
      { key: "apollo", label: "Apollo (enrichment)", state: "unreadable", tone: "neutral", note },
      { key: "phone_validation", label: "Phone validation (Twilio)", state: "unreadable", tone: "neutral", note },
    ];
  }

  const rows: BalRow[] = [];

  // BatchData — real wallet balance, or unreadable.
  const bd = data.batchdata;
  if (!bd.ok) {
    rows.push({ key: "batchdata", label: "BatchData (skip-trace)", state: "unreadable", tone: "neutral", note: bd.error || "wallet read failed" });
  } else if (bd.balance == null) {
    rows.push({ key: "batchdata", label: "BatchData (skip-trace)", state: "unknown", tone: "neutral", note: "balance not reported by the wallet API" });
  } else {
    rows.push({
      key: "batchdata",
      label: "BatchData (skip-trace)",
      state: "money",
      amount: bd.balance,
      currency: bd.currency,
      tone: moneyTone(bd.balance, "batchdata"),
    });
  }

  // Apollo — no balance API by design.
  rows.push({
    key: "apollo",
    label: "Apollo (enrichment)",
    state: "na",
    tone: "neutral",
    note: data.apollo?.reason || "no credit/usage balance endpoint — check the Apollo dashboard",
  });

  // Phone validation (Twilio) — gated / real / unreadable.
  const pv = data.phone_validation;
  if (pv.gated) {
    rows.push({ key: "phone_validation", label: "Phone validation (Twilio)", state: "gated", tone: "warn", note: "Add the Twilio key to enable phone validation" });
  } else if (!pv.ok) {
    rows.push({ key: "phone_validation", label: "Phone validation (Twilio)", state: "unreadable", tone: "neutral", note: pv.error || "balance read failed" });
  } else if (pv.balance == null) {
    rows.push({ key: "phone_validation", label: "Phone validation (Twilio)", state: "unknown", tone: "neutral", note: "balance not reported" });
  } else {
    rows.push({
      key: "phone_validation",
      label: "Phone validation (Twilio)",
      state: "money",
      amount: pv.balance,
      currency: pv.currency,
      tone: moneyTone(pv.balance, "phone_validation"),
    });
  }

  // RealValidation — TRACKED wallet (their API exposes no balance): the owner sets
  // the balance from the RPV dashboard; we subtract our recorded per-lookup spend.
  const rpv = data.realphonevalidation;
  if (rpv) {
    if (rpv.gated) {
      rows.push({ key: "realphonevalidation", label: "RealValidation (phone)", state: "gated", tone: "warn", note: "Add the RealValidation token to the vault" });
    } else if (!rpv.ok) {
      rows.push({ key: "realphonevalidation", label: "RealValidation (phone)", state: "unreadable", tone: "neutral", note: rpv.error || "read failed" });
    } else if (rpv.needs_setup || rpv.balance == null) {
      rows.push({ key: "realphonevalidation", label: "RealValidation (phone)", state: "setup", tone: "neutral", note: "No balance API — enter your balance from the RPV dashboard to track it" });
    } else {
      rows.push({
        key: "realphonevalidation",
        label: "RealValidation (phone)",
        state: "money",
        amount: rpv.balance,
        currency: "USD",
        tone: moneyTone(rpv.balance, "phone_validation"),
        note: `est. — $${(rpv.tracked_spend ?? 0).toFixed(2)} spent here since ${rpv.set_at ? new Date(rpv.set_at).toLocaleDateString() : "set"} · re-set after top-ups`,
      });
    }
  }

  return rows;
}

/** Inline "set / update the RPV balance" control (writes platform_settings.rpv_wallet). */
function RpvSetBalance({ current, onSaved }: { current: number | null; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(current != null ? String(current) : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    const n = Number(val);
    if (!Number.isFinite(n) || n < 0) { setErr("Enter a dollar amount."); return; }
    setBusy(true);
    setErr(null);
    try {
      await mustWrite(
        "save the RealValidation balance",
        supabase.from("platform_settings").upsert(
          { key: "rpv_wallet", value: { balance: n, set_at: new Date().toISOString() } },
          { onConflict: "key" },
        ),
      );
      setOpen(false);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[11px] font-semibold text-ocean-blue hover:underline"
      >
        {current != null ? "update balance" : "Set balance"}
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <input
        type="number"
        min={0}
        step="0.01"
        autoFocus
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder="e.g. 25.00"
        className="w-24 text-xs px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
      />
      <button type="button" disabled={busy} onClick={() => void save()} className="text-[11px] font-bold text-white bg-ocean-blue rounded-full px-2 py-1 disabled:opacity-50">
        {busy ? "…" : "Save"}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-[11px] text-gray-400 hover:underline">cancel</button>
      {err && <span className="text-[11px] text-red-600 dark:text-red-400">{err}</span>}
    </span>
  );
}

function RowValue({ row }: { row: BalRow }) {
  switch (row.state) {
    case "money":
      return (
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full tabular-nums ${TONE_PILL[row.tone]}`}>
          {fmtMoney(row.amount ?? null, row.currency)}
        </span>
      );
    case "gated":
      return (
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full inline-flex items-center gap-1 ${TONE_PILL.warn}`}>
          <ExclamationTriangleIcon className="w-3.5 h-3.5" /> Add key
        </span>
      );
    case "na":
      return (
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full inline-flex items-center gap-1 ${TONE_PILL.neutral}`}>
          <NoSymbolIcon className="w-3.5 h-3.5" /> No API
        </span>
      );
    case "unreadable":
      return (
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full inline-flex items-center gap-1 ${TONE_PILL.neutral}`}>
          <ExclamationTriangleIcon className="w-3.5 h-3.5" /> Unreadable
        </span>
      );
    case "setup":
      return (
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full inline-flex items-center gap-1 ${TONE_PILL.warn}`}>
          <QuestionMarkCircleIcon className="w-3.5 h-3.5" /> Not set
        </span>
      );
    default: // unknown
      return (
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full inline-flex items-center gap-1 ${TONE_PILL.neutral}`}>
          <QuestionMarkCircleIcon className="w-3.5 h-3.5" /> Unknown
        </span>
      );
  }
}

export default function ProviderBalanceStrip({ variant = "page" }: { variant?: "page" | "health" }) {
  const { data, loading, error, reload } = useProviderBalances();
  const rows = buildRows(data, error);

  // ── System Health variant: a monitored-rows card, matching the other monitors. ──
  if (variant === "health") {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BanknotesIcon className="w-5 h-5 text-mint-green" />
            <h2 className="font-bold text-gray-900 dark:text-white">Provider balances</h2>
          </div>
          <button
            onClick={reload}
            disabled={loading}
            className="inline-flex items-center gap-1.5 text-xs text-ocean-blue hover:underline disabled:opacity-50"
          >
            <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Remaining spend on the paid enrichment providers — caught here so low credit is spotted before a run fails.
        </p>
        <div className="divide-y divide-gray-100 dark:divide-gray-700/60">
          {rows.map((r) => (
            <div key={r.key} className="flex items-center justify-between gap-3 py-2.5">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${TONE_DOT[r.tone]}`} />
                <div className="min-w-0">
                  <p className="text-sm text-gray-900 dark:text-white truncate">{r.label}</p>
                  {r.note && <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{r.note}</p>}
                </div>
              </div>
              <span className="inline-flex items-center gap-2">
                <RowValue row={r} />
                {r.key === "realphonevalidation" && (r.state === "setup" || r.state === "money") && (
                  <RpvSetBalance current={r.amount ?? null} onSaved={() => void reload()} />
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Data Hygiene variant: a compact strip of provider cards. ──
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          <BanknotesIcon className="w-4 h-4 text-mint-green" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Provider balances</h3>
        </div>
        <button
          onClick={reload}
          disabled={loading}
          className="inline-flex items-center gap-1.5 text-xs text-ocean-blue hover:underline disabled:opacity-50"
        >
          <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>
      {error && (
        <p className="mb-2 text-xs text-amber-700 dark:text-amber-400 inline-flex items-center gap-1">
          <ExclamationTriangleIcon className="w-3.5 h-3.5" /> Could not read provider balances — showing each as unreadable.
        </p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {rows.map((r) => (
          <div key={r.key} className="rounded-lg border border-gray-100 dark:border-gray-700 p-3 flex flex-col gap-1.5">
            <p className="text-xs text-gray-500 dark:text-gray-400">{r.label}</p>
            <div className="flex items-center gap-2 flex-wrap">
              {r.state === "money" && r.tone === "ok" && <CheckCircleIcon className="w-4 h-4 text-emerald-500 shrink-0" />}
              <RowValue row={r} />
              {r.key === "realphonevalidation" && (r.state === "setup" || r.state === "money") && (
                <RpvSetBalance current={r.amount ?? null} onSaved={() => void reload()} />
              )}
            </div>
            {r.note && <p className="text-[11px] text-gray-400 dark:text-gray-500">{r.note}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
