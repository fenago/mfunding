import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowPathIcon, DocumentMagnifyingGlassIcon, ArrowRightIcon, EnvelopeOpenIcon } from "@heroicons/react/24/outline";
import supabase from "../../supabase";
import { readCount, type Readable } from "@/lib/readable";

// Self-contained "needs attention" row — surfaces operational queues so the new
// renewal/doc-review pages are discoverable from the dashboard. Fetches its own
// counts (does not touch the dashboard's stats loader).
export default function NeedsAttention() {
  // ⚠ Readable, not number. These three tiles ARE the processor's work queue.
  // `count || 0` rendered a failed read as a calm grey "0 documents to review /
  // 0 funder responses to review" — the same shape as the stage audit that
  // reported "2 backward moves, clean" when the real answer was 28. A queue
  // that can't be read must say so, never report itself empty.
  const [renewals, setRenewals] = useState<Readable<number>>({ kind: "loading" });
  const [pendingDocs, setPendingDocs] = useState<Readable<number>>({ kind: "loading" });
  const [funderReplies, setFunderReplies] = useState<Readable<number>>({ kind: "loading" });

  useEffect(() => {
    (async () => {
      setRenewals(readCount(await supabase
        .from("deals").select("id", { count: "exact", head: true })
        .eq("status", "renewal_eligible")));
      setPendingDocs(readCount(await supabase
        .from("customer_documents").select("id", { count: "exact", head: true })
        .in("status", ["pending", "reviewed"])));
      // Funders who replied but whose submission hasn't been advanced to an
      // offer/decline yet — these need a human to read the reply in GHL.
      setFunderReplies(readCount(await supabase
        .from("deal_submissions").select("id", { count: "exact", head: true })
        .not("response_at", "is", null)
        .eq("status", "submitted")));
    })();
  }, []);

  const cards = [
    { label: "Renewal-eligible deals", value: renewals, to: "/admin/renewals", icon: ArrowPathIcon },
    { label: "Documents to review", value: pendingDocs, to: "/admin/documents", icon: DocumentMagnifyingGlassIcon },
    { label: "Funder responses to review", value: funderReplies, to: "/admin/deals", icon: EnvelopeOpenIcon },
  ];

  // A count we could not read must not colour itself "nothing to do".
  const pending = (v: Readable<number>) => v.kind === "ok" && v.value > 0;
  const broken = (v: Readable<number>) => v.kind === "unreadable";

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <Link key={c.to} to={c.to}
            className="flex items-center justify-between bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-200 dark:border-gray-700 hover:border-ocean-blue transition-colors">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${pending(c.value) ? "bg-amber-100 dark:bg-amber-900/40" : broken(c.value) ? "bg-rose-100 dark:bg-rose-900/40" : "bg-gray-100 dark:bg-gray-700"}`}>
                <Icon className={`w-5 h-5 ${pending(c.value) ? "text-amber-600 dark:text-amber-300" : broken(c.value) ? "text-rose-600 dark:text-rose-300" : "text-gray-400"}`} />
              </div>
              <div>
                {/* Three states. A dash is not a zero: "—" means we could not
                    count, and the chip below says so rather than going quiet. */}
                <div className={`text-2xl font-bold ${broken(c.value) ? "text-rose-700 dark:text-rose-300" : "text-gray-900 dark:text-white"}`}>
                  {c.value.kind === "ok" ? c.value.value : c.value.kind === "loading" ? "…" : "—"}
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400">{c.label}</div>
                {c.value.kind === "unreadable" && (
                  <div className="mt-0.5 text-[11px] font-semibold text-rose-700 dark:text-rose-300">
                    ⚠ couldn't count — not zero
                  </div>
                )}
              </div>
            </div>
            <ArrowRightIcon className="w-4 h-4 text-gray-300" />
          </Link>
        );
      })}
    </div>
  );
}
