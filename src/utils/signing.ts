// Unified "to sign" model. The merchant has two kinds of signable documents that
// must appear in ONE list everywhere (dashboard, Documents page, bell,
// ActionNeededHero): native merchant_documents (signed in-app) and real GHL
// Documents & Contracts (opened in a new tab on GHL). The merchant never sees
// the distinction — these helpers normalize both.

import type { MerchantDocument, GhlDocument } from "../services/portalService";

/** ONE-APPLICATION RULE (owner decision, Jul 12 2026): a merchant only ever
 *  sees a single application. The fillable (MCA 04) and pre-filled (04B)
 *  variants are the same instrument — once ANY application-family document is
 *  signed, every other pending application-family document is suppressed
 *  everywhere; if several are pending and none signed, only the newest shows. */
const APPLICATION_FAMILY = /application|prefill/i;

function isApplicationFamily(name: string | null | undefined): boolean {
  return APPLICATION_FAMILY.test(name ?? "");
}

/** Apply the one-application rule to the GHL doc list. */
export function applyOneApplicationRule(docs: GhlDocument[]): GhlDocument[] {
  const apps = docs.filter((d) => isApplicationFamily(d.name));
  if (apps.length <= 1) return docs;

  const signedApp = apps.find((d) => d.signed);
  const keep = signedApp
    ? signedApp
    : apps.reduce((a, b) =>
        (b.updatedAt ?? "") > (a.updatedAt ?? "") ? b : a
      );
  return docs.filter((d) => !isApplicationFamily(d.name) || d === keep);
}

/** Native agreements still awaiting the merchant's signature. */
export function nativePending(docs: MerchantDocument[]): MerchantDocument[] {
  return docs.filter((d) => d.status === "sent");
}

/** GHL docs the merchant still needs to fill/sign (not completed, not expired). */
export function ghlPending(docs: GhlDocument[]): GhlDocument[] {
  return applyOneApplicationRule(docs).filter((d) => !d.signed && !d.isExpired);
}

/** GHL docs the merchant has completed — belong under "On file". */
export function ghlSigned(docs: GhlDocument[]): GhlDocument[] {
  return applyOneApplicationRule(docs).filter((d) => d.signed);
}

/** GHL docs whose signing link has expired (and aren't completed). */
export function ghlExpired(docs: GhlDocument[]): GhlDocument[] {
  return applyOneApplicationRule(docs).filter((d) => d.isExpired && !d.signed);
}

/** Total count of documents needing a signature across both sources. */
export function pendingSignCount(native: MerchantDocument[], ghl: GhlDocument[]): number {
  return nativePending(native).length + ghlPending(ghl).length;
}

/** Open a GHL signing link in a new tab (bearer link; noopener/noreferrer). */
export function openGhlDoc(url: string | null): void {
  if (url) window.open(url, "_blank", "noopener,noreferrer");
}
