import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowPathIcon, DocumentMagnifyingGlassIcon, ArrowRightIcon } from "@heroicons/react/24/outline";
import supabase from "../../supabase";

// Self-contained "needs attention" row — surfaces operational queues so the new
// renewal/doc-review pages are discoverable from the dashboard. Fetches its own
// counts (does not touch the dashboard's stats loader).
export default function NeedsAttention() {
  const [renewals, setRenewals] = useState(0);
  const [pendingDocs, setPendingDocs] = useState(0);

  useEffect(() => {
    (async () => {
      const { count: r } = await supabase
        .from("deals").select("id", { count: "exact", head: true })
        .eq("status", "renewal_eligible");
      setRenewals(r || 0);
      const { count: d } = await supabase
        .from("customer_documents").select("id", { count: "exact", head: true })
        .in("status", ["pending", "reviewed"]);
      setPendingDocs(d || 0);
    })();
  }, []);

  const cards = [
    { label: "Renewal-eligible deals", value: renewals, to: "/admin/renewals", icon: ArrowPathIcon },
    { label: "Documents to review", value: pendingDocs, to: "/admin/documents", icon: DocumentMagnifyingGlassIcon },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <Link key={c.to} to={c.to}
            className="flex items-center justify-between bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-200 dark:border-gray-700 hover:border-ocean-blue transition-colors">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${c.value > 0 ? "bg-amber-100 dark:bg-amber-900/40" : "bg-gray-100 dark:bg-gray-700"}`}>
                <Icon className={`w-5 h-5 ${c.value > 0 ? "text-amber-600 dark:text-amber-300" : "text-gray-400"}`} />
              </div>
              <div>
                <div className="text-2xl font-bold text-gray-900 dark:text-white">{c.value}</div>
                <div className="text-sm text-gray-500 dark:text-gray-400">{c.label}</div>
              </div>
            </div>
            <ArrowRightIcon className="w-4 h-4 text-gray-300" />
          </Link>
        );
      })}
    </div>
  );
}
