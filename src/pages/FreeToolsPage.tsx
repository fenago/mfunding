import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import supabase from "../supabase";
import {
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
} from "@heroicons/react/24/outline";
import SEO from "../components/seo/SEO";
import { OSSection, Eyebrow, Display, Lede, CTAPrimary } from "../components/landing/os/OSKit";
import { ToolShell } from "../components/landing/os/tools/ToolsKit";

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

function ToolTile({ tool }: { tool: ToolCard }) {
  const Icon = tool.icon;
  return (
    <Link to={tool.to} className="os-card ost-toolcard">
      <span className="ost-toolico">
        <Icon />
      </span>
      <h3 className="ost-toolname">{tool.title}</h3>
      <p className="ost-tooldesc">{tool.desc}</p>
      <span className="ost-toolopen">
        Open tool <span aria-hidden>→</span>
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
    <ToolShell>
      <SEO
        title="Free Business Funding Tools & Calculators"
        description="Free calculators and assessments to plan your business funding — estimate working capital, analyze cash flow gaps, stress-test MCA debt, and grade your financial health."
        keywords="free business funding tools, MCA calculator, cash flow analyzer, business health scorecard, working capital calculator"
      />

      <OSSection tone="ink">
        <div className="ost-herobox">
          <Eyebrow>FREE FOR BUSINESS OWNERS</Eyebrow>
          <Display>
            TOOLS &amp; <span className="os-go">CALCULATORS</span>
          </Display>
          <Lede>
            Plan smarter before you fund. Estimate your working capital, analyze seasonal cash-flow
            gaps, stress-test existing advances, and grade your financial health — all free, with{" "}
            <strong>no credit impact</strong>.
          </Lede>
        </div>
      </OSSection>

      <OSSection tone="panel">
        {calculators.length > 0 && (
          <div className="ost-group">
            <div className="ost-groupbar">
              <span className="ost-groupbar-title">
                <CalculatorIcon /> Calculators
              </span>
              <span className="ost-groupbar-count">
                {calculators.length} {calculators.length === 1 ? "TOOL" : "TOOLS"}
              </span>
            </div>
            <div className="ost-toolgrid">
              {calculators.map((t) => (
                <ToolTile key={t.to} tool={t} />
              ))}
            </div>
          </div>
        )}

        {assessments.length > 0 && (
          <div className="ost-group">
            <div className="ost-groupbar">
              <span className="ost-groupbar-title">
                <ClipboardDocumentCheckIcon /> Assessments
              </span>
              <span className="ost-groupbar-count">
                {assessments.length} {assessments.length === 1 ? "TOOL" : "TOOLS"}
              </span>
            </div>
            <div className="ost-toolgrid">
              {assessments.map((t) => (
                <ToolTile key={t.to} tool={t} />
              ))}
            </div>
          </div>
        )}
      </OSSection>

      <OSSection tone="ink">
        <div className="ost-ctaband">
          <h2>Ready to talk to a specialist?</h2>
          <p>
            Skip the tools and get matched to real funding options. Free, no obligation, and no
            credit impact to check.
          </p>
          <CTAPrimary href="/apply">Get started</CTAPrimary>
        </div>
      </OSSection>
    </ToolShell>
  );
}
