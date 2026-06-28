import { useParams, Navigate } from 'react-router-dom';
import { getCREProductBySlug } from '../../data/cre-products';
import CREPageLayout from '../../components/real-estate/CREPageLayout';
import SEO, {
  generateProductSchema,
  generateFAQSchema,
  generateBreadcrumbSchema,
} from '../../components/seo/SEO';

export default function RealEstateDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const product = slug ? getCREProductBySlug(slug) : undefined;

  if (!product) {
    return <Navigate to="/real-estate" replace />;
  }

  const url = `https://mfunding.net/real-estate/${product.slug}`;
  const structuredData: object[] = [
    generateProductSchema({
      name: product.name,
      description: product.hero.description,
      url,
      productType: 'LoanOrCredit',
    }),
    generateBreadcrumbSchema([
      { name: 'Home', url: 'https://mfunding.net/' },
      { name: 'Real Estate', url: 'https://mfunding.net/real-estate' },
      { name: product.shortName, url },
    ]),
  ];
  if (product.faqs?.length) {
    structuredData.push(generateFAQSchema(product.faqs));
  }

  return (
    <>
      <SEO
        title={product.name}
        description={product.hero.description}
        keywords={`${product.name.toLowerCase()}, real estate financing, ${product.tagline.toLowerCase()}, momentum funding`}
        canonical={url}
        ogType="product"
        structuredData={structuredData}
      />
      <CREPageLayout product={product} />
    </>
  );
}
