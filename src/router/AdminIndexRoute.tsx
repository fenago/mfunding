import { Navigate } from "react-router-dom";
import { useCloserLens } from "../hooks/useCloserSplits";
import { useUserProfile } from "../context/UserProfileContext";
import AdminDashboardPage from "../pages/admin/AdminDashboardPage";
import LoadingPage from "../pages/LoadingPage";

// The /admin index. Managers land on the dashboard; PURE closers are sent to the
// Revenue Playbook — their work-queue command center — instead.
//
// "Manager" is decided by ROLE, not by the closer lens: an admin who also
// carries a closer row (Carlos) manages the whole pipeline and gets the
// dashboard. The previous version redirected the whole lens, so the sidebar
// showed Carlos a Dashboard link whose destination bounced him right back to
// the playbook — access denied by ricochet.
const AdminIndexRoute = () => {
  const { isCloserLens, loading } = useCloserLens();
  const { profile, isAdmin, isSuperAdmin } = useUserProfile();
  if (loading || !profile) return <LoadingPage />;
  const isManager = isSuperAdmin || isAdmin || profile.role === "employee";
  if (isCloserLens && !isManager) return <Navigate to="/admin/playbooks" replace />;
  return <AdminDashboardPage />;
};

export default AdminIndexRoute;
