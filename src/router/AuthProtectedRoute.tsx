import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useSession } from "../context/SessionContext";

const AuthProtectedRoute = () => {
  const { session } = useSession();
  const location = useLocation();

  // No session → send them somewhere they can get back in. A merchant whose
  // session expired and lands on /portal (or types my.mfunding.net, which
  // routes to /portal) must reach sign-in, not a dead 404. Shared with admin
  // routes; /auth/sign-in is correct for both (staff re-auth the same way).
  if (!session) {
    return <Navigate to="/auth/sign-in" state={{ from: location }} replace />;
  }

  return <Outlet />;
};

export default AuthProtectedRoute;
