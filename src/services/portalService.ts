import supabase from "../supabase";

/**
 * Column-sanitized shape a merchant is allowed to see for their own deal.
 * NEVER add internal fields here (notes, ai_lender_recommendations, closer /
 * commission columns). All portal deal reads go through this service — portal
 * code must never `select("*")` from deals.
 */
export interface PortalDeal {
  id: string;
  deal_number: string | null;
  deal_type: string;
  status: string;
  amount_requested: number | null;
  amount_funded: number | null;
  created_at: string;
  // Stage timestamps (used for the stamped journey history + soft SLA timers)
  contacted_at: string | null;
  qualified_at: string | null;
  application_sent_at: string | null;
  docs_collected_at: string | null;
  bank_statements_at: string | null;
  submitted_at: string | null;
  offer_received_at: string | null;
  offer_presented_at: string | null;
  offer_accepted_at: string | null;
  funded_at: string | null;
  declined_at: string | null;
  nurture_at: string | null;
  /** SQL `date` — arrives as 'YYYY-MM-DD'. Treat as local end-of-day for
   *  countdowns (see utils/deadline.ts). */
  stips_promised_by: string | null;
  paydown_percentage: number | null;
}

// The exact, safe column list — shared by the fallback select so it can never
// drift from the RPC contract.
const PORTAL_DEAL_COLUMNS =
  "id, deal_number, deal_type, status, amount_requested, amount_funded, created_at, " +
  "contacted_at, qualified_at, application_sent_at, docs_collected_at, bank_statements_at, " +
  "submitted_at, offer_received_at, offer_presented_at, offer_accepted_at, funded_at, " +
  "declined_at, nurture_at, stips_promised_by, paydown_percentage";

function isFunctionMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  // Postgres "undefined_function" is 42883; PostgREST also surfaces a
  // "Could not find the function ... in the schema cache" message (PGRST202)
  // when the RPC hasn't been deployed yet.
  return (
    error.code === "42883" ||
    error.code === "PGRST202" ||
    /could not find the function|function .* does not exist/i.test(error.message || "")
  );
}

/**
 * Fetch the signed-in merchant's own deals, column-sanitized.
 *
 * Prefers the SECURITY DEFINER RPC `get_my_portal_deals()` (auth.uid()-scoped,
 * returns only safe columns). If that RPC isn't deployed yet (backend in
 * parallel), falls back to the customer-linked direct select of the EXACT same
 * safe columns so the portal keeps working during the rollout.
 */
export async function getMyPortalDeals(userId: string): Promise<PortalDeal[]> {
  const { data, error } = await supabase.rpc("get_my_portal_deals");

  if (!error) {
    return (data ?? []) as PortalDeal[];
  }

  if (!isFunctionMissing(error)) {
    // A real error (network, auth, RLS) — surface it rather than masking.
    throw new Error(error.message || "Failed to load your funding requests.");
  }

  // Fallback: resolve the merchant's customer row, then read their deals.
  const { data: customer } = await supabase
    .from("customers")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (!customer) return [];

  const { data: rows, error: dealsError } = await supabase
    .from("deals")
    .select(PORTAL_DEAL_COLUMNS)
    .eq("customer_id", customer.id)
    .order("created_at", { ascending: false });

  if (dealsError) {
    throw new Error(dealsError.message || "Failed to load your funding requests.");
  }

  return (rows ?? []) as unknown as PortalDeal[];
}
