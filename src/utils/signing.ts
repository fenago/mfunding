// Unified "to sign" model. The merchant has two kinds of signable documents that
// must appear in ONE list everywhere (dashboard, Documents page, bell,
// ActionNeededHero): native merchant_documents (signed in-app) and real GHL
// Documents & Contracts (opened in a new tab on GHL). The merchant never sees
// the distinction — these helpers normalize both.

import type { MerchantDocument, GhlDocument } from "../services/portalService";

/** Native agreements still awaiting the merchant's signature. */
export function nativePending(docs: MerchantDocument[]): MerchantDocument[] {
  return docs.filter((d) => d.status === "sent");
}

/** GHL docs the merchant still needs to fill/sign (not completed, not expired). */
export function ghlPending(docs: GhlDocument[]): GhlDocument[] {
  return docs.filter((d) => !d.signed && !d.isExpired);
}

/** GHL docs the merchant has completed — belong under "On file". */
export function ghlSigned(docs: GhlDocument[]): GhlDocument[] {
  return docs.filter((d) => d.signed);
}

/** GHL docs whose signing link has expired (and aren't completed). */
export function ghlExpired(docs: GhlDocument[]): GhlDocument[] {
  return docs.filter((d) => d.isExpired && !d.signed);
}

/** Total count of documents needing a signature across both sources. */
export function pendingSignCount(native: MerchantDocument[], ghl: GhlDocument[]): number {
  return nativePending(native).length + ghlPending(ghl).length;
}

/** Open a GHL signing link in a new tab (bearer link; noopener/noreferrer). */
export function openGhlDoc(url: string | null): void {
  if (url) window.open(url, "_blank", "noopener,noreferrer");
}
