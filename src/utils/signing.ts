// Unified "signable documents" model + the one-application rule.
//
// The merchant has two kinds of signable documents that must appear as ONE list
// everywhere (action block, Documents page, bell): native merchant_documents
// (signed in-app) and real GHL Documents & Contracts (opened in a new tab). The
// merchant never sees the distinction.
//
// ONE-APPLICATION RULE (owner decision): application-family docs are the three
// live application templates — '04B MCA PREFILL', '04C MCA PARTIAL' and
// 'MCA_Merchant_Funding_Application' — and never a disclosure. Because more than
// one variant can be sent, we collapse them so the
// merchant is never asked to sign an application twice:
//   1. If ANY application-family doc is signed/completed → every OTHER
//      application-family doc is hidden entirely (only the signed one survives,
//      and only under "On file").
//   2. If several are pending and none signed → only the NEWEST pending one shows.
//   3. Non-application docs (disclosures, TCPA, bank auth) are unaffected.
// Implemented here so every surface inherits it by construction.

import type { MerchantDocument, GhlDocument, GhlDocsResult } from "../services/portalService";

// KEEP IN LOCKSTEP with public.is_application_doc_name(text) (migration
// 20260917a). The previous rule here was /application|prefill/i, which does NOT
// match '04C MCA PARTIAL' — the DEFAULT send path (AppSendButtons path 3). A
// merchant who signed an 04C therefore read as having no application at all:
// resolveApplication() returned state 'none' and the one-application rule never
// collapsed it. Two live merchants were in that state.
const APPLICATION_NAMES = [
  "04B MCA PREFILL",
  "04C MCA PARTIAL",
  "MCA_Merchant_Funding_Application",
];
// Defensive: a renamed or newly added application template still reads as one.
const APPLICATION_RE = /funding[ _-]*application|mca[ _]*(prefill|partial)/i;
// A disclosure is never the application, whatever else its name contains.
const DISCLOSURE_RE = /disclosure/i;

export function isApplicationDoc(name: string | null | undefined): boolean {
  const n = (name ?? "").trim();
  if (!n) return false;
  if (DISCLOSURE_RE.test(n)) return false;
  if (APPLICATION_NAMES.includes(n)) return true;
  return APPLICATION_RE.test(n);
}

export interface Signable {
  source: "native" | "ghl";
  name: string;
  isApplication: boolean;
  /** Needs the merchant's signature. */
  pending: boolean;
  /** Completed / signed. */
  signed: boolean;
  /** Signing link expired (GHL only), and not signed. */
  expired: boolean;
  /** Recency (ms epoch) for the newest-wins rule; 0 when unknown. */
  ts: number;
  /** GHL viewer/signing link, or null. Native docs open via nativeDoc instead. */
  url: string | null;
  nativeDoc?: MerchantDocument;
  ghlDoc?: GhlDocument;
}

function nativeToSignable(d: MerchantDocument): Signable {
  const signed = d.status === "signed";
  const pending = d.status === "sent";
  const ts = Date.parse((signed ? d.signed_at : d.sent_at) ?? "") || 0;
  return {
    source: "native",
    name: d.name,
    isApplication: isApplicationDoc(d.name),
    pending,
    signed,
    expired: d.status === "void",
    ts,
    url: null,
    nativeDoc: d,
  };
}

function ghlToSignable(d: GhlDocument): Signable {
  const signed = d.signed;
  const expired = d.isExpired && !signed;
  const pending = !signed && !expired;
  const ts = Date.parse(d.updatedAt ?? "") || 0;
  return {
    source: "ghl",
    name: d.name,
    isApplication: isApplicationDoc(d.name),
    pending,
    signed,
    expired,
    ts,
    url: d.url,
    ghlDoc: d,
  };
}

/** Collapse application-family docs per the one-application rule. Non-app docs
 *  pass through untouched. */
function applyOneApplicationRule(all: Signable[]): Signable[] {
  const apps = all.filter((s) => s.isApplication);
  if (apps.length === 0) return all;
  const nonApps = all.filter((s) => !s.isApplication);

  const signedApps = apps.filter((a) => a.signed);
  if (signedApps.length > 0) {
    // Rule 1: a signed application supersedes all other application-family docs.
    return [...nonApps, ...signedApps];
  }
  // Rule 2: none signed → keep only the newest pending application; also keep any
  // expired application links (so the merchant can ask for a resend).
  const newestPending = apps
    .filter((a) => a.pending)
    .sort((x, y) => y.ts - x.ts)
    .slice(0, 1);
  const expiredApps = apps.filter((a) => a.expired);
  return [...nonApps, ...newestPending, ...expiredApps];
}

export interface ApplicationStatus {
  /**
   * FOUR states, not three.
   *
   * `unknown` is the one that was missing, and its absence was a bug with a
   * customer on the other end: with only signed/pending/none, a document read
   * that FAILED collapsed into `none`, and the portal told the merchant their
   * specialist would send the application "shortly" — about an application that
   * may already be sitting in their inbox, or already signed. `none` now means
   * we looked and there is genuinely nothing; `unknown` means we could not look.
   */
  state: "signed" | "pending" | "none" | "unknown";
  name?: string;
  /** Signed date (ISO), when state is 'signed'. */
  date?: string | null;
  /** The doc to open (pending → sign, signed → view). */
  signable?: Signable;
}

export interface UnifiedDocs {
  /** All surviving signables after the one-application rule. */
  all: Signable[];
  /** Documents still needing a signature (native + GHL). */
  pending: Signable[];
  /** Documents already signed/completed (native + GHL), for the paperwork list. */
  signed: Signable[];
  /** Native agreements already signed (for "On file"). */
  signedNative: MerchantDocument[];
  /** GHL docs already completed (for "On file"). */
  signedGhl: GhlDocument[];
  /** GHL docs whose link expired and aren't signed (for "On file", muted). */
  expiredGhl: GhlDocument[];
  /** The single resolved application, for the journey's application step. */
  application: ApplicationStatus;
  /**
   * ⚠️ THE LIST MAY BE INCOMPLETE, AND EVERY SURFACE MUST HONOUR THIS.
   *
   * True when the e-sign read failed outright, or covered only part of the
   * merchant's contact set. `pending` being empty then proves NOTHING, and no
   * surface may say "nothing to sign" — the one claim the merchant has no way to
   * verify and every reason to believe.
   */
  docsUnknown: boolean;
  /** Which kind of not-knowing, so a surface can word it accurately. */
  unknownKind: "unreadable" | "partial" | null;
}

/**
 * Collapse the merchant's two document sources into one list.
 *
 * The second argument is the WHOLE result of the e-sign read, not just its
 * documents, so that "we found nothing" and "we couldn't look" cannot be
 * confused by construction. Every caller gets `docsUnknown` whether it
 * remembered to think about it or not — which is the point, because the surfaces
 * that got this wrong were the ones that never considered the failure path.
 */
export function unifyDocs(native: MerchantDocument[], ghl: GhlDocsResult): UnifiedDocs {
  const kept = applyOneApplicationRule([
    ...native.map(nativeToSignable),
    ...ghl.documents.map(ghlToSignable),
  ]);
  const unknownKind: UnifiedDocs["unknownKind"] = !ghl.readable
    ? "unreadable"
    : ghl.partial
      ? "partial"
      : null;
  return {
    all: kept,
    pending: kept.filter((s) => s.pending),
    signed: kept.filter((s) => s.signed),
    signedNative: kept.filter((s) => s.source === "native" && s.signed).map((s) => s.nativeDoc!),
    signedGhl: kept.filter((s) => s.source === "ghl" && s.signed).map((s) => s.ghlDoc!),
    expiredGhl: kept.filter((s) => s.source === "ghl" && s.expired).map((s) => s.ghlDoc!),
    application: resolveApplication(kept, unknownKind !== null),
    docsUnknown: unknownKind !== null,
    unknownKind,
  };
}

function resolveApplication(kept: Signable[], docsUnknown: boolean): ApplicationStatus {
  const apps = kept.filter((s) => s.isApplication);
  const signed = apps.find((s) => s.signed);
  if (signed) {
    const date = signed.source === "ghl" ? signed.ghlDoc?.updatedAt ?? null : signed.nativeDoc?.signed_at ?? null;
    return { state: "signed", name: signed.name, date, signable: signed };
  }
  const pending = apps.filter((s) => s.pending).sort((a, b) => b.ts - a.ts)[0];
  // A document we can SEE is worth more to the merchant than a caveat: showing
  // the pending application keeps the signing link in reach. The page-level
  // notice still tells them the list may be incomplete, which is the honest
  // pairing — hiding the link to be cautious would strand someone who could
  // have signed in the next minute.
  if (pending) return { state: "pending", name: pending.name, signable: pending };
  // NOTHING FOUND. Which is only "nothing was sent" if we actually looked.
  if (docsUnknown) return { state: "unknown" };
  return { state: "none" };
}

/** Open a GHL signing link in a new tab (bearer link; noopener/noreferrer). */
export function openGhlDoc(url: string | null): void {
  if (url) window.open(url, "_blank", "noopener,noreferrer");
}
