// OSProductDetail — the Momentum OS template for a single business-funding product.
// Replaces the legacy ProductPageLayout stack (ProductHero / QuickSpecsCard /
// ProductBenefits / LoanCalculator / ProductDocuments / ProductFAQ / ProductCTA)
// with the dispatch-board system, driven entirely by the same product data.
import ScrollToTop from "../../../ui/ScrollToTop";
import { OS_CSS, useOSFonts, OSSection } from "../OSKit";
import OSNav from "../OSNav";
import OSFooter from "../OSFooter";
import { MONEY_CSS, MoneyDetailHero, BenefitGrid, DocChecklist, FAQAccordion, MoneyCTA } from "./MoneyKit";
import OSCalculator from "./OSCalculator";
import type { LoanProduct } from "../../../../data/products";

export default function OSProductDetail({ product }: { product: LoanProduct }) {
  useOSFonts();
  return (
    <div className="os-root">
      <style>{OS_CSS}</style>
      <style>{MONEY_CSS}</style>
      <ScrollToTop />
      <OSNav />

      <MoneyDetailHero product={product} />

      <BenefitGrid
        benefits={product.benefits}
        title={<>WHY OWNERS PICK <span className="os-go">{product.shortName.toUpperCase()}.</span></>}
      />

      <OSCalculator defaultProduct={product.slug} />

      <DocChecklist documents={product.documents} restrictions={product.restrictions} />

      {product.flyer && (
        <OSSection tone="panel">
          <div className="money-flyer">
            <img className="money-flyer-img" src={product.flyer.url} alt={`${product.shortName} overview`} />
            <div className="money-flyer-copy">
              <h3 className="money-flyer-title">{product.shortName.toUpperCase()} · ONE-PAGE OVERVIEW</h3>
              <p className="money-flyer-desc">Program details, benefits, and qualification requirements on a single sheet.</p>
              <a className="os-cta-ghost" href={product.flyer.url} download>{product.flyer.label}</a>
            </div>
          </div>
        </OSSection>
      )}

      <FAQAccordion faqs={product.faqs} tone="ink" />

      <MoneyCTA
        title={<>GET FUNDED. <span className="os-go">KEEP MOVING.</span></>}
        sub={`Apply once and we match your business to the ${product.shortName} terms that actually fit — across our whole network.`}
        chips={["5-MINUTE APPLICATION", "WON'T AFFECT CREDIT", "NO UPFRONT FEES"]}
      />

      <OSFooter />

      <style>{FLYER_CSS}</style>
    </div>
  );
}

const FLYER_CSS = `
.money-flyer{display:flex;gap:32px;align-items:center;max-width:760px;margin:0 auto;flex-wrap:wrap;justify-content:center}
.money-flyer-img{width:200px;border-radius:12px;border:1px solid var(--hair);box-shadow:0 24px 50px -24px var(--shadow)}
.money-flyer-copy{flex:1;min-width:240px}
.money-flyer-title{font-family:'Anton',sans-serif;font-weight:400;font-size:22px;color:var(--tx);margin:0 0 10px;letter-spacing:.01em}
.money-flyer-desc{font-size:15px;line-height:1.6;color:var(--muted);margin:0 0 20px}
`;
