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

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MagnifyingGlassIcon,
  SparklesIcon,
  PhoneIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
} from "@heroicons/react/24/outline";
import supabase from "@/supabase";
import { fnErrorMessage, type SmartList } from "./hygiene";
import SmartListRollup from "./SmartListRollup";

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
type Runner = (
  onProgress: (done: number, total: number) => void,
  isStopped?: () => boolean,
) => Promise<string>;

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

/* Page-through helper: all member row ids (the smart_list_members PK, any source).
   Non-UCC sources enrich by member id — the edge fns resolve name/address from
   the underlying source row and skip members with no usable input (no charge). */
async function gatherAllMemberIds(listId: string): Promise<string[]> {
  const ids: string[] = [];
  const PAGE = 1000;
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("smart_list_members")
      .select("id")
      .eq("smart_list_id", listId)
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    const rows = (data as { id: string }[]) ?? [];
    ids.push(...rows.map((r) => r.id));
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

type PhoneProvider = "twilio" | "realphonevalidation";
const PHONE_PROVIDERS: { id: PhoneProvider; label: string; spendChip: string }[] = [
  { id: "twilio", label: "Twilio", spendChip: "spends Twilio balance" },
  { id: "realphonevalidation", label: "RealValidation", spendChip: "spends RealValidation credits" },
];

type CapCounts = {
  total: number;
  with_phone: number;
  with_company_or_email: number;
  with_address: number;
  ghl_members: number;
};

export default function SmartListActions({ list, onChanged }: { list: SmartList; onChanged: () => void }) {
  const isUcc = list.source === "ph_ucc";

  // Per-list capability counts → grey a provider out when the list holds nothing
  // for it to work on (before the user spends a click). null = still loading;
  // on error we leave all providers enabled (fail-open, never block on a read).
  const [caps, setCaps] = useState<CapCounts | null>(null);
  const [capsErr, setCapsErr] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.rpc("smart_list_capability_counts", { p_list_id: list.id });
        if (cancelled) return;
        if (error) {
          setCapsErr(true);
          return;
        }
        setCaps(data as CapCounts);
      } catch {
        if (!cancelled) setCapsErr(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [list.id]);

  // Address availability is known for the three DB books; for VibeReach it's only
  // knowable via a GHL call, so any ghl members keep skip-trace enabled (the edge
  // fn skips no-address members at no charge). Fail-open while loading / on error.
  const hasAddresses = caps === null || capsErr ? true : caps.with_address > 0 || caps.ghl_members > 0;
  const hasBusiness = caps === null || capsErr ? true : caps.with_company_or_email > 0;
  const hasPhones = caps === null || capsErr ? true : caps.with_phone > 0;

  // ── Phone-validation provider picker (Twilio default / RealValidation) ──
  const [phoneProvider, setPhoneProvider] = useState<PhoneProvider>("twilio");
  // Ready/gated state per provider, read once from provider-balances (one call
  // returns both). ready=null while loading. gated ⇒ the vault key isn't staged.
  const [providerReady, setProviderReady] = useState<Record<PhoneProvider, boolean | null>>({
    twilio: null,
    realphonevalidation: null,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.functions.invoke("provider-balances", { body: {} });
        const r = (data as Record<string, unknown>) ?? {};
        const pv = (r.phone_validation as Record<string, unknown>) ?? {};
        const rpv = (r.realphonevalidation as Record<string, unknown>) ?? {};
        if (cancelled) return;
        setProviderReady({
          twilio: pv.gated !== true,
          realphonevalidation: rpv.gated !== true,
        });
      } catch {
        if (!cancelled) setProviderReady({ twilio: false, realphonevalidation: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── BatchData skip-trace preview ──
  const previewTrace = useCallback(async (): Promise<PreviewResult> => {
    if (isUcc) {
      const eligible = await filterTraceEligible(await gatherMemberSourceIds(list.id, "ph_ucc"));
      return {
        count: eligible.length,
        costUsd: Math.round(eligible.length * TRACE_COST_DISPLAY * 100) / 100,
        note: eligible.length === 0 ? "No UCC members still need skip-tracing." : undefined,
      };
    }
    const ids = await gatherAllMemberIds(list.id);
    return {
      count: ids.length,
      costUsd: Math.round(ids.length * TRACE_COST_DISPLAY * 100) / 100,
      note:
        ids.length === 0
          ? "No members in this list."
          : "Members without a mailing address are skipped server-side (no charge); already-traced members are skipped too.",
    };
  }, [list.id, isUcc]);

  const runTrace: Runner = useCallback(
    async (onProgress, isStopped) => {
      const ids = isUcc
        ? await filterTraceEligible(await gatherMemberSourceIds(list.id, "ph_ucc"))
        : await gatherAllMemberIds(list.id);
      if (ids.length === 0) return "Nothing eligible to skip-trace.";
      let traced = 0,
        ready = 0,
        spent = 0,
        errored = 0,
        noAddress = 0,
        alreadyDone = 0;
      let balanceAfter: number | null = null;
      let paused = false;
      let stopped = false;
      onProgress(0, ids.length);
      for (let i = 0; i < ids.length; i += SKIPTRACE_CAP) {
        if (isStopped?.()) { stopped = true; break; }
        const chunk = ids.slice(i, i + SKIPTRACE_CAP);
        const { data, error } = await supabase.functions.invoke("ph-ucc-skiptrace", {
          body: isUcc ? { lead_ids: chunk } : { smart_list_member_ids: chunk },
        });
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
        noAddress += Number(r.no_address ?? 0) || 0;
        alreadyDone += Number(r.already_traced ?? r.already_done ?? 0) || 0;
        if (typeof r.balance_after === "number") balanceAfter = r.balance_after as number;
        onProgress(Math.min(i + chunk.length, ids.length), ids.length);
      }
      onChanged();
      if (paused) return "Skip-trace is paused in Settings (skiptrace_enabled = OFF). Turn it on to run.";
      // The honest summary: what was traced, what was skipped and WHY, what it cost.
      const bits = [
        `Traced ${traced.toLocaleString()} of ${ids.length.toLocaleString()}`,
        `${ready.toLocaleString()} got a phone/email`,
        noAddress > 0 ? `${noAddress.toLocaleString()} skipped — no mailing address (no charge)` : "",
        alreadyDone > 0 ? `${alreadyDone.toLocaleString()} already traced (skipped)` : "",
        errored > 0 ? `${errored} errored` : "",
        `$${spent.toFixed(2)} spent`,
        balanceAfter != null ? `wallet now $${balanceAfter.toFixed(2)}` : "",
        stopped ? "⏹ stopped early — run again to continue" : "",
      ].filter(Boolean);
      return bits.join(" · ");
    },
    [list.id, isUcc, onChanged],
  );

  // ── Apollo enrich preview (no per-unit price / no balance API) ──
  const previewApollo = useCallback(async (): Promise<PreviewResult> => {
    const ids = isUcc ? await gatherMemberSourceIds(list.id, "ph_ucc") : await gatherAllMemberIds(list.id);
    return {
      count: ids.length,
      costUsd: null,
      note:
        ids.length === 0
          ? "No members in this list."
          : "Spends Apollo credits (no API balance — usage shows in the Apollo dashboard). Members with no company name and already-enriched members are skipped server-side.",
    };
  }, [list.id, isUcc]);

  const runApollo: Runner = useCallback(
    async (onProgress, isStopped) => {
      const ids = isUcc ? await gatherMemberSourceIds(list.id, "ph_ucc") : await gatherAllMemberIds(list.id);
      if (ids.length === 0) return "Nothing to enrich.";
      let enriched = 0,
        checked = 0,
        errored = 0,
        noInput = 0;
      let paused = false;
      let stopped = false;
      onProgress(0, ids.length);
      for (let i = 0; i < ids.length; i += APOLLO_CAP) {
        if (isStopped?.()) { stopped = true; break; }
        const chunk = ids.slice(i, i + APOLLO_CAP);
        const { data, error } = await supabase.functions.invoke("ph-ucc-apollo-enrich", {
          body: isUcc ? { lead_ids: chunk } : { smart_list_member_ids: chunk },
        });
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
        noInput += Number(r.no_input ?? 0) || 0;
        onProgress(Math.min(i + chunk.length, ids.length), ids.length);
      }
      onChanged();
      if (paused) return "Apollo enrichment is disabled in Settings (apollo_enrich_enabled = OFF). Turn it on to run.";
      const bits = [
        `Enriched ${enriched.toLocaleString()} of ${checked.toLocaleString()} checked`,
        noInput > 0 ? `${noInput.toLocaleString()} skipped — no company/email to match on` : "",
        errored > 0 ? `${errored} errored` : "",
        stopped ? "⏹ stopped early — run again to continue" : "",
      ].filter(Boolean);
      return bits.join(" · ");
    },
    [list.id, isUcc, onChanged],
  );

  const providerLabel = phoneProvider === "realphonevalidation" ? "RealValidation" : "Twilio";

  // ── Phone validation preview (chosen provider; gated until its key is added) ──
  const previewPhone = useCallback(async (): Promise<PreviewResult> => {
    const { data, error } = await supabase.functions.invoke("phone-validate", {
      body: { action: "preview", smart_list_id: list.id, provider: phoneProvider },
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
      note: r.gated === true ? `Add the ${providerLabel} key to enable phone validation.` : undefined,
    };
  }, [list.id, phoneProvider, providerLabel]);

  const runPhone: Runner = useCallback(
    async (onProgress, isStopped) => {
      let stopped = false;
      let validated = 0,
        mobile = 0,
        landline = 0,
        voip = 0,
        unreachable = 0,
        noPhone = 0,
        errored = 0,
        looked = 0;
      // Progress out of what ACTUALLY needs validating (capped by the per-run
      // ceiling) — not a fixed constant that lies about the list size.
      let total = PHONE_TARGET;
      try {
        const { data: pv } = await supabase.functions.invoke("phone-validate", {
          body: { action: "preview", smart_list_id: list.id, provider: phoneProvider },
        });
        const needing = Number((pv as Record<string, unknown>)?.needing_validation ?? 0) || 0;
        if (needing > 0) total = Math.min(needing, PHONE_TARGET);
      } catch { /* fall back to the ceiling */ }
      // Loop ≤200/call. Stop when a call validates nothing new (remaining members
      // are no-phone/errored) or the list drains.
      onProgress(0, total);
      while (looked < PHONE_TARGET) {
        if (isStopped?.()) { stopped = true; break; }
        const { data, error } = await supabase.functions.invoke("phone-validate", {
          body: { action: "validate", smart_list_id: list.id, limit: 200, provider: phoneProvider },
        });
        if (error) throw new Error(await fnErrorMessage(error));
        const r = (data as Record<string, unknown>) ?? {};
        if (r.gated === true) return `Add the ${providerLabel} key to enable phone validation.`;
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
      // Balance-after (best-effort; separate cheap read). Only Twilio exposes a
      // balance API — RealValidation has none, so we skip the read for it.
      let bal = "";
      if (phoneProvider === "twilio") {
        try {
          const { data: b } = await supabase.functions.invoke("phone-validate", { body: { action: "balance", provider: phoneProvider } });
          const br = (b as Record<string, unknown>) ?? {};
          if (br.ok === true && typeof br.balance === "number") bal = ` · Twilio now $${(br.balance as number).toFixed(2)}`;
        } catch {
          /* balance is a nicety; never fail the run over it */
        }
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
      return `Validated ${validated.toLocaleString()}${extras ? " · " + extras : ""}${bal}${stopped ? " · ⏹ stopped early — run again to continue" : ""}`;
    },
    [list.id, onChanged, phoneProvider, providerLabel],
  );

  return (
   <div className="space-y-3">
    {/* STEP 1 — clean the list FIRST (skip-trace / enrich / validate). These are the
        primary actions, so they lead; the rollup + suppress + push come after. */}
    <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-ocean-blue text-white text-[11px] font-bold">1</span>
      Clean the list — skip-trace · enrich · validate the phones
    </h3>
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
      <ActionPanel
        title="BatchData skip-trace"
        blurb="Takes a name + mailing address and appends fresh phone numbers and emails for the owner — plus a DNC / TCPA-litigator flag on each phone. Best on UCC and Customer lists (they carry addresses)."
        icon={<MagnifyingGlassIcon className="w-4 h-4" />}
        accent="ocean-blue"
        spendChip="spends BatchData wallet"
        enabled={hasAddresses}
        disabledReason="No mailing addresses in this list — skip-trace needs an address. Try phone validation or Apollo instead."
        previewFn={previewTrace}
        runFn={runTrace}
        confirmVerb="Skip-trace"
      />
      <ActionPanel
        title="Apollo enrich"
        blurb="Takes a company name or email and fills in business firmographics — title, industry, employee count, annual revenue, website and LinkedIn — plus a verified business email where available."
        icon={<SparklesIcon className="w-4 h-4" />}
        accent="violet-600"
        spendChip="spends Apollo credits"
        enabled={hasBusiness}
        disabledReason="No company names or emails in this list — Apollo has nothing to match on."
        previewFn={previewApollo}
        runFn={runApollo}
        confirmVerb="Enrich"
      />
      <ActionPanel
        // Remount on provider switch so a stale preview/gated verdict never carries
        // across providers (each has its own key gate).
        key={`phone-${phoneProvider}`}
        title="Phone validation"
        blurb="Checks each phone against the carrier network — is it live or disconnected, mobile / landline / VoIP, which carrier — so the floor only dials numbers that ring. Twilio or RealValidation."
        icon={<PhoneIcon className="w-4 h-4" />}
        accent="mint-green"
        spendChip={PHONE_PROVIDERS.find((p) => p.id === phoneProvider)?.spendChip ?? "spends provider credits"}
        enabled={hasPhones}
        disabledReason="No phone numbers in this list — nothing to validate. Skip-trace or Apollo can append phones first."
        previewFn={previewPhone}
        runFn={runPhone}
        confirmVerb="Validate"
        extra={
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Provider</p>
            <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 p-0.5 gap-0.5">
              {PHONE_PROVIDERS.map((p) => {
                const ready = providerReady[p.id];
                const selected = phoneProvider === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPhoneProvider(p.id)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium inline-flex items-center gap-1.5 transition-colors ${
                      selected
                        ? "bg-mint-green/15 text-mint-green ring-1 ring-mint-green/40"
                        : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50"
                    }`}
                    title={ready === false ? `${p.label}: key not staged (gated)` : ready === true ? `${p.label}: ready` : `${p.label}: checking…`}
                  >
                    <span
                      className={`inline-block w-1.5 h-1.5 rounded-full ${
                        ready === true ? "bg-emerald-500" : ready === false ? "bg-amber-500" : "bg-gray-300 dark:bg-gray-600"
                      }`}
                    />
                    {p.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              {providerReady[phoneProvider] === false
                ? `${providerLabel} not configured — key not staged in the vault.`
                : providerReady[phoneProvider] === true
                  ? `${providerLabel} ready.`
                  : "Checking provider status…"}
            </p>
          </div>
        }
      />
    </div>

    {/* STEP 2 — review the results, then suppress dead/DNC + push the clean list. */}
    <h3 className="mt-1 text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-ocean-blue text-white text-[11px] font-bold">2</span>
      Review &amp; push to setters
    </h3>
    <SmartListRollup list={list} onChanged={onChanged} />
   </div>
  );
}

/* One provider action: preview → two-step confirm → run with progress. */
function ActionPanel({
  title,
  blurb,
  icon,
  accent,
  spendChip,
  enabled,
  disabledReason,
  previewFn,
  runFn,
  confirmVerb,
  extra,
}: {
  title: string;
  blurb: string;
  icon: React.ReactNode;
  accent: string;
  spendChip: string;
  enabled: boolean;
  disabledReason?: string;
  previewFn: () => Promise<PreviewResult>;
  runFn: Runner;
  confirmVerb: string;
  extra?: React.ReactNode;
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

  // Auto-run the count/cost preview the moment the panel is enabled — no manual
  // "Preview" click. Fires once per panel instance (the phone panel remounts on
  // provider switch, so it re-previews per provider). A manual Refresh still works.
  const autoRan = useRef(false);
  useEffect(() => {
    if (enabled && !autoRan.current) {
      autoRan.current = true;
      void doPreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // Stop switch — checked between batches, so pressing Stop halts before the NEXT
  // API chunk fires (the in-flight chunk finishes; nothing is left half-written).
  const stopRef = useRef(false);
  const doRun = async () => {
    setArmed(false);
    setRunning(true);
    setErr(null);
    setResult(null);
    stopRef.current = false;
    setProgress({ done: 0, total: 1 });
    try {
      const summary = await runFn(
        (done, total) => setProgress({ done, total }),
        () => stopRef.current,
      );
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

      {/* What this provider does — always visible, enabled or not. */}
      <p className="text-xs leading-snug text-gray-500 dark:text-gray-400">{blurb}</p>

      {!enabled ? (
        <p className="text-xs font-medium text-amber-600 dark:text-amber-400">{disabledReason}</p>
      ) : (
        <>
          {extra}
          {/* Count/cost auto-loads; this just re-checks it. */}
          <button onClick={doPreview} disabled={previewing || running} className="btn-ghost btn-sm inline-flex items-center gap-1.5">
            <MagnifyingGlassIcon className="w-4 h-4" /> {previewing ? "Counting…" : preview ? "Refresh count" : "Count & cost"}
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
              Add the key to enable
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
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-gray-600 dark:text-gray-300">
                  {progress.done.toLocaleString()} / {progress.total.toLocaleString()}…
                </p>
                <button
                  type="button"
                  onClick={() => { stopRef.current = true; }}
                  className="text-[11px] font-bold px-2 py-0.5 rounded-full border border-red-400 text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20"
                  title="Stop after the current batch — nothing is left half-written; run again to continue"
                >
                  ⏹ Stop
                </button>
              </div>
            </div>
          )}

          {result && <p className="text-sm text-emerald-700 dark:text-emerald-300">{result}</p>}
          {err && <p className="text-sm text-rose-600 dark:text-rose-400">Failed: {err}</p>}
        </>
      )}
    </div>
  );
}
