import type { Campaign } from "@/services/campaignService";

// A slot-in report. Add a new file that exports a ReportDef and push it into the
// REPORTS array in ./index — the Reports section renders every registered report's
// picker entry and mounts its Panel on selection. Nothing else needs to change.
export interface ReportDef {
  id: string;
  name: string;
  description: string;                                   // one line shown under the name in the picker
  Panel: React.ComponentType<{ campaigns: Campaign[] }>; // owns its own inputs + output UX
}
