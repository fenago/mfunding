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
// underwriter unchanged (still the preferred, highest-fidelity path).
//
// TRANSACTIONS PATH (no statement PDFs needed): after /transactions/sync we ALSO
// build/update a bank_analyses row (source 'plaid') straight from plaid_transactions —
// avg monthly deposits/revenue, NSF count, recurring daily/weekly financing debits
// (MCA stacking) — and then trigger underwrite-deal. That closes the old gap where a
// transactions-only connection (Limited Production may not include Statements) never
// underwrote: the deal now advances past doc collection on the connected feed alone.
// (underwrite-deal itself reads plaid_transactions directly and synthesizes per-month
// figures; the bank_analyses row is the workbench's single "one source" snapshot.)
//
// Compliance: MCA = purchase of future receivables, NOT a loan. No merchant copy here.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, serviceClient, getGhlConfig, upsertContact, sendEmailToContact } from "../_shared/ghl.ts";
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

    // AUTO-DETECT: /statements/list SUCCEEDING means Plaid has enabled the Statements
    // product on our access (it returns INVALID_PRODUCT until then). We piggyback on
    // the call the pull already makes — NO extra API calls, NO cost (Statements bills
    // on link-token creation, which we never do here). The first success flips the
    // recorded status and alerts the owner.
    if (statementsAvailable) {
      await recordStatementsEnabled(db, notes, customerId);
    }
  }

  // ── 4) Transactions → bank_analyses (the underwriting workbench's "one source").
  //       Built from the connected feed so a transactions-only merchant (no statement
  //       PDFs) still gets underwritten. Resolve the deal once and reuse for the row
  //       and the underwriter trigger. Never throws — a failure here must not sink the
  //       pull (transactions are already stored and underwrite-deal reads them anyway).
  const resolvedDealId = await resolveDealId(db, (item.deal_id as string | null) ?? null, customerId);
  let bankAnalysisBuilt = false;
  try {
    bankAnalysisBuilt = await buildBankAnalysisFromPlaid(db, item.id as string, customerId, resolvedDealId, item.institution_name as string | null, notes);
  } catch (e) {
    notes.push(`bank_analyses build error: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ── 5) Update the item row ──
  await db.from("plaid_items").update({
    accounts,
    status: productNotReady ? "pending" : "active",
    last_pull_at: new Date().toISOString(),
    transactions_count: txCount,
    statements_count: statementsCount,
    updated_at: new Date().toISOString(),
  }).eq("id", item.id);

  // ── 6) Run the underwriter. Statement PDFs are the preferred trigger (same path as
  //       merchant/GHL uploads), but a transactions-only connection that produced a
  //       bank_analyses row now ALSO triggers it — underwrite-deal reads
  //       plaid_transactions directly, so the deal advances even without PDFs.
  let underwriteTriggered = false;
  if (bankStatementDocMade || bankAnalysisBuilt) {
    underwriteTriggered = await triggerUnderwriting(db, customerId, resolvedDealId);
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
    bank_analysis_built: bankAnalysisBuilt,
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
  // Cap at the 4 most recent to bound work.
  const recent = allStatements.slice().sort((a, b) => `${b.year}${b.month}`.localeCompare(`${a.year}${a.month}`)).slice(0, 4);
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

const OWNER_EMAIL = "socrates73@gmail.com";
const FROM_EMAIL = "sales@send.mfunding.net"; // company dedicated sending domain

/** First-success handler for the Statements product. Idempotent: if plaid_status
 * already records statements=enabled, does nothing. On the transition it stamps the
 * status ledger, writes an audit note, and best-effort emails the owner. NEVER throws
 * — a failure here must not fail the pull. */
async function recordStatementsEnabled(db: SupabaseClient, notes: string[], customerId: string): Promise<void> {
  try {
    const { data: row } = await db.from("platform_settings").select("value").eq("key", "plaid_status").maybeSingle();
    const value = (row?.value ?? {}) as {
      products?: Record<string, { status?: string; date?: string | null }>;
      [k: string]: unknown;
    };
    const products = value.products ?? {};
    if (products.statements?.status === "enabled") return; // already recorded — nothing to do

    const today = new Date().toISOString().slice(0, 10);
    const nextValue = {
      ...value,
      products: { ...products, statements: { status: "enabled", date: today } },
    };
    const { error: upErr } = await db.from("platform_settings")
      .upsert({ key: "plaid_status", value: nextValue, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (upErr) { notes.push(`statements enablement detected but status write failed: ${upErr.message}`); return; }
    notes.push("STATEMENTS PRODUCT NOW ENABLED — recorded in plaid_status");

    // Audit note (activity_log requires interaction_type 'note'; 'system' is invalid).
    await db.from("activity_log").insert({
      entity_type: "customer",
      entity_id: customerId,
      interaction_type: "note",
      subject: "plaid:statements-enabled",
      content: `Plaid enabled the Statements product on our access (auto-detected via /statements/list on ${today}). Statement PDFs will now be filed as bank_statement docs automatically.`,
    }).then(() => {}, () => {});

    await emailOwnerStatementsEnabled(db).catch(() => {});
  } catch (e) {
    notes.push(`statements auto-detect error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Best-effort owner email via GHL (same path system-health-check uses). Never throws. */
async function emailOwnerStatementsEnabled(db: SupabaseClient): Promise<void> {
  const cfg = await getGhlConfig(db);
  const up = await upsertContact(cfg, { email: OWNER_EMAIL, firstName: "MFunding", lastName: "Owner" });
  const contactId = up.data?.contact?.id;
  if (!contactId) return;
  const html =
    "<p>Plaid has <strong>enabled the Statements product</strong> on our production access.</p>" +
    "<p>plaid-pull auto-detected this on its most recent sync (a <code>/statements/list</code> call succeeded for the first time). " +
    "Statement PDFs are now filed automatically as bank statements and fed to the underwriter — no action needed.</p>" +
    "<p>Recorded on the Integrations page: /admin/settings/integrations.</p>";
  await sendEmailToContact(cfg, contactId, "Plaid Statements product is now enabled", html, { emailFrom: FROM_EMAIL });
}

// ── TRANSACTIONS → bank_analyses ─────────────────────────────────────────────
// Everything below derives the workbench's "one source" row from plaid_transactions.
// SIGN CONVENTION (matches plaid-pull's /transactions/sync store + underwrite-deal's
// buildPlaidStatements): amount is POSITIVE for money OUT (debit) and NEGATIVE for
// money IN (deposit/credit).

const round2 = (n: number) => Math.round(n * 100) / 100;

// Transfer-like deposit descriptors — excluded from TRUE revenue (mirrors the
// classified_type:'transfer' test in underwrite-deal.buildPlaidStatements).
const TRANSFER_NAME_RE = /transfer|zelle|venmo|cashapp|xfer|wire|p2p/i;
// NSF / overdraft / returned-item fee descriptors (same set underwrite-deal uses).
const NSF_NAME_RE = /\b(nsf|overdraft|insufficient|returned\s*item|od\s*fee|nsf\s*fee|uncollected\s*funds|return(ed)?\s*fee)\b/i;
// Names that read like a financing remittance (MCA / loan / lease / etc.). Mirrors
// underwrite-deal.FINANCING_NAME_RE.
const FINANCING_NAME_RE =
  /\b(fund|funding|capital|advance|mca|remit|holdback|financ|lending|kapital|receivabl|ondeck|kabbage|bluevine|credibly|libertas|forward\s*financ|rapid\s*financ|fox\s*capital|kalamata|cfg\s*merchant|square\s*capital|paypal\s*working|working\s*capital|sba|eidl|term\s*loan|\bloan\b|lease|leasing|marlin|lendmark|installment)\b/i;

interface PlaidTxRow { date: string | null; amount: number | null; name: string | null; merchant_name: string | null }
const txName = (t: PlaidTxRow): string => (t.merchant_name || t.name || "").toString().trim();
// Normalize a counterparty for grouping recurring debits within ONE merchant's feed:
// lowercase, drop digits/punctuation, collapse whitespace.
const normFunder = (name: string): string => name.toLowerCase().replace(/[0-9]+/g, " ").replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
const monthLabel = (iso: string): string | null => {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
};

/** Resolve the deal this pull belongs to: the item's deal_id, else the customer's most
 * recently updated deal (same fallback triggerUnderwriting used). Null if none. */
async function resolveDealId(db: SupabaseClient, itemDealId: string | null, customerId: string): Promise<string | null> {
  if (itemDealId) return itemDealId;
  const { data: deal } = await db.from("deals").select("id").eq("customer_id", customerId)
    .order("updated_at", { ascending: false }).limit(1).maybeSingle();
  return (deal?.id as string | null) ?? null;
}

/** Build (or update) the source:'plaid' bank_analyses row for this deal from the
 * customer's synced transactions. Returns true when a row was written (⇒ there is
 * enough signal to underwrite). One row per deal: updates the existing plaid row in
 * place rather than piling a new one on every pull. Never invents columns — writes
 * only the bank_analyses fields defined in the 20260626_002 migration. */
async function buildBankAnalysisFromPlaid(
  db: SupabaseClient,
  plaidItemPk: string,
  customerId: string,
  dealId: string | null,
  institution: string | null,
  notes: string[],
): Promise<boolean> {
  const { data: txData } = await db.from("plaid_transactions")
    .select("date, amount, name, merchant_name")
    .eq("plaid_item_pk", plaidItemPk)
    .order("date", { ascending: true });
  const rows = ((txData ?? []) as PlaidTxRow[]).filter((t) => t.date && Number.isFinite(Number(t.amount)));
  if (!rows.length) { notes.push("bank_analyses skipped (no transactions)"); return false; }

  const credits = rows.filter((t) => Number(t.amount) < 0); // money IN
  const debits = rows.filter((t) => Number(t.amount) > 0);   // money OUT
  if (!credits.length) { notes.push("bank_analyses skipped (no deposits in feed)"); return false; }

  // Distinct months that actually carry deposits (skip partial boundary months so the
  // monthly averages aren't dragged toward a fabricated $0 month — same rule as
  // buildPlaidStatements).
  const monthsWithDeposits = new Set<string>();
  for (const t of credits) { const m = monthLabel(t.date!); if (m) monthsWithDeposits.add(m); }
  const monthsAnalyzed = Math.max(1, monthsWithDeposits.size);

  let totalDeposits = 0, totalRevenue = 0, largestDeposit = 0;
  for (const t of credits) {
    const amt = Math.abs(Number(t.amount));
    totalDeposits += amt;
    if (amt > largestDeposit) largestDeposit = amt;
    if (!TRANSFER_NAME_RE.test(txName(t))) totalRevenue += amt; // exclude transfers from true revenue
  }

  let nsfCount = 0;
  for (const t of debits) if (NSF_NAME_RE.test(txName(t))) nsfCount += 1;

  // Recurring financing debits (MCA stacking): group by (normalized counterparty,
  // rounded amount); a group qualifies when it hits near-daily in some month (>=8) OR
  // reads like financing and recurs (>=2). Mirrors buildPlaidStatements' detection.
  const groups = new Map<string, { name: string; amount: number; total: number; perMonth: Map<string, number> }>();
  for (const t of debits) {
    const amt = Math.abs(Number(t.amount));
    if (!(amt > 0)) continue;
    const name = txName(t) || "Unknown";
    const key = `${normFunder(name) || "unknown"}|${Math.round(amt)}`;
    const m = monthLabel(t.date!) ?? "?";
    let g = groups.get(key);
    if (!g) { g = { name, amount: amt, total: 0, perMonth: new Map() }; groups.set(key, g); }
    g.total += 1;
    g.perMonth.set(m, (g.perMonth.get(m) ?? 0) + 1);
  }
  let mcaPositions = 0, financingTotalDollars = 0;
  for (const g of groups.values()) {
    const maxMonth = Math.max(0, ...g.perMonth.values());
    const isDaily = maxMonth >= 8;
    const looksFinancing = FINANCING_NAME_RE.test(g.name);
    if (!(isDaily || (looksFinancing && g.total >= 2))) continue;
    mcaPositions += 1;
    financingTotalDollars += g.amount * g.total; // all occurrences of this remittance in the window
  }
  // Estimated MONTHLY financing outflow (existing MCA payments) across the window.
  const existingMcaPayments = mcaPositions ? round2(financingTotalDollars / monthsAnalyzed) : null;

  const analysis = {
    deal_id: dealId,
    customer_id: customerId,
    source: "plaid" as const,
    months_analyzed: monthsAnalyzed,
    // A transaction feed carries no running ledger balance → these are legitimately
    // unknown (null), NOT zero. underwrite-deal reads the raw feed for the full read.
    average_daily_balance: null as number | null,
    negative_days: null as number | null,
    avg_monthly_deposits: round2(totalDeposits / monthsAnalyzed),
    avg_monthly_revenue: round2(totalRevenue / monthsAnalyzed),
    deposit_count: credits.length,
    nsf_count: nsfCount,
    existing_mca_positions: mcaPositions,
    existing_mca_payments: existingMcaPayments,
    largest_deposit: round2(largestDeposit),
    notes: `Auto-built from the merchant's connected bank (Plaid${institution ? ` — ${institution}` : ""}). ` +
      `${monthsAnalyzed} month(s), ${credits.length} deposits. Avg daily balance & negative days are unknown ` +
      `(a transaction feed has no ledger balance). Prefer statement PDFs when available.`,
    raw: {
      generated_at: new Date().toISOString(),
      months: [...monthsWithDeposits],
      total_deposits: round2(totalDeposits),
      total_revenue: round2(totalRevenue),
      financing_positions: mcaPositions,
    },
    entered_by: null as string | null,
  };

  // Build OR update: keep a single plaid row per deal (or per customer when the item
  // has no deal). Look up the existing plaid row, update it in place, else insert.
  const finder = db.from("bank_analyses").select("id").eq("source", "plaid");
  const scoped = dealId ? finder.eq("deal_id", dealId) : finder.is("deal_id", null).eq("customer_id", customerId);
  const { data: existing } = await scoped.order("created_at", { ascending: false }).limit(1).maybeSingle();

  if (existing?.id) {
    const { error } = await db.from("bank_analyses").update(analysis).eq("id", existing.id as string);
    if (error) { notes.push(`bank_analyses update failed: ${error.message}`); return false; }
    notes.push(`bank_analyses updated (plaid): ${monthsAnalyzed}mo, $${analysis.avg_monthly_deposits} avg deposits, ${mcaPositions} MCA position(s)`);
  } else {
    const { error } = await db.from("bank_analyses").insert(analysis);
    if (error) { notes.push(`bank_analyses insert failed: ${error.message}`); return false; }
    notes.push(`bank_analyses created (plaid): ${monthsAnalyzed}mo, $${analysis.avg_monthly_deposits} avg deposits, ${mcaPositions} MCA position(s)`);
  }
  return true;
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
