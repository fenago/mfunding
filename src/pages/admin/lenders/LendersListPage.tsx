import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  PlusIcon,
  MagnifyingGlassIcon,
  BuildingLibraryIcon,
  GlobeAltIcon,
  ArrowTopRightOnSquareIcon,
  BookOpenIcon,
} from "@heroicons/react/24/outline";
import supabase from "../../../supabase";
import LenderEditModal from "../../../components/lenders/LenderEditModal";

type LenderStatus = "potential" | "application_submitted" | "processing" | "approved" | "live_vendor" | "rejected" | "inactive";
type PaperType = "a_paper" | "b_paper" | "c_paper" | "d_paper";

interface Lender {
  id: string;
  company_name: string;
  website: string | null;
  status: LenderStatus;
  lender_types: string[];
  paper_types: PaperType[];
  min_credit_score: number | null;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  primary_contact_phone: string | null;
  created_at: string;
}

const STATUS_CONFIG: Record<LenderStatus, { label: string; color: string; priority: number }> = {
  live_vendor: { label: "Live Vendor", color: "bg-emerald-100 text-emerald-800", priority: 1 },
  approved: { label: "Approved", color: "bg-green-100 text-green-800", priority: 2 },
  processing: { label: "Processing", color: "bg-yellow-100 text-yellow-800", priority: 3 },
  application_submitted: { label: "Applied", color: "bg-blue-100 text-blue-800", priority: 4 },
  potential: { label: "Potential", color: "bg-gray-100 text-gray-800", priority: 5 },
  rejected: { label: "Rejected", color: "bg-red-100 text-red-800", priority: 6 },
  inactive: { label: "Inactive", color: "bg-gray-100 text-gray-600", priority: 7 },
};

const PAPER_TYPE_CONFIG: Record<PaperType, { label: string; description: string; color: string; minScore: number; maxScore: number }> = {
  a_paper: { label: "A Paper", description: "700+ credit, clean", color: "bg-green-100 text-green-800", minScore: 700, maxScore: 850 },
  b_paper: { label: "B Paper", description: "600-699 credit", color: "bg-blue-100 text-blue-800", minScore: 600, maxScore: 699 },
  c_paper: { label: "C Paper", description: "500-599 credit", color: "bg-yellow-100 text-yellow-800", minScore: 500, maxScore: 599 },
  d_paper: { label: "D Paper", description: "Below 500, stacked", color: "bg-red-100 text-red-800", minScore: 0, maxScore: 499 },
};

// Status order for display (most relevant first)
const STATUS_ORDER: LenderStatus[] = [
  "live_vendor",
  "approved",
  "processing",
  "application_submitted",
  "potential",
  "rejected",
  "inactive",
];

export default function LendersListPage() {
  const [lenders, setLenders] = useState<Lender[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [paperTypeFilter, setPaperTypeFilter] = useState<string>("");
  const [creditScoreFilter, setCreditScoreFilter] = useState<string>("");
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  useEffect(() => {
    fetchLenders();
  }, []);

  const fetchLenders = async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from("lenders")
      .select("*")
      .order("company_name", { ascending: true });

    if (error) {
      console.error("Error fetching lenders:", error);
    } else {
      setLenders(data || []);
    }
    setIsLoading(false);
  };

  const filteredLenders = lenders
    .filter((lender) => {
      if (searchQuery && !lender.company_name.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }
      if (statusFilter && lender.status !== statusFilter) {
        return false;
      }
      if (paperTypeFilter && (!lender.paper_types || !lender.paper_types.includes(paperTypeFilter as PaperType))) {
        return false;
      }
      if (creditScoreFilter) {
        const score = parseInt(creditScoreFilter);
        // Check if lender can handle this credit score based on their paper types or min_credit_score
        if (lender.min_credit_score && score < lender.min_credit_score) {
          return false;
        }
        // Also filter by paper type ranges if paper_types is set
        if (lender.paper_types && lender.paper_types.length > 0) {
          const canHandle = lender.paper_types.some((pt) => {
            const config = PAPER_TYPE_CONFIG[pt];
            return score >= config.minScore && score <= config.maxScore;
          });
          if (!canHandle) return false;
        }
      }
      return true;
    })
    .sort((a, b) => {
      // Sort by status priority first, then by company name
      const priorityA = STATUS_CONFIG[a.status]?.priority || 99;
      const priorityB = STATUS_CONFIG[b.status]?.priority || 99;
      if (priorityA !== priorityB) return priorityA - priorityB;
      return a.company_name.localeCompare(b.company_name);
    });

  // Group lenders by status for sectioned display
  const groupedLenders = STATUS_ORDER.reduce((acc, status) => {
    const lendersInStatus = filteredLenders.filter((l) => l.status === status);
    if (lendersInStatus.length > 0) {
      acc[status] = lendersInStatus;
    }
    return acc;
  }, {} as Record<LenderStatus, Lender[]>);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-mint-green"></div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Lenders</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Manage your funding partners and lender relationships
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/admin/lenders/resources"
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
          >
            <BookOpenIcon className="w-5 h-5" />
            Lender Resources
          </Link>
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="btn-primary flex items-center gap-2"
          >
            <PlusIcon className="w-5 h-5" />
            Add Lender
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative flex-1 max-w-xs">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search lenders..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input-field pl-9"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="input-field w-40"
        >
          <option value="">All Status</option>
          {Object.entries(STATUS_CONFIG).map(([value, config]) => (
            <option key={value} value={value}>
              {config.label}
            </option>
          ))}
        </select>
        <select
          value={paperTypeFilter}
          onChange={(e) => setPaperTypeFilter(e.target.value)}
          className="input-field w-36"
        >
          <option value="">All Paper</option>
          {Object.entries(PAPER_TYPE_CONFIG).map(([value, config]) => (
            <option key={value} value={value}>
              {config.label}
            </option>
          ))}
        </select>
        <div className="relative">
          <input
            type="number"
            placeholder="Credit Score"
            value={creditScoreFilter}
            onChange={(e) => setCreditScoreFilter(e.target.value)}
            className="input-field w-32"
            min="300"
            max="850"
          />
        </div>
        {(statusFilter || paperTypeFilter || creditScoreFilter || searchQuery) && (
          <button
            onClick={() => {
              setStatusFilter("");
              setPaperTypeFilter("");
              setCreditScoreFilter("");
              setSearchQuery("");
            }}
            className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Lenders Grid - Grouped by Status */}
      {filteredLenders.length === 0 ? (
        <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <BuildingLibraryIcon className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            No lenders found
          </h3>
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            {searchQuery || statusFilter
              ? "Try adjusting your filters"
              : "Get started by adding your first lender"}
          </p>
          {!searchQuery && !statusFilter && (
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="btn-primary inline-flex items-center gap-2"
            >
              <PlusIcon className="w-5 h-5" />
              Add Lender
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          {Object.entries(groupedLenders).map(([status, lendersInGroup]) => (
            <div key={status}>
              {/* Status Section Header */}
              <div className="flex items-center gap-3 mb-4">
                <span
                  className={`px-3 py-1 text-sm font-semibold rounded-full ${
                    STATUS_CONFIG[status as LenderStatus]?.color
                  }`}
                >
                  {STATUS_CONFIG[status as LenderStatus]?.label}
                </span>
                <span className="text-sm text-gray-500">
                  {lendersInGroup.length} {lendersInGroup.length === 1 ? "lender" : "lenders"}
                </span>
                <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
              </div>

              {/* Lenders Grid */}
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {lendersInGroup.map((lender) => (
                  <Link
                    key={lender.id}
                    to={`/admin/lenders/${lender.id}`}
                    className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700 hover:shadow-lg hover:border-ocean-blue/30 transition-all"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <h3 className="font-semibold text-gray-900 dark:text-white">
                        {lender.company_name}
                      </h3>
                    </div>

                    {lender.website && (
                      <div className="flex items-center gap-2 text-sm text-ocean-blue mb-2">
                        <GlobeAltIcon className="w-4 h-4" />
                        <span className="truncate">{lender.website.replace(/^https?:\/\//, "")}</span>
                        <ArrowTopRightOnSquareIcon className="w-3 h-3" />
                      </div>
                    )}

                    {lender.primary_contact_name && (
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        Contact: {lender.primary_contact_name}
                      </p>
                    )}

                    {/* Paper Types */}
                    {lender.paper_types && lender.paper_types.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-3">
                        {lender.paper_types.map((type) => (
                          <span
                            key={type}
                            className={`px-2 py-0.5 text-xs rounded font-medium ${PAPER_TYPE_CONFIG[type]?.color || "bg-gray-100 text-gray-600"}`}
                          >
                            {PAPER_TYPE_CONFIG[type]?.label || type}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Lender Types */}
                    {lender.lender_types && lender.lender_types.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {lender.lender_types.slice(0, 3).map((type) => (
                          <span
                            key={type}
                            className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded"
                          >
                            {type.replace(/_/g, " ")}
                          </span>
                        ))}
                        {lender.lender_types.length > 3 && (
                          <span className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded">
                            +{lender.lender_types.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Lender Modal */}
      <LenderEditModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSave={fetchLenders}
      />
    </div>
  );
}
