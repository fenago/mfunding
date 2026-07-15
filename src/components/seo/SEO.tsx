import { Helmet } from 'react-helmet-async';
import { useLocation } from 'react-router-dom';

export interface SEOProps {
  title?: string;
  description?: string;
  keywords?: string;
  canonical?: string;
  ogImage?: string;
  ogType?: 'website' | 'article' | 'product';
  twitterCard?: 'summary' | 'summary_large_image';
  noIndex?: boolean;
  structuredData?: object | object[];
}

// Default SEO values
const defaults = {
  siteName: 'Momentum Funding',
  titleTemplate: '%s | Momentum Funding',
  defaultTitle: 'Fast Business Funding When Banks Say No | Momentum Funding',
  defaultDescription: 'Get $5K-$3M business funding in 24-48 hours. 93% approval rate. No collateral required. Merchant cash advance, business lines of credit & equipment financing.',
  defaultKeywords: 'small business funding, merchant cash advance, business line of credit, equipment financing, fast business loans, working capital',
  siteUrl: 'https://mfunding.net',
  defaultImage: 'https://mfunding.net/og-image.jpg',
  twitterHandle: '@momentumfunding',
};

export default function SEO({
  title,
  description = defaults.defaultDescription,
  keywords = defaults.defaultKeywords,
  canonical,
  ogImage = defaults.defaultImage,
  ogType = 'website',
  twitterCard = 'summary_large_image',
  noIndex = false,
  structuredData,
}: SEOProps) {
  const pageTitle = title
    ? defaults.titleTemplate.replace('%s', title)
    : defaults.defaultTitle;

  // Always emit a self-referencing canonical. When one isn't passed explicitly,
  // build it from the current route so every page gets a unique, correct canonical
  // (works in the browser and during build-time prerendering via react-router).
  const { pathname } = useLocation();
  const path = pathname && pathname !== '/' ? pathname.replace(/\/$/, '') : '';
  const canonicalUrl = canonical || `${defaults.siteUrl}${path || '/'}`;

  return (
    <Helmet>
      {/* Primary Meta Tags */}
      <title>{pageTitle}</title>
      <meta name="description" content={description} />
      <meta name="keywords" content={keywords} />
      <link rel="canonical" href={canonicalUrl} />
      {noIndex && <meta name="robots" content="noindex, nofollow" />}

      {/* Open Graph */}
      <meta property="og:type" content={ogType} />
      <meta property="og:title" content={pageTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:image" content={ogImage} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:image:alt" content={pageTitle} />
      <meta property="og:url" content={canonicalUrl} />
      <meta property="og:site_name" content={defaults.siteName} />

      {/* Twitter Card */}
      <meta name="twitter:card" content={twitterCard} />
      <meta name="twitter:title" content={pageTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={ogImage} />
      <meta name="twitter:site" content={defaults.twitterHandle} />

      {/* Structured Data */}
      {structuredData && (
        <script type="application/ld+json">
          {JSON.stringify(
            Array.isArray(structuredData)
              ? structuredData
              : structuredData
          )}
        </script>
      )}
    </Helmet>
  );
}

// Pre-configured SEO for specific pages
export const HomePageSEO = () => (
  <SEO
    title="Fast Business Funding When Banks Say No"
    description="Get $5K-$3M business funding in 24-48 hours. 93% approval rate. No collateral required. Merchant cash advance, business lines of credit & equipment financing for small business owners."
    keywords="small business funding, merchant cash advance, business line of credit, equipment financing, fast business loans, working capital, business funding bad credit, alternative business financing, MCA funding, quick business loans, same day business funding"
  />
);

export const SignInPageSEO = () => (
  <SEO
    title="Sign In to Your Account"
    description="Access your Momentum Funding account to track your application, view funding status, and manage your business capital."
    keywords="momentum funding login, business funding account, MCA portal"
    noIndex={true}
  />
);

export const SignUpPageSEO = () => (
  <SEO
    title="Create Your Account"
    description="Create a free Momentum Funding account to start your business funding application. Check your rate in minutes with no credit impact."
    keywords="apply for business funding, MCA application, business loan application"
  />
);

export const AdminPageSEO = () => (
  <SEO
    title="Admin Dashboard"
    description="Momentum Funding Admin Dashboard"
    noIndex={true}
  />
);

// Utility function to generate article structured data
export function generateArticleSchema(article: {
  title: string;
  description: string;
  url: string;
  image: string;
  datePublished: string;
  dateModified?: string;
  author: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    description: article.description,
    url: article.url,
    image: article.image,
    datePublished: article.datePublished,
    dateModified: article.dateModified || article.datePublished,
    author: {
      '@type': 'Organization',
      name: article.author,
    },
    publisher: {
      '@type': 'Organization',
      name: 'Momentum Funding',
      logo: {
        '@type': 'ImageObject',
        url: 'https://mfunding.net/logo.png',
      },
    },
  };
}

// Utility: FAQPage schema from a list of Q&A pairs (AEO — wins "People Also Ask" + AI Overviews)
export function generateFAQSchema(faqs: { question: string; answer: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: { '@type': 'Answer', text: f.answer },
    })),
  };
}

// Utility: BreadcrumbList schema for nested pages
export function generateBreadcrumbSchema(
  crumbs: { name: string; url: string }[]
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: c.url,
    })),
  };
}

// Utility: product schema for funding products.
// IMPORTANT (compliance): MCA is NOT a loan — use 'FinancialProduct' and avoid loan/interest
// language. Actual loans (SBA, term, equipment, CRE) use 'LoanOrCredit'.
export function generateProductSchema(product: {
  name: string;
  description: string;
  url: string;
  productType?: 'FinancialProduct' | 'LoanOrCredit';
  amountMin?: number;
  amountMax?: number;
}) {
  const base: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': product.productType || 'FinancialProduct',
    name: product.name,
    description: product.description,
    url: product.url,
    category: 'Business Funding',
    provider: {
      '@type': 'FinancialService',
      name: 'Momentum Funding',
      legalName: 'Agentic Voice Inc.',
      url: 'https://mfunding.net',
    },
  };
  if (product.amountMin != null && product.amountMax != null) {
    base.amount = {
      '@type': 'MonetaryAmount',
      currency: 'USD',
      minValue: product.amountMin,
      maxValue: product.amountMax,
    };
  }
  return base;
}

// Utility function to generate local business schema
export function generateLocalBusinessSchema(business: {
  name: string;
  address: {
    street: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
  phone: string;
  hours?: string[];
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FinancialService',
    name: business.name,
    address: {
      '@type': 'PostalAddress',
      streetAddress: business.address.street,
      addressLocality: business.address.city,
      addressRegion: business.address.state,
      postalCode: business.address.zip,
      addressCountry: business.address.country,
    },
    telephone: business.phone,
    openingHours: business.hours,
  };
}
