import { useParams, Navigate } from 'react-router-dom';
import { getCREProductBySlug } from '../../data/cre-products';
import CREPageLayout from '../../components/real-estate/CREPageLayout';
import SEO from '../../components/seo/SEO';

export default function RealEstateDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const product = slug ? getCREProductBySlug(slug) : undefined;

  if (!product) {
    return <Navigate to="/real-estate" replace />;
  }

  return (
    <>
      <SEO
        title={product.name}
        description={product.hero.description}
        keywords={`${product.name.toLowerCase()}, real estate financing, ${product.tagline.toLowerCase()}, momentum funding`}
      />
      <CREPageLayout product={product} />
    </>
  );
}
