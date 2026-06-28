import { useParams, Navigate } from 'react-router-dom';
import { getProductBySlug } from '../../data/products';
import ProductPageLayout from '../../components/business-loans/ProductPageLayout';
import SEO, {
  generateProductSchema,
  generateFAQSchema,
  generateBreadcrumbSchema,
} from '../../components/seo/SEO';

export default function ProductDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const product = slug ? getProductBySlug(slug) : undefined;

  if (!product) {
    return <Navigate to="/business-loans" replace />;
  }

  const url = `https://mfunding.net/business-loans/${product.slug}`;
  // MCA is a purchase of future receivables, not a loan → FinancialProduct.
  const isMCA = product.slug === 'merchant-cash-advance';

  const structuredData: object[] = [
    generateProductSchema({
      name: product.name,
      description: product.hero.description,
      url,
      productType: isMCA ? 'FinancialProduct' : 'LoanOrCredit',
    }),
    generateBreadcrumbSchema([
      { name: 'Home', url: 'https://mfunding.net/' },
      { name: 'Business Loans', url: 'https://mfunding.net/business-loans' },
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
        keywords={`${product.name.toLowerCase()}, ${product.tagline.toLowerCase()}, business funding, momentum funding`}
        canonical={url}
        ogType="product"
        structuredData={structuredData}
      />
      <ProductPageLayout product={product} />
    </>
  );
}
