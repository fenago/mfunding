import { useState, useEffect, useCallback, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { DocumentArrowUpIcon, InboxIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { CheckBadgeIcon } from "@heroicons/react/24/solid";
import { useSession } from "../../context/SessionContext";
import supabase from "../../supabase";
import {
  getMyCustomer,
  getMyPortalDeals,
  getMyDocRequests,
  getMyMerchantDocuments,
  getMyGhlDocuments,
  getMyDealSubmissions,
  SUBMITTED_OR_PAST_STATUSES,
  type PortalDeal,
  type DocRequest,
  type MerchantDocument,
  type GhlDocument,
} from "../../services/portalService";
import ActionBlock from "../../components/portal/ActionBlock";
import WelcomeOverlay from "../../components/portal/WelcomeOverlay";
import DealCard from "../../components/portal/DealCard";
import SignDocumentModal from "../../components/portal/SignDocumentModal";
import { unifyDocs } from "../../utils/signing";

/** MCA-family deal that has funded — excluded from offer nudges (it shows the
 *  paydown tracker instead). */
function isFundedMca(deal: PortalDeal): boolean {
  return (
    deal.deal_type !== "vcf" &&
    (deal.status === "funded" || deal.status === "renewal_eligible")
  );
}

export default function PortalDashboardPage() {
  const { session } = useSession();
  const [firstName, setFirstName] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [deals, setDeals] = useState<PortalDeal[]>([]);
  const [docRequests, setDocRequests] = useState<DocRequest[]>([]);
  const [signDocuments, setSignDocuments] = useState<MerchantDocument[]>([]);
  const [ghlDocuments, setGhlDocuments] = useState<GhlDocument[]>([]);
  const [offerCount, setOfferCount] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [pendingDocuments, setPendingDocuments] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [signingDoc, setSigningDoc] = useState<MerchantDocument | null>(null);
  const [selectedByDeal, setSelectedByDeal] = useState<Record<string, string>>({});
  const [celebrate, setCelebrate] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const journeyRef = useRef<HTMLDivElement>(null);

  const fetchData = useCallback(async () => {
    const uid = session?.user?.id;
    if (!uid) return;
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

    // Real GHL e-sign documents (resolves the contact server-side; [] on failure).
    setGhlDocuments(await getMyGhlDocuments());

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
  }, [session]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // A merchant who signs a GHL doc in a new tab and returns should see it flip
  // without a manual reload — refresh on focus / tab-visible.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void fetchData();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [fetchData]);

  // Returning from a GHL signing tab (redirect appends ?signed=1): celebrate
  // once, then immediately strip the param so a refresh/back doesn't re-fire it.
  useEffect(() => {
    if (searchParams.get("signed") === "1") {
      setCelebrate(true);
      setSearchParams(
        (prev) => {
          prev.delete("signed");
          return prev;
        },
        { replace: true },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once the celebration is up and the data has loaded, bring the journey into
  // view so the merchant sees their progress move — not just a toast.
  useEffect(() => {
    if (celebrate && !isLoading) {
      journeyRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [celebrate, isLoading]);

  // One unified, one-application-collapsed view of signable docs.
  const unified = unifyDocs(signDocuments, ghlDocuments);

  const selectStep = (dealId: string, key: string) =>
    setSelectedByDeal((prev) => ({ ...prev, [dealId]: key }));

  // Action block "upload" → select the documents step and scroll to it.
  const handleUpload = (dealId: string) => {
    selectStep(dealId, "documents");
    setTimeout(() => {
      document.getElementById(`step-detail-${dealId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
  };

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

      {/* Post-signing celebration — one-time, on return from a GHL signing tab */}
      {celebrate && (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-200 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 p-4 sm:p-5">
          <CheckBadgeIcon className="w-7 h-7 text-emerald-500 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-emerald-800 dark:text-emerald-200">
              🎉 Signature received — you're all set for now
            </p>
            <p className="text-sm text-emerald-700 dark:text-emerald-300 mt-0.5">
              Your signed copy is on file. We'll let you know the moment there's a next step.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCelebrate(false)}
            aria-label="Dismiss"
            className="p-1 -m-1 text-emerald-600/70 hover:text-emerald-700 dark:text-emerald-400/70 dark:hover:text-emerald-300 flex-shrink-0"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Welcome back{firstName ? `, ${firstName}` : ""}!
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Here's where your funding stands.
        </p>
      </div>

      {/* One action block: what you need to do now (sign → upload → offers) */}
      <ActionBlock
        deals={deals}
        pending={unified.pending}
        docRequests={docRequests}
        offerCount={offerCount}
        onSignNative={setSigningDoc}
        onUpload={handleUpload}
      />

      {/* The journey, one card per funding request */}
      <div ref={journeyRef} className="scroll-mt-6">
      {deals.length > 0 ? (
        <div className="space-y-4">
          {deals.length > 1 && (
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Your funding requests
            </h2>
          )}
          {deals.map((d) => (
            <DealCard
              key={d.id}
              deal={d}
              customerId={customerId}
              selectedKey={selectedByDeal[d.id]}
              onSelectStep={(k) => selectStep(d.id, k)}
              application={unified.application}
              signedDocuments={signDocuments}
              onSignNative={setSigningDoc}
              onChanged={fetchData}
            />
          ))}
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
      </div>

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

      {/* In-page signing — review & sign without leaving the dashboard */}
      {signingDoc && (
        <SignDocumentModal
          documentId={signingDoc.id}
          onClose={() => setSigningDoc(null)}
          onSigned={() => fetchData()}
        />
      )}
    </div>
  );
}
