import supabase from "../supabase";

// State-specific compliance disclosures. The GHL workflow can also pull these
// directly from the REST API (they're readable when is_active = true).

export interface Disclosure {
  id: string;
  state: string;
  state_name: string;
  product_type: string;
  title: string;
  body: string;
  is_active: boolean;
  updated_at: string;
}

export async function listDisclosures(): Promise<Disclosure[]> {
  const { data, error } = await supabase
    .from("compliance_disclosures")
    .select("*")
    .order("state_name", { ascending: true });
  if (error) throw error;
  return (data || []) as Disclosure[];
}

/** The active disclosure for a state (+product). Used by the app/portal; GHL can
 * fetch the same via REST: /compliance_disclosures?state=eq.NY&is_active=eq.true */
export async function getDisclosure(state: string, productType = "all"): Promise<Disclosure | null> {
  const { data, error } = await supabase
    .from("compliance_disclosures")
    .select("*")
    .eq("state", state)
    .in("product_type", [productType, "all"])
    .eq("is_active", true)
    .order("product_type", { ascending: false }) // prefer the product-specific over 'all'
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as Disclosure) ?? null;
}

export interface DisclosureExposure {
  state: string;
  state_name: string;
  open_deals: number;
  is_active: boolean;
  finalized: boolean; // attorney text in place (not a TODO/template)
}

// Deal statuses that no longer need a fresh disclosure decision.
const TERMINAL = ["declined", "dead", "funded", "renewal_eligible", "restructure_executed", "servicing"];

/** Compliance exposure: open deals in disclosure-law states, flagged by whether
 * that state's disclosure content is finalized (vs still a TODO/template). */
export async function getDisclosureExposure(): Promise<DisclosureExposure[]> {
  const disclosures = await listDisclosures();

  const { data: deals } = await supabase
    .from("deals")
    .select("id, status, customer:customers!customer_id ( address_state )")
    .not("status", "in", `(${TERMINAL.join(",")})`);

  // Count open deals per state (match 2-letter code or full name, case-insensitive).
  const counts = new Map<string, number>();
  for (const d of (deals ?? []) as unknown[]) {
    const cust = (d as { customer?: { address_state?: string | null } | { address_state?: string | null }[] }).customer;
    const c = Array.isArray(cust) ? cust[0] : cust;
    const raw = (c?.address_state ?? "").trim().toLowerCase();
    if (!raw) continue;
    counts.set(raw, (counts.get(raw) ?? 0) + 1);
  }

  return disclosures.map((d) => {
    const open = (counts.get(d.state.toLowerCase()) ?? 0) + (counts.get(d.state_name.toLowerCase()) ?? 0);
    const finalized = d.is_active && !d.body.trim().startsWith("TODO") && !d.body.includes("TEMPLATE ONLY");
    return { state: d.state, state_name: d.state_name, open_deals: open, is_active: d.is_active, finalized };
  });
}

export async function updateDisclosure(
  id: string,
  patch: Partial<Pick<Disclosure, "title" | "body" | "is_active">>,
): Promise<Disclosure> {
  const { data, error } = await supabase
    .from("compliance_disclosures")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as Disclosure;
}
