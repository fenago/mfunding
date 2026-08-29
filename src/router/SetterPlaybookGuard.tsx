import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useCloserLens } from "../hooks/useCloserSplits";
import { useUserProfile } from "../context/UserProfileContext";
import LoadingPage from "../pages/LoadingPage";

// Setter cutover guard for the Revenue Playbook route.
//
// PURE setters (role === "closer" without a manager role) found the full Revenue
// Playbook confusing, so they now work out of the simplified Setter Operations
// console — the "operations" tab on Setter Performance. This guard bounces a pure
// setter who lands on /admin/playbooks (from ANY source — the dialer contact
// link, an in-app link, an old bookmark) to that tab, PRESERVING the deep-link
// params (?contact / ?phone / ?deal / ?x), which the Ops tab resolves the same
// way via playbook-open-contact. Closers and managers keep the full Playbook.
//
// This is the single, role-aware cutover point: no link writer or edge function
// needs to change, and old links keep working. Rollback: render {children}
// unconditionally (or remove the wrapper in the router).
const SetterPlaybookGuard = ({ children }: { children: ReactNode }) => {
  const { isCloserLens, loading } = useCloserLens();
  const { profile, isAdmin, isSuperAdmin } = useUserProfile();
  const location = useLocation();
  if (loading || !profile) return <LoadingPage />;
  const isManager = isSuperAdmin || isAdmin || profile.role === "employee";
  if (isCloserLens && !isManager) {
    const params = new URLSearchParams(location.search);
    params.set("tab", "operations");
    return <Navigate to={`/admin/setter-performance?${params.toString()}`} replace />;
  }
  return <>{children}</>;
};

export default SetterPlaybookGuard;
