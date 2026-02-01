import Navbar from '../components/landing/Navbar';
import HeroSection from '../components/landing/HeroSection';
import ProblemSection from '../components/landing/ProblemSection';
import SolutionSection from '../components/landing/SolutionSection';
import FeaturesSection from '../components/landing/FeaturesSection';
import CalculatorSection from '../components/landing/CalculatorSection';
import CaseStudySection from '../components/landing/CaseStudySection';
import HowItWorksSection from '../components/landing/HowItWorksSection';
import SecuritySection from '../components/landing/SecuritySection';
import VideoSection from '../components/landing/VideoSection';
import ApplySection from '../components/landing/ApplySection';
import Footer from '../components/landing/Footer';
import { SpotlightCursor } from '../components/ui/spotlight-cursor';
import StickyApplyCTA from '../components/ui/StickyApplyCTA';
import ScrollToTop from '../components/ui/ScrollToTop';

const HomePage = () => {
  return (
    <>
      {/* Global spotlight cursor effect */}
      <SpotlightCursor config={{ radius: 300, brightness: 0.08, color: '#00D49D' }} />

      <Navbar />
      <StickyApplyCTA />
      <ScrollToTop />
      <main>
        <HeroSection />
        <ProblemSection />
        <SolutionSection />
        <FeaturesSection />
        <CalculatorSection />
        <CaseStudySection />
        <HowItWorksSection />
        <SecuritySection />
        <VideoSection />
        <ApplySection />
      </main>
      <Footer />
    </>
  );
};

export default HomePage;
