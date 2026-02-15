import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeftIcon,
  GlobeAltIcon,
  PhoneIcon,
  EnvelopeIcon,
  PencilSquareIcon,
  UserIcon,
} from "@heroicons/react/24/outline";
import supabase from "../../../supabase";
import InteractionTimeline from "../../../components/shared/InteractionTimeline";
import VendorEditModal from "../../../components/marketing/VendorEditModal";
import { useActivityLog } from "../../../hooks/useActivityLog";

interface MarketingVendor {
  id: string;
  vendor_name: string;
  website: string | null;
  description: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  status: string;
  lead_types: string[];
  cost_per_lead: number | null;
  leads_purchased: number;
  deals_funded: number;
  total_spend: number;
  total_revenue: number;
  notes: string | null;
  created_at: string;
  pricing_products: { product: string; price: string; minimum: string; notes: string }[] | null;
  minimum_order: string | null;
  return_policy: string | null;
  exclusivity: string | null;
  lead_generation_method: string | null;
  volume_available: string | null;
  industries_served: string[] | null;
  additional_services: string[] | null;
}

interface LinkedLead {
  id: string;
  first_name: string;
  last_name: string;
  business_name: string | null;
  status: string;
  lead_source: string | null;
  is_live_transfer: boolean;
  amount_requested: number | null;
  amount_funded: number | null;
  created_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  researching: "bg-gray-100 text-gray-800",
  testing: "bg-blue-100 text-blue-800",
  active: "bg-green-100 text-green-800",
  paused: "bg-yellow-100 text-yellow-800",
  discontinued: "bg-red-100 text-red-800",
};

const CUSTOMER_STATUS_COLORS: Record<string, string> = {
  lead: "bg-gray-100 text-gray-800",
  contacted: "bg-blue-100 text-blue-800",
  application_submitted: "bg-purple-100 text-purple-800",
  in_review: "bg-yellow-100 text-yellow-800",
  approved: "bg-green-100 text-green-800",
  funded: "bg-emerald-100 text-emerald-800",
  renewed: "bg-teal-100 text-teal-800",
  declined: "bg-red-100 text-red-800",
  follow_up: "bg-orange-100 text-orange-800",
};

export default function VendorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [vendor, setVendor] = useState<MarketingVendor | null>(null);
  const [linkedLeads, setLinkedLeads] = useState<LinkedLead[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "pricing" | "activity" | "leads" | "analytics">("overview");
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const { activities, isLoading: isLoadingActivities, addActivity } = useActivityLog("marketing_vendor", id);

  const fetchVendor = async () => {
    if (!id) return;
    setIsLoading(true);

    const { data, error } = await supabase
      .from("marketing_vendors")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      console.error("Error fetching vendor:", error);
    } else {
      setVendor(data);
    }

    // Fetch linked leads
    const { data: leads } = await supabase
      .from("customers")
      .select("id, first_name, last_name, business_name, status, lead_source, is_live_transfer, amount_requested, amount_funded, created_at")
      .eq("vendor_id", id)
      .order("created_at", { ascending: false });

    setLinkedLeads(leads || []);
    setIsLoading(false);
  };

  useEffect(() => {
    fetchVendor();
  }, [id]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-mint-green"></div>
      </div>
    );
  }

  if (!vendor) {
    return (
      <div className="p-6 text-center">
        <p className="text-gray-500">Vendor not found</p>
        <Link to="/admin/marketing" className="text-ocean-blue mt-2 inline-block">
          Back to vendors
        </Link>
      </div>
    );
  }

  const roi = vendor.total_spend > 0
    ? ((vendor.total_revenue - vendor.total_spend) / vendor.total_spend) * 100
    : 0;
  const convRate = vendor.leads_purchased > 0
    ? (vendor.deals_funded / vendor.leads_purchased) * 100
    : 0;
  const cpa = vendor.deals_funded > 0
    ? vendor.total_spend / vendor.deals_funded
    : 0;

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "pricing", label: "Products & Pricing" },
    { id: "activity", label: `Activity Log (${activities.length})` },
    { id: "leads", label: `Linked Leads (${linkedLeads.length})` },
    { id: "analytics", label: "Analytics" },
  ];

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Link
          to="/admin/marketing"
          className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          <ArrowLeftIcon className="w-5 h-5" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              {vendor.vendor_name}
            </h1>
            <span className={`px-3 py-1 text-xs font-semibold rounded-full ${STATUS_COLORS[vendor.status] || "bg-gray-100 text-gray-800"}`}>
              {vendor.status}
            </span>
          </div>
          {vendor.website && (
            <a
              href={vendor.website.startsWith("http") ? vendor.website : `https://${vendor.website}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-sm text-ocean-blue hover:text-ocean-blue/80 mt-1"
            >
              <GlobeAltIcon className="w-4 h-4" />
              {vendor.website.replace(/^https?:\/\//, "")}
            </a>
          )}
        </div>
        <button
          onClick={() => setIsEditModalOpen(true)}
          className="btn-primary flex items-center gap-2"
        >
          <PencilSquareIcon className="w-4 h-4" />
          Edit
        </button>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-700 mb-6">
        <nav className="flex gap-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
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

      {/* Tab Content */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          {/* Contact & Description */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
              <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">Description</h3>
              <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                {vendor.description || "No description available"}
              </p>
              {vendor.lead_generation_method && (
                <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                  <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-2">Lead Generation Method</h4>
                  <p className="text-sm text-gray-700 dark:text-gray-300">{vendor.lead_generation_method}</p>
                </div>
              )}
              {vendor.lead_types && vendor.lead_types.length > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                  <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-2">Lead Types</h4>
                  <div className="flex flex-wrap gap-2">
                    {vendor.lead_types.map((type) => (
                      <span key={type} className="px-3 py-1 text-xs bg-ocean-blue/10 text-ocean-blue font-medium rounded-full">
                        {type.replace(/_/g, " ")}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
              <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">Contact</h3>
              <div className="space-y-3">
                {vendor.contact_name && (
                  <div className="flex items-center gap-2 text-sm">
                    <UserIcon className="w-4 h-4 text-gray-400" />
                    <span className="text-gray-700 dark:text-gray-300">{vendor.contact_name}</span>
                  </div>
                )}
                {vendor.contact_email && (
                  <div className="flex items-center gap-2 text-sm">
                    <EnvelopeIcon className="w-4 h-4 text-gray-400" />
                    <a href={`mailto:${vendor.contact_email}`} className="text-ocean-blue hover:text-ocean-blue/80">
                      {vendor.contact_email}
                    </a>
                  </div>
                )}
                {vendor.contact_phone && (
                  <div className="flex items-center gap-2 text-sm">
                    <PhoneIcon className="w-4 h-4 text-gray-400" />
                    <a href={`tel:${vendor.contact_phone}`} className="text-ocean-blue hover:text-ocean-blue/80">
                      {vendor.contact_phone}
                    </a>
                  </div>
                )}
              </div>

              <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
                <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3">Details</h4>
                <div className="space-y-2 text-sm">
                  {vendor.minimum_order && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Min. Order</span>
                      <span className="text-gray-900 dark:text-white">{vendor.minimum_order}</span>
                    </div>
                  )}
                  {vendor.volume_available && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Volume</span>
                      <span className="text-gray-900 dark:text-white">{vendor.volume_available}</span>
                    </div>
                  )}
                  {vendor.exclusivity && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Exclusivity</span>
                      <span className="text-gray-900 dark:text-white">{vendor.exclusivity}</span>
                    </div>
                  )}
                  {vendor.return_policy && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Return Policy</span>
                      <span className="text-gray-900 dark:text-white">{vendor.return_policy}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "pricing" && (
        <div className="space-y-6">
          {vendor.cost_per_lead && (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
              <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-2">Default Cost Per Lead</h3>
              <p className="text-2xl font-bold text-mint-green">${vendor.cost_per_lead}</p>
            </div>
          )}

          {vendor.pricing_products && vendor.pricing_products.length > 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
              <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">Products</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">Product</th>
                      <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">Price</th>
                      <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">Minimum</th>
                      <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {vendor.pricing_products.map((product, i) => (
                      <tr key={i}>
                        <td className="py-3 px-4 font-medium text-gray-900 dark:text-white">{product.product}</td>
                        <td className="py-3 px-4 text-gray-700 dark:text-gray-300">{product.price}</td>
                        <td className="py-3 px-4 text-gray-700 dark:text-gray-300">{product.minimum}</td>
                        <td className="py-3 px-4 text-gray-500">{product.notes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-400">No products configured</div>
          )}
        </div>
      )}

      {activeTab === "activity" && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <InteractionTimeline
            interactions={activities}
            onAddInteraction={addActivity}
            showAddForm={true}
            isLoading={isLoadingActivities}
          />
        </div>
      )}

      {activeTab === "leads" && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
          {linkedLeads.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <p>No leads linked to this vendor yet</p>
              <p className="text-xs mt-1">Assign leads by setting the Source Vendor when editing a customer</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">Name</th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">Business</th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">Type</th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">Requested</th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">Funded</th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {linkedLeads.map((lead) => (
                    <tr key={lead.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="py-3 px-4">
                        <Link to={`/admin/customers/${lead.id}`} className="text-ocean-blue hover:text-ocean-blue/80 font-medium">
                          {lead.first_name} {lead.last_name}
                        </Link>
                      </td>
                      <td className="py-3 px-4 text-gray-700 dark:text-gray-300">{lead.business_name || "-"}</td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${CUSTOMER_STATUS_COLORS[lead.status] || "bg-gray-100 text-gray-800"}`}>
                          {lead.status.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {lead.is_live_transfer && (
                          <span className="px-2 py-0.5 text-xs font-medium bg-orange-100 text-orange-800 rounded-full">
                            Live Transfer
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-gray-700 dark:text-gray-300">
                        {lead.amount_requested ? `$${lead.amount_requested.toLocaleString()}` : "-"}
                      </td>
                      <td className="py-3 px-4 text-gray-700 dark:text-gray-300">
                        {lead.amount_funded ? `$${lead.amount_funded.toLocaleString()}` : "-"}
                      </td>
                      <td className="py-3 px-4 text-gray-500 text-xs">
                        {new Date(lead.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === "analytics" && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-200 dark:border-gray-700">
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{vendor.leads_purchased}</p>
              <p className="text-xs text-gray-500 mt-1">Leads Purchased</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-200 dark:border-gray-700">
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{vendor.deals_funded}</p>
              <p className="text-xs text-gray-500 mt-1">Deals Funded</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-200 dark:border-gray-700">
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{convRate.toFixed(1)}%</p>
              <p className="text-xs text-gray-500 mt-1">Conversion Rate</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-200 dark:border-gray-700">
              <p className={`text-2xl font-bold ${roi >= 0 ? "text-green-600" : "text-red-600"}`}>
                {roi >= 0 ? "+" : ""}{roi.toFixed(0)}%
              </p>
              <p className="text-xs text-gray-500 mt-1">ROI</p>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-200 dark:border-gray-700">
              <p className="text-2xl font-bold text-gray-900 dark:text-white">${vendor.total_spend.toLocaleString()}</p>
              <p className="text-xs text-gray-500 mt-1">Total Spend</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-200 dark:border-gray-700">
              <p className="text-2xl font-bold text-gray-900 dark:text-white">${vendor.total_revenue.toLocaleString()}</p>
              <p className="text-xs text-gray-500 mt-1">Total Revenue</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-200 dark:border-gray-700">
              <p className="text-2xl font-bold text-gray-900 dark:text-white">${cpa > 0 ? cpa.toFixed(0) : "N/A"}</p>
              <p className="text-xs text-gray-500 mt-1">Cost Per Acquisition</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-200 dark:border-gray-700">
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{linkedLeads.length}</p>
              <p className="text-xs text-gray-500 mt-1">Linked Leads (DB)</p>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      <VendorEditModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        onSave={fetchVendor}
        vendor={vendor as any}
      />
    </div>
  );
}
