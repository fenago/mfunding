// Synergy Direct's real product catalog — the single source of truth the campaign
// onboarding wizard, the rate-card reference panel, and the pricing math all read
// from. Prices are Synergy's published rates; when they change, change them HERE.
//
// Every product maps to one of the app's existing campaign CHANNELS so the rest
// of the app (codes, checklists, KPIs) keeps working unchanged.

import type { CampaignChannel } from "@/services/campaignService";

export type SynergyPricingModel = "volume_tier" | "age_band" | "hourly";

// A volume tier: unit price that kicks in once the ordered quantity reaches minQty.
export interface VolumeTier {
  label: string;          // "Standard", "25+", "50k–99,999"
  minQty: number;         // inclusive lower bound (in the product's unit)
  maxQty: number | null;  // inclusive upper bound; null = no ceiling
  unit: number;           // $ per unit at this tier
}

// An age band: a fixed unit price for leads of a given freshness.
export interface AgeBand {
  value: string;          // stable key, e.g. "1-7"
  label: string;          // "1–7 days"
  unit: number;           // $ per lead
}

// A spend-based bonus tier (web leads): hit the spend, get bonus leads.
export interface BonusTier {
  minSpend: number;
  pct: number;            // e.g. 10 for +10%
}

export interface SynergyProduct {
  id: string;
  name: string;
  channel: CampaignChannel;
  pricingModel: SynergyPricingModel;
  unitLabel: string;      // singular unit noun: "record", "lead", "transfer", "hour"
  qtyLabel: string;       // the quantity prompt: "How many live transfers?"
  blurb: string;          // one-line description for the picker card
  priceRange: string;     // compact price label for the card, e.g. "$25–$40"
  includes: string;       // what's bundled
  tiers?: VolumeTier[];   // volume_tier
  ageBands?: AgeBand[];   // age_band
  bonusTiers?: BonusTier[]; // web leads only
  hourlyRate?: number;    // hourly
  minHours?: number;      // hourly weekly minimum
}

// The four data-list bulk tiers shared by Aged / UCC / Trigger.
const DATA_TIERS: VolumeTier[] = [
  { label: "Base (under 50k)", minQty: 1, maxQty: 49_999, unit: 0.05 },
  { label: "50k–99,999", minQty: 50_000, maxQty: 99_999, unit: 0.03 },
  { label: "100k–249,999", minQty: 100_000, maxQty: 249_999, unit: 0.02 },
  { label: "250k+", minQty: 250_000, maxQty: null, unit: 0.01 },
];

export const SYNERGY_PRODUCTS: SynergyProduct[] = [
  {
    id: "aged_leads",
    name: "Aged Leads",
    channel: "aged",
    pricingModel: "volume_tier",
    unitLabel: "record",
    qtyLabel: "How many records?",
    blurb: "Company, contact, phone + validated email. TCPA scrubbed. Best for cold calling, SMS, or email.",
    priceRange: "$0.01–$0.05 / record",
    includes: "Company, contact name, phone, validated email — TCPA scrubbed.",
    tiers: DATA_TIERS,
  },
  {
    id: "ucc_leads",
    name: "UCC Leads",
    channel: "ucc",
    pricingModel: "volume_tier",
    unitLabel: "record",
    qtyLabel: "How many records?",
    blurb: "Owners with a prior loan or advance on file (UCC). High intent for more capital.",
    priceRange: "$0.01–$0.05 / record",
    includes: "Company, contact, phone, validated email — owners with prior funding.",
    tiers: DATA_TIERS,
  },
  {
    id: "trigger_leads",
    name: "Trigger Leads",
    channel: "trigger",
    pricingModel: "volume_tier",
    unitLabel: "record",
    qtyLabel: "How many records?",
    blurb: "A financial institution just pulled their credit — they're shopping for money right now.",
    priceRange: "$0.01–$0.05 / record",
    includes: "Company, contact, phone, validated email — recent credit-pull signal.",
    tiers: DATA_TIERS,
  },
  {
    id: "web_leads",
    name: "Web Leads",
    channel: "web_purchased",
    pricingModel: "age_band",
    unitLabel: "lead",
    qtyLabel: "How many leads?",
    blurb: "Full application data — revenue, time in business, FICO, funding request, existing loans.",
    priceRange: "$1–$3 / lead",
    includes: "Contact, revenue, TIB, FICO, funding request, existing loans.",
    ageBands: [
      { value: "1-7", label: "1–7 days old", unit: 3 },
      { value: "8-14", label: "8–14 days old", unit: 2 },
      { value: "15-30", label: "15–30 days old", unit: 1 },
    ],
    bonusTiers: [
      { minSpend: 3_000, pct: 25 },
      { minSpend: 2_000, pct: 20 },
      { minSpend: 1_000, pct: 10 },
    ],
  },
  {
    id: "aged_live_transfers",
    name: "Aged Live Transfers",
    channel: "aged",
    pricingModel: "age_band",
    unitLabel: "lead",
    qtyLabel: "How many leads?",
    blurb: "Full qualification detail from a prior live call — worked without the live handoff.",
    priceRange: "$3–$5 / lead",
    includes: "Full qual details from a prior live transfer (no live call).",
    ageBands: [
      { value: "30-59", label: "30–59 days old", unit: 5 },
      { value: "60-89", label: "60–89 days old", unit: 4 },
      { value: "90-120", label: "90–120 days old", unit: 3 },
    ],
  },
  {
    id: "realtime_leads",
    name: "Real-Time / Appointment Leads",
    channel: "realtime_transfer",
    pricingModel: "volume_tier",
    unitLabel: "lead",
    qtyLabel: "How many leads?",
    blurb: "Pre-qualified and delivered the instant they come in. Call within 5 minutes.",
    priceRange: "$10–$20 / lead",
    includes: "Pre-qualified lead delivered real-time (emailed on arrival).",
    tiers: [
      { label: "Standard", minQty: 1, maxQty: 24, unit: 20 },
      { label: "25+", minQty: 25, maxQty: 49, unit: 17.5 },
      { label: "50+", minQty: 50, maxQty: 99, unit: 15 },
      { label: "100+", minQty: 100, maxQty: null, unit: 10 },
    ],
  },
  {
    id: "live_transfers",
    name: "Live Transfers / Live Call Leads",
    channel: "live_transfer",
    pricingModel: "volume_tier",
    unitLabel: "transfer",
    qtyLabel: "How many live transfers?",
    blurb: "Qualified live, then the call is transferred straight to your closer. Highest intent.",
    priceRange: "$20–$40 / transfer",
    includes: "Live-qualified merchant with the call transferred to your closer.",
    tiers: [
      { label: "Standard", minQty: 1, maxQty: 24, unit: 40 },
      { label: "25+", minQty: 25, maxQty: 49, unit: 35 },
      { label: "50+", minQty: 50, maxQty: 99, unit: 30 },
      { label: "100+", minQty: 100, maxQty: 199, unit: 25 },
      { label: "200+", minQty: 200, maxQty: null, unit: 20 },
    ],
  },
  {
    id: "telemarketing",
    name: "Telemarketing Agents",
    channel: "other",
    pricingModel: "hourly",
    unitLabel: "hour",
    qtyLabel: "Hours per week",
    blurb: "Trained agents on a dialer working your leads — appointments, live transfers, email follow-up.",
    priceRange: "$12 / hour",
    includes: "Trained agents, dialer, aged leads, scripts, appointment setting, live transfers, email follow-up.",
    hourlyRate: 12,
    minHours: 25,
  },
];

export const SYNERGY_MIN_QUALIFICATIONS: string[] = [
  "500+ FICO",
  "6+ months in business",
  "$15K+ monthly revenue",
  "Active business bank account",
  "No bankruptcies, defaults, or judgments",
  "Seeking funding within 30 days",
];

export function getProduct(id: string): SynergyProduct | undefined {
  return SYNERGY_PRODUCTS.find((p) => p.id === id);
}

/** The volume tier whose [minQty, maxQty] range contains qty (or null). */
export function matchTier(product: SynergyProduct, qty: number): VolumeTier | null {
  if (!product.tiers || qty <= 0) return null;
  return product.tiers.find((t) => qty >= t.minQty && (t.maxQty == null || qty <= t.maxQty)) ?? null;
}

/** The best web-lead bonus for a given spend (highest threshold met), or null. */
export function webBonus(product: SynergyProduct, spend: number): BonusTier | null {
  if (!product.bonusTiers) return null;
  return product.bonusTiers.find((b) => spend >= b.minSpend) ?? null;
}

// ── The computed selection persisted on the campaign ─────────────────────────
export interface PricingSnapshot {
  product_id: string;
  product_name: string;
  channel: CampaignChannel;
  pricing_model: SynergyPricingModel;
  unit_price: number | null;
  unit_label: string;
  quantity: number | null;
  tier_label: string | null;
  age_band: string | null;
  hours_per_week: number | null;
  weeks: number | null;
  budget: number;
  bonus_pct: number | null;
  bonus_leads: number | null;
  math: string;
}

export interface PlanInput {
  productId: string;
  quantity?: number;      // volume_tier + age_band
  tierLabel?: string;     // volume_tier override
  ageBandValue?: string;  // age_band
  hoursPerWeek?: number;  // hourly
  weeks?: number;         // hourly
}

const fmtQty = (n: number) => n.toLocaleString();
const fmtUnit = (n: number) => (n < 1 ? `$${n.toFixed(2)}` : `$${n % 1 === 0 ? n : n.toFixed(2)}`);
const fmtMoney = (n: number) => `$${Math.round(n).toLocaleString()}`;

/**
 * Turn a wizard selection into the persisted snapshot + computed budget.
 * Never throws — returns budget 0 with an empty-ish snapshot when inputs are incomplete.
 */
export function computePlan(input: PlanInput): PricingSnapshot {
  const product = getProduct(input.productId);
  if (!product) {
    return {
      product_id: input.productId, product_name: input.productId, channel: "other",
      pricing_model: "volume_tier", unit_price: null, unit_label: "unit",
      quantity: null, tier_label: null, age_band: null, hours_per_week: null, weeks: null,
      budget: 0, bonus_pct: null, bonus_leads: null, math: "",
    };
  }

  const base = {
    product_id: product.id, product_name: product.name, channel: product.channel,
    pricing_model: product.pricingModel, unit_label: product.unitLabel,
  };

  if (product.pricingModel === "hourly") {
    const hpw = Math.max(input.hoursPerWeek ?? 0, 0);
    const weeks = Math.max(input.weeks ?? 0, 0);
    const rate = product.hourlyRate ?? 0;
    const budget = hpw * weeks * rate;
    return {
      ...base, unit_price: rate, quantity: hpw * weeks || null, tier_label: null,
      age_band: null, hours_per_week: hpw || null, weeks: weeks || null, budget,
      bonus_pct: null, bonus_leads: null,
      math: hpw && weeks ? `${hpw} hrs/wk × ${weeks} wks × ${fmtUnit(rate)}/hr = ${fmtMoney(budget)}` : "",
    };
  }

  if (product.pricingModel === "age_band") {
    const qty = Math.max(input.quantity ?? 0, 0);
    const band = product.ageBands?.find((b) => b.value === input.ageBandValue) ?? product.ageBands?.[0] ?? null;
    const unit = band?.unit ?? null;
    const budget = qty && unit != null ? qty * unit : 0;
    const bonus = product.bonusTiers ? webBonus(product, budget) : null;
    return {
      ...base, unit_price: unit, quantity: qty || null, tier_label: null,
      age_band: band?.value ?? null, hours_per_week: null, weeks: null, budget,
      bonus_pct: bonus?.pct ?? null,
      bonus_leads: bonus && qty ? Math.round(qty * (bonus.pct / 100)) : null,
      math: qty && unit != null
        ? `${fmtQty(qty)} × ${fmtUnit(unit)} = ${fmtMoney(budget)}${bonus ? ` · +${bonus.pct}% bonus` : ""}`
        : "",
    };
  }

  // volume_tier
  const qty = Math.max(input.quantity ?? 0, 0);
  const tier = input.tierLabel
    ? product.tiers?.find((t) => t.label === input.tierLabel) ?? matchTier(product, qty)
    : matchTier(product, qty);
  const unit = tier?.unit ?? null;
  const budget = qty && unit != null ? qty * unit : 0;
  return {
    ...base, unit_price: unit, quantity: qty || null, tier_label: tier?.label ?? null,
    age_band: null, hours_per_week: null, weeks: null, budget,
    bonus_pct: null, bonus_leads: null,
    math: qty && unit != null ? `${fmtQty(qty)} × ${fmtUnit(unit)} = ${fmtMoney(budget)}` : "",
  };
}

/** Month-Year suggestion, e.g. "Synergy — Live Transfers — Jul 2026". */
export function suggestCampaignName(partner: string, productId: string, startDate?: string): string {
  const product = getProduct(productId);
  const d = startDate ? new Date(startDate) : new Date();
  const when = d.toLocaleString("en-US", { month: "short", year: "numeric" });
  const p = partner.trim() || "Synergy";
  const shortPartner = p.split(/\s+/)[0]; // "Synergy Direct" → "Synergy"
  return `${shortPartner} — ${product?.name ?? "Campaign"} — ${when}`;
}
