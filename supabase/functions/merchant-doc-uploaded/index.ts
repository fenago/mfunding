// merchant-doc-uploaded — cross-system side effects after a MERCHANT uploads a
// document from the portal. Closes audit finding #24 (portal bank-statement
// uploads never triggered the underwriter and left no trail).
//
// Why an edge function: a merchant (profiles.role = 'user') CANNOT insert into
// activity_log (no RLS policy) and CANNOT call underwrite-deal (its in-code role
// check rejects non-staff). Both must happen server-side. This mirrors the
// server-side pattern the GHL webhook already uses when statements arrive that way.
//
// POST body: { document_id }   (the customer_documents row the merchant just created)
//
// Flow:
//   1. Auth (verify_jwt = true): resolve the caller; they must OWN the document's
//      customer (customers.user_id = caller) — ops staff are allowed through too.
//   2. Write an activity_log 'document_uploaded' row against the customer.
//   3. If it's a bank statement, re-run the AI underwriter (auto mode, service
//      role) against the customer's most recent deal — the SAME path form/GHL
//      uploads use. Deduped server-side by docs_hash, so double-fires are cheap.
//   4. GHL WRITE-BACK (the P1 portal fix — before this, GHL never heard about a
//      portal upload and MCA 05/06 kept chasing merchants who had already
//      complied). All best-effort, all contact-level, and logged to activity_log:
//        a. tag the contact `portal-doc-uploaded` (+ `portal-statements-in` when
//           the bank-statement ask is now satisfied),
//        b. remove the contact from MCA 06 (bank-statement chase) when the
//           bank-statement request is satisfied, and from MCA 05 (non-bank stips
//           chase) when ALL required non-bank requests are in — workflow IDs come
//           from platform_settings.portal_ghl_writeback, never hardcoded,
//        c. write a GHL contact note so VAs living in GHL see the upload.
//      HARD LIMITS on this path: it NEVER edits a workflow definition, NEVER
//      moves an opportunity/deal stage (stage moves fire other automations —
//      that stays a human decision), and NEVER emails the merchant. A GHL
//      hiccup must never fail the merchant's upload.
//
// The pending customer_documents row itself is what lights the admin "Documents to
// review" (NeedsAttention) queue — the existing ops-notify surface — so no separate
// notification write is needed here.
//
// Compliance: an MCA is a purchase of future receivables, NOT a loan. This function
// emits no merchant-facing copy.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  addContactTags,
  corsHeaders,
  createContactNote,
  getGhlConfig,
  removeContactFromWorkflow,
  serviceClient,
  upsertContact,
} from "../_shared/ghl.ts";
import { reconcileDocumentType } from "../_shared/docClassify.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Fire-and-forget: re-run the AI underwriter for the customer's most recent deal
// when a bank statement lands. Best-effort — never blocks the response. Invoked
// with the service-role key so underwrite-deal treats it as a trusted auto call.
// (Mirror of triggerUnderwriting() in ghl-webhook/index.ts.)
async function triggerUnderwriting(
  db: ReturnType<typeof serviceClient>,
  customerId: string,
): Promise<boolean> {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return false;
    const { data: deal } = await db
      .from("deals")
      .select("id")
      .eq("customer_id", customerId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!deal?.id) return false;
    await fetch(`${url}/functions/v1/underwrite-deal`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ dealId: deal.id, mode: "auto" }),
    });
    return true;
  } catch {
    return false; // best-effort — underwriting must never break the upload flow
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let payload: { document_id?: string };
  try { payload = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  const documentId = payload.document_id;
  if (!documentId) return json({ error: "document_id is required" }, 400);

  const db = serviceClient();

  // --- Auth: a signed-in user who OWNS the document's customer (or ops staff). ---
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Missing authorization" }, 401);
  const { data: userData, error: userErr } = await db.auth.getUser(token);
  const caller = userData?.user;
  if (userErr || !caller) return json({ error: "Invalid session" }, 401);

  // Load the document (service role) + its customer.
  const { data: doc, error: docErr } = await db
    .from("customer_documents")
    .select("id, customer_id, document_type, filename")
    .eq("id", documentId)
    .maybeSingle();
  if (docErr || !doc) return json({ error: "document not found" }, 404);

  const { data: customer } = await db
    .from("customers")
    .select("id, user_id, business_name, email, first_name, last_name, phone, ghl_contact_id")
    .eq("id", doc.customer_id as string)
    .maybeSingle();
  if (!customer) return json({ error: "customer not found" }, 404);

  const isOwner = (customer.user_id as string | null) === caller.id;
  let isStaff = false;
  if (!isOwner) {
    const { data: staff } = await db.rpc("is_ops_staff", { uid: caller.id });
    isStaff = staff === true;
  }
  if (!isOwner && !isStaff) return json({ error: "Forbidden" }, 403);

  // --- 0) Content classification. The merchant picks the slot/type in the portal,
  // so it can be wrong (a bank statement dropped into the wrong request, or an
  // untyped ad-hoc upload). Read the first page and correct the type BEFORE we
  // decide whether to run the underwriter or stop a chase — otherwise a mis-slotted
  // statement stays invisible (the SIS failure, portal edition). Best-effort:
  // authority 'machine' since a merchant's pick isn't ops-authoritative.
  let docType = (doc.document_type as string) ?? "other";
  const filename = (doc.filename as string) ?? "document";
  try {
    const oc = await reconcileDocumentType(db, { documentId, authority: "machine" });
    if (oc.changed && oc.to) docType = oc.to;
  } catch (e) {
    console.warn("[merchant-doc-uploaded] content classify failed (upload unaffected):", e instanceof Error ? e.message : e);
  }

  // --- 1) Activity trail (merchant can't write activity_log directly). ---
  // interaction_type 'document_uploaded' is an allowed activity_log value;
  // entity_type 'customer' is allowed. Best-effort — never fail the request on it.
  const { error: logErr } = await db.from("activity_log").insert({
    entity_type: "customer",
    entity_id: doc.customer_id,
    interaction_type: "document_uploaded",
    subject: `Merchant uploaded ${docType.replace(/_/g, " ")}`,
    content: `Merchant uploaded "${filename}" (${docType}) via the portal.`,
    logged_by: isOwner ? caller.id : null,
  });
  if (logErr) console.warn("[merchant-doc-uploaded] activity_log insert failed:", logErr.message);

  // --- 2) Bank statement → AI underwriter (auto, same path as form/GHL uploads). ---
  let underwriteTriggered = false;
  if (docType === "bank_statement") {
    underwriteTriggered = await triggerUnderwriting(db, doc.customer_id as string);
  }

  // --- 3) GHL write-back: tags + chase-stop + contact note. Best-effort. ---
  const ghl = await ghlWriteBack(db, {
    customerId: doc.customer_id as string,
    documentId: doc.id as string,
    docType,
    filename,
    customer: customer as Record<string, unknown>,
  });

  return json({ ok: true, underwrite_triggered: underwriteTriggered, ghl });
});

// ── GHL write-back ─────────────────────────────────────────────────────────────
//
// Tell GHL that the merchant complied, using ONLY the authority we have:
// contact tags, contact-level workflow removal, and a contact note. Everything
// is best-effort (an upload must never fail on a GHL hiccup) and every outcome
// — success or failure — is written to activity_log so /admin/sync-log-style
// questions ("did the chase stop?") are answerable.

interface WriteBackInput {
  customerId: string;
  documentId: string;
  docType: string;
  filename: string;
  customer: Record<string, unknown>;
}

interface WriteBackResult {
  attempted: boolean;
  contact_id?: string | null;
  tags?: string[];
  tags_ok?: boolean;
  mca06_removed?: boolean | null; // null = not attempted (ask not yet satisfied)
  mca05_removed?: boolean | null;
  note_ok?: boolean;
  error?: string;
}

/** Human label for a customer_document_type slug (for the GHL note). */
function docTypeLabel(slug: string): string {
  return slug === "id" ? "photo ID" : slug.replace(/_/g, " ");
}

async function ghlWriteBack(
  db: ReturnType<typeof serviceClient>,
  input: WriteBackInput,
): Promise<WriteBackResult> {
  const outcome: WriteBackResult = { attempted: true };
  const lines: string[] = [];
  try {
    const cfg = await getGhlConfig(db);

    // ── Resolve the GHL contact (stored id, else heal by email upsert). ──
    let contactId = (input.customer.ghl_contact_id as string | null) ?? null;
    if (!contactId) {
      const email = (input.customer.email as string | null)?.trim();
      if (!email) {
        outcome.error = "no ghl_contact_id and no email on the customer — nothing to write back to";
        lines.push(`SKIPPED — ${outcome.error}`);
        await logWriteBack(db, input, lines);
        return outcome;
      }
      const up = await upsertContact(cfg, {
        email,
        firstName: (input.customer.first_name as string | null) ?? undefined,
        lastName: (input.customer.last_name as string | null) ?? undefined,
        companyName: (input.customer.business_name as string | null) ?? undefined,
        phone: (input.customer.phone as string | null) ?? undefined,
        tags: ["merchant"],
        source: "Portal Doc Upload",
      });
      contactId = up.data?.contact?.id ?? null;
      if (!contactId) {
        outcome.error = `contact upsert failed (${up.status})`;
        lines.push(`FAILED — ${outcome.error}`);
        await logWriteBack(db, input, lines);
        return outcome;
      }
      const { error: linkErr } = await db.from("customers")
        .update({ ghl_contact_id: contactId }).eq("id", input.customerId);
      if (linkErr) console.warn("[merchant-doc-uploaded] persisting healed ghl_contact_id failed:", linkErr.message);
    }
    outcome.contact_id = contactId;

    // ── What does this upload satisfy? Judge from deal_doc_requests. ──
    // Scope to the deal the fulfilled request belongs to; ad-hoc uploads (no
    // request row) fall back to the customer's most recent deal.
    let dealId: string | null = null;
    const { data: fulfilled } = await db
      .from("deal_doc_requests")
      .select("deal_id")
      .eq("document_id", input.documentId)
      .limit(1)
      .maybeSingle();
    dealId = (fulfilled?.deal_id as string | null) ?? null;
    if (!dealId) {
      const { data: deal } = await db
        .from("deals").select("id").eq("customer_id", input.customerId)
        .order("updated_at", { ascending: false }).limit(1).maybeSingle();
      dealId = (deal?.id as string | null) ?? null;
    }

    const OUTSTANDING = new Set(["requested", "rejected"]);
    let bankSatisfied = false;
    let nonBankSatisfied = false;
    if (dealId) {
      const { data: reqs } = await db
        .from("deal_doc_requests")
        .select("doc_type, status, required")
        .eq("deal_id", dealId);
      const rows = reqs ?? [];
      const bank = rows.filter((r) => r.doc_type === "bank_statement");
      const reqNonBank = rows.filter((r) => r.doc_type !== "bank_statement" && r.required === true);
      // Bank ask satisfied: every bank-statement request is in (uploaded or
      // beyond). No bank request rows at all + this upload IS a statement →
      // treat the ad-hoc statement as satisfying the ask.
      bankSatisfied = bank.length > 0
        ? bank.every((r) => !OUTSTANDING.has(r.status as string))
        : input.docType === "bank_statement";
      // Non-bank ask satisfied: at least one required non-bank request exists
      // and ALL of them are in. (No rows → nothing was asked → nothing to stop.)
      nonBankSatisfied = reqNonBank.length > 0 &&
        reqNonBank.every((r) => !OUTSTANDING.has(r.status as string));
    }

    // ── a) Tags (idempotent; visible in GHL; tag-added automations may key on them). ──
    const tags = ["portal-doc-uploaded"];
    if (input.docType === "bank_statement" && bankSatisfied) tags.push("portal-statements-in");
    const tagRes = await addContactTags(cfg, contactId, tags);
    outcome.tags = tags;
    outcome.tags_ok = tagRes.ok;
    lines.push(`tags [${tags.join(", ")}] → ${tagRes.ok ? "ok" : `FAILED (${tagRes.status})`}`);

    // ── b) Stop the chase — contact-level workflow removal ONLY. ──
    // IDs live in platform_settings.portal_ghl_writeback (set by migration
    // 20260714_portal_ghl_writeback_settings), never hardcoded here.
    const { data: setting } = await db
      .from("platform_settings").select("value").eq("key", "portal_ghl_writeback").maybeSingle();
    const wf = (setting?.value ?? {}) as { mca05_workflow_id?: string; mca06_workflow_id?: string };
    outcome.mca06_removed = null;
    outcome.mca05_removed = null;
    if (bankSatisfied && wf.mca06_workflow_id) {
      const rm = await removeContactFromWorkflow(cfg, contactId, wf.mca06_workflow_id);
      outcome.mca06_removed = rm.ok;
      lines.push(`MCA 06 (bank-statement chase) removal → HTTP ${rm.status}${rm.ok ? "" : ` FAILED: ${rm.error ?? ""}`}`);
    } else if (bankSatisfied) {
      lines.push("MCA 06 removal SKIPPED — portal_ghl_writeback.mca06_workflow_id not configured");
    }
    if (nonBankSatisfied && wf.mca05_workflow_id) {
      const rm = await removeContactFromWorkflow(cfg, contactId, wf.mca05_workflow_id);
      outcome.mca05_removed = rm.ok;
      lines.push(`MCA 05 (non-bank stips chase) removal → HTTP ${rm.status}${rm.ok ? "" : ` FAILED: ${rm.error ?? ""}`}`);
    } else if (nonBankSatisfied) {
      lines.push("MCA 05 removal SKIPPED — portal_ghl_writeback.mca05_workflow_id not configured");
    }
    if (!bankSatisfied && !nonBankSatisfied) {
      lines.push("no workflow removal — outstanding requests remain (bank + required non-bank)");
    }

    // ── c) Contact note so VAs inside GHL see the upload. ──
    const noteRes = await createContactNote(
      cfg,
      contactId,
      `Merchant uploaded "${input.filename}" via the portal — ${docTypeLabel(input.docType)}. ` +
        `File is in the app doc-review queue (Admin → Doc Review).`,
    );
    outcome.note_ok = noteRes.ok;
    lines.push(`contact note → ${noteRes.ok ? "ok" : `FAILED (${noteRes.status})`}`);
  } catch (e) {
    outcome.error = e instanceof Error ? e.message : String(e);
    lines.push(`write-back errored: ${outcome.error}`);
    console.warn("[merchant-doc-uploaded] GHL write-back failed (upload unaffected):", outcome.error);
  }
  await logWriteBack(db, input, lines);
  return outcome;
}

/** Every write-back outcome — good or bad — lands in activity_log.
 * interaction_type MUST be 'note' (the check constraint has no 'system'). */
async function logWriteBack(
  db: ReturnType<typeof serviceClient>,
  input: WriteBackInput,
  lines: string[],
): Promise<void> {
  const { error } = await db.from("activity_log").insert({
    entity_type: "customer",
    entity_id: input.customerId,
    interaction_type: "note",
    subject: "portal:ghl-writeback",
    content: `Portal upload "${input.filename}" (${input.docType}) → GHL write-back:\n- ${lines.join("\n- ")}`,
  });
  if (error) console.warn("[merchant-doc-uploaded] write-back activity_log insert failed:", error.message);
}
