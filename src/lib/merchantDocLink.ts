// merchantDocLink — the client side of the logged-OUT document page
// (/connect-bank/:token). Both calls go to the merchant-upload-doc edge function
// with the URL token as the only credential; there is no merchant login.
//
// A logged-out browser CANNOT write the customer-documents bucket or
// customer_documents directly (no `anon` policy on either), so the upload is a
// multipart POST to the function, which does both writes with the service role.
import supabase from "../supabase";
import { parseEdgeError } from "./edgeError";

/** What we can PROVE we hold. `null` means the read FAILED — render that as
 *  "we couldn't check", never as "nothing on file". */
export interface DocsOnFile {
  bank_statements: number;
  other_docs: number;
}

export interface DocLinkStatus {
  businessName: string | null;
  contactName: string | null;
  dealNumber: string | null;
  /** null = unreadable, not zero. */
  onFile: DocsOnFile | null;
}

interface StatusResponse {
  ok?: boolean;
  business_name?: string | null;
  contact_name?: string | null;
  deal_number?: string | null;
  on_file?: DocsOnFile | null;
  error?: string;
}

/** Who this link belongs to and what is already on their file. Throws with the
 *  server's real message (expired/invalid token included). */
export async function fetchDocLinkStatus(token: string): Promise<DocLinkStatus> {
  try {
    const { data, error } = await supabase.functions.invoke("merchant-upload-doc", {
      body: { link_ref: token, action: "status" },
    });
    if (error) throw error;
    const d = data as StatusResponse | null;
    if (d?.error) throw new Error(d.error);
    return {
      businessName: d?.business_name ?? null,
      contactName: d?.contact_name ?? null,
      dealNumber: d?.deal_number ?? null,
      onFile: d?.on_file ?? null,
    };
  } catch (e) {
    const { message } = await parseEdgeError(e, "We couldn't load your file just now.");
    throw new Error(message);
  }
}

export interface UploadResult {
  documentId: string;
  filename: string;
  /** null = unreadable. */
  onFile: DocsOnFile | null;
}

/**
 * Store ONE file and record it against the merchant's customer. Returns only
 * after the `customer_documents` row exists — the funder-submission gate reads
 * that row, not the bucket, so a stored file without one would be invisible.
 */
export async function uploadMerchantDoc(
  token: string,
  file: File,
  documentType: string,
): Promise<UploadResult> {
  const form = new FormData();
  form.append("link_ref", token);
  form.append("document_type", documentType);
  form.append("file", file, file.name);

  try {
    const { data, error } = await supabase.functions.invoke("merchant-upload-doc", {
      body: form,
    });
    if (error) throw error;
    const d = data as
      | { ok?: boolean; document_id?: string; filename?: string; on_file?: DocsOnFile | null; error?: string }
      | null;
    if (d?.error) throw new Error(d.error);
    if (!d?.document_id) throw new Error(`"${file.name}" did not go through. Please try again.`);
    return {
      documentId: d.document_id,
      filename: d.filename ?? file.name,
      onFile: d.on_file ?? null,
    };
  } catch (e) {
    const { message } = await parseEdgeError(e, `We couldn't upload "${file.name}". Please try again.`);
    throw new Error(message);
  }
}
