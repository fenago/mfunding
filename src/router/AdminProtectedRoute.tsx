import { Outlet } from "react-router-dom";
import NotFoundPage from "../pages/404Page";
import { useSession } from "../context/SessionContext";
import { useUserProfile } from "../context/UserProfileContext";
import LoadingPage from "../pages/LoadingPage";

const AdminProtectedRoute = () => {
  const { session } = useSession();
  const { isAdmin, isLoading } = useUserProfile();

  if (!session) {
    return <NotFoundPage />;
  }

  if (isLoading) {
    return <LoadingPage />;
  }

  if (!isAdmin) {
    return <NotFoundPage />;
  }

  return <Outlet />;
};

export default AdminProtectedRoute;
