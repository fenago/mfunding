// Unified "signable documents" model + the one-application rule.
//
// The merchant has two kinds of signable documents that must appear as ONE list
// everywhere (action block, Documents page, bell): native merchant_documents
// (signed in-app) and real GHL Documents & Contracts (opened in a new tab). The
// merchant never sees the distinction.
//
// ONE-APPLICATION RULE (owner decision): application-family docs = names matching
// /application|prefill/i (covers the fillable MCA application and the 04B prefill,
// native or GHL). Because both variants can be sent, we collapse them so the
// merchant is never asked to sign an application twice:
//   1. If ANY application-family doc is signed/completed → every OTHER
//      application-family doc is hidden entirely (only the signed one survives,
//      and only under "On file").
//   2. If several are pending and none signed → only the NEWEST pending one shows.
//   3. Non-application docs (disclosures, TCPA, bank auth) are unaffected.
// Implemented here so every surface inherits it by construction.

import type { MerchantDocument, GhlDocument } from "../services/portalService";

const APPLICATION_RE = /application|prefill/i;

export function isApplicationDoc(name: string | null | undefined): boolean {
  return APPLICATION_RE.test(name ?? "");
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
  state: "signed" | "pending" | "none";
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
  /** Native agreements already signed (for "On file"). */
  signedNative: MerchantDocument[];
  /** GHL docs already completed (for "On file"). */
  signedGhl: GhlDocument[];
  /** GHL docs whose link expired and aren't signed (for "On file", muted). */
  expiredGhl: GhlDocument[];
  /** The single resolved application, for the journey's application step. */
  application: ApplicationStatus;
}

export function unifyDocs(native: MerchantDocument[], ghl: GhlDocument[]): UnifiedDocs {
  const kept = applyOneApplicationRule([
    ...native.map(nativeToSignable),
    ...ghl.map(ghlToSignable),
  ]);
  return {
    all: kept,
    pending: kept.filter((s) => s.pending),
    signedNative: kept.filter((s) => s.source === "native" && s.signed).map((s) => s.nativeDoc!),
    signedGhl: kept.filter((s) => s.source === "ghl" && s.signed).map((s) => s.ghlDoc!),
    expiredGhl: kept.filter((s) => s.source === "ghl" && s.expired).map((s) => s.ghlDoc!),
    application: resolveApplication(kept),
  };
}

function resolveApplication(kept: Signable[]): ApplicationStatus {
  const apps = kept.filter((s) => s.isApplication);
  const signed = apps.find((s) => s.signed);
  if (signed) {
    const date = signed.source === "ghl" ? signed.ghlDoc?.updatedAt ?? null : signed.nativeDoc?.signed_at ?? null;
    return { state: "signed", name: signed.name, date, signable: signed };
  }
  const pending = apps.filter((s) => s.pending).sort((a, b) => b.ts - a.ts)[0];
  if (pending) return { state: "pending", name: pending.name, signable: pending };
  return { state: "none" };
}

/** Open a GHL signing link in a new tab (bearer link; noopener/noreferrer). */
export function openGhlDoc(url: string | null): void {
  if (url) window.open(url, "_blank", "noopener,noreferrer");
}
