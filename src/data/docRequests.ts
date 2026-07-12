// Document-request vocabulary shared by the closer's "Request documents" UI and
// the merchant's docs hub.
//
// COMPLIANCE: every merchant-facing string here gets a compliance review. MCA
// language only — "funding partners", "your file", never "loan". Keep the
// helper copy plain and reassuring.

export interface DocRequestTemplate {
  /** Feeds customer_documents.document_type on upload — keep aligned with the
   *  existing type vocabulary so admin filters/checklists still match. */
  doc_type: string;
  /** Merchant-friendly label shown on the checklist card. */
  label: string;
}

/** Quick-pick templates the closer can request in one tap.
 *  EXACTLY the Revenue Playbook's Rail 2 (upload) items — the application and
 *  broker disclosure are Rail 1 (e-sign via GHL) and are NOT upload requests. */
export const DOC_REQUEST_TEMPLATES: DocRequestTemplate[] = [
  { doc_type: "bank_statement", label: "Last 4 months of business bank statements" },
  { doc_type: "id", label: "Driver's license (photo of the front)" },
  { doc_type: "voided_check", label: "Voided business check" },
  { doc_type: "business_license", label: "Proof of business ownership" },
];

/** doc_type → merchant-friendly label, used by the "upload something else"
 *  picker and to label documents already on file. */
export const DOCUMENT_TYPES: { value: string; label: string }[] = [
  { value: "bank_statement", label: "Bank Statement" },
  { value: "application", label: "Application" },
  { value: "tax_return", label: "Tax Return" },
  { value: "id", label: "ID / Driver's License" },
  { value: "business_license", label: "Business License" },
  { value: "voided_check", label: "Voided Check" },
  { value: "other", label: "Something else" },
];

/** Merchant-facing helper text per doc_type, shown under each checklist card.
 *  Falls back to a generic line for custom / unknown types. */
export const DOC_TYPE_HELP: Record<string, string> = {
  bank_statement:
    "Your most recent business bank statements. A PDF straight from your online banking is perfect — or a clear photo of each page.",
  id: "A clear photo of the front of your driver's license.",
  voided_check:
    "A voided business check (preferred) — or a screenshot of your account and routing numbers from your online banking if a check isn't available. Either one works.",
  application:
    "Your signed application. Check your email for the signing link, or snap a photo of the signed pages and upload them here.",
  tax_return: "Your most recent business tax return.",
  business_license:
    "Any official document showing you own the business — your business license, articles of incorporation or organization, or your EIN letter. A photo or PDF works.",
  other: "Upload the requested item as a clear photo or a PDF.",
};

export const DOC_TYPE_HELP_FALLBACK =
  "Upload this as a clear photo or a PDF. Photos taken with your phone are fine.";

export function docTypeHelp(docType: string): string {
  return DOC_TYPE_HELP[docType] ?? DOC_TYPE_HELP_FALLBACK;
}

/** Max upload size enforced in the browser (matches the storage bucket copy). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
