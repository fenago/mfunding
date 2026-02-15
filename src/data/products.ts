import {
  BoltIcon,
  WrenchScrewdriverIcon,
  RocketLaunchIcon,
  BuildingLibraryIcon,
  BanknotesIcon,
  ArrowPathIcon,
  ClockIcon,
  CurrencyDollarIcon,
  ShieldCheckIcon,
  CheckBadgeIcon,
  DocumentTextIcon,
  ChartBarIcon,
  UserGroupIcon,
  ArrowTrendingUpIcon,
  CalendarDaysIcon,
  CreditCardIcon,
} from "@heroicons/react/24/outline";

// ────────────────────────────────────────
// Types
// ────────────────────────────────────────

export interface ProductSpec {
  label: string;
  value: string;
}

export interface ProductBenefit {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
}

export interface ProductFAQ {
  question: string;
  answer: string;
}

export interface CalculatorConfig {
  type: "factor-rate" | "apr";
  amountMin: number;
  amountMax: number;
  amountStep: number;
  // For factor-rate products (MCA)
  factorRateMin?: number;
  factorRateMax?: number;
  factorRateStep?: number;
  // For APR-based products
  aprMin?: number;
  aprMax?: number;
  aprStep?: number;
  // Term
  termMin: number;
  termMax: number;
  termStep: number;
  termUnit: "months" | "years";
  // Payment frequency options
  frequencies: ("daily" | "weekly" | "monthly")[];
  defaultFrequency: "daily" | "weekly" | "monthly";
}

export interface LoanProduct {
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
  calculatorConfig: CalculatorConfig;
  highlights: string[];
  restrictions?: string[];
  flyer?: {
    url: string;
    label: string;
  };
}

// ────────────────────────────────────────
// Product Data
// ────────────────────────────────────────

export const products: LoanProduct[] = [
  // ── Merchant Cash Advance ──
  {
    slug: "merchant-cash-advance",
    name: "Merchant Cash Advance (MCA)",
    shortName: "Merchant Cash Advance",
    tagline: "Fast capital when you need it most — no credit score required",
    icon: BoltIcon,
    color: "#00D49D",
    hero: {
      badge: "Same-Day Funding",
      headline: "Cash Flow Dried Up? Get Funded Today",
      highlightWord: "Today",
      subheadline:
        "You've got the jobs lined up and the crew ready to go. Don't let a cash flow gap cost you the work you've already earned.",
      description:
        "A Merchant Cash Advance puts working capital in your hands within 24 hours — no credit score requirement, no collateral, no red tape. You repay as a percentage of your daily sales, so payments adjust with your business.",
      approvalTime: "24 Hours",
      amountRange: "$20K – $5M",
    },
    specs: [
      { label: "Funding Amount", value: "$20,000 – $5,000,000" },
      { label: "Term Length", value: "3 to 18 Months" },
      { label: "Min. Credit Score", value: "None Required" },
      { label: "Annual Revenue", value: "$360,000 ($30K/mo)" },
      { label: "Time in Business", value: "1 Year" },
      { label: "Approval Time", value: "24 Hours (Same Day Funding)" },
      { label: "Cost of Capital", value: "1.20 – 1.49 Factor Rate" },
    ],
    benefits: [
      {
        title: "No Credit Score Requirement",
        description:
          "Banks judge you on a number. We judge you on your business. Past credit issues won't hold you back — all that matters is your monthly revenue.",
        icon: ShieldCheckIcon,
      },
      {
        title: "Same-Day Funding",
        description:
          "Apply in 5 minutes, get approved in hours, and see funds in your account the same day. When payroll is due Friday, you can't wait until next month.",
        icon: BoltIcon,
      },
      {
        title: "Payments That Flex With You",
        description:
          "Repay as a percentage of daily or weekly sales. Slow week? Smaller payment. Busy week? You're free faster. No fixed monthly burden.",
        icon: ArrowPathIcon,
      },
      {
        title: "All Industries Welcome",
        description:
          "Whether you're in construction, restaurants, retail, healthcare, or services — if your business has revenue, you qualify. No industry restrictions.",
        icon: UserGroupIcon,
      },
      {
        title: "Up to 150% of Monthly Sales",
        description:
          "Get approved for 50% to 150% of your average monthly sales. The stronger your revenue, the more capital you can access.",
        icon: ChartBarIcon,
      },
      {
        title: "Simple Documentation",
        description:
          "Just a loan application and 4-6 months of bank statements. No tax returns, no profit & loss statements, no accountant required.",
        icon: DocumentTextIcon,
      },
    ],
    documents: [
      "Business Loan Application",
      "4-6 Months of Business Bank Statements",
      "4-6 Months of Credit Card Processing/Merchant Statements (if applicable)",
    ],
    highlights: [
      "Approvals of 50%-150% of Average Monthly Sales",
      "No Minimum Credit Score Required",
      "All Industries Qualify",
      "24-Hour Approval & Same-Day Funding",
    ],
    faqs: [
      {
        question: "What exactly is a Merchant Cash Advance?",
        answer:
          "An MCA isn't a loan — it's an advance on your future sales. Momentum Funding purchases a portion of your future receivables at a discount. You receive a lump sum of capital upfront, then repay through a small percentage of your daily or weekly sales. When business is slow, you pay less. When it picks up, you're free faster.",
      },
      {
        question: "How is this different from a bank loan?",
        answer:
          "Banks require 680+ credit scores, 2+ years in business, mountains of paperwork, and weeks of waiting. An MCA from Momentum Funding requires no minimum credit score, just 1 year in business, minimal documents, and you can be funded the same day you apply. The trade-off is a higher cost of capital — but for many business owners, the speed and accessibility are worth it.",
      },
      {
        question: "What's a factor rate?",
        answer:
          "A factor rate is how MCA pricing works. It's a multiplier (typically 1.20 to 1.49) applied to your advance amount. For example, a $100,000 advance at a 1.30 factor rate means you repay $130,000 total. Unlike interest rates, factor rates are fixed — you know exactly what you'll pay from day one.",
      },
      {
        question: "Will my credit score affect my approval?",
        answer:
          "No. We don't have a minimum credit score requirement for MCAs. Our approval is based on your business revenue and bank statements. We do a soft credit pull that won't affect your score. Your past credit struggles don't define your business's potential.",
      },
      {
        question: "How are payments collected?",
        answer:
          "Payments are automatically deducted from your business bank account on a daily or weekly basis. The amount is based on a fixed percentage of your sales. This means payments naturally adjust to your cash flow — lighter during slow periods, faster during busy ones.",
      },
      {
        question: "Can I get a second MCA if I need more capital?",
        answer:
          "Yes. Once you've paid down approximately 50% of your existing advance, you may qualify for renewal funding — often at better terms. Many of our clients use MCAs as an ongoing capital solution for seasonal needs, inventory purchases, or growth opportunities.",
      },
    ],
    calculatorConfig: {
      type: "factor-rate",
      amountMin: 5000,
      amountMax: 1000000,
      amountStep: 5000,
      factorRateMin: 1.2,
      factorRateMax: 1.49,
      factorRateStep: 0.01,
      termMin: 3,
      termMax: 18,
      termStep: 1,
      termUnit: "months",
      frequencies: ["daily", "weekly"],
      defaultFrequency: "weekly",
    },
    flyer: {
      url: "/flyers/mca-flyer.jpeg",
      label: "Download MCA Flyer",
    },
  },

  // ── Equipment Financing ──
  {
    slug: "equipment-financing",
    name: "Equipment Financing",
    shortName: "Equipment Financing",
    tagline: "Finance the equipment your business needs — up to 95% covered",
    icon: WrenchScrewdriverIcon,
    color: "#3B82F6",
    hero: {
      badge: "Low Monthly Payments",
      headline: "Broken Equipment Is Costing You Jobs",
      highlightWord: "Jobs",
      subheadline:
        "That worn-out truck, aging excavator, or outdated machinery isn't just a headache — it's money walking out the door every day you can't take on new work.",
      description:
        "Finance up to 95% of your equipment cost with predictable monthly payments. From heavy machinery to commercial vehicles to restaurant equipment — get what you need to keep your crew working and your business growing.",
      approvalTime: "1-2 Days",
      amountRange: "$20K – $5M",
    },
    specs: [
      { label: "Funding Amount", value: "$20,000 – $5,000,000" },
      { label: "Term Length", value: "1 to 5 Years" },
      { label: "Min. Credit Score", value: "580" },
      { label: "Annual Revenue", value: "$360,000 ($30K/mo)" },
      { label: "Time in Business", value: "1 Year" },
      { label: "Approval Time", value: "1-2 Days (1-3 Days to Fund)" },
      { label: "Cost of Capital", value: "6% – 35% APR" },
    ],
    benefits: [
      {
        title: "Up to 95% Financing",
        description:
          "Put as little as 5% down on the equipment your business needs. Keep your cash reserves for payroll, materials, and the unexpected.",
        icon: CurrencyDollarIcon,
      },
      {
        title: "Predictable Monthly Payments",
        description:
          "Fixed monthly payments you can plan around. No daily deductions, no surprises. Know exactly what you owe every month for the life of the loan.",
        icon: CalendarDaysIcon,
      },
      {
        title: "Equipment Is the Collateral",
        description:
          "The equipment you're financing serves as collateral — no need to put up your house, car, or other personal assets. Your risk is limited.",
        icon: ShieldCheckIcon,
      },
      {
        title: "Competitive Rates",
        description:
          "With rates starting as low as 6%, equipment financing is one of the most affordable funding options available. Strong credit and revenue mean even better terms.",
        icon: ArrowTrendingUpIcon,
      },
      {
        title: "Approval from 100-200% of Monthly Sales",
        description:
          "Qualify for equipment valued at 100% to 200% of your average monthly sales. The stronger your business, the more you can finance.",
        icon: ChartBarIcon,
      },
      {
        title: "Fast 1-2 Day Approval",
        description:
          "Get approved in as little as 1 day and funded within 3 days. Don't lose that deal on a used excavator because you're waiting on the bank.",
        icon: ClockIcon,
      },
    ],
    documents: [
      "Business Loan Application",
      "4-6 Months of Business Bank Statements",
      "Copy of Equipment Invoice or Quote",
    ],
    highlights: [
      "60%-95% Equipment Financing",
      "Approvals from 100%-200% of Monthly Sales",
      "Monthly Payments",
      "Equipment Serves as Collateral",
    ],
    faqs: [
      {
        question: "What types of equipment can I finance?",
        answer:
          "Almost any business equipment: construction machinery, commercial vehicles, restaurant equipment, medical devices, manufacturing equipment, technology/computers, salon equipment, and more. If it's used to generate revenue for your business, we can likely finance it.",
      },
      {
        question: "Can I finance used equipment?",
        answer:
          "Yes. We finance both new and used equipment. For used equipment, we'll need a copy of the invoice or quote from the seller. The equipment's condition and remaining useful life will factor into the approval.",
      },
      {
        question: "What happens if I can't make payments?",
        answer:
          "Because the equipment serves as collateral, defaulting on payments could result in repossession of the financed equipment. However, your personal assets are not at risk. If you're struggling, contact us early — we often work with borrowers to find solutions.",
      },
      {
        question: "How much do I need to put down?",
        answer:
          "As little as 5% depending on your credit profile and the equipment type. Stronger credit profiles and newer equipment typically qualify for higher financing percentages with lower down payments.",
      },
      {
        question: "Is there a tax benefit to equipment financing?",
        answer:
          "Often yes. Section 179 of the IRS tax code allows businesses to deduct the full purchase price of qualifying equipment in the year it's purchased. Consult your accountant for details specific to your situation.",
      },
    ],
    calculatorConfig: {
      type: "apr",
      amountMin: 20000,
      amountMax: 5000000,
      amountStep: 10000,
      aprMin: 6,
      aprMax: 35,
      aprStep: 0.5,
      termMin: 1,
      termMax: 5,
      termStep: 1,
      termUnit: "years",
      frequencies: ["monthly"],
      defaultFrequency: "monthly",
    },
  },

  // ── Personal / Startup Loans ──
  {
    slug: "startup-loans",
    name: "Personal & Startup Loans",
    shortName: "Startup Loans",
    tagline: "Fund your new business — even with zero time in business",
    icon: RocketLaunchIcon,
    color: "#8B5CF6",
    hero: {
      badge: "New Businesses Welcome",
      headline: "Just Getting Started? You Deserve Capital Too",
      highlightWord: "Capital",
      subheadline:
        "Every successful business started somewhere. You've got the skills, the drive, and the plan. Don't let a lack of business history hold you back.",
      description:
        "Our personal and startup loan program is designed for entrepreneurs who are ready to launch. With rates as low as 6% and no time-in-business requirement, this is your on-ramp to building something real.",
      approvalTime: "24 Hours",
      amountRange: "$20K – $500K",
    },
    specs: [
      { label: "Funding Amount", value: "$20,000 – $500,000" },
      { label: "Term Length", value: "1 to 5 Years" },
      { label: "Min. Credit Score", value: "700 (Experian)" },
      { label: "Annual Income", value: "$50,000 (Taxes or Paystubs)" },
      { label: "Time in Business", value: "None (5+ Tradelines Required)" },
      { label: "Approval Time", value: "24 Hours (1-2 Weeks to Fund)" },
      { label: "Cost of Capital", value: "6% – 18% APR" },
    ],
    benefits: [
      {
        title: "Zero Time in Business Required",
        description:
          "Just launched? Haven't opened the doors yet? No problem. This program is built for entrepreneurs at day zero. All you need is strong personal credit and established tradelines.",
        icon: RocketLaunchIcon,
      },
      {
        title: "Lowest Rates Available",
        description:
          "With APRs from 6% to 18%, this is one of the most affordable funding options we offer. Strong credit means you keep more of your profits.",
        icon: ArrowTrendingUpIcon,
      },
      {
        title: "Up to $500K",
        description:
          "Get the capital you need to lease a space, buy inventory, hire your first employee, or invest in equipment — all before your first dollar of revenue.",
        icon: CurrencyDollarIcon,
      },
      {
        title: "24-Hour Approval",
        description:
          "Know where you stand within 24 hours. No weeks of waiting while opportunities pass you by.",
        icon: ClockIcon,
      },
      {
        title: "Monthly Payments",
        description:
          "Predictable monthly payments over 1 to 5 years. Budget with confidence as you build your business.",
        icon: CalendarDaysIcon,
      },
      {
        title: "Personal & Business Use",
        description:
          "Use funds for business startup costs, equipment, working capital, or to bridge the gap while your new venture ramps up.",
        icon: DocumentTextIcon,
      },
    ],
    documents: [
      "Online Loan Application",
      "Tax Returns (if approved)",
      "Bank Statements",
      "Pay Stubs",
      "Utility Bill",
      "Phone Call with Analyst",
    ],
    highlights: [
      "No Time in Business Required",
      "Low 6%-18% APR",
      "Less Than 35% Credit Utilization Required",
      "Strong Credit History Needed",
    ],
    restrictions: [
      "Requires 700+ Experian credit score",
      "Less than 35% credit utilization",
      "Minimal recent credit inquiries",
      "Strong credit history with no recent negative items",
      "Requires at least 5 established tradelines",
    ],
    faqs: [
      {
        question: "I have zero months in business — can I really get funded?",
        answer:
          "Yes. This program is specifically designed for startups and new businesses. The qualification is based on your personal credit profile rather than business history. You'll need a 700+ Experian score, at least 5 tradelines, and less than 35% credit utilization.",
      },
      {
        question: "What are tradelines and why do I need 5?",
        answer:
          "Tradelines are credit accounts that appear on your credit report — credit cards, auto loans, student loans, mortgages, etc. Having at least 5 established tradelines demonstrates a track record of managing credit responsibly, which is essential since there's no business history to evaluate.",
      },
      {
        question: "Why does funding take 1-2 weeks after approval?",
        answer:
          "Because this loan is based on personal credit rather than business revenue, there's a more thorough verification process after initial approval. This includes an analyst phone call, document verification, and final underwriting. The extra time ensures you get the best terms possible.",
      },
      {
        question: "Can I use this to fund a franchise?",
        answer:
          "Yes. Many of our startup loan clients use the capital to fund franchise fees, initial buildout costs, and early operating expenses. As long as you meet the credit requirements, the use of funds is flexible.",
      },
      {
        question: "What if my credit score is below 700?",
        answer:
          "If your credit score is below 700, this particular program may not be the right fit. However, our Merchant Cash Advance has no credit score requirement, and our Business Term Loan accepts scores as low as 500. We'll help you find the right option.",
      },
    ],
    calculatorConfig: {
      type: "apr",
      amountMin: 20000,
      amountMax: 500000,
      amountStep: 5000,
      aprMin: 6,
      aprMax: 18,
      aprStep: 0.5,
      termMin: 1,
      termMax: 5,
      termStep: 1,
      termUnit: "years",
      frequencies: ["monthly"],
      defaultFrequency: "monthly",
    },
  },

  // ── SBA 7(a) Loan ──
  {
    slug: "sba-loans",
    name: "SBA 7(a) Loan",
    shortName: "SBA 7(a) Loan",
    tagline: "The gold standard in business financing — lowest rates, longest terms",
    icon: BuildingLibraryIcon,
    color: "#0EA5E9",
    hero: {
      badge: "Lowest Rates",
      headline: "Ready to Make the Big Move? Scale With Confidence",
      highlightWord: "Scale",
      subheadline:
        "You've put in the years, built the reputation, and proven your business works. Now it's time to grow — and the SBA 7(a) gives you the firepower to do it right.",
      description:
        "Government-backed SBA 7(a) loans offer the lowest rates (5-9%) and longest terms (up to 25 years) available. If your business is established and profitable, this is the most affordable way to fund major growth, acquisitions, or expansion.",
      approvalTime: "3-5 Days",
      amountRange: "$250K – $5M",
    },
    specs: [
      { label: "Funding Amount", value: "$250,000 – $5,000,000" },
      { label: "Term Length", value: "5 to 25 Years" },
      { label: "Min. Credit Score", value: "680" },
      { label: "Annual Revenue", value: "$500,000 (10%+ Profit)" },
      { label: "Time in Business", value: "2 Years" },
      { label: "Approval Time", value: "3-5 Days (1-3 Months to Fund)" },
      { label: "Cost of Capital", value: "5% – 9% APR" },
    ],
    benefits: [
      {
        title: "Lowest Cost of Capital",
        description:
          "At 5-9% APR, SBA 7(a) loans are the cheapest business capital available. Over a 25-year term, this can save you hundreds of thousands compared to other options.",
        icon: ArrowTrendingUpIcon,
      },
      {
        title: "Up to $5 Million",
        description:
          "Fund major initiatives: real estate purchases, business acquisitions, large equipment, or significant expansion. This is growth capital at scale.",
        icon: CurrencyDollarIcon,
      },
      {
        title: "Terms Up to 25 Years",
        description:
          "Spread payments over up to 25 years for real estate, 10 years for equipment, or 7 years for working capital. Lower monthly payments mean better cash flow.",
        icon: CalendarDaysIcon,
      },
      {
        title: "Government-Backed Security",
        description:
          "SBA 7(a) loans are partially guaranteed by the U.S. Small Business Administration, which means lenders can offer better rates and terms than conventional loans.",
        icon: ShieldCheckIcon,
      },
      {
        title: "Monthly Payments",
        description:
          "Predictable monthly payments that won't strain your cash flow. No daily or weekly deductions — just one manageable payment per month.",
        icon: BanknotesIcon,
      },
      {
        title: "Versatile Use of Funds",
        description:
          "Use for working capital, real estate, equipment, acquisitions, debt refinancing, or business expansion. One of the most flexible funding options available.",
        icon: DocumentTextIcon,
      },
    ],
    documents: [
      "SBA Loan Application",
      "12 Months of Bank Statements",
      "2 Years of Business Tax Returns",
      "2 Years of Personal Tax Returns",
      "YTD Financials (Profit & Loss, Balance Sheet)",
      "Copy of Recent Credit Report",
    ],
    highlights: [
      "Lowest Cost of Capital (5%-9%)",
      "Requires Strong Credit History",
      "Requires Profit on Taxes",
      "Certain Industries Eligible",
    ],
    restrictions: [
      "Requires 680+ credit score",
      "Business must show at least 10% profit on taxes",
      "No excessive business debt",
      "Not all industries are eligible",
      "2+ years in business required",
      "Funding timeline: 1-3 months after approval",
    ],
    faqs: [
      {
        question: "Why does it take 1-3 months to fund after approval?",
        answer:
          "SBA 7(a) loans involve government-backed underwriting, which requires thorough documentation review, property appraisals (for real estate), and SBA authorization. The process is longer but results in significantly better rates and terms. For business owners who can plan ahead, the savings are substantial.",
      },
      {
        question: "What industries are eligible?",
        answer:
          "Most for-profit businesses operating in the U.S. are eligible. Excluded industries typically include gambling, lending, multi-level marketing, and certain speculative businesses. Contact us with your specific industry and we'll confirm eligibility within 24 hours.",
      },
      {
        question: "What does 'must show 10% profit' mean?",
        answer:
          "Your business tax returns need to show that your net profit is at least 10% of your gross revenue. For example, if your business does $500K in revenue, you should show at least $50K in net profit. This demonstrates the business can comfortably service the debt.",
      },
      {
        question: "Can I use an SBA 7(a) loan to buy an existing business?",
        answer:
          "Yes. Business acquisitions are one of the most common uses of SBA 7(a) loans. You can finance the purchase of an existing business, including goodwill, inventory, and equipment. The SBA typically requires a 10-20% down payment on acquisitions.",
      },
      {
        question: "I need funding faster. What are my alternatives?",
        answer:
          "If you can't wait 1-3 months, consider our Merchant Cash Advance (same-day funding) or Business Term Loan (same-day funding). These have higher costs but dramatically faster timelines. Many business owners use an MCA for immediate needs and then refinance with an SBA loan later.",
      },
    ],
    calculatorConfig: {
      type: "apr",
      amountMin: 250000,
      amountMax: 5000000,
      amountStep: 25000,
      aprMin: 5,
      aprMax: 9,
      aprStep: 0.25,
      termMin: 5,
      termMax: 25,
      termStep: 1,
      termUnit: "years",
      frequencies: ["monthly"],
      defaultFrequency: "monthly",
    },
  },

  // ── Business Term Loan ──
  {
    slug: "term-loans",
    name: "Business Term Loan",
    shortName: "Business Term Loan",
    tagline: "Predictable monthly payments with early payoff discounts",
    icon: BanknotesIcon,
    color: "#F59E0B",
    hero: {
      badge: "Same-Day Funding",
      headline: "Need Breathing Room? Get Predictable Monthly Payments",
      highlightWord: "Breathing Room",
      subheadline:
        "You're not behind — you just need a little runway. A term loan gives you the structure to plan ahead instead of scrambling to make it through the month.",
      description:
        "Get $10K to $250K with fixed monthly payments over 2 to 10 years. Approved in 24 hours, funded the same day. Plus, pay it off early and save with built-in discounts. Available in 30 states.",
      approvalTime: "24 Hours",
      amountRange: "$10K – $250K",
    },
    specs: [
      { label: "Funding Amount", value: "$10,000 – $250,000" },
      { label: "Term Length", value: "2 to 10 Years" },
      { label: "Min. Credit Score", value: "500" },
      { label: "Annual Revenue", value: "$240,000 ($20K/mo)" },
      { label: "Time in Business", value: "3 Months" },
      { label: "Approval Time", value: "24 Hours (Same Day Funding)" },
      { label: "Cost of Capital", value: "25% – 75% APR" },
    ],
    benefits: [
      {
        title: "Same-Day Funding",
        description:
          "Apply today, get funded today. When you need capital to cover payroll, buy materials, or seize an opportunity — 24 hours is all it takes.",
        icon: BoltIcon,
      },
      {
        title: "Low 500 Credit Score Minimum",
        description:
          "Past credit problems? It happens. A 500 score is all you need. We look at your business revenue, not just your credit history.",
        icon: ShieldCheckIcon,
      },
      {
        title: "Only 3 Months in Business",
        description:
          "Just getting your footing? With only 3 months of business history required, this is one of the most accessible term loan options available.",
        icon: ClockIcon,
      },
      {
        title: "Predictable Monthly Payments",
        description:
          "Fixed monthly payments you can plan around. No daily deductions eating into your cash flow. One payment, one date, every month.",
        icon: CalendarDaysIcon,
      },
      {
        title: "Early Payment Discounts",
        description:
          "Pay off your loan early and save. Built-in early payment discounts reward you for getting ahead. The faster you pay, the less it costs.",
        icon: ArrowTrendingUpIcon,
      },
      {
        title: "Can Refinance Existing Debt",
        description:
          "Use a term loan to consolidate and refinance higher-cost debt like MCAs or credit card balances. Simplify your payments and potentially reduce your costs.",
        icon: ArrowPathIcon,
      },
    ],
    documents: [
      "Business Loan Application",
      "3 Months of Business Bank Statements",
      "Phone Call with Analyst",
    ],
    highlights: [
      "Monthly Payments",
      "Available in 30 States",
      "Early Payment Discounts",
      "Can Be Used to Refinance Existing Debt",
    ],
    restrictions: [
      "Available in 30 states: AL, AZ, CA, DC, DE, HI, ID, IA, IL, IN, KS, KY, LA, MD, ME, MS, MO, NE, NH, NJ, NM, NC, OH, OR, SC, UT, VA, WA, WI, WY",
    ],
    faqs: [
      {
        question: "Is this available in my state?",
        answer:
          "Business Term Loans are currently available in 30 states: AL, AZ, CA, DC, DE, HI, ID, IA, IL, IN, KS, KY, LA, MD, ME, MS, MO, NE, NH, NJ, NM, NC, OH, OR, SC, UT, VA, WA, WI, WY. If your state isn't listed, our Merchant Cash Advance and other products are available nationwide.",
      },
      {
        question: "Why is the APR range so wide (25-75%)?",
        answer:
          "The rate depends on your credit score, revenue, time in business, and loan amount. Stronger profiles get lower rates. While these rates are higher than SBA loans, the trade-off is speed (same-day funding), accessibility (500 credit minimum), and flexibility (only 3 months in business). For many business owners, the cost is worth the speed and access.",
      },
      {
        question: "How do early payment discounts work?",
        answer:
          "If you pay off your term loan before the scheduled end date, you'll receive a discount on the remaining interest. The specific discount depends on your contract terms, but it can save you significantly. Ask your funding advisor for the exact discount schedule on your offer.",
      },
      {
        question: "Can I use this to refinance my MCA?",
        answer:
          "Yes. Many business owners use a term loan to refinance an MCA and switch from daily/weekly payments to a single monthly payment. This can improve your cash flow and, in many cases, reduce your overall cost of capital.",
      },
      {
        question: "Only 3 months in business — is there a catch?",
        answer:
          "No catch. We designed this product for newer businesses that need capital quickly. The main requirements are $20K+ in monthly revenue and a 500+ credit score. Newer businesses may receive smaller initial funding amounts, with the opportunity to increase as the business grows.",
      },
    ],
    calculatorConfig: {
      type: "apr",
      amountMin: 10000,
      amountMax: 250000,
      amountStep: 5000,
      aprMin: 25,
      aprMax: 75,
      aprStep: 1,
      termMin: 2,
      termMax: 10,
      termStep: 1,
      termUnit: "years",
      frequencies: ["monthly"],
      defaultFrequency: "monthly",
    },
  },

  // ── Business Line of Credit ──
  {
    slug: "line-of-credit",
    name: "Business Line of Credit",
    shortName: "Line of Credit",
    tagline: "A safety net for your business — only pay for what you use",
    icon: CreditCardIcon,
    color: "#10B981",
    hero: {
      badge: "Revolving Credit",
      headline: "Only Pay for What You Use. Your Business Safety Net",
      highlightWord: "Safety Net",
      subheadline:
        "Late-paying clients, surprise expenses, seasonal dips — they're all part of running a business. A line of credit means you're always ready.",
      description:
        "Access $5K to $55K in revolving credit. Draw what you need, when you need it, and only pay for what you use. Approved in 24 hours with same-day access. Weekly payments keep things manageable.",
      approvalTime: "24 Hours",
      amountRange: "$5K – $55K",
    },
    specs: [
      { label: "Credit Line", value: "$5,000 – $55,000" },
      { label: "Term Length", value: "6, 9, or 12 Months" },
      { label: "Min. Credit Score", value: "550" },
      { label: "Annual Revenue", value: "$240,000 ($20K/mo)" },
      { label: "Time in Business", value: "2 Years" },
      { label: "Approval Time", value: "24 Hours (Same Day Funding)" },
      { label: "Cost of Capital", value: "15% – 30% APR" },
    ],
    benefits: [
      {
        title: "Revolving Credit Line",
        description:
          "Unlike a lump-sum loan, a line of credit lets you draw funds as needed. Pay it down and draw again. It's always there when you need it.",
        icon: ArrowPathIcon,
      },
      {
        title: "Only Pay for What You Use",
        description:
          "If you have a $50K line but only draw $10K, you only pay interest on that $10K. No sense paying for capital you're not using.",
        icon: CurrencyDollarIcon,
      },
      {
        title: "Same-Day Access",
        description:
          "Approved in 24 hours with same-day access to your credit line. When a late-paying client puts you in a bind, you're covered.",
        icon: BoltIcon,
      },
      {
        title: "Existing Loans Allowed",
        description:
          "Already have an MCA or term loan? No problem. A line of credit can work alongside your existing financing as an additional safety net.",
        icon: CheckBadgeIcon,
      },
      {
        title: "Manageable Weekly Payments",
        description:
          "Weekly payments based on your draw amount keep things predictable and manageable. No large monthly lump sums to stress over.",
        icon: CalendarDaysIcon,
      },
      {
        title: "Moderate Cost of Capital",
        description:
          "At 15-30% APR, a line of credit is more affordable than an MCA or term loan while still being accessible to most business owners.",
        icon: ArrowTrendingUpIcon,
      },
    ],
    documents: [
      "Business Loan Application",
      "4 Months of Business Bank Statements",
      "Driver's License",
      "Voided Check",
    ],
    highlights: [
      "Revolving Line of Credit",
      "Pay Only for Funds Used",
      "Weekly Payments",
      "Existing Loans Allowed",
    ],
    faqs: [
      {
        question: "How does a revolving line of credit work?",
        answer:
          "Think of it like a business credit card. You're approved for a credit limit (say $40K). You can draw any amount up to that limit whenever you need it. As you repay, that credit becomes available again. It's always-on capital for your business.",
      },
      {
        question: "Can I have a line of credit AND an MCA at the same time?",
        answer:
          "Yes. A line of credit can complement your existing MCA, term loan, or other financing. Many business owners use an MCA for a specific project and keep a line of credit open as a general safety net for day-to-day cash flow needs.",
      },
      {
        question: "What can I use the funds for?",
        answer:
          "Anything business-related: payroll gaps, inventory purchases, unexpected repairs, seasonal slow periods, bridging cash flow while waiting on invoice payments, or taking on new opportunities. The flexibility is the whole point.",
      },
      {
        question: "Why are terms only 6-12 months?",
        answer:
          "Lines of credit are designed for short-term working capital needs, not long-term investments. The shorter terms keep costs manageable. When your term ends, you can reapply for a new line — often at better terms based on your payment history.",
      },
      {
        question: "What's the minimum draw amount?",
        answer:
          "You can typically draw as little as $500 at a time. There's no requirement to use the full line. Many business owners keep it open and only draw when they need it — like insurance for your cash flow.",
      },
    ],
    calculatorConfig: {
      type: "apr",
      amountMin: 5000,
      amountMax: 55000,
      amountStep: 1000,
      aprMin: 15,
      aprMax: 30,
      aprStep: 0.5,
      termMin: 6,
      termMax: 12,
      termStep: 3,
      termUnit: "months",
      frequencies: ["weekly"],
      defaultFrequency: "weekly",
    },
  },
];

// ────────────────────────────────────────
// Helpers
// ────────────────────────────────────────

export function getProductBySlug(slug: string): LoanProduct | undefined {
  return products.find((p) => p.slug === slug);
}

export function getAllProducts(): LoanProduct[] {
  return products;
}
