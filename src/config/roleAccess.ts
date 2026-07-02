import type { UserRole } from "../context/UserProfileContext";

// What each role can see, mirroring the admin sidebar (OPS / ADMIN / SUPER) plus
// the customer portal. Used by the Users page "What each role can see" reference.
// closer and admin share the operational pipeline (OPS); admin adds Lenders
// management (ADMIN); super_admin adds the owner-only screens (finances,
// analytics, config); user (merchant) only gets the customer portal.

// employee mirrors admin's route access (minus the super-admin-only screens).
const OPS: UserRole[] = ["closer", "employee", "admin", "super_admin"];
const ADMIN: UserRole[] = ["employee", "admin", "super_admin"]; // managers/staff — not closers
const SUPER: UserRole[] = ["super_admin"];
const MERCHANT: UserRole[] = ["user"];

export interface AccessItem {
  name: string;
  roles: UserRole[];
}
export interface AccessGroup {
  title: string;
  items: AccessItem[];
}

export const ROLE_LABELS: { role: UserRole; label: string; blurb: string }[] = [
  { role: "user", label: "User (Merchant)", blurb: "Your customers. Apply for funding and use the customer portal — no admin access." },
  { role: "closer", label: "Closer", blurb: "1099 sales reps. Full operational pipeline access; no finances, network, or settings." },
  { role: "employee", label: "Employee", blurb: "Internal staff. Same screens as Admin (pipeline, task board, referrals, lenders) — no owner-only finances, analytics, or config." },
  { role: "admin", label: "Admin", blurb: "Staff/managers. Full operational pipeline plus Lenders (add/manage funders) — no owner-only finances, analytics, or config." },
  { role: "super_admin", label: "Super Admin", blurb: "Owner (you). Everything, including finances, network, analytics, config, and user management." },
];

export const ACCESS_GROUPS: AccessGroup[] = [
  {
    title: "Customer Portal",
    items: [
      { name: "Portal Dashboard", roles: MERCHANT },
      { name: "My Documents", roles: MERCHANT },
      { name: "My Estimates", roles: MERCHANT },
      { name: "Inbox / Messages", roles: MERCHANT },
    ],
  },
  {
    title: "Home",
    items: [
      { name: "Admin Dashboard", roles: OPS },
      { name: "Task Board", roles: ADMIN },
    ],
  },
  {
    title: "Pipeline",
    items: [
      { name: "Customers", roles: OPS },
      { name: "Deals", roles: OPS },
      { name: "Renewals", roles: OPS },
      { name: "Doc Review", roles: OPS },
      { name: "Comms", roles: OPS },
    ],
  },
  {
    title: "Lead Sourcing",
    items: [
      { name: "Lead Partner (Synergy)", roles: SUPER },
      { name: "Marketing Vendors", roles: SUPER },
      { name: "Vendor Scorecard", roles: SUPER },
      { name: "Live Transfer Leads", roles: SUPER },
      { name: "Lead Lists & Data", roles: SUPER },
      { name: "Lead Sources", roles: SUPER },
    ],
  },
  {
    title: "Marketing & Outreach",
    items: [
      { name: "Campaigns", roles: SUPER },
      { name: "Sequences", roles: OPS },
      { name: "Lead Tools", roles: OPS },
      { name: "Referrals", roles: ADMIN },
    ],
  },
  {
    title: "Team & Partners",
    items: [
      { name: "Closers", roles: SUPER },
      { name: "Sub-ISOs", roles: SUPER },
    ],
  },
  {
    title: "Funder Network",
    items: [
      { name: "Lenders", roles: ADMIN },
      { name: "Funder Guide", roles: OPS },
    ],
  },
  {
    title: "Finance",
    items: [
      { name: "Commissions", roles: SUPER },
      { name: "Unit Economics (MCA)", roles: SUPER },
      { name: "Unit Economics (VCF)", roles: SUPER },
      { name: "Live Transfer ROI", roles: SUPER },
      { name: "Closer Comp", roles: SUPER },
      { name: "Business Model", roles: SUPER },
    ],
  },
  {
    title: "Insights",
    items: [
      { name: "Analytics", roles: SUPER },
      { name: "Real-Time", roles: SUPER },
    ],
  },
  {
    title: "Playbooks & Training",
    items: [
      { name: "Revenue Playbooks", roles: OPS },
      { name: "Pipeline Playbook", roles: OPS },
      { name: "Resources / Articles", roles: OPS },
    ],
  },
  {
    title: "System",
    items: [
      { name: "Users (this page)", roles: SUPER },
      { name: "Compliance", roles: SUPER },
      { name: "Integrations", roles: SUPER },
      { name: "GHL Sync Log", roles: SUPER },
      { name: "Platform Config", roles: SUPER },
      { name: "Settings", roles: SUPER },
    ],
  },
];
