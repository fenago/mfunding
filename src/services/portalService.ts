import supabase from "../supabase";

/**
 * Column-sanitized shape a merchant is allowed to see for their own deal.
 * NEVER add internal fields here (notes, ai_lender_recommendations, closer /
 * commission columns). All portal deal reads go through this service — portal
 * code must never `select("*")` from deals.
 */
export interface PortalDeal {
  id: string;
  deal_number: string | null;
  deal_type: string;
  status: string;
  amount_requested: number | null;
  amount_funded: number | null;
  created_at: string;
  // Stage timestamps (used for the stamped journey history + soft SLA timers)
  contacted_at: string | null;
  qualified_at: string | null;
  application_sent_at: string | null;
  docs_collected_at: string | null;
  bank_statements_at: string | null;
  submitted_at: string | null;
  offer_received_at: string | null;
  offer_presented_at: string | null;
  offer_accepted_at: string | null;
  funded_at: string | null;
  declined_at: string | null;
  nurture_at: string | null;
  /** SQL `date` — arrives as 'YYYY-MM-DD'. Treat as local end-of-day for
   *  countdowns (see utils/deadline.ts). */
  stips_promised_by: string | null;
  paydown_percentage: number | null;
}

// The exact, safe column list — shared by the fallback select so it can never
// drift from the RPC contract.
const PORTAL_DEAL_COLUMNS =
  "id, deal_number, deal_type, status, amount_requested, amount_funded, created_at, " +
  "contacted_at, qualified_at, application_sent_at, docs_collected_at, bank_statements_at, " +
  "submitted_at, offer_received_at, offer_presented_at, offer_accepted_at, funded_at, " +
  "declined_at, nurture_at, stips_promised_by, paydown_percentage";

function isFunctionMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  // Postgres "undefined_function" is 42883; PostgREST also surfaces a
  // "Could not find the function ... in the schema cache" message (PGRST202)
  // when the RPC hasn't been deployed yet.
  return (
    error.code === "42883" ||
    error.code === "PGRST202" ||
    /could not find the function|function .* does not exist/i.test(error.message || "")
  );
}

function isTableMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  // Postgres "undefined_table" is 42P01; PostgREST returns PGRST205 with a
  // "Could not find the table ... in the schema cache" message when the table
  // hasn't been created yet (backend building in parallel).
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /could not find the table|relation .* does not exist/i.test(error.message || "")
  );
}

/**
 * Fetch the signed-in merchant's own deals, column-sanitized.
 *
 * Prefers the SECURITY DEFINER RPC `get_my_portal_deals()` (auth.uid()-scoped,
 * returns only safe columns). If that RPC isn't deployed yet (backend in
 * parallel), falls back to the customer-linked direct select of the EXACT same
 * safe columns so the portal keeps working during the rollout.
 */
export async function getMyPortalDeals(userId: string): Promise<PortalDeal[]> {
  const { data, error } = await supabase.rpc("get_my_portal_deals");

  if (!error) {
    return (data ?? []) as PortalDeal[];
  }

  if (!isFunctionMissing(error)) {
    // A real error (network, auth, RLS) — surface it rather than masking.
    throw new Error(error.message || "Failed to load your funding requests.");
  }

  // Fallback: resolve the merchant's customer row, then read their deals.
  const { data: customer } = await supabase
    .from("customers")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (!customer) return [];

  const { data: rows, error: dealsError } = await supabase
    .from("deals")
    .select(PORTAL_DEAL_COLUMNS)
    .eq("customer_id", customer.id)
    .order("created_at", { ascending: false });

  if (dealsError) {
    throw new Error(dealsError.message || "Failed to load your funding requests.");
  }

  return (rows ?? []) as unknown as PortalDeal[];
}

// ── Document checklist (deal_doc_requests) ───────────────────────────────────
// A closer/VA (or a funder-stip request) creates rows the merchant must satisfy.
// Merchants SELECT their own rows via RLS; they mark an upload through the
// SECURITY DEFINER RPC `mark_doc_request_uploaded`.

export type DocRequestStatus =
  | "requested"
  | "uploaded"
  | "under_review"
  | "approved"
  | "rejected";

export interface DocRequest {
  id: string;
  deal_id: string;
  customer_id: string;
  doc_type: string;
  label: string;
  status: DocRequestStatus;
  rejection_reason: string | null;
  due_at: string | null;
  requested_by: string | null;
  document_id: string | null;
  created_at: string;
}

const DOC_REQUEST_COLUMNS =
  "id, deal_id, customer_id, doc_type, label, status, rejection_reason, due_at, " +
  "requested_by, document_id, created_at";

/** A merchant's own document requests (across their deals), oldest first.
 *  Returns [] cleanly if the table isn't deployed yet (backend in parallel). */
export async function getMyDocRequests(customerId: string): Promise<DocRequest[]> {
  const { data, error } = await supabase
    .from("deal_doc_requests")
    .select(DOC_REQUEST_COLUMNS)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: true });

  if (error) {
    if (isTableMissing(error)) return [];
    throw new Error(error.message || "Failed to load your document checklist.");
  }
  return (data ?? []) as unknown as DocRequest[];
}

/** Flip a request to 'uploaded' and link the stored document. No-op (non-fatal)
 *  if the RPC isn't deployed yet — the file still saved to customer_documents,
 *  the checklist status just won't advance until the RPC lands. */
export async function markDocRequestUploaded(
  requestId: string,
  documentId: string,
): Promise<void> {
  const { error } = await supabase.rpc("mark_doc_request_uploaded", {
    p_request_id: requestId,
    p_document_id: documentId,
  });
  if (error && !isFunctionMissing(error)) {
    throw new Error(error.message || "Couldn't mark this document as received.");
  }
}

/** Fire-and-forget: tell the backend a merchant uploaded a document so it can
 *  log the activity and re-run underwriting for bank statements. NEVER throws —
 *  a failure here must not block the merchant's upload. */
export async function notifyMerchantDocUploaded(documentId: string): Promise<void> {
  try {
    const { error } = await supabase.functions.invoke("merchant-doc-uploaded", {
      body: { document_id: documentId },
    });
    if (error) console.warn("[merchant-doc-uploaded] notify failed (non-blocking):", error.message);
  } catch (e) {
    console.warn("[merchant-doc-uploaded] notify threw (non-blocking):", e);
  }
}

// ── Anonymized funder submissions (get_my_deal_submissions) ───────────────────
// Merchant-safe view of where their file stands with funding partners. Partner
// identities are anonymized server-side ("Funding Partner A"...). Offer fields
// are null unless an offer has actually been presented.

export type SubmissionBucket =
  | "submitted"
  | "reviewing"
  | "offer"
  | "declined"
  | "withdrawn";

export interface DealSubmissionView {
  /** Opaque handle for offer actions (accept/decline). Always returned by
   *  get_my_deal_submissions in the confirmed contract. */
  submission_id: string;
  partner_label: string;
  status_bucket: SubmissionBucket;
  submitted_at: string | null;
  offer_amount: number | null;
  offer_payback: number | null;
  offer_term: number | null;
  offer_payment: number | null;
  offer_frequency: string | null;
  offer_expires_at: string | null;
}

/** Anonymized submission rows for one of the merchant's deals. Returns []
 *  cleanly if the RPC isn't deployed yet. */
export async function getMyDealSubmissions(dealId: string): Promise<DealSubmissionView[]> {
  const { data, error } = await supabase.rpc("get_my_deal_submissions", {
    p_deal_id: dealId,
  });

  if (error) {
    if (isFunctionMissing(error)) return [];
    throw new Error(error.message || "Failed to load your submission status.");
  }
  return (data ?? []) as DealSubmissionView[];
}

// ── Offer response (respond_to_offer) ────────────────────────────────────────
// The merchant accepts or declines a specific funder offer. The RPC is
// auth-scoped and validates the submission is theirs, still at offer stage, and
// not expired. We surface friendly errors; graceful-degrade if not deployed yet.

export type OfferResponse = "accept" | "decline";

export class OfferActionError extends Error {}

/** Accept or decline an offer by its submission handle. Resolves on success;
 *  throws OfferActionError with a merchant-safe message on a real failure. */
export async function respondToOffer(
  submissionId: string,
  response: OfferResponse,
): Promise<void> {
  const { error } = await supabase.rpc("respond_to_offer", {
    p_submission_id: submissionId,
    p_response: response,
  });

  if (!error) return;

  if (isFunctionMissing(error)) {
    throw new OfferActionError(
      "We couldn't record that just yet — please reach out to your funding specialist and they'll take care of it.",
    );
  }
  // Backend raises a specific message for expired / not-yours / wrong-stage.
  throw new OfferActionError(
    error.message || "Something went wrong recording your choice. Please try again.",
  );
}

// ── Documents to e-sign (merchant_documents) ─────────────────────────────────
// A server-merged, frozen agreement the merchant reviews and signs. The merchant
// SELECTs their own rows via RLS; signing goes through sign_merchant_document.

export type MerchantDocStatus = "draft" | "sent" | "signed" | "void";

export interface MerchantDocument {
  id: string;
  deal_id: string | null;
  /** Human template/agreement name shown to the merchant. */
  name: string;
  /** Frozen, server-merged document body — plain TEXT. Render preformatted;
   *  never as raw HTML. */
  merged_content: string;
  content_sha256: string | null;
  status: MerchantDocStatus;
  sent_at: string | null;
  signed_at: string | null;
}

const MERCHANT_DOC_COLUMNS =
  "id, deal_id, name, status, sent_at, signed_at, merged_content, content_sha256";

/** All of the signed-in merchant's documents (own rows via RLS), newest first.
 *  Returns [] cleanly if the table isn't deployed yet (backend in parallel). */
export async function getMyMerchantDocuments(): Promise<MerchantDocument[]> {
  const { data, error } = await supabase
    .from("merchant_documents")
    .select(MERCHANT_DOC_COLUMNS)
    .order("created_at", { ascending: false });

  if (error) {
    if (isTableMissing(error)) return [];
    throw new Error(error.message || "Failed to load your documents.");
  }
  return (data ?? []) as unknown as MerchantDocument[];
}

/** A single document by id (own row via RLS). null if missing / not deployed. */
export async function getMerchantDocument(documentId: string): Promise<MerchantDocument | null> {
  const { data, error } = await supabase
    .from("merchant_documents")
    .select(MERCHANT_DOC_COLUMNS)
    .eq("id", documentId)
    .maybeSingle();

  if (error) {
    if (isTableMissing(error)) return null;
    throw new Error(error.message || "Failed to load this document.");
  }
  return (data as unknown as MerchantDocument) ?? null;
}

export class SignDocumentError extends Error {}

/** Apply the merchant's typed-name electronic signature to a document via the
 *  `sign-merchant-document` edge function (which writes the ledger row, IP/UA,
 *  storage artifact, and the customer_documents copy server-side). Resolves on
 *  success; throws a retryable SignDocumentError on failure. */
export async function signMerchantDocument(
  documentId: string,
  typedLegalName: string,
  consent: boolean,
): Promise<void> {
  type SignResult = { ok?: boolean; message?: string } | null;
  let data: SignResult = null;
  let error: { message?: string } | null = null;
  try {
    const res = await supabase.functions.invoke("sign-merchant-document", {
      body: {
        document_id: documentId,
        typed_legal_name: typedLegalName,
        consent,
      },
    });
    data = res.data as SignResult;
    error = res.error;
  } catch (e) {
    throw new SignDocumentError(
      e instanceof Error ? e.message : "We couldn't record your signature. Please try again.",
    );
  }

  if (error) {
    throw new SignDocumentError(
      error.message || "We couldn't record your signature. Please try again.",
    );
  }
  if (data && data.ok === false) {
    throw new SignDocumentError(
      data.message || "We couldn't record your signature. Please try again.",
    );
  }
}

/** Internal deal statuses that mean the file has reached (or passed) funder
 *  submission — the point at which the submissions card is meaningful. Covers
 *  both the MCA and VCF pipelines. */
export const SUBMITTED_OR_PAST_STATUSES = new Set<string>([
  "submitted_to_funder",
  "offer_received",
  "offer_presented",
  "offer_accepted",
  "funded",
  "renewal_eligible",
  "submitted_to_vcf",
  "restructure_executed",
  "servicing",
]);
