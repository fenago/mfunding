import { Outlet } from "react-router-dom";
import AdminSidebar from "../../components/admin/AdminSidebar";
import LeadAlertToaster from "../../components/admin/LeadAlertToaster";
import SEO from "../../components/seo/SEO";
import { LeadAlertProvider } from "../../context/LeadAlertContext";

export default function AdminLayout() {
  return (
    // The lead-alert stream is mounted at the SHELL, not on a page: a live
    // transfer has to chime wherever the closer happens to be standing. The
    // provider owns the single realtime subscription; the Revenue Playbook reuses
    // it for its in-playbook match banner instead of opening a second one.
    <LeadAlertProvider>
      <div className="flex h-screen bg-gray-50 dark:bg-gray-900 overflow-hidden">
        <SEO title="Admin" noIndex={true} />
        <AdminSidebar />
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
        <LeadAlertToaster />
      </div>
    </LeadAlertProvider>
  );
}
