import { Navigate, Outlet, useLocation } from "react-router-dom";
import { ArrowPathIcon } from "@heroicons/react/24/outline";
import { useSession } from "../context/SessionContext";
import { useUserProfile } from "../context/UserProfileContext";
import { useRenewalsAccess } from "../hooks/useCloserSplits";
import LoadingPage from "../pages/LoadingPage";

// Guards /admin/renewals. Staff-only (like the rest of admin), and additionally
// gated per closer: super_admins always pass, a closer passes only when their
// closers.renewals_enabled flag is on, and a user without a closer row keeps the
// existing staff access. Gated closers get a friendly "not enabled" message
// rather than a silent redirect.
const RenewalsProtectedRoute = () => {
  const { session } = useSession();
  const { isStaff, isLoading } = useUserProfile();
  const { canSeeRenewals, loading } = useRenewalsAccess();
  const location = useLocation();

  if (!session) {
    return <Navigate to="/auth/sign-in" state={{ from: location }} replace />;
  }

  if (isLoading || loading) {
    return <LoadingPage />;
  }

  if (!isStaff) {
    return <Navigate to="/" replace />;
  }

  if (!canSeeRenewals) {
    return (
      <div className="p-6">
        <div className="max-w-md mx-auto mt-12 text-center rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-8">
          <ArrowPathIcon className="w-10 h-10 text-gray-400 mx-auto mb-4" />
          <h1 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            Renewals aren't enabled for your account
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Renewals are handled by the team. If you think you should have access,
            ask an admin to turn on renewals for your closer profile.
          </p>
        </div>
      </div>
    );
  }

  return <Outlet />;
};

export default RenewalsProtectedRoute;
