// cornerAlert — the shape of a bottom-right corner card.
//
// ONE STACK, THREE KINDS. The corner is a scarce piece of screen: two
// independently positioned stacks would overlap and cover each other, so every
// alert stream feeds this same type and NewLeadToast renders them together.
//
//   new_lead     a live transfer (red) / real-time lead (mint) — act NOW
//   vendor_match a Synergy vendor email merged into a deal you're not on (blue)
//   app_signed   the merchant SIGNED THEIR APPLICATION (green) — good news
//
// KEYED BY `key`, NOT BY dealId. One deal can legitimately carry two cards at
// once (a lead alert and, later, its signature), and dismissing one must not
// silently take the other with it.

export type AlertLeadSource = "live_transfer" | "realtime_appt";

/**
 * The signature half of an `app_signed` card, as resolved by
 * public.application_signature_alert(). Everything here is server-supplied:
 * the client never decides what counts as an application (that rule lives in
 * public.is_application_doc_name and nowhere else).
 */
export interface SignedAppDetail {
  /** GHL document id — the alert's identity, and its dedupe key. */
  documentId: string;
  /** Which document came back, shown verbatim so "which one?" is never a guess. */
  docName: string;
  /**
   * The merchant's REAL signing time (GHL recipient.signedDate).
   *
   * NOT when we found out. Signatures are discovered by the hourly ghl-doc-sweep
   * cron, so this can be up to ~an hour before the card appeared. The card shows
   * THIS, never "just now" — a setter deciding whether to call right away is
   * entitled to know the signature is 50 minutes old.
   */
  signedAt: string | null;
  /** When our mirror first recorded it. `signedAt` → `seenAt` is the real lag. */
  seenAt: string | null;
  /** Bank statements already on file for this merchant. 0 ⇒ the chase is on. */
  statementsCount: number;
  /** True when the deal is assigned to the viewer, false when it's the floor's. */
  isMine: boolean;
}

export interface CornerAlert {
  /** Stable identity for the React key AND for dismissal. See the note above. */
  key: string;
  dealId: string;
  dealNumber: string | null;
  business: string;
  /** amount_requested off the deal row; null when the lead carries no ask yet. */
  ask: number | null;
  kind: "new_lead" | "vendor_match" | "app_signed";
  /** Set only for new_lead — drives the red (live) vs mint (real-time) styling. */
  leadSource: AlertLeadSource | null;
  /** Set only for app_signed. */
  signed?: SignedAppDetail | null;
  /** Date.now() when the event reached us. */
  at: number;
}
