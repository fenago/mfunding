import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  PlusIcon,
  MagnifyingGlassIcon,
  UsersIcon,
  PhoneIcon,
  EnvelopeIcon,
} from "@heroicons/react/24/outline";
import supabase from "../../../supabase";
import CustomerEditModal from "../../../components/customers/CustomerEditModal";

type CustomerStatus = "lead" | "contacted" | "application_submitted" | "in_review" | "approved" | "funded" | "declined" | "follow_up";

interface Customer {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  business_name: string | null;
  status: CustomerStatus;
  amount_requested: number | null;
  next_follow_up_date: string | null;
  created_at: string;
}

const STATUS_CONFIG: Record<CustomerStatus, { label: string; color: string; priority: number }> = {
  follow_up: { label: "Follow Up", color: "bg-orange-100 text-orange-800", priority: 1 },
  in_review: { label: "In Review", color: "bg-yellow-100 text-yellow-800", priority: 2 },
  application_submitted: { label: "Applied", color: "bg-purple-100 text-purple-800", priority: 3 },
  approved: { label: "Approved", color: "bg-green-100 text-green-800", priority: 4 },
  contacted: { label: "Contacted", color: "bg-blue-100 text-blue-800", priority: 5 },
  lead: { label: "Lead", color: "bg-gray-100 text-gray-800", priority: 6 },
  funded: { label: "Funded", color: "bg-emerald-100 text-emerald-800", priority: 7 },
  declined: { label: "Declined", color: "bg-red-100 text-red-800", priority: 8 },
};

// Status order for display (most actionable first)
const STATUS_ORDER: CustomerStatus[] = [
  "follow_up",
  "in_review",
  "application_submitted",
  "approved",
  "contacted",
  "lead",
  "funded",
  "declined",
];

export default function CustomersListPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  useEffect(() => {
    fetchCustomers();
  }, []);

  const fetchCustomers = async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from("customers")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching customers:", error);
    } else {
      setCustomers(data || []);
    }
    setIsLoading(false);
  };

  const filteredCustomers = customers
    .filter((customer) => {
      const fullName = `${customer.first_name} ${customer.last_name}`.toLowerCase();
      const businessName = customer.business_name?.toLowerCase() || "";
      const search = searchQuery.toLowerCase();

      if (searchQuery && !fullName.includes(search) && !businessName.includes(search)) {
        return false;
      }
      if (statusFilter && customer.status !== statusFilter) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      // Sort by status priority first
      const priorityA = STATUS_CONFIG[a.status]?.priority || 99;
      const priorityB = STATUS_CONFIG[b.status]?.priority || 99;
      if (priorityA !== priorityB) return priorityA - priorityB;
      // Then by follow-up date (soonest first)
      if (a.next_follow_up_date && b.next_follow_up_date) {
        return new Date(a.next_follow_up_date).getTime() - new Date(b.next_follow_up_date).getTime();
      }
      // Then by name
      return `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`);
    });

  // Group customers by status for sectioned display
  const groupedCustomers = STATUS_ORDER.reduce((acc, status) => {
    const customersInStatus = filteredCustomers.filter((c) => c.status === status);
    if (customersInStatus.length > 0) {
      acc[status] = customersInStatus;
    }
    return acc;
  }, {} as Record<CustomerStatus, Customer[]>);

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
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Customers</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Manage your leads and customers
          </p>
        </div>
        <button
          onClick={() => setIsAddModalOpen(true)}
          className="btn-primary flex items-center gap-2"
        >
          <PlusIcon className="w-5 h-5" />
          Add Customer
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative flex-1 max-w-xs">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search customers..."
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

      {/* Customers - Grouped by Status */}
      {filteredCustomers.length === 0 ? (
        <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <UsersIcon className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            No customers found
          </h3>
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            {searchQuery || statusFilter
              ? "Try adjusting your filters"
              : "Get started by adding your first customer"}
          </p>
          {!searchQuery && !statusFilter && (
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="btn-primary inline-flex items-center gap-2"
            >
              <PlusIcon className="w-5 h-5" />
              Add Customer
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          {Object.entries(groupedCustomers).map(([status, customersInGroup]) => (
            <div key={status}>
              {/* Status Section Header */}
              <div className="flex items-center gap-3 mb-4">
                <span
                  className={`px-3 py-1 text-sm font-semibold rounded-full ${
                    STATUS_CONFIG[status as CustomerStatus]?.color
                  }`}
                >
                  {STATUS_CONFIG[status as CustomerStatus]?.label}
                </span>
                <span className="text-sm text-gray-500">
                  {customersInGroup.length} {customersInGroup.length === 1 ? "customer" : "customers"}
                </span>
                <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
              </div>

              {/* Customers Table */}
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-gray-900">
                    <tr>
                      <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">
                        Customer
                      </th>
                      <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">
                        Contact
                      </th>
                      <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">
                        Amount
                      </th>
                      <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">
                        Follow Up
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {customersInGroup.map((customer) => {
                      const isOverdue = customer.next_follow_up_date && new Date(customer.next_follow_up_date) < new Date();
                      return (
                        <tr
                          key={customer.id}
                          className={`hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer ${
                            isOverdue ? "bg-orange-50 dark:bg-orange-900/10" : ""
                          }`}
                        >
                          <td className="px-6 py-4">
                            <Link to={`/admin/customers/${customer.id}`} className="block">
                              <div className="font-medium text-gray-900 dark:text-white">
                                {customer.first_name} {customer.last_name}
                              </div>
                              {customer.business_name && (
                                <div className="text-sm text-gray-500">{customer.business_name}</div>
                              )}
                            </Link>
                          </td>
                          <td className="px-6 py-4">
                            <div className="space-y-1">
                              {customer.phone && (
                                <a href={`tel:${customer.phone}`} className="flex items-center gap-2 text-sm text-ocean-blue hover:underline">
                                  <PhoneIcon className="w-4 h-4" />
                                  {customer.phone}
                                </a>
                              )}
                              {customer.email && (
                                <a href={`mailto:${customer.email}`} className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-ocean-blue">
                                  <EnvelopeIcon className="w-4 h-4" />
                                  {customer.email}
                                </a>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300 font-medium">
                            {customer.amount_requested
                              ? `$${customer.amount_requested.toLocaleString()}`
                              : "-"}
                          </td>
                          <td className="px-6 py-4 text-sm">
                            {customer.next_follow_up_date ? (
                              <span className={isOverdue ? "text-orange-600 font-medium" : "text-gray-500"}>
                                {isOverdue && "⚠️ "}
                                {new Date(customer.next_follow_up_date).toLocaleDateString()}
                              </span>
                            ) : (
                              "-"
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Customer Modal */}
      <CustomerEditModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSave={fetchCustomers}
      />
    </div>
  );
}
