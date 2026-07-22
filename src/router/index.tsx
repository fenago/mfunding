import { lazy, type ComponentType } from "react";
import { Navigate, type RouteObject } from "react-router-dom";
import HeroPreviewPage from "../pages/HeroPreviewPage.tsx";
import LandingOS from "../pages/LandingOS.tsx";
import { IS_PORTAL_HOST } from "../config.ts";

// After a new deploy, chunk filenames change. A tab opened before the deploy
// will request an old hashed chunk that no longer exists ("Failed to fetch
// dynamically imported module"). Reload once to pick up the fresh index.html;
// the timestamp guard prevents an infinite reload loop if it's a real failure.
function lazyWithReload<T extends { default: ComponentType<unknown> }>(
  factory: () => Promise<T>
) {
  return lazy(() =>
    factory().catch((err: unknown) => {
      const KEY = "mf_chunk_reload_ts";
      const last = Number(sessionStorage.getItem(KEY) || 0);
      if (Date.now() - last > 10000) {
        sessionStorage.setItem(KEY, String(Date.now()));
        window.location.reload();
        return new Promise<T>(() => {}); // never resolves; the page reloads
      }
      throw err;
    })
  );
}
import SignInPage from "../pages/auth/SignInPage.tsx";
import SignUpPage from "../pages/auth/SignUpPage.tsx";
import MerchantAuthPage from "../pages/auth/MerchantAuthPage.tsx";
import ProtectedPage from "../pages/ProtectedPage.tsx";
import NotFoundPage from "../pages/404Page.tsx";
import PrivacyPolicyPage from "../pages/PrivacyPolicyPage.tsx";
import TermsOfServicePage from "../pages/TermsOfServicePage.tsx";
import UnitEconomicsPage from "../pages/UnitEconomicsPage.tsx";
import RevenuePage from "../pages/admin/RevenuePage.tsx";
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
import FundingReadinessScorePage from "../pages/assessments/FundingReadinessScorePage.tsx";
import FundingMatcherPage from "../pages/assessments/FundingMatcherPage.tsx";
import FundingAffordabilityPage from "../pages/assessments/FundingAffordabilityPage.tsx";
import MCADebtStressTestPage from "../pages/assessments/MCADebtStressTestPage.tsx";
import ReliefQualifierPage from "../pages/assessments/ReliefQualifierPage.tsx";
import BusinessHealthScorecardPage from "../pages/assessments/BusinessHealthScorecardPage.tsx";
import CashFlowGapAnalyzerPage from "../pages/assessments/CashFlowGapAnalyzerPage.tsx";
import FreeToolsPage from "../pages/FreeToolsPage.tsx";
import PartnersPage from "../pages/PartnersPage.tsx";
import ResourcesPage from "../pages/ResourcesPage.tsx";
import ResourceDetailPage from "../pages/ResourceDetailPage.tsx";
import GlossaryPage from "../pages/GlossaryPage.tsx";
import AuthProtectedRoute from "./AuthProtectedRoute.tsx";
import AdminProtectedRoute from "./AdminProtectedRoute.tsx";
import SuperAdminProtectedRoute from "./SuperAdminProtectedRoute.tsx";
import AdminOnlyProtectedRoute from "./AdminOnlyProtectedRoute.tsx";
import RenewalsProtectedRoute from "./RenewalsProtectedRoute.tsx";
import Providers from "../Providers.tsx";

// Admin pages
const AdminLayout = lazyWithReload(() => import("../pages/admin/AdminLayout.tsx"));
const AdminIndexRoute = lazyWithReload(() => import("./AdminIndexRoute.tsx"));
const KanbanBoardPage = lazyWithReload(() => import("../pages/admin/KanbanBoardPage.tsx"));
const LendersListPage = lazyWithReload(() => import("../pages/admin/lenders/LendersListPage.tsx"));
const LenderDetailPage = lazyWithReload(() => import("../pages/admin/lenders/LenderDetailPage.tsx"));
const LenderResourcesPage = lazyWithReload(() => import("../pages/admin/lenders/LenderResourcesPage.tsx"));
const CustomersListPage = lazyWithReload(() => import("../pages/admin/customers/CustomersListPage.tsx"));
const CustomerDetailPage = lazyWithReload(() => import("../pages/admin/customers/CustomerDetailPage.tsx"));
const MarketingPage = lazyWithReload(() => import("../pages/admin/MarketingPage.tsx"));
const MarketingResourcesPage = lazyWithReload(() => import("../pages/admin/marketing/MarketingResourcesPage.tsx"));
const VendorDetailPage = lazyWithReload(() => import("../pages/admin/marketing/VendorDetailPage.tsx"));
const LiveTransferLeadsPage = lazyWithReload(() => import("../pages/admin/marketing/LiveTransferLeadsPage.tsx"));
const LeadListsPage = lazyWithReload(() => import("../pages/admin/marketing/LeadListsPage.tsx"));
const VendorScorecardPage = lazyWithReload(() => import("../pages/admin/marketing/VendorScorecardPage.tsx"));
const AnalyticsDashboardPage = lazyWithReload(() => import("../pages/admin/analytics/AnalyticsDashboardPage.tsx"));
const RealTimeDashboardPage = lazyWithReload(() => import("../pages/admin/analytics/RealTimeDashboardPage.tsx"));
const DealAnalyticsPage = lazyWithReload(() => import("../pages/admin/analytics/DealAnalyticsPage.tsx"));
const CloserPerformancePage = lazyWithReload(() => import("../pages/admin/analytics/CloserPerformancePage.tsx"));
const LenderPerformancePage = lazyWithReload(() => import("../pages/admin/analytics/LenderPerformancePage.tsx"));
const MarketPerformancePage = lazyWithReload(() => import("../pages/admin/analytics/MarketPerformancePage.tsx"));
const LeadSourceROIPage = lazyWithReload(() => import("../pages/admin/analytics/LeadSourceROIPage.tsx"));
const AdminSettingsPage = lazyWithReload(() => import("../pages/admin/AdminSettingsPage.tsx"));
const IntegrationsPage = lazyWithReload(() => import("../pages/admin/settings/IntegrationsPage.tsx"));
const BusinessModelCanvasPage = lazyWithReload(() => import("../pages/admin/BusinessModelCanvasPage.tsx"));
const CloserCompPage = lazyWithReload(() => import("../pages/admin/CloserCompPage.tsx"));
const PipelinePlaybookPage = lazyWithReload(() => import("../pages/admin/PipelinePlaybookPage.tsx"));
const PlaybooksPage = lazyWithReload(() => import("../pages/admin/PlaybooksPage.tsx"));
const CampaignsPage = lazyWithReload(() => import("../pages/admin/CampaignsPage.tsx"));
const LeadBudgetCalculatorPage = lazyWithReload(() => import("../pages/admin/LeadBudgetCalculatorPage.tsx"));
const FunderDirectoryPage = lazyWithReload(() => import("../pages/admin/FunderDirectoryPage.tsx"));
const FunderMatrixPage = lazyWithReload(() => import("../pages/admin/FunderMatrixPage.tsx"));
const LenderCatalogPage = lazyWithReload(() => import("../pages/admin/LenderCatalogPage.tsx"));
const EmailPage = lazyWithReload(() => import("../pages/admin/EmailPage.tsx"));
const ColdEmailPlannerPage = lazyWithReload(() => import("../pages/admin/ColdEmailPlannerPage.tsx"));
const UnitEconomicsVCFPage = lazyWithReload(() => import("../pages/admin/UnitEconomicsVCFPage.tsx"));
const LeadToolsPage = lazyWithReload(() => import("../pages/admin/LeadToolsPage.tsx"));
const LeadPartnerPage = lazyWithReload(() => import("../pages/admin/LeadPartnerPage.tsx"));
const LiveTransferROIPage = lazyWithReload(() => import("../pages/admin/LiveTransferROIPage.tsx"));
const CompliancePage = lazyWithReload(() => import("../pages/admin/CompliancePage.tsx"));
const RenewalsPage = lazyWithReload(() => import("../pages/admin/RenewalsPage.tsx"));
const DocumentReviewPage = lazyWithReload(() => import("../pages/admin/DocumentReviewPage.tsx"));
const LeadSourcesPage = lazyWithReload(() => import("../pages/admin/LeadSourcesPage.tsx"));
const LeadImportPage = lazyWithReload(() => import("../pages/admin/LeadImportPage.tsx"));
const ReferralPartnersPage = lazyWithReload(() => import("../pages/admin/ReferralPartnersPage.tsx"));
const SyncLogPage = lazyWithReload(() => import("../pages/admin/SyncLogPage.tsx"));
const FunderContactsPage = lazyWithReload(() => import("../pages/admin/FunderContactsPage.tsx"));
const PlatformConfigPage = lazyWithReload(() => import("../pages/admin/PlatformConfigPage.tsx"));
const UnderwritingSettingsPage = lazyWithReload(() => import("../pages/admin/UnderwritingSettingsPage.tsx"));
const UsersPage = lazyWithReload(() => import("../pages/admin/UsersPage.tsx"));
const SequencesPage = lazyWithReload(() => import("../pages/admin/SequencesPage.tsx"));
const ResourcesAdminPage = lazyWithReload(() => import("../pages/admin/ResourcesAdminPage.tsx"));
const FunderGuidePage = lazyWithReload(() => import("../pages/admin/FunderGuidePage.tsx"));
const StrategyPage = lazyWithReload(() => import("../pages/admin/StrategyPage.tsx"));
const CommsPage = lazyWithReload(() => import("../pages/admin/CommsPage.tsx"));
const CalendarPage = lazyWithReload(() => import("../pages/admin/CalendarPage.tsx"));
const DealListPage = lazyWithReload(() => import("../pages/admin/deals/DealListPage.tsx"));
const DealDetailPage = lazyWithReload(() => import("../pages/admin/deals/DealDetailPage.tsx"));

// Commission & Financial Engine pages
const CloserListPage = lazyWithReload(() => import("../pages/admin/closers/CloserListPage.tsx"));
const MyEarningsPage = lazyWithReload(() => import("../pages/admin/closers/MyEarningsPage.tsx"));
const CloserDetailPage = lazyWithReload(() => import("../pages/admin/closers/CloserDetailPage.tsx"));
const DocsIndexPage = lazyWithReload(() => import("../pages/admin/docs/DocsIndexPage.tsx"));
const DocViewerPage = lazyWithReload(() => import("../pages/admin/docs/DocViewerPage.tsx"));
const CloserDocsPage = lazyWithReload(() => import("../pages/admin/closers/CloserDocsPage.tsx"));
const CloserDocViewerPage = lazyWithReload(() => import("../pages/admin/closers/CloserDocViewerPage.tsx"));
const SubISOListPage = lazyWithReload(() => import("../pages/admin/sub-isos/SubISOListPage.tsx"));
const CommissionDashboardPage = lazyWithReload(() => import("../pages/admin/commissions/CommissionDashboardPage.tsx"));

// Portal pages
const PortalLayout = lazyWithReload(() => import("../pages/portal/PortalLayout.tsx"));
const PortalDashboardPage = lazyWithReload(() => import("../pages/portal/PortalDashboardPage.tsx"));
const PortalDocumentsPage = lazyWithReload(() => import("../pages/portal/PortalDocumentsPage.tsx"));
const PortalInboxPage = lazyWithReload(() => import("../pages/portal/PortalInboxPage.tsx"));
const PortalOffersPage = lazyWithReload(() => import("../pages/portal/PortalOffersPage.tsx"));
const PortalSignPage = lazyWithReload(() => import("../pages/portal/PortalSignPage.tsx"));
const PortalHowItWorksPage = lazyWithReload(() => import("../pages/portal/PortalHowItWorksPage.tsx"));

export const routes: RouteObject[] = [
  {
    path: "/",
    element: <Providers />,
    children: [
      // Public routes.
      // On the dedicated portal subdomain (my.mfunding.net) the root is the
      // merchant portal, not the marketing site. IS_PORTAL_HOST is a stable
      // runtime hostname check — same bundle serves either host.
      {
        path: "/",
        element: IS_PORTAL_HOST ? <Navigate to="/portal" replace /> : <LandingOS />,
      },
      {
        // Throwaway design preview of a new hero direction (compare vs the live "/").
        path: "/hero-preview",
        element: <HeroPreviewPage />,
      },
      {
        path: "/landing-os",
        element: <LandingOS />,
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
        // Magic-link landing for merchants (Supabase OTP redirect → /portal).
        path: "/auth/merchant",
        element: <MerchantAuthPage />,
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
        path: "/assessments/funding-readiness-score",
        element: <FundingReadinessScorePage />,
      },
      {
        path: "/assessments/find-your-funding",
        element: <FundingMatcherPage />,
      },
      {
        path: "/assessments/how-much-can-you-handle",
        element: <FundingAffordabilityPage />,
      },
      {
        path: "/assessments/mca-debt-stress-test",
        element: <MCADebtStressTestPage />,
      },
      {
        path: "/assessments/do-you-qualify-for-relief",
        element: <ReliefQualifierPage />,
      },
      {
        path: "/assessments/business-health-scorecard",
        element: <BusinessHealthScorecardPage />,
      },
      {
        path: "/assessments/cash-flow-gap-analyzer",
        element: <CashFlowGapAnalyzerPage />,
      },
      {
        path: "/tools",
        element: <FreeToolsPage />,
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
                path: "offers",
                element: <PortalOffersPage />,
              },
              {
                path: "sign/:documentId",
                element: <PortalSignPage />,
              },
              {
                path: "how-it-works",
                element: <PortalHowItWorksPage />,
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
                element: <AdminIndexRoute />,
              },
              {
                path: "todos",
                element: <AdminOnlyProtectedRoute />,
                children: [{ index: true, element: <KanbanBoardPage /> }],
              },
              // Lenders (admin + super_admin — admins manage the funder network)
              {
                path: "lenders",
                element: <AdminOnlyProtectedRoute />,
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
              // Closer onboarding documents.
              // NOT super-admin-gated: a closer has to be able to open and sign
              // their own paperwork. The page renders the manager view only for
              // admin/super_admin, and RLS means a closer can only ever read
              // their OWN tracker rows and signatures.
              {
                path: "closer-docs",
                children: [
                  { index: true, element: <CloserDocsPage /> },
                  { path: ":slug", element: <CloserDocViewerPage /> },
                ],
              },
              // Project documentation library (functional + technical).
              // Every STAFF role reads it — closer, employee, admin, super_admin —
              // so it carries no extra guard beyond AdminProtectedRoute, whose
              // isStaff check is exactly that set. Merchants (role `user`) fail
              // isStaff and are bounced to "/" before this renders.
              {
                path: "docs",
                children: [
                  { index: true, element: <DocsIndexPage /> },
                  { path: ":set/:slug", element: <DocViewerPage /> },
                ],
              },
              // Sales doctrine — training every closer needs. Same visibility as
              // docs: no extra guard, so AdminProtectedRoute's isStaff check
              // (closer + employee + admin + super_admin) gates it. Merchants fail
              // isStaff and never reach it.
              {
                path: "strategy",
                element: <StrategyPage />,
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
              // Campaigns — spend & ROI tracking (super_admin only)
              {
                path: "campaigns",
                element: <SuperAdminProtectedRoute />,
                children: [{ index: true, element: <CampaignsPage /> }],
              },
              // Lead-buying budget calculator (super_admin only)
              {
                path: "lead-budget",
                element: <SuperAdminProtectedRoute />,
                children: [{ index: true, element: <LeadBudgetCalculatorPage /> }],
              },
              // Funder partnership directory (admin + super_admin — admins manage
              // the funder network, same as Lenders)
              {
                path: "funder-directory",
                element: <AdminOnlyProtectedRoute />,
                children: [{ index: true, element: <FunderDirectoryPage /> }],
              },
              // Funder approval matrix — per-lender MCA criteria (admin + super_admin)
              {
                path: "funder-matrix",
                element: <AdminOnlyProtectedRoute />,
                children: [{ index: true, element: <FunderMatrixPage /> }],
              },
              // Lender product catalog — read-only, data-driven view of the whole
              // funder network grouped by readiness (admin + super_admin, NOT closers)
              {
                path: "lender-catalog",
                element: <AdminOnlyProtectedRoute />,
                children: [{ index: true, element: <LenderCatalogPage /> }],
              },
              // Cold-email (Instantly) dashboard + strategy (admins + super_admin)
              {
                path: "email",
                element: <AdminOnlyProtectedRoute />,
                children: [{ index: true, element: <EmailPage /> }],
              },
              // Cold email planner — capacity model + warmup tracker (admin+)
              {
                path: "cold-email",
                element: <ColdEmailPlannerPage />,
              },
              // Users & roles (super_admin only)
              {
                path: "users",
                element: <SuperAdminProtectedRoute />,
                children: [
                  {
                    index: true,
                    element: <UsersPage />,
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
                    path: "live-transfers",
                    element: <LiveTransferLeadsPage />,
                  },
                  {
                    path: "lead-lists",
                    element: <LeadListsPage />,
                  },
                  {
                    path: "scorecard",
                    element: <VendorScorecardPage />,
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
              // Revenue & Commission (super_admin only)
              {
                path: "revenue",
                element: <SuperAdminProtectedRoute />,
                children: [{ index: true, element: <RevenuePage /> }],
              },
              // Unit Economics — MCA (super_admin only)
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
              // Unit Economics — VCF (super_admin only)
              {
                path: "unit-economics-vcf",
                element: <SuperAdminProtectedRoute />,
                children: [{ index: true, element: <UnitEconomicsVCFPage /> }],
              },
              // Closer Comp Plan (all staff — closer + admin + super_admin)
              {
                path: "closer-comp",
                element: <CloserCompPage />,
              },
              // My Earnings (all staff) — self-scoped by RLS to the signed-in closer
              {
                path: "my-earnings",
                element: <MyEarningsPage />,
              },
              // Live Transfer ROI (super_admin only)
              {
                path: "live-transfer-roi",
                element: <SuperAdminProtectedRoute />,
                children: [{ index: true, element: <LiveTransferROIPage /> }],
              },
              // Pipeline Playbook (admin + super_admin) — onboarding
              {
                path: "pipeline-playbook",
                element: <PipelinePlaybookPage />,
              },
              // Revenue Playbooks (all staff) — the 3 money flows, step by step
              {
                path: "playbooks",
                element: <PlaybooksPage />,
              },
              // Lead Tools management (operational — all staff)
              {
                path: "lead-tools",
                element: <LeadToolsPage />,
              },
              // Synergy — primary lead partner (admins + super_admin)
              {
                path: "lead-partner",
                element: <AdminOnlyProtectedRoute />,
                children: [{ index: true, element: <LeadPartnerPage /> }],
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
              // Renewals — staff, gated per closer by closers.renewals_enabled
              {
                path: "renewals",
                element: <RenewalsProtectedRoute />,
                children: [{ index: true, element: <RenewalsPage /> }],
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
              // Comms — contact search + email via GHL (all staff)
              {
                path: "comms",
                element: <CommsPage />,
              },
              // Calendar — callbacks, stips promises, SLA windows (all staff;
              // RLS scopes a closer to their own book, admins get Mine/All)
              {
                path: "calendar",
                element: <CalendarPage />,
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
              // Bulk CSV lead import (admin + super_admin / ops)
              {
                path: "lead-import",
                element: <AdminOnlyProtectedRoute />,
                children: [{ index: true, element: <LeadImportPage /> }],
              },
              // Referral partners (admin + super_admin)
              {
                path: "referrals",
                element: <AdminOnlyProtectedRoute />,
                children: [{ index: true, element: <ReferralPartnersPage /> }],
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
              // Funder-reply reconciler — associate funder replies with lenders (admin + super_admin)
              {
                path: "funder-contacts",
                element: <AdminOnlyProtectedRoute />,
                children: [{ index: true, element: <FunderContactsPage /> }],
              },
              // Platform config (super_admin only)
              {
                path: "platform-config",
                element: <SuperAdminProtectedRoute />,
                children: [{ index: true, element: <PlatformConfigPage /> }],
              },
              // AI underwriter tuning knobs (super_admin only)
              {
                path: "underwriting-settings",
                element: <SuperAdminProtectedRoute />,
                children: [{ index: true, element: <UnderwritingSettingsPage /> }],
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
