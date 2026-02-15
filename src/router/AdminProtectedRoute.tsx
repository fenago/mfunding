import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useSession } from "../context/SessionContext";
import { useUserProfile } from "../context/UserProfileContext";
import LoadingPage from "../pages/LoadingPage";

const AdminProtectedRoute = () => {
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

export default AdminProtectedRoute;
