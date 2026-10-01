// ───────────── UnderwritingLauncher — the AI underwriter, wherever the file is ─────────────
//
// OWNER REQUEST, 2026-10-01: "Anytime that we have a file where we have bank
// statements, I'd love to have that button where we have the AI underwriter
// right there."
//
// Before this, AIUnderwritingPanel had exactly two mounts: the Revenue Playbook
// and an `underwriting` tab on /admin/deals/:id. The second is behind
// AdminOnlyProtectedRoute, which excludes role=closer — and BOTH processors are
// role=closer with closers.is_processor, so for them the underwriter existed in
// one place only, on a screen they do not work from.
//
// This is a LAUNCHER, not a second panel. It mounts the one real
// AIUnderwritingPanel in a modal on click. Three rules it exists to keep:
//
// ① NOTHING RUNS ON RENDER. The underwriter is a ~1-minute LLM call. A board of
//    400 rows must cost nothing until someone clicks. Opening costs one read;
//    not opening costs nothing.
//
// ② THE LABEL TELLS THE TRUTH ABOUT WHAT ALREADY EXISTS. "Run underwriting" on a
//    deal that has already been underwritten is an invitation to spend tokens
//    twice — the owner's explicit concern. The caller hands down a UWVerdict
//    (see useUnderwritingSummaries); a run that exists says "View", a verdict we
//    could not READ says neither "View" nor "Run", just "AI Underwriter".
//
// ③ A ZERO FROM ONE STORE IS NOT A ZERO, SO NO STORE'S ZERO HIDES THE BUTTON.
//    Statements live in `customer_documents` (app uploads), on the merchant's
//    VibeReach contact (form uploads — most of them), and in a connected Plaid
//    feed. underwrite-deal searches all three: when the local store is empty it
//    ingests from the whole contact SET and synthesises months from
//    plaid_transactions. No client surface reads all three, so none of them is
//    entitled to decide there is nothing to underwrite — a button suppressed by
//    an app-store zero would be missing on exactly the merchants the underwriter
//    works for. `StatementEvidence` therefore only ever changes the HINT. The
//    authority on "is there a statement" is the edge function's own 422, which
//    already separates "we searched everywhere and found none" from "the search
//    did not complete".
import { Suspense, lazy, useEffect, useState } from "react";
import { SparklesIcon, XMarkIcon } from "@heroicons/react/24/outline";
import type { UWVerdict } from "@/hooks/useUnderwritingSummaries";

/** Which tab the panel opens on. Mirrors AIUnderwritingPanel's own TabKey; a
 *  control placed beside the funder picker should land on "funders", because
 *  that is why the reader clicked it. */
export type UnderwritingTab = "decision" | "risks" | "funders" | "submission" | "working";

// LAZY, not static. The launcher now sits on every row of the processor board and
// the chase queue; a static import would make all of them fetch the panel's
// ~17KB gzip (plus Recharts) on page load, for a modal most rows never open.
// Same principle as the run itself: opening costs something, not opening costs
// nothing. It is still the ONE panel — this is a code-split, not a fork.
const AIUnderwritingPanel = lazy(() => import("./AIUnderwritingPanel"));

/**
 * What the CALLING surface knows about this merchant's bank statements. It
 * drives the HINT only — never whether the control renders (see ③ above).
 *
 * `none_in_docs` says "the document stores I can see are empty", which is the
 * most any client surface can say: a connected bank feed is first-class evidence
 * to the underwriter and nothing here reads `plaid_items`.
 */
export type StatementEvidence =
  | { kind: "present"; count?: number | null; where?: string }
  | { kind: "unknown"; why?: string }
  | { kind: "none_in_docs"; where: string };

const RATING_CLS: Record<string, string> = {
  strong: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  adequate: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  tight: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  unaffordable: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  low: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  medium: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  high: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

const relDay = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const d = Math.floor((Date.now() - t) / 86_400_000);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 30) return `${d}d ago`;
  return new Date(t).toLocaleDateString();
};

/** The verdict chips — the scannable half. Ratings only; the numbers are inside. */
function VerdictChips({ v }: { v: UWVerdict }) {
  if (v.kind !== "has") return null;
  const { affordability, risk } = v.summary;
  return (
    <>
      {affordability && (
        <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${RATING_CLS[affordability] ?? RATING_CLS.adequate}`}>
          {affordability}
        </span>
      )}
      {risk && (
        <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${RATING_CLS[risk] ?? RATING_CLS.adequate}`}>
          {risk} risk
        </span>
      )}
    </>
  );
}

export default function UnderwritingLauncher({
  dealId,
  verdict,
  statements = { kind: "unknown" },
  merchantName = null,
  size = "sm",
  className = "",
  initialTab,
  onRan,
}: {
  dealId: string;
  /** From useUnderwritingSummaries().verdictFor(dealId). Omit only where no batch
   *  read is possible — the control then says "AI Underwriter" and resolves
   *  everything on click, which is honest but less informative. */
  verdict?: UWVerdict;
  statements?: StatementEvidence;
  merchantName?: string | null;
  size?: "xs" | "sm";
  className?: string;
  /** Open the panel on a specific tab. Omit for "Decision" (can we fund it). */
  initialTab?: UnderwritingTab;
  /** Called when the modal closes, so a list can refresh its verdict chips. */
  onRan?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const v: UWVerdict = verdict ?? { kind: "unknown", why: "this surface does not pre-check underwriting history" };

  // Esc closes. Mounted only while open so it never fights the drawer behind it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const label =
    v.kind === "has"
      ? "View underwriting"
      : v.kind === "none"
        ? "Run underwriting"
        // NOT "Run": we do not know whether a paid run already exists, and
        // inviting one is how the same statements get underwritten twice.
        : "AI Underwriter";

  const title =
    v.kind === "has"
      ? `AI underwriting v${v.summary.version ?? "?"} ran ${relDay(v.summary.createdAt)} — open it (no new tokens spent)`
      : v.kind === "none"
        ? statements.kind === "present"
          ? "Claude reads the bank statements and returns affordability, risk and funder fit (~1 min)"
          : statements.kind === "none_in_docs"
            ? `No statements in ${statements.where} — the underwriter still searches the merchant's whole VibeReach contact set and any connected bank feed, and says so plainly if it finds nothing.`
            : "Claude reads the bank statements and returns affordability, risk and funder fit. It also searches the merchant's VibeReach contact and any connected bank feed, so statements that never reached this app still count."
        : `Couldn't check whether this deal has already been underwritten — ${v.why}. This is NOT "never underwritten"; open it to see.`;

  const pad = size === "xs" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-[11px]";
  const tone =
    v.kind === "has"
      ? "text-ocean-blue border-ocean-blue/40 hover:bg-blue-50 dark:hover:bg-blue-900/20"
      : "text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-ocean-blue hover:text-ocean-blue";

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        title={title}
        className={`inline-flex items-center gap-1 font-semibold rounded-full border ${pad} ${tone} ${className}`}
      >
        <SparklesIcon className="w-3 h-3 shrink-0" />
        {label}
        <VerdictChips v={v} />
      </button>

      {/* In-app modal — NOT a browser popup (house rule). z-[60] so it sits over
          the processor drawer (z-50) that may have launched it. */}
      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-start justify-center p-3 sm:p-6 bg-black/60 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          onClick={() => {
            setOpen(false);
            onRan?.();
          }}
        >
          <div
            className="bg-gray-50 dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-5xl my-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 px-5 py-3 border-b border-gray-200 dark:border-gray-700 sticky top-0 bg-gray-50 dark:bg-gray-900 rounded-t-xl z-10">
              <div className="min-w-0">
                <h3 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  <SparklesIcon className="w-5 h-5 text-ocean-blue shrink-0" />
                  AI Underwriter
                  {merchantName && (
                    <span className="font-normal text-gray-500 dark:text-gray-400 truncate">· {merchantName}</span>
                  )}
                </h3>
                {/* Say what we know about the statements, naming the store — a
                    count is only a verdict about a merchant if it covers
                    everywhere they could have put the file. */}
                {statements.kind === "present" && (
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                    {statements.count != null ? `${statements.count} bank statement${statements.count === 1 ? "" : "s"}` : "Bank statements"}
                    {statements.where ? ` in ${statements.where}` : ""} · the underwriter also searches VibeReach and any connected bank feed
                  </p>
                )}
                {statements.kind === "unknown" && (
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                    Statements may be in this app, on the merchant's VibeReach contact, or in a connected bank feed — the underwriter searches all three.
                  </p>
                )}
                {statements.kind === "none_in_docs" && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">
                    No statements in {statements.where} — the underwriter still searches every VibeReach contact
                    this merchant is known by, plus any connected bank feed.
                  </p>
                )}
                {v.kind === "unknown" && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">
                    ⚠ Couldn't pre-check for an existing run ({v.why}) — the history below is the real answer.
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onRan?.();
                }}
                className="shrink-0 p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-800"
                aria-label="Close"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4">
              {/* THE one panel. Not a fork, not a compact twin. */}
              <Suspense
                fallback={
                  <div className="flex items-center justify-center py-16">
                    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-mint-green" />
                  </div>
                }
              >
                <AIUnderwritingPanel dealId={dealId} initialTab={initialTab} />
              </Suspense>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
