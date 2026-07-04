// Funder Availability — "which live MCA funders can I submit THIS merchant to
// right now?" It reads each live funder's STRUCTURED doc requirements off
// lender_programs (product_type='mca', is_active) and checks them against the
// closer-controlled manual doc checklist (deals.doc_checklist) — the SOURCE OF
// TRUTH for what's collected. (The DocumentChecklist UI still HINTS from
// customer_documents/GHL, but only the ticked checklist counts here.)
//
// This is ADVISORY visibility only. It does NOT gate the submit engine — the
// real hard gate (required_stips + signed-application) still lives in
// FunderPicker / submit-to-funders. Here a funder is READY when every
// HARD-required doc is on file; voided-check and conditional/if-applicable docs
// are advisories that never flip a funder to not-ready.
import supabase from "../supabase";
import type { DealWithCustomer } from "../types/deals";

export interface FunderReadiness {
  lenderId: string;
  name: string;
  ready: boolean;
  missing: string[]; // hard-required docs not on file, human-labeled
  advisories: string[]; // voided check + conditional/if-applicable docs (never blocking)
  bankMonths: number | null; // doc_bank_statement_months, for "(3mo)" context
  conditions: string | null; // doc_conditions free-text ("CA deals: 4 months")
}

// customer_document_type slugs (see FunderPicker DOC_LABELS) used as the
// docs-on-file vocabulary the structured requirements map onto.
const DOC_LABELS: Record<string, string> = {
  application: "Signed application",
  bank_statement: "Bank statements",
  id: "Photo ID",
  business_license: "Business license",
  tax_return: "Tax return",
  voided_check: "Voided check",
};

// Rows we read off lender_programs for the readiness math (+ the joined lender).
interface ProgramRow {
  lender_id: string;
  doc_bank_statement_months: number | null;
  doc_application: boolean | null;
  doc_photo_id: boolean | null;
  doc_voided_check: boolean | null;
  doc_cc_processing: string | null;
  doc_mtd_statement: boolean | null;
  doc_proof_of_ownership: boolean | null;
  doc_ar_aging: string | null;
  doc_tax_financials: string | null;
  doc_conditions: string | null;
  lenders: { id: string; company_name: string; status: string } | null;
}

// Docs on file for a deal — the CLOSER-CONTROLLED manual checklist
// (deals.doc_checklist) is the SOURCE OF TRUTH. A doc slug is present iff the
// closer ticked it in the DocumentChecklist. We no longer infer "on file" from
// customer_documents.document_type or the GHL peek, because those miss docs (a
// Photo ID uploaded to GHL as "image.jpg" is never typed 'id'). The checklist,
// which the closer validates against the detection hints, is authoritative.
function getDocsPresent(deal: DealWithCustomer): Set<string> {
  const present = new Set<string>();
  const checklist = deal.doc_checklist ?? {};
  for (const [slug, on] of Object.entries(checklist)) {
    if (on === true) present.add(slug);
  }
  return present;
}

// For one funder program + the docs on file, decide ready / missing / advisories.
function evaluate(p: ProgramRow, docs: Set<string>): FunderReadiness {
  const missing: string[] = [];
  const advisories: string[] = [];

  // HARD-required docs: absence flips the funder to NOT ready.
  const hard: [boolean, string][] = [
    [p.doc_application === true, "application"],
    [p.doc_photo_id === true, "id"],
    [(p.doc_bank_statement_months ?? 0) > 0, "bank_statement"],
    [p.doc_proof_of_ownership === true, "business_license"],
    [p.doc_tax_financials === "required", "tax_return"],
  ];
  for (const [required, slug] of hard) {
    if (!required || docs.has(slug)) continue;
    // Bank statements carry the "(Nmo)" context when a month count is known.
    if (slug === "bank_statement" && (p.doc_bank_statement_months ?? 0) > 0) {
      missing.push(`${DOC_LABELS.bank_statement} (${p.doc_bank_statement_months}mo)`);
    } else {
      missing.push(DOC_LABELS[slug]);
    }
  }

  // ADVISORY docs: shown for context, NEVER blocking.
  // Voided check — a bank-portal screenshot satisfies it, so it never blocks.
  if (p.doc_voided_check === true && !docs.has("voided_check")) {
    advisories.push("Voided check (a bank-portal screenshot satisfies it)");
  }
  if (p.doc_tax_financials === "conditional") {
    advisories.push("Tax return / financials may be needed for larger deals");
  }
  if (p.doc_cc_processing === "required" || p.doc_cc_processing === "if_applicable") {
    advisories.push("CC-processing statements may also be needed");
  }
  if (p.doc_ar_aging === "required" || p.doc_ar_aging === "if_applicable") {
    advisories.push("A/R aging report may also be needed");
  }
  if (p.doc_mtd_statement === true) {
    advisories.push("Month-to-date bank statement may also be needed");
  }

  return {
    lenderId: p.lender_id,
    name: p.lenders?.company_name ?? "Funder",
    ready: missing.length === 0,
    missing,
    advisories,
    bankMonths: p.doc_bank_statement_months ?? null,
    conditions: p.doc_conditions?.trim() ? p.doc_conditions.trim() : null,
  };
}

// Main entry: readiness for every LIVE MCA funder against this deal's merchant,
// ready funders first then by name.
export async function getFunderDocReadiness(deal: DealWithCustomer): Promise<FunderReadiness[]> {
  const { data: programs } = await supabase
    .from("lender_programs")
    .select(
      "lender_id, doc_bank_statement_months, doc_application, doc_photo_id, doc_voided_check, doc_cc_processing, doc_mtd_statement, doc_proof_of_ownership, doc_ar_aging, doc_tax_financials, doc_conditions, lenders!inner(id, company_name, status)",
    )
    .eq("product_type", "mca")
    .eq("is_active", true);
  const docs = getDocsPresent(deal);

  // Filter to live funders client-side — mirrors FunderMatrixPage, which does the
  // same rather than filtering the embedded resource server-side.
  const rows = ((programs ?? []) as unknown as ProgramRow[]).filter(
    (p) => p.lenders?.status === "live_vendor",
  );
  return rows
    .map((p) => evaluate(p, docs))
    .sort((a, b) => {
      if (a.ready !== b.ready) return a.ready ? -1 : 1; // ready first
      return a.name.localeCompare(b.name);
    });
}
