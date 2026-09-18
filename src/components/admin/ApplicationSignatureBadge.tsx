// ApplicationSignatureBadge — the ONE badge that answers "is this application
// actually signed?", so the wording can never drift between surfaces.
//
// WHY (owner, 2026-09-17): "in many places i see 'application sent' but there is
// not a visible way to see if it was signed. I need to be able to see that
// everywhere... just saying application sent (but it is unsigned), that is a
// problem and that is what I need the processor (and the setter) focused on."
//
// Measured live the same day: 63 deals have an application sent and only 14 have
// a signed application on file. "Application sent" on its own is therefore
// wrong-by-omission about four times in five, which is why this badge goes next
// to every one of them.
//
// THREE STATES, NEVER TWO. `unknown` renders amber and says out loud that the
// signature could not be read. It never renders as UNSIGNED — an unsigned badge
// is an accusation aimed at whoever was meant to chase the signature, and this
// codebase does not make accusations off reads it cannot prove. See
// src/lib/applicationSignature.ts for the full rule and where the data lives.

import { CheckBadgeIcon, ExclamationTriangleIcon, QuestionMarkCircleIcon } from "@heroicons/react/24/solid";
import type { SignatureState } from "@/lib/applicationSignature";
import { dateTimeET } from "@/utils/time";

export type BadgeSize = "xs" | "sm";

interface Props {
  signature: SignatureState;
  /**
   * When the application was sent, if it was. Drives the "not sent yet" wording:
   * an application nobody has sent is not an unsigned one to chase.
   *
   * `true` means "we know it was sent but not WHEN" — the honest answer on
   * surfaces fed by an RPC that carries the stage but not application_sent_at
   * (processor_pipeline_rows). The badge then omits the date rather than
   * inventing one.
   */
  sentAt?: string | true | null;
  size?: BadgeSize;
  /** Show the "Sent <date>" half too, for surfaces that don't already say it. */
  showSent?: boolean;
  /**
   * WAS A DOCUMENT ACTUALLY SENT? — the third thing `sentAt` cannot tell you.
   *
   * `sentAt` is `deals.application_sent_at`, and a GHL pipeline stage move
   * stamps that with nobody attached. Joyce Derian / MF-2026-0363: a stage move
   * stamped the deal 27 seconds after a draft was opened, the draft never left
   * (`sent_to_merchant_at` NULL), and she has ZERO documents — yet this badge
   * read a stamp plus no signature and printed red UNSIGNED, which accuses a
   * merchant of ignoring an application she was never sent.
   *
   *   "confirmed" — a document demonstrably went out.
   *   "none"      — we LOOKED and nothing was ever sent → "NEVER SENT".
   *   "unknown"   — not established (the default, and today's behaviour).
   *
   * Pass "none" ONLY off a real document read. There is no safe way to infer it
   * from the deal row: Joyce carries an assigned closer, so the attribution
   * ladder reports "assumed_owner" for her exactly as it does for a genuine
   * send. Guessing here would re-create the bug in a new place.
   */
  sendEvidence?: "confirmed" | "none" | "unknown";
  /** Suppress the badge entirely when nothing has been sent AND nothing signed.
   *  Lists use this so rows with no application at all stay quiet. */
  hideWhenNothingSent?: boolean;
  className?: string;
}

const SIZE_CLS: Record<BadgeSize, string> = {
  xs: "text-[10px] px-1.5 py-0.5 gap-0.5",
  sm: "text-[11px] px-2 py-0.5 gap-1",
};

const ICON_CLS: Record<BadgeSize, string> = {
  xs: "w-3 h-3",
  sm: "w-3.5 h-3.5",
};

/** Short date for a badge — the full stamp lives in the tooltip. */
function shortDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function ApplicationSignatureBadge({
  signature,
  sentAt = null,
  size = "xs",
  showSent = false,
  sendEvidence = "unknown",
  hideWhenNothingSent = false,
  className = "",
}: Props) {
  const base = `inline-flex items-center rounded-full font-bold whitespace-nowrap ${SIZE_CLS[size]}`;
  const icon = ICON_CLS[size];

  // ── UNREADABLE. Amber, and it says so. Never "unsigned". ──
  if (signature.kind === "unknown") {
    return (
      <span
        className={`${base} bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 ${className}`}
        title={
          `Whether this application was signed could not be read just now (${signature.message}). ` +
          `This is NOT a claim that the merchant hasn't signed — check the merchant's documents before chasing them for a signature they may already have given.`
        }
      >
        <QuestionMarkCircleIcon className={icon} />
        Signature unknown
      </span>
    );
  }

  // ── SIGNED. The good state. ──
  if (signature.kind === "signed") {
    const when = shortDate(signature.signedAt);
    return (
      <span
        className={`${base} bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 ${className}`}
        title={
          signature.signedAt
            ? `Application SIGNED ${dateTimeET(signature.signedAt)}${signature.docName ? ` — "${signature.docName}"` : ""}. Chase bank statements next.`
            : `Application came back signed${signature.docName ? ` — "${signature.docName}"` : ""} (no completion timestamp recorded).`
        }
      >
        <CheckBadgeIcon className={icon} />
        Signed{when ? ` ${when}` : ""}
      </span>
    );
  }

  // ── NEVER SENT. Established by a document read, not by the absence of a
  //    stamp — so it outranks the stamp, which is the whole point: the stamp is
  //    what is wrong. "Unsigned" is only meaningful if something was SENT. ──
  if (sendEvidence === "none") {
    if (hideWhenNothingSent) return null;
    return (
      <span
        className={`${base} bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200 ring-1 ring-inset ring-gray-400/50 dark:ring-gray-500 ${className}`}
        title={
          `NEVER SENT — nothing to sign. We read this merchant's documents and there are none, so no application ` +
          `ever reached them.` +
          (typeof sentAt === "string"
            ? ` The deal carries an "application sent" stamp (${dateTimeET(sentAt)}), but a pipeline stage move writes that stamp without sending anything.`
            : "") +
          ` This is NOT a merchant who ignored their application — the chase here is to SEND it.`
        }
      >
        <ExclamationTriangleIcon className={icon} />
        NEVER SENT — nothing to sign
      </span>
    );
  }

  // ── NOT SENT. Not a chase for a signature — a chase for a send. ──
  if (!sentAt) {
    if (hideWhenNothingSent) return null;
    return (
      <span
        className={`${base} bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 ${className}`}
        title="No application has been sent to this merchant yet, so there is nothing for them to sign."
      >
        Application not sent
      </span>
    );
  }

  // ── SENT AND UNSIGNED. The owner's main pain — the loudest state. ──
  const disclosureOnly = signature.disclosureSignedAt !== null;
  const sentDate = typeof sentAt === "string" ? sentAt : null;
  return (
    <span
      className={`${base} bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 ring-1 ring-inset ring-red-300 dark:ring-red-800 ${className}`}
      title={
        (sentDate
          ? `Sent ${dateTimeET(sentDate)} and NOT signed.`
          : `Sent (this view doesn't carry the send date) and NOT signed.`) +
        ` Chase the signature — this is the step the deal is stuck on.` +
        (disclosureOnly
          ? ` They DID sign the Broker Compensation Disclosure on ${dateTimeET(signature.disclosureSignedAt as string)}, which is a separate one-page document and is NOT the funding application.`
          : "")
      }
    >
      <ExclamationTriangleIcon className={icon} />
      {showSent && sentDate ? `Sent ${shortDate(sentDate)} · ` : ""}UNSIGNED
      {disclosureOnly ? " (disclosure only)" : ""}
    </span>
  );
}
