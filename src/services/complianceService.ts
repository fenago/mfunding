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
