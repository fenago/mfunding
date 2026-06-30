// Synergy Direct Solution — MFunding's primary lead partner. Full product catalog
// + pricing used by the Lead Partner page (catalog render + calculator).
// Source: Kyle (Synergy Direct Solution) pricing sheet, 2026-06-30. No minimum orders.

export const SYNERGY = {
  name: "Synergy Direct Solution LLC",
  contactName: "Kyle Readdick",
  email: "kreaddick@gmail.com",
  website: "www.SynergyDirectSolution.com",
  cell: "(619) 805-5452",
  office: "(866) 428-0172",
  fax: "(888) 372-6007",
  aiBotDemo: "(619) 393-2593",
  badges: ["BBB A+ rated", "No minimum orders", "Phone-verified & qualified", "Same-day start via DocuSign"],
  howToOrder:
    "Email Kyle the lead type + quantity. Invoice comes via DocuSign; pay by ACH / Zelle / wire / PayPal (no cards — chargeback policy). Can start the same business day.",
  // The shared qualification bar most products are screened against.
  baseQuals: [
    "500+ FICO (680+ for the premium tier)",
    "6+ months in business",
    "$15,000+ monthly revenue",
    "Business bank account",
    "No bankruptcies, defaults, or judgments",
    "Seeking funding within 30 days",
  ],
} as const;

export type PricingMode = "volume" | "age" | "hourly";
export type Tier = 1 | 2 | 3 | "service";

export interface VolumeBreak { min: number; price: number }
export interface AgeBreak { label: string; price: number }

export interface LeadProduct {
  id: string;
  name: string;
  tier: Tier;
  badge: string;
  unit: "lead" | "record" | "hour";
  pricing: PricingMode;
  exclusivity: string;
  delivery: string;
  signal: string; // what the lead/record tells you (the "why")
  description: string;
  volume?: VolumeBreak[]; // ascending min, descending price
  age?: AgeBreak[];
  hourly?: { rate: number; minHoursWeek: number; hoursPerTransfer: number };
  returnPolicy?: string;
  /** Default lead→funded rate assumption for the calculator (%). Editable by the user. */
  defaultFundRate: number;
  accent: string; // tailwind text color class for the card accent
}

// ── TIER 1 — premium, exclusive, phone-verified ──────────────────────────────
export const PRODUCTS: LeadProduct[] = [
  {
    id: "live-transfer",
    name: "Live Transfers",
    tier: 1,
    badge: "Exclusive · Phone-verified",
    unit: "lead",
    pricing: "volume",
    exclusivity: "Exclusive (yours only)",
    delivery: "Transferred to you live, on your schedule (you set the days/times).",
    signal: "Pre-qualified merchant on the phone right now, asking for funding.",
    description:
      "We pre-qualify the merchant today, connect the call to you in real time, then send the qualification details. Program your schedule so calls only come when you want them.",
    volume: [{ min: 1, price: 40 }, { min: 25, price: 35 }, { min: 50, price: 30 }, { min: 100, price: 25 }, { min: 200, price: 20 }],
    returnPolicy: "Replace any lead that fails the criteria — we review the recorded call.",
    defaultFundRate: 8,
    accent: "text-emerald-600",
  },
  {
    id: "live-transfer-680",
    name: "680+ Live Transfers",
    tier: 1,
    badge: "Premium credit · Exclusive",
    unit: "lead",
    pricing: "volume",
    exclusivity: "Exclusive (yours only)",
    delivery: "Live transfer on your schedule — every merchant has 680+ FICO.",
    signal: "Same as Live Transfers, but credit-screened to 680+.",
    description: "Identical to Live Transfers, but every merchant is 680 FICO or higher — best paper, higher approval odds.",
    volume: [{ min: 1, price: 50 }, { min: 25, price: 45 }, { min: 50, price: 40 }, { min: 100, price: 35 }],
    returnPolicy: "Replace any lead that fails the criteria — we review the recorded call.",
    defaultFundRate: 10,
    accent: "text-teal-600",
  },
  {
    id: "real-time",
    name: "Real-Time Leads",
    tier: 1,
    badge: "Exclusive · Real-time email",
    unit: "lead",
    pricing: "volume",
    exclusivity: "Exclusive (yours only)",
    delivery: "Emailed the instant we qualify them — you set a max per day.",
    signal: "Just-qualified merchant who asked for a call back.",
    description: "We pre-qualify the merchant in real time and email you the full detail immediately. You tell us your max leads/day.",
    volume: [{ min: 1, price: 20 }, { min: 25, price: 17.5 }, { min: 50, price: 15 }, { min: 100, price: 10 }],
    defaultFundRate: 5,
    accent: "text-blue-600",
  },
  {
    id: "appointment",
    name: "Appointment Leads",
    tier: 1,
    badge: "Exclusive · Next-day bulk",
    unit: "lead",
    pricing: "volume",
    exclusivity: "Exclusive (yours only)",
    delivery: "Same as real-time, but delivered the next business day (~10 AM) in one CSV.",
    signal: "Pre-qualified call-back merchant, batched for an organized morning.",
    description: "We pre-qualify the merchant today; you get all the detail the next business day in a single file — ideal for a structured dial session.",
    volume: [{ min: 1, price: 20 }, { min: 25, price: 17.5 }, { min: 50, price: 15 }, { min: 100, price: 10 }],
    returnPolicy: "Return any that miss the criteria — up to 25% of an order can be replaced.",
    defaultFundRate: 5,
    accent: "text-indigo-600",
  },

  // ── TIER 2 — aged / shared, much cheaper ───────────────────────────────────
  {
    id: "aged-live-transfer",
    name: "Aged Live Transfers",
    tier: 2,
    badge: "Aged 1–4 mo · Sold up to 3×",
    unit: "lead",
    pricing: "age",
    exclusivity: "Non-exclusive (sold up to 3×)",
    delivery: "All the live-transfer detail, just later — no live call.",
    signal: "Was a qualified live transfer 1–4 months ago.",
    description: "Everything we captured on a live transfer, delivered as data (no phone connect). Great cheap re-marketing of once-qualified merchants.",
    age: [{ label: "30–59 days", price: 5 }, { label: "60–89 days", price: 4 }, { label: "90–120 days", price: 3 }],
    defaultFundRate: 2,
    accent: "text-amber-600",
  },
  {
    id: "web",
    name: "Web Form Leads",
    tier: 2,
    badge: "Form fills · Bonus on spend",
    unit: "lead",
    pricing: "age",
    exclusivity: "Shared (not phone-verified)",
    delivery: "Sent daily at your requested daily rate.",
    signal: "Filled out a funding form (website, social, or email campaign).",
    description: "Self-reported merchants from web forms — includes requested amount, revenue, TIB, FICO, use of funds, existing loans. Not phone-verified.",
    age: [{ label: "1–7 days", price: 3 }, { label: "8–14 days", price: 2 }, { label: "15–30 days", price: 1 }],
    returnPolicy: "Bulk bonus: spend $1k → +10% leads · $2k → +20% · $3k → +25%.",
    defaultFundRate: 2,
    accent: "text-orange-600",
  },

  // ── TIER 3 — bulk data (pennies) ───────────────────────────────────────────
  {
    id: "ucc",
    name: "UCC Leads",
    tier: 3,
    badge: "Bulk data · Strong signal",
    unit: "record",
    pricing: "volume",
    exclusivity: "Bulk data",
    delivery: "CSV bulk file.",
    signal: "Took out a loan/advance recorded on the Secretary of State (it funded).",
    description: "Business owners with a UCC filing — i.e. they already took funding and it funded. 6–12 months old. Market via email / SMS / cold call.",
    volume: [{ min: 1, price: 0.05 }, { min: 50000, price: 0.03 }, { min: 100000, price: 0.02 }, { min: 250000, price: 0.01 }],
    defaultFundRate: 0.5,
    accent: "text-purple-600",
  },
  {
    id: "trigger",
    name: "Trigger Leads",
    tier: 3,
    badge: "Bulk data · Intent signal",
    unit: "record",
    pricing: "volume",
    exclusivity: "Bulk data",
    delivery: "CSV bulk file.",
    signal: "Had their credit pulled by a financial institution (they're shopping for money).",
    description: "Businesses whose credit was just pulled — a live intent signal. 6–12 months old. Best worked fast via dialer/SMS.",
    volume: [{ min: 1, price: 0.05 }, { min: 50000, price: 0.03 }, { min: 100000, price: 0.02 }, { min: 250000, price: 0.01 }],
    defaultFundRate: 0.4,
    accent: "text-fuchsia-600",
  },
  {
    id: "aged-data",
    name: "Aged Leads (data)",
    tier: 3,
    badge: "Bulk data · TCPA-scrubbed",
    unit: "record",
    pricing: "volume",
    exclusivity: "Bulk data",
    delivery: "CSV bulk file (company, contact, phone, validated email).",
    signal: "Prior funding-interested merchants — broad reach for email/SMS/cold call.",
    description: "6–12 months old, TCPA-scrubbed for known litigators, phones + emails validated. Cheapest volume for nurture campaigns.",
    volume: [{ min: 1, price: 0.05 }, { min: 50000, price: 0.03 }, { min: 100000, price: 0.02 }, { min: 250000, price: 0.01 }],
    defaultFundRate: 0.2,
    accent: "text-rose-600",
  },

  // ── SERVICE — telemarketing agents ─────────────────────────────────────────
  {
    id: "telemarketing",
    name: "Telemarketing Agents",
    tier: "service",
    badge: "Done-for-you dialing",
    unit: "hour",
    pricing: "hourly",
    exclusivity: "Your dedicated agent",
    delivery: "Agent transfers live, books appointments, or sends to your calendar/site.",
    signal: "Pre-trained agent works aged leads on your script (or theirs).",
    description: "Hire pre-trained telemarketers with a dialer + aged leads included. Roughly 1 live transfer every 2–3 hours of dialing.",
    hourly: { rate: 12, minHoursWeek: 25, hoursPerTransfer: 2.5 },
    defaultFundRate: 8,
    accent: "text-cyan-600",
  },
];

export const TIER_META: Record<string, { title: string; sub: string }> = {
  "1": { title: "Tier 1 — Premium & Exclusive", sub: "Phone-verified, qualified, yours only. Highest cost, highest conversion." },
  "2": { title: "Tier 2 — Aged & Shared", sub: "Once-qualified or self-reported. Cheap volume to nurture." },
  "3": { title: "Tier 3 — Bulk Data (pennies)", sub: "Signal-based lists for email / SMS / dialer at scale." },
  service: { title: "Done-for-you", sub: "Outsourced dialing on your script." },
};

/** Resolve the per-unit price for a volume-priced product at a given quantity. */
export function volumePrice(p: LeadProduct, qty: number): number {
  if (!p.volume) return 0;
  let price = p.volume[0].price;
  for (const b of p.volume) if (qty >= b.min) price = b.price;
  return price;
}
