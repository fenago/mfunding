// SetterAppProgress — the headline of the Setter checklist: a LIVE completion meter
// for the merchant application plus the exact mandatory fields still missing, grouped
// by section. It reads the deal's saved mca_applications draft so it updates the moment
// the setter saves, and measures completeness through applicationCompleteness() — the
// SAME required-field definition MerchantApplicationModal gates its send on, so the two
// can never disagree.
//
// Clicking "Fill out / continue application" opens the very same MerchantApplicationModal
// the action rail uses (all three send paths built in). On save/send it refreshes the
// deal AND re-reads the draft row so the meter moves.
//
// UNREADABLE ≠ 0%: if the draft read fails we say "couldn't read application status",
// never a false "0% complete".

import { useCallback, useEffect, useRef, useState } from "react";
import { PencilSquareIcon, CheckCircleIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import supabase from "@/supabase";
import type { DealWithCustomer } from "@/types/deals";
import {
  applicationCompleteness,
  SECTION_LABEL,
  type AppSection,
  type CompletenessResult,
} from "@/lib/applicationCompleteness";
import MerchantApplicationModal from "@/components/admin/MerchantApplicationModal";
import { ensureDealStageAtLeast } from "@/services/dealService";

/** Glance status the wrapper checklist mirrors on its step-1 badge. */
export interface AppProgressStatus {
  pct: number;
  done: boolean;
  /** The draft couldn't be read — show neutral, never a false 0%/done. */
  unreadable: boolean;
}

interface Props {
  deal: DealWithCustomer;
  onRefresh: () => void;
  /** Optional: report completeness up so a parent can render a status marker. */
  onStatus?: (s: AppProgressStatus) => void;
}

type ReadState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; result: CompletenessResult };

const SECTION_ORDER: AppSection[] = ["business", "owner", "banking", "funding"];

export default function SetterAppProgress({ deal, onRefresh, onStatus }: Props) {
  const [state, setState] = useState<ReadState>({ phase: "loading" });
  const [showApp, setShowApp] = useState(false);

  // Report status up without making onStatus a load() dependency (parents may pass
  // a fresh function each render).
  const onStatusRef = useRef(onStatus);
  useEffect(() => { onStatusRef.current = onStatus; }, [onStatus]);
  useEffect(() => {
    const cb = onStatusRef.current;
    if (!cb) return;
    if (state.phase === "ready") {
      cb({ pct: state.result.pct, done: state.result.missing.length === 0, unreadable: false });
    } else if (state.phase === "error") {
      cb({ pct: 0, done: false, unreadable: true });
    }
  }, [state]);

  const load = useCallback(async () => {
    setState({ phase: "loading" });
    // maybeSingle → a deal with no saved draft returns data:null (NOT an error);
    // a real read failure returns error, which we surface as UNREADABLE.
    const { data, error } = await supabase
      .from("mca_applications")
      .select("*")
      .eq("deal_id", deal.id)
      .maybeSingle();
    if (error) {
      setState({ phase: "error", message: "couldn't read application status" });
      return;
    }
    setState({
      phase: "ready",
      result: applicationCompleteness(deal, (data as Record<string, unknown> | null) ?? null),
    });
    // deal is intentionally re-read inside applicationCompleteness on every load so the
    // prefill (no-draft case) reflects the current customer/deal/lead values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal]);

  useEffect(() => {
    void load();
  }, [load]);

  // ── Header row is shared across states ──
  const openBtn = (
    <button
      type="button"
      onClick={() => setShowApp(true)}
      className="inline-flex items-center gap-1.5 rounded-lg bg-ocean-blue px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-ocean-blue/90"
    >
      <PencilSquareIcon className="w-4 h-4" />
      {state.phase === "ready" && state.result.filled > 0 ? "Continue application" : "Fill out application"}
    </button>
  );

  let body: React.ReactNode;

  if (state.phase === "loading") {
    body = (
      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        <span className="loading loading-spinner loading-xs" /> Reading application status…
      </div>
    );
  } else if (state.phase === "error") {
    body = (
      <div className="flex items-start gap-2 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
        <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" />
        <div>
          <span className="font-bold">{state.message}</span> — the draft couldn't be read just now.
          Open the application to check, or{" "}
          <button type="button" onClick={() => void load()} className="underline font-semibold">
            retry
          </button>
          .
        </div>
      </div>
    );
  } else {
    const { pct, filled, totalRequired, missing, missingBySection } = state.result;
    const done = missing.length === 0;
    const barColor = done
      ? "bg-emerald-500"
      : pct >= 50
      ? "bg-ocean-blue"
      : "bg-amber-500";

    body = (
      <div className="space-y-2.5">
        {/* Meter */}
        <div>
          <div className="flex items-baseline justify-between mb-1">
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">
              {done ? (
                <span className="text-emerald-600 dark:text-emerald-400">
                  All required fields filled — ready to send
                </span>
              ) : (
                <>
                  <span className="font-bold">{missing.length}</span> required{" "}
                  {missing.length === 1 ? "field" : "fields"} left before you can send
                </>
              )}
            </span>
            <span className={`text-sm font-extrabold ${done ? "text-emerald-600 dark:text-emerald-400" : "text-gray-900 dark:text-white"}`}>
              {pct}%
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${barColor}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
            {filled} of {totalRequired} mandatory fields filled
            {!done && (
              <>
                {" · "}
                {SECTION_ORDER.filter((s) => missingBySection[s] > 0)
                  .map((s) => `${SECTION_LABEL[s]}: ${missingBySection[s]}`)
                  .join(" · ")}
              </>
            )}
          </div>
        </div>

        {/* Missing fields, grouped by section */}
        {!done && (
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {SECTION_ORDER.filter((s) => missingBySection[s] > 0).map((section) => (
              <div
                key={section}
                className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 px-2.5 py-2"
              >
                <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {SECTION_LABEL[section]}
                </div>
                <ul className="mt-1 space-y-0.5">
                  {missing
                    .filter((m) => m.section === section)
                    .map((m) => (
                      <li key={m.key} className="flex items-center gap-1.5 text-[12px] text-gray-700 dark:text-gray-300">
                        <span className="text-amber-500">○</span>
                        {m.label}
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5">
          {state.phase === "ready" && state.result.missing.length === 0 ? (
            <CheckCircleIcon className="w-4 h-4 text-emerald-500" />
          ) : null}
          <span className="text-sm font-bold text-gray-900 dark:text-white">Application</span>
        </div>
        {openBtn}
      </div>
      {body}

      {showApp && (
        <MerchantApplicationModal
          deal={deal}
          onClose={() => {
            setShowApp(false);
            // Re-read the draft on close — the setter may have saved.
            void load();
          }}
          onSent={async () => {
            setShowApp(false);
            await ensureDealStageAtLeast(deal, "application_sent");
            onRefresh();
            void load();
          }}
          onSaved={async () => {
            await ensureDealStageAtLeast(deal, "qualifying");
            onRefresh();
            void load();
          }}
        />
      )}
    </div>
  );
}
