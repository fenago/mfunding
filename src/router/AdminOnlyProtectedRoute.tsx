import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useSession } from "../context/SessionContext";
import { useUserProfile } from "../context/UserProfileContext";
import LoadingPage from "../pages/LoadingPage";

// Routes that require admin OR super_admin (but NOT closers). Use this for
// management screens an admin should reach — e.g. the Lenders page — that are
// still off-limits to closers.
const AdminOnlyProtectedRoute = () => {
  const { session } = useSession();
  const { isAdmin, isLoading } = useUserProfile();
  const location = useLocation();

  if (!session) {
    return <Navigate to="/auth/sign-in" state={{ from: location }} replace />;
  }

  if (isLoading) {
    return <LoadingPage />;
  }

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
};

export default AdminOnlyProtectedRoute;
