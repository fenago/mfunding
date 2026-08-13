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
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  corsHeaders, serviceClient, getGhlConfig, getContact, upsertContact, ghlErrorMessage,
  updateContactCustomFields,
} from "../_shared/ghl.ts";
import { UCC_OVERWRITABLE_OR_FILTER } from "../_shared/positionsSource.ts";
import {
  type UccLeadRow, UCC_ENRICH_COLS, last10, toUccLeadRow,
  realFunders, mcaScoreNum, buildPositionsPatch,
} from "../_shared/uccPositions.ts";

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

// UccLeadRow / UCC_ENRICH_COLS / last10 / toUccLeadRow / realFunders /
// mcaScoreNum / buildPositionsPatch are shared with resync-deal-positions via
// _shared/uccPositions.ts (single source of truth for how existing MCA positions
// are resolved + computed).


// ── Dial-campaign attribution ────────────────────────────────────────────────
//
// This closes the loop: lead-push-ghl stamps the campaign's dial_tag onto the GHL
// contact, HP dials by that tag, the setter opens the Playbook, and the deal
// becomes campaign-attributed — so the existing deals.campaign_id KPI model
// (funded x 8 points) reports per-campaign revenue with no manual step.
//
// RULES (owner's, verbatim intent):
//   • never overwrite a non-null campaign_id — FIRST ATTRIBUTION WINS.
//   • if several dial tags match several campaigns, take the MOST RECENTLY
//     CREATED — that is the one currently dialing them — and say it was ambiguous.
//   • the response reports the STAMPED campaign (what deals.campaign_id actually
//     holds), never the tag match, so the UI can never show an attribution the
//     deal does not carry. When they differ, tag_matched_campaign_id says so.
//
// Best-effort throughout: attribution is analytics and must never break opening a
// deal for a setter who is mid-call.
interface DialCampaign { id: string; name: string; code: string | null; dial_tag: string }

async function attributeCampaign(
  db: SupabaseClient,
  dealId: string,
  contactId: string,
  tags: string[],
): Promise<Record<string, unknown>> {
  try {
    // What the deal already carries wins outright.
    const { data: deal } = await db.from("deals").select("campaign_id").eq("id", dealId).maybeSingle();
    const existing = (deal?.campaign_id as string | null) ?? null;

    // Candidate tags: the contact's own tags, plus — when the contact wasn't
    // re-read (phone/seed path) — whatever we pushed for this contact.
    let candidates = tags.map((t) => t.trim().toLowerCase()).filter(Boolean);
    if (!candidates.length) {
      const { data: pushed } = await db.from("lead_records")
        .select("push_tags").eq("ghl_contact_id", contactId)
        .order("pushed_at", { ascending: false }).limit(1).maybeSingle();
      candidates = ((pushed?.push_tags as string[] | null) ?? []).map((t) => t.toLowerCase());
    }

    let matched: DialCampaign | null = null;
    let ambiguous = false;
    if (candidates.length) {
      const { data: camps } = await db.from("campaigns")
        .select("id,name,code,dial_tag,created_at")
        .not("dial_tag", "is", null).in("dial_tag", candidates)
        .order("created_at", { ascending: false });
      const rows = (camps ?? []) as unknown as (DialCampaign & { created_at: string })[];
      if (rows.length) { matched = rows[0]; ambiguous = rows.length > 1; }
    }

    // Stamp only into a gap.
    let stampedId = existing;
    if (!existing && matched) {
      const { error } = await db.from("deals").update({ campaign_id: matched.id }).eq("id", dealId);
      if (!error) stampedId = matched.id;
      else console.error("[playbook-open-contact] campaign stamp failed:", error.message);
    }
    if (!stampedId) {
      return { campaign_attribution: { source: "none", ambiguous, matched_tags: candidates.filter((c) => matched?.dial_tag === c) } };
    }

    // Report what the deal ACTUALLY carries.
    const { data: stamped } = await db.from("campaigns")
      .select("id,name,code,dial_tag").eq("id", stampedId).maybeSingle();
    if (!stamped) return { campaign_attribution: { source: "none", ambiguous, matched_tags: [] } };

    const source = existing ? (matched && matched.id !== existing ? "preexisting_differs" : "preexisting") : "tag_match";
    return {
      campaign: stamped,
      campaign_attribution: {
        source,
        ambiguous,
        matched_tags: matched ? [matched.dial_tag] : [],
        // Only present when the tag match is NOT what the deal carries, so the UI
        // never has to reconcile two campaigns silently.
        ...(matched && matched.id !== stampedId ? { tag_matched_campaign_id: matched.id, tag_matched_campaign_name: matched.name } : {}),
      },
    };
  } catch (e) {
    console.error("[playbook-open-contact] campaign attribution failed:", e instanceof Error ? e.message : String(e));
    return {};
  }
}

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
        uccLead = toUccLeadRow(lead as Record<string, unknown>);
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

    // Real (non-agent-sentinel) funder names + finite MCA score on the lead
    // (shared derivations — identical to resync-deal-positions).
    const uccFunders = realFunders(uccLead);
    // The lead's MCA quality score — written onto the deal so it follows the
    // merchant into the pipeline and on to GHL's "MCA Score" custom field.
    const uccMcaScore: number | null = mcaScoreNum(uccLead);

    // The deal patch for existing MCA positions (null when the lead carries no
    // positions signal — so we never stamp source='ucc' onto nothing). Memoized;
    // built via the shared _shared/uccPositions.ts computation.
    let positionsPatchCache: Record<string, unknown> | null | undefined;
    async function positionsPatch(): Promise<Record<string, unknown> | null> {
      if (positionsPatchCache !== undefined) return positionsPatchCache;
      positionsPatchCache = await buildPositionsPatch(db, uccLead);
      return positionsPatchCache;
    }

    // REFRESH existing_positions onto a deal from the freshly-read UCC lead —
    // whenever the deal's current source is a UCC estimate or unset (rank <= 1).
    // This is what lets a merchant's NEW advances (taken after first-open) show up
    // on resume. A human/underwriter value (manual/application/bank_statements,
    // rank >= 2) is NEVER touched — the .or() filter is the race-safe DB guard that
    // mirrors the shared canWrite() precedence in _shared/positionsSource.ts.
    // The GHL contact's tags — how a dial campaign claims this merchant. Declared
    // here because the EXISTING-DEAL path returns before the contact is ever
    // re-read, so it stays empty there and attributeCampaign() falls back to what
    // we pushed for this contact.
    let contactTags: string[] = [];

    async function refreshDealPositions(dealId: string): Promise<void> {
      const patch = await positionsPatch();
      if (!patch) return;
      const { error } = await db.from("deals")
        .update(patch)
        .eq("id", dealId)
        .or(UCC_OVERWRITABLE_OR_FILTER);   // source rank <= 1 (null or 'ucc') only
      if (error) console.error("[playbook-open-contact] deal positions refresh failed:", error.message);
    }

    // REFRESH the UCC MCA score onto a deal, guarded by the SAME positions-source
    // precedence (rank <= 1). Independent of the positions refresh (a lead may
    // carry a score but no positions signal), but it must never overwrite a score
    // that belongs to a human/underwriter-owned positions record.
    async function refreshDealScore(dealId: string): Promise<void> {
      if (uccMcaScore == null) return;
      const { error } = await db.from("deals")
        .update({ mca_score: uccMcaScore })
        .eq("id", dealId)
        .or(UCC_OVERWRITABLE_OR_FILTER);   // source rank <= 1 (null or 'ucc') only
      if (error) console.error("[playbook-open-contact] deal mca_score refresh failed:", error.message);
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
      // Resume: refresh the auto-populated fields onto the existing deal + its
      // customer. Positions/score refresh from the latest UCC read when the deal's
      // source is a UCC estimate or unset (rank <= 1); a human/underwriter value is
      // never overwritten. Address stays null-only.
      await refreshDealPositions(d.id);
      await refreshDealScore(d.id);
      if (d.customer_id) await backfillCustomerAddress(d.customer_id);
      const claimed = await claimIfNeeded(d.id, d.assigned_closer_id);
      const attr1 = await attributeCampaign(db, d.id, contactId, contactTags);
      return json({ ok: true, deal_id: d.id, created: false, claimed, ghl_contact_id: contactId, matched_ucc: matchedUcc, ...attr1 });
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
        // The contact's TAGS are how a dial campaign claims this merchant.
        if (Array.isArray(c.tags)) contactTags = (c.tags as unknown[]).map((t) => String(t));
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
      // Resume: refresh existing positions onto this pre-existing open deal from
      // the latest UCC read (source rank <= 1 only — never overwrite a refined value).
      await refreshDealPositions(d.id);
      await refreshDealScore(d.id);
      const claimed = await claimIfNeeded(d.id, d.assigned_closer_id);
      const attr1 = await attributeCampaign(db, d.id, contactId, contactTags);
      return json({ ok: true, deal_id: d.id, created: false, claimed, ghl_contact_id: contactId, matched_ucc: matchedUcc, ...attr1 });
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
        // Seed the UCC MCA quality score onto the brand-new deal (no overwrite risk).
        ...(uccMcaScore != null ? { mca_score: uccMcaScore } : {}),
      })
      .select("id")
      .single();
    if (dealErr || !newDeal) return json({ ok: false, error: `Couldn't create the deal: ${dealErr?.message ?? "unknown"}` }, 500);

    const attr2 = await attributeCampaign(db, newDeal.id, contactId, contactTags);
    return json({ ok: true, deal_id: newDeal.id, created: true, claimed: isCloser, ghl_contact_id: contactId, matched_ucc: matchedUcc, ...attr2 });
  } catch (e) {
    console.error("[playbook-open-contact] fatal:", e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
