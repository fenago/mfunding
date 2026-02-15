import {
  BoltIcon,
  HomeModernIcon,
  BuildingOffice2Icon,
  WrenchScrewdriverIcon,
  ClockIcon,
  CurrencyDollarIcon,
  ShieldCheckIcon,
  ChartBarIcon,
  DocumentTextIcon,
  ArrowTrendingUpIcon,
  CalendarDaysIcon,
  GlobeAmericasIcon,
  ArrowPathIcon,
  KeyIcon,
  CheckBadgeIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";
import type { ProductSpec, ProductBenefit, ProductFAQ, CalculatorConfig } from "./products";

// ────────────────────────────────────────
// CRE Calculator Config
// ────────────────────────────────────────

export interface CRECalcConfig {
  type: "interest-only" | "amortized";
  propertyValueMin: number;
  propertyValueMax: number;
  propertyValueStep: number;
  propertyValueLabel: string;
  ltvMin: number;
  ltvMax: number;
  ltvStep: number;
  ltvLabel: string;
  rateMin: number;
  rateMax: number;
  rateStep: number;
  termMin: number;
  termMax: number;
  termStep: number;
  termUnit: "months" | "years";
  hasConstructionBudget?: boolean;
  constructionBudgetMin?: number;
  constructionBudgetMax?: number;
  constructionBudgetStep?: number;
}

// CREProduct extends the shape of LoanProduct for component compatibility
export interface CREProduct {
  slug: string;
  name: string;
  shortName: string;
  tagline: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  color: string;

  hero: {
    badge: string;
    headline: string;
    highlightWord: string;
    subheadline: string;
    description: string;
    approvalTime: string;
    amountRange: string;
  };

  specs: ProductSpec[];
  benefits: ProductBenefit[];
  documents: string[];
  faqs: ProductFAQ[];
  calculatorConfig: CalculatorConfig; // compatibility with shared components
  creCalcConfig: CRECalcConfig;
  highlights: string[];
  restrictions?: string[];
}

// ────────────────────────────────────────
// CRE Product Data
// ────────────────────────────────────────

export const creProducts: CREProduct[] = [
  // ── Hard Money Bridge Loans ──
  {
    slug: "hard-money-bridge",
    name: "Hard Money Bridge Loans",
    shortName: "Bridge Loans",
    tagline:
      "Close in 2-4 weeks on fix & flip, cash-out refinance, and bridge financing",
    icon: BoltIcon,
    color: "#E11D48",
    hero: {
      badge: "Close in 2-4 Weeks",
      headline: "Found the Perfect Deal? Don't Lose It to a Slow Bank",
      highlightWord: "Perfect Deal",
      subheadline:
        "In real estate, timing is everything. While banks take months to approve, the opportunity walks out the door. Bridge financing gets you to the closing table in weeks, not months.",
      description:
        "Hard money bridge loans from $100K to $50M with closings in as little as 2 weeks. Whether you're flipping a property, pulling cash out of an existing investment, or bridging to permanent financing — Momentum Funding moves at the speed of your deals.",
      approvalTime: "2-4 Weeks",
      amountRange: "$100K – $50M",
    },
    specs: [
      { label: "Loan Amount", value: "$100,000 – $50,000,000" },
      { label: "Min. Property Value", value: "$150,000" },
      { label: "Loan-to-Value (LTV)", value: "50% – 80% (Up to 100% Rehab)" },
      { label: "Term Length", value: "6 to 24 Months (Interest Only)" },
      { label: "Interest Rate", value: "6% – 14%" },
      { label: "Time to Close", value: "2 to 4 Weeks" },
      { label: "Foreign Nationals", value: "Eligible" },
    ],
    benefits: [
      {
        title: "Close in 2-4 Weeks",
        description:
          "Banks take 60-90 days. Your competition closes in 2 weeks. Bridge financing from Momentum Funding puts you on the same playing field — or ahead of it.",
        icon: ClockIcon,
      },
      {
        title: "Up to 80% LTV",
        description:
          "Finance up to 80% of property value with strong credit and experience. Even with no credit check, you can access up to 65% LTV. The deal makes the loan.",
        icon: ChartBarIcon,
      },
      {
        title: "Up to 100% Rehab Financing",
        description:
          "Get your full renovation budget funded on top of the purchase price. Don't drain your reserves on construction costs when the lender can carry it.",
        icon: CurrencyDollarIcon,
      },
      {
        title: "Interest-Only Payments",
        description:
          "Pay only the interest each month during the loan term. Lower carrying costs mean more profit when you sell or refinance into permanent financing.",
        icon: CalendarDaysIcon,
      },
      {
        title: "Foreign Nationals Welcome",
        description:
          "International investors can access U.S. real estate financing. No U.S. credit history? No problem. We evaluate the deal, not just the borrower.",
        icon: GlobeAmericasIcon,
      },
      {
        title: "Fix & Flip or Cash-Out Refi",
        description:
          "Whether you're buying a distressed property to renovate and sell, or pulling equity from an existing investment — bridge loans handle both strategies.",
        icon: ArrowPathIcon,
      },
    ],
    documents: [
      "1003 Real Estate Loan Application",
      "3 Months of Bank Statements",
      "Purchase Agreement (if buying)",
      "Recent Mortgage Statement (if refinancing)",
      "Recent Credit Report",
      "Copy of Appraisal (if available)",
    ],
    highlights: [
      "Close in as Little as 2 Weeks",
      "Up to 80% LTV + 100% Rehab",
      "No Minimum Credit Score Options",
      "Foreign Nationals Eligible",
    ],
    restrictions: [
      "Not available for primary residences, land, or mobile homes",
      "Properties must be in non-rural U.S. areas",
      "Higher LTV tiers require 640+ credit and investor experience",
      "Pre-payment penalty may apply (varies by loan)",
    ],
    faqs: [
      {
        question: "What's the difference between a bridge loan and a hard money loan?",
        answer:
          "They're essentially the same thing. A 'hard money' loan is secured by the hard asset (the property) rather than the borrower's creditworthiness. A 'bridge' loan bridges the gap between buying a property and either selling it or refinancing into permanent financing. At Momentum Funding, our bridge loans are hard money loans — short-term, asset-based financing designed for speed.",
      },
      {
        question: "Can I really get 100% of rehab costs financed?",
        answer:
          "Yes, with strong qualifications (640+ credit, investor experience, and a low-risk property). The 100% rehab financing is on top of the purchase price financing. For example, on a $200K property with $80K in renovations, you might finance 75% of the purchase ($150K) plus 100% of the rehab ($80K) for a total loan of $230K. Rehab funds are typically disbursed in draws as work is completed.",
      },
      {
        question: "What types of properties qualify?",
        answer:
          "Single-family homes, multifamily, condos, townhouses, offices, industrial/warehouse, mixed-use, retail, and more. We do NOT lend on primary residences, vacant land, or mobile homes. The property must be in a non-rural U.S. area with sufficient market comparables.",
      },
      {
        question: "I have bad credit — can I still get a bridge loan?",
        answer:
          "Yes. We have no-credit-check options available at 50-65% LTV. The loan is primarily underwritten based on the property value and the deal itself. That said, borrowers with 640+ credit scores and investor experience will qualify for better terms (up to 80% LTV and lower rates).",
      },
      {
        question: "How does cash-out refinancing work with a bridge loan?",
        answer:
          "If you own an investment property with equity, you can refinance it with a bridge loan and take cash out — up to 75% of the property's current value. This is useful for pulling profits from a completed flip, funding your next deal, or accessing capital quickly without selling the property.",
      },
      {
        question: "What happens when the bridge loan term ends?",
        answer:
          "Bridge loans are designed to be temporary (6-24 months). Most borrowers either sell the property (fix & flip) or refinance into a permanent loan (like our Rental Investment Property Loan at 4-7% rates). If you need more time, extensions may be available depending on your situation.",
      },
    ],
    calculatorConfig: {
      type: "apr",
      amountMin: 100000,
      amountMax: 5000000,
      amountStep: 50000,
      aprMin: 6,
      aprMax: 14,
      aprStep: 0.5,
      termMin: 6,
      termMax: 24,
      termStep: 1,
      termUnit: "months",
      frequencies: ["monthly"],
      defaultFrequency: "monthly",
    },
    creCalcConfig: {
      type: "interest-only",
      propertyValueMin: 150000,
      propertyValueMax: 10000000,
      propertyValueStep: 50000,
      propertyValueLabel: "Property Value",
      ltvMin: 50,
      ltvMax: 80,
      ltvStep: 1,
      ltvLabel: "Loan-to-Value (LTV)",
      rateMin: 6,
      rateMax: 14,
      rateStep: 0.25,
      termMin: 6,
      termMax: 24,
      termStep: 1,
      termUnit: "months",
    },
  },

  // ── Rental Investment Property Loan ──
  {
    slug: "rental-investment",
    name: "Rental Investment Property Loan",
    shortName: "Rental Property Loans",
    tagline:
      "Long-term financing for your rental portfolio with rates as low as 4%",
    icon: HomeModernIcon,
    color: "#0891B2",
    hero: {
      badge: "Rates from 4%",
      headline: "Build Your Rental Portfolio Without the Bank Runaround",
      highlightWord: "Rental Portfolio",
      subheadline:
        "You've seen how rental income creates real, lasting wealth. But every time you find a good deal, the bank's 60-day process kills it. Not anymore.",
      description:
        "Finance rental properties with terms up to 30 years and rates starting at 4%. From single-family homes to multifamily complexes — Momentum Funding provides the long-term financing your investment portfolio deserves.",
      approvalTime: "3-4 Weeks",
      amountRange: "$100K – $50M",
    },
    specs: [
      { label: "Loan Amount", value: "$100,000 – $50,000,000" },
      { label: "Min. Property Value", value: "$150,000" },
      { label: "Loan-to-Value (LTV)", value: "60% – 80% (Purchase)" },
      { label: "Term Length", value: "5, 7, 10, 15, or 30 Years" },
      { label: "Interest Rate", value: "4% – 7%" },
      { label: "Time to Close", value: "3 to 4 Weeks" },
      { label: "Pre-Pay Penalty", value: "Yes (varies by term)" },
    ],
    benefits: [
      {
        title: "Rates Starting at 4%",
        description:
          "Some of the lowest rates in real estate investment lending. Over a 30-year term, even a 1% rate difference saves you tens of thousands in interest. Strong credit and experience unlock the best pricing.",
        icon: ArrowTrendingUpIcon,
      },
      {
        title: "Terms Up to 30 Years",
        description:
          "Build your portfolio with payments that make sense. A 30-year term keeps monthly payments low, letting your rental income cover the mortgage with room to spare for cash flow.",
        icon: CalendarDaysIcon,
      },
      {
        title: "Up to 80% LTV for Purchases",
        description:
          "Put as little as 20% down on your next rental property. Keep your cash reserves for renovations, property management, or your next acquisition.",
        icon: CurrencyDollarIcon,
      },
      {
        title: "Cash-Out Refinance Available",
        description:
          "Already own rental properties with equity? Refinance at up to 75% LTV and pull cash out to fund your next deal without selling your income-producing assets.",
        icon: KeyIcon,
      },
      {
        title: "All Rental Property Types",
        description:
          "Single-family, duplex, triplex, quad, multifamily complexes, condos, and townhouses. If it generates rental income, we can finance it.",
        icon: HomeModernIcon,
      },
      {
        title: "Experienced Investor Pricing",
        description:
          "The more experience you bring, the better your terms. Seasoned investors with strong credit get access to the highest LTVs and lowest rates in our portfolio.",
        icon: CheckBadgeIcon,
      },
    ],
    documents: [
      "1003 Real Estate Loan Application",
      "3 Months of Bank Statements",
      "Purchase Agreement (if buying)",
      "Recent Mortgage Statement (if refinancing)",
      "Recent Credit Report",
      "Rent Roll (if applicable)",
      "Copy of Appraisal (if available)",
    ],
    highlights: [
      "Rates as Low as 4%",
      "Terms Up to 30 Years",
      "Up to 80% LTV on Purchases",
      "Cash-Out Refinance Available",
    ],
    restrictions: [
      "Not available for primary residences, land, or mobile homes",
      "Foreign nationals are not eligible for this program",
      "Properties must be in non-rural U.S. areas",
      "Credit score of 650+ required for best terms",
      "Pre-payment penalty applies (varies by loan term)",
    ],
    faqs: [
      {
        question: "What's the difference between this and a regular mortgage?",
        answer:
          "A rental investment property loan is specifically designed for non-owner-occupied investment properties. Unlike a traditional residential mortgage, it evaluates the property's income potential alongside your financial profile. This means faster approvals and more flexibility for investors who may not qualify through conventional channels.",
      },
      {
        question: "Can I finance multiple properties?",
        answer:
          "Yes. There's no limit to the number of rental properties you can finance through Momentum Funding. Each property is evaluated individually. As your portfolio grows and your track record strengthens, you may qualify for better terms on subsequent properties.",
      },
      {
        question: "What credit score do I need?",
        answer:
          "For the best terms (80% LTV, lowest rates), you'll want a credit score above 650 with investment experience. Borrowers with credit above 650 can access 70-80% LTV for purchases. Those with lower credit may still qualify at reduced LTV levels with higher rates.",
      },
      {
        question: "Can I use rental income to qualify?",
        answer:
          "Yes. The property's rental income (current or projected) is factored into the underwriting. Lenders want to see that the property can service the debt. A strong rent roll or market-rate rental comparables can strengthen your application significantly.",
      },
      {
        question: "What about the pre-payment penalty?",
        answer:
          "Pre-payment penalties vary by loan term and are disclosed upfront before closing. They typically decrease over time. For example, a 30-year loan might have a 5-year declining pre-payment penalty. If you plan to hold the property long-term, pre-pay penalties are rarely an issue.",
      },
    ],
    calculatorConfig: {
      type: "apr",
      amountMin: 100000,
      amountMax: 5000000,
      amountStep: 50000,
      aprMin: 4,
      aprMax: 7,
      aprStep: 0.25,
      termMin: 5,
      termMax: 30,
      termStep: 5,
      termUnit: "years",
      frequencies: ["monthly"],
      defaultFrequency: "monthly",
    },
    creCalcConfig: {
      type: "amortized",
      propertyValueMin: 150000,
      propertyValueMax: 10000000,
      propertyValueStep: 50000,
      propertyValueLabel: "Property Value",
      ltvMin: 60,
      ltvMax: 80,
      ltvStep: 1,
      ltvLabel: "Loan-to-Value (LTV)",
      rateMin: 4,
      rateMax: 7,
      rateStep: 0.25,
      termMin: 5,
      termMax: 30,
      termStep: 5,
      termUnit: "years",
    },
  },

  // ── Commercial Property Mortgage ──
  {
    slug: "commercial-mortgage",
    name: "Commercial Property Mortgage",
    shortName: "Commercial Mortgage",
    tagline:
      "Finance office, retail, industrial, and mixed-use properties up to $50M",
    icon: BuildingOffice2Icon,
    color: "#7C3AED",
    hero: {
      badge: "Up to $50 Million",
      headline: "Own Your Business Space Instead of Paying Someone Else's Mortgage",
      highlightWord: "Own Your Space",
      subheadline:
        "Every rent check you write builds someone else's wealth. A commercial mortgage lets you invest in your own future with an asset that appreciates while you operate.",
      description:
        "Finance office buildings, retail spaces, industrial properties, warehouses, and mixed-use buildings from $100K to $50M. Long-term financing with rates starting at 6% and terms up to 30 years. Income-producing properties get the best terms.",
      approvalTime: "3-4 Weeks",
      amountRange: "$100K – $50M",
    },
    specs: [
      { label: "Loan Amount", value: "$100,000 – $50,000,000" },
      { label: "Min. Property Value", value: "$150,000" },
      { label: "Loan-to-Value (LTV)", value: "50% – 75%" },
      { label: "Term Length", value: "5 to 30 Years" },
      { label: "Interest Rate", value: "6% – 14%" },
      { label: "Time to Close", value: "3 to 4 Weeks" },
      { label: "Foreign Nationals", value: "Eligible" },
    ],
    benefits: [
      {
        title: "Build Equity, Not Rent Receipts",
        description:
          "Stop making your landlord wealthy. Every mortgage payment builds equity in an asset you own. Over time, commercial real estate tends to appreciate — your business gets a workspace AND a growing investment.",
        icon: ArrowTrendingUpIcon,
      },
      {
        title: "Up to $50 Million",
        description:
          "From a small retail storefront to a major industrial complex — Momentum Funding finances commercial properties at every scale. Larger deals often qualify for the best rates.",
        icon: CurrencyDollarIcon,
      },
      {
        title: "Terms Up to 30 Years",
        description:
          "Long-term financing means lower monthly payments. A 30-year term on a commercial property lets you keep more cash in the business where it belongs.",
        icon: CalendarDaysIcon,
      },
      {
        title: "Income-Producing Property Advantage",
        description:
          "If your commercial property generates rental income (tenants, leases), you'll qualify for the best LTV ratios and lowest rates. The property's cash flow strengthens your application.",
        icon: ChartBarIcon,
      },
      {
        title: "Foreign Nationals Welcome",
        description:
          "International investors can finance U.S. commercial properties through Momentum Funding. We evaluate the deal and the property, not just your U.S. credit history.",
        icon: GlobeAmericasIcon,
      },
      {
        title: "All Commercial Property Types",
        description:
          "Office buildings, retail, industrial, warehouse, mixed-use, multifamily, and more. If it's commercial real estate generating or capable of generating income, we can finance it.",
        icon: BuildingOffice2Icon,
      },
    ],
    documents: [
      "Commercial Real Estate Loan Application",
      "3 Months of Bank Statements",
      "Purchase Agreement (if buying)",
      "Mortgage Statement (if refinancing)",
      "Recent Credit Report",
      "Rent Roll (if applicable)",
      "Copy of Appraisal (if available)",
    ],
    highlights: [
      "Up to 75% LTV",
      "Terms from 5 to 30 Years",
      "Income-Producing Properties Get Best Terms",
      "Foreign Nationals Eligible",
    ],
    restrictions: [
      "Not available for primary residences, land, or mobile homes",
      "Vacant properties limited to 50-70% LTV with higher rates",
      "Credit score of 660+ required for best terms",
      "Pre-payment penalty applies (varies by loan term)",
      "Properties must be in non-rural U.S. areas",
    ],
    faqs: [
      {
        question: "What types of commercial properties qualify?",
        answer:
          "Office buildings, retail stores, shopping centers, industrial facilities, warehouses, mixed-use buildings, multifamily properties (5+ units), medical offices, restaurants, auto service facilities, and more. We do not finance primary residences, vacant land, or mobile homes.",
      },
      {
        question: "Do I need the property to be income-producing?",
        answer:
          "Not necessarily, but income-producing properties qualify for the best terms (up to 75% LTV, rates from 6%). Vacant or non-income-producing properties can still be financed at 50-70% LTV with rates from 10-14%. The property's income potential significantly impacts your loan terms.",
      },
      {
        question: "Can I finance a property my business occupies?",
        answer:
          "Yes. Owner-occupied commercial properties are eligible. Many business owners use a commercial mortgage to purchase the building they currently rent, eliminating lease payments and building equity. Your business revenue helps support the loan qualification.",
      },
      {
        question: "What credit score do I need?",
        answer:
          "For the best terms (75% LTV, 6-9% rates), you'll want a credit score above 660 with an income-producing property. Borrowers with credit below 660 can access financing at 50-70% LTV with rates from 10-14%. The property itself is a significant factor in underwriting.",
      },
      {
        question: "How is a commercial mortgage different from a residential mortgage?",
        answer:
          "Commercial mortgages evaluate the property's income potential, not just the borrower's personal finances. They typically have slightly higher rates than residential loans but offer larger loan amounts and more flexibility. Terms, down payments, and qualification criteria are all based on the commercial property's performance and potential.",
      },
    ],
    calculatorConfig: {
      type: "apr",
      amountMin: 100000,
      amountMax: 5000000,
      amountStep: 50000,
      aprMin: 6,
      aprMax: 14,
      aprStep: 0.5,
      termMin: 5,
      termMax: 30,
      termStep: 1,
      termUnit: "years",
      frequencies: ["monthly"],
      defaultFrequency: "monthly",
    },
    creCalcConfig: {
      type: "amortized",
      propertyValueMin: 150000,
      propertyValueMax: 10000000,
      propertyValueStep: 50000,
      propertyValueLabel: "Property Value",
      ltvMin: 50,
      ltvMax: 75,
      ltvStep: 1,
      ltvLabel: "Loan-to-Value (LTV)",
      rateMin: 6,
      rateMax: 14,
      rateStep: 0.25,
      termMin: 5,
      termMax: 30,
      termStep: 1,
      termUnit: "years",
    },
  },

  // ── Ground Up Construction Loan ──
  {
    slug: "construction-loans",
    name: "Ground Up Construction Loan",
    shortName: "Construction Loans",
    tagline:
      "Finance up to 85% of your total project cost from the ground up",
    icon: WrenchScrewdriverIcon,
    color: "#EA580C",
    hero: {
      badge: "Up to 85% LTC",
      headline: "You've Got the Vision and the Blueprint. Now Get the Capital",
      highlightWord: "Capital",
      subheadline:
        "Building from the ground up takes more than skill — it takes a financing partner who understands construction timelines, draw schedules, and the reality of building something from nothing.",
      description:
        "Finance up to 85% of your total project cost with loan-to-cost ratios that keep your capital working. Interest-only payments during construction mean lower carrying costs while you build. From residential developments to commercial projects — $100K to $50M.",
      approvalTime: "3-6 Weeks",
      amountRange: "$100K – $50M",
    },
    specs: [
      { label: "Loan Amount", value: "$100,000 – $50,000,000" },
      { label: "Min. Land Value", value: "$150,000" },
      { label: "Loan-to-Cost (LTC)", value: "55% – 85% (Up to 100% Rehab)" },
      { label: "Term Length", value: "6 to 24 Months (Interest Only)" },
      { label: "Interest Rate", value: "5% – 14%" },
      { label: "Time to Close", value: "3 to 6 Weeks" },
      { label: "Pre-Pay Penalty", value: "None" },
    ],
    benefits: [
      {
        title: "Up to 85% Loan-to-Cost",
        description:
          "Finance up to 85% of your total project cost (land + construction) with strong credit and experience. Even less experienced builders can access 55-75% LTC. The project makes the loan.",
        icon: ChartBarIcon,
      },
      {
        title: "Interest-Only During Construction",
        description:
          "Only pay interest during the build phase. No principal payments until the project is complete. This keeps your carrying costs low while all your capital goes into building.",
        icon: CalendarDaysIcon,
      },
      {
        title: "Up to 100% Rehab Financing",
        description:
          "Experienced builders with 680+ credit can get up to 100% of rehab/construction costs financed. Funds are released in draws as construction milestones are completed.",
        icon: CurrencyDollarIcon,
      },
      {
        title: "No Pre-Payment Penalty",
        description:
          "Finish your project early? Sell it ahead of schedule? Pay off the loan whenever you want with zero penalty. Your success shouldn't cost extra.",
        icon: ShieldCheckIcon,
      },
      {
        title: "Draw-Based Funding",
        description:
          "Construction funds are released in stages as work is completed and inspected. This protects both you and the lender while keeping the project moving forward.",
        icon: DocumentTextIcon,
      },
      {
        title: "Residential & Commercial Projects",
        description:
          "Single-family spec homes, townhouse developments, multifamily projects, commercial buildings — if you're building from the ground up, we can finance it.",
        icon: UserGroupIcon,
      },
    ],
    documents: [
      "1003 Real Estate Loan Application",
      "3 Months of Bank Statements",
      "Investment History and Experience",
      "Schedule of Real Estate Owned",
      "Scope of Work and Use of Funds",
      "Plans and Permits",
      "Purchase Agreement (if applicable)",
      "Recent Credit Report",
    ],
    highlights: [
      "Up to 85% Loan-to-Cost",
      "Interest-Only During Construction",
      "No Pre-Payment Penalty",
      "Draw-Based Funding Schedule",
    ],
    restrictions: [
      "Not available for primary residences or mobile homes",
      "Credit score of 680+ required for best terms (up to 85% LTC)",
      "Borrowers with limited/no experience limited to 55-75% LTC",
      "Properties must be in desirable, non-rural market areas",
      "Plans and permits required prior to closing",
    ],
    faqs: [
      {
        question: "How does draw-based funding work?",
        answer:
          "Instead of receiving the full loan amount at closing, construction funds are released in stages (draws) as work is completed. Typically, you complete a phase of construction, an inspector verifies the work, and the next draw is released. This keeps the project funded at each stage without over-leveraging.",
      },
      {
        question: "Do I need construction experience to qualify?",
        answer:
          "Experience helps significantly. Builders with significant experience and 680+ credit qualify for the best terms (up to 85% LTC, rates from 5%). Less experienced borrowers can still qualify at 55-75% LTC with rates from 8-14%. First-time builders should expect more conservative terms.",
      },
      {
        question: "Can I finance the land purchase and construction together?",
        answer:
          "Yes. The loan-to-cost (LTC) ratio applies to the total project cost, which includes land acquisition and construction. If you already own the land, its value counts toward your equity in the project, potentially improving your LTC ratio.",
      },
      {
        question: "What happens if construction takes longer than expected?",
        answer:
          "Construction loans typically have terms of 6-24 months. If your project runs long, extensions may be available depending on the circumstances. It's important to build a realistic timeline upfront. Interest continues to accrue during any extension period.",
      },
      {
        question: "What types of projects qualify?",
        answer:
          "Single-family spec homes, custom homes (non-owner-occupied), townhouse developments, multifamily residential, commercial buildings, mixed-use projects, and more. The property must be in a desirable market area with strong comparables. We do not finance owner-occupied primary residences.",
      },
      {
        question: "I already own the land. Can I still get a construction loan?",
        answer:
          "Absolutely. If you own the land free and clear, its appraised value serves as your equity in the project. This can significantly improve your loan terms and LTC ratio. You may even be able to get 100% of the construction costs financed if the land equity is sufficient.",
      },
    ],
    calculatorConfig: {
      type: "apr",
      amountMin: 100000,
      amountMax: 5000000,
      amountStep: 50000,
      aprMin: 5,
      aprMax: 14,
      aprStep: 0.5,
      termMin: 6,
      termMax: 24,
      termStep: 1,
      termUnit: "months",
      frequencies: ["monthly"],
      defaultFrequency: "monthly",
    },
    creCalcConfig: {
      type: "interest-only",
      propertyValueMin: 150000,
      propertyValueMax: 10000000,
      propertyValueStep: 50000,
      propertyValueLabel: "Land Value",
      ltvMin: 55,
      ltvMax: 85,
      ltvStep: 1,
      ltvLabel: "Loan-to-Cost (LTC)",
      rateMin: 5,
      rateMax: 14,
      rateStep: 0.25,
      termMin: 6,
      termMax: 24,
      termStep: 1,
      termUnit: "months",
      hasConstructionBudget: true,
      constructionBudgetMin: 50000,
      constructionBudgetMax: 10000000,
      constructionBudgetStep: 25000,
    },
  },
];

// ────────────────────────────────────────
// Helpers
// ────────────────────────────────────────

export function getCREProductBySlug(slug: string): CREProduct | undefined {
  return creProducts.find((p) => p.slug === slug);
}

export function getAllCREProducts(): CREProduct[] {
  return creProducts;
}
