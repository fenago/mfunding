import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  PhoneArrowUpRightIcon,
  GlobeAltIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  StarIcon,
  CheckBadgeIcon,
} from "@heroicons/react/24/outline";
import supabase from "../../../supabase";
import PageGuide from "../../../components/admin/PageGuide";

interface LiveTransferVendor {
  id: string;
  vendor_name: string;
  website: string | null;
  cost_per_lead: number | null;
  exclusivity: string | null;
  return_policy: string | null;
  ghl_integration: string | null;
  buyer_requirements: string | null;
  minimum_order: string | null;
  lead_types: string[] | null;
  rank: number | null;
  score: number | null;
  reputation: string | null;
  score_breakdown: Record<string, number> | null;
  reputation_score: number | null;
}

// Scoring rubric (max points per factor) — keep in sync with the DB scoring.
const SCORE_FACTORS: { key: string; label: string; max: number }[] = [
  { key: "reputation", label: "Reputation & corroboration", max: 30 },
  { key: "risk_billing", label: "Risk / billing protection", max: 20 },
  { key: "cost_value", label: "Cost / value", max: 16 },
  { key: "exclusivity", label: "Exclusivity", max: 12 },
  { key: "transparency", label: "Transparency", max: 12 },
  { key: "ghl_fit", label: "GHL / CRM fit", max: 10 },
];

const fmt = (v: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(v) ? v : 0);

const CLOSE_RATES = [0.05, 0.1, 0.15, 0.2];

// Sort by rank asc with nulls last, then vendor_name
function sortVendors(list: LiveTransferVendor[]): LiveTransferVendor[] {
  return [...list].sort((a, b) => {
    const ar = a.rank ?? Number.POSITIVE_INFINITY;
    const br = b.rank ?? Number.POSITIVE_INFINITY;
    if (ar !== br) return ar - br;
    return a.vendor_name.localeCompare(b.vendor_name);
  });
}

export default function LiveTransferLeadsPage() {
  const [vendors, setVendors] = useState<LiveTransferVendor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Global unit-economics drivers
  const [spend, setSpend] = useState(1000);
  const [commission, setCommission] = useState(4000);

  // Per-vendor estimated cost/lead for quote-only vendors (local only)
  const [estCost, setEstCost] = useState<Record<string, number>>({});

  const fetchVendors = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase
        .from("marketing_vendors")
        .select(
          "id, vendor_name, website, cost_per_lead, exclusivity, return_policy, ghl_integration, buyer_requirements, minimum_order, lead_types, rank, score, reputation, score_breakdown, reputation_score"
        )
        .in("status", ["testing", "active"])
        .contains("lead_types", ["live_transfer"])
        .order("rank", { ascending: true, nullsFirst: false })
        .order("vendor_name", { ascending: true });

      if (error) throw error;
      setVendors(sortVendors((data as LiveTransferVendor[]) || []));
    } catch (e: any) {
      console.error("Error fetching live transfer vendors:", e);
      setError(e?.message || "Failed to load vendors");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVendors();
  }, [fetchVendors]);

  // Optimistic rank update + persist
  const updateRank = async (vendor: LiveTransferVendor, newRank: number | null) => {
    const prev = vendors;
    const next = sortVendors(
      vendors.map((v) => (v.id === vendor.id ? { ...v, rank: newRank } : v))
    );
    setVendors(next);
    try {
      const { error } = await supabase
        .from("marketing_vendors")
        .update({ rank: newRank })
        .eq("vendor_name", vendor.vendor_name);
      if (error) throw error;
    } catch (e) {
      console.error("Error saving rank:", e);
      setVendors(prev); // rollback
    }
  };

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
          <PhoneArrowUpRightIcon className="w-7 h-7 text-mint-green" />
          Live Transfer Leads
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1 max-w-3xl">
          The premium, most-expensive leads that will power origination — a pre-qualified merchant
          connected live to a closer. Ranked by preference. Edit the rank on any card to re-order
          your buying priority; the math below shows the unit economics at each close rate.
        </p>
      </div>

      <div className="p-8 space-y-6">
        <PageGuide
          title="Live Transfer Leads"
          storageKey="live-transfer-leads"
          what="Ranked live-transfer vendors with per-vendor unit economics."
          value="Live transfers are your most expensive, highest-intent leads — this tells you which to buy and what ROI to expect."
          howToUse={[
            "Set your Spend and Commission-per-deal at the top.",
            "Read each vendor's 5/10/15/20% close table.",
            "Edit the rank to set your buying priority; quote-only vendors take an estimated $/lead.",
          ]}
          howToRead={[
            "Green profit = positive at that close rate.",
            "Aim for cost-per-funded-deal under $1,500.",
          ]}
        />

        {/* Global controls */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-200 dark:border-gray-700 flex flex-wrap gap-6 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Spend (test budget per vendor)
            </label>
            <div className="flex items-center gap-1">
              <span className="text-gray-400">$</span>
              <input
                type="number"
                min={0}
                step={100}
                value={spend}
                onChange={(e) => setSpend(Math.max(0, Number(e.target.value)))}
                className="w-36 rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white px-3 py-2 text-sm focus:ring-2 focus:ring-mint-green focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Commission per funded deal
            </label>
            <div className="flex items-center gap-1">
              <span className="text-gray-400">$</span>
              <input
                type="number"
                min={0}
                step={250}
                value={commission}
                onChange={(e) => setCommission(Math.max(0, Number(e.target.value)))}
                className="w-36 rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white px-3 py-2 text-sm focus:ring-2 focus:ring-mint-green focus:outline-none"
              />
            </div>
          </div>
          <p className="text-xs text-gray-400 max-w-sm">
            These two inputs drive every unit-economics table below. Tune them to model your real
            test budget and average commission ($4,000 = 8 points on a $50K advance).
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">
            {error}
          </div>
        )}

        {!error && vendors.length === 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-12 text-center text-gray-400 border border-gray-200 dark:border-gray-700">
            <PhoneArrowUpRightIcon className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="font-medium">No live-transfer vendors yet</p>
            <p className="text-xs mt-1">
              Vendors with a <code>live_transfer</code> lead type and a status of testing or active
              will appear here.
            </p>
          </div>
        )}

        {/* Vendor cards */}
        <div className="space-y-6">
          {vendors.map((v, idx) => {
            const isTopPick = idx === 0;
            const hasCost = v.cost_per_lead != null && Number(v.cost_per_lead) > 0;
            const modeledCost = hasCost
              ? Number(v.cost_per_lead)
              : estCost[v.id] ?? 100;
            const leads = modeledCost > 0 ? spend / modeledCost : 0;

            return (
              <motion.div
                key={v.id}
                whileHover={{ y: -2 }}
                className={`bg-white dark:bg-gray-800 rounded-2xl shadow-sm border overflow-hidden ${
                  isTopPick
                    ? "border-mint-green/60 ring-1 ring-mint-green/40"
                    : "border-gray-200 dark:border-gray-700"
                }`}
              >
                {isTopPick && (
                  <div className="bg-gradient-to-r from-mint-green/15 to-teal/10 px-6 py-2 flex items-center gap-2 text-mint-green text-xs font-semibold">
                    <StarIcon className="w-4 h-4" />
                    TOP PICK
                  </div>
                )}

                <div className="p-6">
                  <div className="flex items-start gap-4">
                    {/* Editable rank badge */}
                    <div className="flex flex-col items-center gap-1">
                      <button
                        onClick={() => updateRank(v, (v.rank ?? idx + 1) - 1 || 1)}
                        className="text-gray-400 hover:text-mint-green"
                        title="Move up (lower rank number)"
                      >
                        <ChevronUpIcon className="w-4 h-4" />
                      </button>
                      <div className="flex flex-col items-center">
                        <span className="text-[10px] uppercase text-gray-400">Rank</span>
                        <input
                          type="number"
                          min={1}
                          value={v.rank ?? ""}
                          placeholder="—"
                          onChange={(e) =>
                            updateRank(
                              v,
                              e.target.value === "" ? null : Math.max(1, Number(e.target.value))
                            )
                          }
                          className="w-14 text-center text-lg font-bold rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 text-midnight-blue dark:text-white px-1 py-1 focus:ring-2 focus:ring-mint-green focus:outline-none"
                        />
                      </div>
                      <button
                        onClick={() => updateRank(v, (v.rank ?? idx + 1) + 1)}
                        className="text-gray-400 hover:text-mint-green"
                        title="Move down (higher rank number)"
                      >
                        <ChevronDownIcon className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Identity + details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-3">
                        <Link
                          to={`/admin/marketing/${v.id}`}
                          className="text-lg font-bold text-midnight-blue dark:text-white hover:text-ocean-blue"
                        >
                          {v.vendor_name}
                        </Link>
                        {v.score != null && (
                          <span
                            className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                              Number(v.score) >= 70
                                ? "bg-mint-green/15 text-mint-green"
                                : Number(v.score) >= 55
                                ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                                : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                            }`}
                            title="Weighted score: reputation 30 / risk-billing 20 / exclusivity 12 / cost-value 16 / GHL 10 / transparency 12"
                          >
                            Score {Number(v.score)}/100
                          </span>
                        )}
                        {v.website && (
                          <a
                            href={
                              v.website.startsWith("http") ? v.website : `https://${v.website}`
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-xs text-ocean-blue hover:text-ocean-blue/80"
                          >
                            <GlobeAltIcon className="w-4 h-4" />
                            {v.website.replace(/^https?:\/\//, "")}
                          </a>
                        )}
                      </div>

                      <div className="mt-3 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-3 text-sm">
                        <Detail label="Cost / Lead">
                          {hasCost ? (
                            <span className="font-semibold text-mint-green">
                              {fmt(Number(v.cost_per_lead))}
                            </span>
                          ) : (
                            <span className="font-semibold text-amber-600">Quote</span>
                          )}
                        </Detail>
                        <Detail label="Exclusivity">{v.exclusivity || "—"}</Detail>
                        <Detail label="Guarantee">{v.return_policy || "—"}</Detail>
                        <Detail label="GHL / CRM">{v.ghl_integration || "—"}</Detail>
                        <Detail label="Min. Order">{v.minimum_order || "—"}</Detail>
                        <Detail label="Buyer Requirements" wide>
                          {v.buyer_requirements || "—"}
                        </Detail>
                      </div>

                      {v.score_breakdown && (
                        <div className="mt-3 rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-100 dark:border-gray-700 p-3">
                          <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-2">
                            Why this score — {Number(v.score)}/100
                          </p>
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2">
                            {SCORE_FACTORS.map((f) => {
                              const pts = v.score_breakdown?.[f.key] ?? 0;
                              const pct = Math.min(100, Math.round((pts / f.max) * 100));
                              return (
                                <div key={f.key}>
                                  <div className="flex justify-between text-[11px] text-gray-600 dark:text-gray-300">
                                    <span>{f.label}</span>
                                    <span className="font-semibold">{pts}/{f.max}</span>
                                  </div>
                                  <div className="h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 mt-0.5 overflow-hidden">
                                    <div
                                      className={`h-full rounded-full ${pct >= 60 ? "bg-mint-green" : pct >= 35 ? "bg-amber-400" : "bg-red-400"}`}
                                      style={{ width: `${pct}%` }}
                                    />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {v.reputation && (
                        <div className="mt-3 rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-100 dark:border-gray-700 p-3">
                          <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">
                            Reputation &amp; corroboration
                          </p>
                          <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
                            {v.reputation}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Unit economics */}
                  <div className="mt-6">
                    <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                      <h4 className="text-sm font-semibold text-midnight-blue dark:text-white flex items-center gap-2">
                        <CheckBadgeIcon className="w-4 h-4 text-mint-green" />
                        Unit Economics &mdash; {fmt(spend)} spend
                      </h4>
                      {!hasCost && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-amber-600 font-medium">
                            Quote-only — estimate $/lead:
                          </span>
                          <span className="text-gray-400 text-xs">$</span>
                          <input
                            type="number"
                            min={1}
                            step={5}
                            value={estCost[v.id] ?? 100}
                            onChange={(e) =>
                              setEstCost((s) => ({
                                ...s,
                                [v.id]: Math.max(1, Number(e.target.value)),
                              }))
                            }
                            className="w-20 rounded-lg border border-amber-300 dark:bg-gray-700 dark:text-white px-2 py-1 text-xs focus:ring-2 focus:ring-amber-400 focus:outline-none"
                          />
                        </div>
                      )}
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-sm border border-gray-100 dark:border-gray-700 rounded-lg">
                        <thead>
                          <tr className="bg-gray-50 dark:bg-gray-700/40">
                            <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase">
                              Close rate
                            </th>
                            {CLOSE_RATES.map((cr) => (
                              <th
                                key={cr}
                                className="text-right py-2 px-3 text-xs font-semibold text-gray-700 dark:text-gray-200"
                              >
                                {(cr * 100).toFixed(0)}%
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                          <Row label={`Leads${hasCost ? "" : " (estimated)"}`}>
                            {CLOSE_RATES.map((cr) => (
                              <td key={cr} className="text-right py-2 px-3 text-gray-700 dark:text-gray-300">
                                {leads.toFixed(1)}
                              </td>
                            ))}
                          </Row>
                          <Row label="Funded">
                            {CLOSE_RATES.map((cr) => (
                              <td key={cr} className="text-right py-2 px-3 text-gray-700 dark:text-gray-300">
                                {(leads * cr).toFixed(2)}
                              </td>
                            ))}
                          </Row>
                          <Row label="Revenue">
                            {CLOSE_RATES.map((cr) => (
                              <td key={cr} className="text-right py-2 px-3 text-gray-700 dark:text-gray-300">
                                {fmt(leads * cr * commission)}
                              </td>
                            ))}
                          </Row>
                          <Row label="Profit">
                            {CLOSE_RATES.map((cr) => {
                              const profit = leads * cr * commission - spend;
                              return (
                                <td
                                  key={cr}
                                  className={`text-right py-2 px-3 font-semibold ${
                                    profit >= 0 ? "text-green-600" : "text-red-600"
                                  }`}
                                >
                                  {fmt(profit)}
                                </td>
                              );
                            })}
                          </Row>
                          <Row label="ROI">
                            {CLOSE_RATES.map((cr) => {
                              const roi = spend > 0 ? (leads * cr * commission) / spend : 0;
                              return (
                                <td
                                  key={cr}
                                  className={`text-right py-2 px-3 font-medium ${
                                    roi >= 1 ? "text-green-600" : "text-red-600"
                                  }`}
                                >
                                  {roi.toFixed(2)}x
                                </td>
                              );
                            })}
                          </Row>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Detail({
  label,
  children,
  wide,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "col-span-2 md:col-span-3 lg:col-span-5" : ""}>
      <p className="text-[10px] uppercase tracking-wide text-gray-400">{label}</p>
      <p className="text-gray-800 dark:text-gray-200 mt-0.5 leading-snug">{children}</p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr>
      <td className="py-2 px-3 text-xs font-medium text-gray-500 uppercase">{label}</td>
      {children}
    </tr>
  );
}
