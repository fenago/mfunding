// SmartListActions — the action bar on a saved smart list. Three provider actions,
// each: count → cost preview → inline two-step confirm (NO browser popups) →
// chunked-loop invoke, showing live progress + balance-after.
//
//   • BatchData skip-trace  → ph-ucc-skiptrace  (UCC-source lists; HARD_MAX 100/call)
//   • Apollo enrich         → ph-ucc-apollo-enrich (UCC-source lists; HARD_MAX 50/call)
//   • Phone validation      → phone-validate     (any list; ≤200/call, loops toward ~1000)
//
// BatchData + Apollo run over the list's ph_ucc member ids (they operate on
// ph_ucc_leads), so they're offered only when list.source === 'ph_ucc'. Phone
// validation works off each member's snapshot phone, so it's offered for every list —
// and is disabled with an "add the Twilio key" note when the provider is gated.

import { useCallback, useEffect, useState } from "react";
import {
  MagnifyingGlassIcon,
  SparklesIcon,
  PhoneIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
} from "@heroicons/react/24/outline";
import supabase from "@/supabase";
import { fnErrorMessage, type SmartList } from "./hygiene";

const TRACE_COST_DISPLAY = 0.07; // BatchData observed all-in per-trace average
const SKIPTRACE_CAP = 100; // ph-ucc-skiptrace per-call ceiling
const APOLLO_CAP = 50; // ph-ucc-apollo-enrich per-call ceiling
const IN_CHUNK = 300; // .in() chunk for counting/filtering source ids
const PHONE_TARGET = 1000; // phone-validate loops toward this many per click

// Static accent classes (Tailwind purges dynamically-built class names).
const ACCENT: Record<string, string> = {
  "ocean-blue": "text-ocean-blue",
  "violet-600": "text-violet-600 dark:text-violet-400",
  "mint-green": "text-mint-green",
};

interface PreviewResult {
  count: number;
  costUsd: number | null; // null = no per-unit price (Apollo)
  gated?: boolean;
  note?: string;
}
type Runner = (onProgress: (done: number, total: number) => void) => Promise<string>;

/* Page-through helper: all member source_ids for one source in this list. */
async function gatherMemberSourceIds(listId: string, source: string): Promise<string[]> {
  const ids: string[] = [];
  const PAGE = 1000;
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("smart_list_members")
      .select("source_id")
      .eq("smart_list_id", listId)
      .eq("source", source)
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    const rows = (data as { source_id: string }[]) ?? [];
    ids.push(...rows.map((r) => r.source_id));
    if (rows.length < PAGE) break;
    offset += rows.length;
  }
  return ids;
}

/* Of the given ph_ucc_leads ids, which are skip-trace-eligible (needs_skiptrace,
   untraced, has a street address) — mirrors the edge fn's server-side guard. */
async function filterTraceEligible(ids: string[]): Promise<string[]> {
  const eligible: string[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK);
    const { data, error } = await supabase
      .from("ph_ucc_leads")
      .select("id")
      .in("id", chunk)
      .eq("status", "needs_skiptrace")
      .is("traced_at", null)
      .not("debtor_address", "is", null);
    if (error) throw error;
    eligible.push(...((data as { id: string }[]) ?? []).map((r) => r.id));
  }
  return eligible;
}

export default function SmartListActions({ list, onChanged }: { list: SmartList; onChanged: () => void }) {
  const isUcc = list.source === "ph_ucc";

  // ── BatchData skip-trace preview ──
  const previewTrace = useCallback(async (): Promise<PreviewResult> => {
    const ids = await gatherMemberSourceIds(list.id, "ph_ucc");
    const eligible = await filterTraceEligible(ids);
    return {
      count: eligible.length,
      costUsd: Math.round(eligible.length * TRACE_COST_DISPLAY * 100) / 100,
      note: eligible.length === 0 ? "No UCC members still need skip-tracing." : undefined,
    };
  }, [list.id]);

  const runTrace: Runner = useCallback(
    async (onProgress) => {
      const ids = await filterTraceEligible(await gatherMemberSourceIds(list.id, "ph_ucc"));
      if (ids.length === 0) return "Nothing eligible to skip-trace.";
      let traced = 0,
        ready = 0,
        spent = 0,
        errored = 0;
      let balanceAfter: number | null = null;
      let paused = false;
      onProgress(0, ids.length);
      for (let i = 0; i < ids.length; i += SKIPTRACE_CAP) {
        const chunk = ids.slice(i, i + SKIPTRACE_CAP);
        const { data, error } = await supabase.functions.invoke("ph-ucc-skiptrace", { body: { lead_ids: chunk } });
        if (error) throw new Error(await fnErrorMessage(error));
        const r = (data as Record<string, unknown>) ?? {};
        if (r.ok === false) throw new Error(String(r.error || "skip-trace failed"));
        if (r.skipped === true) {
          paused = true;
          break;
        }
        traced += Number(r.traced ?? 0) || 0;
        ready += Number(r.ready ?? 0) || 0;
        spent += Number(r.run_spend_usd ?? 0) || 0;
        errored += Number(r.errored ?? 0) || 0;
        if (typeof r.balance_after === "number") balanceAfter = r.balance_after as number;
        onProgress(Math.min(i + chunk.length, ids.length), ids.length);
      }
      onChanged();
      if (paused) return "Skip-trace is paused in Settings (skiptrace_enabled = OFF). Turn it on to run.";
      const bal = balanceAfter != null ? ` · wallet now $${balanceAfter.toFixed(2)}` : "";
      const err = errored > 0 ? ` · ${errored} errored` : "";
      return `Traced ${traced.toLocaleString()} · ${ready.toLocaleString()} ready · $${spent.toFixed(2)} spent${bal}${err}`;
    },
    [list.id, onChanged],
  );

  // ── Apollo enrich preview (no per-unit price / no balance API) ──
  const previewApollo = useCallback(async (): Promise<PreviewResult> => {
    const ids = await gatherMemberSourceIds(list.id, "ph_ucc");
    return {
      count: ids.length,
      costUsd: null,
      note:
        ids.length === 0
          ? "No UCC members in this list."
          : "Spends Apollo credits (no API balance — usage shows in the Apollo dashboard). Already-enriched leads are skipped server-side.",
    };
  }, [list.id]);

  const runApollo: Runner = useCallback(
    async (onProgress) => {
      const ids = await gatherMemberSourceIds(list.id, "ph_ucc");
      if (ids.length === 0) return "Nothing to enrich.";
      let enriched = 0,
        checked = 0,
        errored = 0;
      let paused = false;
      onProgress(0, ids.length);
      for (let i = 0; i < ids.length; i += APOLLO_CAP) {
        const chunk = ids.slice(i, i + APOLLO_CAP);
        const { data, error } = await supabase.functions.invoke("ph-ucc-apollo-enrich", { body: { lead_ids: chunk } });
        if (error) throw new Error(await fnErrorMessage(error));
        const r = (data as Record<string, unknown>) ?? {};
        if (r.ok === false) throw new Error(String(r.error || "Apollo enrichment failed"));
        if (r.skipped === true) {
          paused = true;
          break;
        }
        enriched += Number(r.enriched ?? 0) || 0;
        checked += Number(r.checked ?? 0) || 0;
        errored += Number(r.errored ?? r.errors ?? 0) || 0;
        onProgress(Math.min(i + chunk.length, ids.length), ids.length);
      }
      onChanged();
      if (paused) return "Apollo enrichment is disabled in Settings (apollo_enrich_enabled = OFF). Turn it on to run.";
      const err = errored > 0 ? ` · ${errored} errored` : "";
      return `Enriched ${enriched.toLocaleString()} of ${checked.toLocaleString()} checked${err}.`;
    },
    [list.id, onChanged],
  );

  // ── Phone validation preview (Twilio; gated until the key is added) ──
  const previewPhone = useCallback(async (): Promise<PreviewResult> => {
    const { data, error } = await supabase.functions.invoke("phone-validate", {
      body: { action: "preview", smart_list_id: list.id },
    });
    if (error) throw new Error(await fnErrorMessage(error));
    const r = (data as Record<string, unknown>) ?? {};
    if (r.ok === false && !r.gated) throw new Error(String(r.error || "preview failed"));
    const needing = Number(r.needing_validation ?? 0) || 0;
    const per = Number(r.cost_per_lookup ?? 0) || 0;
    return {
      count: needing,
      costUsd: r.est_cost_usd != null ? Number(r.est_cost_usd) || 0 : Math.round(needing * per * 10000) / 10000,
      gated: r.gated === true,
      note: r.gated === true ? "Add the Twilio key to enable phone validation." : undefined,
    };
  }, [list.id]);

  const runPhone: Runner = useCallback(
    async (onProgress) => {
      let validated = 0,
        mobile = 0,
        landline = 0,
        voip = 0,
        unreachable = 0,
        noPhone = 0,
        errored = 0,
        looked = 0;
      // Loop ≤200/call toward PHONE_TARGET. Stop when a call validates nothing new
      // (remaining members are no-phone/errored) or the list drains.
      onProgress(0, PHONE_TARGET);
      while (looked < PHONE_TARGET) {
        const { data, error } = await supabase.functions.invoke("phone-validate", {
          body: { action: "validate", smart_list_id: list.id, limit: 200 },
        });
        if (error) throw new Error(await fnErrorMessage(error));
        const r = (data as Record<string, unknown>) ?? {};
        if (r.gated === true) return "Add the Twilio key to enable phone validation.";
        if (r.skipped === true) return "Phone validation is paused in Settings (phone_validate_enabled = OFF). Turn it on to run.";
        if (r.ok === false) throw new Error(String(r.error || "validation failed"));
        const candidates = Number(r.candidates ?? 0) || 0;
        const v = Number(r.validated ?? 0) || 0;
        validated += v;
        mobile += Number(r.mobile ?? 0) || 0;
        landline += Number(r.landline ?? 0) || 0;
        voip += Number(r.voip ?? 0) || 0;
        unreachable += Number(r.unreachable ?? 0) || 0;
        noPhone += Number(r.no_phone ?? 0) || 0;
        errored += Number(r.errored ?? 0) || 0;
        looked += candidates;
        onProgress(Math.min(looked, PHONE_TARGET), PHONE_TARGET);
        if (candidates === 0 || v === 0) break; // drained, or no forward progress
      }
      onChanged();
      // Balance-after (best-effort; separate cheap read).
      let bal = "";
      try {
        const { data: b } = await supabase.functions.invoke("phone-validate", { body: { action: "balance" } });
        const br = (b as Record<string, unknown>) ?? {};
        if (br.ok === true && typeof br.balance === "number") bal = ` · Twilio now $${(br.balance as number).toFixed(2)}`;
      } catch {
        /* balance is a nicety; never fail the run over it */
      }
      const extras = [
        mobile ? `${mobile} mobile` : "",
        landline ? `${landline} landline` : "",
        voip ? `${voip} VoIP` : "",
        unreachable ? `${unreachable} unreachable` : "",
        noPhone ? `${noPhone} no-phone` : "",
        errored ? `${errored} errored` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      return `Validated ${validated.toLocaleString()}${extras ? " · " + extras : ""}${bal}`;
    },
    [list.id, onChanged],
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
      <ActionPanel
        title="BatchData skip-trace"
        icon={<MagnifyingGlassIcon className="w-4 h-4" />}
        accent="ocean-blue"
        spendChip="spends BatchData wallet"
        enabled={isUcc}
        disabledReason={isUcc ? undefined : "UCC-source lists only — skip-trace runs on ph_ucc_leads ids."}
        previewFn={previewTrace}
        runFn={runTrace}
        confirmVerb="Skip-trace"
      />
      <ActionPanel
        title="Apollo enrich"
        icon={<SparklesIcon className="w-4 h-4" />}
        accent="violet-600"
        spendChip="spends Apollo credits"
        enabled={isUcc}
        disabledReason={isUcc ? undefined : "UCC-source lists only — Apollo enrich runs on ph_ucc_leads ids."}
        previewFn={previewApollo}
        runFn={runApollo}
        confirmVerb="Enrich"
      />
      <ActionPanel
        title="Phone validation"
        icon={<PhoneIcon className="w-4 h-4" />}
        accent="mint-green"
        spendChip="spends Twilio balance"
        enabled
        previewFn={previewPhone}
        runFn={runPhone}
        confirmVerb="Validate"
      />
    </div>
  );
}

/* One provider action: preview → two-step confirm → run with progress. */
function ActionPanel({
  title,
  icon,
  accent,
  spendChip,
  enabled,
  disabledReason,
  previewFn,
  runFn,
  confirmVerb,
}: {
  title: string;
  icon: React.ReactNode;
  accent: string;
  spendChip: string;
  enabled: boolean;
  disabledReason?: string;
  previewFn: () => Promise<PreviewResult>;
  runFn: Runner;
  confirmVerb: string;
}) {
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [armed, setArmed] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Auto-disarm the primed confirm after 5s (house armOrFire pattern).
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);

  const doPreview = async () => {
    setPreviewing(true);
    setErr(null);
    setResult(null);
    setArmed(false);
    setPreview(null);
    try {
      setPreview(await previewFn());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewing(false);
    }
  };

  const doRun = async () => {
    setArmed(false);
    setRunning(true);
    setErr(null);
    setResult(null);
    setProgress({ done: 0, total: 1 });
    try {
      const summary = await runFn((done, total) => setProgress({ done, total }));
      setResult(summary);
      setPreview(null); // stale after a run
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  const gated = preview?.gated === true;
  const canRun = enabled && !gated && !!preview && preview.count > 0 && !running;

  return (
    <div
      className={`rounded-xl border p-4 space-y-3 ${
        enabled ? "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800" : "border-dashed border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40"
      }`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className={ACCENT[accent] ?? "text-gray-500"}>{icon}</span>
        <h3 className="text-sm font-bold text-gray-900 dark:text-white">{title}</h3>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 font-semibold">
          {spendChip}
        </span>
      </div>

      {!enabled ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">{disabledReason}</p>
      ) : (
        <>
          <button onClick={doPreview} disabled={previewing || running} className="btn-ghost btn-sm inline-flex items-center gap-1.5">
            <MagnifyingGlassIcon className="w-4 h-4" /> {previewing ? "Counting…" : "Preview count & cost"}
          </button>

          {preview && (
            <div className="text-sm text-gray-700 dark:text-gray-200 space-y-1">
              <p>
                <strong className="text-gray-900 dark:text-white">{preview.count.toLocaleString()}</strong> to process
                {preview.costUsd != null && preview.count > 0 && (
                  <>
                    {" "}
                    · est. <strong className="text-gray-900 dark:text-white">${preview.costUsd.toFixed(2)}</strong>
                  </>
                )}
              </p>
              {preview.note && (
                <p className={`text-xs ${gated ? "text-amber-700 dark:text-amber-400" : "text-gray-500 dark:text-gray-400"}`}>
                  {gated && <ExclamationTriangleIcon className="inline w-3.5 h-3.5 mr-1 -mt-0.5" />}
                  {preview.note}
                </p>
              )}
            </div>
          )}

          {gated && (
            <button disabled className="btn-primary btn-sm w-full opacity-50 cursor-not-allowed">
              Add the Twilio key to enable
            </button>
          )}

          {!gated && preview && preview.count > 0 && !running && (
            <button
              onClick={() => (armed ? doRun() : setArmed(true))}
              disabled={!canRun}
              className={`btn-sm w-full inline-flex items-center justify-center gap-1.5 ${armed ? "btn-primary ring-2 ring-offset-1 ring-rose-400" : "btn-primary"}`}
            >
              <CheckCircleIcon className="w-4 h-4" />
              {armed
                ? `Confirm — ${confirmVerb.toLowerCase()} ${preview.count.toLocaleString()}${preview.costUsd != null ? ` ($${preview.costUsd.toFixed(2)})` : ""}`
                : `${confirmVerb} ${preview.count.toLocaleString()}`}
            </button>
          )}

          {progress && (
            <div className="space-y-1">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                <div
                  className="h-full rounded-full bg-mint-green transition-all"
                  style={{ width: `${progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0}%` }}
                />
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-300">
                {progress.done.toLocaleString()} / {progress.total.toLocaleString()}…
              </p>
            </div>
          )}

          {result && <p className="text-sm text-emerald-700 dark:text-emerald-300">{result}</p>}
          {err && <p className="text-sm text-rose-600 dark:text-rose-400">Failed: {err}</p>}
        </>
      )}
    </div>
  );
}
