import supabase from "../supabase";

// Frontend GHL service. Calls the `ghl-sync` edge function — the GHL Private
// Integration Token NEVER touches the browser; it lives in the Supabase vault
// and is used server-side by the edge function.

export interface GhlSyncResult {
  ok: boolean;
  ghl_contact_id?: string | null;
  ghl_opportunity_id?: string | null;
  stage?: string;
  warning?: string;
  error?: string;
}

export interface GhlPipeline {
  id: string;
  name: string;
  stages: Array<{ id: string; name: string }>;
}

async function invokeSync(body: Record<string, unknown>): Promise<GhlSyncResult> {
  const { data, error } = await supabase.functions.invoke("ghl-sync", { body });
  if (error) return { ok: false, error: error.message };
  return data as GhlSyncResult;
}

/** Push a customer into GHL as a contact; persists customers.ghl_contact_id. */
export function syncCustomerToGHL(customerId: string): Promise<GhlSyncResult> {
  return invokeSync({ entity: "customer", id: customerId });
}

/** Push a deal into GHL (contact + opportunity); persists ghl_*_id on the deal. */
export function syncDealToGHL(dealId: string): Promise<GhlSyncResult> {
  return invokeSync({ entity: "deal", id: dealId });
}

/** Push a lender/funder into GHL as a Business + contact(s) (incl. its people);
 * persists lenders.ghl_business_id + ghl_contact_id. Reachable from the Comms page. */
export function syncFunderToGHL(lenderId: string): Promise<GhlSyncResult & { ghl_business_id?: string | null; people_synced?: number }> {
  return invokeSync({ entity: "lender", id: lenderId }) as Promise<GhlSyncResult & { ghl_business_id?: string | null; people_synced?: number }>;
}

/** Push a marketing/lead vendor into GHL as a Business + contact;
 * persists marketing_vendors.ghl_business_id + ghl_contact_id. */
export function syncVendorToGHL(vendorId: string): Promise<GhlSyncResult & { ghl_business_id?: string | null }> {
  return invokeSync({ entity: "vendor", id: vendorId }) as Promise<GhlSyncResult & { ghl_business_id?: string | null }>;
}

/** Tag the deal's GHL contact submit:<funder> for each funder, firing their GHL
 * email workflows (Gap B — GHL sends the funder submissions). */
export async function tagFundersForSubmission(dealId: string, lenderIds: string[]): Promise<{ ok: boolean; tagged?: string[]; warning?: string; error?: string }> {
  const { data, error } = await supabase.functions.invoke("ghl-sync", {
    body: { action: "tag_funders", id: dealId, lender_ids: lenderIds },
  });
  if (error) return { ok: false, error: error.message };
  return data as { ok: boolean; tagged?: string[]; warning?: string };
}

/** Push a deal's paydown % to the GHL contact field (fires GHL renewal workflow). */
export async function pushDealPaydownToGHL(dealId: string): Promise<GhlSyncResult & { pushed?: boolean }> {
  const { data, error } = await supabase.functions.invoke("ghl-sync", { body: { action: "paydown", id: dealId } });
  if (error) return { ok: false, error: error.message };
  return data as GhlSyncResult & { pushed?: boolean };
}

/** List GHL pipelines + stage IDs (for wiring stage mappings in the admin UI). */
export async function listGHLPipelines(): Promise<{ ok: boolean; pipelines: GhlPipeline[]; error?: string }> {
  const { data, error } = await supabase.functions.invoke("ghl-sync", { body: { action: "pipelines" } });
  if (error) return { ok: false, pipelines: [], error: error.message };
  return data as { ok: boolean; pipelines: GhlPipeline[]; error?: string };
}
