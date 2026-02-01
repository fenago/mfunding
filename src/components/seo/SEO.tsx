import { Helmet } from 'react-helmet-async';

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
  defaultDescription: 'Get $25K-$500K business funding in 24-48 hours. 93% approval rate. No collateral required. Merchant cash advance, business lines of credit & equipment financing.',
  defaultKeywords: 'small business funding, merchant cash advance, business line of credit, equipment financing, fast business loans, working capital',
  siteUrl: 'https://momentumfunding.com',
  defaultImage: 'https://momentumfunding.com/og-image.jpg',
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

  const canonicalUrl = canonical || defaults.siteUrl;

  return (
    <Helmet>
      {/* Primary Meta Tags */}
      <title>{pageTitle}</title>
      <meta name="description" content={description} />
      <meta name="keywords" content={keywords} />
      {canonical && <link rel="canonical" href={canonicalUrl} />}
      {noIndex && <meta name="robots" content="noindex, nofollow" />}

      {/* Open Graph */}
      <meta property="og:type" content={ogType} />
      <meta property="og:title" content={pageTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:image" content={ogImage} />
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
    description="Get $25K-$500K business funding in 24-48 hours. 93% approval rate. No collateral required. Merchant cash advance, business lines of credit & equipment financing for small business owners."
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
        url: 'https://momentumfunding.com/logo.png',
      },
    },
  };
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
