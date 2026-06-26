// Pipeline definitions for the animated PipelineFlow visual. One entry per GHL
// pipeline so end users and employees see the same journey. Keep MCA stage keys
// in sync with DealStatus.

export interface PipelineStage {
  key: string;
  label: string;
  blurb: string; // merchant-friendly one-liner
}

export interface PipelineDef {
  id: "mca" | "vcf";
  name: string;
  stages: PipelineStage[];
}

export const MCA_PIPELINE: PipelineDef = {
  id: "mca",
  name: "MFunding MCA Pipeline",
  stages: [
    { key: "new", label: "New Lead", blurb: "We received your request." },
    { key: "contacted", label: "Contacted", blurb: "A specialist reached out." },
    { key: "qualifying", label: "Qualifying", blurb: "Reviewing your business basics." },
    { key: "application_sent", label: "Application", blurb: "Application in progress." },
    { key: "docs_collected", label: "Documents", blurb: "Collecting your documents." },
    { key: "bank_statements", label: "Bank Statements", blurb: "Verifying your bank activity." },
    { key: "submitted_to_funder", label: "Submitted", blurb: "Sent to multiple funding partners." },
    { key: "offer_received", label: "Offer Received", blurb: "Funders responded with offers." },
    { key: "offer_presented", label: "Offer Presented", blurb: "Review your offer(s)." },
    { key: "offer_accepted", label: "Accepted", blurb: "You accepted your offer." },
    { key: "funded", label: "Funded", blurb: "Capital deposited!" },
    { key: "renewal_eligible", label: "Renewal", blurb: "Eligible for more capital." },
    { key: "nurture", label: "Nurture / Re-engage", blurb: "We'll keep working to find you funding." },
  ],
};

export const VCF_PIPELINE: PipelineDef = {
  id: "vcf",
  name: "MFunding VCF Pipeline",
  stages: [
    { key: "new_distressed", label: "New Lead", blurb: "We received your request." },
    { key: "hardship_consult", label: "Hardship Review", blurb: "Understanding your situation." },
    { key: "positions_analysis", label: "Positions Analysis", blurb: "Tallying your MCA positions." },
    { key: "strategy_proposal", label: "Strategy", blurb: "Building your relief plan." },
    { key: "agreement_sent", label: "Agreement", blurb: "Sign your engagement." },
    { key: "submitted_to_vcf", label: "Submitted", blurb: "Sent to VCF." },
    { key: "restructure_executed", label: "Restructured", blurb: "Positions consolidated." },
    { key: "servicing", label: "Servicing", blurb: "Ongoing support." },
  ],
};

export const PIPELINES: Record<"mca" | "vcf", PipelineDef> = {
  mca: MCA_PIPELINE,
  vcf: VCF_PIPELINE,
};
