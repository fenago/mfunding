// applicationChase — the five buckets of the processor's application chase, and
// the ONE rule that decides which bucket a deal is in.
//
// THE OWNER'S ASK (2026-09-17), verbatim: "for the processor, i'd love to have a
// tab on the processor page that shows who has a partial application, completed
// application (but unsigned), signed application, bank statements submitted,
// go/no go... it needs to be clear that for everyone in those buckets she needs
// to be chasing... if it is partial then she needs to be chasing getting the
// completed application... if it is completed then she needs to be chasing the
// signature... etc."
//
// So a bucket is not a label — it is an INSTRUCTION. Every bucket here carries
// the next thing to chase, in the words the processor would use, and the UI
// renders that instruction rather than a bare count.
//
// ── THE LADDER ──────────────────────────────────────────────────────────────
// Buckets are evaluated from the FAR END backwards, so a deal always lands in
// the furthest stage it has genuinely reached and the queue never asks anyone to
// chase something already done:
//
//   5  decided     QA said GO or NO-GO            → done, or the reason it stalled
//   4  statements  bank statements are in         → chase the GO/NO-GO decision
//   3  signed      the application came back signed→ chase bank statements
//   2  unsigned    application complete, not signed→ CHASE THE SIGNATURE  ← the pain
//   1  partial     application not complete        → chase the completed application
//
// Measured on live data 2026-09-17, over open deals (parked/funded excluded):
// partial 12 · unsigned 7 · signed 1 · statements 6 · decided 1.
// Over ALL 63 deals with an application sent, including parked ones:
// partial 36 · unsigned 10 · signed 2 · statements 14 · decided 1.
//
// ── THE NO-RE-SEND INVARIANT ────────────────────────────────────────────────
// A merchant who has SIGNED their application must never be told to send one.
// Offering that is the mistake that reaches the merchant: they get a second
// copy of a document they already signed, from a company that apparently isn't
// keeping track. Two rows make it live rather than theoretical — MF-2026-0113
// signed with no application_sent_at at all, and MF-2026-0273 signed on a
// phantom stamp — because both look, from the send record alone, exactly like
// someone who was never sent anything.
//
// There are exactly TWO places in this file that can tell someone to send: the
// `unsigned` bucket, and the phantom branch of `partial`'s instruction. BOTH
// test `isSigned` themselves. Neither test is reachable today — the `signed`
// bucket returns before either — and that is the point: the guarantee is a
// property of each branch, not of the order the branches happen to sit in. A
// refactor that reorders the ladder cannot silently make a signed application
// re-sendable, which it otherwise could, with no error and no test to catch it
// (this repo has no test runner).
//
// This is the same lesson as is_phantom_application_send, which used to depend
// on "no draft exists" — true when written, and quietly false the moment a
// processor opened the deal and started typing.
//
// ── COMPLETENESS IS NOT REDEFINED HERE ──────────────────────────────────────
// "Partial vs complete" is applicationCompleteness() — the same definition
// MerchantApplicationModal gates its Send button on. If those two ever disagree
// the processor is told to finish an application the modal considers done. There
// is exactly one definition and this file imports it.
//
// ── AN UNREADABLE SIGNATURE DOES NOT CREATE AN ACCUSATION ───────────────────
// The unsigned bucket says a named merchant has not signed, which is in practice
// a statement about whether the processor has been chasing them. It may only be
// entered off a signature read that SUCCEEDED. When the ledger is unreadable the
// deal still lands in the bucket (it is still her work item — a deal parked at a
// complete application is not going anywhere), but `signatureKnown` is false and
// every surface must render it as "confirm whether they signed" rather than as a
// failure to chase. See src/lib/applicationSignature.ts.

import { queueRowCompleteness, isRealSend, type ApplicationQueueRow } from "@/lib/applicationQueueRow";
import type { SignatureState } from "@/lib/applicationSignature";

export type ChaseBucket = "partial" | "unsigned" | "signed" | "statements" | "decided";

export const CHASE_BUCKET_ORDER: ChaseBucket[] = [
  "partial",
  "unsigned",
  "signed",
  "statements",
  "decided",
];

export interface ChaseBucketMeta {
  key: ChaseBucket;
  /** What the bucket IS. */
  label: string;
  /** What she has to DO about everyone in it. The reason the bucket exists. */
  chase: string;
  /** Active border + text. Matches the ProcessorPage bucket bar. */
  ring: string;
  /** Count accent. */
  dot: string;
  /** Row tone for the loudest bucket. */
  rowTone: string;
  /** Chip tone for the per-row "next action" pill. */
  chipTone: string;
}

export const CHASE_BUCKETS: Record<ChaseBucket, ChaseBucketMeta> = {
  partial: {
    key: "partial",
    label: "Partial application",
    chase: "Chase the completed application",
    ring: "border-purple-500 text-purple-700 dark:text-purple-300",
    dot: "text-purple-600 dark:text-purple-400",
    rowTone: "",
    chipTone: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  },
  unsigned: {
    // THE OWNER'S MAIN PAIN — loudest bucket on the tab, by instruction.
    key: "unsigned",
    label: "Complete but UNSIGNED",
    chase: "Chase the signature",
    ring: "border-red-500 text-red-700 dark:text-red-300",
    dot: "text-red-600 dark:text-red-400",
    rowTone: "bg-red-50/60 dark:bg-red-950/25 ring-1 ring-inset ring-red-300/60 dark:ring-red-800/60",
    chipTone: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  },
  signed: {
    key: "signed",
    label: "Signed",
    chase: "Chase the bank statements",
    ring: "border-sky-500 text-sky-700 dark:text-sky-300",
    dot: "text-sky-600 dark:text-sky-400",
    rowTone: "",
    chipTone: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  },
  statements: {
    key: "statements",
    label: "Statements in",
    chase: "Chase the GO / NO-GO decision",
    ring: "border-amber-500 text-amber-700 dark:text-amber-300",
    dot: "text-amber-600 dark:text-amber-400",
    rowTone: "",
    chipTone: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  },
  decided: {
    key: "decided",
    label: "GO / NO-GO decided",
    chase: "Done — or the reason it stalled",
    ring: "border-emerald-500 text-emerald-700 dark:text-emerald-300",
    dot: "text-emerald-600 dark:text-emerald-400",
    rowTone: "",
    chipTone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  },
};

export interface ChaseVerdict {
  bucket: ChaseBucket;
  /** 0–100 application completeness, the modal's own number. */
  appPct: number;
  /** Mandatory fields still missing. */
  missingCount: number;
  /** No mca_applications row exists at all — the application went out and
   *  nothing has come back. Materially different from "started and incomplete",
   *  and measured at 30 of the 36 partials on 2026-09-17, so the UI says which. */
  neverStarted: boolean;
  /** False when the signature ledger was unreadable. A row in the `unsigned`
   *  bucket with this false must NOT be rendered as a failure to chase. */
  signatureKnown: boolean;
  /**
   * The merchant has signed. Carried on the verdict — rather than left for each
   * caller to re-derive from the signature — so the two branches that can offer
   * to SEND an application can each refuse to do so on their own, instead of
   * relying on being positioned after the `signed` check. See THE NO-RE-SEND
   * INVARIANT below.
   */
  isSigned: boolean;
  /**
   * Did WE actually send this application? False for BOTH of the no-send cases:
   * never sent at all, and a PHANTOM stamp the VibeReach opportunity mirror
   * wrote during deal creation (application_sent_at landing 12-15ms before
   * created_at, created_by null, no draft — 4 live rows, so "63 sent" is
   * really 59). A false here means no send date, no days-since-sent and no
   * sender may be rendered: there is no send to describe.
   */
  realSend: boolean;
  /** The phantom case specifically — stamped, but by the mirror, not by a send. */
  phantomSend: boolean;
  /** No stamp at all. */
  neverSent: boolean;
}

/**
 * Classify one processor_application_queue() row.
 *
 * Completeness comes from queueRowCompleteness() — the data layer's own adapter
 * over applicationCompleteness(), i.e. the modal's Send-button definition. This
 * file does not reimplement it and must never start to.
 */
export function chaseVerdict(
  row: ApplicationQueueRow,
  signature: SignatureState,
): ChaseVerdict {
  const { pct, missing } = queueRowCompleteness(row);
  const real = isRealSend(row);
  const base = {
    appPct: pct,
    missingCount: missing.length,
    neverStarted: !row.app_row_exists,
    signatureKnown: signature.kind !== "unknown",
    isSigned: signature.kind === "signed",
    realSend: real,
    phantomSend: row.born_at_application_sent,
    neverSent: row.app_sent_at === null,
  };

  // Backwards down the ladder — furthest genuine progress wins.
  if (row.qa_decision) return { ...base, bucket: "decided" };
  if ((row.statements_count ?? 0) > 0) return { ...base, bucket: "statements" };
  // SIGNED OUTRANKS A MISSING SEND RECORD, deliberately. MF-2026-0113 (Express
  // Redemption) signed on 2026-07-22 with no application_sent_at at all: a send
  // plainly happened, inside GHL and outside our record. The processor's next
  // action on a signed deal is bank statements regardless of what our paperwork
  // says, and routing it here is also what GUARANTEES we never offer a blind
  // re-send on a signed application. The missing send record is still shown, as
  // a chip on the row.
  //
  // The property that matters is "past `unsigned`", NOT "reaches this line".
  // MF-2026-0273 is the other signed row with no send record and it never gets
  // here — it carries 25 bank statements, so it returned at `statements` above.
  // Both are safe from a re-send offer, by different rungs. Do not read this
  // comment as "every signed phantom lands in `signed`".
  if (signature.kind === "signed") return { ...base, bucket: "signed" };
  // Complete-but-not-signed is the chase-the-signature bucket — but ONLY for a
  // send we can actually account for. Chasing a signature on an application
  // nobody sent is the exact wasted work born_at_application_sent exists to
  // prevent, so a phantom or never-sent row falls through to `partial`, whose
  // instruction says "nothing was sent" rather than "chase the signature".
  // `!base.isSigned` is REDUNDANT TODAY — the `signed` check above already
  // returned. It is here so the no-re-send invariant is a property of this
  // branch rather than of where the branch happens to sit: move this line above
  // the signed check in a future refactor and a signed application would
  // silently become re-sendable, with no error and no test to catch it (this
  // repo has no test runner). Cheap insurance against the same shape of bug as
  // the phantom predicate that used to depend on mutable state.
  if (missing.length === 0 && real && !base.isSigned) return { ...base, bucket: "unsigned" };
  return { ...base, bucket: "partial" };
}

/** The one line telling the processor what to do about THIS deal, not the bucket. */
export function chaseInstruction(v: ChaseVerdict): string {
  switch (v.bucket) {
    case "partial":
      // A PHANTOM must never be described as something that "went out" — the
      // stage was stamped by the VibeReach mirror when the deal was created, not
      // by a send. MF-2026-0324 is still sitting at status application_sent with
      // nothing sent to anybody, and telling the processor it "went out and
      // nothing came back" would send her chasing a merchant who was never
      // contacted with an application at all.
      if (v.phantomSend) {
        // Same invariant, enforced locally: this is the other sentence in the
        // file that tells someone to SEND an application, so it refuses on its
        // own when the merchant has already signed rather than trusting that a
        // signed row never reaches `partial`.
        if (v.isSigned) {
          return "⚠ Signed, but nothing in our system ever recorded sending it — the stage was stamped by the VibeReach mirror. Do NOT re-send it. Chase the bank statements, and let someone fix the record.";
        }
        return "⚠ Nothing was ever sent. The stage was stamped by the VibeReach mirror when this deal was created — no application left our system and no draft exists. Send it, or close the deal out.";
      }
      if (v.neverSent) {
        return v.neverStarted
          ? "No application has been sent and none has been started. Get them on the phone and fill it in with them."
          : `Not sent yet — the application is ${v.appPct}% done, ${v.missingCount} mandatory field${v.missingCount === 1 ? "" : "s"} still missing. Finish it, then send it.`;
      }
      return v.neverStarted
        ? "The application went out and nothing has come back — no draft on file at all. Get them on the phone and fill it in with them."
        : `Application is ${v.appPct}% done — ${v.missingCount} mandatory field${v.missingCount === 1 ? "" : "s"} still missing. Chase the rest.`;
    case "unsigned":
      return v.signatureKnown
        ? "Every mandatory field is filled and the merchant has NOT signed it. The signature is the only thing between this deal and bank statements — chase it."
        : "Every mandatory field is filled, but nobody has ever checked this merchant's signed documents, so we cannot say whether they signed. Hit “Check signature” before chasing them for one they may already have given.";
    case "signed":
      // Signed with no send record: the send happened in GHL, outside our
      // system. Say that, and do NOT suggest re-sending an application the
      // merchant has already signed.
      if (!v.realSend) {
        return "Signed — but we have no record of ever sending it, so the send happened inside VibeReach. Don't re-send it. Chase the bank statements, and let someone fix the record.";
      }
      return "Signed and on file. Nothing can move until the bank statements land — chase those.";
    case "statements":
      return "Application and statements are both in. This is waiting on a GO / NO-GO decision.";
    case "decided":
      return "A GO / NO-GO decision has been made. Nothing to chase unless it stalled after the call.";
  }
}
