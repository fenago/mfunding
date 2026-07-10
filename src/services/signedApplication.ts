// Signed-application plumbing shared by Step 5 (the "Docs back from the merchant"
// action banner) and Step 6 (FunderPicker's upload slot).
//
// WHY THIS MATTERS: merchants e-sign the application inside GHL, and that signed
// PDF lives ONLY in GHL — the GHL API can't fetch e-sign PDFs, so a human has to
// download it from GHL and upload it here. Funder submission emails attach docs
// from OUR storage (customer_documents), so until that upload happens the package
// that goes to funders is missing the application. submit-to-funders enforces this
// with a hard server gate; these helpers make the same fact visible in the UI so
// nobody hits the wall by surprise.
import supabase from "../supabase";
import { mustWrite } from "@/supabase/writes";

// Ground truth for "can a funder submission go out": is the signed application
// attached APP-SIDE (Supabase customer_documents), not just signed in GHL? This
// is exactly what submit-to-funders checks before it will fan out.
export async function hasSignedApplicationOnFile(customerId: string): Promise<boolean> {
  const { data } = await supabase
    .from("customer_documents")
    .select("id")
    .eq("customer_id", customerId)
    .eq("document_type", "application")
    .limit(1);
  return (data?.length ?? 0) > 0;
}

// Upload the signed application PDF the closer downloaded from GHL. Mirrors the
// shared DocumentUploader conventions exactly: same bucket, same path shape, same
// customer_documents insert — so the submit-to-funders engine picks it up
// automatically and attaches it (as an expiring link) to every funder.
export async function uploadSignedApplication(opts: {
  file: File;
  customerId: string;
  uploadedBy?: string | null;
}): Promise<void> {
  const { file, customerId, uploadedBy } = opts;
  const ext = file.name.split(".").pop();
  const path = `customer/${customerId}/${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;
  const { error: upErr } = await supabase.storage.from("customer-documents").upload(path, file, {
    cacheControl: "3600",
    upsert: false,
  });
  if (upErr) throw upErr;
  await mustWrite(
    "upload signed application doc",
    supabase.from("customer_documents").insert({
      document_type: "application",
      filename: file.name,
      storage_path: path,
      file_size: file.size,
      mime_type: file.type,
      uploaded_by: uploadedBy ?? undefined,
      customer_id: customerId,
    }),
  );
}
