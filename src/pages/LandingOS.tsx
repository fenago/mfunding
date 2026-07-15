// LandingOS — the redesigned landing page ("Momentum OS", dispatch-board system).
// Loads the shared fonts + tokens once, then renders every section from src/components/
// landing/os/*. Preview at /landing-os until promoted to "/".
import { HomePageSEO } from "../components/seo/SEO";
import ScrollToTop from "../components/ui/ScrollToTop";
import { OS_CSS, useOSFonts } from "../components/landing/os/OSKit";
import OSHero from "../components/landing/os/OSHero";
import OSProblem from "../components/landing/os/OSProblem";
import OSProducts from "../components/landing/os/OSProducts";
import OSHowItWorks from "../components/landing/os/OSHowItWorks";
import OSWhoWeFund from "../components/landing/os/OSWhoWeFund";
import OSProof from "../components/landing/os/OSProof";
import OSFaq from "../components/landing/os/OSFaq";
import OSFinalCTA from "../components/landing/os/OSFinalCTA";

export default function LandingOS() {
  useOSFonts();
  return (
    <div className="os-root">
      <style>{OS_CSS}</style>
      <HomePageSEO />
      <ScrollToTop />
      <OSHero />
      <OSProblem />
      <OSProducts />
      <OSHowItWorks />
      <OSWhoWeFund />
      <OSProof />
      <OSFaq />
      <OSFinalCTA />
    </div>
  );
}
