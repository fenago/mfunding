// RetiredDuplicateBadge — says what a retired duplicate deal actually is.
//
// WHY THIS EXISTS
// Six merchants carry a second deal row that was retired as a duplicate on
// 2026-08-28 (status 'dead', lost_reason 'duplicate', opportunity id cleared,
// survivor named in a tombstone note). The create-path bug behind them was fixed
// the same week and has not recurred since.
//
// But nothing ever TOLD anyone. No surface filtered or labelled
// lost_reason = 'duplicate', so a retired duplicate rendered wherever a dead deal
// renders — an unexplained second row on a merchant — and the only record of what
// happened to it was free text in an activity_log note nobody opens. That is the
// most likely thing behind "I don't even understand how there can be three
// totally different deals with the same company".
//
// LABEL, DO NOT HIDE. Hiding is what produced the worst failure of that same day:
// ghl-docs-status' 20-document window hid 248 documents and rendered as "nothing
// to sign" for 44 merchants who had signed. A confusing row you can read beats a
// tidy screen that is lying. One line turns the artifact into a sentence.
//
// The survivor is named when we know it. When we do not — one row is marked
// duplicate with no tombstone, and it turned out to be a retired TEST record
// rather than a duplicate at all — we say "retired", because naming a merger we
// cannot evidence would be inventing the same kind of fact this codebase keeps
// getting burned by.

import { Link } from "react-router-dom";

interface Props {
  lostReason?: string | null;
  /** The surviving deal this row was merged into, when known. */
  duplicateOf?: { id: string; deal_number: string | null } | null;
  /** `inline` sits next to a deal number in a table row; `block` is the banner
   *  at the top of a deal's own page. */
  variant?: "inline" | "block";
}

export default function RetiredDuplicateBadge({ lostReason, duplicateOf, variant = "inline" }: Props) {
  if (lostReason !== "duplicate") return null;

  const survivor = duplicateOf?.deal_number ? duplicateOf : null;

  if (variant === "inline") {
    return (
      <span
        className="ml-2 inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
        title={
          survivor
            ? `This row was retired as a duplicate and merged into ${survivor.deal_number}. It is kept, not deleted, so the history stays readable.`
            : "This row was retired and marked a duplicate, but no surviving deal was recorded for it. Open it to see why it was retired."
        }
      >
        {survivor ? `Retired duplicate → ${survivor.deal_number}` : "Retired (marked duplicate)"}
      </span>
    );
  }

  return (
    <div className="mb-3 rounded-md border border-amber-200 bg-amber-50/70 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
      {survivor ? (
        <>
          <span className="font-semibold">This deal was retired as a duplicate.</span>{" "}
          The live deal for this merchant is{" "}
          <Link to={`/admin/deals/${survivor.id}`} className="font-mono underline">
            {survivor.deal_number}
          </Link>
          . This row is kept rather than deleted so the history stays readable — work on the live deal.
        </>
      ) : (
        <>
          <span className="font-semibold">This deal was retired and marked a duplicate</span>, but no surviving
          deal was recorded for it. Check the timeline below for why it was retired before treating it as a
          duplicate of anything.
        </>
      )}
    </div>
  );
}
