import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { DocumentArrowUpIcon, InboxIcon } from "@heroicons/react/24/outline";
import { useSession } from "../../context/SessionContext";
import supabase from "../../supabase";
import {
  getMyCustomer,
  getMyPortalDeals,
  getMyDocRequests,
  getMyMerchantDocuments,
  getMyDealSubmissions,
  SUBMITTED_OR_PAST_STATUSES,
  type PortalDeal,
  type DocRequest,
  type MerchantDocument,
} from "../../services/portalService";
import { DEAL_STATUS_CONFIG } from "../../types/deals";
import MerchantJourney from "../../components/portal/MerchantJourney";
import JourneyHero from "../../components/portal/JourneyHero";
import ActionNeededHero from "../../components/portal/ActionNeededHero";
import SubmissionsCard from "../../components/portal/SubmissionsCard";
import DocumentsToSign from "../../components/portal/DocumentsToSign";
import WelcomeOverlay from "../../components/portal/WelcomeOverlay";
import PaydownTracker from "../../components/portal/PaydownTracker";
import PostFundingVault from "../../components/portal/PostFundingVault";

/** MCA-family deal that has funded — the point the dashboard flips into the
 *  renewal/paydown tracker (MCA-only; VCF keeps its own journey). */
function isFundedMca(deal: PortalDeal): boolean {
  return (
    deal.deal_type !== "vcf" &&
    (deal.status === "funded" || deal.status === "renewal_eligible")
  );
}

/** Merchant's part done vs. total for one deal's document checklist. */
function docProgressFor(requests: DocRequest[], dealId: string): { done: number; total: number } {
  const forDeal = requests.filter((r) => r.deal_id === dealId);
  const done = forDeal.filter(
    (r) => r.status === "uploaded" || r.status === "under_review" || r.status === "approved",
  ).length;
  return { done, total: forDeal.length };
}

export default function PortalDashboardPage() {
  const { session } = useSession();
  const [firstName, setFirstName] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [deals, setDeals] = useState<PortalDeal[]>([]);
  const [docRequests, setDocRequests] = useState<DocRequest[]>([]);
  const [signDocuments, setSignDocuments] = useState<MerchantDocument[]>([]);
  const [offerCount, setOfferCount] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [pendingDocuments, setPendingDocuments] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) return;

    const fetchData = async () => {
      setIsLoading(true);

      // Merchant identity + pending-doc count. customers has no merchant
      // row-level SELECT anymore (it leaked internal columns) — read the safe
      // projection through the SECURITY DEFINER RPC.
      const customer = await getMyCustomer().catch((err) => {
        console.error("Failed to load account details:", err);
        return null;
      });

      if (customer) {
        setFirstName(customer.first_name ?? null);
        setCustomerId(customer.id);
        const { count: docCount } = await supabase
          .from("customer_documents")
          .select("id", { count: "exact", head: true })
          .eq("customer_id", customer.id)
          .eq("status", "pending");
        setPendingDocuments(docCount || 0);

        // Document checklist (own rows via RLS; [] if table not deployed yet).
        try {
          setDocRequests(await getMyDocRequests(customer.id));
        } catch (err) {
          console.error("Failed to load document checklist:", err);
          setDocRequests([]);
        }
      }

      // All deal reads go through the column-sanitized portal service.
      let loadedDeals: PortalDeal[] = [];
      try {
        loadedDeals = await getMyPortalDeals();
        setDeals(loadedDeals);
      } catch (err) {
        console.error("Failed to load portal deals:", err);
        setDeals([]);
      }

      // Agreements awaiting signature (own rows via RLS; [] if not deployed).
      try {
        setSignDocuments(await getMyMerchantDocuments());
      } catch (err) {
        console.error("Failed to load documents to sign:", err);
        setSignDocuments([]);
      }

      // Authoritative count of reviewable offers, for the Action-Needed hero.
      try {
        const eligible = loadedDeals.filter(
          (d) =>
            d.deal_type !== "vcf" &&
            SUBMITTED_OR_PAST_STATUSES.has(d.status) &&
            !isFundedMca(d), // funded deals show the tracker, not offer nudges
        );
        const subs = await Promise.all(
          eligible.map((d) => getMyDealSubmissions(d.id).catch(() => [])),
        );
        setOfferCount(subs.flat().filter((s) => s.status_bucket === "offer").length);
      } catch (err) {
        console.error("Failed to load offer count:", err);
        setOfferCount(0);
      }

      const { count: msgCount } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("to_user_id", uid)
        .eq("status", "unread");
      setUnreadMessages(msgCount || 0);

      setIsLoading(false);
    };

    fetchData();
  }, [session]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-mint-green" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <WelcomeOverlay />

      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Welcome back{firstName ? `, ${firstName}` : ""}!
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Here's where your funding stands.
        </p>
      </div>

      {/* Action Needed — sticky, unmissable */}
      <ActionNeededHero
        deals={deals}
        pendingDocuments={pendingDocuments}
        docRequests={docRequests}
        signDocuments={signDocuments}
        offerCount={offerCount}
      />

      {/* Agreements ready to sign */}
      <DocumentsToSign documents={signDocuments} />

      {/* The journey, one card per funding request */}
      {deals.length > 0 ? (
        <div className="space-y-4">
          {deals.length > 1 && (
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Your funding requests
            </h2>
          )}
          {deals.map((d) => {
            const cfg = DEAL_STATUS_CONFIG[d.status as keyof typeof DEAL_STATUS_CONFIG];
            return (
              <div
                key={d.id}
                className="bg-white dark:bg-gray-800 rounded-xl p-4 sm:p-5 border border-gray-200 dark:border-gray-700"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="min-w-0">
                    <span className="font-mono text-sm text-gray-900 dark:text-white">
                      {d.deal_number || "Your request"}
                    </span>
                    {d.amount_requested != null && (
                      <span className="ml-2 text-sm text-gray-500">
                        ${d.amount_requested.toLocaleString()}
                      </span>
                    )}
                  </div>
                  {cfg && (
                    <span
                      className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full ${cfg.bgColor} ${cfg.color}`}
                    >
                      {cfg.label}
                    </span>
                  )}
                </div>
                <JourneyHero deal={d} />
                <div className="mt-4">
                  <MerchantJourney deal={d} docProgress={docProgressFor(docRequests, d.id)} />
                </div>

                {isFundedMca(d) ? (
                  <>
                    {/* Post-funding: paydown tracker replaces the celebration card
                        and becomes the renewal-communication anchor. */}
                    <div className="mt-4">
                      <PaydownTracker deal={d} />
                    </div>
                    <PostFundingVault
                      deal={d}
                      customerId={customerId}
                      signedDocuments={signDocuments}
                    />
                  </>
                ) : (
                  <>
                    {/* Funder submissions — MCA-family deals at/past submission,
                        before funding (once funded, the tracker takes over). */}
                    {d.deal_type !== "vcf" && SUBMITTED_OR_PAST_STATUSES.has(d.status) && (
                      <div className="mt-4">
                        <SubmissionsCard dealId={d.id} />
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-8 border border-gray-200 dark:border-gray-700 text-center">
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            We don't see an active funding request yet.
          </p>
          <Link to="/apply" className="btn-primary">
            Start your application
          </Link>
        </div>
      )}

      {/* Quick actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link
          to="/portal/documents"
          className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700 hover:shadow-lg transition-shadow"
        >
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-100 dark:bg-blue-900 rounded-lg relative">
              <DocumentArrowUpIcon className="w-6 h-6 text-blue-600 dark:text-blue-400" />
              {pendingDocuments > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 bg-yellow-500 text-white text-xs rounded-full flex items-center justify-center">
                  {pendingDocuments}
                </span>
              )}
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white">Documents</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {pendingDocuments > 0
                  ? `${pendingDocuments} item${pendingDocuments === 1 ? "" : "s"} pending`
                  : "Upload bank statements and more"}
              </p>
            </div>
          </div>
        </Link>

        <Link
          to="/portal/inbox"
          className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700 hover:shadow-lg transition-shadow"
        >
          <div className="flex items-center gap-4">
            <div className="p-3 bg-green-100 dark:bg-green-900 rounded-lg relative">
              <InboxIcon className="w-6 h-6 text-green-600 dark:text-green-400" />
              {unreadMessages > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 bg-mint-green text-white text-xs rounded-full flex items-center justify-center">
                  {unreadMessages}
                </span>
              )}
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white">Messages</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {unreadMessages > 0
                  ? `${unreadMessages} unread`
                  : "Updates from your funding advisor"}
              </p>
            </div>
          </div>
        </Link>
      </div>
    </div>
  );
}
