import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  PlusIcon,
  MagnifyingGlassIcon,
  MegaphoneIcon,
  GlobeAltIcon,
  CurrencyDollarIcon,
  BookOpenIcon,
  ArrowTopRightOnSquareIcon,
} from "@heroicons/react/24/outline";
import supabase from "../../supabase";
import VendorEditModal from "../../components/marketing/VendorEditModal";

type VendorStatus = "researching" | "testing" | "active" | "paused" | "discontinued";

interface PricingProduct {
  product: string;
  price: string;
  minimum: string;
  notes: string;
}

interface MarketingVendor {
  id: string;
  vendor_name: string;
  website: string | null;
  description: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  status: VendorStatus;
  lead_types: string[];
  cost_per_lead: number | null;
  leads_purchased: number;
  deals_funded: number;
  total_spend: number;
  total_revenue: number;
  notes: string | null;
  created_at: string;
  // Enhanced fields
  pricing_products: PricingProduct[] | null;
  minimum_order: string | null;
  return_policy: string | null;
  exclusivity: string | null;
  lead_generation_method: string | null;
  volume_available: string | null;
  industries_served: string[] | null;
  additional_services: string[] | null;
}

const STATUS_CONFIG: Record<VendorStatus, { label: string; color: string; borderColor: string; priority: number }> = {
  active: { label: "Active", color: "bg-green-100 text-green-800", borderColor: "border-l-green-500", priority: 1 },
  testing: { label: "Testing", color: "bg-blue-100 text-blue-800", borderColor: "border-l-blue-500", priority: 2 },
  researching: { label: "Researching", color: "bg-gray-100 text-gray-800", borderColor: "border-l-gray-400", priority: 3 },
  paused: { label: "Paused", color: "bg-yellow-100 text-yellow-800", borderColor: "border-l-yellow-500", priority: 4 },
  discontinued: { label: "Discontinued", color: "bg-red-100 text-red-800", borderColor: "border-l-red-500", priority: 5 },
};

// Status order for display (most active/relevant first)
const STATUS_ORDER: VendorStatus[] = [
  "active",
  "testing",
  "researching",
  "paused",
  "discontinued",
];

export default function MarketingPage() {
  const [vendors, setVendors] = useState<MarketingVendor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedVendor, setSelectedVendor] = useState<MarketingVendor | null>(null);

  useEffect(() => {
    fetchVendors();
  }, []);

  const fetchVendors = async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from("marketing_vendors")
      .select("*")
      .order("vendor_name", { ascending: true });

    if (error) {
      console.error("Error fetching vendors:", error);
    } else {
      setVendors(data || []);
    }
    setIsLoading(false);
  };

  const filteredVendors = vendors
    .filter((vendor) => {
      if (searchQuery && !vendor.vendor_name.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }
      if (statusFilter && vendor.status !== statusFilter) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      // Sort by status priority first, then by vendor name
      const priorityA = STATUS_CONFIG[a.status]?.priority || 99;
      const priorityB = STATUS_CONFIG[b.status]?.priority || 99;
      if (priorityA !== priorityB) return priorityA - priorityB;
      return a.vendor_name.localeCompare(b.vendor_name);
    });

  // Group vendors by status for sectioned display
  const groupedVendors = STATUS_ORDER.reduce((acc, status) => {
    const vendorsInStatus = filteredVendors.filter((v) => v.status === status);
    if (vendorsInStatus.length > 0) {
      acc[status] = vendorsInStatus;
    }
    return acc;
  }, {} as Record<VendorStatus, MarketingVendor[]>);

  const calculateROI = (vendor: MarketingVendor) => {
    if (vendor.total_spend === 0) return 0;
    return ((vendor.total_revenue - vendor.total_spend) / vendor.total_spend) * 100;
  };

  const calculateConversionRate = (vendor: MarketingVendor) => {
    if (vendor.leads_purchased === 0) return 0;
    return (vendor.deals_funded / vendor.leads_purchased) * 100;
  };

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
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Marketing Vendors</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Manage your lead sources and marketing vendors
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/admin/marketing/resources"
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
          >
            <BookOpenIcon className="w-5 h-5" />
            Marketing Resources
          </Link>
          <button
            onClick={() => {
              setSelectedVendor(null);
              setIsModalOpen(true);
            }}
            className="btn-primary flex items-center gap-2"
          >
            <PlusIcon className="w-5 h-5" />
            Add Vendor
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative flex-1 max-w-xs">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search vendors..."
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
      </div>

      {/* Vendors Grid - Grouped by Status */}
      {filteredVendors.length === 0 ? (
        <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <MegaphoneIcon className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            No vendors found
          </h3>
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            {searchQuery || statusFilter
              ? "Try adjusting your filters"
              : "Get started by adding your first marketing vendor"}
          </p>
          {!searchQuery && !statusFilter && (
            <button
              onClick={() => {
                setSelectedVendor(null);
                setIsModalOpen(true);
              }}
              className="btn-primary inline-flex items-center gap-2"
            >
              <PlusIcon className="w-5 h-5" />
              Add Vendor
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          {Object.entries(groupedVendors).map(([status, vendorsInGroup]) => (
            <div key={status}>
              {/* Status Section Header */}
              <div className="flex items-center gap-3 mb-4">
                <span
                  className={`px-3 py-1 text-sm font-semibold rounded-full ${
                    STATUS_CONFIG[status as VendorStatus]?.color
                  }`}
                >
                  {STATUS_CONFIG[status as VendorStatus]?.label}
                </span>
                <span className="text-sm text-gray-500">
                  {vendorsInGroup.length} {vendorsInGroup.length === 1 ? "vendor" : "vendors"}
                </span>
                <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
              </div>

              {/* Vendors Grid */}
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {vendorsInGroup.map((vendor) => {
                  const roi = calculateROI(vendor);
                  const conversionRate = calculateConversionRate(vendor);
                  const statusConfig = STATUS_CONFIG[vendor.status];

                  return (
                    <div
                      key={vendor.id}
                      onClick={() => {
                        setSelectedVendor(vendor);
                        setIsModalOpen(true);
                      }}
                      className={`bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700 border-l-4 ${statusConfig.borderColor} hover:shadow-lg hover:border-ocean-blue/30 transition-all cursor-pointer`}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <h3 className="font-semibold text-gray-900 dark:text-white">
                          {vendor.vendor_name}
                        </h3>
                      </div>

                      {vendor.website && (
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            window.open(vendor.website!, "_blank");
                          }}
                          className="flex items-center gap-2 text-sm text-ocean-blue hover:text-ocean-blue/80 mb-2 cursor-pointer"
                        >
                          <GlobeAltIcon className="w-4 h-4" />
                          <span className="truncate">{vendor.website.replace(/^https?:\/\//, "")}</span>
                          <ArrowTopRightOnSquareIcon className="w-3 h-3 flex-shrink-0" />
                        </div>
                      )}

                      {vendor.cost_per_lead && (
                        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 mb-3">
                          <CurrencyDollarIcon className="w-4 h-4 text-mint-green" />
                          <span className="font-medium">${vendor.cost_per_lead}/lead</span>
                        </div>
                      )}

                      {/* Metrics */}
                      <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                        <div className="text-center">
                          <p className="text-lg font-bold text-gray-900 dark:text-white">
                            {vendor.leads_purchased}
                          </p>
                          <p className="text-xs text-gray-500">Leads</p>
                        </div>
                        <div className="text-center">
                          <p className="text-lg font-bold text-gray-900 dark:text-white">
                            {conversionRate.toFixed(1)}%
                          </p>
                          <p className="text-xs text-gray-500">Conv.</p>
                        </div>
                        <div className="text-center">
                          <p
                            className={`text-lg font-bold ${
                              roi >= 0 ? "text-emerald-600" : "text-red-600"
                            }`}
                          >
                            {roi >= 0 ? "+" : ""}
                            {roi.toFixed(0)}%
                          </p>
                          <p className="text-xs text-gray-500">ROI</p>
                        </div>
                      </div>

                      {vendor.lead_types && vendor.lead_types.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-3">
                          {vendor.lead_types.map((type) => (
                            <span
                              key={type}
                              className="px-2.5 py-1 text-xs bg-ocean-blue/10 text-ocean-blue dark:bg-ocean-blue/20 dark:text-ocean-blue font-medium rounded-full"
                            >
                              {type.replace(/_/g, " ")}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Vendor Modal */}
      <VendorEditModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setSelectedVendor(null);
        }}
        onSave={fetchVendors}
        vendor={selectedVendor}
      />
    </div>
  );
}
