import { createBrowserRouter } from "react-router-dom";
import HomePage from "../pages/HomePage.tsx";
import SignInPage from "../pages/auth/SignInPage.tsx";
import SignUpPage from "../pages/auth/SignUpPage.tsx";
import ProtectedPage from "../pages/ProtectedPage.tsx";
import NotFoundPage from "../pages/404Page.tsx";
import PrivacyPolicyPage from "../pages/PrivacyPolicyPage.tsx";
import TermsOfServicePage from "../pages/TermsOfServicePage.tsx";
import UnitEconomicsPage from "../pages/UnitEconomicsPage.tsx";
import BusinessLoansHubPage from "../pages/business-loans/BusinessLoansHubPage.tsx";
import ProductDetailPage from "../pages/business-loans/ProductDetailPage.tsx";
import RealEstateHubPage from "../pages/real-estate/RealEstateHubPage.tsx";
import RealEstateDetailPage from "../pages/real-estate/RealEstateDetailPage.tsx";
import AboutPage from "../pages/AboutPage.tsx";
import ContactPage from "../pages/ContactPage.tsx";
import AuthProtectedRoute from "./AuthProtectedRoute.tsx";
import AdminProtectedRoute from "./AdminProtectedRoute.tsx";
import SuperAdminProtectedRoute from "./SuperAdminProtectedRoute.tsx";
import Providers from "../Providers.tsx";

// Admin pages
import AdminLayout from "../pages/admin/AdminLayout.tsx";
import AdminDashboardPage from "../pages/admin/AdminDashboardPage.tsx";
import KanbanBoardPage from "../pages/admin/KanbanBoardPage.tsx";
import LendersListPage from "../pages/admin/lenders/LendersListPage.tsx";
import LenderDetailPage from "../pages/admin/lenders/LenderDetailPage.tsx";
import LenderResourcesPage from "../pages/admin/lenders/LenderResourcesPage.tsx";
import CustomersListPage from "../pages/admin/customers/CustomersListPage.tsx";
import CustomerDetailPage from "../pages/admin/customers/CustomerDetailPage.tsx";
import MarketingPage from "../pages/admin/MarketingPage.tsx";
import MarketingResourcesPage from "../pages/admin/marketing/MarketingResourcesPage.tsx";
import VendorDetailPage from "../pages/admin/marketing/VendorDetailPage.tsx";
import AnalyticsDashboardPage from "../pages/admin/analytics/AnalyticsDashboardPage.tsx";
import RealTimeDashboardPage from "../pages/admin/analytics/RealTimeDashboardPage.tsx";
import AdminSettingsPage from "../pages/admin/AdminSettingsPage.tsx";
import BusinessModelCanvasPage from "../pages/admin/BusinessModelCanvasPage.tsx";

// Portal pages
import PortalLayout from "../pages/portal/PortalLayout.tsx";
import PortalDashboardPage from "../pages/portal/PortalDashboardPage.tsx";
import PortalDocumentsPage from "../pages/portal/PortalDocumentsPage.tsx";
import PortalInboxPage from "../pages/portal/PortalInboxPage.tsx";

const router = createBrowserRouter([
  {
    path: "/",
    element: <Providers />,
    children: [
      // Public routes
      {
        path: "/",
        element: <HomePage />,
      },
      {
        path: "/auth/sign-in",
        element: <SignInPage />,
      },
      {
        path: "/auth/sign-up",
        element: <SignUpPage />,
      },
      {
        path: "/privacy",
        element: <PrivacyPolicyPage />,
      },
      {
        path: "/terms",
        element: <TermsOfServicePage />,
      },
      {
        path: "/unit-economics",
        element: <UnitEconomicsPage />,
      },
      {
        path: "/business-loans",
        element: <BusinessLoansHubPage />,
      },
      {
        path: "/business-loans/:slug",
        element: <ProductDetailPage />,
      },
      {
        path: "/real-estate",
        element: <RealEstateHubPage />,
      },
      {
        path: "/real-estate/:slug",
        element: <RealEstateDetailPage />,
      },
      {
        path: "/about",
        element: <AboutPage />,
      },
      {
        path: "/contact",
        element: <ContactPage />,
      },
      // Auth Protected routes
      {
        path: "/",
        element: <AuthProtectedRoute />,
        children: [
          {
            path: "/protected",
            element: <ProtectedPage />,
          },
        ],
      },
      // Customer Portal routes (for end users)
      {
        path: "/portal",
        element: <AuthProtectedRoute />,
        children: [
          {
            element: <PortalLayout />,
            children: [
              {
                index: true,
                element: <PortalDashboardPage />,
              },
              {
                path: "documents",
                element: <PortalDocumentsPage />,
              },
              {
                path: "inbox",
                element: <PortalInboxPage />,
              },
            ],
          },
        ],
      },
      // Admin Protected routes (admin and super_admin only)
      {
        path: "/admin",
        element: <AdminProtectedRoute />,
        children: [
          {
            element: <AdminLayout />,
            children: [
              {
                index: true,
                element: <AdminDashboardPage />,
              },
              {
                path: "todos",
                element: <KanbanBoardPage />,
              },
              // Lenders (super_admin only)
              {
                path: "lenders",
                element: <SuperAdminProtectedRoute />,
                children: [
                  {
                    index: true,
                    element: <LendersListPage />,
                  },
                  {
                    path: "resources",
                    element: <LenderResourcesPage />,
                  },
                  {
                    path: ":id",
                    element: <LenderDetailPage />,
                  },
                ],
              },
              // Customers (admin+)
              {
                path: "customers",
                element: <CustomersListPage />,
              },
              {
                path: "customers/:id",
                element: <CustomerDetailPage />,
              },
              // Marketing (super_admin only)
              {
                path: "marketing",
                element: <SuperAdminProtectedRoute />,
                children: [
                  {
                    index: true,
                    element: <MarketingPage />,
                  },
                  {
                    path: "resources",
                    element: <MarketingResourcesPage />,
                  },
                  {
                    path: ":id",
                    element: <VendorDetailPage />,
                  },
                ],
              },
              // Analytics (super_admin only)
              {
                path: "analytics",
                element: <SuperAdminProtectedRoute />,
                children: [
                  {
                    index: true,
                    element: <AnalyticsDashboardPage />,
                  },
                  {
                    path: "realtime",
                    element: <RealTimeDashboardPage />,
                  },
                ],
              },
              // Unit Economics (super_admin only)
              {
                path: "unit-economics",
                element: <SuperAdminProtectedRoute />,
                children: [
                  {
                    index: true,
                    element: <UnitEconomicsPage />,
                  },
                ],
              },
              // Business Model Canvas (super_admin only)
              {
                path: "bmc",
                element: <SuperAdminProtectedRoute />,
                children: [
                  {
                    index: true,
                    element: <BusinessModelCanvasPage />,
                  },
                ],
              },
              // Settings (super_admin only)
              {
                path: "settings",
                element: <SuperAdminProtectedRoute />,
                children: [
                  {
                    index: true,
                    element: <AdminSettingsPage />,
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  {
    path: "*",
    element: <NotFoundPage />,
  },
]);

export default router;
