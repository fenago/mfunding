// OSCREDetail — the Momentum OS template for a single real-estate loan program.
// Replaces the legacy CREPageLayout stack with the dispatch-board system, driven
// by the same CRE product data. These ARE loans, so standard lending terminology
// is correct here.
import ScrollToTop from "../../../ui/ScrollToTop";
import { OS_CSS, useOSFonts } from "../OSKit";
import OSNav from "../OSNav";
import OSFooter from "../OSFooter";
import { MONEY_CSS, MoneyDetailHero, BenefitGrid, DocChecklist, FAQAccordion, MoneyCTA } from "./MoneyKit";
import OSCRECalculator from "./OSCRECalculator";
import type { CREProduct } from "../../../../data/cre-products";

export default function OSCREDetail({ product }: { product: CREProduct }) {
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
        title={<>BUILT FOR <span className="os-go">{product.shortName.toUpperCase()}.</span></>}
      />

      <OSCRECalculator defaultProduct={product.slug} />

      <DocChecklist documents={product.documents} restrictions={product.restrictions} />

      <FAQAccordion faqs={product.faqs} tone="ink" />

      <MoneyCTA
        eyebrow="HAVE A DEAL?"
        title={<>CLOSE ON <span className="os-go">SCHEDULE.</span></>}
        sub={`Submit your scenario and get a term sheet within 48 hours. ${product.hero.amountRange} · close in ${product.hero.approvalTime}.`}
        cta="Submit your loan scenario"
        chips={["ALL 50 STATES", "$100K – $50M", "NO CREDIT IMPACT TO CHECK"]}
      />

      <OSFooter />
    </div>
  );
}
