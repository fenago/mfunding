import { useParams, Navigate } from 'react-router-dom';
import { getProductBySlug } from '../../data/products';
import ProductPageLayout from '../../components/business-loans/ProductPageLayout';
import SEO from '../../components/seo/SEO';

export default function ProductDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const product = slug ? getProductBySlug(slug) : undefined;

  if (!product) {
    return <Navigate to="/business-loans" replace />;
  }

  return (
    <>
      <SEO
        title={product.name}
        description={product.hero.description}
        keywords={`${product.name.toLowerCase()}, ${product.tagline.toLowerCase()}, business funding, momentum funding`}
      />
      <ProductPageLayout product={product} />
    </>
  );
}
