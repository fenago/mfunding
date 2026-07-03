import { Navigate } from "react-router-dom";
import { useCloserLens } from "../hooks/useCloserSplits";
import AdminDashboardPage from "../pages/admin/AdminDashboardPage";
import LoadingPage from "../pages/LoadingPage";

// The /admin index. Managers (super_admin, plain admins) land on the dashboard;
// the closer lens (closers, employees, admins-with-a-closer-row) is sent to the
// Revenue Playbook — their work-queue command center — instead.
const AdminIndexRoute = () => {
  const { isCloserLens, loading } = useCloserLens();
  if (loading) return <LoadingPage />;
  if (isCloserLens) return <Navigate to="/admin/playbooks" replace />;
  return <AdminDashboardPage />;
};

export default AdminIndexRoute;
