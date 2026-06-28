import supabase from "../supabase";

// Document review workflow — admins review uploaded customer documents
// (pending -> reviewed -> approved / rejected). Bucket: customer-documents.

export type DocReviewStatus = "pending" | "reviewed" | "approved" | "rejected";

export interface ReviewDoc {
  id: string;
  document_type: string;
  filename: string;
  storage_path: string;
  file_size: number | null;
  status: DocReviewStatus;
  created_at: string;
  customer_id: string;
  customer: { business_name: string | null; first_name: string | null; last_name: string | null } | null;
}

const BUCKET = "customer-documents";

/** Documents needing attention (pending + reviewed), oldest first. */
export async function getDocumentsForReview(includeAll = false): Promise<ReviewDoc[]> {
  let query = supabase
    .from("customer_documents")
    .select(`
      id, document_type, filename, storage_path, file_size, status, created_at, customer_id,
      customer:customers!customer_id ( business_name, first_name, last_name )
    `)
    .order("created_at", { ascending: true });
  if (!includeAll) query = query.in("status", ["pending", "reviewed"]);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as unknown as ReviewDoc[];
}

export async function setDocumentStatus(id: string, status: DocReviewStatus): Promise<void> {
  const { error } = await supabase.from("customer_documents").update({ status }).eq("id", id);
  if (error) throw error;
}

/** Short-lived signed URL to view/download a document. */
export async function getDocumentUrl(storagePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 60);
  if (error) return null;
  return data?.signedUrl ?? null;
}
