import Navbar from '../landing/Navbar';
import Footer from '../landing/Footer';
import ProductHero from '../business-loans/ProductHero';
import QuickSpecsCard from '../business-loans/QuickSpecsCard';
import ProductBenefits from '../business-loans/ProductBenefits';
import CRECalculator from './CRECalculator';
import ProductDocuments from '../business-loans/ProductDocuments';
import ProductFAQSection from '../business-loans/ProductFAQ';
import ProductCTA from '../business-loans/ProductCTA';
import ScrollToTop from '../ui/ScrollToTop';
import type { CREProduct } from '../../data/cre-products';

interface CREPageLayoutProps {
  product: CREProduct;
}

export default function CREPageLayout({ product }: CREPageLayoutProps) {
  return (
    <>
      <Navbar />
      <ScrollToTop />
      <main>
        {/* CREProduct is structurally compatible with LoanProduct */}
        <ProductHero product={product as any} />
        <QuickSpecsCard specs={product.specs} color={product.color} />
        <ProductBenefits benefits={product.benefits} color={product.color} />
        <CRECalculator defaultProduct={product.slug} />
        <ProductDocuments
          documents={product.documents}
          restrictions={product.restrictions}
        />
        <ProductFAQSection faqs={product.faqs} />
        <ProductCTA productName={product.name} />
      </main>
      <Footer />
    </>
  );
}
