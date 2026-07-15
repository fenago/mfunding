import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import supabase from "../supabase";
import {
  WrenchScrewdriverIcon,
  LifebuoyIcon,
  BanknotesIcon,
  CalculatorIcon,
  BriefcaseIcon,
  ClipboardDocumentCheckIcon,
  MagnifyingGlassIcon,
  ScaleIcon,
  ExclamationTriangleIcon,
  HandRaisedIcon,
  ChartBarSquareIcon,
  ArrowRightIcon,
} from "@heroicons/react/24/outline";
import Navbar from "../components/landing/Navbar";
import Footer from "../components/landing/Footer";
import ScrollToTop from "../components/ui/ScrollToTop";
import SEO from "../components/seo/SEO";

interface ToolCard {
  to: string;
  title: string;
  desc: string;
  icon: typeof BanknotesIcon;
}

const CALCULATORS: ToolCard[] = [
  {
    to: "/calculators/mca-debt-relief",
    title: "MCA Debt Relief Savings",
    desc: "Estimate how much you could save by restructuring stacked merchant cash advances.",
    icon: LifebuoyIcon,
  },
  {
    to: "/calculators/how-much-can-i-get",
    title: "How Much Can I Get?",
    desc: "See your estimated working-capital range based on your monthly revenue.",
    icon: BanknotesIcon,
  },
  {
    to: "/calculators/advance-cost",
    title: "Advance Cost Calculator",
    desc: "Understand the true cost of an advance — factor rate, payback, and daily debit.",
    icon: CalculatorIcon,
  },
  {
    to: "/careers/closer-earnings",
    title: "Closer Earnings Calculator",
    desc: "Project your commission income as an MCA closer on the Momentum team.",
    icon: BriefcaseIcon,
  },
];

const ASSESSMENTS: ToolCard[] = [
  {
    to: "/assessments/funding-readiness-score",
    title: "Funding Readiness Score",
    desc: "Find out how ready your business is to get approved for funding today.",
    icon: ClipboardDocumentCheckIcon,
  },
  {
    to: "/assessments/find-your-funding",
    title: "Find Your Funding",
    desc: "Answer a few questions and get matched to the right funding product for you.",
    icon: MagnifyingGlassIcon,
  },
  {
    to: "/assessments/how-much-can-you-handle",
    title: "How Much Can You Handle?",
    desc: "Gauge a responsible funding amount your cash flow can comfortably support.",
    icon: ScaleIcon,
  },
  {
    to: "/assessments/mca-debt-stress-test",
    title: "MCA Debt Stress Test",
    desc: "Pressure-test your existing advances to see if your payments are sustainable.",
    icon: ExclamationTriangleIcon,
  },
  {
    to: "/assessments/do-you-qualify-for-relief",
    title: "Do You Qualify for Relief?",
    desc: "Check whether your situation qualifies for an MCA debt-relief program.",
    icon: HandRaisedIcon,
  },
  {
    to: "/assessments/business-health-scorecard",
    title: "Business Health Scorecard",
    desc: "Grade your business across cash flow, debt, growth, and margins — with tailored tips.",
    icon: ClipboardDocumentCheckIcon,
  },
  {
    to: "/assessments/cash-flow-gap-analyzer",
    title: "Cash Flow Gap Analyzer",
    desc: "Spot the months you'll run short and the working-capital buffer you need.",
    icon: ChartBarSquareIcon,
  },
];

function Card({ tool }: { tool: ToolCard }) {
  const Icon = tool.icon;
  return (
    <Link
      to={tool.to}
      className="group relative flex flex-col rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-sm transition-all hover:-translate-y-1 hover:shadow-xl hover:border-mint-green"
    >
      <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-mint-green/10 text-mint-green">
        <Icon className="h-6 w-6" />
      </div>
      <h3 className="text-lg font-bold text-heading mb-1.5">{tool.title}</h3>
      <p className="text-sm text-body leading-relaxed flex-1">{tool.desc}</p>
      <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-ocean-blue group-hover:gap-2 transition-all">
        Open tool <ArrowRightIcon className="h-4 w-4" />
      </span>
    </Link>
  );
}

export default function FreeToolsPage() {
  // Respect the admin enable/disable toggle (lead_tools). null = not loaded yet,
  // so we show all by default and never hide everything on a fetch error.
  const [enabledPaths, setEnabledPaths] = useState<Set<string> | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase.from("lead_tools").select("path, enabled");
        if (error || !data) return;
        setEnabledPaths(new Set(data.filter((t) => t.enabled).map((t) => t.path)));
      } catch {
        /* keep null = show all */
      }
    })();
  }, []);
  const show = (t: ToolCard) => enabledPaths === null || enabledPaths.has(t.to);
  const calculators = CALCULATORS.filter(show);
  const assessments = ASSESSMENTS.filter(show);

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 flex flex-col">
      <SEO
        title="Free Business Funding Tools & Calculators"
        description="Free calculators and assessments to plan your business funding — estimate working capital, analyze cash flow gaps, stress-test MCA debt, and grade your financial health."
        keywords="free business funding tools, MCA calculator, cash flow analyzer, business health scorecard, working capital calculator"
      />
      <Navbar lightBg />
      <ScrollToTop />

      <main className="flex-1">
        {/* Hero */}
        <section className="bg-brand-gradient-hero text-white">
          <div className="container-max py-16 lg:py-20">
            <div className="max-w-3xl">
              <span className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 border border-white/15 rounded-full text-sm font-medium mb-6">
                <WrenchScrewdriverIcon className="w-4 h-4" />
                Free for Business Owners
              </span>
              <h1 className="text-4xl lg:text-5xl font-bold leading-tight mb-5">
                Free Tools &amp; <span className="text-mint-green">Calculators</span>
              </h1>
              <p className="text-lg text-white/80 leading-relaxed">
                Plan smarter before you fund. Estimate your working capital, analyze seasonal cash
                flow gaps, stress-test existing advances, and grade your financial health — all free,
                with no credit impact.
              </p>
            </div>
          </div>
        </section>

        {/* Calculators */}
        <section className="container-max py-14">
          <div className="max-w-6xl mx-auto">
            <div className="flex items-center gap-2 mb-6">
              <CalculatorIcon className="w-6 h-6 text-ocean-blue" />
              <h2 className="text-2xl font-bold text-heading">Calculators</h2>
            </div>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {calculators.map((t) => (
                <Card key={t.to} tool={t} />
              ))}
            </div>
          </div>
        </section>

        {/* Assessments */}
        <section className="container-max pb-16">
          <div className="max-w-6xl mx-auto">
            <div className="flex items-center gap-2 mb-6">
              <ClipboardDocumentCheckIcon className="w-6 h-6 text-ocean-blue" />
              <h2 className="text-2xl font-bold text-heading">Assessments</h2>
            </div>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {assessments.map((t) => (
                <Card key={t.to} tool={t} />
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="container-max pb-20">
          <div className="max-w-6xl mx-auto rounded-2xl bg-brand-gradient-hero text-white p-10 text-center">
            <h2 className="text-2xl lg:text-3xl font-bold mb-3">Ready to talk to a specialist?</h2>
            <p className="text-white/80 mb-6 max-w-2xl mx-auto">
              Skip the tools and get matched to real funding options. Free, no obligation, and no
              credit impact to check.
            </p>
            <Link
              to="/apply"
              className="inline-flex items-center gap-2 px-8 py-3.5 rounded-lg bg-mint-green text-midnight-blue font-bold hover:opacity-90"
            >
              Get started <ArrowRightIcon className="w-5 h-5" />
            </Link>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
