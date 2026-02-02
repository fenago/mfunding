import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeftIcon,
  ArrowTopRightOnSquareIcon,
  PhoneIcon,
  EnvelopeIcon,
  CheckCircleIcon,
  CurrencyDollarIcon,
  UserGroupIcon,
  ClockIcon,
} from "@heroicons/react/24/outline";

interface LiveTransferVendor {
  name: string;
  website: string;
  email?: string;
  phone?: string;
  services: string[];
  pricing: {
    liveTransfers?: string;
    exclusiveLeads?: string;
    agedLeads?: string;
    webLeads?: string;
    other?: string;
  };
  highlights: string[];
}

const LIVE_TRANSFER_VENDORS: LiveTransferVendor[] = [
  {
    name: "Synergy Direct Solution",
    website: "https://synergydirectsolution.com",
    email: "kreaddick@gmail.com",
    services: ["Live Transfers", "Aged Leads", "Web Leads", "UCC Leads", "Trigger Leads", "Hosted Dialer", "Virtual Agents"],
    pricing: {
      liveTransfers: "$40/each",
      webLeads: "$20/each (Real-Time)",
      agedLeads: "$0.05/record (bulk)",
      other: "Virtual Agents: $12/hour (pre-trained, includes dialer + aged leads)",
    },
    highlights: ["Budget-friendly live transfers", "Full-service solution with hosted dialer", "Pre-trained virtual agents available"],
  },
  {
    name: "Exclusive Leads Agency",
    website: "https://exclusiveleadsagency.com",
    services: ["Exclusive Real-Time Leads", "Appointment Leads", "Live Transfers", "Pre-Qualified MCA Leads"],
    pricing: {
      liveTransfers: "$75/each",
      exclusiveLeads: "$45/each (Real-Time)",
      other: "Exclusive Appointments: $60/each",
    },
    highlights: ["100% exclusive (sold once)", "Email, CRM input, and text delivery", "Return policy for bad leads"],
  },
  {
    name: "MCA Leads Pro",
    website: "https://mcaleadspro.com",
    email: "office@mcaleadspro.com",
    phone: "(646) 661-2060",
    services: ["Exclusive MCA Leads", "Live Transfer Leads", "Aged MCA Leads", "Pre-Qualified Prospects"],
    pricing: {
      liveTransfers: "$200-$400/transfer",
      exclusiveLeads: "$65-$120/each",
      agedLeads: "$2-$15/each (depending on age)",
    },
    highlights: ["30-50% conversion rate claimed", "TCPA compliant", "Phone verified leads"],
  },
  {
    name: "Business Leads World",
    website: "https://businessleadsworld.com",
    email: "info@businessleadsworld.com",
    phone: "(716) 671-7137",
    services: ["MCA Live Transfers", "MCA Call Back Leads", "Aged MCA Leads", "Digital Marketing Leads", "B2B Email Leads"],
    pricing: {
      liveTransfers: "$50-$99/hour range",
      other: "Call Back Leads & Aged Leads: Contact for pricing",
    },
    highlights: ["6+ years in MCA industry", "Custom criteria available", "Multiple lead types"],
  },
  {
    name: "MCA Leads Hub",
    website: "https://mcaleadshub.com",
    services: ["MCA Live Transfers", "Aged MCA Leads (30+ days)", "Business Loan Leads", "Double-Verified Leads"],
    pricing: {
      liveTransfers: "Contact for pricing",
      agedLeads: "Bulk pricing (no refunds)",
    },
    highlights: ["60-second buffer (pay only if 60+ sec call)", "50-60% app sent ratio", "3-way conference system", "Min $15K/mo deposits required", "TCPA compliant"],
  },
  {
    name: "Master MCA",
    website: "https://mastermca.com",
    services: ["Live Transfer Leads", "UCC Leads", "Bank Statement Leads", "Aged Payoff Lists", "Custom MCA Leads"],
    pricing: {
      liveTransfers: "$200-$400/transfer (premium)",
      other: "UCC Leads: $30-$75/lead • Bank Statement Leads: $100-$200/each",
    },
    highlights: ["30-50% conversion rate", "$75K avg deal size", "3-5 day close time", "8-12% conversion on live transfers"],
  },
  {
    name: "Lead Tycoons",
    website: "https://leadtycoons.com",
    services: ["Live Calls/Transfers", "Scheduled Appointments", "Web Leads", "UCC Leads", "Direct Mobile Data", "Aged Leads", "DNC Prevention"],
    pricing: {
      other: "Packages: $150 - $2,500 (tiered by lead quality)",
    },
    highlights: ["Consultative approach", "Custom solutions for larger businesses", "DNC scrubbing included"],
  },
  {
    name: "Tiger MCA Leads",
    website: "https://tigermcaleads.com",
    services: ["Exclusive Real-Time Callback", "Live Transfers", "Aged MCA Leads", "DNC Scrubbed (TCPA + Litigators)"],
    pricing: {
      liveTransfers: "Contact for pricing",
      agedLeads: "Bulk pricing available",
    },
    highlights: ["Up to 90% accuracy", "Operating since 2017", "Min $15K/mo sales requirement", "1+ year in operation required"],
  },
  {
    name: "Stacked MCA",
    website: "https://stackedmca.com",
    services: ["Exclusive MCA Leads", "Email Marketing", "SEO Lead Generation", "Social Media Leads"],
    pricing: {
      exclusiveLeads: "Min 250 quantity",
      other: "Bulk Data: Min 5,000 quantity",
    },
    highlights: ["Quality control guaranteed", "Real-time access available", "Multiple marketing channels"],
  },
  {
    name: "Zappian",
    website: "https://zappian.com/merchant-cash-advance-leads",
    services: ["Aged MCA Leads", "Real-Time Live Transfers", "Email Marketing", "Telemarketing", "SEO/Video Marketing"],
    pricing: {
      agedLeads: "Variable pricing",
      other: "Costs vary based on campaign",
    },
    highlights: ["Affiliate program for publishers", "Multiple marketing channels", "Campaign-based pricing"],
  },
];

const QUICK_START_VENDORS = [
  { name: "Synergy Direct", url: "https://synergydirectsolution.com", reason: "Budget-friendly at $40/transfer" },
  { name: "Exclusive Leads Agency", url: "https://exclusiveleadsagency.com", reason: "100% exclusive, return policy" },
  { name: "Business Leads World", url: "https://businessleadsworld.com", reason: "6+ years experience, $50-99/hr" },
];

const ADDITIONAL_RESOURCES = [
  {
    name: "deBanked - MCA Lead Generation Guide",
    url: "https://debanked.com/mca-lead-generation/",
    description: "Industry guide to MCA lead generation strategies",
  },
  {
    name: "Funder Intel - Marketing Resources",
    url: "https://www.funderintel.com/resources",
    description: "Marketing and lead generation insights for MCA brokers",
  },
  {
    name: "Commercial Capital Training Group",
    url: "https://commercialcapitaltraining.com/",
    description: "Training and resources for MCA brokers",
  },
];

export default function MarketingResourcesPage() {
  const [activeTab, setActiveTab] = useState<"vendors" | "bytype" | "resources">("vendors");

  const tabs = [
    { id: "vendors", label: "Live Transfer Vendors" },
    { id: "bytype", label: "By Lead Type" },
    { id: "resources", label: "Resources" },
  ];

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <Link
          to="/admin/marketing"
          className="inline-flex items-center gap-2 text-gray-500 hover:text-gray-700 mb-4"
        >
          <ArrowLeftIcon className="w-4 h-4" />
          Back to Marketing
        </Link>

        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Marketing Resources
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          MCA lead vendors, live transfer providers, and marketing resources for brokers
        </p>
      </div>

      {/* Quick Start Banner */}
      <div className="mb-6 bg-gradient-to-r from-purple-600 to-indigo-600 rounded-xl p-6 text-white">
        <h2 className="text-lg font-semibold mb-2">Quick Start: Top 3 Vendors to Test First</h2>
        <p className="text-white/80 mb-4 text-sm">
          These vendors offer the best value for testing live transfers. Start small, track conversions, then scale what works.
        </p>
        <div className="flex flex-wrap gap-2">
          {QUICK_START_VENDORS.map((vendor) => (
            <a
              key={vendor.name}
              href={vendor.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-3 py-2 bg-white/20 hover:bg-white/30 rounded-lg text-sm transition-colors"
            >
              <CheckCircleIcon className="w-4 h-4" />
              <div>
                <span className="font-medium">{vendor.name}</span>
                <span className="text-white/70 ml-2">— {vendor.reason}</span>
              </div>
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

      {/* Vendors Tab */}
      {activeTab === "vendors" && (
        <div className="space-y-4">
          {LIVE_TRANSFER_VENDORS.map((vendor) => (
            <div
              key={vendor.name}
              className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                      {vendor.name}
                    </h3>
                  </div>

                  {/* Contact Info */}
                  <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500">
                    {vendor.email && (
                      <a
                        href={`mailto:${vendor.email}`}
                        className="flex items-center gap-1 hover:text-ocean-blue"
                      >
                        <EnvelopeIcon className="w-4 h-4" />
                        {vendor.email}
                      </a>
                    )}
                    {vendor.phone && (
                      <a
                        href={`tel:${vendor.phone}`}
                        className="flex items-center gap-1 hover:text-ocean-blue"
                      >
                        <PhoneIcon className="w-4 h-4" />
                        {vendor.phone}
                      </a>
                    )}
                  </div>
                </div>
                <a
                  href={vendor.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 text-sm bg-mint-green text-white rounded-lg hover:bg-mint-green/90 transition-colors flex items-center gap-2"
                >
                  Visit Website
                  <ArrowTopRightOnSquareIcon className="w-4 h-4" />
                </a>
              </div>

              {/* Services */}
              <div className="mb-4">
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Services</p>
                <div className="flex flex-wrap gap-1">
                  {vendor.services.map((service) => (
                    <span
                      key={service}
                      className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded"
                    >
                      {service}
                    </span>
                  ))}
                </div>
              </div>

              {/* Pricing Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                {vendor.pricing.liveTransfers && (
                  <div className="flex items-start gap-2">
                    <CurrencyDollarIcon className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs text-gray-500">Live Transfers</p>
                      <p className="font-medium text-green-600 dark:text-green-400">{vendor.pricing.liveTransfers}</p>
                    </div>
                  </div>
                )}
                {vendor.pricing.exclusiveLeads && (
                  <div className="flex items-start gap-2">
                    <UserGroupIcon className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs text-gray-500">Exclusive Leads</p>
                      <p className="font-medium text-blue-600 dark:text-blue-400">{vendor.pricing.exclusiveLeads}</p>
                    </div>
                  </div>
                )}
                {vendor.pricing.agedLeads && (
                  <div className="flex items-start gap-2">
                    <ClockIcon className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs text-gray-500">Aged Leads</p>
                      <p className="font-medium text-yellow-600 dark:text-yellow-400">{vendor.pricing.agedLeads}</p>
                    </div>
                  </div>
                )}
                {vendor.pricing.webLeads && (
                  <div className="flex items-start gap-2">
                    <CurrencyDollarIcon className="w-5 h-5 text-purple-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs text-gray-500">Web Leads</p>
                      <p className="font-medium text-purple-600 dark:text-purple-400">{vendor.pricing.webLeads}</p>
                    </div>
                  </div>
                )}
              </div>

              {vendor.pricing.other && (
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4 bg-gray-50 dark:bg-gray-900/50 p-2 rounded">
                  <span className="font-medium">Other:</span> {vendor.pricing.other}
                </p>
              )}

              {/* Highlights */}
              <div className="pt-4 border-t border-gray-100 dark:border-gray-700">
                <div className="flex flex-wrap gap-2">
                  {vendor.highlights.map((highlight) => (
                    <span
                      key={highlight}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 rounded"
                    >
                      <CheckCircleIcon className="w-3 h-3" />
                      {highlight}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* By Type Tab */}
      {activeTab === "bytype" && (
        <div className="space-y-6">
          {/* Live Transfers */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <div className="w-3 h-3 bg-green-500 rounded-full" />
              Live Transfers (Warm Leads)
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              Pre-qualified prospects transferred live to your sales team. Higher cost, highest conversion.
            </p>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
                <div>
                  <span className="font-medium text-gray-900 dark:text-white">Budget ($40-$99)</span>
                  <p className="text-sm text-gray-500">Synergy Direct, Business Leads World</p>
                </div>
                <span className="text-green-600 font-medium">Best Value</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
                <div>
                  <span className="font-medium text-gray-900 dark:text-white">Mid-Range ($75-$150)</span>
                  <p className="text-sm text-gray-500">Exclusive Leads Agency, Tiger MCA Leads</p>
                </div>
                <span className="text-blue-600 font-medium">Balanced</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
                <div>
                  <span className="font-medium text-gray-900 dark:text-white">Premium ($200-$400)</span>
                  <p className="text-sm text-gray-500">MCA Leads Pro, Master MCA</p>
                </div>
                <span className="text-purple-600 font-medium">Highest Quality</span>
              </div>
            </div>
          </div>

          {/* Exclusive Leads */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <div className="w-3 h-3 bg-blue-500 rounded-full" />
              Exclusive Real-Time Leads
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              Fresh leads sold only once. You call them, no competition from other brokers.
            </p>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
                <div>
                  <span className="font-medium text-gray-900 dark:text-white">$45-$120/lead</span>
                  <p className="text-sm text-gray-500">Exclusive Leads Agency, MCA Leads Pro, Stacked MCA</p>
                </div>
              </div>
            </div>
          </div>

          {/* Aged Leads */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <div className="w-3 h-3 bg-yellow-500 rounded-full" />
              Aged Leads (Budget Option)
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              Older leads at bulk prices. Lower conversion but great for volume calling and agent training.
            </p>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
                <div>
                  <span className="font-medium text-gray-900 dark:text-white">Bulk Rate ($0.05-$0.50/record)</span>
                  <p className="text-sm text-gray-500">Synergy Direct (cheapest), Tiger MCA</p>
                </div>
              </div>
              <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
                <div>
                  <span className="font-medium text-gray-900 dark:text-white">Premium Aged ($2-$15/lead)</span>
                  <p className="text-sm text-gray-500">MCA Leads Pro (by age), MCA Leads Hub</p>
                </div>
              </div>
            </div>
          </div>

          {/* UCC Leads */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <div className="w-3 h-3 bg-orange-500 rounded-full" />
              UCC & Data Leads
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              Businesses with existing UCC filings (proven MCA borrowers). Intent data leads.
            </p>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
                <div>
                  <span className="font-medium text-gray-900 dark:text-white">$30-$75/lead</span>
                  <p className="text-sm text-gray-500">Master MCA, Lead Tycoons, Synergy Direct</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Resources Tab */}
      {activeTab === "resources" && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Additional Marketing Resources</h3>
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

          {/* Best Practices */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Lead Vendor Best Practices</h3>
            <div className="space-y-4">
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 bg-ocean-blue text-white rounded-full flex items-center justify-center font-bold">
                  1
                </div>
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">Start Small, Test Everything</p>
                  <p className="text-sm text-gray-500">Buy 10-25 leads from each vendor before committing to volume. Track conversion rates religiously.</p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 bg-ocean-blue text-white rounded-full flex items-center justify-center font-bold">
                  2
                </div>
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">Calculate Your True Cost Per Deal</p>
                  <p className="text-sm text-gray-500">A $400 live transfer that converts at 40% = $1,000 per deal. A $40 transfer at 5% = $800 per deal. Math matters.</p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 bg-ocean-blue text-white rounded-full flex items-center justify-center font-bold">
                  3
                </div>
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">Negotiate After Proving Volume</p>
                  <p className="text-sm text-gray-500">Most vendors will discount 10-20% once you're buying 50+ leads/month consistently.</p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 bg-ocean-blue text-white rounded-full flex items-center justify-center font-bold">
                  4
                </div>
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">Verify TCPA Compliance</p>
                  <p className="text-sm text-gray-500">Always confirm the vendor provides proper consent documentation. One lawsuit can wipe out all your profits.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
