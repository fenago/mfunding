import {
  ChatBubbleLeftEllipsisIcon,
  DocumentArrowUpIcon,
  PencilSquareIcon,
  BanknotesIcon,
  HandThumbDownIcon,
  InboxArrowDownIcon,
} from "@heroicons/react/24/outline";
import type { MerchantUpdateKind } from "@/lib/cornerAlert";

// updateKindMeta — how each kind of merchant-file change LOOKS, in one place.
//
// Two surfaces render these (the corner toast and the Updates tab) and a third
// will eventually. Splitting the icon/label/colour choice across them is how a
// "Merchant replied" ends up green on one screen and grey on another, which
// quietly teaches the reader that the colours mean nothing.
//
// The `kind` values mirror the check constraint on
// public.processor_notifications — the DB is the definition, this is only its
// costume.
//
// TONE IS A PRIORITY CLAIM, not decoration:
//   merchant_reply  violet, the loudest — a merchant is WAITING ON US. This is
//                   the Bankers case: he corrected his corporate name, email
//                   and phone and nobody answered.
//   funder_decline  red    — a door closed; the deal needs re-routing today
//   funder_offer    emerald— money on the table
//   merchant_signed emerald— a thing went right
//   documents       sky    — the file got more complete on its own
//   funder_reply    amber  — a funder said something; may or may not need us

export interface UpdateKindMeta {
  label: string;
  Icon: typeof ChatBubbleLeftEllipsisIcon;
  /** Left edge accent on a card. */
  edge: string;
  /** Header text colour. */
  head: string;
  /** Pill background + text, for the list row. */
  chip: string;
}

export const UPDATE_KIND_META: Record<MerchantUpdateKind, UpdateKindMeta> = {
  merchant_reply: {
    label: "Merchant replied",
    Icon: ChatBubbleLeftEllipsisIcon,
    edge: "border-l-violet-500",
    head: "text-violet-600 dark:text-violet-400",
    chip: "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300",
  },
  merchant_signed: {
    label: "Document signed",
    Icon: PencilSquareIcon,
    edge: "border-l-emerald-500",
    head: "text-emerald-600 dark:text-emerald-400",
    chip: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  },
  documents: {
    label: "Documents arrived",
    Icon: DocumentArrowUpIcon,
    edge: "border-l-sky-500",
    head: "text-sky-600 dark:text-sky-400",
    chip: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
  },
  funder_reply: {
    label: "Funder replied",
    Icon: InboxArrowDownIcon,
    edge: "border-l-amber-500",
    head: "text-amber-600 dark:text-amber-400",
    chip: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  },
  funder_offer: {
    label: "Offer received",
    Icon: BanknotesIcon,
    edge: "border-l-emerald-500",
    head: "text-emerald-600 dark:text-emerald-400",
    chip: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  },
  funder_decline: {
    label: "Funder declined",
    Icon: HandThumbDownIcon,
    edge: "border-l-red-500",
    head: "text-red-600 dark:text-red-400",
    chip: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
  },
};

/** Falls back rather than crashing if the DB grows a kind the UI hasn't met. */
export function metaFor(kind: string): UpdateKindMeta {
  return (
    UPDATE_KIND_META[kind as MerchantUpdateKind] ?? {
      label: "File changed",
      Icon: InboxArrowDownIcon,
      edge: "border-l-gray-400",
      head: "text-gray-600 dark:text-gray-300",
      chip: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200",
    }
  );
}

/**
 * The one-line headline for a card.
 *
 * ⚠️ A ROLLED-UP CARD MUST LEAD WITH ITS COUNT. `detail` on a documents
 * roll-up is the LAST document type in the burst, so a card reading "Documents
 * arrived · voided check" against an `event_count` of 8 is actively misleading
 * about what landed. Verified live: MF-2026-0083 rolled 8 documents whose last
 * was a voided check, and MF-2026-0422 rolled 17 bank statements.
 */
export function headlineFor(kind: string, title: string, eventCount: number): string {
  if (kind === "documents" && eventCount > 1) return `${eventCount} documents arrived`;
  return title;
}

/**
 * The supporting line under the headline.
 *
 * ⚠️ "most recent:" ONLY FOR DOCUMENTS. A count above 1 means two different
 * things depending on the kind, and conflating them misleads:
 *
 *   documents  — N DIFFERENT files landed in one burst, and `detail` is only
 *                the last one's type. "most recent:" is the honest label.
 *   everything — the SAME event was reported twice. Bankers signed one
 *   else       disclosure and it was logged at 12:53:57 and again at 12:55:21;
 *                labelling that "most recent: MCA — Broker Compensation
 *                Disclosure" implies a second, different document he never
 *                signed — which is the same class of mistake as the disclosure
 *                being mistaken for the application in the first place.
 */
export function subtitleFor(kind: string, detail: string | null, eventCount: number): string | null {
  if (!detail) return null;
  return kind === "documents" && eventCount > 1 ? `most recent: ${detail}` : detail;
}
