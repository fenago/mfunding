// Plaid integration status — powers the "Plaid Integration Status" card on
// /admin/settings/integrations (super_admin).
//
// Two kinds of data, deliberately kept separate:
//   1. RECORDED facts (human-maintained) — per-product enablement + dates, key
//      rotation, notes. Stored in platform_settings key 'plaid_status'; edited inline
//      by super_admins. These are "as recorded" records, NOT live probes.
//   2. LIVE counts — connected banks, transactions/statements pulled, last webhook.
//      Read straight from the real plaid_* / customer_documents tables. Honest data.
//
// The runtime environment (production/sandbox) lives in the separate 'plaid' key that
// the edge functions read; we surface it read-only here.

import supabase from "../supabase";
import { mustWrite } from "@/supabase/writes";

export type ProductStatus = "enabled" | "requested" | "not_requested" | "not_eligible";

// The Plaid products we track, in display order, with a short human label.
export const PLAID_PRODUCTS: { id: string; label: string }[] = [
  { id: "auth", label: "Auth" },
  { id: "balance", label: "Balance" },
  { id: "identity", label: "Identity" },
  { id: "identity_match", label: "Identity Match" },
  { id: "transactions", label: "Transactions" },
  { id: "statements", label: "Statements" },
  { id: "assets", label: "Assets" },
  { id: "signal", label: "Signal" },
];

// The status chip cycle order used by the inline editor (click to advance).
export const PRODUCT_STATUS_CYCLE: ProductStatus[] = [
  "not_requested", "requested", "enabled", "not_eligible",
];

export const PRODUCT_STATUS_LABEL: Record<ProductStatus, string> = {
  enabled: "Enabled",
  requested: "Requested",
  not_requested: "Not requested",
  not_eligible: "Not eligible",
};

export interface ProductRecord {
  status: ProductStatus;
  date: string | null; // ISO date the status was recorded
}

export interface PlaidStatus {
  products: Record<string, ProductRecord>;
  statements_price_note: string;
  keys_rotated_at: string | null; // null = rotation still pending (keys shared via chat)
  notes: string;
}

export interface PlaidRuntime {
  environment: "production" | "sandbox";
  products: string[];
  statements_enabled: boolean;
}

const DEFAULT_STATUS: PlaidStatus = {
  products: {},
  statements_price_note: "",
  keys_rotated_at: null,
  notes: "",
};

/** Read the recorded status ledger + the runtime environment config. */
export async function getPlaidStatus(): Promise<{ status: PlaidStatus; runtime: PlaidRuntime }> {
  const { data, error } = await supabase
    .from("platform_settings")
    .select("key, value")
    .in("key", ["plaid_status", "plaid"]);
  if (error) throw error;
  const byKey = new Map((data ?? []).map((r) => [r.key as string, r.value as Record<string, unknown>]));
  const s = (byKey.get("plaid_status") ?? {}) as Partial<PlaidStatus>;
  const r = (byKey.get("plaid") ?? {}) as Partial<PlaidRuntime>;
  return {
    status: {
      products: (s.products ?? {}) as Record<string, ProductRecord>,
      statements_price_note: s.statements_price_note ?? DEFAULT_STATUS.statements_price_note,
      keys_rotated_at: s.keys_rotated_at ?? null,
      notes: s.notes ?? "",
    },
    runtime: {
      environment: r.environment === "sandbox" ? "sandbox" : "production",
      products: Array.isArray(r.products) ? r.products : [],
      statements_enabled: r.statements_enabled !== false,
    },
  };
}

/** Persist the recorded status ledger (super_admin only via RLS). */
export async function savePlaidStatus(status: PlaidStatus): Promise<void> {
  await mustWrite(
    "save Plaid status",
    supabase.from("platform_settings").upsert(
      { key: "plaid_status", value: status, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    ),
  );
}

export interface PlaidLiveCounts {
  connectedBanks: number;
  activeBanks: number;
  transactionsPulled: number;
  statementDocs: number;
  lastWebhookAt: string | null;
}

/** Live counts from the real tables — never fabricated. */
export async function getPlaidLiveCounts(): Promise<PlaidLiveCounts> {
  const [banks, activeBanks, tx, stmts, lastEvent] = await Promise.all([
    supabase.from("plaid_items").select("id", { count: "exact", head: true }),
    supabase.from("plaid_items").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("plaid_transactions").select("id", { count: "exact", head: true }),
    // Statement PDFs Plaid filed as bank_statement docs are marked with a plaid_stmt: marker.
    supabase.from("customer_documents").select("id", { count: "exact", head: true }).ilike("description", "%plaid_stmt:%"),
    supabase.from("plaid_events").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  return {
    connectedBanks: banks.count ?? 0,
    activeBanks: activeBanks.count ?? 0,
    transactionsPulled: tx.count ?? 0,
    statementDocs: stmts.count ?? 0,
    lastWebhookAt: (lastEvent.data?.created_at as string | null) ?? null,
  };
}

// ── Live integration health + institution directory (via the plaid-institutions
// edge function). The browser can never read the vault, so key PRESENCE and the
// API-reachability probe have to come from the server. Everything here is either a
// live probe or a recorded snapshot that the UI labels as such — never invented.

export interface PlaidHealth {
  api_reachable: boolean | null;
  env: "production" | "sandbox";
  products_enabled: string[];
  products: Record<string, { status?: string; date?: string | null }>;
  statements_enabled: boolean;
  connected_items: number;
  oauth_enabled: string[];
  oauth_enabled_count: number;
  oauth_request_needed: string[];
  oauth_as_of: string | null;
  oauth_source: string | null;
  keys_present: { client_id: boolean; secret_production: boolean; secret_sandbox: boolean };
  keys_rotated_at: string | null;
}

export interface PlaidInstitution {
  institution_id: string;
  name: string;
  oauth: boolean;
  products: string[];
  logo: string | null;
  url: string | null;
}

/** Invoke plaid-institutions and surface a real error message (invoke() hides the
 * response body on non-2xx, so we re-read it from the FunctionsHttpError context). */
async function callPlaidInstitutions<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("plaid-institutions", { body });
  if (error) {
    let detail = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.text === "function") {
      try {
        const txt = await ctx.text();
        const parsed = JSON.parse(txt) as { error?: string };
        if (parsed?.error) detail = parsed.error;
      } catch { /* keep the generic message */ }
    }
    throw new Error(detail);
  }
  const res = data as { ok?: boolean; error?: string } | null;
  if (!res || res.ok !== true) throw new Error(res?.error ?? "plaid-institutions returned no data");
  return res as T;
}

/** Live integration health: env, vault key presence, products, OAuth banks, items. */
export async function getPlaidHealth(): Promise<PlaidHealth> {
  const res = await callPlaidInstitutions<{ plaid: PlaidHealth }>({ action: "status" });
  return res.plaid;
}

/** Search Plaid's US institution directory (~10k). Empty query returns nothing —
 * the caller guards, and this keeps us from firing a pointless API call. */
export async function searchInstitutions(query: string, count = 25): Promise<PlaidInstitution[]> {
  const q = query.trim();
  if (!q) return [];
  const res = await callPlaidInstitutions<{ institutions: PlaidInstitution[] }>({ action: "search", query: q, count });
  return res.institutions ?? [];
}

export interface PlaidInstitutionPage {
  institutions: PlaidInstitution[];
  /** Plaid's directory size for the requested country codes — null if it didn't say. */
  total: number | null;
}

/** One page of Plaid's institution directory, for browsing without a query.
 * Plaid caps /institutions/get at 500 per call; page through with `offset`. */
export async function listInstitutions(offset = 0, count = 50): Promise<PlaidInstitutionPage> {
  const res = await callPlaidInstitutions<{ institutions: PlaidInstitution[]; total: number | null }>({
    action: "list",
    count: Math.min(500, Math.max(1, count)),
    offset: Math.max(0, offset),
  });
  return { institutions: res.institutions ?? [], total: typeof res.total === "number" ? res.total : null };
}

export interface PlaidRemediationItem {
  id: string;
  label: string;
  status: string;
}

/** The 4 Plaid remediation attestations (rnd_items section='plaid', sort_order 101-104),
 * with their due dates embedded in the label text. */
export async function getPlaidRemediation(): Promise<PlaidRemediationItem[]> {
  const { data, error } = await supabase
    .from("rnd_items")
    .select("id, label, status, sort_order")
    .eq("section", "plaid")
    .gte("sort_order", 101)
    .order("sort_order");
  if (error) throw error;
  return (data ?? []).map((r) => ({ id: r.id as string, label: r.label as string, status: r.status as string }));
}
