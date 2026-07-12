import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ChevronDownIcon,
  ShieldCheckIcon,
  CurrencyDollarIcon,
  DocumentTextIcon,
  ClockIcon,
  ChatBubbleLeftRightIcon,
} from "@heroicons/react/24/outline";
import { MCA_JOURNEY } from "../../data/merchantJourney";

// Why each requested document matters — plain, honest, compliance-safe.
const DOC_REASONS: { label: string; why: string }[] = [
  {
    label: "Business bank statements",
    why: "This is how funding partners understand your revenue and cash flow. Recent statements straight from your online banking are perfect.",
  },
  {
    label: "Driver's license",
    why: "A quick way to confirm your identity as the business owner.",
  },
  {
    label: "Voided check or bank details",
    why: "So funds can be deposited to — and payments drawn from — the right business account. A screenshot of your account and routing numbers works too.",
  },
  {
    label: "Signed application",
    why: "Your go-ahead for us to match your file with funding partners. It doesn't obligate you to accept anything.",
  },
];

const STIPS_FAQ: { q: string; a: string }[] = [
  {
    q: "What are \"stips\"?",
    a: "\"Stips\" is just industry shorthand for the supporting items a funding partner asks to see — usually your bank statements and a couple of quick documents. We'll always tell you exactly what's needed.",
  },
  {
    q: "Why do you need my bank statements?",
    a: "They're the clearest picture of your business's day-to-day cash flow, which is what funding partners look at most. The faster they come in, the faster you can see offers.",
  },
  {
    q: "Is my information safe?",
    a: "Yes. Your documents are stored securely and only shared with funding partners reviewing your file. We never sell your information.",
  },
  {
    q: "What if I can't find a document?",
    a: "Reach out to your specialist — there's almost always an easy alternative. For example, a screenshot from your online banking can stand in for a voided check.",
  },
];

function Accordion({
  icon: Icon,
  title,
  defaultOpen = false,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 p-4 sm:p-5 text-left"
      >
        <span className="flex items-center gap-3">
          <Icon className="w-6 h-6 text-ocean-blue flex-shrink-0" />
          <span className="font-semibold text-gray-900 dark:text-white">{title}</span>
        </span>
        <ChevronDownIcon
          className={`w-5 h-5 text-gray-400 flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="px-4 sm:px-5 pb-5 -mt-1 text-sm text-gray-600 dark:text-gray-300 space-y-3">
          {children}
        </div>
      )}
    </div>
  );
}

export default function PortalHowItWorksPage() {
  return (
    <div className="max-w-2xl mx-auto space-y-5">
      {/* Intro */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">How it works</h1>
        <p className="text-gray-600 dark:text-gray-300 mt-2">
          We're MFunding — your guide to business funding. Instead of you calling around, we take
          your file to a network of funding partners and bring the options back to you. Here's what
          to expect, in plain language.
        </p>
      </div>

      {/* Never pay us / no credit impact — trust badges */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 p-4">
          <p className="font-semibold text-emerald-800 dark:text-emerald-200">You never pay us</p>
          <p className="text-sm text-emerald-700 dark:text-emerald-300 mt-0.5">
            Funding partners compensate us — there's no fee to you for our help.
          </p>
        </div>
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 p-4">
          <p className="font-semibold text-emerald-800 dark:text-emerald-200">
            No credit impact to look
          </p>
          <p className="text-sm text-emerald-700 dark:text-emerald-300 mt-0.5">
            Checking your options doesn't affect your credit — only a formal submission can.
          </p>
        </div>
      </div>

      {/* Each journey step */}
      <Accordion icon={ClockIcon} title="What each step means" defaultOpen>
        <ol className="space-y-3">
          {MCA_JOURNEY.steps.map((s, i) => (
            <li key={s.key} className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-ocean-blue/10 text-ocean-blue dark:bg-ocean-blue/20 flex items-center justify-center text-xs font-bold flex-shrink-0">
                {i + 1}
              </span>
              <div>
                <p className="font-semibold text-gray-900 dark:text-white">{s.label}</p>
                <p className="text-gray-600 dark:text-gray-300">{s.whatsHappening}</p>
                <p className="text-xs text-gray-400 mt-0.5">{s.timeframe}</p>
              </div>
            </li>
          ))}
        </ol>
      </Accordion>

      {/* Why we ask for each document */}
      <Accordion icon={DocumentTextIcon} title="Why we ask for each document">
        <ul className="space-y-3">
          {DOC_REASONS.map((d) => (
            <li key={d.label}>
              <p className="font-semibold text-gray-900 dark:text-white">{d.label}</p>
              <p className="text-gray-600 dark:text-gray-300">{d.why}</p>
            </li>
          ))}
        </ul>
      </Accordion>

      {/* What an MCA is — clearly scoped to advances */}
      <Accordion icon={CurrencyDollarIcon} title="What is a merchant cash advance?">
        <p>
          A merchant cash advance is a <span className="font-semibold">purchase of your future
          receivables — not a loan</span>. A funding partner gives your business working capital
          today in exchange for a set portion of your future sales.
        </p>
        <p>
          Because it isn't a loan, there's no interest rate. Instead, you'll see two plain
          dollar figures:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <span className="font-semibold">Total payback</span> — the full fixed amount you'll send
            back, which is the funding amount plus the partner's cost. It doesn't change based on
            how long it takes.
          </li>
          <li>
            <span className="font-semibold">Remittances</span> — a set amount collected from your
            business receipts each business day or week until the total payback is met.
          </li>
        </ul>
        <p>
          We'll always show you these numbers in dollars and walk through them with you before
          anything is finalized. Other funding products we offer, like term loans or lines of
          credit, work differently — your specialist will explain the specifics of whatever fits
          your business.
        </p>
      </Accordion>

      {/* Timeframes */}
      <Accordion icon={ClockIcon} title="How long does it take?">
        <p>
          Timing depends on your business and how quickly documents come in, but here's what's
          typical:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>We typically reach out within a few hours of your request.</li>
          <li>Once your documents are in, funding partners typically respond within 24–48 hours.</li>
          <li>If you move forward with an offer, funds typically arrive within about one business day.</li>
        </ul>
        <p className="text-xs text-gray-400">
          These are typical ranges, not guarantees — every business is different.
        </p>
      </Accordion>

      {/* Stips FAQ */}
      <Accordion icon={ShieldCheckIcon} title="Common questions">
        <div className="space-y-3">
          {STIPS_FAQ.map((f) => (
            <div key={f.q}>
              <p className="font-semibold text-gray-900 dark:text-white">{f.q}</p>
              <p className="text-gray-600 dark:text-gray-300">{f.a}</p>
            </div>
          ))}
        </div>
      </Accordion>

      {/* Contact */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
        <div className="flex items-center gap-2 mb-1">
          <ChatBubbleLeftRightIcon className="w-5 h-5 text-mint-green" />
          <h3 className="font-semibold text-gray-900 dark:text-white">Still have questions?</h3>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Your funding specialist is your go-to for anything about your file. You can message them
          anytime from your inbox.
        </p>
        <Link to="/portal/inbox" className="btn-primary mt-3 inline-flex">
          Message your specialist
        </Link>
      </div>
    </div>
  );
}
