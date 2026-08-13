// playbook-open-contact — resolve-or-create the deal behind a GHL contact so a
// setter's "Open in Playbook" deep-link lands on THAT merchant's deal, loaded.
//
//   POST { ghl_contact_id, lead_source? }
//   POST { phone, lead_source? }                     (BY PHONE — see below)
//        → { ok:true, deal_id, created, claimed, ghl_contact_id, matched_ucc? }  (200)
//        | { ok:false, error }                       (4xx/5xx)
//
// WHY a phone path: setters dial UCC leads from HotProspector, whose GHL deep
// link is useless for them — those leads were CSV-imported into HP and have no
// GHL contact id (HP's GHL sync is broken both ways). So the setter opens the
// merchant by the ONE identifier the dialer always has: the phone number. We
// look the number up in ph_ucc_leads for the merchant's real identity, UPSERT
// (never blind-create) a GHL contact on it — which finally lands the merchant in
// GoHighLevel/VibeReach — and then run the exact same resolve-or-create-deal
// path as the contact-id flow. Unknown numbers still work: a minimal contact is
// upserted from the phone alone.
//
// WHY server-side: a setter (role=closer) can only SELECT deals they own or that
// are unassigned, and CANNOT read a customer row they don't own — so the browser
// can't reliably look up "the deal for this GHL contact" or create one under RLS.
// This function runs with the service role: it looks up (idempotent) or creates
// the customer + deal, then CLAIMS the deal for the calling closer (assigns it to
// them) so RLS lets the app read it immediately afterward.
//
// Idempotent: an existing OPEN mca deal for the contact is returned as-is (never
// duplicated). name/business/email/phone are mapped from the GHL contact.
//
// Auth: verify_jwt = true PLUS an in-code staff role check (closer/admin/
// super_admin), mirroring deal-assistant / analyze-campaign.
//
// Compliance: an MCA is a purchase of future receivables, NEVER a loan.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeaders, serviceClient, getGhlConfig, getContact, upsertContact, ghlErrorMessage,
  updateContactCustomFields,
} from "../_shared/ghl.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// MCA statuses that mean "this deal is done" — mirrors PlaybookCapture's
// CLOSED_STATUSES so resolve-or-create matches the in-app "resume vs. new" rule.
const CLOSED_STATUSES = ["funded", "declined", "dead", "renewal_eligible", "restructure_executed", "servicing"];

const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
};

/** Normalize any dialed/stored phone to its US last-10 digits (the one key that
 * survives HP, GHL and ph_ucc_leads formatting). "+1 (715) 748-2308" → "7157482308".
 * Returns null when the number isn't a usable 10-digit US number. */
function last10(raw: string | null): string | null {
  let d = (raw ?? "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d.length === 10 ? d : null;
}

/** "Mary Elizabeth Schoofs" → { first: "Mary", last: "Elizabeth Schoofs" }. */
function splitName(full: string | null): { first: string | null; last: string | null } {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: null, last: null };
  if (parts.length === 1) return { first: parts[0], last: null };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

/** Identity we map a customer from — either seeded from ph_ucc_leads (phone path)
 * or read back off the GHL contact (contact-id path). */
interface Identity {
  first: string | null;
  last: string | null;
  business: string | null;
  email: string | null;
  phone: string | null;
}

/** The sentinel matched_funders value ph-ucc-ingest writes for agent-filed leads
 * (the real funder is hidden behind a representation agent). It is NOT a real
 * funder name — mirror of AGENT_FILED_SENTINEL in ph-ucc-push-ghl. */
const AGENT_FILED_SENTINEL = "— agent-filed (funder unknown) —";

/** The backing UCC lead behind a merchant — the source of the auto-populated
 * address + existing-MCA-positions. Recovered by phone (phone path) or by
 * ghl_contact_id (deep-link path). */
interface UccLeadRow {
  id: string;
  debtor_address: string | null;
  debtor_city: string | null;
  debtor_state: string | null;
  debtor_zip: string | null;
  stack_depth: number | null;
  matched_funders: string[] | null;
  mca_score: number | string | null;
}

/** ph_ucc_leads columns needed to enrich the customer address + deal positions. */
const UCC_ENRICH_COLS =
  "id, debtor_address, debtor_city, debtor_state, debtor_zip, stack_depth, matched_funders, mca_score";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const db = serviceClient();

    // ---- Authn: signed-in staff only. -------------------------------------
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ ok: false, error: "Missing authorization" }, 401);
    const { data: userData, error: userErr } = await db.auth.getUser(token);
    const caller = userData?.user;
    if (userErr || !caller) return json({ ok: false, error: "Invalid session" }, 401);

    const { data: callerProfile } = await db
      .from("profiles").select("role").eq("id", caller.id).single();
    const role = callerProfile?.role as string | undefined;
    if (!role || !["closer", "admin", "super_admin"].includes(role)) {
      return json({ ok: false, error: "Forbidden — staff only" }, 403);
    }
    const isCloser = role === "closer";

    const body = await req.json().catch(() => ({}));
    let ghlContactId = str(body?.ghl_contact_id ?? body?.contactId ?? body?.contact);
    const rawPhone = str(body?.phone);
    const leadSource = str(body?.lead_source) ?? "ph_setter";
    if (!ghlContactId && !rawPhone) {
      return json({ ok: false, error: "ghl_contact_id or phone is required" }, 400);
    }

    // ── 0) PHONE PATH: number → ph_ucc_leads identity → upserted GHL contact. ─
    // Everything downstream is then identical to the contact-id path.
    let seed: Identity | null = null;   // identity we already know — skips getContact
    let uccLeadId: string | null = null;
    let matchedUcc = false;
    // The backing UCC lead (address + existing positions). Set on the phone path
    // here; recovered by ghl_contact_id on the deep-link path further down.
    let uccLead: UccLeadRow | null = null;
    if (!ghlContactId) {
      const digits = last10(rawPhone);
      if (!digits) return json({ ok: false, error: `"${rawPhone}" isn't a usable 10-digit phone number.` }, 400);

      // ph_ucc_leads stores bare 10-digit numbers; the trailing-match also picks
      // up any row written as +1XXXXXXXXXX or 1XXXXXXXXXX.
      const { data: leads, error: leadErr } = await db
        .from("ph_ucc_leads")
        .select(`id, phone, person_name, debtor_name, email, ghl_contact_id, ${UCC_ENRICH_COLS}`)
        .like("phone", `%${digits}`)
        .order("score", { ascending: false, nullsFirst: false })
        .limit(5);
      if (leadErr) console.error("[playbook-open-contact] ucc lookup failed:", leadErr.message);
      const lead = (leads ?? []).find((l) => last10(str(l.phone)) === digits) ?? null;

      if (lead) {
        matchedUcc = true;
        uccLeadId = lead.id as string;
        uccLead = {
          id: lead.id as string,
          debtor_address: (lead.debtor_address as string | null) ?? null,
          debtor_city: (lead.debtor_city as string | null) ?? null,
          debtor_state: (lead.debtor_state as string | null) ?? null,
          debtor_zip: (lead.debtor_zip as string | null) ?? null,
          stack_depth: (lead.stack_depth as number | null) ?? null,
          matched_funders: (lead.matched_funders as string[] | null) ?? null,
          mca_score: (lead.mca_score as number | string | null) ?? null,
        };
        const nm = splitName(str(lead.person_name));
        seed = {
          first: nm.first,
          last: nm.last,
          business: str(lead.debtor_name),
          email: str(lead.email),
          phone: `+1${digits}`,
        };
      } else {
        seed = { first: null, last: null, business: null, email: null, phone: `+1${digits}` };
      }

      // UPSERT (never blind-create) so GHL dedupes on the phone/email and we
      // respect one-contact-per-merchant.
      try {
        const cfg = await getGhlConfig(db);
        const up = await upsertContact(cfg, {
          firstName: seed.first ?? "Merchant",
          lastName: seed.last,
          companyName: seed.business,
          email: seed.email,
          phone: seed.phone,
          address1: lead ? str(lead.debtor_address) : null,
          city: lead ? str(lead.debtor_city) : null,
          state: lead ? str(lead.debtor_state) : null,
          postalCode: lead ? str(lead.debtor_zip) : null,
          source: leadSource,
        });
        // ghlFetch never throws on an API error — it reports it on the envelope.
        if (!up.ok) {
          return json({ ok: false, error: `Couldn't create the contact in the CRM: ${ghlErrorMessage(up.error)}` }, 502);
        }
        ghlContactId = str(up.data?.contact?.id);
      } catch (e) {
        return json({ ok: false, error: `Couldn't create the contact in the CRM: ${e instanceof Error ? e.message : String(e)}` }, 502);
      }
      if (!ghlContactId) return json({ ok: false, error: "The CRM didn't return a contact id for that number." }, 502);

      // Remember the link on the lead so the next dial resolves instantly and
      // the UCC book shows the merchant is now in GHL. Best-effort.
      if (uccLeadId) {
        const { error: linkErr } = await db
          .from("ph_ucc_leads")
          .update({ ghl_contact_id: ghlContactId, pushed_to_ghl_at: new Date().toISOString() })
          .eq("id", uccLeadId);
        if (linkErr) console.error("[playbook-open-contact] ucc link backfill failed:", linkErr.message);
      }
    }

    // From here on both entry paths are identical — we have a GHL contact id.
    if (!ghlContactId) return json({ ok: false, error: "ghl_contact_id is required" }, 400);
    const contactId: string = ghlContactId;

    // ── DEEP-LINK PATH: recover the backing UCC lead by ghl_contact_id. The phone
    // path already set uccLead; this is what makes a DEEP-LINKED UCC merchant
    // auto-populate (address + existing positions) exactly like the phone path.
    if (!uccLead) {
      const { data: byContact, error: ulErr } = await db
        .from("ph_ucc_leads")
        .select(UCC_ENRICH_COLS)
        .eq("ghl_contact_id", contactId)
        .order("score", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      if (ulErr) console.error("[playbook-open-contact] ucc lead by-contact lookup failed:", ulErr.message);
      if (byContact) {
        uccLead = byContact as unknown as UccLeadRow;
        uccLeadId = uccLead.id;
      }
    }

    // GHL custom-field IDs are read from get_ghl_config() (decoupled handshake —
    // another agent persists the three ids into the config JSON). Absent keys are
    // skipped silently; nothing is ever hardcoded.
    let ghlFieldIds: { positions: string | null; funders: string | null; score: string | null } =
      { positions: null, funders: null, score: null };
    try {
      const { data: rawCfg } = await db.rpc("get_ghl_config");
      const c = (rawCfg ?? {}) as Record<string, unknown>;
      ghlFieldIds = {
        positions: str(c.cf_existing_positions),
        funders: str(c.cf_current_funders),
        score: str(c.cf_mca_score),
      };
    } catch (e) {
      console.warn("[playbook-open-contact] ghl config read for field ids failed:", e instanceof Error ? e.message : String(e));
    }

    // Real (non-agent-sentinel) funder names on the lead.
    const uccFunders = (uccLead?.matched_funders ?? []).filter((f) => f && f !== AGENT_FILED_SENTINEL);

    // Per-lien detail from the ph_ucc_lead_filings RPC (normalized debtor-key
    // join; one row per UCC position). Cheap to memoize — used by every write.
    let positionsDetailCache: Array<Record<string, unknown>> | undefined;
    async function positionsDetail(): Promise<Array<Record<string, unknown>>> {
      if (positionsDetailCache !== undefined) return positionsDetailCache;
      if (!uccLead) { positionsDetailCache = []; return positionsDetailCache; }
      const { data, error } = await db.rpc("ph_ucc_lead_filings", { p_lead_id: uccLead.id });
      if (error) {
        console.error("[playbook-open-contact] ph_ucc_lead_filings failed:", error.message);
        positionsDetailCache = [];
        return positionsDetailCache;
      }
      positionsDetailCache = ((data ?? []) as Array<Record<string, unknown>>).map((f) => ({
        funder: str(f.secured_party_raw),
        filed_date: (f.filed_date as string | null) ?? null,
        state: str(f.state),
        filing_no: str(f.filing_no),
      }));
      return positionsDetailCache;
    }

    // The deal patch for existing MCA positions — null when the lead carries no
    // positions signal at all (so we never stamp source='ucc' onto nothing).
    let positionsPatchCache: Record<string, unknown> | null | undefined;
    async function positionsPatch(): Promise<Record<string, unknown> | null> {
      if (positionsPatchCache !== undefined) return positionsPatchCache;
      if (!uccLead) { positionsPatchCache = null; return null; }
      const detail = await positionsDetail();
      const hasSignal = uccLead.stack_depth != null || uccFunders.length > 0 || detail.length > 0;
      if (!hasSignal) { positionsPatchCache = null; return null; }
      positionsPatchCache = {
        existing_positions: uccLead.stack_depth ?? null,
        existing_funders: uccFunders.length ? uccFunders : null,
        existing_positions_detail: detail,
        existing_positions_source: "ucc",
        existing_positions_synced_at: new Date().toISOString(),
      };
      return positionsPatchCache;
    }

    // Backfill existing_positions onto a deal ONLY when it is currently null — a
    // human or the application may have refined it, and that must never be lost.
    async function backfillDealPositions(dealId: string): Promise<void> {
      const patch = await positionsPatch();
      if (!patch) return;
      const { error } = await db.from("deals")
        .update(patch)
        .eq("id", dealId)
        .is("existing_positions", null);   // race-safe no-overwrite guard
      if (error) console.error("[playbook-open-contact] deal positions backfill failed:", error.message);
    }

    // Backfill the merchant address onto a customer — only columns that are
    // currently NULL/empty; never overwrite a value a human already entered.
    async function backfillCustomerAddress(custId: string): Promise<void> {
      if (!uccLead) return;
      const st = str(uccLead.debtor_address), ci = str(uccLead.debtor_city),
        stt = str(uccLead.debtor_state), z = str(uccLead.debtor_zip);
      if (!st && !ci && !stt && !z) return;
      const { data: cur, error } = await db.from("customers")
        .select("address_street, address_city, address_state, address_zip")
        .eq("id", custId).maybeSingle();
      if (error || !cur) { if (error) console.error("[playbook-open-contact] customer addr read failed:", error.message); return; }
      const empty = (v: unknown) => v === null || v === undefined || String(v).trim() === "";
      const patch: Record<string, string> = {};
      if (empty(cur.address_street) && st) patch.address_street = st;
      if (empty(cur.address_city) && ci) patch.address_city = ci;
      if (empty(cur.address_state) && stt) patch.address_state = stt;
      if (empty(cur.address_zip) && z) patch.address_zip = z;
      if (Object.keys(patch).length === 0) return;
      const { error: uErr } = await db.from("customers").update(patch).eq("id", custId);
      if (uErr) console.error("[playbook-open-contact] customer addr backfill failed:", uErr.message);
    }

    // Push existing-positions / current-funders / mca-score onto the GHL contact
    // as custom fields — best-effort, never blocks the deal open. Skips silently
    // when the field ids aren't configured (decoupled handshake).
    async function pushGhlUccFields(): Promise<void> {
      if (!uccLead) return;
      const fields: Array<{ id: string; value: string | number }> = [];
      if (ghlFieldIds.positions && uccLead.stack_depth != null) {
        fields.push({ id: ghlFieldIds.positions, value: uccLead.stack_depth });
      }
      if (ghlFieldIds.funders && uccFunders.length) {
        fields.push({ id: ghlFieldIds.funders, value: uccFunders.join(", ") });
      }
      const mca = uccLead.mca_score == null ? null : Number(uccLead.mca_score);
      if (ghlFieldIds.score && mca != null && Number.isFinite(mca)) {
        fields.push({ id: ghlFieldIds.score, value: mca });
      }
      if (!fields.length) return;
      try {
        const cfg = await getGhlConfig(db);
        const res = await updateContactCustomFields(cfg, contactId, fields);
        if (!res.ok) console.warn("[playbook-open-contact] ghl custom-field push failed:", ghlErrorMessage(res.error));
      } catch (e) {
        console.warn("[playbook-open-contact] ghl custom-field push threw:", e instanceof Error ? e.message : String(e));
      }
    }

    // Sync the UCC intel to GHL now (best-effort; both paths, once we have a lead).
    await pushGhlUccFields();

    // Claim an unassigned deal for the calling closer so RLS lets them read it.
    // Admins/super_admins already read every deal, so we never reassign for them.
    async function claimIfNeeded(dealId: string, assignedCloserId: string | null): Promise<boolean> {
      if (!isCloser || assignedCloserId) return false;
      const { error } = await db.from("deals")
        .update({ assigned_closer_id: caller!.id })
        .eq("id", dealId)
        .is("assigned_closer_id", null);
      if (error) { console.error("[playbook-open-contact] claim failed:", error.message); return false; }
      return true;
    }

    // ── 1) IDEMPOTENT RESOLVE: newest OPEN mca deal already on this contact. ──
    const { data: existingDeals, error: findErr } = await db
      .from("deals")
      .select("id, assigned_closer_id, status, customer_id")
      .eq("ghl_contact_id", contactId)
      .eq("deal_type", "mca")
      .not("status", "in", `(${CLOSED_STATUSES.join(",")})`)
      .order("created_at", { ascending: false })
      .limit(1);
    if (findErr) return json({ ok: false, error: `deal lookup failed: ${findErr.message}` }, 500);

    if (existingDeals && existingDeals.length > 0) {
      const d = existingDeals[0] as { id: string; assigned_closer_id: string | null; customer_id: string | null };
      // Resume: backfill the auto-populated fields onto the existing deal + its
      // customer (nulls only — never overwrite refined values).
      await backfillDealPositions(d.id);
      if (d.customer_id) await backfillCustomerAddress(d.customer_id);
      const claimed = await claimIfNeeded(d.id, d.assigned_closer_id);
      return json({ ok: true, deal_id: d.id, created: false, claimed, ghl_contact_id: contactId, matched_ucc: matchedUcc });
    }

    // ── 2) Resolve/create the CUSTOMER for this GHL contact. ──────────────────
    // Reuse a customer already linked to this ghl contact; else pull the GHL
    // contact and dedupe by email / last-10 phone before minting a new one.
    let customerId: string | null = null;

    const { data: linkedCust } = await db
      .from("customers").select("id").eq("ghl_contact_id", contactId).limit(1).maybeSingle();
    if (linkedCust?.id) customerId = linkedCust.id;

    // Identity for the customer row. The phone path already knows it (from the
    // UCC lead we just upserted into GHL); the contact-id path reads it back off
    // the GHL contact.
    let first: string | null = seed?.first ?? null, last: string | null = seed?.last ?? null,
        business: string | null = seed?.business ?? null, email: string | null = seed?.email ?? null,
        phone: string | null = seed?.phone ?? null;
    if (!seed) {
      try {
        const cfg = await getGhlConfig(db);
        const got = await getContact(cfg, contactId);
        const c = (got.data?.contact ?? {}) as Record<string, unknown>;
        first = str(c.firstName) ?? (str(c.contactName)?.split(/\s+/)[0] ?? null);
        last = str(c.lastName);
        business = str(c.companyName);
        email = str(c.email);
        phone = str(c.phone);
      } catch (e) {
        // GHL is best-effort for identity; if the contact can't be fetched and we
        // have no linked customer, we cannot build a usable lead.
        if (!customerId) {
          return json({ ok: false, error: `Couldn't load the contact from the CRM: ${e instanceof Error ? e.message : String(e)}` }, 502);
        }
      }
    }

    if (!customerId) {
      // Dedupe against an existing customer by email OR last-10 phone.
      const digits = (phone ?? "").replace(/\D/g, "");
      const orClauses: string[] = [];
      if (email) orClauses.push(`email.ilike.${email}`);
      if (digits.length >= 10) orClauses.push(`phone.ilike.%${digits.slice(-10)}%`);
      if (orClauses.length) {
        const { data: cands } = await db
          .from("customers").select("id, email, phone").or(orClauses.join(",")).limit(10);
        const match = (cands ?? []).find((c) => {
          const cd = String(c.phone ?? "").replace(/\D/g, "");
          const phoneHit = digits.length >= 10 && cd.length >= 10 && cd.slice(-10) === digits.slice(-10);
          const emailHit = !!email && String(c.email ?? "").trim().toLowerCase() === email.toLowerCase();
          return phoneHit || emailHit;
        });
        if (match?.id) {
          customerId = match.id;
          // Backfill the ghl link so the next open resolves instantly.
          await db.from("customers").update({ ghl_contact_id: contactId }).eq("id", match.id);
        }
      }
    }

    let customerCreated = false;
    if (!customerId) {
      const { data: newCust, error: custErr } = await db
        .from("customers")
        .insert({
          // customers.first_name / last_name are NOT NULL — a GHL contact may
          // carry no surname, so default last_name to "" rather than null.
          first_name: first ?? "Merchant",
          last_name: last ?? "",
          business_name: business,
          email,
          phone,
          status: "lead",
          source: "other",
          ghl_contact_id: contactId,
          // Auto-populate the merchant address from the backing UCC lead.
          ...(uccLead ? {
            address_street: str(uccLead.debtor_address),
            address_city: str(uccLead.debtor_city),
            address_state: str(uccLead.debtor_state),
            address_zip: str(uccLead.debtor_zip),
          } : {}),
        })
        .select("id")
        .single();
      if (custErr || !newCust) return json({ ok: false, error: `Couldn't create the lead: ${custErr?.message ?? "unknown"}` }, 500);
      customerId = newCust.id;
      customerCreated = true;
    }

    // Existing customer (linked or deduped): backfill any NULL address columns
    // from the UCC lead — never overwrite a value a human already entered.
    if (!customerCreated && customerId) await backfillCustomerAddress(customerId);

    // ── 2b) Second idempotency guard: the customer may already carry an OPEN
    // mca deal that predates the ghl link (common on the phone path, where the
    // merchant existed before they were ever pushed to GHL). Resume it and
    // backfill the contact id rather than minting a duplicate deal.
    const { data: custDeals } = await db
      .from("deals")
      .select("id, assigned_closer_id, ghl_contact_id")
      .eq("customer_id", customerId)
      .eq("deal_type", "mca")
      .not("status", "in", `(${CLOSED_STATUSES.join(",")})`)
      .order("created_at", { ascending: false })
      .limit(1);
    if (custDeals && custDeals.length > 0) {
      const d = custDeals[0] as { id: string; assigned_closer_id: string | null; ghl_contact_id: string | null };
      if (!d.ghl_contact_id) {
        const { error: linkErr } = await db.from("deals").update({ ghl_contact_id: contactId }).eq("id", d.id);
        if (linkErr) console.error("[playbook-open-contact] deal ghl link backfill failed:", linkErr.message);
      }
      // Resume: backfill existing positions onto this pre-existing open deal
      // (nulls only — never overwrite a refined value).
      await backfillDealPositions(d.id);
      const claimed = await claimIfNeeded(d.id, d.assigned_closer_id);
      return json({ ok: true, deal_id: d.id, created: false, claimed, ghl_contact_id: contactId, matched_ucc: matchedUcc });
    }

    // ── 3) Create the DEAL, owned by the calling closer (if a closer). ────────
    // Auto-populate existing MCA positions from the backing UCC lead (no
    // overwrite risk — this is a brand-new deal).
    const newDealPositions = await positionsPatch();
    const { data: newDeal, error: dealErr } = await db
      .from("deals")
      .insert({
        customer_id: customerId,
        deal_type: "mca",
        status: "new",
        lead_source: leadSource,
        ghl_contact_id: contactId,
        created_by: caller.id,
        assigned_closer_id: isCloser ? caller.id : null,
        lead_qual: {
          opened_from: seed ? "playbook_phone_link" : "playbook_deep_link",
          ghl_contact_id: contactId,
          ...(uccLeadId ? { ucc_lead_id: uccLeadId } : {}),
        },
        ...(newDealPositions ?? {}),
      })
      .select("id")
      .single();
    if (dealErr || !newDeal) return json({ ok: false, error: `Couldn't create the deal: ${dealErr?.message ?? "unknown"}` }, 500);

    return json({ ok: true, deal_id: newDeal.id, created: true, claimed: isCloser, ghl_contact_id: contactId, matched_ucc: matchedUcc });
  } catch (e) {
    console.error("[playbook-open-contact] fatal:", e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
