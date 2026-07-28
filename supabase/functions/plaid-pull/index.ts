// plaid-pull — fetch a connected bank's accounts + ~6 months of transactions, and
// (if our plan supports it) download statement PDFs straight into the underwriter.
//
// verify_jwt = false: auth is in-code — either the shared GHL webhook secret
// (?secret=, used by plaid-exchange, plaid-webhook, and any cron) OR a staff JWT
// (the admin "pull now" button). A service-role bearer would fail a role check, so
// internal callers use the secret path (house rule).
//
// POST body: { item_id } | { plaid_item_pk }
//
// STATEMENTS-FIRST STRATEGY: statement PDFs are what the EXISTING underwriter
// pipeline already consumes (customer_documents, document_type 'bank_statement'). If
// /statements/list works on our access, we save the PDFs there and re-run the
// underwriter unchanged. If it doesn't (Limited Production may not include the
// Statements product), we fall back to storing parsed transactions in
// plaid_transactions and record that underwriter-from-transactions is a phase-2 item.
//
// Compliance: MCA = purchase of future receivables, NOT a loan. No merchant copy here.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, serviceClient } from "../_shared/ghl.ts";
import { getPlaidConfig, getPlaidSettings, plaidFetch, type PlaidConfig, type PlaidEnv } from "../_shared/plaid.ts";

const DOC_BUCKET = "customer-documents";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

interface PlaidTx {
  transaction_id: string;
  account_id: string;
  name?: string;
  merchant_name?: string | null;
  amount: number;
  iso_currency_code?: string | null;
  date: string;
  pending?: boolean;
  category?: string[] | null;
  personal_finance_category?: { primary?: string } | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const db = serviceClient();
  const url = new URL(req.url);

  // ── Auth: shared secret OR staff JWT ──
  const providedSecret = url.searchParams.get("secret") ?? req.headers.get("x-ghl-secret") ?? "";
  const { data: gc } = await db.rpc("get_ghl_config");
  if (providedSecret) {
    const expected = (gc?.webhook_secret as string | undefined) ?? "";
    if (!expected || providedSecret !== expected) return json({ error: "forbidden" }, 403);
  } else {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Missing authorization" }, 401);
    const { data: userData, error: userErr } = await db.auth.getUser(token);
    const caller = userData?.user;
    if (userErr || !caller) return json({ error: "Invalid session" }, 401);
    const { data: staff } = await db.rpc("is_ops_staff", { uid: caller.id });
    if (staff !== true) return json({ error: "Forbidden — staff only" }, 403);
  }

  let body: { item_id?: string; plaid_item_pk?: string };
  try { body = await req.json(); } catch { body = {}; }

  // ── Load the item row ──
  const q = db.from("plaid_items").select("id, customer_id, deal_id, item_id, environment, institution_name");
  const { data: item } = body.item_id
    ? await q.eq("item_id", body.item_id).maybeSingle()
    : body.plaid_item_pk
    ? await q.eq("id", body.plaid_item_pk).maybeSingle()
    : { data: null };
  if (!item) return json({ error: "plaid item not found" }, 404);

  const itemId = item.item_id as string;
  const customerId = item.customer_id as string;
  const env = (item.environment as PlaidEnv) ?? "production";

  // ── Decrypt the access token (service-role RPC) ──
  const { data: accessToken, error: tokErr } = await db.rpc("plaid_get_access_token", { p_item_id: itemId });
  if (tokErr || !accessToken) {
    return json({ error: "could not resolve access token for item" }, 500);
  }

  let cfg: PlaidConfig;
  try { cfg = await getPlaidConfig(db, env); }
  catch (e) { return json({ error: e instanceof Error ? e.message : String(e) }, 500); }

  const settings = await getPlaidSettings(db);
  const notes: string[] = [];

  // ── 1) Accounts (cache metadata + institution) ──
  let accounts: unknown[] = [];
  const acc = await plaidFetch<{ accounts: unknown[]; item?: { institution_id?: string } }>(cfg, "/accounts/get", { access_token: accessToken });
  if (acc.ok && acc.data?.accounts) {
    accounts = acc.data.accounts;
    notes.push(`${accounts.length} account(s)`);
  } else if (!acc.ok) {
    notes.push(`accounts/get: ${acc.errorCode ?? acc.error ?? "failed"}`);
    // ITEM_LOGIN_REQUIRED etc → mark item errored so the UI shows "reconnect".
    if (acc.errorCode) {
      await db.from("plaid_items").update({ status: "error", error_code: acc.errorCode, error_message: acc.error ?? null, updated_at: new Date().toISOString() }).eq("id", item.id);
      return json({ ok: false, error_code: acc.errorCode, error: acc.error, notes });
    }
  }

  // ── 2) Transactions via /transactions/sync (handles readiness + pagination) ──
  let txCount = 0;
  let productNotReady = false;
  try {
    txCount = await syncTransactions(db, cfg, accessToken, item.id as string, customerId);
    notes.push(`${txCount} transaction(s) synced`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/PRODUCT_NOT_READY/.test(msg)) { productNotReady = true; notes.push("transactions not ready yet (webhook will re-fire)"); }
    else notes.push(`transactions: ${msg.slice(0, 120)}`);
  }

  // ── 3) Statements (opportunistic — the underwriter-ready path) ──
  let statementsCount = 0;
  let statementsAvailable = false;
  let bankStatementDocMade = false;
  if (settings.statements_enabled) {
    const st = await tryStatements(db, cfg, accessToken, customerId, item.institution_name as string | null);
    statementsAvailable = st.available;
    statementsCount = st.saved;
    bankStatementDocMade = st.saved > 0;
    notes.push(st.note);
  }

  // ── 4) Update the item row ──
  await db.from("plaid_items").update({
    accounts,
    status: productNotReady ? "pending" : "active",
    last_pull_at: new Date().toISOString(),
    transactions_count: txCount,
    statements_count: statementsCount,
    updated_at: new Date().toISOString(),
  }).eq("id", item.id);

  // ── 5) If we produced a bank-statement doc, run the underwriter (same path as
  //       merchant/GHL uploads). Without statements, transactions live in
  //       plaid_transactions for analytics; feeding them to the underwriter is phase 2.
  let underwriteTriggered = false;
  if (bankStatementDocMade) {
    underwriteTriggered = await triggerUnderwriting(db, customerId, (item.deal_id as string | null) ?? null);
  }

  // ── 6) Audit ──
  await db.from("activity_log").insert({
    entity_type: "customer",
    entity_id: customerId,
    interaction_type: "note",
    subject: "plaid:pull",
    content: `Plaid pull (${env}) — ${notes.join("; ")}.` + (underwriteTriggered ? " Underwriter re-run." : ""),
  }).then(() => {}, () => {});

  return json({
    ok: true,
    item_id: itemId,
    accounts: accounts.length,
    transactions: txCount,
    statements: statementsCount,
    statements_available: statementsAvailable,
    underwrite_triggered: underwriteTriggered,
    notes,
  });
});

/** /transactions/sync loop — upsert added/modified into plaid_transactions. Returns
 * the count seen this run. Throws with the Plaid error_code embedded so the caller
 * can detect PRODUCT_NOT_READY. */
async function syncTransactions(
  db: SupabaseClient,
  cfg: PlaidConfig,
  accessToken: string,
  plaidItemPk: string,
  customerId: string,
): Promise<number> {
  let cursor: string | undefined;
  let total = 0;
  for (let page = 0; page < 20; page++) {
    const res = await plaidFetch<{ added: PlaidTx[]; modified: PlaidTx[]; next_cursor: string; has_more: boolean }>(
      cfg, "/transactions/sync", { access_token: accessToken, ...(cursor ? { cursor } : {}), count: 500 },
    );
    if (!res.ok) throw new Error(`${res.errorCode ?? "SYNC_FAILED"}: ${res.error ?? ""}`);
    const rows = [...(res.data?.added ?? []), ...(res.data?.modified ?? [])];
    if (rows.length) {
      const mapped = rows.map((t) => ({
        plaid_item_pk: plaidItemPk,
        customer_id: customerId,
        account_id: t.account_id,
        transaction_id: t.transaction_id,
        name: t.name ?? null,
        merchant_name: t.merchant_name ?? null,
        amount: t.amount,
        iso_currency_code: t.iso_currency_code ?? null,
        date: t.date,
        pending: t.pending ?? null,
        category: t.category ?? (t.personal_finance_category?.primary ? [t.personal_finance_category.primary] : null),
        raw: t,
      }));
      const { error } = await db.from("plaid_transactions").upsert(mapped, { onConflict: "transaction_id" });
      if (error) throw new Error(`upsert failed: ${error.message}`);
      total += rows.length;
    }
    cursor = res.data?.next_cursor;
    if (!res.data?.has_more) break;
  }
  return total;
}

interface StatementsResult { available: boolean; saved: number; note: string }

/** Try to list + download statement PDFs and file them as bank_statement docs. On
 * any not-authorized/unsupported error, report unavailable and let the transactions
 * fallback stand. Never throws. */
async function tryStatements(
  db: SupabaseClient,
  cfg: PlaidConfig,
  accessToken: string,
  customerId: string,
  institutionName: string | null,
): Promise<StatementsResult> {
  const list = await plaidFetch<{ accounts: Array<{ account_id: string; statements: Array<{ statement_id: string; month: string; year: string }> }> }>(
    cfg, "/statements/list", { access_token: accessToken },
  );
  if (!list.ok) {
    // Expected on plans without the Statements product — this is a finding, not a bug.
    return { available: false, saved: 0, note: `statements unavailable (${list.errorCode ?? list.error ?? "not enabled"}) — using transactions fallback` };
  }
  const stAccounts = list.data?.accounts ?? [];
  const allStatements = stAccounts.flatMap((a) => (a.statements ?? []).map((s) => ({ ...s, account_id: a.account_id })));
  if (!allStatements.length) return { available: true, saved: 0, note: "statements API available but no statements returned yet" };

  let saved = 0;
  // Cap at the 6 most recent to bound work.
  const recent = allStatements.slice().sort((a, b) => `${b.year}${b.month}`.localeCompare(`${a.year}${a.month}`)).slice(0, 6);
  for (const s of recent) {
    // Dedupe by statement_id marker in the description.
    const marker = `plaid_stmt:${s.statement_id}`;
    const { data: dupe } = await db.from("customer_documents").select("id").eq("customer_id", customerId).like("description", `%${marker}%`).limit(1);
    if (dupe?.length) continue;

    const pdf = await downloadStatement(cfg, accessToken, s.statement_id);
    if (!pdf) continue;
    const label = `Bank statement ${s.year}-${String(s.month).padStart(2, "0")}${institutionName ? ` — ${institutionName}` : ""} (Plaid)`.slice(0, 120);
    const path = `customer/${customerId}/${Date.now()}-plaid-stmt-${s.statement_id.slice(-8)}.pdf`;
    const { error: upErr } = await db.storage.from(DOC_BUCKET).upload(path, pdf, { contentType: "application/pdf" });
    if (upErr) continue;
    const { error: insErr } = await db.from("customer_documents").insert({
      customer_id: customerId, document_type: "bank_statement", filename: label,
      storage_path: path, file_size: pdf.length, mime_type: "application/pdf", status: "approved",
      description: `Pulled from the merchant's connected bank via Plaid. ${marker}`,
    });
    if (!insErr) saved++;
  }
  return { available: true, saved, note: `${saved} statement PDF(s) filed as bank_statement` };
}

/** /statements/download returns raw PDF bytes (not JSON) — dedicated fetch. */
async function downloadStatement(cfg: PlaidConfig, accessToken: string, statementId: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(`${cfg.baseUrl}/statements/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Plaid-Version": "2020-09-14" },
      body: JSON.stringify({ client_id: cfg.clientId, secret: cfg.secret, statement_id: statementId }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.length ? buf : null;
  } catch { return null; }
}

/** Re-run the AI underwriter for the item's deal (or the customer's latest). Mirrors
 * merchant-doc-uploaded — service-role call, mode auto, deduped downstream. */
async function triggerUnderwriting(db: SupabaseClient, customerId: string, dealId: string | null): Promise<boolean> {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return false;
    let did = dealId;
    if (!did) {
      const { data: deal } = await db.from("deals").select("id").eq("customer_id", customerId).order("updated_at", { ascending: false }).limit(1).maybeSingle();
      did = (deal?.id as string | null) ?? null;
    }
    if (!did) return false;
    await fetch(`${url}/functions/v1/underwrite-deal`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ dealId: did, mode: "auto" }),
    });
    return true;
  } catch { return false; }
}
