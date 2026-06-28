import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  CalculatorIcon,
  CurrencyDollarIcon,
  CalendarDaysIcon,
  SparklesIcon,
} from "@heroicons/react/24/outline";
import { useSession } from "../../context/SessionContext";
import { useUserProfile } from "../../context/UserProfileContext";
import supabase from "../../supabase";
import { DEAL_STATUS_CONFIG, DEAL_TYPE_CONFIG } from "../../types/deals";
import type { DealStatus, DealType } from "../../types/deals";

interface EstimateDeal {
  id: string;
  deal_type: DealType;
  status: DealStatus;
  amount_requested: number | null;
  lead_source: string | null;
  lead_source_detail: string | null;
  created_at: string;
}

function formatMoney(amount: number | null): string | null {
  if (amount == null) return null;
  return `$${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function formatDate(value: string): string {
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

// A friendly, customer-facing title for the saved estimate. Prefer the detail
// of which calculator/assessment they used; fall back to the product type.
function deriveTitle(deal: EstimateDeal): string {
  const detail = deal.lead_source_detail?.trim();
  if (detail) return detail;
  const typeCfg = DEAL_TYPE_CONFIG[deal.deal_type];
  if (typeCfg) return `${typeCfg.label} Estimate`;
  return "Funding Estimate";
}

export default function PortalEstimatesPage() {
  const { session } = useSession();
  const { profile } = useUserProfile();
  const [deals, setDeals] = useState<EstimateDeal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Wait until we have a session before attempting the lookup.
    if (session?.user?.id !== undefined || profile?.email) {
      loadEstimates();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, profile?.email]);

  const loadEstimates = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const email = profile?.email ?? session?.user?.email ?? null;
      if (!email) {
        setDeals([]);
        setIsLoading(false);
        return;
      }

      // Find the customer record tied to this logged-in user's email.
      const { data: customer, error: customerError } = await supabase
        .from("customers")
        .select("id")
        .eq("email", email)
        .maybeSingle();

      if (customerError) throw customerError;

      if (!customer) {
        setDeals([]);
        setIsLoading(false);
        return;
      }

      // Load this customer's deals (RLS may further restrict visibility).
      const { data: dealData, error: dealError } = await supabase
        .from("deals")
        .select(
          "id, deal_type, status, amount_requested, lead_source, lead_source_detail, created_at"
        )
        .eq("customer_id", customer.id)
        .order("created_at", { ascending: false });

      if (dealError) throw dealError;

      setDeals((dealData || []) as EstimateDeal[]);
    } catch (err) {
      console.error("Error loading estimates:", err);
      setError("We couldn't load your estimates right now. Please try again shortly.");
      setDeals([]);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-mint-green"></div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">My Estimates &amp; Results</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Your saved calculator results and funding requests
        </p>
      </div>

      {/* Error state */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl p-4">
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {/* Empty state */}
      {!error && deals.length === 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-10 text-center">
          <div className="mx-auto w-14 h-14 rounded-full bg-mint-green/10 flex items-center justify-center mb-4">
            <SparklesIcon className="w-7 h-7 text-mint-green" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            No saved estimates yet
          </h2>
          <p className="text-gray-500 dark:text-gray-400 mt-1 mb-6">
            Try our free tools to estimate your funding options.
          </p>
          <Link to="/tools" className="btn-primary inline-flex items-center gap-2">
            <CalculatorIcon className="w-5 h-5" />
            Explore Free Tools
          </Link>
        </div>
      )}

      {/* Estimates list */}
      {!error && deals.length > 0 && (
        <div className="space-y-4">
          {deals.map((deal) => {
            const statusCfg = DEAL_STATUS_CONFIG[deal.status];
            const amount = formatMoney(deal.amount_requested);
            const title = deriveTitle(deal);
            return (
              <div
                key={deal.id}
                className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700 hover:shadow-lg transition-shadow"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4 min-w-0">
                    <div className="p-3 bg-mint-green/10 rounded-lg shrink-0">
                      <CalculatorIcon className="w-6 h-6 text-mint-green" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-gray-900 dark:text-white truncate">
                        {title}
                      </h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                        {DEAL_TYPE_CONFIG[deal.deal_type]?.label ?? deal.deal_type}
                      </p>
                    </div>
                  </div>

                  {statusCfg && (
                    <span
                      className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full shrink-0 ${statusCfg.bgColor} ${statusCfg.color}`}
                    >
                      {statusCfg.label}
                    </span>
                  )}
                </div>

                {/* What you submitted */}
                {deal.lead_source_detail && (
                  <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-900/40 rounded-lg">
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">
                      What you submitted
                    </p>
                    <p className="text-sm text-gray-700 dark:text-gray-300">
                      {deal.lead_source_detail}
                    </p>
                  </div>
                )}

                {/* Meta row */}
                <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                  {amount && (
                    <div className="flex items-center gap-1.5 text-gray-700 dark:text-gray-300">
                      <CurrencyDollarIcon className="w-4 h-4 text-mint-green" />
                      <span className="font-semibold">{amount}</span>
                      <span className="text-gray-400">requested</span>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
                    <CalendarDaysIcon className="w-4 h-4" />
                    <span>{formatDate(deal.created_at)}</span>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Footer CTA */}
          <div className="pt-2">
            <Link
              to="/tools"
              className="inline-flex items-center gap-2 text-sm font-medium text-mint-green hover:underline"
            >
              <CalculatorIcon className="w-5 h-5" />
              Run another estimate with our free tools
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
