// Funder Partnership Directory — research dataset for ISO/broker funder relationships.
// Compiled July 2026 from FunderIntel's ~200-funder direct-funder directory + web research
// (FireCrawl) for marketplaces, ISO/white-label programs, and low-revenue specialists.
//
// This is reference data for evaluating funder partnerships. It is intentionally NOT
// auto-written to the `lenders` table — the directory page offers a per-row "Add to
// lenders" action where the owner picks the status (Prospect / Applied / Live / etc.).

export type FunderCategory =
  | "marketplace" // apply-once → many funders (portal / aggregator)
  | "iso_whitelabel" // ISO / white-label / syndication partner program
  | "low_revenue" // low-revenue / bad-credit / subprime specialist
  | "mainstream" // prime/established direct funder
  | "platform" // embedded revenue-based (Shopify/Square/etc.) — not a broker channel
  | "direct"; // general direct MCA funder (from the FunderIntel directory)

export const CATEGORY_LABELS: Record<FunderCategory, string> = {
  marketplace: "Marketplace / Portal",
  iso_whitelabel: "ISO / White-Label",
  low_revenue: "Low-Revenue / Subprime",
  mainstream: "Mainstream Direct",
  platform: "Platform / Embedded",
  direct: "Direct Funder",
};

export interface Funder {
  name: string;
  category: FunderCategory;
  paper?: string; // paper-grade range, e.g. "A-C", "B-D", "C-D"
  lowRev: boolean; // accepts low-revenue / weak-credit files
  whiteLabel: boolean; // offers a white-label program
  applyOnce: boolean; // apply-once → many funders (marketplace/portal)
  isoProgram: boolean; // has an ISO / broker / partner program
  website?: string;
  applyUrl?: string; // broker / ISO / partner application URL
  phone?: string;
  criteria?: string; // min revenue / credit / TIB / deal size
  notes?: string;
  verified?: "active" | "dead" | "uncertain"; // liveness check (site reachable & real)
  inSystem?: boolean; // already exists in the lenders table
}

// Funders already in the MFunding lenders table (match by directory name) — flagged,
// not removed. Pulled from /admin/lenders, July 2026.
const IN_SYSTEM = new Set<string>([
  "mcashadvance", "Greenbox Capital", "Mantis Funding", "Pearl Capital", "Rapid Finance",
  "Mulligan Funding", "Fora Financial", "Credibly", "OnDeck", "Kapitus", "Biz2Credit",
  "Lendio", "FunderIntel", "Stafford Business Funding", "501 Advance", "Arcadia Servicing",
  "FAC Solutions", "True Advance Funding", "Viking Funding", "CapitaWize", "CFG Merchant Solutions",
  "Liquidibee", "Merchant Marketplace", "Reliance Financial", "Funding Circle", "CAN Capital",
  "Libertas", "National Funding", "Nexi Finance", "The LCF Group", "Reliant Funding",
  "InstaFunders", "Lendini",
]);

// Map a paper-grade string ("A-C", "B-D", "C-D", "A", …) to the lenders table's
// paper_types enum array. Used by the "Add to lenders" action.
export function paperToTypes(paper?: string): string[] {
  if (!paper) return [];
  const letters = paper.toUpperCase().match(/[ABCD]/g) ?? [];
  if (!letters.length) return [];
  const order = ["A", "B", "C", "D"];
  const start = order.indexOf(letters[0] as string);
  const end = order.indexOf(letters[letters.length - 1] as string);
  if (start < 0 || end < 0) return [];
  return order.slice(start, end + 1).map((l) => `${l.toLowerCase()}_paper`);
}

// ── Enriched priority funders (verified via web research) ────────────────────
const ENRICHED: Funder[] = [
  // Marketplaces / portals (apply once → many)
  { name: "Lendio", category: "marketplace", lowRev: false, whiteLabel: true, applyOnce: true, isoProgram: true, website: "https://www.lendio.com", applyUrl: "https://p.lendio.com/contact-partners", phone: "(855) 853-6346", criteria: "75+ lenders · ~$8–12K/mo · $1K–$10M · offers MCA + embedded 'Intelligent Lending' white-label" },
  { name: "Nav", category: "marketplace", lowRev: true, whiteLabel: false, applyOnce: true, isoProgram: true, website: "https://www.nav.com", applyUrl: "https://www.nav.com/partnerships/", criteria: "25+ lenders · soft pull · $500–$5M · also credit monitoring" },
  { name: "Fundera by NerdWallet", category: "marketplace", lowRev: false, whiteLabel: false, applyOnce: true, isoProgram: false, website: "https://www.fundera.com", phone: "(800) 386-3372", criteria: "Borrower marketplace · credit ~520+ · rev ~$50–250K/yr · up to $5M · no ISO program" },
  { name: "LendingTree Business", category: "marketplace", lowRev: false, whiteLabel: false, applyOnce: true, isoProgram: false, website: "https://www.lendingtree.com/business/", criteria: "Multi-lender matching marketplace" },
  { name: "BusinessLoans.com", category: "marketplace", lowRev: false, whiteLabel: false, applyOnce: true, isoProgram: false, website: "https://www.businessloans.com", criteria: "Lead-gen marketplace · matched to up to 5 partners · $10K–$3M · no public ISO program" },
  { name: "National Business Capital", category: "marketplace", lowRev: false, whiteLabel: false, applyOnce: true, isoProgram: true, website: "https://www.nationalbusinesscapital.com", applyUrl: "https://www.nationalbusinesscapital.com/partners/", phone: "631-614-5692", criteria: "75+ lender marketplace/brokerage · direct deals ~$250K–$15M" },
  { name: "Bridge", category: "marketplace", lowRev: false, whiteLabel: false, applyOnce: true, isoProgram: true, website: "https://www.bridgemarketplace.com", applyUrl: "https://www.bridgemarketplace.com/partner-inquiries", phone: "(914) 530-0721", criteria: "Vetted-lender AI marketplace built to beat lead-gen" },
  { name: "Biz2Credit", category: "marketplace", lowRev: false, whiteLabel: false, applyOnce: true, isoProgram: true, website: "https://www.biz2credit.com", applyUrl: "https://www.biz2credit.com/partners/affiliate-program", phone: "800-200-5678", paper: "A-C", criteria: "Marketplace (Itria = direct arm) · mostly term loans · ~$100K/yr min" },
  { name: "1 West", category: "marketplace", lowRev: true, whiteLabel: false, applyOnce: true, isoProgram: true, website: "https://www.1west.com", applyUrl: "https://www.1west.com/partner/", phone: "888-881-9378", criteria: "Network of 50+ lenders (ABLE engine) · partner portal + account exec · 5–7 day vetting" },
  { name: "Rainstar Capital Group", category: "marketplace", lowRev: true, whiteLabel: false, applyOnce: true, isoProgram: true, website: "https://www.rainstarcapitalgroup.com", applyUrl: "https://www.rainstarcapitalgroup.com/apply-now1", criteria: "Aggregator of 50+ MCA lenders · $5K–$4M · 450–500 credit · 6+ mo · ~$10K/mo · A–D paper" },
  { name: "Torro", category: "marketplace", paper: "B-D", lowRev: true, whiteLabel: false, applyOnce: true, isoProgram: true, website: "https://torro.com", applyUrl: "https://torro.com/partnership/iso/", phone: "1-866-858-2404", criteria: "Submits to marketplace of 25+ funders · funds startups · partner CRM provided" },
  { name: "FunderIntel", category: "marketplace", lowRev: false, whiteLabel: false, applyOnce: true, isoProgram: true, website: "https://www.funderintel.com", applyUrl: "https://www.funderintel.com/rbf-mca-funding-companies-list", phone: "(954) 861-0821", criteria: "Directory of 200+ direct funders + 'Request Intro' matching tool (the source of the list below)" },

  // ISO / white-label / syndication partner programs
  { name: "Pearl Capital", category: "iso_whitelabel", paper: "B-C", lowRev: false, whiteLabel: true, applyOnce: false, isoProgram: true, website: "https://pearlcapital.com", applyUrl: "https://pearlcapital.com/white-label/", phone: "1-800-888-9959", criteria: "Direct MCA funder for ISOs · turnkey white-label 'start your own MCA company' + syndication" },
  { name: "Symplifi Capital", category: "iso_whitelabel", lowRev: false, whiteLabel: true, applyOnce: false, isoProgram: true, website: "https://symplificapital.com", applyUrl: "https://symplificapital.com/isos/#formiso", phone: "888-339-0600", criteria: "Merchant: 1+ yr, $75K+/mo, 550+, up to $1M, 1st–4th position, up to 14 pts · white-label + syndication portal" },
  { name: "Logic Advance", category: "iso_whitelabel", lowRev: true, whiteLabel: false, applyOnce: false, isoProgram: true, website: "https://www.logicadvancegroup.com", applyUrl: "https://www.logicadvancegroup.com/for-partners", phone: "800-403-3170", criteria: "Direct funder for ISOs · 6+ mo, $25K+/mo, 500+ · Elite/Premium/Standard/High-Risk tiers · same-day" },
  { name: "Greenbox Capital", category: "iso_whitelabel", lowRev: true, whiteLabel: true, applyOnce: false, isoProgram: true, website: "https://www.greenboxcapital.com", applyUrl: "https://www.greenboxcapital.com/iso-application/", criteria: "Up to $250K · ISO commission up to 19% · US + Canada · high-risk OK · white-label contracts" },
  { name: "Fundomate", category: "iso_whitelabel", lowRev: true, whiteLabel: true, applyOnce: false, isoProgram: true, website: "https://fundomate.com", applyUrl: "https://fundomate.com/partners", phone: "310-734-5955", criteria: "Up to $500K+, terms to 18 mo · same-day · embedded/white-label funding via API + partner dashboard" },
  { name: "Onyx IQ", category: "iso_whitelabel", lowRev: false, whiteLabel: true, applyOnce: false, isoProgram: false, website: "https://onyxiq.com", applyUrl: "https://onyxiq.com/book-a-demo/", phone: "866-309-9710", criteria: "SOFTWARE (loan-management platform for MCA lenders) — not a funder · white-labeled ISO/syndicator portals" },

  // Low-revenue / bad-credit / subprime specialists
  { name: "Uplyft Capital", category: "low_revenue", lowRev: true, whiteLabel: false, applyOnce: false, isoProgram: true, website: "https://uplyftcapital.com", applyUrl: "https://daydreamos.com/broker-intake/uplyft-capital", phone: "1-800-515-7531", criteria: "Credit as low as 475 · $5K–$5M · 24-hr approvals · ISO broker intake (daydreamos); separate consumer affiliate pays $200–$600/funded deal" },
  { name: "Giggle Finance", category: "low_revenue", lowRev: true, whiteLabel: false, applyOnce: false, isoProgram: true, website: "https://gigglefinance.com", applyUrl: "https://gigglefinance.com/partnerships/#referral", criteria: "Gig/freelancer/startup specialist · up to $15K · NO min credit · accepts sole-props/1099s · instant" },
  { name: "Alpine Funding Partners", category: "low_revenue", lowRev: true, whiteLabel: false, applyOnce: false, isoProgram: false, website: "https://alpinefundings.com", phone: "877-993-8634", criteria: "$5,000/mo · 3 mo TIB · 500 credit · MCA/RBF/LOC/equipment · merchant-facing (no public ISO page)" },
  { name: "mcashadvance", category: "low_revenue", lowRev: true, whiteLabel: false, applyOnce: false, isoProgram: true, website: "https://www.mcashadvance.com", applyUrl: "https://www.mcashadvance.com/about-us/for-brokers/", phone: "855-433-8641", criteria: "$7,500+/mo CC sales · 3+ mo · $5K–$900K · no hard pull, low credit OK ($500M funding budget)" },
  { name: "Bitty Advance", category: "low_revenue", paper: "B-D", lowRev: true, whiteLabel: false, applyOnce: false, isoProgram: true, website: "https://bittyadvance.com", applyUrl: "https://broker.bittyadvance.com/signup", criteria: "Subprime micro-advances · $5,000/mo · 500+ credit · 6+ mo · ~24-hr funding" },
  { name: "Byzfunder", category: "low_revenue", paper: "B-C", lowRev: true, whiteLabel: false, applyOnce: false, isoProgram: true, website: "https://byzfunder.com", applyUrl: "https://byzfunder.com/partners", phone: "(888) 476-0755", criteria: "Sub-prime focus · $5K–$500K · 525+ credit · 12+ mo · same-day" },
  { name: "Forward Financing", category: "low_revenue", paper: "B-C", lowRev: true, whiteLabel: false, applyOnce: false, isoProgram: true, website: "https://www.forwardfinancing.com", applyUrl: "https://www.forwardfinancing.com/partner-with-us/", criteria: "Revenue-based financing · bad-credit friendly · flexible/low requirements" },
  { name: "Mantis Funding", category: "low_revenue", paper: "B-D", lowRev: true, whiteLabel: false, applyOnce: false, isoProgram: true, website: "https://mantisfunding.com", applyUrl: "https://mantisfunding.my.salesforce-sites.com/ISOAgreement", criteria: "Direct RBF funder · fast/flexible · subprime B–D paper" },
  { name: "Meged Funding", category: "low_revenue", paper: "B-D", lowRev: true, whiteLabel: false, applyOnce: false, isoProgram: true, website: "https://www.megedfunding.com", applyUrl: "https://www.megedfunding.com", phone: "1-888-966-3433", criteria: "Subprime direct funder · $5K–$5M · soft pull only · ~98% approval · same-day · ISO targets $250K–$2M/mo" },
  { name: "Velocity Capital Group", category: "low_revenue", paper: "B-D", lowRev: true, whiteLabel: false, applyOnce: false, isoProgram: true, website: "https://www.velocitycg.com", applyUrl: "https://www.velocitycg.com/iso-relations", criteria: "Direct MCA up to ~$1M · 1-hr approvals · same-day · works A–D paper · 3 mo statements + app" },
  { name: "Splash Advance", category: "low_revenue", lowRev: true, whiteLabel: false, applyOnce: false, isoProgram: true, website: "https://www.splashadvance.com", applyUrl: "https://www.splashadvance.com/#form", phone: "(888) 507-8006", criteria: "High-risk/subprime specialist (Boca Raton) · aggressive approvals · weekly-pay option · 2-hr approvals" },
  { name: "Revenued", category: "low_revenue", lowRev: true, whiteLabel: false, applyOnce: false, isoProgram: true, website: "https://www.revenued.com", applyUrl: "https://www.revenued.com/partner", criteria: "Business card + flex line · low-credit friendly · affiliate/referral program (not seeking ISO)" },
  { name: "Stafford Business Funding", category: "low_revenue", paper: "C-D", lowRev: true, whiteLabel: false, applyOnce: false, isoProgram: true, website: "https://staffordbusinessfunding.com", applyUrl: "https://form.jotform.com/243324991487063", phone: "732-858-3800", criteria: "Deep subprime direct funder · ~$7,500/mo · ~12 mo · deals up to ~$120K" },
  { name: "Cashable", category: "low_revenue", paper: "C-D", lowRev: true, whiteLabel: false, applyOnce: false, isoProgram: true, website: "https://cashablefund.com", applyUrl: "https://app.hellosign.com/s/1FurH9gt", phone: "929-531-9989", criteria: "High-risk direct funder · ~$25K/mo · $10K–$500K (site is cashablefund.com)" },
  { name: "Quikstone Capital", category: "low_revenue", paper: "C-D", lowRev: true, whiteLabel: false, applyOnce: false, isoProgram: true, website: "https://www.quikstonecapital.com", applyUrl: "https://www.quikstonecapital.com/your-funding-partner", phone: "1-866-456-5638", criteria: "CC-processing-based MCA 'silent funding partner' · agent/partner program" },
  { name: "Fund 4 Less", category: "low_revenue", paper: "C-D", lowRev: true, whiteLabel: false, applyOnce: false, isoProgram: false, criteria: "NY-based MCA direct funder (Fund4Less, LLC) — no public website / ISO program found" },

  // Mainstream / prime direct funders (many likely already in your queue)
  { name: "OnDeck", category: "mainstream", paper: "A-B", lowRev: false, whiteLabel: false, applyOnce: false, isoProgram: true, website: "https://www.ondeck.com", applyUrl: "https://www.ondeck.com/partner", phone: "(888) 269-4246", criteria: "Loans/lines up to $400K · Enterprise/Affiliate/Accountant partner programs" },
  { name: "Credibly", category: "mainstream", paper: "A-B", lowRev: false, whiteLabel: false, applyOnce: false, isoProgram: true, website: "https://www.credibly.com", applyUrl: "https://www.credibly.com/partner/funding-partner/", phone: "(844) 501-8662", criteria: "550+ credit · MCA $5K–$600K · working capital $25K–$600K · Broker + Referral programs" },
  { name: "Rapid Finance", category: "mainstream", paper: "A-C", lowRev: false, whiteLabel: false, applyOnce: false, isoProgram: true, website: "https://www.rapidfinance.com", applyUrl: "https://www.rapidfinance.com/partner-programs/business-finance-brokers/", phone: "(866) 978-3065", criteria: "Direct funder · up to $500K · full product suite" },
  { name: "Kapitus", category: "mainstream", paper: "A-C", lowRev: false, whiteLabel: false, applyOnce: false, isoProgram: true, website: "https://kapitus.com", applyUrl: "https://kapitus.com/partner/sales-partners/", phone: "(800) 780-7133", criteria: "ISO req: 1+ yr, $500K/mo production, secure site · ISO portal at iso.kapitus.com" },
  { name: "Mulligan Funding", category: "mainstream", paper: "A-C", lowRev: false, whiteLabel: false, applyOnce: false, isoProgram: true, website: "https://www.mulliganfunding.com", applyUrl: "https://www.mulliganfunding.com/partners/iso/", phone: "855-433-8617", criteria: "Working-capital funder (est. 2008) · ISO + affiliate programs" },
  { name: "Fora Financial", category: "mainstream", paper: "B-C", lowRev: false, whiteLabel: false, applyOnce: false, isoProgram: true, website: "https://www.forafinancial.com", applyUrl: "https://www.forafinancial.com/partner-with-us/#partnerform", phone: "1-877-885-1505", criteria: "Broker/ISO program · funding up to $1.5M" },

  // ── Web sweep (July 2026, FireCrawl-verified live) — new direct/ISO funders ──
  { name: "Expansion Capital Group", category: "mainstream", paper: "A-C", lowRev: false, whiteLabel: false, applyOnce: false, isoProgram: true, website: "https://www.ecg.com", applyUrl: "https://www.ecg.com/apply-for-funding", criteria: "Direct funder · $1.5B+ / 40,000+ businesses funded · 6+ mo TIB · consolidations · ~30-min decisions", verified: "active" },
  { name: "Elevate Funding", category: "iso_whitelabel", paper: "B-C", lowRev: false, whiteLabel: false, applyOnce: false, isoProgram: true, website: "https://elevatefunding.com", applyUrl: "https://elevatefunding.com/partners/", criteria: "Boutique revenue-based finance / MCA funder (10+ yrs) · dedicated ISO partners program", verified: "active" },
  { name: "IOU Financial", category: "mainstream", paper: "A-B", lowRev: false, whiteLabel: false, applyOnce: false, isoProgram: true, website: "https://ioufinancial.com", applyUrl: "https://ioufinancial.com/advantages-of-becoming-an-iou-partner/", criteria: "Direct small-business lender · separate ISO-partner + referral tracks · partner portal", verified: "active" },
  { name: "BriteCap Financial", category: "mainstream", paper: "A-B", lowRev: false, whiteLabel: false, applyOnce: false, isoProgram: true, website: "https://britecap.com", applyUrl: "https://britecap.com/partners", criteria: "Formerly ForwardLine · backed by North Mill · 20+ yrs, $1B+ / 20,000+ loans · Concierge (referral) + Originator (portal) tracks · SOC 2 Type II", verified: "active" },
  { name: "Headway Capital", category: "mainstream", paper: "A-B", lowRev: false, whiteLabel: false, applyOnce: false, isoProgram: true, website: "https://headwaycapital.com", applyUrl: "https://headwaycapital.com/partners", criteria: "Business line-of-credit provider (Enova/Elevate family) · dedicated partners program", verified: "active" },
  { name: "PIRS Capital", category: "iso_whitelabel", paper: "B-C", lowRev: true, whiteLabel: false, applyOnce: false, isoProgram: true, website: "https://pirscapital.com", applyUrl: "https://pirscapital.com/partner-with-us-business-financing/", criteria: "Direct MCA funder · PIRScore underwriting · partner portal w/ submission + underwriter access · multiple positions", verified: "active" },
  { name: "Kalamata Capital Group", category: "iso_whitelabel", paper: "A-C", lowRev: false, whiteLabel: false, applyOnce: false, isoProgram: true, website: "https://www.kalamatacapitalgroup.com", applyUrl: "https://www.kalamatacapitalgroup.com", criteria: "'Preferred ISO-driven MCA' funder · Bethesda/NYC/Miami · funding in ~15 min · multiple positions", verified: "active" },
  { name: "Wide Merchant Group", category: "direct", paper: "B-C", lowRev: true, whiteLabel: false, applyOnce: false, isoProgram: true, website: "https://www.widemerchantgroup.com", applyUrl: "https://www.widemerchantgroup.com/advantage-program/apply-now", criteria: "Private MCA lender since 2005 · up to ~$100K · daily/weekly/CC-split/consolidation · funds 24-72 hrs", verified: "active" },
  { name: "Cardiff", category: "direct", paper: "A-C", lowRev: false, whiteLabel: false, applyOnce: false, isoProgram: true, website: "https://cardiff.co", applyUrl: "https://cardiff.co/partners/", criteria: "MCA + working capital / equipment / asset-based · same-day approvals · dedicated partner program", verified: "active" },
  { name: "Fundfi Merchant Funding", category: "low_revenue", paper: "B-C", lowRev: true, whiteLabel: false, applyOnce: false, isoProgram: true, website: "https://www.fundfimerchantfunding.com", criteria: "NY-based direct MCA funder · ISO-partnership program promoted on site (deep ISO URL 404s)", verified: "active" },
  { name: "Diesel Funding", category: "iso_whitelabel", paper: "B-C", lowRev: true, whiteLabel: false, applyOnce: false, isoProgram: true, website: "https://www.dieselfunding.com", applyUrl: "https://www.dieselfunding.com/partner", criteria: "Direct MCA funder · B+ paper · deals $5K–$3M · all 50 states · same-day ISO commission", verified: "active" },
  { name: "Newity", category: "mainstream", paper: "A-B", lowRev: false, whiteLabel: false, applyOnce: false, isoProgram: true, website: "https://newitymarket.com", criteria: "SBA 7(a) working-capital lender service provider (for Northeast Bank) · broker/referral partner program — SBA, not MCA", verified: "active" },
  { name: "BHG Financial", category: "mainstream", paper: "A", lowRev: false, whiteLabel: false, applyOnce: false, isoProgram: false, website: "https://bhgfinancial.com", criteria: "Large direct lender (professional/business installment loans) · bank + referral partner model — NOT a classic MCA ISO funder (lower fit)", verified: "active" },
];

// ── FunderIntel direct-funder directory (name, paper grade, profile slug) ─────
// Basic rows — link out to the FunderIntel profile ("Request Intro") for full details.
// Enriched duplicates above are omitted. lowRev inferred from paper reaching D.
const DIRECTORY: [string, string, string][] = [
  ["501 Advance", "A-C", "501-advance"], ["FAC Solutions", "B-C", "fac-solutions"], ["True Advance Funding", "B-D", "true-advance-funding"], ["Viking Funding", "B-D", "viking-funding"], ["Vox Funding", "A-C", "vox-funding"], ["Accord Business Funding", "B-C", "accord-business-funding"], ["BIG (Blackbridge Investment Group)", "B-C", "big-(blackbridge-investment-group)"], ["CFG Merchant Solutions", "B-C", "cfg-merchant-solutions"], ["CapitaWize", "B-D", "capitawize"], ["Capital Domain", "A-C", "capital-domain"], ["Everest Business Funding", "A-C", "everest-business-funding"], ["Lendini", "B-D", "lendini"], ["Liquidibee", "B-D", "liquidibee"], ["Spartan Capital", "A-D", "spartan-capital"], ["Thoro Corp", "B-D", "thoro-corp"], ["1st Alliance Group LLC", "B-C", "1st-alliance-group-llc"], ["Advantage Merchant Funding", "B-C", "advantage-merchant-funding"], ["Alfa Advance Funding", "B-C", "alfa-advance-funding"], ["Alternative Funding Group", "B-D", "alternative-funding-group"], ["Alva Advance", "B-D", "alva-advance"], ["Aquina Health", "A-C", "aquina-health"], ["Arcadia Servicing", "B-D", "arcadia-funding"], ["Arcarius", "B-C", "arcarius"], ["Aspire Funding", "B-C", "aspire-funding"], ["Avanza Capital", "B-D", "avanza-capital"], ["BHG Financial", "A-C", "bhg-financial"], ["Backd Business Funding", "A", "backd-business-funding-"], ["Belltower Funding", "B-C", "belltower-funding"], ["Birkin Capital", "B-D", "birkin-capital"], ["Blade Funding", "B-D", "blade-funding"], ["Bluebridge Funding", "B-C", "bluebridge-funding"], ["Boom Funded", "A-B", "boom-funded"], ["Bridgecap Financial LLC", "B-C", "bridgecap-financial-llc--"], ["BriteCap Financial", "A-B", "britecap-financial"], ["Business Capital Providers", "A-C", "business-capital-providers"], ["CAN Capital", "A-B", "can-capital"], ["Cap Fund Now", "B-C", "cap-fund-now"], ["Capitalize Group", "B-C", "capitalize-group"], ["Capybara Capital", "A-B", "capybara-capital"], ["Capytal", "C-D", "capytal"], ["Cashium Capital", "C-D", "cashium-capital"], ["Cedar Advance", "A", "cedar-advance"], ["Central Diligence Group", "B-C", "central-diligence-group"], ["Channel Partners Capital", "B-C", "channel-partners-capital"], ["Cityview Funding", "B-C", "cityview-funding"], ["Clarity Advance", "B-D", "clarity-advance"], ["Clearfund Solutions", "B-D", "clearfund-solutions"], ["Coolidge Capital", "C-D", "coolidge-capital-"], ["Delancey Street Lending Inc", "B-D", "delancey-street-lending-inc"], ["Elevate Funding", "A-C", "elevate-funding"], ["Eminent Funding", "B-C", "eminent-funding"], ["Equita Advance", "B-C", "equita-advance"], ["Essential Funding", "B-D", "essential-funding"], ["Expansion Capital Group", "B-C", "expansion-capital-group"], ["Family Business Fund", "A-C", "family-business-fund"], ["Finova Capital", "A-C", "finova-capital"], ["Fintap", "B-D", "fintap"], ["Fintech Capital Group", "B-D", "fintech-capital-group"], ["Fintegra", "A-B", "fintegra"], ["Flagler Advance", "B-D", "flagler-advanc"], ["Forward Line", "B-D", "forward-line"], ["Fox Business Funding", "B-C", "fox-business-funding"], ["Fratello Capital", "B-D", "fratello-capital"], ["Fresh Funding", "B-C", "fresh-funding"], ["FundPro LLC", "B-D", "fundpro-llc"], ["Fundfi Merchant Funding", "B-C", "fundfi-merchant-funding"], ["Funding Circle", "A-B", "funding-circle"], ["Fundkite", "A-B", "fundkite"], ["Fundr", "B-C", "fundr"], ["Fundx", "B-C", "fundx"], ["Fusion Funding", "B-C", "fusion-funding"], ["G and G Funding", "B-D", "g-and-g-funding-"], ["GRP Funding", "B-C", "grp-funding"], ["Garden Funding", "B-C", "garden-funding-"], ["Good Funding", "B-C", "good-funding"], ["Granite Merchant Funding", "A", "granite-merchant-funding"], ["Green Buck Capital", "B-C", "green-buck-capital"], ["Hunter Caroline", "B-C", "hunter-caroline"], ["Infusion Capital Group", "B-D", "infusion-capital-group"], ["InstaFund Advance", "B-C", "instafund-advance"], ["InstaFunders", "C-D", "instafunders"], ["Ironwood Finance", "B-C", "ironwood-finance"], ["JRG Funding", "B-C", "jrg-funding"], ["Jett Capital", "C-D", "jett-capital"], ["Kalamata Capital Group", "A-C", "kalamata-capital-group"], ["Legend Funding", "B-C", "legend-advance-funding"], ["LendSpark", "A-B", "lendspark"], ["Lendbug", "B-C", "lendbug"], ["Lending Valley", "B-C", "lending-valley"], ["Lendora", "B-D", "lendora"], ["Lendr", "A-B", "lendr"], ["Lexio Capital", "B-C", "lexio-capital"], ["Libertas", "B-C", "libertas"], ["Lifetime Funding", "B-D", "lifetime-funding"], ["Luca", "B-C", "luca"], ["Main Street Cash", "B-D", "main-street-cash"], ["Masada Funding", "B-C", "masada-funding"], ["Merchant Cash Group", "B-D", "merchant-cash-group"], ["Merchant Marketplace", "B-D", "merchant-marketplace"], ["Merit Business Funding", "B-C", "merit-business-funding"], ["Mint Funding", "B-D", "mint-funding"], ["Monera Capital Group", "A-C", "monera-capital-group"], ["National Funding", "A-B", "national-funding"], ["Newco Capital Group", "B-C", "newco-capital-group"], ["Nexi Finance", "A-C", "nexi-finance"], ["Novo Funding", "B-C", "novo-funding"], ["ONNX Funding", "B-D", "onnx-funding"], ["Octane Financing", "C-D", "octane-financing"], ["Olympus Lending", "B-D", "olympus-lending-"], ["OnTap Capital", "A-C", "ontap-capital"], ["Overnight-Capital LLC", "A-D", "overnight-capital-llc"], ["PIRS Capital", "B-C", "pirs-capital"], ["Parkview Advance", "B-D", "parkview-advance"], ["Paypal Capital", "A-B", "paypal-capital"], ["Paz Funding Source", "B-C", "paz-funding-source"], ["Premier Capital Funding", "B-D", "premier-capital-funding"], ["QFS Capital", "C-D", "qfs-capital"], ["Quicksilver Capital", "B-C", "quicksilver-capital"], ["RBS Funding", "B-C", "rbs-funding"], ["Reliable Funding", "B-D", "reliable-funding"], ["Reliance Financial", "B-C", "reliance-financial"], ["Reliant Funding", "B-C", "reliant-funding"], ["River Advance", "B-D", "river-advance"], ["Riverstrong Capital", "C-D", "riverstrong-capital"], ["Rowan Advance", "B-D", "rowan-advance"], ["SBL Funding", "C-D", "sbl-funding"], ["SG Credit Partners", "A-B", "sg-credit-partners"], ["SPIER Capital", "B-C", "spier-capital-"], ["Samson Funding", "B-D", "samson-funding"], ["Secure Funding Source", "B-D", "secure-funding-source"], ["Select Funding", "A-C", "select-funding"], ["Shopify Capital", "A-B", "shopify-capital"], ["Silverline Capital Group", "B-C", "silverline-capital-group"], ["Simply Funding", "A-C", "simply-funding"], ["Slim Capital", "B-C", "slim-capital"], ["Smart Business Funding", "A-D", "smart-business-funding"], ["Specialty Capital", "B-D", "specialty-capital"], ["Splash Advance (FI)", "B-D", "splash-advance"], ["Square Capital", "A-B", "square-capital"], ["Strategic Capital", "A-C", "strategic-capital-"], ["Stripe Capital", "A-B", "stripe-capital"], ["Superior Capital", "C-D", "superior-capital"], ["Sutton Funding", "B-C", "sutton-funding"], ["Swift Funding Source", "B-C", "swift-funding-source"], ["Swiss Fund", "C-D", "swiss-fund"], ["TMR Now", "A-D", "tmr-now"], ["The Fundworks", "B-D", "the-fundworks"], ["The LCF Group", "A-C", "the-lcf-group"], ["The Smarter Merchant", "B-C", "the-smarter-merchant"], ["Thor Capital Group", "B-C", "thor-capital-group"], ["Trustify Advance", "B-D", "trustify-advance"], ["Union Funding Source", "B-C", "union-funding-source"], ["Unique Funding Solutions", "B-D", "unique-funding-solutions"], ["United Business Funding", "C-D", "united-business-funding"], ["United First", "C-D", "gfe"], ["Uptown Fund", "C-D", "uptown-fund"], ["Vader Mountain Capital", "C-D", "vader-mountain-capital"], ["Vital Cap Fund", "B-C", "vital-cap-fund"], ["WallStreet Funding", "B-D", "wall-street-funding"], ["Waterview Capital", "B-D", "waterview-capital"], ["Wayflyer", "A-B", "wayflyer"], ["WeFund", "B-D", "wefund"], ["Wellen", "A-B", "wellen"], ["Westwood Funding", "B-C", "westwood-funding"], ["Windgate Capital", "A-C", "windgate-capital"], ["Wynwood Capital", "B-D", "wynwood-capital"], ];

// Platform/embedded funders that are NOT broker channels (flagged so they filter out).
const PLATFORM = new Set(["Backd Business Funding", "Shopify Capital", "Square Capital", "Stripe Capital", "Paypal Capital", "Wayflyer", "Wellen", "Funding Circle"]);

// Liveness verification (FireCrawl audit, July 2026): is there a real, reachable
// official site? status "active" = live real funder · "dead" = no site / parked /
// 404 / defunct · "uncertain" = ambiguous. website/phone/apply filled where found.
type Verify = { status: "active" | "dead" | "uncertain"; website?: string; phone?: string; applyUrl?: string; note?: string };
const VERIFY: Record<string, Verify> = {
  "501 Advance": { status: "active", website: "https://www.501advance.com" },
  "FAC Solutions": { status: "active", website: "https://facsolutions.biz" },
  "True Advance Funding": { status: "active", website: "https://trueadvance.biz", phone: "551-341-0901" },
  "Viking Funding": { status: "active", website: "https://vikingfunding.com" },
  "Vox Funding": { status: "active", website: "https://www.voxfunding.com" },
  "Accord Business Funding": { status: "active", website: "https://accordbf.com" },
  "BIG (Blackbridge Investment Group)": { status: "active", website: "https://www.bbigm.com" },
  "CFG Merchant Solutions": { status: "active", website: "https://cfgmerchantsolutions.com", applyUrl: "https://cfgmerchantsolutions.com/partnerships-v2/" },
  "CapitaWize": { status: "active", website: "https://www.capitawize.com" },
  "Capital Domain": { status: "active", website: "https://capitaldomain.com" },
  "Everest Business Funding": { status: "active", website: "https://everestbusinessfunding.com", phone: "888-342-5709" },
  "Lendini": { status: "active", website: "https://www.lendini.com", phone: "844-700-5363" },
  "Liquidibee": { status: "active", website: "https://www.liquidibee.com" },
  "Spartan Capital": { status: "active", website: "https://www.spartancapitalgroup.com" },
  "Thoro Corp": { status: "active", website: "https://www.thorocorp.com" },
  "1st Alliance Group LLC": { status: "active", website: "https://1stalliancegrp.com", phone: "305-394-6178" },
  "Advantage Merchant Funding": { status: "active", website: "https://advantagemerchantfunding.com" },
  "Alfa Advance Funding": { status: "uncertain", phone: "305-638-0049", note: "Real (2026 litigation) but old domain taken over by an unrelated site — no live funder site" },
  "Alternative Funding Group": { status: "active", website: "https://www.altfunding.com", phone: "888-258-6279" },
  "Alva Advance": { status: "uncertain", note: "Real (2024–25 MCA cases) but no live/verifiable official website" },
  "Aquina Health": { status: "active", website: "https://aquinahealth.com", note: "Healthcare finance (patient/working capital), not general MCA" },
  "Arcadia Servicing": { status: "active", website: "https://www.arcadiaservicing.com" },
  "Arcarius": { status: "active", website: "https://arcariusfunding.com" },
  "Aspire Funding": { status: "active", website: "https://www.aspirefundingplatform.com" },
  "Avanza Capital": { status: "active", website: "https://avanzacapitalllc.com" },
  "BHG Financial": { status: "active", website: "https://bhgfinancial.com", note: "Term loans $20K–$500K, not MCA" },
  "Backd Business Funding": { status: "active", website: "https://www.backd.com" },
  "Belltower Funding": { status: "active", website: "https://belltowerfunding.com", phone: "929-525-2565" },
  "Birkin Capital": { status: "active", website: "https://birkincap.com" },
  "Blade Funding": { status: "active", website: "https://www.bladefunding.com" },
  "Bluebridge Funding": { status: "active", website: "https://bluebridge-funding.com", phone: "(888) 738-3174" },
  "Boom Funded": { status: "active", website: "https://boomfunded.com", phone: "1-888-480-2666", applyUrl: "https://boomfunded.com/apply/", note: "Wholesale MCA funder, ISO-only" },
  "Bridgecap Financial LLC": { status: "active", website: "https://www.bridgecapfinancial.com", phone: "(855) 648-5914" },
  "BriteCap Financial": { status: "active", website: "https://www.britecap.com" },
  "Business Capital Providers": { status: "active", website: "https://bcproviders.com", phone: "888-255-1819" },
  "CAN Capital": { status: "active", website: "https://www.cancapital.com" },
  "Cap Fund Now": { status: "active", website: "https://capfundnow.com", phone: "1-888-222-6979", applyUrl: "https://capfundnow.com/mass/auth/registration", note: "Actually a marketplace/aggregator for ISOs, not a direct funder" },
  "Capitalize Group": { status: "uncertain", website: "https://www.capitalizeinc.com", note: "'Coming Soon' placeholder; separate MCA LLC has no located site" },
  "Capybara Capital": { status: "active", website: "https://capybarausa.com", phone: "561-404-1674" },
  "Capytal": { status: "active", website: "https://www.capytal.com" },
  "Cashium Capital": { status: "active", website: "https://cashium.com", phone: "(718) 914-7526", applyUrl: "https://cashium.com/partners/" },
  "Cedar Advance": { status: "active", website: "https://cedaradvance.com", phone: "786-605-8900", applyUrl: "https://cedaradvance.com/iso-affiliates.php" },
  "Central Diligence Group": { status: "active", website: "https://www.centraldiligencegroup.com", phone: "1-877-961-4403" },
  "Channel Partners Capital": { status: "active", website: "https://www.channelpartnerscapital.com", note: "Wholesale/partner model — does NOT lend direct to merchants" },
  "Cityview Funding": { status: "active", website: "https://cityviewfunding.com", phone: "718-540-7173" },
  "Clarity Advance": { status: "active", website: "https://clarity-advance.com", phone: "(786) 565-5134" },
  "Clearfund Solutions": { status: "uncertain", note: "Real funder but site has broken SSL — inaccessible" },
  "Coolidge Capital": { status: "active", website: "https://www.coolidgecapital.com", phone: "516-667-6817" },
  "Delancey Street Lending Inc": { status: "active", website: "https://www.delanceystreet.com", note: "Now operates as debt-relief/settlement, not MCA lending" },
  "Elevate Funding": { status: "active", website: "https://elevatefunding.com", phone: "(888) 382-3945" },
  "Eminent Funding": { status: "active", website: "https://www.eminentfunding.com" },
  "Equita Advance": { status: "active", website: "https://www.equitaadvance.com", phone: "(786) 684-0866", applyUrl: "https://www.equitaadvance.com/partner-page" },
  "Essential Funding": { status: "active", website: "https://myessentialfunding.com" },
  "Expansion Capital Group": { status: "active", website: "https://www.ecg.com", applyUrl: "https://www.ecg.com/submission" },
  "Family Business Fund": { status: "active", website: "https://familybusinessfund.com" },
  "Finova Capital": { status: "active", website: "https://finovacapital.com" },
  "Fintap": { status: "active", website: "https://www.fintap.com" },
  "Fintech Capital Group": { status: "active", website: "https://fintechcapitalgroup.com" },
  "Fintegra": { status: "active", website: "https://getfintegra.com" },
  "Flagler Advance": { status: "active", website: "https://www.flagleradvance.com" },
  "Forward Line": { status: "active", website: "https://www.forwardline.com" },
  "Fox Business Funding": { status: "active", website: "https://foxbusinessfunding.com" },
  "Fratello Capital": { status: "active", website: "https://www.fratellocapital.com" },
  "Fresh Funding": { status: "active", website: "https://gofreshfunding.com" },
  "FundPro LLC": { status: "active", website: "https://fundprollc.com", phone: "(872) 260-5741" },
  "Fundfi Merchant Funding": { status: "active", website: "https://www.fundfimerchantfunding.com", phone: "(929) 277-0182" },
  "Funding Circle": { status: "active", website: "https://www.fundingcircle.com", note: "UK-focused; US direct lending wound down" },
  "Fundkite": { status: "active", website: "https://fundkite.com" },
  "Fundr": { status: "active", website: "https://1fundr.com" },
  "Fundx": { status: "active", website: "https://www.fundxfinancial.com" },
  "Fusion Funding": { status: "active", website: "https://fusion-funding.com" },
  "G and G Funding": { status: "active", website: "https://gandgfunding.com", phone: "(866) 246-3520" },
  "GRP Funding": { status: "active", website: "https://www.grpfunding.com" },
  "Garden Funding": { status: "active", website: "https://www.gardenfunding.com" },
  "Good Funding": { status: "active", website: "https://www.goodfunding.com" },
  "Granite Merchant Funding": { status: "active", website: "https://granitefunding.com" },
  "Green Buck Capital": { status: "active", website: "https://www.greenbuckcapital.com" },
  "Hunter Caroline": { status: "active", website: "https://huntercaroline.com" },
  "Infusion Capital Group": { status: "active", website: "https://infusioncapital.org" },
  "InstaFund Advance": { status: "active", website: "https://instafundadvance.com", applyUrl: "https://instafundadvance.com/apply-now/" },
  "InstaFunders": { status: "active", website: "https://www.instafunders.com" },
  "Ironwood Finance": { status: "active", website: "https://ironwoodfinance.com" },
  "JRG Funding": { status: "active", website: "https://jrgfunding.com", phone: "(800) 207-2580" },
  "Jett Capital": { status: "uncertain", note: "Only match is an unrelated capital-markets advisory firm, not an MCA funder" },
  "Kalamata Capital Group": { status: "active", website: "https://www.kalamatacapitalgroup.com" },
  "Legend Funding": { status: "active", website: "https://legendadvancefunding.com", applyUrl: "https://legendadvancefunding.com/iso-partners/" },
  "LendSpark": { status: "active", website: "https://lendspark.com", phone: "888-444-7069" },
  "Lendbug": { status: "active", website: "https://www.lendbug.com" },
  "Lending Valley": { status: "active", website: "https://www.lendingvalley.com" },
  "Lendora": { status: "active", website: "https://lendora.com", phone: "855-536-3672" },
  "Lendr": { status: "active", website: "https://lendr.online" },
  "Lexio Capital": { status: "active", website: "https://lexiocapital.com", phone: "(954) 539-4646" },
  "Libertas": { status: "active", website: "https://libertasfunding.com" },
  "Lifetime Funding": { status: "active", website: "https://lifetimefundingllc.com" },
  "Luca": { status: "uncertain", note: "No real MCA funder named 'Luca' found (only an unrelated AI finance assistant)" },
  "Main Street Cash": { status: "active", website: "https://www.mainstreetcash.com" },
  "Masada Funding": { status: "uncertain", note: "Real (2024 cases) but masadafunding.com DNS fails — no live site" },
  "Merchant Cash Group": { status: "active", website: "https://www.merchantcashgroup.com" },
  "Merchant Marketplace": { status: "active", website: "https://merchantmarketplace.com" },
  "Merit Business Funding": { status: "active", website: "https://www.meritbusinessfunding.com" },
  "Mint Funding": { status: "active", website: "https://mintfunding.com" },
  "Monera Capital Group": { status: "active", website: "https://moneracapital.com" },
  "National Funding": { status: "active", website: "https://www.nationalfunding.com" },
  "Newco Capital Group": { status: "active", website: "https://newcocapitalgroup.com" },
  "Nexi Finance": { status: "active", website: "https://gonexi.com", phone: "888-364-2070" },
  "Novo Funding": { status: "active", website: "https://www.novo.co/business-funding", note: "Mainly for existing Novo customers" },
  "ONNX Funding": { status: "active", website: "https://onnxfunding.com", applyUrl: "https://onnxfunding.com/partner-with-us" },
  "Octane Financing": { status: "uncertain", note: "octane.co is a consumer powersports lender, not an MCA funder" },
  "Olympus Lending": { status: "active", website: "https://www.olympusbusinesscapital.com" },
  "OnTap Capital": { status: "active", website: "https://www.ontapcap.com", phone: "(929) 202-7331" },
  "Overnight-Capital LLC": { status: "active", website: "https://overnight-capital.com" },
  "PIRS Capital": { status: "active", website: "https://pirscapital.com" },
  "Parkview Advance": { status: "active", website: "https://parkviewadvance.com", phone: "(203) 675-0071", applyUrl: "https://parkviewadvance.com/applications/" },
  "Paypal Capital": { status: "active", website: "https://www.paypal.com/us/business/financial-services/working-capital-loan", note: "Platform-embedded (PayPal Working Capital) — not ISO-facing" },
  "Paz Funding Source": { status: "active", website: "https://pazfundingsource.com" },
  "Premier Capital Funding": { status: "active", website: "https://premierecapitalfunding.com", applyUrl: "https://premierecapitalfunding.com/what-we-do/", note: "Domain spelled 'premiere'" },
  "QFS Capital": { status: "active", website: "https://www.qfscapital.com" },
  "Quicksilver Capital": { status: "active", website: "https://www.quicksilvercap.com" },
  "RBS Funding": { status: "active", website: "https://rbsfunding.com", phone: "(631) 251-8212" },
  "Reliable Funding": { status: "uncertain", note: "Closest match's domain is parked/for-sale" },
  "Reliance Financial": { status: "active", website: "https://reliancef.com" },
  "Reliant Funding": { status: "active", website: "https://www.reliantfunding.com", phone: "(877) 850-0998" },
  "River Advance": { status: "active", website: "https://riveradvance.com" },
  "Riverstrong Capital": { status: "active", website: "https://www.rivercapholding.com", note: "Pivoted to real-estate hard-money — no longer MCA" },
  "Rowan Advance": { status: "active", website: "https://www.rowanadvance.com" },
  "SBL Funding": { status: "uncertain", note: "No official website or company record surfaced — unverifiable" },
  "SG Credit Partners": { status: "active", website: "https://www.sgcreditpartners.com", note: "Situational/tailored credit, not a standard MCA shop" },
  "SPIER Capital": { status: "active", website: "https://www.spiercapital.com", phone: "(917) 933-2105" },
  "Samson Funding": { status: "active", website: "https://www.samsonfunding.com", phone: "(347) 442-7999" },
  "Secure Funding Source": { status: "active", website: "https://www.securefundingsource.com", phone: "(800) 609-4052" },
  "Select Funding": { status: "active", website: "https://www.selectfunding.com" },
  "Shopify Capital": { status: "active", website: "https://www.shopify.com/capital", note: "Platform-embedded — not ISO-facing" },
  "Silverline Capital Group": { status: "active", website: "https://www.silverlinecapitalllc.com" },
  "Simply Funding": { status: "active", website: "https://simplyfunding.com" },
  "Slim Capital": { status: "active", website: "https://www.slimcapital.com" },
  "Smart Business Funding": { status: "active", website: "https://www.smartbusinessfunder.com", phone: "(866) 737-6278", note: "Domain 'smartbusinessfunder.com'" },
  "Specialty Capital": { status: "active", website: "https://www.specialtycapital.com", phone: "(212) 369-5060" },
  "Splash Advance (FI)": { status: "active", website: "https://www.splashadvance.com", note: "Duplicate of Splash Advance (enriched above)" },
  "Square Capital": { status: "active", website: "https://squareup.com/us/en/banking/loans", note: "Platform-embedded (Square Loans) — not ISO-facing" },
  "Strategic Capital": { status: "uncertain", note: "No single authoritative site — multiple unrelated entities" },
  "Stripe Capital": { status: "active", website: "https://stripe.com/capital", note: "Platform-embedded — not ISO-facing" },
  "Superior Capital": { status: "active", website: "https://superiorcapitalfund.com" },
  "Sutton Funding": { status: "active", website: "https://www.suttonfunding.com" },
  "Swift Funding Source": { status: "active", website: "https://swiftfundingsource.com" },
  "Swiss Fund": { status: "uncertain", note: "Real (2024/2026 litigation) but no public website found" },
  "TMR Now": { status: "active", website: "https://tmrnow.com", note: "Division of Total Merchant Resources — wholesale to ISOs since 2008" },
  "The Fundworks": { status: "active", website: "https://thefundworks.com", applyUrl: "https://thefundworks.com/application/" },
  "The LCF Group": { status: "active", website: "https://www.thelcfgroup.com" },
  "The Smarter Merchant": { status: "active", website: "https://www.thesmartermerchant.com" },
  "Thor Capital Group": { status: "uncertain", website: "https://thorcapitalgroup.com", phone: "888-445-1028", applyUrl: "https://thorcapitalgroup.com/apply", note: "Documented funder but site returned Cloudflare error — couldn't confirm live" },
  "Trustify Advance": { status: "active", website: "https://trustifyadvance.com" },
  "Union Funding Source": { status: "active", website: "https://unionfundingsource.com" },
  "Unique Funding Solutions": { status: "active", website: "https://www.ufsfunding.com" },
  "United Business Funding": { status: "uncertain", note: "ubfunds.com returns DNS/SSL error — couldn't confirm live" },
  "United First": { status: "active", website: "https://www.globalfundingexperts.com", phone: "877-253-7686", note: "d/b/a Global Funding Experts" },
  "Uptown Fund": { status: "active", website: "https://uptownfund.com" },
  "Vader Mountain Capital": { status: "active", website: "https://vadermountaincapital.com", applyUrl: "https://vadermountaincapital.com/business-funding/" },
  "Vital Cap Fund": { status: "active", website: "https://www.vitalcapfund.com" },
  "WallStreet Funding": { status: "active", website: "https://wallfunding.com", phone: "1-877-851-3880", applyUrl: "https://wallfunding.com/become-a-partner/" },
  "Waterview Capital": { status: "active", website: "https://waterviewcap.com" },
  "Wayflyer": { status: "active", website: "https://wayflyer.com", note: "Large ecommerce revenue-based financier — not a standard MCA/ISO channel" },
  "WeFund": { status: "active", website: "https://www.wefundeasy.com" },
  "Wellen": { status: "active", website: "https://www.wellen.com" },
  "Westwood Funding": { status: "active", website: "https://www.westwoodfunding.com" },
  "Windgate Capital": { status: "active", website: "https://www.windgatecapital.com" },
  "Wynwood Capital": { status: "active", website: "https://www.wynwoodcapitalgroup.com" },
};

const directRows: Funder[] = DIRECTORY.map(([name, paper, slug]) => {
  const v = VERIFY[name];
  return {
    name,
    category: PLATFORM.has(name) ? ("platform" as FunderCategory) : ("direct" as FunderCategory),
    paper,
    lowRev: /D/.test(paper), // funds down to D paper = takes the weakest/low-revenue files
    whiteLabel: false,
    applyOnce: false,
    isoProgram: !PLATFORM.has(name), // FunderIntel directory is ISO-oriented
    inSystem: IN_SYSTEM.has(name),
    website: v?.website,
    phone: v?.phone,
    applyUrl: v?.applyUrl ?? `https://www.funderintel.com/funderslist/${slug}`,
    verified: v?.status ?? "uncertain",
    notes: v?.note ?? "FunderIntel directory — click to view profile & 'Request Intro'",
  };
});

export const FUNDERS: Funder[] = [
  ...ENRICHED.map((f) => ({ ...f, verified: "active" as const, inSystem: f.inSystem ?? IN_SYSTEM.has(f.name) })),
  ...directRows,
];
