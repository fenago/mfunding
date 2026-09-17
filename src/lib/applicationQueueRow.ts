// The typed contract for public.processor_application_queue() + the one adapter
// that turns its app_fields payload into applicationCompleteness()'s arguments.
//
// WHY THE ADAPTER LIVES HERE AND NOT IN THE UI
// applicationCompleteness() is THE definition of "is this application complete",
// and it needs a DealWithCustomer-shaped object plus the saved mca_applications
// row (or null), because it reproduces BOTH of the modal's branches — hydrate
// from the draft, or seed from customer + deal + lead_qual. The RPC deliberately
// does NOT decide completeness in SQL (that is the lockstep-divergence bug this
// codebase keeps hitting); it ships the raw material in `app_fields` instead.
// The shape of that payload is the data layer's contract, so the unpacking of it
// belongs next to the contract rather than being re-guessed in every screen.

import type { DealWithCustomer } from "@/types/deals";
import { applicationCompleteness, type CompletenessResult } from "./applicationCompleteness";

/**
 * Which rung of the attribution ladder produced app_sent_by. Owner ruling: every
 * sent application shows a name — but a name that came from a fallback must never
 * render like a name that came from a record.
 *
 *   'recorded'          mca_applications.sent_by, or auth.uid() captured as the
 *                       stage was stamped. Assert this one plainly.
 *   'inferred'          nearest person active on the deal within ±10 min.
 *   'inferred_same_day' nearest person active within ±24 h.
 *   'assumed_owner'     NO evidence at all — this is simply the closer the deal
 *                       is assigned to right now. Say so: "nobody recorded who
 *                       sent it". Never show it as an assertion.
 *   'unknown'           no evidence and no assigned closer either.
 *
 * NULL means the application was never sent, so there is nothing to attribute —
 * do not render "sent by" at all.
 */
export type AppSentAttribution =
  | "recorded"
  | "inferred"
  | "inferred_same_day"
  | "assumed_owner"
  | "unknown";

/** True only for rung 1 — the one rung that may be stated without qualification. */
export function isAttributionRecorded(a: AppSentAttribution | null): boolean {
  return a === "recorded";
}

/** True when the name came from a fallback, not from evidence about the send. */
export function isAttributionAssumed(a: AppSentAttribution | null): boolean {
  return a === "assumed_owner" || a === "unknown";
}

/**
 * Signature readability, three states on purpose.
 *
 * ghl_doc_completions is a LAZY mirror, filled only when someone actually opens
 * a contact's documents — it is not a sweep. So an absent completion row means
 * EITHER "not signed" OR "nobody ever looked", and rendering the second as the
 * first reports a failure as a success. `unchecked` must never be shown as
 * "unsigned"; show it as "not checked" (and, if you want it resolved, opening
 * the merchant's documents is what sets customers.ghl_docs_checked_at).
 */
export type SignatureState = "signed" | "not_signed" | "unchecked";

/** The raw material applicationCompleteness() needs, straight from the RPC. */
export interface AppFieldsPayload {
  /** The saved mca_applications row, or null when no draft exists yet. */
  application: Record<string, unknown> | null;
  deal: {
    id: string;
    deal_type: string | null;
    status: string | null;
    amount_requested: number | null;
    use_of_funds: string | null;
    lead_qual: Record<string, unknown>;
  };
  customer: {
    id: string;
    business_name: string | null;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
    industry: string | null;
    monthly_revenue: number | null;
    address_street: string | null;
    address_city: string | null;
    address_state: string | null;
    address_zip: string | null;
  };
}

/** One row of public.processor_application_queue(). Column-for-column. */
export interface ApplicationQueueRow {
  deal_id: string;
  deal_number: string | null;
  merchant_name: string | null;
  deal_status: string;
  deal_type: string | null;
  customer_id: string;
  /** The merchant's GHL contact id — for an on-demand document refresh. */
  ghl_contact_id: string | null;
  do_not_contact: boolean;
  assigned_closer_id: string | null;
  assigned_closer_name: string | null;

  app_sent_at: string | null;
  app_sent_by: string | null;
  app_sent_by_name: string | null;
  /**
   * null when there is no send to attribute — either the application was never
   * sent, or app_sent_at is a phantom stamp (see born_at_application_sent).
   */
  app_sent_attribution: AppSentAttribution | null;
  /** Human-readable evidence (or the lack of it), for the badge tooltip. */
  app_sent_attribution_basis: string | null;
  /**
   * app_sent_at was stamped by the GHL opportunity mirror when the deal was
   * created, not by a send we made: the timestamp lands milliseconds BEFORE
   * created_at and there is no creating user. Four live rows, so the "63 sent"
   * is really 59.
   *
   * It rests only on immutable creation facts. An earlier version also required
   * "no application draft", which a processor filling in the application would
   * have flipped — the flag would have vanished mid-work and the row would have
   * gone back to naming a sender for an event that never happened.
   *
   * These rows carry NO sender (app_sent_by / app_sent_attribution are null) —
   * there is no send to attribute.
   *
   * ⚠ It means "we have no record of sending it", NOT "the merchant never got
   * it": MF-2026-0273 is flagged AND signed, so a send happened inside GHL.
   * Give these their own bucket with their own action rather than leaving them
   * in the signature-chasing list — an unsigned one is "send it or close it";
   * a signed one means only our record is missing. Chasing a signature on an
   * application that was never sent is the exact harm this flag prevents
   * (MF-2026-0324 is still sitting at status application_sent).
   */
  born_at_application_sent: boolean;

  app_signed_at: string | null;
  app_signed_state: SignatureState;
  /** When we last successfully read this contact's GHL doc list. */
  app_signed_checked_at: string | null;
  disclosure_signed_at: string | null;
  disclosure_state: SignatureState;

  statements_count: number;
  statements_last_at: string | null;

  qa_decision: "go" | "no_go" | null;
  qa_decided_at: string | null;
  qa_decision_reason: string | null;

  days_since_app_sent: number | null;
  first_call_due_at: string | null;
  attempts_since_sent: number;
  last_attempt_at: string | null;
  last_conversation_at: string | null;

  app_row_exists: boolean;
  app_fields: AppFieldsPayload;
}

/**
 * Measure a queue row's application with the ONE definition of completeness.
 *
 * Reconstructs just enough of a DealWithCustomer for applicationCompleteness()
 * to seed from when there is no saved draft; when there IS a draft the helper
 * hydrates from it and only the deal's ask / use-of-funds are read off the deal
 * (which is exactly what the payload carries).
 */
export function queueRowCompleteness(row: ApplicationQueueRow): CompletenessResult {
  const { application, deal, customer } = row.app_fields;
  const shaped = {
    ...deal,
    customer: {
      ...customer,
      // applicationCompleteness only reads the fields above; these keep the
      // DealWithCustomer shape satisfied without inventing values.
      additional_emails: null,
      additional_phones: null,
    },
  } as unknown as DealWithCustomer;
  return applicationCompleteness(shaped, application);
}

/** True when the merchant has an application we can actually submit behind. */
export function isApplicationSigned(row: ApplicationQueueRow): boolean {
  return row.app_signed_state === "signed";
}

/**
 * Can we trust "not signed"? False means we have never read this contact's GHL
 * documents, so the row must say "not checked", not "unsigned".
 */
export function isSignatureKnown(row: ApplicationQueueRow): boolean {
  return row.app_signed_state !== "unchecked";
}

/**
 * Did WE actually send this application? False for a phantom stamp the GHL
 * mirror wrote at deal creation. Use it to keep those rows out of the
 * signature-chasing bucket — chasing a signature on an application nobody sent
 * is wasted work, and it is what MF-2026-0324 would otherwise cause.
 */
export function isRealSend(row: ApplicationQueueRow): boolean {
  return row.app_sent_at !== null && !row.born_at_application_sent;
}
