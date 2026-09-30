// merchantLinks — the two links a closer/setter/processor texts to a merchant,
// resolved ONCE so every surface hands out the same URL.
//
// 1. THE APPLICATION LINK. Not the portal. Not a page they log in to. GHL mints
//    a per-RECIPIENT bearer link for every document it sends, and
//    ghl-docs-status already surfaces it as `GhlDoc.url`
//    (https://link.vibereach.io/documents/v1/<referenceId>). Whoever holds that
//    link opens and signs that document — no account, no password, no
//    `customers.user_id`. It is strictly better than "sign in at
//    my.mfunding.net", which is why that is the fallback and not the answer.
//
//    Worth writing down because it cost a round of investigation: the GHL
//    proposals API exposes NO `publicUrl` / `shareLink` field, so looking for
//    one concludes — wrongly — that no per-document link exists. The link is
//    assembled from the document's `links[].referenceId`, matched to THIS
//    merchant's recipient id, inside ghl-docs-status.
//
// 2. THE UPLOAD LINK. The GHL "Bank Statements & Documents Upload" form,
//    prefilled with the merchant's email so their files land on the right
//    contact automatically. The prefill IS the value — an upload link without it
//    produces files nobody can attribute.
//
// ── WHAT THIS FILE REFUSES TO DECIDE ────────────────────────────────────────
// Which document counts as "the application", and what the four-state answer is
// when the list is empty. Both already exist and are deliberately NOT mirrored
// here: `isApplicationDoc` + `unifyDocs` in src/utils/signing.ts. That rule has
// been copy-pasted into five places before and one copy (/application|prefill/i)
// missed '04C MCA PARTIAL' — the DEFAULT send path — so signed applications on
// the most common template read as unsigned. A sixth copy would be a sixth
// chance to drift. We call the real one.

import type { GhlDoc } from "./ghlDocs";
import { unifyDocs, type ApplicationStatus } from "../utils/signing";

/** Where a merchant with no signing link can still reach their paperwork. */
export const MERCHANT_PORTAL_URL = "https://my.mfunding.net";

/**
 * The upload-form link for THIS merchant.
 *
 * The `?email=` prefill is not cosmetic: it is what makes their submission
 * attach to their own GHL contact instead of landing unattributed. Without an
 * email on file we still return a usable link, but the caller must say so —
 * see `uploadLinkIsAttributed`.
 */
export function uploadLinkFor(uploadFormUrl: string, merchantEmail?: string | null): string {
  const email = (merchantEmail ?? "").trim();
  return email ? `${uploadFormUrl}?email=${encodeURIComponent(email)}` : uploadFormUrl;
}

/** False when the link will work but the files won't self-attribute. */
export function uploadLinkIsAttributed(merchantEmail?: string | null): boolean {
  return !!(merchantEmail ?? "").trim();
}

/**
 * The merchant's application, resolved from a READ WE ALREADY KNOW THE QUALITY
 * OF.
 *
 * `readable` is the caller's honest verdict from `readDocsStatus` — not a guess
 * derived from whether the array is empty. That distinction is the entire
 * reason this takes two arguments: an empty list from a FAILED read must come
 * back as `unknown`, never as `none`, because "no application sent yet" is a
 * claim about what a human did or didn't do.
 */
export function applicationFromDocs(
  docs: GhlDoc[],
  readable: boolean,
  partial = false,
): ApplicationStatus {
  return unifyDocs([], {
    // isExpired is optional on GhlDoc. Absent → treat as not expired, which at
    // worst offers a link that GHL itself will decline — visibly, to the
    // merchant — rather than hiding one that still works.
    documents: docs.map((d) => ({ ...d, isExpired: d.isExpired ?? false })),
    readable,
    partial,
    note: null,
    error: null,
    contactCount: 1,
  }).application;
}

/** Why a copy attempt failed, in words a non-engineer can act on. */
export type CopyResult = { ok: true } | { ok: false; reason: string };

/**
 * The one sentence every surface shows when a copy fails, so the wording (and
 * the instruction to copy by hand) can't drift between them. Browser messages
 * already end in a period — appending our own produced "denied..".
 */
export function copyFailureMessage(reason: string): string {
  const trimmed = reason.trim().replace(/[.!?]+$/, "");
  return `Couldn't copy it — ${trimmed}. Select the link below and copy it by hand:`;
}

/**
 * Copy text, and TELL THE TRUTH WHEN IT DIDN'T WORK.
 *
 * `navigator.clipboard` rejects on an insecure origin, when the document isn't
 * focused, and whenever the browser's clipboard permission is denied. Every one
 * of those paths used to be swallowed by a bare `catch {}`, which leaves someone
 * pasting a link they never actually copied. A caller that gets `ok: false` is
 * expected to show the URL as selectable text so it can be copied by hand.
 */
export async function copyText(text: string): Promise<CopyResult> {
  try {
    if (!navigator.clipboard?.writeText) {
      return { ok: false, reason: "this browser won't let the page use the clipboard" };
    }
    await navigator.clipboard.writeText(text);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "the browser blocked the copy" };
  }
}
