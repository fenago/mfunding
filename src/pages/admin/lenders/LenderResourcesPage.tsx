import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeftIcon,
  ArrowTopRightOnSquareIcon,
  StarIcon,
  CheckCircleIcon,
  BuildingOfficeIcon,
  CurrencyDollarIcon,
  ClockIcon,
  DocumentCheckIcon,
} from "@heroicons/react/24/outline";
import { StarIcon as StarSolidIcon } from "@heroicons/react/24/solid";

interface Lender {
  rank: number;
  name: string;
  website: string;
  partnerUrl: string;
  mcaRange: string;
  locRange: string;
  commission: string;
  approvalSpeed: string;
  easeToPartner: number;
  minRequirements: string;
  specialty?: string;
  description?: string;
}

interface CDPaperLender {
  name: string;
  website: string;
  mcaRange: string;
  specialty: string;
  phone?: string;
}

const TOP_LENDERS: Lender[] = [
  {
    rank: 1,
    name: "Credibly",
    website: "https://www.credibly.com",
    partnerUrl: "https://www.credibly.com/partners/",
    mcaRange: "$5K - $600K",
    locRange: "Up to $300K",
    commission: "8-12 points",
    approvalSpeed: "24 hours",
    easeToPartner: 5,
    minRequirements: "500 credit, 6 mo TIB, $15K/mo rev",
    specialty: "Best Overall for Brokers",
    description: "Fast approvals (4 hours), works with 500+ credit scores, multiple product offerings, strong ISO support",
  },
  {
    rank: 2,
    name: "National Funding",
    website: "https://www.nationalfunding.com",
    partnerUrl: "https://www.nationalfunding.com/partners/",
    mcaRange: "$5K - $500K",
    locRange: "Up to $500K",
    commission: "8-10 points",
    approvalSpeed: "24-48 hours",
    easeToPartner: 5,
    minRequirements: "600 credit, 6 mo TIB, $250K annual",
    specialty: "Best for Repeat Business",
    description: "Ongoing support for renewals, rewards for repeat borrowers, established since 1999, A-B paper focus",
  },
  {
    rank: 3,
    name: "Greenbox Capital",
    website: "https://www.greenboxcapital.com",
    partnerUrl: "https://www.greenboxcapital.com/company/iso-program/",
    mcaRange: "$3K - $250K",
    locRange: "Up to $250K",
    commission: "Up to 19%",
    approvalSpeed: "24 hours",
    easeToPartner: 5,
    minRequirements: "500 credit, 3 mo TIB",
    specialty: "Best Commission Structure",
    description: "Up to 19% commission (highest in industry), one of lowest syndication fees, dedicated ISO managers. All 50 states + Puerto Rico + Canada",
  },
  {
    rank: 4,
    name: "Forward Financing",
    website: "https://www.forwardfinancing.com",
    partnerUrl: "https://www.forwardfinancing.com/partners",
    mcaRange: "$5K - $400K",
    locRange: "—",
    commission: "6-10 points",
    approvalSpeed: "Same day",
    easeToPartner: 5,
    minRequirements: "500 credit, 12 mo TIB, $10K/mo",
    specialty: "Best Customer Service",
    description: "4.9/5 Trustpilot rating, same-day funding available, transparent process",
  },
  {
    rank: 5,
    name: "OnDeck",
    website: "https://www.ondeck.com",
    partnerUrl: "https://www.ondeck.com/partners",
    mcaRange: "$5K - $250K",
    locRange: "Up to $100K",
    commission: "6-8 points",
    approvalSpeed: "Same day",
    easeToPartner: 4,
    minRequirements: "625 credit, 12 mo TIB, $100K annual",
    specialty: "Best for A-B Paper",
    description: "Part of Enova (stable company), builds business credit, same-day funding, strong technology platform",
  },
  {
    rank: 6,
    name: "Kapitus",
    website: "https://www.kapitus.com",
    partnerUrl: "https://kapitus.com/partners/",
    mcaRange: "$5K - $500K",
    locRange: "Up to $250K",
    commission: "8-10 points",
    approvalSpeed: "24-48 hours",
    easeToPartner: 4,
    minRequirements: "550 credit, 12 mo TIB",
    specialty: "Best Product Diversity",
    description: "Since 2006, multiple industries, no hidden fees. Products: MCA, Small Business Loans, Equipment Financing, Invoice Factoring, SBA Loans, LOC",
  },
  {
    rank: 7,
    name: "Rapid Finance",
    website: "https://www.rapidfinance.com",
    partnerUrl: "https://www.rapidfinance.com/partners/",
    mcaRange: "$5K - $500K",
    locRange: "Up to $250K",
    commission: "8-12 points",
    approvalSpeed: "24 hours",
    easeToPartner: 5,
    minRequirements: "550 credit, 3 mo TIB, $5K/mo",
    specialty: "Fastest Funding",
    description: "Funding in 24 hours, only 3 months TIB required, very low revenue minimum ($5K/mo)",
  },
  {
    rank: 8,
    name: "Fundbox",
    website: "https://www.fundbox.com",
    partnerUrl: "https://fundbox.com/partners/",
    mcaRange: "—",
    locRange: "Up to $150K",
    commission: "5-8 points",
    approvalSpeed: "Same day",
    easeToPartner: 4,
    minRequirements: "600 credit, 6 mo TIB, $100K annual",
    specialty: "Best for LOC Only",
    description: "AI-driven fast approvals, only 6 months TIB required, great for startups",
  },
  {
    rank: 9,
    name: "GoKapital",
    website: "https://www.gokapital.com",
    partnerUrl: "https://www.gokapital.com/broker-program/",
    mcaRange: "$5K - $5M",
    locRange: "Up to $400K",
    commission: "Up to 6%",
    approvalSpeed: "1-2 days",
    easeToPartner: 5,
    minRequirements: "500 credit, 12 mo TIB, $150K annual",
    specialty: "Best for Large Deals",
    description: "A+ BBB rating, funds active tax liens (with payment plan), largest funding amounts, flexible daily/weekly payments",
  },
  {
    rank: 10,
    name: "Reliant Funding",
    website: "https://www.reliantfunding.com",
    partnerUrl: "https://www.reliantfunding.com/partners/",
    mcaRange: "$5K - $400K",
    locRange: "—",
    commission: "6-10 points",
    approvalSpeed: "24-48 hours",
    easeToPartner: 5,
    minRequirements: "500 credit, 3 mo TIB, low revenue OK",
    specialty: "Best for Lower Revenue Clients",
    description: "Most accessible income requirements, only 3 months TIB, ideal for newer businesses",
  },
];

const CD_PAPER_LENDERS: CDPaperLender[] = [
  {
    name: "Frog Funding",
    website: "https://www.frogfunding.com",
    mcaRange: "Up to $250K",
    specialty: "High-risk, 2nd-4th position, tax liens OK",
    phone: "754-900-4746",
  },
  {
    name: "Cobalt Funding",
    website: "https://www.cobaltfundingsolution.com",
    mcaRange: "Up to $3M",
    specialty: "No stips, A- to C+ paper, snap funding",
  },
  {
    name: "East Shore Equities",
    website: "https://www.eastshoreequities.com",
    mcaRange: "Custom",
    specialty: "No credit check, defaulted merchants OK",
  },
  {
    name: "Infusion Capital",
    website: "https://www.infusioncapllc.com",
    mcaRange: "Custom",
    specialty: "Early refinancing, fast turnaround",
    phone: "646-774-3050",
  },
  {
    name: "Capybara Capital",
    website: "https://www.capybarausa.com",
    mcaRange: "$500K+",
    specialty: "Large 'whale' deals, 100% broker-driven",
    phone: "646-708-5986",
  },
  {
    name: "Rowan Advance",
    website: "https://www.rowanadvance.co",
    mcaRange: "Custom",
    specialty: "AI-powered, same-day commissions, 1.28 factor min",
  },
  {
    name: "Capital Express",
    website: "https://www.capitalexpressllc.com",
    mcaRange: "Custom",
    specialty: "Best MCA ISO program, fast tech",
  },
  {
    name: "NewCo Capital Group",
    website: "https://www.newcocapitalgroup.com",
    mcaRange: "Custom",
    specialty: "Diversified products, strong ISO support",
  },
];

const ADDITIONAL_RESOURCES = [
  {
    name: "Funder Intel - Full Lender List",
    url: "https://www.funderintel.com/fundingcompanieslist",
    description: "200+ MCA funders with underwriting guidelines",
  },
  {
    name: "Funder Intel - Top Funders",
    url: "https://www.funderintel.com/top-merchant-cash-advance-companies",
    description: "Curated top MCA companies",
  },
  {
    name: "deBanked Funder Directory",
    url: "https://debanked.com/funder-lender-directory/",
    description: "Industry directory with reviews",
  },
  {
    name: "United Capital Source ISO Program",
    url: "https://www.unitedcapitalsource.com/merchant-iso-referral-program/",
    description: "Multi-lender broker program",
  },
  {
    name: "ARF Financial (LOC Specialist)",
    url: "https://www.arffinancial.com/broker-referral/",
    description: "Up to 8% commission, LOC focus",
  },
  {
    name: "Financing Solutions (LOC)",
    url: "https://financingsolutionsnow.com/isobrokers/",
    description: "Up to $100K LOC, 650+ credit",
  },
  {
    name: "Funderial",
    url: "https://www.funderial.com/iso-partners",
    description: "MCA, LOC, Equipment, SBA",
  },
  {
    name: "Nexi",
    url: "https://gonexi.com/partner/",
    description: "All states, all industries, fast commissions",
  },
];

const QUICK_START_LENDERS = [
  { name: "Greenbox Capital", url: "https://www.greenboxcapital.com/company/iso-program/" },
  { name: "Credibly", url: "https://www.credibly.com/partners/" },
  { name: "Reliant Funding", url: "https://www.reliantfunding.com/partners/" },
  { name: "Rapid Finance", url: "https://www.rapidfinance.com/partners/" },
  { name: "GoKapital", url: "https://www.gokapital.com/broker-program/" },
];

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        star <= rating ? (
          <StarSolidIcon key={star} className="w-4 h-4 text-yellow-400" />
        ) : (
          <StarIcon key={star} className="w-4 h-4 text-gray-300" />
        )
      ))}
    </div>
  );
}

export default function LenderResourcesPage() {
  const [activeTab, setActiveTab] = useState<"top10" | "cdpaper" | "bytier" | "resources">("top10");

  const tabs = [
    { id: "top10", label: "Top 10 Lenders" },
    { id: "cdpaper", label: "C-D Paper Specialists" },
    { id: "bytier", label: "By Funding Tier" },
    { id: "resources", label: "Resources" },
  ];

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <Link
          to="/admin/lenders"
          className="inline-flex items-center gap-2 text-gray-500 hover:text-gray-700 mb-4"
        >
          <ArrowLeftIcon className="w-4 h-4" />
          Back to Lenders
        </Link>

        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Lender Partner Resources
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Top MCA & Business Line of Credit lenders for brokers, ranked by reputation and broker-friendliness
        </p>
      </div>

      {/* Quick Start Banner */}
      <div className="mb-6 bg-gradient-to-r from-mint-green to-teal-500 rounded-xl p-6 text-white">
        <h2 className="text-lg font-semibold mb-2">Quick Start: Apply to These 5 First</h2>
        <p className="text-white/80 mb-4 text-sm">
          Easiest approval, best for new brokers. These five give coverage for A through D paper, funding from $3K to $5M, and commissions up to 19%.
        </p>
        <div className="flex flex-wrap gap-2">
          {QUICK_START_LENDERS.map((lender) => (
            <a
              key={lender.name}
              href={lender.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg text-sm font-medium transition-colors"
            >
              <CheckCircleIcon className="w-4 h-4" />
              {lender.name}
              <ArrowTopRightOnSquareIcon className="w-3 h-3" />
            </a>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-700 mb-6">
        <nav className="flex gap-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`pb-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === tab.id
                  ? "border-ocean-blue text-ocean-blue"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Top 10 Tab */}
      {activeTab === "top10" && (
        <div className="space-y-4">
          {TOP_LENDERS.map((lender) => (
            <div
              key={lender.rank}
              className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-10 h-10 bg-ocean-blue text-white rounded-lg flex items-center justify-center font-bold text-lg">
                    {lender.rank}
                  </div>
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                        {lender.name}
                      </h3>
                      {lender.specialty && (
                        <span className="px-2 py-0.5 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 text-xs font-medium rounded">
                          {lender.specialty}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {lender.description}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={lender.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    Website
                  </a>
                  <a
                    href={lender.partnerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 text-sm bg-mint-green text-white rounded-lg hover:bg-mint-green/90 transition-colors flex items-center gap-1"
                  >
                    Apply to Partner
                    <ArrowTopRightOnSquareIcon className="w-4 h-4" />
                  </a>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <CurrencyDollarIcon className="w-5 h-5 text-gray-400" />
                  <div>
                    <p className="text-gray-500">MCA Range</p>
                    <p className="font-medium text-gray-900 dark:text-white">{lender.mcaRange}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <BuildingOfficeIcon className="w-5 h-5 text-gray-400" />
                  <div>
                    <p className="text-gray-500">LOC Range</p>
                    <p className="font-medium text-gray-900 dark:text-white">{lender.locRange}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <CurrencyDollarIcon className="w-5 h-5 text-green-500" />
                  <div>
                    <p className="text-gray-500">Commission</p>
                    <p className="font-medium text-green-600 dark:text-green-400">{lender.commission}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <ClockIcon className="w-5 h-5 text-gray-400" />
                  <div>
                    <p className="text-gray-500">Approval Speed</p>
                    <p className="font-medium text-gray-900 dark:text-white">{lender.approvalSpeed}</p>
                  </div>
                </div>
                <div>
                  <p className="text-gray-500 mb-1">Ease to Partner</p>
                  <StarRating rating={lender.easeToPartner} />
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
                <div className="flex items-center gap-2">
                  <DocumentCheckIcon className="w-5 h-5 text-gray-400" />
                  <span className="text-sm text-gray-500">Min. Requirements:</span>
                  <span className="text-sm text-gray-700 dark:text-gray-300">{lender.minRequirements}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* C-D Paper Tab */}
      {activeTab === "cdpaper" && (
        <div className="space-y-6">
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-4">
            <h3 className="font-semibold text-amber-800 dark:text-amber-200 mb-2">
              C-D Paper Specialists
            </h3>
            <p className="text-sm text-amber-700 dark:text-amber-300">
              These lenders specialize in hard-to-fund deals: low credit scores, tax liens, stacked positions, and defaulted merchants.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            {CD_PAPER_LENDERS.map((lender) => (
              <div
                key={lender.name}
                className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700"
              >
                <div className="flex items-start justify-between mb-3">
                  <h3 className="font-semibold text-gray-900 dark:text-white">{lender.name}</h3>
                  <a
                    href={lender.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-ocean-blue hover:underline text-sm flex items-center gap-1"
                  >
                    Visit
                    <ArrowTopRightOnSquareIcon className="w-3 h-3" />
                  </a>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">{lender.specialty}</p>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">MCA Range: <span className="text-gray-900 dark:text-white font-medium">{lender.mcaRange}</span></span>
                  {lender.phone && (
                    <a href={`tel:${lender.phone}`} className="text-ocean-blue hover:underline">
                      {lender.phone}
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* By Tier Tab */}
      {activeTab === "bytier" && (
        <div className="space-y-6">
          {/* By Funding Range */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4">By Funding Range</h3>
            <div className="space-y-4">
              <div className="flex items-center gap-4 p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
                <span className="font-medium text-gray-900 dark:text-white w-40">Small Deals ($5K-$50K)</span>
                <span className="text-gray-600 dark:text-gray-400">Greenbox, Reliant, Rapid Finance</span>
              </div>
              <div className="flex items-center gap-4 p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
                <span className="font-medium text-gray-900 dark:text-white w-40">Mid-Market ($50K-$250K)</span>
                <span className="text-gray-600 dark:text-gray-400">Credibly, National Funding, OnDeck, Kapitus</span>
              </div>
              <div className="flex items-center gap-4 p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
                <span className="font-medium text-gray-900 dark:text-white w-40">Large Deals ($250K-$500K)</span>
                <span className="text-gray-600 dark:text-gray-400">Credibly, National Funding, Kapitus, Rapid Finance</span>
              </div>
              <div className="flex items-center gap-4 p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
                <span className="font-medium text-gray-900 dark:text-white w-40">Whale Deals ($500K-$5M)</span>
                <span className="text-gray-600 dark:text-gray-400">GoKapital, Capybara Capital, Cobalt Funding</span>
              </div>
            </div>
          </div>

          {/* By Paper Type */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4">By Paper Type (Credit Quality)</h3>
            <div className="space-y-4">
              <div className="flex items-center gap-4 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                <span className="font-medium text-green-800 dark:text-green-300 w-40">A Paper (700+ credit)</span>
                <span className="text-green-700 dark:text-green-400">OnDeck, National Funding, Kapitus</span>
              </div>
              <div className="flex items-center gap-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                <span className="font-medium text-blue-800 dark:text-blue-300 w-40">B Paper (600-699 credit)</span>
                <span className="text-blue-700 dark:text-blue-400">Credibly, Forward Financing, Rapid Finance</span>
              </div>
              <div className="flex items-center gap-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
                <span className="font-medium text-yellow-800 dark:text-yellow-300 w-40">C Paper (500-599 credit)</span>
                <span className="text-yellow-700 dark:text-yellow-400">Greenbox, Reliant, GoKapital</span>
              </div>
              <div className="flex items-center gap-4 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
                <span className="font-medium text-red-800 dark:text-red-300 w-40">D Paper (Below 500, stacked)</span>
                <span className="text-red-700 dark:text-red-400">Frog Funding, East Shore, Cobalt</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Resources Tab */}
      {activeTab === "resources" && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Additional Lender Resources</h3>
            <div className="space-y-3">
              {ADDITIONAL_RESOURCES.map((resource) => (
                <a
                  key={resource.name}
                  href={resource.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors group"
                >
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white group-hover:text-ocean-blue">
                      {resource.name}
                    </p>
                    <p className="text-sm text-gray-500">{resource.description}</p>
                  </div>
                  <ArrowTopRightOnSquareIcon className="w-5 h-5 text-gray-400 group-hover:text-ocean-blue" />
                </a>
              ))}
            </div>
          </div>

          {/* How to Get Started */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4">How to Get Started as a New Broker</h3>
            <div className="space-y-4">
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 bg-ocean-blue text-white rounded-full flex items-center justify-center font-bold">
                  1
                </div>
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">Start with "Easy to Partner" Lenders</p>
                  <p className="text-sm text-gray-500">Greenbox Capital (up to 19% commission), Credibly (fast approvals), Reliant Funding (low requirements)</p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 bg-ocean-blue text-white rounded-full flex items-center justify-center font-bold">
                  2
                </div>
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">Build Your Lender Stack by Paper Type</p>
                  <p className="text-sm text-gray-500">Have at least one lender for A, B, C, and D paper to handle any deal that comes your way</p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 bg-ocean-blue text-white rounded-full flex items-center justify-center font-bold">
                  3
                </div>
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">Apply to Partner</p>
                  <p className="text-sm text-gray-500">Most lenders have online ISO applications that take 15-30 minutes. You'll need: Business EIN, Company information, Ownership details, W-9</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
