import type { ReportDef } from "./types";
import EmailQualityReportPanel from "./EmailQualityReportPanel";

// The report registry. Every entry shows up in the Reports section's picker; the
// selected entry's Panel is mounted with the campaign list. To add a report: build
// a Panel component that takes { campaigns }, then append its ReportDef here.
export const REPORTS: ReportDef[] = [
  {
    id: "email-quality",
    name: "Email Quality Report",
    description: "Per-campaign email deliverability for a vendor over a date range — verified / invalid / bounced / catch-all, hard-bad rate, and the records to credit or replace. Copy-and-paste ready.",
    Panel: EmailQualityReportPanel,
  },
];

export type { ReportDef } from "./types";
