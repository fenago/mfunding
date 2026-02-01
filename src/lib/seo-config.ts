/**
 * SEO Configuration and Keyword Strategy
 *
 * This file contains the SEO strategy for Momentum Funding.
 * Use these keywords in content, alt text, and metadata.
 */

// Primary target keywords (high volume, high intent)
export const PRIMARY_KEYWORDS = [
  'small business funding',
  'merchant cash advance',
  'business line of credit',
  'equipment financing',
  'fast business loans',
  'working capital',
  'business funding',
];

// Secondary keywords (medium volume, high intent)
export const SECONDARY_KEYWORDS = [
  'business loan alternative',
  'bad credit business loan',
  'quick business funding',
  'same day business funding',
  'business funding fast approval',
  'unsecured business loan',
  'revenue based financing',
  'cash advance for business',
];

// Long-tail keywords (lower volume, highest intent - "Mike Chen" avatar)
export const LONGTAIL_KEYWORDS = [
  'business funding after bank rejection',
  'small business loan no credit check',
  'emergency business funding',
  'working capital for small business',
  'business loan denied by bank',
  'alternative business financing',
  'MCA for small business',
  'payroll funding for small business',
  'business funding for contractors',
  'restaurant business loan',
  'trucking company funding',
  'construction business loan',
  'business cash advance near me',
  'how to get business funding fast',
  'business loan with bad credit score',
  'funding for seasonal business',
  'short term business loan',
  'business capital no collateral',
];

// Industry-specific keywords
export const INDUSTRY_KEYWORDS: Record<string, string[]> = {
  construction: [
    'construction business loans',
    'contractor financing',
    'equipment financing for contractors',
    'construction company working capital',
  ],
  restaurant: [
    'restaurant business loans',
    'restaurant equipment financing',
    'restaurant cash advance',
    'food service business funding',
  ],
  trucking: [
    'trucking company loans',
    'commercial truck financing',
    'freight company funding',
    'trucking business capital',
  ],
  retail: [
    'retail business loans',
    'inventory financing',
    'retail store funding',
    'merchant financing',
  ],
  healthcare: [
    'medical practice loans',
    'healthcare business funding',
    'dental practice financing',
    'medical equipment financing',
  ],
};

// Location-based keywords (for future local SEO pages)
export const LOCATION_KEYWORDS = [
  'business funding [city]',
  'small business loans [state]',
  'MCA [city]',
  'business capital [city]',
];

// Question-based keywords (for FAQ and content)
export const QUESTION_KEYWORDS = [
  'how to get a business loan with bad credit',
  'what is a merchant cash advance',
  'how long does it take to get business funding',
  'what credit score do I need for a business loan',
  'can I get a business loan if the bank denied me',
  'what documents do I need for a business loan',
  'how much business funding can I qualify for',
  'is a merchant cash advance a loan',
  'do I need collateral for a business loan',
  'how does revenue based financing work',
];

// Competitor comparison keywords
export const COMPARISON_KEYWORDS = [
  'MCA vs business loan',
  'bank loan alternative',
  'SBA loan alternative',
  'online business loans',
  'fintech business funding',
];

// Meta description templates
export const META_TEMPLATES = {
  homepage: (stat: string) =>
    `Get $25K-$500K business funding in 24-48 hours. ${stat}% approval rate. No collateral required. Merchant cash advance, business lines of credit & equipment financing.`,

  fundingPage: (type: string, amount: string) =>
    `${type} for small businesses. Get up to ${amount} in funding. Fast approval, no collateral required. Apply online in 5 minutes.`,

  industryPage: (industry: string) =>
    `Business funding for ${industry} companies. Get $25K-$500K in 24-48 hours. 93% approval rate. Specialized financing solutions.`,

  locationPage: (city: string, state: string) =>
    `Small business funding in ${city}, ${state}. Merchant cash advance, lines of credit & more. Get funded in 24-48 hours. Apply now.`,
};

// Title tag templates
export const TITLE_TEMPLATES = {
  homepage: 'Fast Business Funding When Banks Say No | Momentum Funding',
  fundingType: (type: string) => `${type} | Fast Approval | Momentum Funding`,
  industry: (industry: string) => `Business Funding for ${industry} | Momentum Funding`,
  location: (city: string) => `Business Funding in ${city} | Momentum Funding`,
  article: (title: string) => `${title} | Momentum Funding Blog`,
};

// Structured data configurations
export const SCHEMA_CONFIG = {
  organization: {
    '@type': 'FinancialService',
    name: 'Momentum Funding',
    url: 'https://momentumfunding.com',
  },
  rating: {
    ratingValue: '4.9',
    reviewCount: '2847',
    bestRating: '5',
    worstRating: '1',
  },
  priceRange: '$25,000 - $3,000,000',
  areaServed: 'United States',
};

// Image alt text templates
export const ALT_TEXT_TEMPLATES = {
  hero: 'Small business owner receiving fast business funding from Momentum Funding',
  funding: (type: string) => `${type} funding for small businesses - Momentum Funding`,
  testimonial: (name: string, business: string) => `${name} from ${business} - Momentum Funding success story`,
  calculator: 'Business funding calculator - estimate your funding amount',
  process: (step: string) => `${step} - Momentum Funding application process`,
};

// Internal linking strategy
export const INTERNAL_LINKS = {
  primaryCTA: '#apply',
  calculator: '#calculator',
  features: '#features',
  howItWorks: '#how-it-works',
  faq: '#faq',
  caseStudy: '#case-study',
};

// External linking strategy (for future content/blog)
export const EXTERNAL_LINKS = {
  sba: 'https://www.sba.gov/',
  federalReserve: 'https://www.federalreserve.gov/',
  // Add trusted industry sources
};

// Page speed and Core Web Vitals targets
export const PERFORMANCE_TARGETS = {
  lcp: 2500, // Largest Contentful Paint (ms)
  fid: 100,  // First Input Delay (ms)
  cls: 0.1,  // Cumulative Layout Shift
  ttfb: 800, // Time to First Byte (ms)
};
