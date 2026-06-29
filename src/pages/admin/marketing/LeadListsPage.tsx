import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  TableCellsIcon,
  GlobeAltIcon,
  ShieldCheckIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import supabase from "../../../supabase";

interface ListPricingEntry {
  type?: string;
  price?: string;
  min?: string;
  fields?: string;
  notes?: string;
}

interface LeadListVendor {
  id: string;
  vendor_name: string;
  website: string | null;
  lead_generation_method: string | null;
  return_policy: string | null;
  list_pricing: ListPricingEntry[] | null;
  rank: number | null;
}

function sortVendors(list: LeadListVendor[]): LeadListVendor[] {
  return [...list].sort((a, b) => {
    const ar = a.rank ?? Number.POSITIVE_INFINITY;
    const br = b.rank ?? Number.POSITIVE_INFINITY;
    if (ar !== br) return ar - br;
    return a.vendor_name.localeCompare(b.vendor_name);
  });
}

export default function LeadListsPage() {
  const [vendors, setVendors] = useState<LeadListVendor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchVendors = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase
        .from("marketing_vendors")
        .select(
          "id, vendor_name, website, lead_generation_method, return_policy, list_pricing, rank"
        )
        .not("list_pricing", "is", null)
        .order("rank", { ascending: true, nullsFirst: false })
        .order("vendor_name", { ascending: true });

      if (error) throw error;
      setVendors(sortVendors((data as LeadListVendor[]) || []));
    } catch (e: any) {
      console.error("Error fetching lead-list vendors:", e);
      setError(e?.message || "Failed to load vendors");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVendors();
  }, [fetchVendors]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[60vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-mint-green" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-8 py-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
          <TableCellsIcon className="w-7 h-7 text-mint-green" />
          Lead Lists &amp; Data
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Aged, UCC, email, trigger &amp; B2B data — for cold outreach / nurture.
        </p>
      </div>

      <div className="p-8 space-y-6">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">
            {error}
          </div>
        )}

        {!error && vendors.length === 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-12 text-center text-gray-400 border border-gray-200 dark:border-gray-700">
            <TableCellsIcon className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="font-medium">No data-list vendors yet</p>
            <p className="text-xs mt-1">
              Vendors with structured <code>list_pricing</code> will appear here.
            </p>
          </div>
        )}

        {vendors.map((v) => {
          const entries = Array.isArray(v.list_pricing) ? v.list_pricing : [];
          return (
            <div
              key={v.id}
              className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden"
            >
              <div className="p-6">
                {/* Header row */}
                <div className="flex flex-wrap items-center gap-3">
                  <Link
                    to={`/admin/marketing/${v.id}`}
                    className="text-lg font-bold text-midnight-blue dark:text-white hover:text-ocean-blue"
                  >
                    {v.vendor_name}
                  </Link>
                  {v.rank != null && (
                    <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-ocean-blue/10 text-ocean-blue">
                      Rank {v.rank}
                    </span>
                  )}
                  {v.website && (
                    <a
                      href={v.website.startsWith("http") ? v.website : `https://${v.website}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-ocean-blue hover:text-ocean-blue/80"
                    >
                      <GlobeAltIcon className="w-4 h-4" />
                      {v.website.replace(/^https?:\/\//, "")}
                    </a>
                  )}
                </div>

                {/* Meta */}
                {(v.lead_generation_method || v.return_policy) && (
                  <div className="mt-3 grid md:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                    {v.lead_generation_method && (
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-gray-400">
                          Generation Method
                        </p>
                        <p className="text-gray-700 dark:text-gray-300 leading-snug">
                          {v.lead_generation_method}
                        </p>
                      </div>
                    )}
                    {v.return_policy && (
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-gray-400">
                          Guarantee / Return Policy
                        </p>
                        <p className="text-gray-700 dark:text-gray-300 leading-snug">
                          {v.return_policy}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Pricing table */}
                <div className="mt-4 overflow-x-auto">
                  {entries.length === 0 ? (
                    <p className="text-sm text-gray-400 italic">No structured pricing listed.</p>
                  ) : (
                    <table className="w-full text-sm border border-gray-100 dark:border-gray-700 rounded-lg">
                      <thead>
                        <tr className="bg-gray-50 dark:bg-gray-700/40">
                          <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">
                            Type
                          </th>
                          <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">
                            Price
                          </th>
                          <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">
                            Min
                          </th>
                          <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">
                            Data Fields
                          </th>
                          <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">
                            Notes
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                        {entries.map((e, i) => (
                          <tr key={i} className="align-top">
                            <td className="py-2 px-3 font-medium text-gray-900 dark:text-white">
                              {e.type || "—"}
                            </td>
                            <td className="py-2 px-3 text-mint-green font-semibold whitespace-nowrap">
                              {e.price || "—"}
                            </td>
                            <td className="py-2 px-3 text-gray-700 dark:text-gray-300">
                              {e.min || "—"}
                            </td>
                            <td className="py-2 px-3 text-gray-600 dark:text-gray-400">
                              {e.fields || "—"}
                            </td>
                            <td className="py-2 px-3 text-gray-500">{e.notes || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* Compliance note */}
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 flex items-start gap-3">
          <ExclamationTriangleIcon className="w-6 h-6 text-amber-500 flex-shrink-0" />
          <div className="text-sm text-amber-800">
            <p className="font-semibold mb-1 flex items-center gap-2">
              <ShieldCheckIcon className="w-4 h-4" /> Compliance before you dial or text
            </p>
            <p>
              Cold-list outreach requires <strong>TCPA / DNC scrubbing</strong> of every record and{" "}
              <strong>A2P 10DLC registration</strong> before sending SMS. Keep proof of consent and
              suppression lists. MCA copy must never say &ldquo;loan&rdquo; — use &ldquo;funding,&rdquo;
              &ldquo;working capital,&rdquo; or &ldquo;advance.&rdquo;
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
