import supabase from "../supabase";

// Follow-up sequence enrollment tracking. Sequences run in GHL; enrollments are
// recorded here (entity ⇄ sequence) so staff can see who's in which sequence.

export interface SequenceEnrollment {
  id: string;
  entity_type: string;        // 'customer' | 'deal' | 'contact'
  entity_id: string;
  sequence_key: string;       // A..F
  sequence_label: string | null;
  ghl_workflow_id: string | null;
  status: string;             // active | completed | stopped | ...
  current_step: number | null;
  enrolled_at: string | null;
  last_action_at: string | null;
  completed_at: string | null;
}

// The 6 sequences (reference — matches the GHL build).
export const SEQUENCES: { key: string; label: string; blurb: string }[] = [
  { key: "A", label: "Stips / Docs (14d)", blurb: "Document collection — highest priority" },
  { key: "B", label: "No Answer (7d)", blurb: "Never reached" },
  { key: "C", label: "Soft No (90d)", blurb: "Not right now → quarterly" },
  { key: "D", label: "Offer Declined (45d)", blurb: "Re-work objections / re-submit" },
  { key: "E", label: "Funded → Renewal", blurb: "Paydown-driven renewal nudges" },
  { key: "F", label: "Mass Reactivation", blurb: "Monthly dead-lead blast" },
];

export async function getEnrollments(activeOnly = false): Promise<SequenceEnrollment[]> {
  let q = supabase
    .from("follow_up_sequences")
    .select("id, entity_type, entity_id, sequence_key, sequence_label, ghl_workflow_id, status, current_step, enrolled_at, last_action_at, completed_at")
    .order("last_action_at", { ascending: false, nullsFirst: false });
  if (activeOnly) q = q.eq("status", "active");
  const { data, error } = await q;
  if (error) throw error;
  return (data || []) as SequenceEnrollment[];
}
