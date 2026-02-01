import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  DocumentArrowUpIcon,
  InboxIcon,
  CheckCircleIcon,
  ClockIcon,
  ExclamationCircleIcon,
} from "@heroicons/react/24/outline";
import { useSession } from "../../context/SessionContext";
import supabase from "../../supabase";

interface ApplicationStep {
  id: number;
  name: string;
  status: "completed" | "current" | "upcoming" | "failed";
}

interface CustomerData {
  id: string;
  first_name: string;
  last_name: string;
  status: string;
  amount_requested: number | null;
  amount_funded: number | null;
  business_name: string | null;
  next_follow_up_date: string | null;
}

// Map customer status to step progress
function getApplicationSteps(customerStatus: string): ApplicationStep[] {
  const statusProgress: Record<string, number> = {
    lead: 0,
    contacted: 1,
    application_submitted: 2,
    in_review: 3,
    approved: 4,
    funded: 5,
    declined: -1,
    follow_up: 1,
  };

  const currentStep = statusProgress[customerStatus] ?? 0;
  const isDeclined = customerStatus === "declined";

  return [
    {
      id: 1,
      name: "Application Started",
      status: currentStep >= 1 ? "completed" : currentStep === 0 ? "current" : "upcoming",
    },
    {
      id: 2,
      name: "Application Submitted",
      status: isDeclined && currentStep < 2
        ? "failed"
        : currentStep >= 2
          ? "completed"
          : currentStep === 1
            ? "current"
            : "upcoming",
    },
    {
      id: 3,
      name: "Under Review",
      status: isDeclined && currentStep >= 2
        ? "failed"
        : currentStep >= 3
          ? "completed"
          : currentStep === 2
            ? "current"
            : "upcoming",
    },
    {
      id: 4,
      name: "Approval Decision",
      status: isDeclined
        ? "failed"
        : currentStep >= 4
          ? "completed"
          : currentStep === 3
            ? "current"
            : "upcoming",
    },
    {
      id: 5,
      name: "Funding",
      status: currentStep >= 5 ? "completed" : currentStep === 4 ? "current" : "upcoming",
    },
  ];
}

function getProgressPercentage(customerStatus: string): number {
  const progressMap: Record<string, number> = {
    lead: 5,
    contacted: 15,
    application_submitted: 35,
    in_review: 55,
    approved: 75,
    funded: 100,
    declined: 55,
    follow_up: 15,
  };
  return progressMap[customerStatus] ?? 0;
}

export default function PortalDashboardPage() {
  const { session } = useSession();
  const [customer, setCustomer] = useState<CustomerData | null>(null);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [pendingDocuments, setPendingDocuments] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (session?.user?.id) {
      fetchData();
    }
  }, [session]);

  const fetchData = async () => {
    setIsLoading(true);

    // Fetch customer data
    const { data: customerData } = await supabase
      .from("customers")
      .select("id, first_name, last_name, status, amount_requested, amount_funded, business_name, next_follow_up_date")
      .eq("user_id", session?.user?.id)
      .single();

    if (customerData) {
      setCustomer(customerData);

      // Fetch pending document count
      const { count: docCount } = await supabase
        .from("customer_documents")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", customerData.id)
        .eq("status", "pending");

      setPendingDocuments(docCount || 0);
    }

    // Fetch unread message count
    const { count: msgCount } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("to_user_id", session?.user?.id)
      .eq("status", "unread");

    setUnreadMessages(msgCount || 0);

    setIsLoading(false);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-mint-green"></div>
      </div>
    );
  }

  const applicationSteps = customer ? getApplicationSteps(customer.status) : [];
  const progressPercentage = customer ? getProgressPercentage(customer.status) : 0;
  const isDeclined = customer?.status === "declined";
  const isFunded = customer?.status === "funded";

  return (
    <div className="space-y-8">
      {/* Welcome Section */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Welcome back{customer ? `, ${customer.first_name}` : ""}!
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          {isFunded
            ? "Congratulations on your funding!"
            : isDeclined
              ? "We appreciate your application"
              : "Track your funding application status and manage your documents"}
        </p>
      </div>

      {/* Funded Banner */}
      {isFunded && customer?.amount_funded && (
        <div className="bg-gradient-to-r from-mint-green to-teal-500 rounded-xl p-6 text-white">
          <h2 className="text-lg font-semibold mb-2">Funding Complete!</h2>
          <p className="text-4xl font-bold">${customer.amount_funded.toLocaleString()}</p>
          <p className="text-white/80 mt-1">Successfully funded to your account</p>
        </div>
      )}

      {/* Declined Banner */}
      {isDeclined && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl p-6">
          <div className="flex items-start gap-4">
            <ExclamationCircleIcon className="w-8 h-8 text-red-500 flex-shrink-0" />
            <div>
              <h2 className="text-lg font-semibold text-red-800 dark:text-red-200">
                Application Not Approved
              </h2>
              <p className="text-red-600 dark:text-red-300 mt-1">
                Unfortunately, we were unable to approve your application at this time.
                Please check your messages for more details, or contact us to discuss your options.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Application Status */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-6">
          Application Status
        </h2>

        {customer ? (
          <>
            {customer.amount_requested && !isFunded && (
              <div className="mb-6 p-4 bg-mint-green/10 rounded-lg">
                <p className="text-sm text-gray-600 dark:text-gray-400">Requested Amount</p>
                <p className="text-2xl font-bold text-mint-green">
                  ${customer.amount_requested.toLocaleString()}
                </p>
              </div>
            )}

            {/* Progress Steps */}
            <div className="relative">
              <div className="flex justify-between">
                {applicationSteps.map((step) => (
                  <div key={step.id} className="flex flex-col items-center relative z-10">
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        step.status === "completed"
                          ? "bg-mint-green text-white"
                          : step.status === "current"
                            ? "bg-ocean-blue text-white"
                            : step.status === "failed"
                              ? "bg-red-500 text-white"
                              : "bg-gray-200 dark:bg-gray-700 text-gray-500"
                      }`}
                    >
                      {step.status === "completed" ? (
                        <CheckCircleIcon className="w-6 h-6" />
                      ) : step.status === "current" ? (
                        <ClockIcon className="w-6 h-6" />
                      ) : step.status === "failed" ? (
                        <ExclamationCircleIcon className="w-6 h-6" />
                      ) : (
                        <span className="text-sm font-medium">{step.id}</span>
                      )}
                    </div>
                    <p
                      className={`mt-2 text-xs text-center max-w-[80px] ${
                        step.status === "completed" || step.status === "current"
                          ? "text-gray-900 dark:text-white font-medium"
                          : step.status === "failed"
                            ? "text-red-600 font-medium"
                            : "text-gray-500"
                      }`}
                    >
                      {step.name}
                    </p>
                  </div>
                ))}
              </div>
              {/* Progress Line */}
              <div className="absolute top-5 left-0 right-0 h-0.5 bg-gray-200 dark:bg-gray-700 -z-10">
                <div
                  className={`h-full transition-all duration-500 ${isDeclined ? "bg-red-500" : "bg-mint-green"}`}
                  style={{ width: `${progressPercentage}%` }}
                />
              </div>
            </div>

            {/* Next Follow-up */}
            {customer.next_follow_up_date && !isFunded && !isDeclined && (
              <div className="mt-6 p-4 bg-orange-50 dark:bg-orange-900/20 rounded-lg border border-orange-200 dark:border-orange-700">
                <div className="flex items-center gap-2">
                  <ClockIcon className="w-5 h-5 text-orange-500" />
                  <p className="text-sm font-medium text-orange-800 dark:text-orange-200">
                    Next update expected: {new Date(customer.next_follow_up_date).toLocaleDateString()}
                  </p>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-8">
            <p className="text-gray-500 dark:text-gray-400 mb-4">
              No active application found
            </p>
            <Link to="/" className="btn-primary">
              Start Your Application
            </Link>
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="grid md:grid-cols-2 gap-6">
        <Link
          to="/portal/documents"
          className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700 hover:shadow-lg transition-shadow"
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
              <h3 className="font-semibold text-gray-900 dark:text-white">
                Upload Documents
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {pendingDocuments > 0
                  ? `${pendingDocuments} document(s) pending review`
                  : "Bank statements, applications, and more"}
              </p>
            </div>
          </div>
        </Link>

        <Link
          to="/portal/inbox"
          className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700 hover:shadow-lg transition-shadow"
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
              <h3 className="font-semibold text-gray-900 dark:text-white">
                View Messages
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {unreadMessages > 0
                  ? `${unreadMessages} unread message(s)`
                  : "Check updates from your funding advisor"}
              </p>
            </div>
          </div>
        </Link>
      </div>
    </div>
  );
}
