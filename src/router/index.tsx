import { lazy } from "react";
import type { RouteObject } from "react-router-dom";
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
import OptinPage from "../pages/OptinPage.tsx";
import ApplyPage from "../pages/ApplyPage.tsx";
import VCFReliefPage from "../pages/VCFReliefPage.tsx";
import VCFSavingsCalculatorPage from "../pages/calculators/VCFSavingsCalculatorPage.tsx";
import MCAFundingCalculatorPage from "../pages/calculators/MCAFundingCalculatorPage.tsx";
import MCACostCalculatorPage from "../pages/calculators/MCACostCalculatorPage.tsx";
import CloserEarningsCalculatorPage from "../pages/calculators/CloserEarningsCalculatorPage.tsx";
import PartnersPage from "../pages/PartnersPage.tsx";
import ResourcesPage from "../pages/ResourcesPage.tsx";
import ResourceDetailPage from "../pages/ResourceDetailPage.tsx";
import GlossaryPage from "../pages/GlossaryPage.tsx";
import AuthProtectedRoute from "./AuthProtectedRoute.tsx";
import AdminProtectedRoute from "./AdminProtectedRoute.tsx";
import SuperAdminProtectedRoute from "./SuperAdminProtectedRoute.tsx";
import Providers from "../Providers.tsx";

// Admin pages
const AdminLayout = lazy(() => import("../pages/admin/AdminLayout.tsx"));
const AdminDashboardPage = lazy(() => import("../pages/admin/AdminDashboardPage.tsx"));
const KanbanBoardPage = lazy(() => import("../pages/admin/KanbanBoardPage.tsx"));
const LendersListPage = lazy(() => import("../pages/admin/lenders/LendersListPage.tsx"));
const LenderDetailPage = lazy(() => import("../pages/admin/lenders/LenderDetailPage.tsx"));
const LenderResourcesPage = lazy(() => import("../pages/admin/lenders/LenderResourcesPage.tsx"));
const CustomersListPage = lazy(() => import("../pages/admin/customers/CustomersListPage.tsx"));
const CustomerDetailPage = lazy(() => import("../pages/admin/customers/CustomerDetailPage.tsx"));
const MarketingPage = lazy(() => import("../pages/admin/MarketingPage.tsx"));
const MarketingResourcesPage = lazy(() => import("../pages/admin/marketing/MarketingResourcesPage.tsx"));
const VendorDetailPage = lazy(() => import("../pages/admin/marketing/VendorDetailPage.tsx"));
const AnalyticsDashboardPage = lazy(() => import("../pages/admin/analytics/AnalyticsDashboardPage.tsx"));
const RealTimeDashboardPage = lazy(() => import("../pages/admin/analytics/RealTimeDashboardPage.tsx"));
const DealAnalyticsPage = lazy(() => import("../pages/admin/analytics/DealAnalyticsPage.tsx"));
const CloserPerformancePage = lazy(() => import("../pages/admin/analytics/CloserPerformancePage.tsx"));
const LenderPerformancePage = lazy(() => import("../pages/admin/analytics/LenderPerformancePage.tsx"));
const MarketPerformancePage = lazy(() => import("../pages/admin/analytics/MarketPerformancePage.tsx"));
const LeadSourceROIPage = lazy(() => import("../pages/admin/analytics/LeadSourceROIPage.tsx"));
const AdminSettingsPage = lazy(() => import("../pages/admin/AdminSettingsPage.tsx"));
const IntegrationsPage = lazy(() => import("../pages/admin/settings/IntegrationsPage.tsx"));
const BusinessModelCanvasPage = lazy(() => import("../pages/admin/BusinessModelCanvasPage.tsx"));
const CloserCompPage = lazy(() => import("../pages/admin/CloserCompPage.tsx"));
const PipelinePlaybookPage = lazy(() => import("../pages/admin/PipelinePlaybookPage.tsx"));
const CompliancePage = lazy(() => import("../pages/admin/CompliancePage.tsx"));
const RenewalsPage = lazy(() => import("../pages/admin/RenewalsPage.tsx"));
const DocumentReviewPage = lazy(() => import("../pages/admin/DocumentReviewPage.tsx"));
const LeadSourcesPage = lazy(() => import("../pages/admin/LeadSourcesPage.tsx"));
const ReferralPartnersPage = lazy(() => import("../pages/admin/ReferralPartnersPage.tsx"));
const SyncLogPage = lazy(() => import("../pages/admin/SyncLogPage.tsx"));
const PlatformConfigPage = lazy(() => import("../pages/admin/PlatformConfigPage.tsx"));
const SequencesPage = lazy(() => import("../pages/admin/SequencesPage.tsx"));
const ResourcesAdminPage = lazy(() => import("../pages/admin/ResourcesAdminPage.tsx"));
const FunderGuidePage = lazy(() => import("../pages/admin/FunderGuidePage.tsx"));
const DealListPage = lazy(() => import("../pages/admin/deals/DealListPage.tsx"));
const DealDetailPage = lazy(() => import("../pages/admin/deals/DealDetailPage.tsx"));

// Commission & Financial Engine pages
const CloserListPage = lazy(() => import("../pages/admin/closers/CloserListPage.tsx"));
const CloserDetailPage = lazy(() => import("../pages/admin/closers/CloserDetailPage.tsx"));
const SubISOListPage = lazy(() => import("../pages/admin/sub-isos/SubISOListPage.tsx"));
const CommissionDashboardPage = lazy(() => import("../pages/admin/commissions/CommissionDashboardPage.tsx"));

// Portal pages
const PortalLayout = lazy(() => import("../pages/portal/PortalLayout.tsx"));
const PortalDashboardPage = lazy(() => import("../pages/portal/PortalDashboardPage.tsx"));
const PortalDocumentsPage = lazy(() => import("../pages/portal/PortalDocumentsPage.tsx"));
const PortalInboxPage = lazy(() => import("../pages/portal/PortalInboxPage.tsx"));

export const routes: RouteObject[] = [
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
      {
        path: "/optin",
        element: <OptinPage />,
      },
      {
        path: "/apply",
        element: <ApplyPage />,
      },
      {
        path: "/debt-relief",
        element: <VCFReliefPage />,
      },
      {
        path: "/calculators/mca-debt-relief",
        element: <VCFSavingsCalculatorPage />,
      },
      {
        path: "/calculators/how-much-can-i-get",
        element: <MCAFundingCalculatorPage />,
      },
      {
        path: "/calculators/advance-cost",
        element: <MCACostCalculatorPage />,
      },
      {
        path: "/careers/closer-earnings",
        element: <CloserEarningsCalculatorPage />,
      },
      {
        path: "/partners",
        element: <PartnersPage />,
      },
      {
        path: "/resources",
        element: <ResourcesPage />,
      },
      {
        path: "/resources/glossary",
        element: <GlossaryPage />,
      },
      {
        path: "/resources/:slug",
        element: <ResourceDetailPage />,
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
              // Deals (admin+)
              {
                path: "deals",
                element: <DealListPage />,
              },
              {
                path: "deals/:id",
                element: <DealDetailPage />,
              },
              // Closers (super_admin only)
              {
                path: "closers",
                element: <SuperAdminProtectedRoute />,
                children: [
                  {
                    index: true,
                    element: <CloserListPage />,
                  },
                  {
                    path: ":id",
                    element: <CloserDetailPage />,
                  },
                ],
              },
              // Sub-ISOs (super_admin only)
              {
                path: "sub-isos",
                element: <SuperAdminProtectedRoute />,
                children: [
                  {
                    index: true,
                    element: <SubISOListPage />,
                  },
                ],
              },
              // Commissions (super_admin only)
              {
                path: "commissions",
                element: <SuperAdminProtectedRoute />,
                children: [
                  {
                    index: true,
                    element: <CommissionDashboardPage />,
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
                  {
                    path: "deals",
                    element: <DealAnalyticsPage />,
                  },
                  {
                    path: "closers",
                    element: <CloserPerformancePage />,
                  },
                  {
                    path: "lenders",
                    element: <LenderPerformancePage />,
                  },
                  {
                    path: "markets",
                    element: <MarketPerformancePage />,
                  },
                  {
                    path: "lead-sources",
                    element: <LeadSourceROIPage />,
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
              // Closer Comp Plan (super_admin only)
              {
                path: "closer-comp",
                element: <SuperAdminProtectedRoute />,
                children: [{ index: true, element: <CloserCompPage /> }],
              },
              // Pipeline Playbook (admin + super_admin) — onboarding
              {
                path: "pipeline-playbook",
                element: <PipelinePlaybookPage />,
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
              // Renewals (admin + super_admin)
              {
                path: "renewals",
                element: <RenewalsPage />,
              },
              // Document review (admin + super_admin)
              {
                path: "documents",
                element: <DocumentReviewPage />,
              },
              // Follow-up sequence tracking (admin + super_admin)
              {
                path: "sequences",
                element: <SequencesPage />,
              },
              // Funder submission guide (admin + super_admin)
              {
                path: "funder-guide",
                element: <FunderGuidePage />,
              },
              // Resources / blog admin (super_admin only)
              {
                path: "resources",
                element: <SuperAdminProtectedRoute />,
                children: [{ index: true, element: <ResourcesAdminPage /> }],
              },
              // Lead sources (super_admin only)
              {
                path: "lead-sources",
                element: <SuperAdminProtectedRoute />,
                children: [{ index: true, element: <LeadSourcesPage /> }],
              },
              // Referral partners (admin + super_admin)
              {
                path: "referrals",
                element: <ReferralPartnersPage />,
              },
              // Compliance disclosures (super_admin only)
              {
                path: "compliance",
                element: <SuperAdminProtectedRoute />,
                children: [{ index: true, element: <CompliancePage /> }],
              },
              // GHL sync log (super_admin only)
              {
                path: "sync-log",
                element: <SuperAdminProtectedRoute />,
                children: [{ index: true, element: <SyncLogPage /> }],
              },
              // Platform config (super_admin only)
              {
                path: "platform-config",
                element: <SuperAdminProtectedRoute />,
                children: [{ index: true, element: <PlatformConfigPage /> }],
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
                  {
                    path: "integrations",
                    element: <IntegrationsPage />,
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
];
