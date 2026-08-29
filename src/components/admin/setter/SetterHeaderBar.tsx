import { useState } from "react";
import { UserIcon, BuildingOfficeIcon, PhoneIcon, EnvelopeIcon } from "@heroicons/react/24/outline";
import PipelineFlow from "../../shared/PipelineFlow";
import { updateDealStatus } from "../../../services/dealService";
import { PIPELINES } from "../../../data/pipelines";
import type { DealWithCustomer, DealStatus } from "../../../types/deals";

/**
 * SetterHeaderBar — the trimmed "who + where in the pipeline" header for the
 * setter Operations console. It is the same interactive stage rail the Revenue
 * Playbook's context bar uses (PipelineFlow), wired to the SAME canonical
 * mutation (updateDealStatus, which also syncs the GHL opportunity), with the
 * same confirm/celebrate pattern as PlaybooksPage.advanceDeal — minus every
 * economics/campaign/attribution control (setters never see the money math).
 *
 * Bottom-line only: owner, business, phone, email, then the clickable rail.
 */

const TERMINAL = ["nurture", "declined", "dead"];

const pipelineOf = (dealType: string): "mca" | "vcf" => (dealType === "vcf" ? "vcf" : "mca");

const stageLabel = (pipeline: "mca" | "vcf", key: string) =>
  PIPELINES[pipeline].stages.find((s) => s.key === key)?.label ?? key;

const dealName = (d: DealWithCustomer) =>
  d.customer?.business_name ||
  [d.customer?.first_name, d.customer?.last_name].filter(Boolean).join(" ") ||
  d.deal_number ||
  "Lead";

export default function SetterHeaderBar({
  deal,
  onRefresh,
  notify,
}: {
  deal: DealWithCustomer;
  onRefresh: () => void;
  notify: (text: string, tone?: string) => void;
}) {
  const pipeline = pipelineOf(deal.deal_type);
  const order = PIPELINES[pipeline].stages.map((s) => s.key);
  const isTerminal = TERMINAL.includes(deal.status);

  // Inline confirm (owner's rule: no browser popups) — the pending stage move is
  // held here and applied on confirm.
  const [pending, setPending] = useState<{ stageKey: string; backward: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [celebrate, setCelebrate] = useState<string | null>(null);

  const ownerName =
    [deal.customer?.first_name, deal.customer?.last_name].filter(Boolean).join(" ") || "—";
  const business = deal.customer?.business_name || "—";
  const phone = deal.customer?.phone || "";
  const email = deal.customer?.email || "";

  function requestMove(stageKey: string) {
    if (stageKey === deal.status) return;
    const curIdx = order.indexOf(deal.status);
    const tgtIdx = order.indexOf(stageKey);
    const backward = tgtIdx !== -1 && curIdx !== -1 && tgtIdx < curIdx;
    setPending({ stageKey, backward });
  }

  async function applyMove() {
    if (!pending) return;
    const { stageKey, backward } = pending;
    const label = stageLabel(pipeline, stageKey);
    setBusy(true);
    try {
      await updateDealStatus(deal.id, stageKey as DealStatus);
      onRefresh();
      if (backward) {
        notify(`Moved back to ${label} — nothing was sent to the merchant.`, "ok");
      } else if (stageKey === "funded") {
        setCelebrate("FUNDED 🎉");
        notify(`${dealName(deal)} → ${label} ✓`, "ok");
      } else {
        setCelebrate(`${label} ✓`);
        notify(`Moved to ${label}.`, "ok");
      }
      setTimeout(() => setCelebrate(null), 2600);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not move the deal. Please try again.", "error");
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-3">
      {/* Bottom-line identity */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
        <span className="inline-flex items-center gap-1.5 font-bold text-gray-900 dark:text-white">
          <BuildingOfficeIcon className="w-4 h-4 text-gray-400" /> {business}
        </span>
        <span className="inline-flex items-center gap-1.5 text-gray-600 dark:text-gray-300">
          <UserIcon className="w-4 h-4 text-gray-400" /> {ownerName}
        </span>
        {phone && (
          <a
            href={`tel:${phone}`}
            className="inline-flex items-center gap-1.5 text-gray-600 dark:text-gray-300 hover:text-ocean-blue"
          >
            <PhoneIcon className="w-4 h-4 text-gray-400" /> {phone}
          </a>
        )}
        {email && (
          <a
            href={`mailto:${email}`}
            className="inline-flex items-center gap-1.5 text-gray-600 dark:text-gray-300 hover:text-ocean-blue truncate max-w-[16rem]"
          >
            <EnvelopeIcon className="w-4 h-4 text-gray-400" /> {email}
          </a>
        )}
      </div>

      {/* The clickable stage rail — same component, same canonical mutation. */}
      <PipelineFlow
        pipeline={pipeline}
        currentKey={deal.status}
        onStageClick={busy ? undefined : requestMove}
        terminal={isTerminal}
      />

      {celebrate && (
        <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400">{celebrate}</div>
      )}

      {/* Inline confirm — replaces window.confirm (owner rule). */}
      {pending && (
        <div
          className={`rounded-lg border px-3 py-2 text-xs ${
            pending.backward
              ? "border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300"
              : "border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300"
          }`}
        >
          <div className="font-semibold">
            {pending.backward
              ? `Move ${dealName(deal)} BACK to "${stageLabel(pipeline, pending.stageKey)}"?`
              : `Move ${dealName(deal)} to "${stageLabel(pipeline, pending.stageKey)}"?`}
          </div>
          <div className="mt-0.5">
            {pending.backward
              ? "This rewinds the pipeline stage. Nothing is sent to the merchant — no email, no docs, no notification. GHL moves to the earlier stage too."
              : "This updates the deal and fires the GoHighLevel automation for that stage."}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void applyMove()}
              disabled={busy}
              className="px-3 py-1 rounded-lg text-xs font-semibold text-white bg-ocean-blue hover:bg-ocean-blue/90 disabled:opacity-50"
            >
              {busy ? "Moving…" : pending.backward ? "Move it back" : "Move the deal"}
            </button>
            <button
              type="button"
              onClick={() => setPending(null)}
              disabled={busy}
              className="px-3 py-1 rounded-lg text-xs font-semibold text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
