import { useState } from "react";
import { ChevronUpIcon, ChevronDownIcon } from "@heroicons/react/24/outline";
import type { VendorPerformance } from "../../types/analytics";

interface VendorROITableProps {
  data: VendorPerformance[];
}

type SortKey = keyof VendorPerformance;

export default function VendorROITable({ data }: VendorROITableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("totalLeads");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sorted = [...data].sort((a, b) => {
    const aVal = a[sortKey];
    const bVal = b[sortKey];
    if (typeof aVal === "number" && typeof bVal === "number") {
      return sortDir === "asc" ? aVal - bVal : bVal - aVal;
    }
    return sortDir === "asc"
      ? String(aVal).localeCompare(String(bVal))
      : String(bVal).localeCompare(String(aVal));
  });

  const SortIcon = ({ field }: { field: SortKey }) => {
    if (sortKey !== field) return <ChevronUpIcon className="w-3 h-3 text-gray-300" />;
    return sortDir === "asc" ? (
      <ChevronUpIcon className="w-3 h-3 text-ocean-blue" />
    ) : (
      <ChevronDownIcon className="w-3 h-3 text-ocean-blue" />
    );
  };

  const columns: { key: SortKey; label: string; format?: (v: number) => string }[] = [
    { key: "vendorName", label: "Vendor" },
    { key: "totalLeads", label: "Leads" },
    { key: "fundedDeals", label: "Funded" },
    { key: "conversionRate", label: "Conv. %", format: (v) => `${v.toFixed(1)}%` },
    { key: "totalSpend", label: "Spend", format: (v) => `$${v.toLocaleString()}` },
    { key: "totalRevenue", label: "Revenue", format: (v) => `$${v.toLocaleString()}` },
    { key: "roi", label: "ROI", format: (v) => `${v.toFixed(0)}%` },
    { key: "costPerAcquisition", label: "CPA", format: (v) => `$${v.toFixed(0)}` },
    { key: "avgDealSize", label: "Avg Deal", format: (v) => `$${(v / 1000).toFixed(1)}K` },
  ];

  if (data.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400 text-sm">
        No vendor performance data available
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700">
            {columns.map((col) => (
              <th
                key={col.key}
                onClick={() => handleSort(col.key)}
                className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-700 dark:hover:text-gray-200"
              >
                <div className="flex items-center gap-1">
                  {col.label}
                  <SortIcon field={col.key} />
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {sorted.map((vendor) => (
            <tr
              key={vendor.vendorId}
              className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
            >
              {columns.map((col) => {
                const val = vendor[col.key];
                return (
                  <td
                    key={col.key}
                    className="px-3 py-3 text-gray-900 dark:text-gray-100 whitespace-nowrap"
                  >
                    {col.key === "vendorName" ? (
                      <span className="font-medium">{String(val)}</span>
                    ) : col.key === "roi" ? (
                      <span
                        className={`font-medium ${
                          (val as number) > 0 ? "text-green-600" : (val as number) < 0 ? "text-red-600" : ""
                        }`}
                      >
                        {col.format ? col.format(val as number) : val}
                      </span>
                    ) : col.format ? (
                      col.format(val as number)
                    ) : (
                      String(val)
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
