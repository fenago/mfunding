// playbook-open-contact — resolve-or-create the deal behind a GHL contact so a
// setter's "Open in Playbook" deep-link lands on THAT merchant's deal, loaded.
//
//   POST { ghl_contact_id, lead_source? }
//   POST { phone, lead_source? }                     (BY PHONE — see below)
//        → { ok:true, deal_id, created, claimed, ghl_contact_id, ghl_opportunity_id,
//            customer_id, multiple_businesses:false, matched_ucc? }              (200)
//        | { ok:false, error }                       (4xx/5xx)
//
// ONE OWNER, MANY BUSINESSES. A person can own several businesses and each is its
// own merchant. The owner is the GHL CONTACT; a business is a `customers` row
// under it, identified by normalized business_name (NEVER by EIN — it's missing on
// ~98% of them). Four request shapes, and the default one is unchanged for an
// owner with a single business:
//
//   { ghl_contact_id | phone }                                  action:'open' (default)
//     one business  → exactly as before, plus multiple_businesses:false
//     many          → { ok:true, multiple_businesses:true, businesses:[...] }
//                     and NOTHING is created or claimed — the UI shows a picker.
//
//   { action:'list_businesses', ghl_contact_id | phone }
//     → { ok:true, ghl_contact_id, multiple_businesses, businesses:[...] }
//     PURE READ: no CRM contact upsert, no GHL spend, no writes.
//
//   { action:'open_business', customer_id, lead_source? }
//     → resolve-or-create the deal for THAT business only.
//
//   { action:'add_business', ghl_contact_id | phone, business_name, lead_source? }
//     → new customers row copying the OWNER's person fields + a new deal.
//       Same owner + same normalized name RESUMES instead of duplicating.
//
//   businesses[] = { customer_id, business_name, deal_id, status, amount_requested,
//                    ghl_opportunity_id, created_at }, newest business first.
//                  amount_requested is masked to null for a setter who neither
//                  owns nor created the deal (the money wall, honored by hand
//                  because this runs as service_role).
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
  updateContactCustomFields, searchOpportunitiesByContact, createOpportunity,
} from "../_shared/ghl.ts";
import { UCC_OVERWRITABLE_OR_FILTER } from "../_shared/positionsSource.ts";
import {
  type UccLeadRow, UCC_ENRICH_COLS, last10, last10 as uccLast10, toUccLeadRow,
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

// The MCA pipeline every deal this function creates belongs to. Mirrors
// MCA_PIPELINE_ID in ghl-webhook (edge functions can't share consts across dirs
// without _shared, and this is the only pipeline this function ever touches).
const MCA_PIPELINE_ID = "bG9ZEh4eP9x60E1CyaMx";

// "New Lead" in the MCA pipeline — the stage a brand-new business's opportunity
// is born in. Mirrors STATUS_BY_STAGE_ID's "new" entry in ghl-webhook (same id,
// so a stage move round-trips) and the stage mca-intake / live-transfer-intake
// resolve by name.
const MCA_NEW_LEAD_STAGE_ID = "d60d563a-9904-423f-9a8e-0d0df0b12976";

// ── ONE OWNER, MANY BUSINESSES ───────────────────────────────────────────────
//
// A person can own several businesses and each one is its own merchant: its own
// revenue, its own stack, its own advance. Until now "open this contact" resolved
// exactly ONE deal per GHL contact, so business #2 was unreachable — the setter
// landed back on business #1 forever.
//
// THE OWNER KEY IS THE GHL CONTACT. One human = one GHL contact = one phone we
// dial. A BUSINESS is a `customers` row under that contact, identified by its
// normalized business_name. NOT by EIN — EIN is missing on ~98% of businesses, so
// keying on it would collapse almost every owner back to one business.
//
// customers has no unique constraint on ghl_contact_id (verified 2026-08-28:
// customers_pkey is the only unique constraint, and zero contacts currently share
// one), so many customers per contact needs no migration.
//
// SAFETY INVARIANT — EVERY BUSINESS OWNS ITS OWN GHL OPPORTUNITY. ghl-webhook's
// adoptOrphanDeal keys on (ghl_contact_id, deal_type, ghl_opportunity_id IS NULL):
// two NULL-opp MCA deals on one contact would let business A's opportunity be
// adopted onto business B's deal and cross-wire the two merchants. So a deal born
// for a second business is created ONLY after its own opportunity exists (see
// opportunityForBusiness), and an existing sibling deal gets its id backfilled
// first. GHL allows many opportunities per contact — that is exactly the shape we
// use: contact stays one, opportunities/deals are per business.

/** Entity suffixes that don't distinguish one business from another — "Acme
 * Trucking" and "Acme Trucking LLC" are the same merchant to a setter. */
const ENTITY_SUFFIXES = new Set([
  "llc", "inc", "incorporated", "corp", "corporation", "co", "company",
  "ltd", "limited", "lp", "llp", "pllc", "pc", "dba",
]);

/** Business identity: lowercased, punctuation-stripped, entity-suffix-trimmed.
 * "" means "no usable name" and NEVER matches another business.
 *
 * TWIN: src/lib/businessName.ts normBusinessName(). The browser decides "is this
 * a new business?" with that one and this decides add_business dedupe — they must
 * stay identical, or the same typed name resumes on one path and duplicates on
 * the other. Edge functions can't import from src/, hence the copy. */
function normBusiness(v: unknown): string {
  const s = String(v ?? "").toLowerCase()
    .replace(/\bl\.?\s*l\.?\s*c\b/g, "llc")   // L.L.C. / L L C -> llc
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "";
  const parts = s.split(" ");
  while (parts.length > 1 && ENTITY_SUFFIXES.has(parts[parts.length - 1])) parts.pop();
  return parts.join(" ");
}

/** One business under an owner, as the picker renders it. */
interface BusinessSummary {
  customer_id: string;
  business_name: string | null;
  deal_id: string | null;
  status: string | null;
  /** Money — present only when the caller may see it (see the money wall note
   * in loadBusinesses). null both when there is no deal and when it's masked. */
  amount_requested: number | null;
  ghl_opportunity_id: string | null;
  created_at: string;
}

interface OwnerCustomer {
  id: string; business_name: string | null; created_at: string;
  first_name: string | null; last_name: string | null;
  phone: string | null; email: string | null; source: string | null;
  additional_phones: string[] | null; additional_emails: string[] | null;
}

const OWNER_COLS =
  "id,business_name,created_at,first_name,last_name,phone,email,source,additional_phones,additional_emails";

/**
 * Every business under one owner, newest first, each with its current deal.
 *
 * The owner set is the UNION of two things, because either one alone misses real
 * businesses: customers carrying this ghl_contact_id, plus the customers behind
 * any deal on this contact (a deal can be linked to the contact while its
 * customer row's link was never backfilled). When there is no contact id at all
 * we fall back to the owner's PHONE, which is the identifier the dialer always
 * has.
 *
 * MONEY WALL. This runs as service_role, so RLS cannot mask anything for us —
 * 20260827_setter_deal_money_wall is a row/column rule on direct reads. We honor
 * the same rule by hand: a setter sees amount_requested only on a deal they own,
 * created, or that is unassigned (the claim pool). Ops staff see everything.
 */
async function loadBusinesses(
  db: SupabaseClient,
  contactId: string | null,
  phoneDigits: string | null,
  viewer: { id: string; isOps: boolean },
): Promise<BusinessSummary[]> {
  const byId = new Map<string, OwnerCustomer>();

  if (contactId) {
    const { data, error } = await db.from("customers").select(OWNER_COLS)
      .eq("ghl_contact_id", contactId).order("created_at", { ascending: false });
    if (error) throw new Error(`business lookup failed: ${error.message}`);
    for (const c of (data ?? []) as unknown as OwnerCustomer[]) byId.set(c.id, c);

    // Customers reachable only through a deal that carries the contact id.
    const { data: dealCusts, error: dcErr } = await db.from("deals")
      .select("customer_id").eq("ghl_contact_id", contactId).eq("deal_type", "mca")
      .not("customer_id", "is", null).limit(200);
    if (dcErr) throw new Error(`business lookup failed: ${dcErr.message}`);
    const missing = [...new Set((dealCusts ?? []).map((d) => d.customer_id as string))]
      .filter((id) => !byId.has(id));
    if (missing.length) {
      const { data: extra, error: exErr } = await db.from("customers").select(OWNER_COLS).in("id", missing);
      if (exErr) throw new Error(`business lookup failed: ${exErr.message}`);
      for (const c of (extra ?? []) as unknown as OwnerCustomer[]) byId.set(c.id, c);
    }
  } else if (phoneDigits) {
    const { data, error } = await db.from("customers").select(OWNER_COLS)
      .like("phone", `%${phoneDigits}`).order("created_at", { ascending: false }).limit(50);
    if (error) throw new Error(`business lookup failed: ${error.message}`);
    for (const c of (data ?? []) as unknown as OwnerCustomer[]) {
      if (last10(c.phone) === phoneDigits) byId.set(c.id, c);
    }
  }

  const owners = [...byId.values()].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  if (!owners.length) return [];

  // One query for every deal across every business; pick per business below.
  const { data: deals, error: dErr } = await db.from("deals")
    .select("id,customer_id,status,amount_requested,ghl_opportunity_id,assigned_closer_id,created_by,created_at")
    .in("customer_id", owners.map((o) => o.id))
    .eq("deal_type", "mca")
    .order("created_at", { ascending: false });
  if (dErr) throw new Error(`business deal lookup failed: ${dErr.message}`);

  type DealRow = {
    id: string; customer_id: string; status: string; amount_requested: number | null;
    ghl_opportunity_id: string | null; assigned_closer_id: string | null; created_by: string | null;
  };
  const rows = (deals ?? []) as unknown as DealRow[];

  return owners.map((o) => {
    const mine = rows.filter((d) => d.customer_id === o.id);
    // The OPEN deal is the one the setter works; fall back to the newest closed
    // one so a fully-funded business still shows in the picker with its status.
    const deal = mine.find((d) => !CLOSED_STATUSES.includes(d.status)) ?? mine[0] ?? null;
    const maySeeMoney = !deal ? false
      : viewer.isOps || deal.assigned_closer_id === null
        || deal.assigned_closer_id === viewer.id || deal.created_by === viewer.id;
    return {
      customer_id: o.id,
      business_name: o.business_name,
      deal_id: deal?.id ?? null,
      status: deal?.status ?? null,
      amount_requested: deal && maySeeMoney ? deal.amount_requested : null,
      ghl_opportunity_id: deal?.ghl_opportunity_id ?? null,
      created_at: o.created_at,
    };
  });
}

/**
 * The GHL opportunity a brand-new playbook deal belongs to, or null.
 *
 * WHY THIS EXISTS — duplicate deals. `deals.ghl_opportunity_id` is the ONLY
 * deal-level join key between us and GHL. A deal born here used to carry NULL
 * there, so it was invisible to the ghl-webhook stage mirror: the moment the
 * setter advanced the opportunity in GHL (often minutes later), the mirror found
 * no deal for that opportunity and minted a SECOND one — round-robin'd to a
 * different closer, splitting commission attribution off the deal the setter was
 * actually working. Stamping the opportunity id at birth closes that gap at the
 * source. (ghl-webhook's adopt path is the second half of the same fix.)
 *
 * STRICTLY CONSERVATIVE — every uncertain case returns null, which is exactly
 * today's behavior, so this can only ever remove a duplicate, never create a
 * mis-link:
 *   • only opportunities in the MCA pipeline count (a VCF opp is a different deal);
 *   • only GHL status "open" counts — a won/lost/abandoned opportunity is a past
 *     cycle, and wiring a fresh deal to it would mirror stale stage moves onto it;
 *   • more than one open MCA opportunity → genuinely ambiguous → null + log;
 *   • an opportunity ANOTHER deal already claims → null + log (two deals sharing
 *     one opportunity id would break the mirror's .maybeSingle() lookup and cause
 *     the very duplication this is here to prevent).
 *
 * Never throws and never blocks deal creation: a GHL outage degrades to null.
 */
async function resolveOpportunityId(db: SupabaseClient, contactId: string): Promise<string | null> {
  try {
    const cfg = await getGhlConfig(db);
    const res = await searchOpportunitiesByContact(cfg, contactId);
    if (!res.ok) {
      console.warn("[playbook-open-contact] opportunity lookup failed (deal will carry no opp id):",
        ghlErrorMessage(res.error), `HTTP ${res.status}`);
      return null;
    }
    const all = res.data?.opportunities ?? [];
    const mine = all.filter((o) => o?.id && o.pipelineId === MCA_PIPELINE_ID);
    const open = mine.filter((o) => String(o.status ?? "").toLowerCase() === "open");
    if (open.length === 0) {
      console.log("[playbook-open-contact] no open MCA opportunity for contact", contactId,
        `(${mine.length} in pipeline, ${all.length} total)`);
      return null;
    }
    if (open.length > 1) {
      console.warn("[playbook-open-contact] ambiguous — contact", contactId,
        "has", open.length, "open MCA opportunities; leaving ghl_opportunity_id NULL:",
        open.map((o) => o.id).join(", "));
      return null;
    }
    const oppId = open[0].id;

    // Never hand the same opportunity to two deals.
    const { data: claimed, error: claimErr } = await db
      .from("deals").select("id, deal_number").eq("ghl_opportunity_id", oppId).limit(1);
    if (claimErr) {
      console.warn("[playbook-open-contact] opp-claim check failed; leaving NULL:", claimErr.message);
      return null;
    }
    if (claimed && claimed.length > 0) {
      console.warn("[playbook-open-contact] opportunity", oppId, "is already on deal",
        (claimed[0] as { deal_number: string | null }).deal_number, "— leaving ghl_opportunity_id NULL");
      return null;
    }
    return oppId;
  } catch (e) {
    console.warn("[playbook-open-contact] opportunity lookup threw (deal will carry no opp id):",
      e instanceof Error ? e.message : String(e));
    return null;
  }
}

/**
 * The opportunity a SPECIFIC business's deal must own — matched by name, or
 * created. Used ONLY when the owner has more than one business; a single-business
 * contact keeps taking resolveOpportunityId's strictly-conservative path above,
 * unchanged.
 *
 * WHY IT MAY CREATE. With two businesses on one contact, resolveOpportunityId
 * refuses to pick (two open MCA opportunities is genuinely ambiguous) and returns
 * null — which is precisely the NULL-opp state adoptOrphanDeal can cross-wire. So
 * here the business's own NAME breaks the tie, and when nothing matches we mint
 * the opportunity that business is missing rather than leave the hole open.
 *
 * UNREADABLE IS NOT EMPTY. If GHL can't be read, or the "is this opportunity
 * already on a deal" check fails, this returns an ERROR — never a "create". A
 * failed read that fell through to create would mint a duplicate opportunity on
 * every retry. Those errors are `degradable:false` — the caller must abort.
 *
 * A failed CREATE is `degradable:true`: the read was good, we know no opportunity
 * matches this business, and the caller may proceed with a deal that carries no
 * opportunity id. THAT IS THE NORMAL CASE ON THIS LOCATION TODAY —
 * `settings.allowDuplicateOpportunity` is FALSE (verified live 2026-08-28), so
 * GHL answers a second opportunity on one contact with "Can not create duplicate
 * opportunity for the contact". Until the owner turns that on, a second business
 * simply has no opportunity of its own, and ghl-webhook's adopt path is what keeps
 * that safe: with several unlinked deals on a contact it matches by business name
 * and adopts NOTHING when the name doesn't settle it.
 */
async function opportunityForBusiness(
  db: SupabaseClient, contactId: string, businessName: string | null, ownerName: string | null,
): Promise<{ id: string } | { error: string; degradable: boolean }> {
  let all: { id: string; name?: string }[];
  try {
    const cfg = await getGhlConfig(db);
    const res = await searchOpportunitiesByContact(cfg, contactId);
    if (!res.ok) {
      return { error: `couldn't read this contact's opportunities from the CRM: ${ghlErrorMessage(res.error)} (HTTP ${res.status})`, degradable: false };
    }
    all = (res.data?.opportunities ?? [])
      .filter((o) => o?.id && o.pipelineId === MCA_PIPELINE_ID
        && String(o.status ?? "").toLowerCase() === "open")
      .map((o) => ({ id: o.id, name: o.name }));
  } catch (e) {
    return { error: `couldn't read this contact's opportunities from the CRM: ${e instanceof Error ? e.message : String(e)}`, degradable: false };
  }

  // Never hand an opportunity another deal already owns.
  let unclaimed = all;
  if (all.length) {
    const { data: taken, error } = await db.from("deals")
      .select("ghl_opportunity_id").in("ghl_opportunity_id", all.map((o) => o.id));
    if (error) return { error: `couldn't check which opportunities are already on a deal: ${error.message}`, degradable: false };
    const claimed = new Set((taken ?? []).map((d) => d.ghl_opportunity_id as string));
    unclaimed = all.filter((o) => !claimed.has(o.id));
  }

  const want = normBusiness(businessName);
  if (want) {
    const hits = unclaimed.filter((o) => normBusiness(o.name) === want);
    if (hits.length === 1) return { id: hits[0].id };
  }

  // Nothing matches this business — give it its own opportunity.
  const name = str(businessName) ?? str(ownerName) ?? "New business";
  try {
    const cfg = await getGhlConfig(db);
    const created = await createOpportunity(cfg, {
      pipelineId: MCA_PIPELINE_ID,
      pipelineStageId: MCA_NEW_LEAD_STAGE_ID,
      contactId,
      name,
      status: "open",
    });
    if (!created.ok) {
      return { error: `couldn't create the CRM opportunity for "${name}": ${ghlErrorMessage(created.error)}`, degradable: true };
    }
    const id = created.data?.opportunity?.id;
    if (!id) return { error: `the CRM didn't return an opportunity id for "${name}"`, degradable: true };
    console.log("[playbook-open-contact] created opportunity", id, "for business", JSON.stringify(name), "on contact", contactId);
    return { id };
  } catch (e) {
    return { error: `couldn't create the CRM opportunity for "${name}": ${e instanceof Error ? e.message : String(e)}`, degradable: true };
  }
}

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


// ── Lead Machine enrichment ──────────────────────────────────────────────────
//
// Everything the purchased file paid for, carried onto the merchant at OPEN.
// The audit found four columns that never left Supabase (revenue,
// sic_description, employees, title) plus the whole address block, so a deal
// opened from an aged/UCC lead arrived blank and 04B sends were blocked on
// industry_doc / avg_monthly_revenue_doc. Mapping here costs ZERO GHL calls and
// covers every contact already pushed, which is why it runs at open rather than
// waiting for a push wave.
const LEAD_ENRICH_COLS =
  "first_name,last_name,company,email,phone,address,city,state,zip,revenue,"
  + "sic_code,sic_description,employees,title,secured_party,secured_party_canonical,filing_date,"
  + "lead_type,entity_type,web_domain,push_tags";

interface LeadEnrich {
  first_name: string | null; last_name: string | null; company: string | null;
  email: string | null; phone: string | null;
  address: string | null; city: string | null; state: string | null; zip: string | null;
  revenue: number | null; sic_code: string | null; sic_description: string | null;
  employees: number | null; title: string | null;
  secured_party: string | null; secured_party_canonical: string | null; filing_date: string | null;
  lead_type: string | null; entity_type: string | null; web_domain: string | null;
  push_tags: string[] | null;
}

/**
 * REVENUE IS NOT ONE NUMBER. The trigger file ships "Monthly Revenue"; the UCC
 * file ships "REVENUE" with values from 46,241 to 12,000,000 — annual, plainly.
 * Writing an annual figure into monthly_revenue would understate a merchant's
 * capacity by 12x on the very field underwriting reads. So the number lands in
 * the column its FILE means, and a monthly figure is only ever derived by an
 * explicit division that says so.
 */
function revenueFields(lead: LeadEnrich): Record<string, unknown> {
  if (lead.revenue == null) return {};
  // THE VENDOR SHIPS REVENUE AS TEXT RANGES AND OUR PARSER FABRICATED NUMBERS
  // FROM THEM. Verified against raw on 2026-08-15:
  //     "$1 TO 2.5 MILLION"    -> 12.5        (6,481 rows)
  //     "$2.5 TO 5 MILLION"    -> 2.55        (2,004)
  //     "$5 TO 10 MILLION"     -> 510         (1,076)
  //     "LESS THAN $500,000"   -> 500000      (24,487)
  //     "$500,000 TO $1 MILLION" -> 5000001   (9,242)
  //     "OVER $1 BILLION"      -> 1           (6)
  // Those are not units to convert, they are digits concatenated out of a
  // sentence. A figure like 5000001 is not five million dollars, it is the "1"
  // of "$1 MILLION" glued to "500,000" — and writing it to annual_revenue would
  // put a fictional number on an underwriting screen.
  //
  // So: only pass through a value that can be a REAL annual figure. The known
  // artifacts are excluded outright and anything under $1,000/yr is refused —
  // no business we fund grosses less than that, so such a value is evidence of a
  // parse, not of a small merchant. Blank beats invented.
  const v = Number(lead.revenue);
  const ARTIFACTS = new Set([12.5, 2.55, 510, 5000001, 1]);
  if (!Number.isFinite(v) || v < 1000 || ARTIFACTS.has(v)) return {};
  return lead.lead_type === "trigger"
    ? { monthly_revenue: v, annual_revenue: Math.round(v * 12) }
    : { annual_revenue: v, monthly_revenue: Math.round(v / 12) };
}

/** customers.source from the list the lead came off — it was hardcoded 'other',
 * which erased the one fact every purchased lead definitely has. */
function sourceFor(lead: LeadEnrich | null): string {
  switch (lead?.lead_type) {
    case "ucc": return "ucc_list";
    case "aged": return "aged_list";
    case "trigger": return "trigger_list";
    default: return "other";
  }
}

/** The merchant's LEAD TYPE — aged / ucc / trigger — for opening-script routing.
 * Derived from the GHL contact's dial tags (lm-aged/lm-ucc/lm-trigger) first,
 * then the Lead Machine row's own lead_type. A UCC signal that lives on the
 * ph_ucc lead (not this row) is added by the caller (see derivedLeadType). */
type LeadType = "aged" | "ucc" | "trigger";
function leadTypeFor(lead: LeadEnrich | null, tags: string[]): LeadType | null {
  const t = tags.map((x) => x.toLowerCase());
  if (lead?.lead_type === "ucc" || t.includes("lm-ucc")) return "ucc";
  if (lead?.lead_type === "aged" || t.includes("lm-aged")) return "aged";
  if (lead?.lead_type === "trigger" || t.includes("lm-trigger")) return "trigger";
  return null;
}

// The deal's lead_source encodes the lead type as `<type>_list` — the value the
// Revenue Playbook reads to auto-pick the opening script. Built at the call sites
// via derivedLeadType() (which also folds in the ph_ucc UCC signal); defaulting
// every open to 'ph_setter' routed aged/UCC/trigger merchants onto the wrong one.

/** Placeholder lead_source values that are NOT a chosen attribution — safe to
 * backfill with the merchant's real lead type on resume. Anything else is a value
 * a human/pipeline meaningfully set and is never overwritten (mirrors the
 * 'other'/'Merchant' placeholder rule used elsewhere in this function). */
const PLACEHOLDER_LEAD_SOURCES = new Set(["ph_setter", "other", "unknown"]);

/** Everything from the lead that belongs on the customer row. */
function customerFieldsFrom(lead: LeadEnrich): Record<string, unknown> {
  const out: Record<string, unknown> = {
    address_street: str(lead.address),
    address_city: str(lead.city),
    address_state: str(lead.state),
    address_zip: str(lead.zip),
    industry: str(lead.sic_description),
    sic_code: str(lead.sic_code),
    // The same file ships employee counts up to 99,997,704 against a median of
    // 14 — another mis-parse, not a merchant with 100 million staff. Refuse the
    // obviously impossible rather than put it on a contact record.
    employees: lead.employees != null && lead.employees > 0 && lead.employees <= 10000
      ? lead.employees : null,
    owner_title: str(lead.title),
    entity_type: str(lead.entity_type),
    website: lead.web_domain ? `https://${lead.web_domain}` : null,
    ...revenueFields(lead),
  };
  for (const k of Object.keys(out)) if (out[k] === null) delete out[k];
  return out;
}

/**
 * Fill a customer's EMPTY columns from the Lead Machine row. #2/#3 in the audit:
 * backfillCustomerAddress only ever read ph_ucc_leads, so a merchant whose data
 * came off a purchased list resumed with a blank address and no industry or
 * revenue — the exact fields 04B requires. Gaps only: a value a human typed is
 * never touched, and only columns that are currently NULL are written.
 */
async function backfillCustomerFromLead(
  db: SupabaseClient, customerId: string, lead: LeadEnrich | null,
): Promise<string[]> {
  if (!lead) return [];
  try {
    const fields = customerFieldsFrom(lead);
    if (!Object.keys(fields).length) return [];
    const { data: cur } = await db.from("customers")
      .select("address_street,address_city,address_state,address_zip,industry,sic_code,"
        + "employees,owner_title,entity_type,website,monthly_revenue,annual_revenue,source")
      .eq("id", customerId).maybeSingle();
    if (!cur) return [];
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      const existing = (cur as unknown as Record<string, unknown>)[k];
      if (existing === null || existing === undefined || existing === "") patch[k] = v;
    }
    // 'other' is the old hardcoded placeholder, not a value someone chose — the
    // same lesson as first_name 'Merchant'. Treat it as a gap.
    const curSource = (cur as unknown as Record<string, unknown>).source;
    if (!curSource || curSource === "other") {
      const s2 = sourceFor(lead);
      if (s2 !== "other") patch.source = s2;
    }
    if (!Object.keys(patch).length) return [];
    const { error } = await db.from("customers").update(patch).eq("id", customerId);
    if (error) {
      console.error("[playbook-open-contact] lead backfill failed:", error.message);
      return [];
    }
    return Object.keys(patch);
  } catch (e) {
    console.error("[playbook-open-contact] lead backfill threw:", e instanceof Error ? e.message : String(e));
    return [];
  }
}

/**
 * #7 UCC LIEN INTEL from the LEAD MACHINE book.
 *
 * The purchased UCC file carries a secured party and a filing date per lead, and
 * none of it reached the deal — so a Lead Machine UCC merchant opened with an
 * empty Current Funders panel while a ph_ucc-harvested one (ACCULINE) showed its
 * positions. Same intelligence, different table.
 *
 * ONE FILING IS A FLOOR, NOT A COUNT. The harvester derives real stack depth
 * from every filing it can see; this file gives us exactly one row per lead, so
 * "1" means "at least one, and this is who". That distinction is carried in
 * existing_positions_source — 'lead_machine_ucc', never plain 'ucc' — so nobody
 * reads a floor as a census, and it still sorts under the harvester's rank-1
 * value, which the UCC_OVERWRITABLE_OR_FILTER guard already refuses to clobber
 * with anything richer.
 */
function leadMachinePositionsPatch(lead: LeadEnrich | null): Record<string, unknown> | null {
  if (!lead) return null;
  const funder = str(lead.secured_party_canonical) ?? str(lead.secured_party);
  if (!funder && !lead.filing_date) return null;
  return {
    existing_positions: funder ? 1 : null,
    existing_funders: funder ? [funder] : null,
    existing_positions_detail: funder
      ? [{ funder, filing_date: lead.filing_date ?? null, source: "lead_machine_ucc" }]
      : [],
    existing_positions_source: "lead_machine_ucc",
    existing_positions_synced_at: new Date().toISOString(),
  };
}

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


// ── Carry a lead's extra contact points onto the customer ────────────────────
//
// The Revenue Playbook reads additional emails/cells from customers.additional_emails
// / additional_phones — NOT from GHL (GHL's upsert rejects additionalEmails
// outright). So this is where list-supplied extras and setter-typed extras have
// to meet, or they live in two parallel stores and the setter sees only half.
//
// MERGE, NEVER OVERWRITE. Values are only ever APPENDED, and only when absent:
// existing entries are never deleted and never reordered, so a value a setter
// typed always survives, and it stays where they expect it in the list. The
// lead's PRIMARY phone/email is a candidate too — the number on the list is
// frequently not the one the customer row already carries.
//
// Comparison is normalized (phones to last-10, emails lowercased) so the same
// number stored in two formats doesn't get appended as a "new" one. Values are
// APPENDED in normalized form, matching how lead_records stores them.
//
// Best-effort: enrichment must never break a setter opening a deal mid-call.
async function mergeCustomerExtras(
  db: SupabaseClient, customerId: string, contactId: string,
): Promise<{ phones_added: number; emails_added: number } | null> {
  try {
    // #10 PHONE FALLBACK. Keying only on ghl_contact_id missed every lead whose
    // contact id we never recorded — a merchant pushed under one contact and
    // later opened by phone has extras in lead_records that this would never
    // find. The phone is the identifier that survives both paths.
    let { data: lead } = await db.from("lead_records")
      .select("phone,email,first_name,last_name,company,extra_phones,extra_emails")
      .eq("ghl_contact_id", contactId)
      .order("pushed_at", { ascending: false }).limit(1).maybeSingle();
    if (!lead) {
      const { data: cust0 } = await db.from("customers")
        .select("phone").eq("id", customerId).maybeSingle();
      const digits = uccLast10(str(cust0?.phone));
      if (digits) {
        const { data: byPhone } = await db.from("lead_records")
          .select("phone,email,first_name,last_name,company,extra_phones,extra_emails")
          .like("phone", `%${digits}`)
          .order("pushed_at", { ascending: false, nullsFirst: false }).limit(5);
        lead = (byPhone ?? []).find((r) => uccLast10(str(r.phone)) === digits) ?? null;
      }
    }
    if (!lead) return null;

    const { data: cust } = await db.from("customers")
      .select("phone,email,first_name,last_name,business_name,additional_phones,additional_emails")
      .eq("id", customerId).maybeSingle();
    if (!cust) return null;

    const last10 = (v: unknown): string | null => {
      const d = String(v ?? "").replace(/\D+/g, "");
      const t = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
      return t.length === 10 ? t : null;
    };
    const lower = (v: unknown): string | null => {
      const e = String(v ?? "").trim().toLowerCase();
      return e.includes("@") ? e : null;
    };

    // Existing entries define what is already "known" — including the customer's
    // OWN primary, so we never duplicate it into the additional list.
    const existingPhones = (cust.additional_phones as string[] | null) ?? [];
    const knownPhones = new Set(
      [cust.phone, ...existingPhones].map(last10).filter(Boolean) as string[],
    );
    const existingEmails = (cust.additional_emails as string[] | null) ?? [];
    const knownEmails = new Set(
      [cust.email, ...existingEmails].map(lower).filter(Boolean) as string[],
    );

    const leadExtraPhones = ((lead.extra_phones as { phone?: string }[] | null) ?? [])
      .map((p) => p?.phone);
    const addPhones: string[] = [];
    for (const cand of [lead.phone, ...leadExtraPhones]) {
      const n = last10(cand);
      if (n && !knownPhones.has(n)) { knownPhones.add(n); addPhones.push(n); }
    }
    const leadExtraEmails = ((lead.extra_emails as string[] | null) ?? []);
    const addEmails: string[] = [];
    for (const cand of [lead.email, ...leadExtraEmails]) {
      const n = lower(cand);
      if (n && !knownEmails.has(n)) { knownEmails.add(n); addEmails.push(n); }
    }
    // FILL AN EMPTY PRIMARY — append is for CONFLICTS, not for gaps.
    // "Merge, never overwrite" was the right rule and it was applied too
    // broadly: a customer whose primary email was EMPTY got the lead's address
    // appended to additional_emails, so the merchant had an email on file and
    // the app still said "add an email so you can send the application". An
    // empty slot is not a value worth protecting. A slot a human filled is, and
    // that is still never touched.
    const fill: Record<string, unknown> = {};
    if (!str(cust.email) && lower(lead.email)) fill.email = lower(lead.email);
    if (!str(cust.phone) && last10(lead.phone)) fill.phone = `+1${last10(lead.phone)}`;
    // Names/business too: the same gap left customers reading "Merchant".
    if (!str(cust.first_name) || str(cust.first_name) === "Merchant") {
      if (str(lead.first_name)) fill.first_name = str(lead.first_name);
    }
    if (!str(cust.last_name) && str(lead.last_name)) fill.last_name = str(lead.last_name);
    if (!str(cust.business_name) && str(lead.company)) fill.business_name = str(lead.company);

    if (!addPhones.length && !addEmails.length && !Object.keys(fill).length) {
      return { phones_added: 0, emails_added: 0 };
    }

    // Append only — existing array order is preserved exactly. One exception:
    // a value PROMOTED to the primary slot is removed from the additional list,
    // or the merchant ends up carrying the same address twice.
    const patch: Record<string, unknown> = { ...fill };
    const promotedEmail = fill.email ? String(fill.email) : null;
    const promotedPhone = fill.phone ? last10(fill.phone) : null;
    const nextPhones = [...existingPhones, ...addPhones].filter((p) => !promotedPhone || last10(p) !== promotedPhone);
    const nextEmails = [...existingEmails, ...addEmails].filter((e) => !promotedEmail || lower(e) !== promotedEmail);
    if (addPhones.length || (promotedPhone && nextPhones.length !== existingPhones.length + addPhones.length)) {
      patch.additional_phones = nextPhones;
    }
    if (addEmails.length || (promotedEmail && nextEmails.length !== existingEmails.length + addEmails.length)) {
      patch.additional_emails = nextEmails;
    }
    const { error } = await db.from("customers").update(patch).eq("id", customerId);
    if (error) {
      console.error("[playbook-open-contact] customer extras merge failed:", error.message);
      return null;
    }
    return { phones_added: addPhones.length, emails_added: addEmails.length };
  } catch (e) {
    console.error("[playbook-open-contact] customer extras merge threw:", e instanceof Error ? e.message : String(e));
    return null;
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

    const isOps = role === "admin" || role === "super_admin";
    const viewer = { id: caller.id, isOps };

    const body = await req.json().catch(() => ({}));
    let ghlContactId = str(body?.ghl_contact_id ?? body?.contactId ?? body?.contact);
    const rawPhone = str(body?.phone);
    // #5 SCRIPT ROUTING. This defaulted to "ph_setter" for EVERY open, so an
    // aged/UCC/trigger merchant landed on the PH setter script. The caller still
    // wins when it says so; otherwise the lead's own type decides, and
    // "ph_setter" is the fallback rather than the answer.
    const leadSourceOverride = str(body?.lead_source);

    // ── ACTION (multi-business). Absent/"open" is the original contract and the
    // original behavior; the three named actions are additive.
    const action = (str(body?.action) ?? "open").toLowerCase();
    if (!["open", "list_businesses", "open_business", "add_business"].includes(action)) {
      return json({ ok: false, error: `Unknown action "${action}".` }, 400);
    }
    // The business the caller wants (open_business), and the name of the one they
    // want created (add_business).
    const bodyCustomerId = str(body?.customer_id);
    const newBusinessName = str(body?.business_name);
    if (action === "open_business" && !bodyCustomerId) {
      return json({ ok: false, error: "customer_id is required for open_business" }, 400);
    }
    if (action === "add_business" && !newBusinessName) {
      return json({ ok: false, error: "business_name is required for add_business" }, 400);
    }

    // open_business identifies the merchant by their customers row, so the
    // contact/phone pair is optional there — it's recovered from the row below.
    if (!ghlContactId && !rawPhone && action !== "open_business") {
      return json({ ok: false, error: "ghl_contact_id or phone is required" }, 400);
    }

    // ── action:'list_businesses' — a PURE READ. Answered before anything can
    // write, so rendering the picker never upserts a CRM contact or spends a GHL
    // call. An unknown owner returns an empty list, not an error.
    if (action === "list_businesses") {
      const digits = ghlContactId ? null : last10(rawPhone);
      if (!ghlContactId && !digits) {
        return json({ ok: false, error: `"${rawPhone}" isn't a usable 10-digit phone number.` }, 400);
      }
      let ownerContactId = ghlContactId;
      let businesses: BusinessSummary[];
      try {
        businesses = await loadBusinesses(db, ownerContactId, digits, viewer);
        // Phone-only: the owner's contact id, if any of their rows carries one.
        if (!ownerContactId && businesses.length) {
          const { data: linked } = await db.from("customers")
            .select("ghl_contact_id").in("id", businesses.map((b) => b.customer_id))
            .not("ghl_contact_id", "is", null).limit(1).maybeSingle();
          ownerContactId = str(linked?.ghl_contact_id);
        }
      } catch (e) {
        return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
      }
      return json({
        ok: true,
        ghl_contact_id: ownerContactId,
        multiple_businesses: businesses.length > 1,
        businesses,
      });
    }

    // open_business: recover the owner's contact from the chosen business.
    let forcedCustomer: OwnerCustomer | null = null;
    if (action === "open_business") {
      const { data: c, error: cErr } = await db.from("customers")
        .select(`${OWNER_COLS},ghl_contact_id`).eq("id", bodyCustomerId!).maybeSingle();
      if (cErr) return json({ ok: false, error: `customer lookup failed: ${cErr.message}` }, 500);
      if (!c) return json({ ok: false, error: "That business no longer exists." }, 404);
      forcedCustomer = c as unknown as OwnerCustomer;
      ghlContactId = str((c as Record<string, unknown>).ghl_contact_id) ?? ghlContactId;
      // A business with no CRM contact yet: the phone path below upserts one, the
      // same way the by-phone deep link does.
      if (!ghlContactId && !rawPhone && !str(forcedCustomer.phone)) {
        return json({ ok: false, error: "That business has no CRM contact and no phone to create one from." }, 400);
      }
    }
    // The number the phone path works from — the caller's, or (open_business with
    // an unlinked business) the business's own.
    const phoneForPath = rawPhone ?? (action === "open_business" ? str(forcedCustomer?.phone) : null);

    // ── 0) PHONE PATH: number → ph_ucc_leads identity → upserted GHL contact. ─
    // Everything downstream is then identical to the contact-id path.
    let seed: Identity | null = null;   // identity we already know — skips getContact
    let uccLeadId: string | null = null;
    let matchedUcc = false;
    // The backing UCC lead (address + existing positions). Set on the phone path
    // here; recovered by ghl_contact_id on the deep-link path further down.
    let uccLead: UccLeadRow | null = null;
    // The Lead Machine row behind this contact — the purchased data the audit
    // found was being dropped on the floor. Set on the phone path, recovered by
    // ghl_contact_id on the deep-link path so BOTH entries enrich identically.
    let leadRow: LeadEnrich | null = null;

    // open_business on a business that has no CRM contact yet: upsert one from
    // THAT BUSINESS's own identity. Deliberately NOT the ph_ucc phone path below —
    // that path seeds the company name from whatever lead the number matches,
    // which for a second business would push business #1's name onto the contact.
    if (!ghlContactId && action === "open_business" && forcedCustomer) {
      const digits = last10(phoneForPath);
      if (!digits) return json({ ok: false, error: "That business has no usable phone number to create a CRM contact from." }, 400);
      try {
        const cfg = await getGhlConfig(db);
        const up = await upsertContact(cfg, {
          ...(str(forcedCustomer.first_name) ? { firstName: str(forcedCustomer.first_name) } : {}),
          lastName: str(forcedCustomer.last_name),
          companyName: str(forcedCustomer.business_name),
          email: str(forcedCustomer.email),
          phone: `+1${digits}`,
        });
        if (!up.ok) return json({ ok: false, error: `Couldn't create the contact in the CRM: ${ghlErrorMessage(up.error)}` }, 502);
        ghlContactId = str(up.data?.contact?.id);
      } catch (e) {
        return json({ ok: false, error: `Couldn't create the contact in the CRM: ${e instanceof Error ? e.message : String(e)}` }, 502);
      }
      if (!ghlContactId) return json({ ok: false, error: "The CRM didn't return a contact id for that business." }, 502);
      const { error: linkErr } = await db.from("customers")
        .update({ ghl_contact_id: ghlContactId }).eq("id", forcedCustomer.id);
      if (linkErr) console.error("[playbook-open-contact] customer ghl link backfill failed:", linkErr.message);
    }

    if (!ghlContactId) {
      const digits = last10(phoneForPath);
      if (!digits) return json({ ok: false, error: `"${phoneForPath}" isn't a usable 10-digit phone number.` }, 400);

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
        // NOT a UCC lead — try the Lead Machine book, which is where the aged /
        // purchased lists live. This lookup was missing, and its absence is what
        // renamed a real merchant to "Merchant" in the CRM: with no identity the
        // upsert below sent the placeholder as firstName, and GHL's upsert
        // happily overwrote "Leonor" with it. Every setter opening an aged
        // contact by phone was corrupting that contact's name.
        const { data: lr, error: lrErr } = await db
          .from("lead_records")
          .select(LEAD_ENRICH_COLS)
          .like("phone", `%${digits}`)
          .order("pushed_at", { ascending: false, nullsFirst: false })
          .limit(5);
        if (lrErr) console.error("[playbook-open-contact] lead_records lookup failed:", lrErr.message);
        const lmRows = (lr ?? []) as unknown as LeadEnrich[];
        const lm = lmRows.find((r) => last10(str(r.phone)) === digits) ?? null;
        if (lm) leadRow = lm;
        seed = lm
          ? {
            first: str(lm.first_name),
            last: str(lm.last_name),
            business: str(lm.company),
            email: str(lm.email),
            phone: `+1${digits}`,
          }
          : { first: null, last: null, business: null, email: null, phone: `+1${digits}` };
      }

      // UPSERT (never blind-create) so GHL dedupes on the phone/email and we
      // respect one-contact-per-merchant.
      try {
        const cfg = await getGhlConfig(db);
        // ONLY SEND WHAT WE ACTUALLY KNOW. GHL's upsert overwrites every field
        // it receives, so a placeholder is not a harmless default — sending
        // firstName:"Merchant" for an unknown lead REPLACED a real merchant's
        // first name in the CRM (verified live: "Leonor" -> "Merchant"). An
        // absent field leaves whatever the contact already carries intact, which
        // is always the safer answer when we are guessing.
        const up = await upsertContact(cfg, {
          ...(seed.first ? { firstName: seed.first } : {}),
          lastName: seed.last,
          companyName: seed.business,
          email: seed.email,
          phone: seed.phone,
          address1: lead ? str(lead.debtor_address) : null,
          city: lead ? str(lead.debtor_city) : null,
          state: lead ? str(lead.debtor_state) : null,
          postalCode: lead ? str(lead.debtor_zip) : null,
          // #4 SOURCE OVERWRITE. GHL's upsert replaces every field it receives,
          // so sending a source here stamped "ph_setter" over the
          // "Lead Machine <BATCH>" provenance that the push had written. A
          // contact we can match to a lead row already HAS its true source;
          // only a genuinely unknown number gets one from us.
          ...(leadRow ? {} : { source: leadSourceOverride ?? "ph_setter" }),
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
    if (!leadRow) {
      const { data: lrByContact } = await db
        .from("lead_records").select(LEAD_ENRICH_COLS)
        .eq("ghl_contact_id", contactId)
        .order("pushed_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
      if (lrByContact) leadRow = lrByContact as unknown as LeadEnrich;
    }
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

    // The GHL contact's tags — how a dial campaign claims this merchant. Declared
    // up here because the EXISTING-DEAL path returns before the contact is ever
    // re-read, so it stays empty there and attributeCampaign() falls back to what
    // we pushed for this contact. (add_business may fill it early, when it has to
    // read the owner's identity off the CRM.)
    let contactTags: string[] = [];

    // ── THE OWNER'S BUSINESS SET ─────────────────────────────────────────────
    // One read, used by every action. On the plain-open path a count of 0 or 1 is
    // the world as it was before this feature existed, and the code below takes
    // exactly the same branches it always did.
    let businesses: BusinessSummary[];
    try {
      businesses = await loadBusinesses(db, contactId, null, viewer);
    } catch (e) {
      // Unreadable is NOT "one business". Failing open here would resolve a
      // multi-business owner down to business #1 — the exact bug this fixes.
      return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
    }
    const multiBusiness = businesses.length > 1;

    // ── action:'open' with MORE THAN ONE business → hand the UI the picker. ──
    // No auto-pick: choosing for the setter is how business #2 became invisible.
    // Nothing is created and nothing is claimed on this path.
    if (action === "open" && multiBusiness) {
      return json({
        ok: true,
        multiple_businesses: true,
        ghl_contact_id: contactId,
        matched_ucc: matchedUcc,
        businesses,
      });
    }

    // The business this request is scoped to (open_business, or add_business once
    // it has resolved/created its customers row). Null = the owner-wide behavior
    // this function has always had.
    let scopedCustomerId: string | null = action === "open_business" ? bodyCustomerId : null;
    // Its NAME — how its own GHL opportunity gets matched, or minted.
    let scopedBusinessName: string | null = action === "add_business"
      ? newBusinessName
      : str(forcedCustomer?.business_name);
    // An opportunity minted for a brand-new business, to be stamped on its deal.
    let pendingOppId: string | null = null;
    // Set when the business was added but the CRM would not give it its own
    // opportunity — surfaced on the response so this is never silent.
    let oppWarning: string | null = null;
    // Skip UCC/lead backfills onto a customer we just created for a SECOND
    // business — that intel belongs to the business the lead was harvested for.
    let freshBusiness = false;

    // ── action:'add_business' ────────────────────────────────────────────────
    if (action === "add_business") {
      const want = normBusiness(newBusinessName);
      // SAME OWNER + SAME NAME = RESUME. Only a real name can match: an owner
      // whose existing row has no business_name never blocks a named one.
      const dupe = want ? businesses.find((b) => normBusiness(b.business_name) === want) : undefined;
      if (dupe) {
        scopedCustomerId = dupe.customer_id;
      } else {
        // The person fields the new business inherits — the owner's newest row.
        const owner = businesses.length
          ? await (async (): Promise<OwnerCustomer | null> => {
            const { data } = await db.from("customers").select(OWNER_COLS)
              .eq("id", businesses[0].customer_id).maybeSingle();
            return (data as unknown as OwnerCustomer) ?? null;
          })()
          : null;

        // Identity for an owner we have no customers row for at all — read it off
        // the CRM contact rather than minting a nameless merchant.
        let ownerFirst = str(owner?.first_name), ownerLast = str(owner?.last_name);
        let ownerEmail = str(owner?.email), ownerPhone = str(owner?.phone);
        if (!owner) {
          if (seed) {
            ownerFirst = seed.first; ownerLast = seed.last;
            ownerEmail = seed.email; ownerPhone = seed.phone;
          } else {
            try {
              const cfg = await getGhlConfig(db);
              const got = await getContact(cfg, contactId);
              if (!got.ok) throw new Error(`${ghlErrorMessage(got.error)} (HTTP ${got.status})`);
              const c = (got.data?.contact ?? {}) as Record<string, unknown>;
              ownerFirst = str(c.firstName) ?? (str(c.contactName)?.split(/\s+/)[0] ?? null);
              ownerLast = str(c.lastName);
              ownerEmail = str(c.email);
              ownerPhone = str(c.phone);
              if (Array.isArray(c.tags)) contactTags = (c.tags as unknown[]).map((t) => String(t));
            } catch (e) {
              return json({ ok: false, error: `Couldn't load the owner from the CRM: ${e instanceof Error ? e.message : String(e)}` }, 502);
            }
          }
        }

        // SAFETY, STEP 1 — give every EXISTING sibling deal its opportunity id
        // BEFORE a second one exists. Once the contact carries two open MCA
        // opportunities, resolveOpportunityId is (correctly) ambiguous and can
        // never fill that hole again, and a NULL-opp deal is what adoptOrphanDeal
        // cross-wires.
        for (const b of businesses) {
          if (!b.deal_id || b.ghl_opportunity_id) continue;
          const oppId = await resolveOpportunityId(db, contactId);
          if (!oppId) break;
          const { error } = await db.from("deals").update({ ghl_opportunity_id: oppId })
            .eq("id", b.deal_id).is("ghl_opportunity_id", null);
          if (error) console.error("[playbook-open-contact] sibling opp backfill failed:", error.message);
          else console.log("[playbook-open-contact] pre-linked sibling deal", b.deal_id, "to opportunity", oppId);
        }

        // SAFETY, STEP 2 — the new business's OWN opportunity, BEFORE its deal.
        // Ordered this way on purpose: if the CRM can't give us one, we create
        // nothing at all rather than leave a second NULL-opp deal on the contact.
        const opp = await opportunityForBusiness(
          db, contactId, newBusinessName,
          [ownerFirst, ownerLast].filter(Boolean).join(" ") || null,
        );
        if ("error" in opp) {
          // Couldn't even READ the CRM: stop. Guessing here would either duplicate
          // an opportunity that already exists or create a business blind.
          if (!opp.degradable) return json({ ok: false, error: `Couldn't add that business: ${opp.error}` }, 502);
          // Read was good, the CREATE is what failed — on this location that is
          // routine (allowDuplicateOpportunity is off). Go ahead with a deal that
          // carries no opportunity id: ghl-webhook's adopt path now matches by
          // business name across several unlinked deals and adopts nothing when
          // the name doesn't settle it, so this can no longer cross-wire.
          oppWarning = opp.error;
          console.warn("[playbook-open-contact] add_business proceeding without an opportunity:", opp.error);
        } else {
          pendingOppId = opp.id;
        }

        const { data: created, error: cErr } = await db.from("customers").insert({
          first_name: ownerFirst ?? "Merchant",
          last_name: ownerLast ?? "",
          business_name: newBusinessName,
          email: ownerEmail,
          phone: ownerPhone,
          status: "lead",
          source: str(owner?.source) ?? sourceFor(leadRow),
          ghl_contact_id: contactId,
          additional_phones: owner?.additional_phones ?? [],
          additional_emails: owner?.additional_emails ?? [],
        }).select("id").single();
        if (cErr || !created) {
          return json({ ok: false, error: `Couldn't add that business: ${cErr?.message ?? "unknown"}` }, 500);
        }
        scopedCustomerId = created.id;
        freshBusiness = true;
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
    async function refreshDealPositions(dealId: string): Promise<void> {
      // The harvester's richer signal wins; the Lead Machine file fills the gap
      // it leaves for purchased UCC leads.
      const patch = (await positionsPatch()) ?? leadMachinePositionsPatch(leadRow);
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

    // The merchant's lead TYPE for opening-script routing. Tags/Lead-Machine row
    // decide it; a ph_ucc-harvested lead (no lead_records row) is a UCC signal on
    // its own, so uccLead standing in means "ucc" when nothing richer is known.
    function derivedLeadType(): LeadType | null {
      return leadTypeFor(leadRow, contactTags) ?? (uccLead ? "ucc" : null);
    }

    // BACKFILL lead_source on RESUME so a deal opened before the setter had a
    // script — or one that fell to the 'ph_setter' placeholder — gets its real
    // `<type>_list` value, which is what the Playbook reads to auto-pick the
    // opening script. Never touches a meaningful value (only null/placeholder),
    // best-effort, and skips the caller-override case (that already won at create).
    async function backfillDealLeadSource(dealId: string): Promise<void> {
      if (leadSourceOverride) return;
      const lt = derivedLeadType();
      if (!lt) return;
      const src = `${lt}_list`;
      const { data: d } = await db.from("deals").select("lead_source").eq("id", dealId).maybeSingle();
      const cur = str(d?.lead_source);
      if (cur === src) return;
      if (cur && !PLACEHOLDER_LEAD_SOURCES.has(cur.toLowerCase())) return; // meaningful — never overwrite
      const { error } = await db.from("deals").update({ lead_source: src }).eq("id", dealId);
      if (error) console.error("[playbook-open-contact] lead_source backfill failed:", error.message);
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

    // Heal an EXISTING open deal that carries no opportunity id — either it was
    // born before this fix, or its birth-time lookup came back empty. Same
    // reason as resolveOpportunityId: a deal with a NULL opp id is invisible to
    // the ghl-webhook stage mirror, which then mints a duplicate. Only ever
    // FILLS A NULL (the .is() filter makes the write idempotent and means a deal
    // that already carries an id is never re-pointed). Costs one GHL call, and
    // only on a setter-driven open, so it is nothing against the daily budget.
    //
    // MULTI-BUSINESS: resolveOpportunityId deliberately refuses to pick when a
    // contact has two open MCA opportunities, so on a business-scoped open we
    // resolve by the BUSINESS's name instead (and mint one if nothing matches) —
    // otherwise the second business's deal would sit at NULL forever, which is the
    // one state adoptOrphanDeal can cross-wire. A single-business contact still
    // takes the original, never-creates path.
    // Returns the opportunity id the deal carries AFTER this ran, so the caller
    // can report it (null when there still isn't one — same as before).
    async function backfillDealOpportunity(dealId: string, current: string | null): Promise<string | null> {
      if (current) return current;
      let oppId: string | null = null;
      if (scopedCustomerId && multiBusiness) {
        const r = await opportunityForBusiness(db, contactId, scopedBusinessName, null);
        if ("error" in r) {
          console.warn("[playbook-open-contact] per-business opp resolve failed (deal keeps no opp id):", r.error);
          return null;
        }
        oppId = r.id;
      } else {
        oppId = await resolveOpportunityId(db, contactId);
      }
      if (!oppId) return null;
      const { error } = await db.from("deals")
        .update({ ghl_opportunity_id: oppId })
        .eq("id", dealId)
        .is("ghl_opportunity_id", null);
      if (error) { console.error("[playbook-open-contact] opp id backfill failed:", error.message); return null; }
      console.log("[playbook-open-contact] linked deal", dealId, "to opportunity", oppId);
      return oppId;
    }

    // ── 1) IDEMPOTENT RESOLVE: newest OPEN mca deal already on this contact. ──
    // OWNER-WIDE, so it is skipped entirely on a business-scoped request — "the
    // newest open deal on this contact" is the wrong answer when the caller named
    // WHICH business they want. Those go straight to the per-customer resolve (2b).
    const { data: existingDeals, error: findErr } = scopedCustomerId
      ? { data: null, error: null }
      : await db
        .from("deals")
        .select("id, assigned_closer_id, status, customer_id, ghl_opportunity_id")
        .eq("ghl_contact_id", contactId)
        .eq("deal_type", "mca")
        .not("status", "in", `(${CLOSED_STATUSES.join(",")})`)
        .order("created_at", { ascending: false })
        .limit(1);
    if (findErr) return json({ ok: false, error: `deal lookup failed: ${findErr.message}` }, 500);

    if (existingDeals && existingDeals.length > 0) {
      const d = existingDeals[0] as {
        id: string; assigned_closer_id: string | null; customer_id: string | null;
        ghl_opportunity_id: string | null;
      };
      const oppNow = await backfillDealOpportunity(d.id, d.ghl_opportunity_id);
      // Resume: refresh the auto-populated fields onto the existing deal + its
      // customer. Positions/score refresh from the latest UCC read when the deal's
      // source is a UCC estimate or unset (rank <= 1); a human/underwriter value is
      // never overwritten. Address stays null-only.
      await refreshDealPositions(d.id);
      await refreshDealScore(d.id);
      await backfillDealLeadSource(d.id);
      if (d.customer_id) {
        await backfillCustomerAddress(d.customer_id);
        await backfillCustomerFromLead(db, d.customer_id, leadRow);
      }
      const claimed = await claimIfNeeded(d.id, d.assigned_closer_id);
      const attr1 = await attributeCampaign(db, d.id, contactId, contactTags);
      // Enrichment, not creation — runs on an EXISTING deal too, because the
      // value is having every number in front of the setter on this call.
      const extras1 = d.customer_id ? await mergeCustomerExtras(db, d.customer_id, contactId) : null;
      return json({ ok: true, deal_id: d.id, created: false, claimed, ghl_contact_id: contactId, ghl_opportunity_id: oppNow, customer_id: d.customer_id, multiple_businesses: false, matched_ucc: matchedUcc, ...attr1, ...(extras1 ? { customer_extras: extras1 } : {}) });
    }

    // ── 2) Resolve/create the CUSTOMER for this GHL contact. ──────────────────
    // Reuse a customer already linked to this ghl contact; else pull the GHL
    // contact and dedupe by email / last-10 phone before minting a new one.
    // A business-scoped request already named its customer — the owner-wide
    // "first customer on this contact" lookup below is exactly the collapse this
    // feature exists to undo, so it is skipped there.
    let customerId: string | null = scopedCustomerId;

    if (!customerId) {
      const { data: linkedCust } = await db
        .from("customers").select("id").eq("ghl_contact_id", contactId).limit(1).maybeSingle();
      if (linkedCust?.id) customerId = linkedCust.id;
    }

    // Identity for the customer row. The phone path already knows it (from the
    // UCC lead we just upserted into GHL); the contact-id path reads it back off
    // the GHL contact.
    let first: string | null = seed?.first ?? null, last: string | null = seed?.last ?? null,
        business: string | null = seed?.business ?? null, email: string | null = seed?.email ?? null,
        phone: string | null = seed?.phone ?? null;
    // Read identity back off the CRM whenever we don't already have a NAME —
    // not merely when there is no seed at all. A phone-path open with no local
    // match used to skip this entirely, so a contact that already carried a
    // perfectly good name in GHL still produced a nameless customer.
    // (Skipped on a business-scoped request: the customer is already chosen, so
    // this read would only spend a GHL call to fill fields nothing reads.)
    if (!scopedCustomerId && !seed?.first) {
      try {
        const cfg = await getGhlConfig(db);
        const got = await getContact(cfg, contactId);
        // ghlFetch REPORTS api errors on the envelope, it does not throw (same
        // note as the upsert path above). Without this check a 429 or 5xx sailed
        // past the catch below with `contact` undefined, every identity field
        // fell to null, and the insert further down minted a customer with no
        // name, no phone and no email — failing OPEN into garbage instead of
        // closed. Rethrow so a failed fetch takes exactly the path the catch was
        // written for: keep going on the customer we already have, or 502.
        if (!got.ok) throw new Error(`${ghlErrorMessage(got.error)} (HTTP ${got.status})`);
        const c = (got.data?.contact ?? {}) as Record<string, unknown>;
        // FILL, never blank: the CRM wins where it has a value, but an empty
        // field there must not erase what the lead row already told us.
        first = str(c.firstName) ?? (str(c.contactName)?.split(/\s+/)[0] ?? null) ?? first;
        last = str(c.lastName) ?? last;
        business = str(c.companyName) ?? business;
        email = str(c.email) ?? email;
        phone = str(c.phone) ?? phone;
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
          source: sourceFor(leadRow),
          ghl_contact_id: contactId,
          // Everything the purchased file paid for. Listed BEFORE the UCC block
          // so a ph_ucc_leads address still wins where one exists.
          ...(leadRow ? customerFieldsFrom(leadRow) : {}),
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
    // NOT for a business we just added: the UCC/Lead-Machine intel behind this
    // contact was harvested for the OTHER business, and stamping its address,
    // industry and revenue onto business #2 would invent facts about a merchant
    // nobody has qualified yet.
    if (!customerCreated && !freshBusiness && customerId) {
      await backfillCustomerAddress(customerId);
      await backfillCustomerFromLead(db, customerId, leadRow);
    }

    // ── 2b) Second idempotency guard: the customer may already carry an OPEN
    // mca deal that predates the ghl link (common on the phone path, where the
    // merchant existed before they were ever pushed to GHL). Resume it and
    // backfill the contact id rather than minting a duplicate deal.
    const { data: custDeals } = await db
      .from("deals")
      .select("id, assigned_closer_id, ghl_contact_id, ghl_opportunity_id")
      .eq("customer_id", customerId)
      .eq("deal_type", "mca")
      .not("status", "in", `(${CLOSED_STATUSES.join(",")})`)
      .order("created_at", { ascending: false })
      .limit(1);
    if (custDeals && custDeals.length > 0) {
      const d = custDeals[0] as {
        id: string; assigned_closer_id: string | null; ghl_contact_id: string | null;
        ghl_opportunity_id: string | null;
      };
      if (!d.ghl_contact_id) {
        const { error: linkErr } = await db.from("deals").update({ ghl_contact_id: contactId }).eq("id", d.id);
        if (linkErr) console.error("[playbook-open-contact] deal ghl link backfill failed:", linkErr.message);
      }
      const oppNow2 = await backfillDealOpportunity(d.id, d.ghl_opportunity_id);
      // Resume: refresh existing positions onto this pre-existing open deal from
      // the latest UCC read (source rank <= 1 only — never overwrite a refined value).
      await refreshDealPositions(d.id);
      await refreshDealScore(d.id);
      await backfillDealLeadSource(d.id);
      const claimed = await claimIfNeeded(d.id, d.assigned_closer_id);
      const attr1 = await attributeCampaign(db, d.id, contactId, contactTags);
      // Enrichment, not creation — runs on an EXISTING deal too, because the
      // value is having every number in front of the setter on this call.
      const extras1 = customerId ? await mergeCustomerExtras(db, customerId, contactId) : null;
      return json({ ok: true, deal_id: d.id, created: false, claimed, ghl_contact_id: contactId, ghl_opportunity_id: oppNow2, customer_id: customerId, multiple_businesses: false, matched_ucc: matchedUcc, ...attr1, ...(extras1 ? { customer_extras: extras1 } : {}) });
    }

    // ── 3) Create the DEAL, owned by the calling closer (if a closer). ────────
    // Auto-populate existing MCA positions from the backing UCC lead (no
    // overwrite risk — this is a brand-new deal).
    // (A business we just ADDED gets none of it — those liens were filed against
    // the owner's OTHER business, and copying them here would put a stack on a
    // merchant that may carry no advances at all.)
    const newDealPositions = freshBusiness ? null : await positionsPatch();
    // The contact's open MCA opportunity, so this deal is VISIBLE to the
    // ghl-webhook stage mirror from the moment it exists. Without it the mirror
    // can't join the two and creates a duplicate deal on the next stage move.
    // Null is fine (and is the old behavior) — never blocks deal creation.
    //
    // A NEW BUSINESS ALREADY HAS ITS OWN (pendingOppId, minted before this row
    // existed precisely so this deal is never born NULL); a business-scoped open
    // on a multi-business owner resolves by name. Everything else is unchanged.
    const newDealOppId = pendingOppId
      ?? (scopedCustomerId && multiBusiness
        ? await (async () => {
          const r = await opportunityForBusiness(db, contactId, scopedBusinessName, null);
          if ("error" in r) {
            console.warn("[playbook-open-contact] per-business opp resolve failed (deal born with no opp id):", r.error);
            return null;
          }
          return r.id;
        })()
        : await resolveOpportunityId(db, contactId));
    const { data: newDeal, error: dealErr } = await db
      .from("deals")
      .insert({
        customer_id: customerId,
        deal_type: "mca",
        status: "new",
        ...(newDealOppId ? { ghl_opportunity_id: newDealOppId } : {}),
        // The caller wins; else the lead's own type as `<type>_list` — including a
        // ph_ucc-harvested lead where the UCC signal, not a tag, names it 'ucc';
        // 'ph_setter' is the last-resort fallback, not the default answer.
        lead_source: leadSourceOverride
          ?? (derivedLeadType() ? `${derivedLeadType()}_list` : null)
          ?? "ph_setter",
        ghl_contact_id: contactId,
        created_by: caller.id,
        assigned_closer_id: isCloser ? caller.id : null,
        lead_qual: {
          opened_from: freshBusiness
            ? "playbook_add_business"
            : (seed ? "playbook_phone_link" : "playbook_deep_link"),
          ghl_contact_id: contactId,
          ...(freshBusiness ? {} : (uccLeadId ? { ucc_lead_id: uccLeadId } : {})),
        },
        ...(newDealPositions ?? {}),
        // Seed the UCC MCA quality score onto the brand-new deal (no overwrite risk).
        ...(!freshBusiness && uccMcaScore != null ? { mca_score: uccMcaScore } : {}),
      })
      .select("id")
      .single();
    if (dealErr || !newDeal) return json({ ok: false, error: `Couldn't create the deal: ${dealErr?.message ?? "unknown"}` }, 500);

    const attr2 = await attributeCampaign(db, newDeal.id, contactId, contactTags);
    const extras2 = customerId ? await mergeCustomerExtras(db, customerId, contactId) : null;
    return json({ ok: true, deal_id: newDeal.id, created: true, claimed: isCloser, ghl_contact_id: contactId, ghl_opportunity_id: newDealOppId, customer_id: customerId, business_name: scopedBusinessName ?? business, multiple_businesses: false, matched_ucc: matchedUcc, ...(oppWarning ? { opportunity_warning: oppWarning } : {}), ...attr2, ...(extras2 ? { customer_extras: extras2 } : {}) });
  } catch (e) {
    console.error("[playbook-open-contact] fatal:", e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
