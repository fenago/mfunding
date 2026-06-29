import type { UserRole } from "../context/UserProfileContext";

// What each role can see, mirroring the admin sidebar (OPS vs SUPER) plus the
// customer portal. Used by the Users page "What each role can see" reference.
// closer and admin currently share the same operational access; super_admin adds
// the owner-only screens; user (merchant) only gets the customer portal.

const OPS: UserRole[] = ["closer", "admin", "super_admin"];
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
  { role: "admin", label: "Admin", blurb: "Staff. Same operational access as closers (no owner-only finances/config)." },
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
    title: "Overview",
    items: [
      { name: "Admin Dashboard", roles: OPS },
      { name: "Launch Board (Tasks)", roles: OPS },
    ],
  },
  {
    title: "Pipeline",
    items: [
      { name: "Customers", roles: OPS },
      { name: "Deals", roles: OPS },
      { name: "Renewals", roles: OPS },
      { name: "Doc Review", roles: OPS },
    ],
  },
  {
    title: "Lead Generation",
    items: [
      { name: "Lead Tools", roles: OPS },
      { name: "Sequences", roles: OPS },
      { name: "Referrals", roles: OPS },
      { name: "Marketing", roles: SUPER },
      { name: "Lead Sources", roles: SUPER },
    ],
  },
  {
    title: "Funder Network",
    items: [
      { name: "Lenders", roles: SUPER },
      { name: "Funder Guide", roles: OPS },
      { name: "Closers", roles: SUPER },
      { name: "Sub-ISOs", roles: SUPER },
    ],
  },
  {
    title: "Finance",
    items: [
      { name: "Commissions", roles: SUPER },
      { name: "Unit Economics", roles: SUPER },
      { name: "Live Transfer ROI", roles: SUPER },
      { name: "Closer Comp", roles: SUPER },
      { name: "Business Model", roles: SUPER },
    ],
  },
  {
    title: "Analytics",
    items: [
      { name: "Analytics", roles: SUPER },
      { name: "Real-Time", roles: SUPER },
    ],
  },
  {
    title: "Training",
    items: [
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
