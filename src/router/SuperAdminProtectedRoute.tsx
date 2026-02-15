import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useSession } from "../context/SessionContext";
import { useUserProfile } from "../context/UserProfileContext";
import LoadingPage from "../pages/LoadingPage";

const SuperAdminProtectedRoute = () => {
  const { session } = useSession();
  const { isSuperAdmin, isLoading } = useUserProfile();
  const location = useLocation();

  if (!session) {
    return <Navigate to="/auth/sign-in" state={{ from: location }} replace />;
  }

  if (isLoading) {
    return <LoadingPage />;
  }

  if (!isSuperAdmin) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
};

export default SuperAdminProtectedRoute;
