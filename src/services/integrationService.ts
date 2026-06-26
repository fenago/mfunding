import supabase from "../supabase";
import { listGHLPipelines, type GhlPipeline } from "./ghlService";

export interface GHLStatus {
  connected: boolean;
  pipelineCount: number;
  pipelines: GhlPipeline[];
  /** Whether a pipeline with all 9 MFunding stage names exists. */
  hasMFundingPipeline: boolean;
  error?: string;
}

const REQUIRED_STAGES = [
  "New Lead", "Contacted", "Qualifying", "Application Sent", "Docs Collected",
  "Bank Statements", "Submitted to Funders", "Offer Received", "Offer Presented",
  "Offer Accepted", "Funded",
];

/** Test the GHL connection by listing pipelines through the edge function. */
export async function getGHLStatus(): Promise<GHLStatus> {
  const res = await listGHLPipelines();
  if (!res.ok) {
    return { connected: false, pipelineCount: 0, pipelines: [], hasMFundingPipeline: false, error: res.error };
  }
  const hasMFundingPipeline = res.pipelines.some((p) => {
    const names = new Set(p.stages.map((s) => s.name.toLowerCase()));
    return REQUIRED_STAGES.every((s) => names.has(s.toLowerCase()));
  });
  return {
    connected: true,
    pipelineCount: res.pipelines.length,
    pipelines: res.pipelines,
    hasMFundingPipeline,
  };
}

export interface FollowUpSequenceRow {
  id: string;
  entity_type: "customer" | "deal";
  entity_id: string;
  sequence_key: string;
  sequence_label: string | null;
  status: string;
  current_step: number;
  enrolled_at: string;
  last_action_at: string | null;
  completed_at: string | null;
}

export async function getFollowUpSequences(limit = 50): Promise<FollowUpSequenceRow[]> {
  const { data, error } = await supabase
    .from("follow_up_sequences")
    .select("*")
    .order("enrolled_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []) as FollowUpSequenceRow[];
}

export interface SyncCounts {
  customersLinked: number;
  customersTotal: number;
  dealsLinked: number;
  dealsTotal: number;
}

/** How many customers/deals have a GHL id mapped vs total. */
export async function getSyncCounts(): Promise<SyncCounts> {
  const [cTotal, cLinked, dTotal, dLinked] = await Promise.all([
    supabase.from("customers").select("id", { count: "exact", head: true }),
    supabase.from("customers").select("id", { count: "exact", head: true }).not("ghl_contact_id", "is", null),
    supabase.from("deals").select("id", { count: "exact", head: true }),
    supabase.from("deals").select("id", { count: "exact", head: true }).not("ghl_opportunity_id", "is", null),
  ]);
  return {
    customersTotal: cTotal.count ?? 0,
    customersLinked: cLinked.count ?? 0,
    dealsTotal: dTotal.count ?? 0,
    dealsLinked: dLinked.count ?? 0,
  };
}
