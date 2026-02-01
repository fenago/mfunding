import { motion } from "framer-motion";

interface CanvasBlockProps {
  title: string;
  icon: string;
  color: string;
  bgColor: string;
  borderColor: string;
  items: string[];
  className?: string;
}

function CanvasBlock({ title, icon, color, bgColor, borderColor, items, className = "" }: CanvasBlockProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`${bgColor} ${borderColor} border-2 rounded-xl p-4 h-full overflow-hidden ${className}`}
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xl">{icon}</span>
        <h3 className={`font-bold text-sm uppercase tracking-wide ${color}`}>{title}</h3>
      </div>
      <ul className="space-y-2">
        {items.map((item, index) => (
          <motion.li
            key={index}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.05 }}
            className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed"
          >
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${color.replace('text-', 'bg-')} mr-2`} />
            {item}
          </motion.li>
        ))}
      </ul>
    </motion.div>
  );
}

const canvasData = {
  keyPartners: {
    title: "Key Partners",
    icon: "🤝",
    color: "text-purple-600",
    bgColor: "bg-purple-50 dark:bg-purple-900/20",
    borderColor: "border-purple-200 dark:border-purple-800",
    items: [
      "Alternative Lenders (40+ network) - provide actual capital",
      "Lead Generation Providers - Live Transfers, UCC data, web leads",
      "Referral Partners - CPAs, bookkeepers, business consultants",
      "Technology Providers - CRM (HubSpot), hosting, analytics",
    ],
  },
  keyActivities: {
    title: "Key Activities",
    icon: "⚡",
    color: "text-blue-600",
    bgColor: "bg-blue-50 dark:bg-blue-900/20",
    borderColor: "border-blue-200 dark:border-blue-800",
    items: [
      "Lead Generation & Marketing - paid ads, content, SEO",
      "Sales & Conversion - rapid lead response, follow-up",
      "Deal Structuring - match clients to best lender",
      "Lender Relationship Management",
      "Platform Optimization - conversion rate improvement",
    ],
  },
  keyResources: {
    title: "Key Resources",
    icon: "💎",
    color: "text-indigo-600",
    bgColor: "bg-indigo-50 dark:bg-indigo-900/20",
    borderColor: "border-indigo-200 dark:border-indigo-800",
    items: [
      "Proprietary Lender Network (40+ lenders)",
      "Digital Platform & Brand (mfunding.net)",
      "Marketing & Sales Expertise",
      "Capital for Lead Acquisition",
    ],
  },
  valuePropositions: {
    title: "Value Propositions",
    icon: "🎯",
    color: "text-amber-600",
    bgColor: "bg-amber-50 dark:bg-amber-900/20",
    borderColor: "border-amber-200 dark:border-amber-800",
    items: [
      "Speed & Simplicity - funding in days, not weeks",
      "Lifeline for the Underserved - 75% bank rejection rate",
      "We say YES when banks say NO",
      "Empowerment & Peace of Mind",
      "Suite of Solutions - MCA, LOC, Equipment",
      "Long-term financial partner",
    ],
  },
  customerRelationships: {
    title: "Customer Relationships",
    icon: "💬",
    color: "text-pink-600",
    bgColor: "bg-pink-50 dark:bg-pink-900/20",
    borderColor: "border-pink-200 dark:border-pink-800",
    items: [
      "Automated Self-Service (initial) - website, calculators",
      "Personal & Advisory (post-app) - dedicated specialist",
      "Long-Term Partnership - repeat funding needs",
    ],
  },
  channels: {
    title: "Channels",
    icon: "📢",
    color: "text-cyan-600",
    bgColor: "bg-cyan-50 dark:bg-cyan-900/20",
    borderColor: "border-cyan-200 dark:border-cyan-800",
    items: [
      "Website (mfunding.net) - lead capture & application",
      "Google Ads - high-intent keywords",
      "Facebook/Instagram - avatar targeting",
      "Live Transfers - pre-qualified phone leads",
      "UCC & Aged Leads",
      "Referral Network - CPAs, consultants",
      "Content Marketing & SEO",
    ],
  },
  customerSegments: {
    title: "Customer Segments",
    icon: "👥",
    color: "text-emerald-600",
    bgColor: "bg-emerald-50 dark:bg-emerald-900/20",
    borderColor: "border-emerald-200 dark:border-emerald-800",
    items: [
      "\"Mike Chen\" Avatar - 45-55 yo male SMB owner",
      "Industries: Construction, Professional Services, Healthcare, Retail, Restaurants",
      "Annual revenue: $100K - $5M",
      "Poor-fair credit (below 680)",
      "Funding need: $5K - $3M",
      "6+ months in business",
      "Stressed about cash flow, frustrated with banks",
    ],
  },
  costStructure: {
    title: "Cost Structure",
    icon: "💰",
    color: "text-red-600",
    bgColor: "bg-red-50 dark:bg-red-900/20",
    borderColor: "border-red-200 dark:border-red-800",
    items: [
      "Lead Acquisition (LARGEST) - paid ads, purchased leads ($50-150/lead)",
      "Technology & Software - hosting, CRM, analytics",
      "Personnel - owner time → sales agents → admin staff",
      "G&A - legal, accounting, overhead",
    ],
  },
  revenueStreams: {
    title: "Revenue Streams",
    icon: "💵",
    color: "text-green-600",
    bgColor: "bg-green-50 dark:bg-green-900/20",
    borderColor: "border-green-200 dark:border-green-800",
    items: [
      "Broker Commissions (5-15%, avg 10%)",
      "No upfront fees to business owners",
      "Small deal: $25K @ 8% = $2,000",
      "Medium deal: $75K @ 10% = $7,500",
      "Large deal: $200K @ 12% = $24,000",
      "Renewal Commissions (recurring)",
    ],
  },
};

export default function BusinessModelCanvasPage() {
  return (
    <div className="p-6 min-h-screen">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6"
      >
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-mint-green to-ocean-blue flex items-center justify-center">
            <span className="text-white text-xl">📊</span>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              Business Model Canvas
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Momentum Funding Strategic Overview
            </p>
          </div>
        </div>
      </motion.div>

      {/* Canvas Grid - Traditional BMC Layout */}
      <div className="grid grid-cols-10 grid-rows-6 gap-3 min-h-[800px]">
        {/* Row 1-3: Key Partners (col 1-2) */}
        <div className="col-span-2 row-span-3">
          <CanvasBlock {...canvasData.keyPartners} />
        </div>

        {/* Row 1-3: Key Activities (col 3-4, row 1-2) */}
        <div className="col-span-2 row-span-2">
          <CanvasBlock {...canvasData.keyActivities} />
        </div>

        {/* Row 1-3: Value Propositions (col 5-6) */}
        <div className="col-span-2 row-span-3">
          <CanvasBlock {...canvasData.valuePropositions} />
        </div>

        {/* Row 1-3: Customer Relationships (col 7-8, row 1-2) */}
        <div className="col-span-2 row-span-2">
          <CanvasBlock {...canvasData.customerRelationships} />
        </div>

        {/* Row 1-3: Customer Segments (col 9-10) */}
        <div className="col-span-2 row-span-3">
          <CanvasBlock {...canvasData.customerSegments} />
        </div>

        {/* Row 2-3: Key Resources (col 3-4, row 3) */}
        <div className="col-span-2 row-span-1">
          <CanvasBlock {...canvasData.keyResources} />
        </div>

        {/* Row 2-3: Channels (col 7-8, row 3) */}
        <div className="col-span-2 row-span-1">
          <CanvasBlock {...canvasData.channels} />
        </div>

        {/* Row 4-6: Cost Structure (col 1-5) */}
        <div className="col-span-5 row-span-3">
          <CanvasBlock {...canvasData.costStructure} />
        </div>

        {/* Row 4-6: Revenue Streams (col 6-10) */}
        <div className="col-span-5 row-span-3">
          <CanvasBlock {...canvasData.revenueStreams} />
        </div>
      </div>

      {/* Legend */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="mt-6 p-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700"
      >
        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Quick Reference</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
          <div>
            <span className="font-semibold text-amber-600">Target Avatar:</span>
            <span className="text-gray-600 dark:text-gray-400 ml-1">Mike Chen, 45-55 yo contractor</span>
          </div>
          <div>
            <span className="font-semibold text-green-600">Avg Commission:</span>
            <span className="text-gray-600 dark:text-gray-400 ml-1">10% of funded amount</span>
          </div>
          <div>
            <span className="font-semibold text-blue-600">Funding Speed:</span>
            <span className="text-gray-600 dark:text-gray-400 ml-1">24-48 hours</span>
          </div>
          <div>
            <span className="font-semibold text-purple-600">Lender Network:</span>
            <span className="text-gray-600 dark:text-gray-400 ml-1">40+ alternative lenders</span>
          </div>
        </div>
      </motion.div>

      {/* Key Metrics Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
        className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-3"
      >
        {[
          { label: "Funding Range", value: "$5K - $3M", color: "from-emerald-500 to-teal-500" },
          { label: "Bank Rejection Rate", value: "75%", color: "from-red-500 to-orange-500" },
          { label: "Our Approval Rate", value: "85%+", color: "from-green-500 to-emerald-500" },
          { label: "Lead Cost", value: "$50-150", color: "from-blue-500 to-indigo-500" },
          { label: "Commission Range", value: "5-15%", color: "from-purple-500 to-pink-500" },
        ].map((metric, index) => (
          <div
            key={index}
            className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700"
          >
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{metric.label}</p>
            <p className={`text-xl font-bold bg-gradient-to-r ${metric.color} bg-clip-text text-transparent`}>
              {metric.value}
            </p>
          </div>
        ))}
      </motion.div>
    </div>
  );
}
