// Closer Onboarding & Documents — the canonical document registry.
//
// SOURCE OF TRUTH for the list: research/legal/closer-onboarding-checklist-sop.md
// (Phase 0). The nine documents below are exactly that checklist, in that order.
//
// WHERE THE TEXT LIVES: for the six markdown documents, the authoritative body is
// in the DB (public.closer_doc_templates), seeded verbatim from research/legal/*.md.
// It is NOT imported into the bundle — the text a closer signs must be merged
// server-side and frozen (see src/lib/closerDocMerge.ts + the
// send-closer-onboarding-package edge function). The two reference documents,
// which nobody signs, are imported straight from the repo with Vite's ?raw loader.
//
// NOTHING IN THIS APP AUTHORS OR EDITS LEGAL LANGUAGE. Merging substitutes bracket
// tokens for real values; that is all.

import onboardingSopMd from "../../research/legal/closer-onboarding-checklist-sop.md?raw";
import compOfferSheetMd from "../../research/Momentum_Closer_Comp_Offer_Sheet.md?raw";

/** What has to happen to the document. */
export type DocAction = "sign" | "collect" | "complete" | "reference";

/**
 * How the document actually gets done. This is the honest part of the model —
 * not everything on the checklist can be e-signed, and pretending otherwise
 * would be the bug.
 *
 *   esign         → merged, frozen, emailed, signed in-app. The real flow.
 *   manual        → .docx we cannot render or merge. Download + send by hand.
 *   external      → someone else's form (the IRS). We link out and collect it back.
 *   secure_return → the CLOSER fills it in (bank details) and returns it via
 *                   secure upload. Not e-signed: the form itself says not to put
 *                   full account/routing numbers through plain email, and we are
 *                   not standing up bank-detail capture on the side of this build.
 */
export type DocDelivery = "esign" | "manual" | "external" | "secure_return";

export interface CloserDoc {
  /** Stable slug — the URL segment AND closer_documents.doc_slug. */
  slug: string;
  order: number;
  title: string;
  /** One scannable line: what it is / why it exists. */
  summary: string;
  action: DocAction;
  delivery: DocDelivery;
  /** Repo path (or where it comes from) — so the owner knows what backs the page. */
  path: string;
  /** Rendered in-app for reference docs only. Signable docs render from the DB. */
  body?: string;
  externalUrl?: string;
  /** Shown on the viewer for anything that isn't e-signed. */
  handling?: string;
}

export const ACTION_LABEL: Record<DocAction, string> = {
  sign: "SIGN",
  collect: "COLLECT",
  complete: "COMPLETE",
  reference: "REFERENCE",
};

export const ACTION_BADGE: Record<DocAction, string> = {
  sign: "bg-ocean-blue/15 text-ocean-blue dark:bg-ocean-blue/25 dark:text-sky-300",
  collect: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  complete: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  reference: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
};

export const DELIVERY_LABEL: Record<DocDelivery, string> = {
  esign: "e-sign in app",
  manual: "send manually",
  external: "external form",
  secure_return: "secure upload",
};

/** The nine Phase-0 documents, in checklist order. */
export const CLOSER_DOCS: CloserDoc[] = [
  {
    slug: "ic-commission-agreement",
    order: 1,
    title: "Independent Contractor Commission Agreement (v2)",
    summary: "The master 1099 agreement. Everything else hangs off this one.",
    action: "sign",
    delivery: "manual",
    path: "research/platform_reqs/v2_MCA_Commission_Agreement.docx",
    handling:
      "This is a .docx — it cannot be rendered or merged in the browser, so it is excluded from the e-sign package. Download it from the repo path above, fill it in, and send it for signature by hand (or convert it to markdown and it can join the e-sign flow). Schedule A is its rate sheet and must travel with it.",
  },
  {
    slug: "schedule-a-rate-sheet",
    order: 2,
    title: "Schedule A — Compensation Rate Sheet",
    summary: "The splits, the draw, the payout timing. Attaches to the agreement above.",
    action: "sign",
    delivery: "esign",
    path: "research/legal/closer-ic-commission-agreement-scheduleA.md",
  },
  {
    slug: "nda-confidentiality",
    order: 3,
    title: "Confidentiality & Non-Disclosure Agreement",
    summary: "Protects the funder network, merchant data, and pricing.",
    action: "sign",
    delivery: "esign",
    path: "research/legal/closer-nda-confidentiality.md",
  },
  {
    slug: "tcpa-compliance-acknowledgment",
    order: 4,
    title: "TCPA & Regulatory Compliance Acknowledgment",
    summary: "Consent, quiet hours, opt-outs — plus the script-adherence sign-off.",
    action: "sign",
    delivery: "esign",
    path: "research/legal/closer-tcpa-compliance-acknowledgment.md",
  },
  {
    slug: "code-of-conduct",
    order: 5,
    title: "Closer Code of Conduct",
    summary: "The do's and don'ts on live calls. Includes the MCA-is-not-a-loan rule.",
    action: "sign",
    delivery: "esign",
    path: "research/legal/closer-code-of-conduct.md",
  },
  {
    slug: "clawback-policy-acknowledgment",
    order: 6,
    title: "Clawback Policy Acknowledgment",
    summary: "What happens to commission when a funded deal defaults or unwinds.",
    action: "sign",
    delivery: "esign",
    path: "research/legal/closer-clawback-policy-acknowledgment.md",
  },
  {
    slug: "w9",
    order: 7,
    title: "IRS Form W-9",
    summary: "Required before the first payout. Standard IRS form — we don't draft it.",
    action: "collect",
    delivery: "external",
    path: "External — irs.gov",
    externalUrl: "https://www.irs.gov/pub/irs-pdf/fw9.pdf",
    handling:
      "Official IRS form. Send the closer the link, collect the completed form back, then mark it collected here.",
  },
  {
    slug: "direct-deposit-authorization",
    order: 8,
    title: "Direct Deposit (ACH) Authorization",
    summary: "Where commission actually lands. No payout runs without it.",
    action: "complete",
    delivery: "secure_return",
    path: "research/legal/closer-direct-deposit-form.md",
    handling:
      "The closer fills in their own bank details on this one, so it is NOT part of the e-sign package: the form itself says not to send full account/routing numbers through plain email, and capturing them would mean storing bank credentials. Have the closer complete it and return it through the secure document upload, then mark it complete here.",
  },
  {
    slug: "state-licensing-proof",
    order: 9,
    title: "State licensing / registration proof",
    summary: "Only if the closer's target states require it. Otherwise mark N/A.",
    action: "collect",
    delivery: "external",
    path: "External — issued by the state",
    handling:
      "Not a document we produce. If the closer works a state that requires broker licensing or registration, collect proof and attach it. If no target state requires it, mark this N/A.",
  },
];

/** Received, never signed. Kept separate so they can't be mistaken for paperwork. */
export const REFERENCE_DOCS: CloserDoc[] = [
  {
    slug: "comp-offer-sheet",
    order: 1,
    title: "Closer Compensation Offer Sheet",
    summary: "What the closer is offered. Sent during recruiting — not a signature item.",
    action: "reference",
    delivery: "manual",
    path: "research/Momentum_Closer_Comp_Offer_Sheet.md",
    body: compOfferSheetMd,
  },
  {
    slug: "onboarding-checklist-sop",
    order: 2,
    title: "Closer Onboarding Checklist & Training SOP",
    summary: "The full ramp plan (Phases 0–4). This page is Phase 0 of it.",
    action: "reference",
    delivery: "manual",
    path: "research/legal/closer-onboarding-checklist-sop.md",
    body: onboardingSopMd,
  },
];

export const ALL_DOCS: CloserDoc[] = [...CLOSER_DOCS, ...REFERENCE_DOCS];

/** The slugs that can actually be merged + e-signed. */
export const ESIGNABLE_SLUGS: string[] = CLOSER_DOCS.filter((d) => d.delivery === "esign").map(
  (d) => d.slug,
);

export function getCloserDoc(slug: string | undefined): CloserDoc | undefined {
  return ALL_DOCS.find((d) => d.slug === slug);
}
