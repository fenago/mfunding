// Merchant-visible journey model. Collapses the internal deal stages into a
// small number of steps a business owner actually understands, with plain,
// compliance-safe language.
//
// COMPLIANCE: MCA copy NEVER says "loan" — only "funding", "advance",
// "working capital", "application", "funding partners". VCF is debt relief and
// uses its own vocabulary (restructure, relief plan, positions). Every string
// here is merchant-facing and gets a compliance review.

import type { PortalDeal } from "../services/portalService";

export type WhoseMove = "you" | "us";

export interface MerchantStep {
  /** Stable id for this merchant-visible step. */
  key: string;
  /** Short step name shown in the journey. */
  label: string;
  /** One sentence: what's happening at this step. */
  whatsHappening: string;
  /** Whose court the ball is in while the deal sits at this step. */
  whoseMove: WhoseMove;
  /** Expected time frame, reassuring and honest. */
  timeframe: string;
  /** Internal deal statuses that map onto this merchant step. */
  statuses: string[];
  /** Timestamp column that best marks entry into this step, for the "done on"
   *  date stamp. Omitted where the deals table has no reliable analog. */
  stampField?: keyof PortalDeal;
}

export interface MerchantJourney {
  product: "mca" | "vcf";
  steps: MerchantStep[];
}

// ---- MCA / general funding journey -----------------------------------------

const MCA_STEPS: MerchantStep[] = [
  {
    key: "getting_started",
    label: "Getting started",
    whatsHappening: "We've received your request and a funding specialist is getting your file ready.",
    whoseMove: "us",
    timeframe: "We usually reach out within a few hours.",
    statuses: ["new", "contacted", "qualifying"],
    stampField: "contacted_at",
  },
  {
    key: "application",
    label: "Your application",
    whatsHappening: "Complete and sign your application so we can start matching you with funding partners.",
    whoseMove: "you",
    timeframe: "Takes about 5 minutes.",
    statuses: ["application_sent"],
    stampField: "application_sent_at",
  },
  {
    key: "documents",
    label: "Your documents",
    whatsHappening: "Upload your most recent business bank statements and a few quick items so partners can review your file.",
    whoseMove: "you",
    timeframe: "The faster these come in, the faster you get offers.",
    statuses: ["docs_collected", "bank_statements"],
    stampField: "docs_collected_at",
  },
  {
    key: "in_review",
    label: "In review",
    whatsHappening: "Your file is in front of our funding partners and they're reviewing it now.",
    whoseMove: "us",
    timeframe: "Funding partners typically respond within 24–48 hours.",
    statuses: ["submitted_to_funder"],
    stampField: "submitted_at",
  },
  {
    key: "offers",
    label: "Your offers",
    whatsHappening: "Offers are coming in — your advisor will walk you through your options and help you choose.",
    whoseMove: "us",
    timeframe: "We'll present your best options as soon as they land.",
    statuses: ["offer_received", "offer_presented", "offer_accepted"],
    stampField: "offer_received_at",
  },
  {
    key: "funded",
    label: "Funded 🎉",
    whatsHappening: "Your funding is on the way to your account.",
    whoseMove: "us",
    timeframe: "Funds usually arrive within 1 business day.",
    statuses: ["funded"],
    stampField: "funded_at",
  },
  {
    key: "growing",
    label: "Growing with us",
    whatsHappening: "As you pay down, you may qualify for additional capital — often on better terms.",
    whoseMove: "us",
    timeframe: "We'll let you know the moment you're eligible.",
    statuses: ["renewal_eligible"],
  },
];

// ---- VCF / debt-relief journey ---------------------------------------------

const VCF_STEPS: MerchantStep[] = [
  {
    key: "getting_started",
    label: "Getting started",
    whatsHappening: "We've received your request and a relief specialist is reviewing your situation with you.",
    whoseMove: "us",
    timeframe: "We usually reach out within a few hours.",
    statuses: ["new_distressed", "hardship_consult"],
    stampField: "contacted_at",
  },
  {
    key: "positions",
    label: "Your positions",
    whatsHappening: "We're tallying your current advances and balances so we understand the full picture.",
    whoseMove: "us",
    timeframe: "Usually completed within a day or two.",
    statuses: ["positions_analysis"],
    stampField: "qualified_at",
  },
  {
    key: "relief_plan",
    label: "Your relief plan",
    whatsHappening: "We're building a plan to ease your daily payments and get your business breathing room.",
    whoseMove: "us",
    timeframe: "Your specialist will share the plan with you.",
    statuses: ["strategy_proposal"],
  },
  {
    key: "agreement",
    label: "Your agreement",
    whatsHappening: "Review and sign your engagement so we can begin working on your behalf.",
    whoseMove: "you",
    timeframe: "Takes just a few minutes.",
    statuses: ["agreement_sent"],
  },
  {
    key: "in_process",
    label: "In process",
    whatsHappening: "We're actively working your file and negotiating on your behalf.",
    whoseMove: "us",
    timeframe: "We'll keep you posted at every step.",
    statuses: ["submitted_to_vcf"],
    stampField: "submitted_at",
  },
  {
    key: "restructured",
    label: "Restructured",
    whatsHappening: "Your positions have been consolidated and your payments restructured.",
    whoseMove: "us",
    timeframe: "You'll see the relief reflected in your payments.",
    statuses: ["restructure_executed"],
  },
  {
    key: "support",
    label: "Ongoing support",
    whatsHappening: "We're here for ongoing support and to keep your plan on track.",
    whoseMove: "us",
    timeframe: "Reach out anytime.",
    statuses: ["servicing"],
  },
];

export const MCA_JOURNEY: MerchantJourney = { product: "mca", steps: MCA_STEPS };
export const VCF_JOURNEY: MerchantJourney = { product: "vcf", steps: VCF_STEPS };

/** Statuses that are terminal / off-journey — render a respectful status card,
 *  never a journey step. */
export const TERMINAL_STATUSES = new Set(["declined", "dead", "nurture"]);

export function journeyFor(dealType: string): MerchantJourney {
  return dealType === "vcf" ? VCF_JOURNEY : MCA_JOURNEY;
}

export interface JourneyPosition {
  journey: MerchantJourney;
  /** Index of the current step, or -1 when terminal / not on the journey. */
  currentIndex: number;
  isTerminal: boolean;
}

export function resolveJourney(deal: Pick<PortalDeal, "deal_type" | "status">): JourneyPosition {
  const journey = journeyFor(deal.deal_type);
  if (TERMINAL_STATUSES.has(deal.status)) {
    return { journey, currentIndex: -1, isTerminal: true };
  }
  const idx = journey.steps.findIndex((s) => s.statuses.includes(deal.status));
  return { journey, currentIndex: idx, isTerminal: false };
}

// ---- Soft stage-SLA timers --------------------------------------------------
// Reassuring "typical wait" ranges per internal status. Never alarming — these
// tell a waiting merchant that silence is normal and progress is happening.

export interface StageSla {
  /** Human "typical wait" copy, e.g. "24–48 hours". */
  typical: string;
  /** Which timestamp the elapsed clock counts from. */
  since: keyof PortalDeal;
}

export const STAGE_SLA: Partial<Record<string, StageSla>> = {
  submitted_to_funder: { typical: "24–48 hours", since: "submitted_at" },
  offer_received: { typical: "about a day", since: "offer_received_at" },
  offer_presented: { typical: "review at your pace", since: "offer_presented_at" },
  submitted_to_vcf: { typical: "a few business days", since: "submitted_at" },
};
