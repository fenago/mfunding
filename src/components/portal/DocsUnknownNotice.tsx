import { Link } from "react-router-dom";
import { ArrowPathIcon, ChatBubbleLeftRightIcon } from "@heroicons/react/24/outline";
import type { UnifiedDocs } from "../../utils/signing";

/**
 * What the MERCHANT is told when we could not read their documents.
 *
 * ── WHY THIS COMPONENT EXISTS ───────────────────────────────────────────────
 * Because the alternative shipped for months: a failed read became `[]` and the
 * portal said "No documents are waiting for your signature right now." A
 * confident negative fact, delivered to the one person in the chain who cannot
 * check it against anything, about paperwork that may already be in their inbox.
 * They don't sign; the deal then reads internally as UNSIGNED; and an outage
 * nobody disclosed is quietly recorded as the customer's failure.
 *
 * ── THE TONE RULES, WHICH ARE NOT DECORATION ────────────────────────────────
 * This is a stranger's business owner, mid-funding, quite possibly anxious about
 * money. So:
 *   · never the bare word "error", and never a technical reason — the server's
 *     `error` / `note` fields are diagnostics for our logs, not for them;
 *   · never phrasing that implies THEY did something wrong or missed something;
 *   · always state the negative explicitly — "this doesn't mean nothing was
 *     sent" — because that inference is exactly what the old empty state invited;
 *   · always leave a way to reach a human, because the honest answer to "what do
 *     I do now?" is sometimes "ask someone".
 *
 * Two shapes: `card` for an otherwise-empty list (it IS the empty state), and
 * `inline` for a quiet line above a list we did manage to show, where the
 * documents are real but their completeness isn't guaranteed.
 */
export default function DocsUnknownNotice({
  kind,
  variant = "card",
  onRetry,
  className = "",
}: {
  /** From `UnifiedDocs.unknownKind` — nothing renders when it's null. */
  kind: UnifiedDocs["unknownKind"];
  variant?: "card" | "inline";
  /** Re-run the load. Omit to leave the merchant with the refresh hint only. */
  onRetry?: () => void;
  className?: string;
}) {
  if (!kind) return null;

  // UNREADABLE: we know nothing about their documents, so the whole list is in
  // question. PARTIAL: what's shown is real, but something may be missing — a
  // quieter, narrower claim, and it must not be overstated into the first one.
  const headline =
    kind === "unreadable"
      ? "We couldn't load your documents just now"
      : "This list may not be complete";
  const body =
    kind === "unreadable"
      ? "This doesn't mean nothing was sent. Please try again in a moment — or send us a message and we'll check for you."
      : "Anything shown here is real, but we may not be seeing all of your paperwork. Send us a message and we'll confirm what's outstanding.";

  if (variant === "inline") {
    return (
      <p className={`text-xs text-amber-700 dark:text-amber-300 ${className}`}>
        {headline}. {body}{" "}
        <Link to="/portal/inbox" className="font-semibold underline underline-offset-2">
          Message us
        </Link>
      </p>
    );
  }

  return (
    <div
      className={`rounded-xl border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-900/20 p-5 ${className}`}
    >
      <p className="font-semibold text-amber-900 dark:text-amber-100">{headline}</p>
      <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">{body}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-700"
          >
            <ArrowPathIcon className="w-4 h-4" />
            Try again
          </button>
        )}
        <Link
          to="/portal/inbox"
          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400 dark:border-amber-600 px-3 py-2 text-sm font-semibold text-amber-900 dark:text-amber-100 transition-colors hover:bg-amber-100 dark:hover:bg-amber-900/40"
        >
          <ChatBubbleLeftRightIcon className="w-4 h-4" />
          Message us
        </Link>
      </div>
    </div>
  );
}
