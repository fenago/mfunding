// merchantDocArrived — THE ONE DEFINITION of "a merchant document arrived".
//
// WHY THIS FILE EXISTS
// -----------------------------------------------------------------------------
// There are two lanes a merchant document can arrive through and they have
// different auth models, so they are two different edge functions:
//
//   · merchant-doc-uploaded   verify_jwt = true   — signed-in merchant portal
//   · merchant-upload-doc     verify_jwt = false  — the logged-OUT page at
//                                                   /connect-bank/:token
//
// The SIDE EFFECTS are identical in both lanes and must stay identical. The
// measured failure this closes: Alex Ward signed at 19:49, was emailed at 19:50
// ("your documents are in… you don't need to do anything else right now"), then
// at 20:24 — 34 minutes later — was emailed "we still need your bank
// statements", and again at exactly +48h. An upload lane that stores the file
// but does not cancel the chase reproduces that experience exactly.
//
// Two hand-maintained copies of this logic would drift; that has already
// happened in this codebase (src/lib/applicationCompleteness.ts vs
// _shared/application-fields.ts, and ghlCallSync.ts vs ghl-event-hook). So the
// lane-specific part is a small input object and NOTHING else is duplicated.
//
// RELATIVE TO THE UPLOAD, EVERY SIDE EFFECT HERE IS BEST-EFFORT.
// The file and the customer_documents row are the caller's business and are
// already committed before this runs. Nothing in here may roll back a file that
// really landed, and nothing in here may report a success it did not achieve:
// every step's outcome — good or bad — is written to activity_log.
//
// READS THAT FAIL ARE NOT READS THAT RETURNED NOTHING.
// The doc checklist and the workflow-id setting are both read here, and either
// read can fail. An empty `deal_doc_requests` read is "nothing was asked"; a
// FAILED one is "we do not know what was asked". The old code conflated them,
// which produced two wrong outcomes from one unreadable row: a merchant
// released from the chase on no evidence, and an activity_log line that said
// "mca06_workflow_id not configured" when it is in fact configured (verified
// 2026-11-01). `ChecklistRead` and `WorkflowIds` below keep the two apart.
//
// HARD LIMITS, both lanes: this NEVER edits a workflow definition, NEVER moves
// an opportunity or deal stage (stage moves fire other automations — that stays
// a human decision), and NEVER emails or texts the merchant.
//
// Compliance: an MCA is a purchase of future receivables, NOT a loan. Nothing
// in here emits merchant-facing copy, and no string in here says "loan".

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  addContactTags,
  createContactNote,
  getGhlConfig,
  removeContactFromWorkflow,
  upsertContact,
} from "./ghl.ts";
import { reconcileDocumentType } from "./docClassify.ts";

/** deal_doc_requests statuses that mean "we are still waiting on this". */
export const OUTSTANDING_REQUEST_STATUSES: ReadonlySet<string> = new Set(["requested", "rejected"]);

export interface DocRequestRow {
  doc_type: string;
  status: string;
  required: boolean | null;
}

/**
 * A read of the deal's document checklist. THREE outcomes, none interchangeable:
 *   · "rows"       — the read succeeded; `rows` may legitimately be empty
 *                    ("nothing was asked of this merchant")
 *   · "no_deal"    — no deal could be scoped, so no checklist was read
 *   · "unreadable" — the read FAILED. We do not know what was asked.
 */
export type ChecklistRead =
  | { kind: "rows"; rows: DocRequestRow[] }
  | { kind: "no_deal" }
  | { kind: "unreadable"; error: string };

/**
 * Where one ask stands.
 *   satisfied   — every request of this kind is in
 *   outstanding — at least one is still waiting
 *   not_asked   — no request of this kind exists, so there is no chase to stop
 *   unknown     — we could not read the checklist. NOT the same as not_asked.
 */
export type AskState = "satisfied" | "outstanding" | "not_asked" | "unknown";

export interface ChaseDecision {
  bank: AskState;
  nonBank: AskState;
  /** One human line naming WHY, written verbatim into the activity_log trail. */
  basis: string;
}

/**
 * Pure decision: given the checklist read and what this upload is, where does
 * each ask stand? No DB, no network — so it is unit-testable, and it IS unit
 * tested (merchantDocArrived.test.ts), including the unreadable case, which is
 * the one that used to silently masquerade as "nothing was asked".
 */
export function decideChaseStops(
  input: { checklist: ChecklistRead; docType: string },
): ChaseDecision {
  if (input.checklist.kind === "no_deal") {
    return {
      bank: "unknown",
      nonBank: "unknown",
      basis: "no deal could be scoped for this document — the doc checklist was NOT read",
    };
  }
  if (input.checklist.kind === "unreadable") {
    return {
      bank: "unknown",
      nonBank: "unknown",
      basis: `doc checklist UNREADABLE (${input.checklist.error}) — what was asked is NOT known`,
    };
  }

  const rows = input.checklist.rows;
  const bankRows = rows.filter((r) => r.doc_type === "bank_statement");
  const reqNonBank = rows.filter((r) => r.doc_type !== "bank_statement" && r.required === true);

  let bank: AskState;
  if (bankRows.length > 0) {
    bank = bankRows.every((r) => !OUTSTANDING_REQUEST_STATUSES.has(r.status)) ? "satisfied" : "outstanding";
  } else {
    // Nothing was asked. An ad-hoc statement still satisfies the unstated ask.
    bank = input.docType === "bank_statement" ? "satisfied" : "not_asked";
  }

  const nonBank: AskState = reqNonBank.length === 0
    ? "not_asked"
    : (reqNonBank.every((r) => !OUTSTANDING_REQUEST_STATUSES.has(r.status)) ? "satisfied" : "outstanding");

  const basis = `checklist read: ${bankRows.length} bank request(s), ${reqNonBank.length} required non-bank request(s)` +
    ` → bank ask ${bank}, non-bank ask ${nonBank}`;
  return { bank, nonBank, basis };
}

/**
 * Should the bank-statement chase (MCA 06) stop?
 *
 * TWO independent justifications, and only these two:
 *   1. the checklist says every bank-statement request is in, or
 *   2. we could not read the checklist AND this very upload is itself a bank
 *      statement — a fact we hold from the row we just wrote, not an inference
 *      from the failed read.
 *
 * Deliberately asymmetric with the non-bank chase: one non-bank document
 * arriving tells us nothing about whether the OTHER required non-bank asks are
 * in, so an unknown non-bank ask never stops MCA 05. See `shouldStopNonBankChase`.
 */
export function shouldStopBankChase(decision: ChaseDecision, docType: string): boolean {
  if (decision.bank === "satisfied") return true;
  return decision.bank === "unknown" && docType === "bank_statement";
}

/** Should the required-non-bank-stips chase (MCA 05) stop? Only on a positive read. */
export function shouldStopNonBankChase(decision: ChaseDecision): boolean {
  return decision.nonBank === "satisfied";
}

/**
 * The workflow ids to remove a contact from. `readable: false` means the
 * platform_settings read FAILED — which must never be reported as
 * "not configured", because it is.
 */
export type WorkflowIds =
  | { readable: true; mca05: string | null; mca06: string | null }
  | { readable: false; error: string };

// ── Inputs / outputs ──────────────────────────────────────────────────────────

export interface MerchantDocArrivedInput {
  /** The customer_documents row that was just created. Must already exist. */
  documentId: string;
  customerId: string;
  /**
   * The deal this document belongs to, when the CALLER knows it (the
   * /connect-bank link token names exactly one). Preferred over the fallback
   * below: `deals.updated_at` is not a freshness signal — the nightly score job
   * rewrites every row — so "most recently updated deal" is a guess.
   */
  dealId?: string | null;
  /** Human phrase for the trail, e.g. "the portal" / "their secure document link". */
  viaPhrase: string;
  /** auth.users id for activity_log.logged_by, when the lane has one. */
  loggedBy?: string | null;
  /** GHL contact `source` used only if we have to heal the contact by email upsert. */
  ghlSource: string;
  /**
   * Flip an outstanding deal_doc_requests row of the same doc_type to
   * 'uploaded' and link this document.
   *
   * TRUE only for the logged-out lane. The signed-in portal does this itself
   * through the mark_doc_request_uploaded RPC *before* it calls us, and that RPC
   * needs auth.uid(), so the logged-out lane cannot use it. Without this the
   * chase-cancel cannot fire at all on that lane: all 88 bank_statement
   * requests in the live table are 'requested' (read 2026-11-01), so a statement
   * that lands without flipping one leaves the bank ask "outstanding" and MCA 06
   * keeps running — the exact defect.
   */
  fulfillOutstandingRequest?: boolean;
}

export interface GhlWriteBackResult {
  attempted: boolean;
  contact_id?: string | null;
  tags?: string[];
  tags_ok?: boolean;
  /** null = not attempted. See the activity_log trail for which reason. */
  mca06_removed?: boolean | null;
  mca05_removed?: boolean | null;
  note_ok?: boolean;
  error?: string;
}

export interface RequestFulfillment {
  attempted: boolean;
  /** null = we did not get far enough to know. */
  fulfilled: boolean | null;
  request_id?: string | null;
  error?: string;
}

export interface MerchantDocArrivedResult {
  /** The type we acted on — the merchant's pick, corrected by content if it lost. */
  doc_type: string;
  reclassified_to?: string | null;
  activity_logged: boolean;
  request: RequestFulfillment;
  underwrite_triggered: boolean;
  decision: ChaseDecision;
  ghl: GhlWriteBackResult;
}

// ── The one definition ────────────────────────────────────────────────────────

/**
 * Run every cross-system side effect of a merchant document arriving.
 * Never throws: an exception anywhere is caught, logged, and reported in the
 * result. The caller's upload has already succeeded and must stay succeeded.
 */
export async function merchantDocArrived(
  db: SupabaseClient,
  input: MerchantDocArrivedInput,
): Promise<MerchantDocArrivedResult> {
  const trail: string[] = [];

  const { data: doc, error: docErr } = await db
    .from("customer_documents")
    .select("id, customer_id, document_type, filename")
    .eq("id", input.documentId)
    .maybeSingle();

  // EVERY decision below keys off document_type. Defaulting an unreadable row to
  // "other" would silently suppress the bank chase-stop and look exactly like a
  // merchant who uploaded a photo ID — so we stop and say so instead of guessing.
  if (docErr || !doc) {
    const why = docErr
      ? `customer_documents read FAILED (${docErr.message})`
      : `customer_documents row ${input.documentId} not found`;
    const basis = `${why} — NO side effects ran; the document type is unknown, so nothing was decided`;
    console.warn("[merchantDocArrived]", basis);
    await writeTrail(db, input.customerId, "unknown file", "unknown", [basis]);
    return {
      doc_type: "unknown",
      reclassified_to: null,
      activity_logged: false,
      request: { attempted: false, fulfilled: null },
      underwrite_triggered: false,
      decision: { bank: "unknown", nonBank: "unknown", basis },
      ghl: { attempted: false, error: why },
    };
  }

  let docType = (doc.document_type as string | null) ?? "other";
  const filename = (doc.filename as string | null) ?? "document";

  // ── 1) Content classification. The merchant picks the type, so it can be
  // wrong (a statement dropped into the wrong slot, or an untyped ad-hoc
  // upload). Correct it BEFORE deciding whether to run the underwriter or stop a
  // chase — otherwise a mis-typed statement stays invisible (the SIS failure).
  // Best-effort, authority 'machine': a merchant's pick is not ops-authoritative.
  let reclassifiedTo: string | null = null;
  try {
    const oc = await reconcileDocumentType(db, { documentId: input.documentId, authority: "machine" });
    if (oc.changed && oc.to) {
      docType = oc.to;
      reclassifiedTo = oc.to;
      trail.push(`content classify: type corrected to "${oc.to}" (was "${oc.from}")`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    trail.push(`content classify FAILED (${msg}) — acting on the merchant's own pick "${docType}"`);
    console.warn("[merchantDocArrived] content classify failed (upload unaffected):", msg);
  }

  // ── 2) Activity trail. A merchant can write neither activity_log nor (on the
  // logged-out lane) anything at all, and an upload with no trail is how ops
  // ends up chasing somebody who already complied.
  // interaction_type 'document_uploaded' and entity_type 'customer' are both
  // allowed by the check constraints; a bad value fails the insert SILENTLY.
  const { error: logErr } = await db.from("activity_log").insert({
    entity_type: "customer",
    entity_id: input.customerId,
    interaction_type: "document_uploaded",
    subject: `Merchant uploaded ${docType.replace(/_/g, " ")}`,
    content: `Merchant uploaded "${filename}" (${docType}) via ${input.viaPhrase}.`,
    logged_by: input.loggedBy ?? null,
  });
  if (logErr) console.warn("[merchantDocArrived] activity_log insert failed:", logErr.message);

  // ── 3) Scope the deal. Prefer what the caller knows, then the request row
  // this document fulfils, then — last and weakest — the most recently updated
  // deal.
  let dealId = input.dealId ?? null;
  if (!dealId) {
    const { data: fulfilled } = await db
      .from("deal_doc_requests")
      .select("deal_id")
      .eq("document_id", input.documentId)
      .limit(1)
      .maybeSingle();
    dealId = (fulfilled?.deal_id as string | null) ?? null;
  }
  if (!dealId) {
    const { data: deal } = await db
      .from("deals")
      .select("id")
      .eq("customer_id", input.customerId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    dealId = (deal?.id as string | null) ?? null;
  }

  // ── 4) Fulfil the checklist row (logged-out lane only — see the input doc). ──
  const request = input.fulfillOutstandingRequest
    ? await fulfilOutstandingRequest(db, { dealId, docType, documentId: input.documentId, trail })
    : { attempted: false, fulfilled: null as boolean | null };

  // ── 5) Read the checklist, keeping UNREADABLE distinct from empty. ──
  const checklist = await readChecklist(db, dealId);
  const decision = decideChaseStops({ checklist, docType });
  trail.push(decision.basis);

  // ── 6) GHL write-back: tags + chase-stop + contact note. Best-effort. ──
  const ghl = await ghlWriteBack(db, {
    customerId: input.customerId,
    filename,
    docType,
    viaPhrase: input.viaPhrase,
    ghlSource: input.ghlSource,
    decision,
    trail,
  });

  // ── 7) Bank statement → re-run the AI underwriter (auto mode, service role —
  // the same path form/GHL uploads use; deduped downstream by docs_hash).
  // LAST on purpose: underwrite-deal is the slow step (it has blown the 150s
  // gateway limit on big-document deals), and nothing above may wait on it.
  let underwriteTriggered = false;
  if (docType === "bank_statement") {
    underwriteTriggered = await triggerUnderwriting(db, dealId);
    trail.push(`underwriter re-run → ${underwriteTriggered ? "issued" : "NOT issued"}`);
  }

  await writeTrail(db, input.customerId, filename, docType, trail);

  return {
    doc_type: docType,
    reclassified_to: reclassifiedTo,
    activity_logged: !logErr,
    request,
    underwrite_triggered: underwriteTriggered,
    decision,
    ghl,
  };
}

// ── Pieces ────────────────────────────────────────────────────────────────────

/** Read the deal's checklist. The `error` branch is the whole point of this
 *  wrapper: `.error` set must NOT collapse into an empty row list. */
async function readChecklist(db: SupabaseClient, dealId: string | null): Promise<ChecklistRead> {
  if (!dealId) return { kind: "no_deal" };
  const { data, error } = await db
    .from("deal_doc_requests")
    .select("doc_type, status, required")
    .eq("deal_id", dealId);
  if (error) return { kind: "unreadable", error: error.message };
  if (!data) return { kind: "unreadable", error: "no rows and no error returned" };
  return { kind: "rows", rows: data as DocRequestRow[] };
}

/**
 * Flip the oldest outstanding request of this doc_type to 'uploaded' and link
 * the document — the service-role equivalent of what mark_doc_request_uploaded
 * does for a signed-in merchant (that RPC needs auth.uid(), which the
 * logged-out lane does not have).
 */
async function fulfilOutstandingRequest(
  db: SupabaseClient,
  args: { dealId: string | null; docType: string; documentId: string; trail: string[] },
): Promise<RequestFulfillment> {
  if (!args.dealId) {
    args.trail.push("checklist fulfilment SKIPPED — no deal could be scoped");
    return { attempted: true, fulfilled: false };
  }
  const { data: open, error: findErr } = await db
    .from("deal_doc_requests")
    .select("id")
    .eq("deal_id", args.dealId)
    .eq("doc_type", args.docType)
    .in("status", ["requested", "rejected"])
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (findErr) {
    args.trail.push(`checklist fulfilment FAILED — could not read the open requests (${findErr.message})`);
    return { attempted: true, fulfilled: null, error: findErr.message };
  }
  const requestId = (open?.id as string | null) ?? null;
  if (!requestId) {
    args.trail.push(`checklist fulfilment: no open "${args.docType}" request on this deal — nothing to flip`);
    return { attempted: true, fulfilled: false };
  }
  const { error: upErr } = await db
    .from("deal_doc_requests")
    .update({ status: "uploaded", document_id: args.documentId, rejection_reason: null })
    .eq("id", requestId);
  if (upErr) {
    args.trail.push(`checklist fulfilment FAILED for request ${requestId} (${upErr.message})`);
    return { attempted: true, fulfilled: null, request_id: requestId, error: upErr.message };
  }
  args.trail.push(`checklist: "${args.docType}" request ${requestId} → uploaded`);
  return { attempted: true, fulfilled: true, request_id: requestId };
}

/** Read the MCA 05 / MCA 06 workflow ids. IDs live in
 *  platform_settings.portal_ghl_writeback (migration
 *  20260714_portal_ghl_writeback_settings) and are never hardcoded. */
async function readWorkflowIds(db: SupabaseClient): Promise<WorkflowIds> {
  const { data, error } = await db
    .from("platform_settings")
    .select("value")
    .eq("key", "portal_ghl_writeback")
    .maybeSingle();
  if (error) return { readable: false, error: error.message };
  const v = (data?.value ?? {}) as { mca05_workflow_id?: string; mca06_workflow_id?: string };
  return { readable: true, mca05: v.mca05_workflow_id ?? null, mca06: v.mca06_workflow_id ?? null };
}

/** Re-run the AI underwriter for the scoped deal. Best-effort. Invoked with the
 *  service-role key so underwrite-deal treats it as a trusted auto call. */
async function triggerUnderwriting(db: SupabaseClient, dealId: string | null): Promise<boolean> {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey || !dealId) return false;
    // Prove the deal still exists before claiming we fired at it.
    const { data: deal } = await db.from("deals").select("id").eq("id", dealId).maybeSingle();
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

/** Human label for a customer_document_type slug (for the GHL note). */
function docTypeLabel(slug: string): string {
  return slug === "id" ? "photo ID" : slug.replace(/_/g, " ");
}

interface WriteBackArgs {
  customerId: string;
  filename: string;
  docType: string;
  viaPhrase: string;
  ghlSource: string;
  decision: ChaseDecision;
  trail: string[];
}

/**
 * Tell GHL the merchant complied, using ONLY the authority we allow ourselves:
 * contact tags, contact-level workflow removal, and a contact note. Never a
 * workflow edit, never a stage move, never a message to the merchant.
 */
async function ghlWriteBack(db: SupabaseClient, args: WriteBackArgs): Promise<GhlWriteBackResult> {
  const out: GhlWriteBackResult = { attempted: true };
  const trail = args.trail;
  try {
    const { data: customer, error: custErr } = await db
      .from("customers")
      .select("id, business_name, email, first_name, last_name, phone, ghl_contact_id")
      .eq("id", args.customerId)
      .maybeSingle();
    if (custErr || !customer) {
      out.error = custErr
        ? `customer read FAILED (${custErr.message}) — the write-back did NOT run`
        : "customer row not found — nothing to write back to";
      trail.push(out.error);
      return out;
    }

    const cfg = await getGhlConfig(db);

    // ── Resolve the GHL contact (stored id, else heal by email upsert). ──
    let contactId = (customer.ghl_contact_id as string | null) ?? null;
    let resolvedByUpsert = false;
    if (!contactId) {
      const email = (customer.email as string | null)?.trim();
      if (!email) {
        out.error = "no ghl_contact_id and no email on the customer — nothing to write back to";
        trail.push(`SKIPPED — ${out.error}`);
        return out;
      }
      const up = await upsertContact(cfg, {
        email,
        firstName: (customer.first_name as string | null) ?? undefined,
        lastName: (customer.last_name as string | null) ?? undefined,
        companyName: (customer.business_name as string | null) ?? undefined,
        phone: (customer.phone as string | null) ?? undefined,
        // NO `tags` HERE — /contacts/upsert REPLACES the whole tag array. This
        // upsert dedupes by email, so it can land on an EXISTING contact and wipe
        // its lead-source/campaign tags (synergy, live-transfer, …). `merchant`
        // is folded into the ADDITIVE addContactTags call below instead.
        source: args.ghlSource,
      });
      contactId = up.data?.contact?.id ?? null;
      if (!contactId) {
        out.error = `contact upsert failed (${up.status})`;
        trail.push(`FAILED — ${out.error}`);
        return out;
      }
      resolvedByUpsert = true;
      const { error: linkErr } = await db.from("customers")
        .update({ ghl_contact_id: contactId }).eq("id", args.customerId);
      if (linkErr) console.warn("[merchantDocArrived] persisting healed ghl_contact_id failed:", linkErr.message);
    }
    out.contact_id = contactId;

    // ── a) Tags. Identical on both lanes ON PURPOSE: any GHL automation keyed
    // on `portal-doc-uploaded` must fire for a link upload too. Provenance lives
    // in the note and the activity_log trail, not in a second tag nobody wired up.
    const tags = ["portal-doc-uploaded"];
    if (resolvedByUpsert) tags.push("merchant");
    if (args.docType === "bank_statement" && args.decision.bank === "satisfied") {
      tags.push("portal-statements-in");
    }
    const tagRes = await addContactTags(cfg, contactId, tags);
    out.tags = tags;
    out.tags_ok = tagRes.ok;
    trail.push(`tags [${tags.join(", ")}] → ${tagRes.ok ? "ok" : `FAILED (${tagRes.status})`}`);

    // ── b) Stop the chase — contact-level workflow removal ONLY. ──
    const wf = await readWorkflowIds(db);
    out.mca06_removed = null;
    out.mca05_removed = null;

    const stopBank = shouldStopBankChase(args.decision, args.docType);
    const stopNonBank = shouldStopNonBankChase(args.decision);

    if (!wf.readable) {
      // NOT "not configured" — both ids ARE configured (verified 2026-11-01).
      // This is a failed read, and the chase did not stop.
      trail.push(
        `workflow-id read FAILED (${wf.error}) — MCA 05/06 removal NOT attempted; ` +
          `the chase is still running${stopBank || stopNonBank ? " for a merchant who complied" : ""}`,
      );
    } else {
      if (stopBank) {
        if (args.decision.bank === "unknown") {
          trail.push(
            "MCA 06: acting on the bank statement we just stored, NOT on the checklist (unreadable above)",
          );
        }
        if (wf.mca06) {
          const rm = await removeContactFromWorkflow(cfg, contactId, wf.mca06);
          out.mca06_removed = rm.ok;
          trail.push(`MCA 06 (bank-statement chase) removal → HTTP ${rm.status}${rm.ok ? "" : ` FAILED: ${rm.error ?? ""}`}`);
        } else {
          trail.push("MCA 06 removal SKIPPED — portal_ghl_writeback.mca06_workflow_id is not set");
        }
      }
      if (stopNonBank) {
        if (wf.mca05) {
          const rm = await removeContactFromWorkflow(cfg, contactId, wf.mca05);
          out.mca05_removed = rm.ok;
          trail.push(`MCA 05 (non-bank stips chase) removal → HTTP ${rm.status}${rm.ok ? "" : ` FAILED: ${rm.error ?? ""}`}`);
        } else {
          trail.push("MCA 05 removal SKIPPED — portal_ghl_writeback.mca05_workflow_id is not set");
        }
      }
      if (!stopBank && !stopNonBank) {
        trail.push(
          `no workflow removal — bank ask ${args.decision.bank}, non-bank ask ${args.decision.nonBank}` +
            (args.decision.nonBank === "unknown"
              ? " (an unknown non-bank ask never stops MCA 05: one document arriving says nothing about the others)"
              : ""),
        );
      }
    }

    // ── c) Contact note so VAs living inside GHL see the upload. ──
    const noteRes = await createContactNote(
      cfg,
      contactId,
      `Merchant uploaded "${args.filename}" via ${args.viaPhrase} — ${docTypeLabel(args.docType)}. ` +
        `File is in the app doc-review queue (Admin → Doc Review).`,
    );
    out.note_ok = noteRes.ok;
    trail.push(`contact note → ${noteRes.ok ? "ok" : `FAILED (${noteRes.status})`}`);
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
    trail.push(`write-back errored: ${out.error}`);
    console.warn("[merchantDocArrived] GHL write-back failed (upload unaffected):", out.error);
  }
  return out;
}

/** Every outcome — good or bad — lands in activity_log under one subject, so
 *  "did the chase stop?" is answerable from the customer's timeline.
 *  interaction_type MUST be 'note': the check constraint has no 'system', and a
 *  bad value fails the insert SILENTLY. Subject marker unchanged from the
 *  portal-only version so both lanes read identically. */
async function writeTrail(
  db: SupabaseClient,
  customerId: string,
  filename: string,
  docType: string,
  lines: string[],
): Promise<void> {
  const { error } = await db.from("activity_log").insert({
    entity_type: "customer",
    entity_id: customerId,
    interaction_type: "note",
    subject: "portal:ghl-writeback",
    content: `Merchant upload "${filename}" (${docType}) → side effects:\n- ${lines.join("\n- ")}`,
  });
  if (error) console.warn("[merchantDocArrived] trail activity_log insert failed:", error.message);
}
