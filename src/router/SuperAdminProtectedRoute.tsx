import { Outlet } from "react-router-dom";
import NotFoundPage from "../pages/404Page";
import { useSession } from "../context/SessionContext";
import { useUserProfile } from "../context/UserProfileContext";
import LoadingPage from "../pages/LoadingPage";

const SuperAdminProtectedRoute = () => {
  const { session } = useSession();
  const { isSuperAdmin, isLoading } = useUserProfile();

  if (!session) {
    return <NotFoundPage />;
  }

  if (isLoading) {
    return <LoadingPage />;
  }

  if (!isSuperAdmin) {
    return <NotFoundPage />;
  }

  return <Outlet />;
};

export default SuperAdminProtectedRoute;
