// MerchantApplicationModal — the closer fills the merchant's MCA application
// IN-APP while they're on the phone (pre-filled from the customer + deal), saves
// it to public.mca_applications, then sends it to the merchant to e-sign.
//
// This replaces the old "Send the application" behavior, which just opened the
// merchant's GHL contact in a new tab — the closer had to retype everything into
// GHL and nothing was stored in our own system. Now: fill once here, it's saved,
// and one click sends it out.
//
// E-SIGN NOTE: the formal signature is executed by GHL Documents & Contracts, but
// DELIVERY IS THE CODE'S JOB — push-application-to-ghl enrolls the merchant into the
// doc workflow directly. It is NOT fired by the move to Application Sent; that move is
// only a pipeline update. Believing otherwise is what put a contract full of raw
// {{merge tags}} in front of five merchants on 2026-07-13 (one signed it), because a
// stage trigger cannot tell the pre-filled path from the self-fill path — only this
// code knows which document the closer asked for.
//
// And because GHL answering 200 is NOT proof of what it sent, the server now READS THE
// DOCUMENT BACK after enrolling and reports what actually landed. This modal shows that
// verdict verbatim — "Confirmed — GHL sent <template>", an honest "awaiting
// confirmation", or a loud red stop on the wrong template. It never claims a success it
// has not verified.

import { useEffect, useMemo, useState } from "react";
import { XMarkIcon, DocumentTextIcon, PaperAirplaneIcon, CheckCircleIcon } from "@heroicons/react/24/outline";
import supabase from "../../supabase";
import { mustWrite, tryWrite } from "@/supabase/writes";
import { updateDealStatus } from "../../services/dealService";
import type { DealWithCustomer } from "../../types/deals";

// supabase.functions.invoke stashes a non-2xx response's JSON body in
// error.context (a Response) — which no caller reads, so the closer sees the
// generic "Edge Function returned a non-2xx status code" instead of the server's
// hand-written message (the 422 no-email block, the 502 "the document was NOT
// sent"). This pulls the server's { error } out of that body (falling back to the
// raw message) and throws it, so the real reason reaches the closer verbatim.
// Call it on any functions.invoke error path: `if (err) await invokeThrow(err)`.
// Carries the server's structured body alongside the message, so a caller can react
// to WHAT went wrong (e.g. verification === "wrong_template") and not just print it.
class SendError extends Error {
  details: ServerError;
  constructor(message: string, details: ServerError = {}) {
    super(message);
    this.name = "SendError";
    this.details = details;
  }
}
type ServerError = {
  error?: string;
  verification?: "confirmed" | "unconfirmed" | "wrong_template";
  verified_template?: string | null;
  expected_template?: string;
};

async function invokeThrow(error: unknown): Promise<never> {
  const ctx = (error as { context?: { json?: () => Promise<unknown> } } | null)?.context;
  if (ctx && typeof ctx.json === "function") {
    const body = (await ctx.json().catch(() => null)) as ServerError | null;
    if (body?.error) throw new SendError(body.error, body);
  }
  throw new SendError((error as { message?: string } | null)?.message ?? "Request failed.");
}

// The application fields we capture. Keys match mca_applications columns.
interface AppForm {
  // Business
  business_legal_name: string;
  business_dba: string;
  business_type: string;
  ein: string;
  business_start_date: string;
  business_phone: string;
  business_email: string;
  business_address: string;
  business_city: string;
  business_state: string;
  business_zip: string;
  business_website: string;
  industry: string;
  // Owner
  owner_first_name: string;
  owner_last_name: string;
  owner_title: string;
  owner_ownership_pct: string;
  owner_ssn: string;
  owner_dob: string;
  owner_email: string;
  owner_phone: string;
  owner_home_address: string;
  owner_home_city: string;
  owner_home_state: string;
  owner_home_zip: string;
  owner_dl_number: string;
  owner_dl_state: string;
  // Banking
  bank_name: string;
  bank_routing_number: string;
  bank_account_number: string;
  bank_account_type: string; // "" | "Checking" | "Savings"
  // Funding
  amount_requested: string;
  use_of_funds: string;
  monthly_revenue: string;
  average_daily_balance: string;
  existing_positions: string;
  existing_balance: string;
  // Business financials (from the PDF's "Business Financial Information" section)
  annual_gross_revenue: string;
  average_monthly_deposits: string;
  number_of_employees: string;
  has_bankruptcy: string;      // "" | "yes" | "no"
  bankruptcy_details: string;
  has_tax_liens: string;       // "" | "yes" | "no"
  tax_lien_details: string;
  notes: string;
}

const EMPTY: AppForm = {
  business_legal_name: "", business_dba: "", business_type: "", ein: "", business_start_date: "",
  business_phone: "", business_email: "", business_address: "", business_city: "", business_state: "",
  business_zip: "", business_website: "", industry: "",
  owner_first_name: "", owner_last_name: "", owner_title: "", owner_ownership_pct: "", owner_ssn: "",
  owner_dob: "", owner_email: "", owner_phone: "", owner_home_address: "", owner_home_city: "",
  owner_home_state: "", owner_home_zip: "", owner_dl_number: "", owner_dl_state: "",
  // Account type defaults to Checking: 99% of merchant operating accounts are, the
  // GHL field is a strict picklist, and a default means the 04B merge tag always has
  // a value behind it. The closer flips it to Savings when it is.
  bank_name: "", bank_routing_number: "", bank_account_number: "", bank_account_type: "Checking",
  amount_requested: "", use_of_funds: "", monthly_revenue: "", average_daily_balance: "",
  existing_positions: "", existing_balance: "",
  annual_gross_revenue: "", average_monthly_deposits: "", number_of_employees: "",
  has_bankruptcy: "", bankruptcy_details: "", has_tax_liens: "", tax_lien_details: "",
  notes: "",
};

// Numeric columns — sent to the DB as numbers (or null), not strings.
const NUMERIC_KEYS: (keyof AppForm)[] = [
  "owner_ownership_pct", "amount_requested", "monthly_revenue", "average_daily_balance", "existing_balance",
  "annual_gross_revenue", "average_monthly_deposits",
];
const INTEGER_KEYS: (keyof AppForm)[] = ["existing_positions", "number_of_employees"];
const DATE_KEYS: (keyof AppForm)[] = ["business_start_date", "owner_dob"];
// Boolean columns — the form holds "yes"/"no", coerced to true/false (or null).
const BOOLEAN_KEYS: (keyof AppForm)[] = ["has_bankruptcy", "has_tax_liens"];

type Tab = "business" | "owner" | "banking" | "funding";

// REQUIRED fields, mirroring the real "Merchant Funding Application" the merchant
// e-signs. Everything the form marks "if any / if applicable" is OPTIONAL and
// excluded here: business_dba, owner_dl_state, average_daily_balance,
// existing_positions, existing_balance, notes. The application can't be SENT
// until every one of these is filled (a Save draft may still be partial).
// owner_ssn is NOT here by design (owner's call, 2026-07-13): a merchant who won't
// read their SSN out on a first call should not block the whole application. It stays
// on the form, it still merges when filled — it just doesn't gate the send. The one
// consequence (a blank SSN prints as a raw {{tag}} on the signed document) is shown as
// a single warning line by the Send button. The closer decides; the app doesn't.
const REQUIRED_KEYS: (keyof AppForm)[] = [
  // Business
  "business_legal_name", "business_type", "ein", "business_start_date", "industry",
  "business_phone", "business_email", "business_address", "business_city", "business_state", "business_zip",
  // Owner / guarantor
  // DL number is OPTIONAL (owner's call): the merchant sends a PHOTO of the licence
  // with their stips anyway, so making a closer transcribe the number on the phone is
  // double work. Blank on the 04B path = raw {{tag}} on the doc — warned, not gated.
  "owner_first_name", "owner_last_name", "owner_title", "owner_ownership_pct", "owner_dob",
  "owner_email", "owner_phone",
  "owner_home_address", "owner_home_city", "owner_home_state", "owner_home_zip",
  // Banking
  "bank_name", "bank_routing_number", "bank_account_number",
  // Funding request
  "amount_requested", "use_of_funds", "monthly_revenue",
];

// Entity type is a fixed vocabulary, not free text — a typo here lands on a legal
// document. These values are the EXACT picklist of the GHL "Business Entity"
// SINGLE_OPTIONS custom field (bg2F006hXRWpFBC0UcJQ, verified live). A value outside
// that picklist makes GHL reject the ENTIRE custom-field PUT, which would leave every
// merge tag on the document unfilled — so this list must not drift from GHL's.
const ENTITY_TYPES = [
  "LLC", "S-Corp", "C-Corp", "Sole Proprietor", "Partnership", "LP", "LLP", "Non-profit",
] as const;

// ── PREFILL FROM THE LEAD ────────────────────────────────────────────────────
// The lead vendor already told us most of these answers; deals.lead_qual holds the
// raw payload the live-transfer intake parked there. Making a closer hand-type them
// again while the merchant is on the phone is how you get typos on a contract — and
// how you lose the call. We seed, the closer confirms.

const txt = (v: unknown) => String(v ?? "").trim();

/** "$125,000" → "125000". Anything with no number in it ("N/A") → "". */
function money(v: unknown): string {
  const raw = txt(v);
  if (!raw) return "";
  const n = raw.replace(/[^0-9.]/g, "");
  if (!n || !Number.isFinite(Number(n))) return "";
  return String(Number(n));
}

/** The vendor's count/balance answers come through as "N/A" | "No" | a number.
 * "N/A" and "No" mean NONE — i.e. 0. They must never reach a funding application
 * as the literal string "No". */
function countOrZero(v: unknown): string {
  const raw = txt(v);
  if (!raw) return "";
  if (/^(n\/?a|no|none)$/i.test(raw)) return "0";
  return money(raw);
}

/** "Carlton Rankin" → { first: "Carlton", last: "Rankin" } (split on the LAST space,
 * so "Mary Anne Vandermeer" keeps "Mary Anne" as the first name). */
function splitName(v: unknown): { first: string; last: string } {
  const raw = txt(v).replace(/\s+/g, " ");
  if (!raw) return { first: "", last: "" };
  const i = raw.lastIndexOf(" ");
  if (i < 0) return { first: raw, last: "" };
  return { first: raw.slice(0, i), last: raw.slice(i + 1) };
}

/** "7 Years" / "18 Months" → an APPROXIMATE start date (today minus that span).
 *
 * This is an ESTIMATE, never a fact: the vendor asked "how long have you owned it",
 * not "what is your incorporation date". It is written into the field so the closer
 * SEES it and can correct it on the call (the field carries a hint saying so), rather
 * than being asserted silently onto a legal document. Unparseable → "", because an
 * empty field a closer must fill beats a wild guess they might not notice. */
function startDateFromTenure(v: unknown): string {
  const m = txt(v).match(/^(\d+(?:\.\d+)?)\s*(years?|yrs?|months?|mos?)\b/i);
  if (!m) return "";
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n) || n <= 0) return "";
  const months = /^(y)/i.test(m[2]) ? Math.round(n * 12) : Math.round(n);
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

// Which tab each required field lives on — powers the per-tab "N missing" badge.
const TAB_OF: Partial<Record<keyof AppForm, Tab>> = {
  business_legal_name: "business", business_type: "business", ein: "business", business_start_date: "business",
  industry: "business", business_phone: "business", business_email: "business", business_address: "business",
  business_city: "business", business_state: "business", business_zip: "business",
  owner_first_name: "owner", owner_last_name: "owner", owner_title: "owner", owner_ownership_pct: "owner",
  owner_ssn: "owner", owner_dob: "owner", owner_dl_number: "owner", owner_email: "owner", owner_phone: "owner",
  owner_home_address: "owner", owner_home_city: "owner", owner_home_state: "owner", owner_home_zip: "owner",
  bank_name: "banking", bank_routing_number: "banking", bank_account_number: "banking",
  amount_requested: "funding", use_of_funds: "funding", monthly_revenue: "funding",
};

// Human labels for the "what's still missing" message on a blocked send.
const FIELD_LABEL: Record<keyof AppForm, string> = {
  business_legal_name: "Business legal name", business_dba: "DBA", business_type: "Entity type", ein: "EIN",
  business_start_date: "Business start date", business_phone: "Business phone", business_email: "Business email",
  business_address: "Business street address", business_city: "Business city", business_state: "Business state",
  business_zip: "Business ZIP", business_website: "Website", industry: "Industry",
  owner_first_name: "Owner first name", owner_last_name: "Owner last name", owner_title: "Owner title",
  owner_ownership_pct: "Ownership %", owner_ssn: "Owner SSN", owner_dob: "Owner date of birth",
  owner_email: "Owner email", owner_phone: "Owner phone", owner_home_address: "Home address",
  owner_home_city: "Home city", owner_home_state: "Home state", owner_home_zip: "Home ZIP",
  owner_dl_number: "Driver's license #", owner_dl_state: "DL state",
  bank_name: "Bank name", bank_routing_number: "Routing number", bank_account_number: "Account number", bank_account_type: "Account type",
  amount_requested: "Amount requested", use_of_funds: "Use of funds", monthly_revenue: "Monthly revenue",
  average_daily_balance: "Average daily balance", existing_positions: "# of existing positions",
  existing_balance: "Existing MCA balance",
  annual_gross_revenue: "Annual gross revenue", average_monthly_deposits: "Average monthly deposits",
  number_of_employees: "Number of employees", has_bankruptcy: "Prior bankruptcy",
  bankruptcy_details: "Bankruptcy details", has_tax_liens: "Tax liens / judgments",
  tax_lien_details: "Tax lien details", notes: "Notes",
};

const TAB_LABEL: Record<Tab, string> = {
  business: "Business", owner: "Owner", banking: "Banking", funding: "Funding request",
};

export default function MerchantApplicationModal({
  deal,
  onClose,
  onSent,
}: {
  deal: DealWithCustomer;
  onClose: () => void;
  onSent: () => void;
}) {
  const [form, setForm] = useState<AppForm>(EMPTY);
  // A saved draft freezes contact info at save time. If the LEAD's email/phone
  // was edited afterwards (Edit lead info), the draft is stale — surface it and
  // offer a one-click sync instead of silently keeping the old value.
  const [drift, setDrift] = useState<{ email?: string; phone?: string } | null>(null);
  const [tab, setTab] = useState<Tab>("business");
  const [loading, setLoading] = useState(true);
  const [existingId, setExistingId] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "send" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // HALF-SEND RECOVERY: the e-sign document goes out FIRST (push-application-to-ghl
  // enrolls the merchant in the GHL doc workflow), the closer's cover note second.
  // When the cover note fails, the DOCUMENT IS ALREADY WITH THE MERCHANT — re-running
  // the whole send would re-enroll them and risk a second document. So we keep the
  // failed cover note here and offer a retry that sends ONLY the note.
  const [pendingNote, setPendingNote] = useState<{ subject: string; body: string; regarding: string } | null>(null);
  // The vendor's raw tenure answer ("7 Years") behind the estimated start date, so the
  // field can say where its value came from instead of presenting a guess as a fact.
  const [startDateFrom, setStartDateFrom] = useState<string | null>(null);
  // How many REQUIRED fields we filled from the lead + our own records, for an honest
  // "X of Y already filled" count.
  const [prefilled, setPrefilled] = useState(0);
  // What GHL ACTUALLY sent, read back after the send. Never assumed — only reported.
  const [sendResult, setSendResult] = useState<
    { verification: "confirmed" | "unconfirmed"; template: string | null; expected: string } | null
  >(null);
  // GHL sent the WRONG template. The document is already with the merchant and we
  // cannot recall it — so we lock the send buttons rather than let a retry mint a
  // second wrong document, and we say exactly what landed.
  const [wrongTemplate, setWrongTemplate] = useState<{ got: string | null; expected: string } | null>(null);

  const cust = deal.customer;

  /**
   * Record that the e-sign document HAS GONE OUT.
   *
   * Called the instant the document is actually with GHL — never later. This used to be
   * stamped at the very end of the send, after the cover note, and that ordering re-sent
   * a real merchant's contract three times: the note failed, the early-return skipped the
   * stamp, and the next click saw `sent_to_merchant_at = NULL`, concluded the document had
   * never gone out, and enrolled them again. K.L. Breen collected 6 orphan document
   * records from 3 clicks.
   *
   * A cover note failing cannot un-send a document, so it must never un-stamp one. Both
   * send paths (pre-filled 04B and self-fill MCA 04) call this, so they can't drift apart.
   */
  const stampSent = async (applicationId: string | null) => {
    const iso = new Date().toISOString();
    // The self-fill path may have no saved application row at all (the merchant is the
    // one who fills it in). There's nothing to stamp then — but the in-session flag still
    // has to flip, or a second click in the same session re-sends the document.
    setSentAt(iso);
    if (!applicationId) return;
    const { data: auth } = await supabase.auth.getUser();
    await tryWrite(
      "stamp application sent",
      supabase
        .from("mca_applications")
        .update({ sent_to_merchant_at: iso, sent_by: auth?.user?.id ?? null })
        .eq("id", applicationId),
    );
  };

  // Load any existing draft; otherwise pre-fill from the customer + deal so the
  // closer starts with everything we already know.
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from("mca_applications")
        .select("*")
        .eq("deal_id", deal.id)
        .maybeSingle();
      if (!alive) return;
      if (data) {
        setExistingId(data.id as string);
        setSentAt((data.sent_to_merchant_at as string | null) ?? null);
        // Hydrate the form from the saved row, coercing nulls to "".
        const next = { ...EMPTY };
        for (const k of Object.keys(EMPTY) as (keyof AppForm)[]) {
          const v = (data as Record<string, unknown>)[k];
          if (v === null || v === undefined) { next[k] = ""; continue; }
          // Boolean columns are stored as true/false; the form uses "yes"/"no".
          next[k] = BOOLEAN_KEYS.includes(k) ? (v ? "yes" : "no") : String(v);
        }
        setForm(next);
        // Drift check: the customer's CURRENT contact info vs what the saved
        // application row holds. (e.g. closer fixed the email via Edit lead info
        // AFTER the draft was saved — the draft still has the old address.)
        const norm = (s?: string | null) => (s ?? "").trim().toLowerCase();
        const digits = (s?: string | null) => (s ?? "").replace(/\D/g, "");
        const d: { email?: string; phone?: string } = {};
        if (cust?.email && norm(cust.email) !== norm(next.business_email)) d.email = cust.email;
        if (cust?.phone && digits(cust.phone) !== digits(next.business_phone)) d.phone = cust.phone;
        setDrift(d.email || d.phone ? d : null);
      } else {
        // Fresh — seed from what we already have on the customer + deal, and from the
        // LEAD the vendor sold us (deals.lead_qual). The customer/deal row wins where
        // it has a value (it's our own record, and a closer may have corrected it);
        // the lead fills the gaps. A saved draft never reaches here, so this can never
        // clobber something a human typed.
        const q = (deal.lead_qual ?? {}) as Record<string, unknown>;
        const name = splitName(q.contact_name);
        const tenure = txt(q.time_as_owner);
        const startEst = startDateFromTenure(tenure);

        // First non-empty wins.
        const pick = (...vals: (string | null | undefined)[]) =>
          vals.find((v) => txt(v) !== "") ?? "";

        const seeded: AppForm = {
          ...EMPTY,
          business_legal_name: pick(cust?.business_name, txt(q.company)),
          business_email: pick(cust?.email, txt(q.email)),
          business_phone: pick(cust?.phone, txt(q.phone)),
          business_state: txt(q.state).toUpperCase().slice(0, 2),
          business_start_date: startEst,
          industry: pick(cust?.industry, txt(q.industry)),
          owner_first_name: pick(cust?.first_name, name.first),
          owner_last_name: pick(cust?.last_name, name.last),
          owner_email: pick(cust?.email, txt(q.email)),
          owner_phone: pick(cust?.phone, txt(q.phone)),
          // is_owner was "Yes" on 100% of real leads — seed the common case, editable.
          owner_title: "Owner",
          owner_ownership_pct: "100",
          amount_requested: pick(
            deal.amount_requested != null ? String(deal.amount_requested) : "",
            money(q.requested_amount),
          ),
          use_of_funds: pick(deal.use_of_funds, txt(q.use_of_funds)),
          monthly_revenue: pick(
            cust?.monthly_revenue != null ? String(cust.monthly_revenue) : "",
            money(q.monthly_deposits),
          ),
          existing_positions: countOrZero(q.open_positions),
          existing_balance: countOrZero(q.positions_balance),
        };
        setForm(seeded);
        // Only claim the date is an estimate if we actually estimated one.
        setStartDateFrom(startEst && tenure ? tenure : null);
        setPrefilled(REQUIRED_KEYS.filter((k) => txt(seeded[k]) !== "").length);
      }
      setLoading(false);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal.id]);

  function set<K extends keyof AppForm>(k: K, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  const merchantEmail = useMemo(
    () => (form.business_email || form.owner_email || cust?.email || "").trim(),
    [form.business_email, form.owner_email, cust?.email],
  );

  // Required-field validation — the send is BLOCKED until every required field
  // (per the real application) is filled. Recomputed as the closer types.
  const missingRequired = useMemo(
    () => REQUIRED_KEYS.filter((k) => String(form[k] ?? "").trim() === ""),
    [form],
  );
  const missingByTab = useMemo(() => {
    const counts: Record<Tab, number> = { business: 0, owner: 0, banking: 0, funding: 0 };
    for (const k of missingRequired) {
      const t = TAB_OF[k];
      if (t) counts[t] += 1;
    }
    return counts;
  }, [missingRequired]);
  const canSend = missingRequired.length === 0;
  // GHL put the wrong document in front of this merchant. Sending again would only
  // put a second one there — the fix is in GHL, not in another click.
  const sendLocked = wrongTemplate !== null;

  // Build the DB payload from the form: trim, drop empties to null, coerce types.
  function payload(): Record<string, unknown> {
    const out: Record<string, unknown> = { deal_id: deal.id, customer_id: deal.customer_id };
    for (const k of Object.keys(form) as (keyof AppForm)[]) {
      const raw = String(form[k] ?? "").trim();
      if (raw === "") { out[k] = null; continue; }
      if (NUMERIC_KEYS.includes(k)) out[k] = Number(raw);
      else if (INTEGER_KEYS.includes(k)) out[k] = parseInt(raw, 10);
      else if (BOOLEAN_KEYS.includes(k)) out[k] = raw === "yes"; // "yes"/"no" → bool
      else if (DATE_KEYS.includes(k)) out[k] = raw; // yyyy-mm-dd
      else out[k] = raw;
    }
    return out;
  }

  // Upsert the application row (by deal_id). Returns the row id.
  async function persist(status: "draft" | "sent"): Promise<string> {
    const body = { ...payload(), status };
    if (existingId) {
      await mustWrite(
        "save application",
        supabase.from("mca_applications").update(body).eq("id", existingId),
      );
      return existingId;
    }
    const rows = await mustWrite<{ id: string }>(
      "save application",
      supabase.from("mca_applications").insert(body),
    );
    const id = rows[0]?.id;
    if (id) setExistingId(id);
    return id;
  }

  async function saveDraft() {
    setBusy("save");
    setError(null);
    try {
      await persist("draft");
      setToast("Application saved.");
      setTimeout(() => setToast(null), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the application.");
    } finally {
      setBusy(null);
    }
  }

  // Send: save the app, email the merchant a cover note via the merchant-email
  // transport, then advance the deal to Application Sent (which fires the GHL
  // MCA 04 automation — the merchant's app + disclosure + upload link to e-sign).
  async function sendToMerchant() {
    if (!merchantEmail) {
      setError("This merchant has no email yet — add one via 'Edit lead info' first.");
      setTab("business");
      return;
    }
    // Don't let an incomplete application go out. List what's missing and jump
    // to the first tab that has a gap so the closer can finish it.
    if (missingRequired.length > 0) {
      const names = missingRequired.slice(0, 8).map((k) => FIELD_LABEL[k]);
      const more = missingRequired.length - names.length;
      setError(
        `Fill the required (*) fields before sending — missing: ${names.join(", ")}${more > 0 ? ` +${more} more` : ""}.`,
      );
      const firstTab = TAB_OF[missingRequired[0]];
      if (firstTab) setTab(firstTab);
      return;
    }
    // RE-SEND detection: the docs already went out once (sent_to_merchant_at
    // stamped, or the deal already reached Application Sent). The GHL MCA 04
    // automation fires on the deal MOVING INTO Application Sent — so on a re-send
    // the stage move is a no-op and NOTHING re-sends. Instead we ask the server to
    // re-ENROLL the contact into MCA 04 directly (resend:true), which re-fires the
    // doc send even from a stalled stage.
    const isResend = !!sentAt || !!deal.application_sent_at || deal.status === "application_sent";

    setBusy("send");
    setError(null);
    try {
      const id = await persist("sent");

      // CRITICAL: push the application into the merchant's GHL contact custom
      // fields (the source the e-sign document MERGES from) BEFORE anything else.
      // If this fails we STOP — advancing the stage fires the GHL doc automation,
      // and without this push the merchant would e-sign a BLANK application.
      // On a re-send we also re-enroll the contact into MCA 04 (see isResend).
      const { data: pushData, error: pushErr } = await supabase.functions.invoke("push-application-to-ghl", {
        body: { dealId: deal.id, resend: isResend },
      });
      if (pushErr) await invokeThrow(pushErr);
      if ((pushData as { error?: string })?.error) throw new Error((pushData as { error?: string }).error);

      // ── STAMP IT NOW. The document is OUT. ──
      //
      // This used to be stamped at the END, after the cover note — and that ordering
      // sent a real merchant's contract THREE TIMES:
      //
      //   1. enroll 04B  → the e-sign document goes out       ✅ succeeded
      //   2. send the cover note                              ❌ failed
      //   3. stamp sent_to_merchant_at                        ← never reached
      //
      // With the stamp skipped, the next click recomputed `isResend = false`, decided the
      // document had never gone out, and re-enrolled 04B from scratch. K.L. Breen ended up
      // with 6 orphan document records from 3 clicks. The only thing between that and
      // three contracts landing in a live merchant's inbox was a GHL re-enrollment toggle
      // that this file's own comments say we must never depend on.
      //
      // The stamp asserts exactly ONE fact: the document has been sent. That became true
      // the instant the push returned ok — not after some later, unrelated email. A cover
      // note failing cannot un-send a document, so it must never un-stamp one. Everything
      // downstream (the re-send guard, the stage move) keys off this, so it has to be
      // written the moment it is TRUE, not the moment the happy path finishes.
      await stampSent(id);

      const firstName = form.owner_first_name || cust?.first_name || "there";
      const biz = form.business_legal_name || cust?.business_name || "your business";
      const amt = form.amount_requested ? `$${Number(form.amount_requested).toLocaleString()}` : "your requested amount";
      const subject = `Your funding application for ${biz}`;
      const emailBody =
        `Hi ${firstName},\n\n` +
        `Thanks for your time on the phone. I've prepared your funding application for ${biz} ` +
        `(${amt} in working capital) and I'm sending it over now to review and e-sign.\n\n` +
        `You'll receive a separate email with:\n` +
        `  1. Your funding application to review and e-sign\n` +
        `  2. A quick compensation disclosure to e-sign\n` +
        `  3. A secure link to upload your last few months of bank statements, a photo ID, and a voided check\n\n` +
        `Prefer to do it all in one place? Everything above is also in your secure portal — sign in at my.mfunding.net with this email and you can upload, sign, and track your application there too (we'll email you a one-tap sign-in link any time you ask).\n\n` +
        `Most of it is already filled in — you just need to confirm and sign. It takes about three minutes. ` +
        `Reply here if anything looks off or you have questions.\n\n` +
        `Talk soon.`;

      const noteErr = await sendCoverNote(subject, emailBody, "MCA application");
      if (noteErr) {
        // The DOCUMENT already went out (the push above succeeded) — say so, and do
        // NOT let the closer re-run the whole send just to retry the note.
        setPendingNote({ subject, body: emailBody, regarding: "MCA application" });
        setError(halfSendMessage(noteErr));
        setBusy(null);
        return;
      }

      // (sent_to_merchant_at is stamped ABOVE, the moment the document actually went out.
      // Stamping it here — after the cover note — is what re-sent K.L. Breen's contract
      // three times.)

      if (isResend) {
        // No stage move on a re-send (it's a no-op). The re-fire happened via the
        // MCA 04 re-enrollment inside push-application-to-ghl. If GHL rejected the
        // re-enrollment (workflow re-enrollment turned off), be HONEST: the cover
        // note went out but the e-sign docs did NOT — tell the closer how to fix
        // it rather than letting them believe the docs re-sent.
        if ((pushData as { reenrolled?: boolean })?.reenrolled === false) {
          setError(
            "Cover note re-sent, but GHL did NOT re-send the e-sign docs — MCA 04 re-enrollment was rejected. " +
            "Re-send the document manually from GHL → Documents & Contracts (move the old doc to Draft first).",
          );
          setBusy(null);
          return;
        }
      } else {
        // First send: the document is already out (push-application-to-ghl enrolled the
        // workflow directly and VERIFIED what GHL minted). This move only syncs the
        // pipeline. Forward-only guard in updateDealStatus is fine here.
        try { await updateDealStatus(deal.id, "application_sent"); } catch { /* stage already ahead */ }
      }

      // Report what GHL ACTUALLY DID — not what we hoped it did.
      showSendResult(pushData);
    } catch (e) {
      handleSendError(e);
    }
  }

  /** Record the server's post-send verification so the closer can SEE what landed.
   * We hold the modal open on purpose: the whole reason a merchant signed a garbage
   * contract on 2026-07-13 is that every screen said "sent ✅" and nobody looked. */
  function showSendResult(pushData: unknown) {
    const p = (pushData ?? {}) as {
      verification?: "confirmed" | "unconfirmed";
      verified_template?: string | null;
      expected_template?: string;
    };
    setSendResult({
      verification: p.verification === "confirmed" ? "confirmed" : "unconfirmed",
      template: p.verified_template ?? null,
      expected: p.expected_template ?? "the application",
    });
    setBusy(null);
  }

  /** A send that failed. The one case that needs its own treatment: GHL minted the
   * WRONG template. That document is already with the merchant, so the useful thing
   * is not "try again" — it's "stop, and go tell them not to sign it". */
  function handleSendError(e: unknown) {
    const d = e instanceof SendError ? e.details : undefined;
    if (d?.verification === "wrong_template") {
      setWrongTemplate({
        got: d.verified_template ?? null,
        expected: d.expected_template ?? "the application",
      });
    }
    setError(e instanceof Error ? e.message : "Could not send the application.");
    setBusy(null);
  }

  // Fire the closer's cover note. Returns the server's (actionable) error message,
  // or null on success. Never throws — the caller decides what the failure MEANS,
  // which depends on whether the e-sign document already went out.
  async function sendCoverNote(subject: string, body: string, regarding: string): Promise<string | null> {
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("send-merchant-email", {
        body: { dealId: deal.id, subject, body, regarding },
      });
      if (fnErr) await invokeThrow(fnErr);
      if ((data as { error?: string })?.error) throw new Error((data as { error?: string }).error);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "The cover note could not be sent.";
    }
  }

  // The e-sign document DID go out; only the cover note failed. Be explicit about
  // both halves so the closer doesn't re-run the send (which re-enrolls the
  // merchant in the GHL doc workflow and can put a SECOND document in front of them).
  function halfSendMessage(reason: string) {
    return (
      `The e-sign documents WERE sent to the merchant — only your cover note failed. ` +
      `Do NOT click "Send to merchant to e-sign" again (that re-sends the document). ` +
      `Use "Retry cover note only" below once the contact is fixed.\n\n${reason}`
    );
  }

  // Retry ONLY the cover note (the document is already with the merchant).
  async function retryCoverNote() {
    if (!pendingNote) return;
    setBusy("send");
    setError(null);
    const noteErr = await sendCoverNote(pendingNote.subject, pendingNote.body, pendingNote.regarding);
    if (noteErr) {
      setError(halfSendMessage(noteErr));
      setBusy(null);
      return;
    }
    setPendingNote(null);
    setBusy(null);
    onSent();
  }

  // PATH 3 — 04C PARTIAL: THE DEFAULT for a normal lead. We prefill the ~14 fields
  // the vendor already gave us (pushed straight from deals.lead_qual — no application
  // form needed), and the merchant completes the rest as fillable fields on the
  // document itself: EIN, SSN, addresses, banking. The closer types NOTHING.
  // Two-click arm/confirm, same as the blank path — it sends a real contract.
  async function sendPartial() {
    if (!merchantEmail) {
      setError("This merchant has no email yet — add one via 'Edit lead info' first.");
      return;
    }
    const isResend = !!sentAt || !!deal.application_sent_at || deal.status === "application_sent";
    setBusy("send");
    setError(null);
    try {
      const { data: pushData, error: pushErr } = await supabase.functions.invoke("push-application-to-ghl", {
        body: { dealId: deal.id, partial: true, resend: isResend },
      });
      if (pushErr) await invokeThrow(pushErr);
      if ((pushData as { error?: string })?.error) throw new Error((pushData as { error?: string }).error);

      // The server always enrolls directly, so a successful push means the document
      // IS OUT — stamp before the cover note can fail and skip it.
      await stampSent(existingId);

      const firstName = form.owner_first_name || cust?.first_name || "there";
      const biz = form.business_legal_name || cust?.business_name || "your business";
      const subject = `Your funding application for ${biz}`;
      const emailBody =
        `Hi ${firstName},\n\n` +
        `Thanks for your time. I've started your funding application for ${biz} — ` +
        `most of it is already filled in from what you've told us.\n\n` +
        `You'll receive a separate email with:\n` +
        `  1. Your application — just complete the few remaining fields (business details, banking) and e-sign\n` +
        `  2. A quick compensation disclosure to e-sign\n` +
        `  3. A secure link to upload your last few months of bank statements, a photo ID, and a voided check\n\n` +
        `Prefer to do it all in one place? Everything above is also in your secure portal — sign in at my.mfunding.net with this email and you can upload, sign, and track your application there too (we'll email you a one-tap sign-in link any time you ask).\n\n` +
        `It takes about five minutes. Reply here if anything looks off.\n\nTalk soon.`;
      const noteErr = await sendCoverNote(subject, emailBody, "MCA application (partial)");
      if (noteErr) {
        setPendingNote({ subject, body: emailBody, regarding: "MCA application (partial)" });
        setError(halfSendMessage(noteErr));
        setBusy(null);
        return;
      }
      if (!isResend) {
        try { await updateDealStatus(deal.id, "application_sent"); } catch { /* stage already ahead */ }
      }
      const v = (pushData as { verification?: string; verified_template?: string | null });
      setToast(
        v?.verification === "confirmed"
          ? `Partial application sent — GHL confirmed "${v.verified_template}". The merchant completes the rest and signs.`
          : "Partial application sent — awaiting GHL confirmation. The merchant completes the rest and signs.",
      );
      setBusy(null);
      onSent();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The partial send failed.");
      setBusy(null);
    }
  }

  // PATH 1 — SELF-FILL: send the ORIGINAL fillable application (the merchant types
  // everything themselves; MCA 04). No required-field gating — there is nothing to
  // pre-fill. Two-click arm/confirm so it can't fire accidentally.
  //
  // RESTORED 2026-07-13. This was briefly removed after five merchants received a
  // document full of raw {{merge tags}} — but the button was never the problem. The
  // server had stopped enrolling the merchant into MCA 04 and was waiting on a
  // pipeline-stage trigger that had been deliberately deleted, so the only thing that
  // fired was 04B's stage trigger: the PREFILL template, on a deal with nothing
  // prefilled. push-application-to-ghl now enrolls MCA 04 directly again (as it did
  // before 8dd5f00), so this path delivers the fillable application it always promised.
  //
  // Both paths are real business needs and neither gets deleted to paper over a bug:
  // merchant on the phone → prefill it for them; can't reach them → send it to fill in.
  const [blankArmed, setBlankArmed] = useState(false);
  async function sendBlank() {
    if (!blankArmed) { setBlankArmed(true); setTimeout(() => setBlankArmed(false), 6000); return; }
    setBlankArmed(false);
    if (!merchantEmail) {
      setError("This merchant has no email yet — add one via 'Edit lead info' first.");
      return;
    }
    const isResend = !!sentAt || !!deal.application_sent_at || deal.status === "application_sent";
    setBusy("send");
    setError(null);
    try {
      // blank:true → the server clears any prefill routing (removes 04B + tag)
      // and runs the classic MCA 04 self-fill path.
      const { data: pushData, error: pushErr } = await supabase.functions.invoke("push-application-to-ghl", {
        body: { dealId: deal.id, blank: true, resend: isResend },
      });
      if (pushErr) await invokeThrow(pushErr);
      if ((pushData as { error?: string })?.error) throw new Error((pushData as { error?: string }).error);

      // The server ALWAYS enrolls directly now, so a successful push means the document
      // IS OUT. Stamp it here, before the cover note can fail and skip the stamp — that
      // ordering is what re-sent a merchant's contract three times.
      await stampSent(existingId);

      const firstName = form.owner_first_name || cust?.first_name || "there";
      const biz = form.business_legal_name || cust?.business_name || "your business";
      const subject = `Your funding application for ${biz}`;
      const emailBody =
        `Hi ${firstName},\n\n` +
        `Thanks for your time. I'm sending over your funding application for ${biz} now.\n\n` +
        `You'll receive a separate email with:\n` +
        `  1. Your funding application to fill out and e-sign\n` +
        `  2. A quick compensation disclosure to e-sign\n` +
        `  3. A secure link to upload your last few months of bank statements, a photo ID, and a voided check\n\n` +
        `Prefer to do it all in one place? Everything above is also in your secure portal — sign in at my.mfunding.net with this email and you can upload, sign, and track your application there too (we'll email you a one-tap sign-in link any time you ask).\n\n` +
        `Reply here if you have any questions.\n\nTalk soon.`;
      const noteErr = await sendCoverNote(subject, emailBody, "MCA application (self-fill)");
      if (noteErr) {
        setPendingNote({ subject, body: emailBody, regarding: "MCA application (self-fill)" });
        // The document is already with the merchant (the push enrolled MCA 04 directly).
        // Only the cover note failed — say so, and do NOT let a retry re-send the doc.
        setError(halfSendMessage(noteErr));
        setBusy(null);
        return;
      }

      if (!isResend) {
        try { await updateDealStatus(deal.id, "application_sent"); } catch { /* stage already ahead */ }
      } else if ((pushData as { reenrolled?: boolean })?.reenrolled === false) {
        setError("Cover note sent, but GHL did NOT re-send the fillable docs — MCA 04 re-enrollment was rejected. Re-send the document manually from GHL → Documents & Contracts (move the old doc to Draft first).");
        setBusy(null);
        return;
      }
      showSendResult(pushData);
    } catch (e) {
      handleSendError(e);
    }
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: "business", label: "Business" },
    { id: "owner", label: "Owner" },
    { id: "banking", label: "Banking" },
    { id: "funding", label: "Funding request" },
  ];

  const inputCls =
    "input-field w-full";
  // Label with an explicit required/optional cue: red * (required) or a muted
  // "(optional)" tag, matching the live-transfer intake's convention.
  const Label = ({ children, req }: { children: React.ReactNode; req?: boolean }) => (
    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
      {children}{" "}
      {req ? <span className="text-red-500">*</span> : <span className="text-gray-400">(optional)</span>}
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-3xl max-h-[92vh] rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <DocumentTextIcon className="w-5 h-5 text-ocean-blue" /> Fill the application
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Pre-filled from what you know — complete it while they're on the phone, then send it to e-sign.
              {sentAt && (
                <span className="ml-1 text-emerald-600 dark:text-emerald-400">
                  · Already sent {new Date(sentAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                </span>
              )}
            </p>
            {/* Honest count: what the lead + our records already answered, and what's left. */}
            {!loading && prefilled > 0 && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                  {prefilled} of {REQUIRED_KEYS.length} prefilled from the lead
                </span>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                  {missingRequired.length} left to ask
                </span>
              </div>
            )}
          </div>
          {/* A send already happened → closing must still refresh the deal underneath. */}
          <button
            onClick={sendResult && !wrongTemplate ? onSent : onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs — each shows how many REQUIRED fields are still empty on it, so
            the closer can see at a glance where the gaps are. */}
        <div className="border-b border-gray-200 dark:border-gray-700 px-5">
          <nav className="flex gap-5">
            {TABS.map((t) => {
              const miss = missingByTab[t.id];
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`py-3 text-sm font-medium border-b-2 -mb-px transition-colors inline-flex items-center gap-1.5 ${
                    tab === t.id ? "border-ocean-blue text-ocean-blue" : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                  }`}
                >
                  {t.label}
                  {miss > 0 && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300" title={`${miss} required field${miss === 1 ? "" : "s"} still empty`}>
                      {miss}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Stale-contact drift banner — the lead's email/phone was edited AFTER
            this application was saved; one click pulls the fresh values in. */}
        {drift && (
          <div className="mx-5 mt-3 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-[13px] text-amber-800 dark:text-amber-200 flex flex-wrap items-center gap-2">
            <span>
              ⚠ The lead's contact info changed after this application was saved:
              {drift.email && <> email is now <b>{drift.email}</b>{form.business_email ? <> (app still has <b>{form.business_email}</b>)</> : null}</>}
              {drift.email && drift.phone && ";"}
              {drift.phone && <> phone is now <b>{drift.phone}</b></>}
              .
            </span>
            <span className="ml-auto flex gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setForm((f) => ({
                    ...f,
                    ...(drift.email ? { business_email: drift.email, owner_email: drift.email } : {}),
                    ...(drift.phone ? { business_phone: drift.phone, owner_phone: drift.phone } : {}),
                  }));
                  setDrift(null);
                }}
                className="px-2.5 py-1 rounded bg-amber-600 text-white font-semibold hover:bg-amber-700"
              >
                Use updated info
              </button>
              <button type="button" onClick={() => setDrift(null)} className="px-2 py-1 rounded text-amber-700 dark:text-amber-300 underline">
                keep as-is
              </button>
            </span>
          </div>
        )}

        {/* Body */}
        <div className="p-5 overflow-y-auto flex-1">
          {loading ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : (
            <>
              {tab === "business" && (
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2"><Label req>Business legal name</Label>
                    <input className={inputCls} value={form.business_legal_name} onChange={(e) => set("business_legal_name", e.target.value)} /></div>
                  <div><Label>DBA (if any)</Label>
                    <input className={inputCls} value={form.business_dba} onChange={(e) => set("business_dba", e.target.value)} /></div>
                  {/* Fixed vocabulary — these values ARE the GHL picklist. Free text here
                      put garbage on a legal document. */}
                  <div><Label req>Entity type</Label>
                    <select className={inputCls} value={form.business_type} onChange={(e) => set("business_type", e.target.value)}>
                      <option value="">Select…</option>
                      {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select></div>
                  <div><Label req>EIN</Label>
                    <input className={inputCls} placeholder="XX-XXXXXXX" value={form.ein} onChange={(e) => set("ein", e.target.value)} /></div>
                  <div><Label req>Business start date</Label>
                    <input
                      type="date"
                      className={inputCls}
                      value={form.business_start_date}
                      onChange={(e) => { set("business_start_date", e.target.value); setStartDateFrom(null); }}
                    />
                    {/* An estimate, shown AS an estimate. The vendor answered "how long
                        have you owned it", which is not an incorporation date. */}
                    {startDateFrom && form.business_start_date && (
                      <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                        Estimated from "{startDateFrom}" — confirm with the merchant.
                      </p>
                    )}
                  </div>
                  <div><Label req>Industry</Label>
                    <input className={inputCls} value={form.industry} onChange={(e) => set("industry", e.target.value)} /></div>
                  <div><Label req>Business phone</Label>
                    <input className={inputCls} value={form.business_phone} onChange={(e) => set("business_phone", e.target.value)} /></div>
                  <div className="sm:col-span-2"><Label req>Business email (where the app is sent)</Label>
                    <input type="email" className={inputCls} value={form.business_email} onChange={(e) => set("business_email", e.target.value)} /></div>
                  <div className="sm:col-span-2"><Label req>Business street address</Label>
                    <input className={inputCls} value={form.business_address} onChange={(e) => set("business_address", e.target.value)} /></div>
                  <div><Label req>City</Label>
                    <input className={inputCls} value={form.business_city} onChange={(e) => set("business_city", e.target.value)} /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label req>State</Label>
                      <input className={inputCls} maxLength={2} value={form.business_state} onChange={(e) => set("business_state", e.target.value.toUpperCase())} /></div>
                    <div><Label req>ZIP</Label>
                      <input className={inputCls} value={form.business_zip} onChange={(e) => set("business_zip", e.target.value)} /></div>
                  </div>
                  <div><Label>Website</Label>
                    <input className={inputCls} placeholder="https://…" value={form.business_website} onChange={(e) => set("business_website", e.target.value)} /></div>
                </div>
              )}

              {tab === "owner" && (
                <div className="grid sm:grid-cols-2 gap-4">
                  <div><Label req>First name</Label>
                    <input className={inputCls} value={form.owner_first_name} onChange={(e) => set("owner_first_name", e.target.value)} /></div>
                  <div><Label req>Last name</Label>
                    <input className={inputCls} value={form.owner_last_name} onChange={(e) => set("owner_last_name", e.target.value)} /></div>
                  <div><Label req>Title</Label>
                    <input className={inputCls} placeholder="Owner, President…" value={form.owner_title} onChange={(e) => set("owner_title", e.target.value)} /></div>
                  <div><Label req>Ownership %</Label>
                    <input type="number" className={inputCls} value={form.owner_ownership_pct} onChange={(e) => set("owner_ownership_pct", e.target.value)} /></div>
                  {/* Optional on purpose — a merchant who won't read their SSN out on a
                      first call must not block the entire application. */}
                  <div><Label>SSN</Label>
                    <input className={inputCls} placeholder="•••-••-••••" value={form.owner_ssn} onChange={(e) => set("owner_ssn", e.target.value)} />
                    {!form.owner_ssn.trim() && (
                      <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                        Blank prints as a raw tag on the signed document.
                      </p>
                    )}
                  </div>
                  <div><Label req>Date of birth</Label>
                    <input type="date" className={inputCls} value={form.owner_dob} onChange={(e) => set("owner_dob", e.target.value)} /></div>
                  <div><Label req>Email</Label>
                    <input type="email" className={inputCls} value={form.owner_email} onChange={(e) => set("owner_email", e.target.value)} /></div>
                  <div><Label req>Cell phone</Label>
                    <input className={inputCls} value={form.owner_phone} onChange={(e) => set("owner_phone", e.target.value)} /></div>
                  <div className="sm:col-span-2"><Label req>Home address</Label>
                    <input className={inputCls} value={form.owner_home_address} onChange={(e) => set("owner_home_address", e.target.value)} /></div>
                  <div><Label req>City</Label>
                    <input className={inputCls} value={form.owner_home_city} onChange={(e) => set("owner_home_city", e.target.value)} /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label req>State</Label>
                      <input className={inputCls} maxLength={2} value={form.owner_home_state} onChange={(e) => set("owner_home_state", e.target.value.toUpperCase())} /></div>
                    <div><Label req>ZIP</Label>
                      <input className={inputCls} value={form.owner_home_zip} onChange={(e) => set("owner_home_zip", e.target.value)} /></div>
                  </div>
                  <div><Label>Driver's license #</Label>
                    <input className={inputCls} value={form.owner_dl_number} onChange={(e) => set("owner_dl_number", e.target.value)} /></div>
                  <div><Label>DL state</Label>
                    <input className={inputCls} maxLength={2} value={form.owner_dl_state} onChange={(e) => set("owner_dl_state", e.target.value.toUpperCase())} /></div>
                </div>
              )}

              {tab === "banking" && (
                <div className="space-y-4">
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    The application requires the merchant's primary business bank account. Get it while they're on the phone.
                  </p>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div><Label req>Bank name</Label>
                      <input className={inputCls} value={form.bank_name} onChange={(e) => set("bank_name", e.target.value)} /></div>
                    <div><Label>Account type</Label>
                      <select className={inputCls} value={form.bank_account_type} onChange={(e) => set("bank_account_type", e.target.value)}>
                        <option value="Checking">Checking</option>
                        <option value="Savings">Savings</option>
                      </select></div>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div><Label req>Routing number</Label>
                      <input className={inputCls} value={form.bank_routing_number} onChange={(e) => set("bank_routing_number", e.target.value)} /></div>
                    <div><Label req>Account number</Label>
                      <input className={inputCls} value={form.bank_account_number} onChange={(e) => set("bank_account_number", e.target.value)} /></div>
                  </div>
                </div>
              )}

              {tab === "funding" && (
                <div className="grid sm:grid-cols-2 gap-4">
                  <div><Label req>Amount requested ($)</Label>
                    <input type="number" className={inputCls} placeholder="50000" value={form.amount_requested} onChange={(e) => set("amount_requested", e.target.value)} /></div>
                  <div><Label req>Monthly revenue ($)</Label>
                    <input type="number" className={inputCls} placeholder="25000" value={form.monthly_revenue} onChange={(e) => set("monthly_revenue", e.target.value)} /></div>
                  <div><Label>Average daily balance ($)</Label>
                    <input type="number" className={inputCls} value={form.average_daily_balance} onChange={(e) => set("average_daily_balance", e.target.value)} /></div>
                  <div><Label># of existing positions</Label>
                    <input type="number" className={inputCls} placeholder="0" value={form.existing_positions} onChange={(e) => set("existing_positions", e.target.value)} /></div>
                  <div><Label>Existing MCA balance ($)</Label>
                    <input type="number" className={inputCls} value={form.existing_balance} onChange={(e) => set("existing_balance", e.target.value)} /></div>

                  {/* Business financials — the PDF's "Business Financial Information"
                      section. All optional (fill-ins on the real application). */}
                  <div className="sm:col-span-2 mt-1 pt-3 border-t border-gray-200 dark:border-gray-700">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Business financials</h4>
                  </div>
                  <div><Label>Annual gross revenue ($)</Label>
                    <input type="number" className={inputCls} placeholder="300000" value={form.annual_gross_revenue} onChange={(e) => set("annual_gross_revenue", e.target.value)} /></div>
                  <div><Label>Average monthly deposits ($)</Label>
                    <input type="number" className={inputCls} placeholder="25000" value={form.average_monthly_deposits} onChange={(e) => set("average_monthly_deposits", e.target.value)} /></div>
                  <div><Label>Number of employees</Label>
                    <input type="number" className={inputCls} placeholder="0" value={form.number_of_employees} onChange={(e) => set("number_of_employees", e.target.value)} /></div>
                  <div className="hidden sm:block" />
                  <div><Label>Prior bankruptcy?</Label>
                    <select className={inputCls} value={form.has_bankruptcy} onChange={(e) => set("has_bankruptcy", e.target.value)}>
                      <option value="">—</option>
                      <option value="no">No</option>
                      <option value="yes">Yes</option>
                    </select></div>
                  {form.has_bankruptcy === "yes" && (
                    <div><Label>Bankruptcy details</Label>
                      <input className={inputCls} placeholder="Year / chapter / status" value={form.bankruptcy_details} onChange={(e) => set("bankruptcy_details", e.target.value)} /></div>
                  )}
                  {form.has_bankruptcy !== "yes" && <div className="hidden sm:block" />}
                  <div><Label>Tax liens / judgments?</Label>
                    <select className={inputCls} value={form.has_tax_liens} onChange={(e) => set("has_tax_liens", e.target.value)}>
                      <option value="">—</option>
                      <option value="no">No</option>
                      <option value="yes">Yes</option>
                    </select></div>
                  {form.has_tax_liens === "yes" && (
                    <div><Label>Tax lien details</Label>
                      <input className={inputCls} placeholder="Amount / payment plan" value={form.tax_lien_details} onChange={(e) => set("tax_lien_details", e.target.value)} /></div>
                  )}
                  {form.has_tax_liens !== "yes" && <div className="hidden sm:block" />}

                  <div className="sm:col-span-2 pt-1"><Label req>Use of funds</Label>
                    <input className={inputCls} placeholder="Working capital, payroll, inventory…" value={form.use_of_funds} onChange={(e) => set("use_of_funds", e.target.value)} /></div>
                  <div className="sm:col-span-2"><Label>Notes</Label>
                    <textarea className={`${inputCls} h-20`} value={form.notes} onChange={(e) => set("notes", e.target.value)} /></div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 rounded-b-xl">
          {/* ── GHL SENT THE WRONG TEMPLATE. ──
              The document is already with the merchant. Retrying only mints a second
              wrong one, so the send buttons are locked and the only useful action is a
              phone call. This is the alarm that did not exist on 2026-07-13. */}
          {wrongTemplate && (
            <div className="mb-3 rounded-lg border-2 border-red-500 bg-red-50 dark:bg-red-950/40 p-3">
              <p className="text-sm font-bold text-red-700 dark:text-red-300">
                ⚠ WRONG DOCUMENT SENT — do not send again
              </p>
              <p className="mt-1 text-[13px] text-red-700 dark:text-red-300">
                GHL was asked for <b>{wrongTemplate.expected}</b> but actually created{" "}
                <b>{wrongTemplate.got ?? "an unrecognized document"}</b>.
              </p>
              <p className="mt-1.5 text-[13px] text-red-700 dark:text-red-300">
                <u>Call the merchant now and tell them not to sign it.</u> The deal was{" "}
                <b>not</b> marked as sent. A GHL workflow is sending the wrong template and must be
                fixed before any further application goes out.
              </p>
            </div>
          )}

          {/* Post-send verification: what GHL ACTUALLY sent, read back from GHL. */}
          {sendResult && !wrongTemplate && (
            sendResult.verification === "confirmed" ? (
              <div className="mb-3 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 p-3">
                <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
                  <CheckCircleIcon className="w-4 h-4" />
                  Confirmed — GHL sent <b>{sendResult.template}</b>
                </p>
                <p className="mt-0.5 text-[12px] text-emerald-700/80 dark:text-emerald-400/80">
                  Read back from GHL after the send. The merchant has the right document.
                </p>
              </div>
            ) : (
              <div className="mb-3 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3">
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                  Sent — awaiting confirmation
                </p>
                <p className="mt-0.5 text-[12px] text-amber-800/90 dark:text-amber-300/90">
                  The merchant was enrolled, but GHL had not created the document yet when we checked
                  (expected <b>{sendResult.expected}</b>). This is usually just GHL being slow. Confirm it
                  landed in GHL → Documents &amp; Contracts.
                </p>
              </div>
            )
          )}

          {error && <p className="text-sm text-red-600 mb-3 whitespace-pre-line">{error}</p>}
          {pendingNote && (
            <button
              type="button"
              onClick={retryCoverNote}
              disabled={busy === "send"}
              className="mb-3 px-3 py-1.5 text-sm rounded-lg border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-950"
            >
              {busy === "send" ? "Retrying…" : "Retry cover note only"}
            </button>
          )}
          {toast && (
            <p className="text-sm text-emerald-600 mb-3 flex items-center gap-1.5">
              <CheckCircleIcon className="w-4 h-4" /> {toast}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="max-w-md">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                <span className="text-red-500">*</span> required. Sending emails the merchant their application to review +
                e-sign (via GHL Documents & Contracts) and moves the deal to <b>Application Sent</b>.
              </p>
              {!canSend ? (
                <p className="text-xs font-medium text-red-600 dark:text-red-400 mt-1">
                  {missingRequired.length} required field{missingRequired.length === 1 ? "" : "s"} left before you can send
                  {" "}({(["business", "owner", "banking", "funding"] as Tab[])
                    .filter((t) => missingByTab[t] > 0)
                    .map((t) => `${TAB_LABEL[t]}: ${missingByTab[t]}`)
                    .join(" · ")}). Draft saves partial.
                </p>
              ) : (
                <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400 mt-1">
                  All required fields complete — ready to send.
                </p>
              )}
              {/* SSN + DL are optional, and this is the ONE consequence of leaving them
                  blank on the FULL-prefill (04B) doc, whose lines are merge tags. A
                  warning, not a gate — the closer decides. */}
              {(!form.owner_ssn.trim() || !form.owner_dl_number.trim()) && (
                <p className="text-xs font-medium text-amber-600 dark:text-amber-400 mt-1">
                  ⚠ {[!form.owner_ssn.trim() && "SSN", !form.owner_dl_number.trim() && "Driver's license #"]
                    .filter(Boolean)
                    .join(" and ")}{" "}
                  blank — will print as a raw tag on the prefilled (04B) document. Fine on a partial send.
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {/* A send happened — let the closer leave having SEEN the verdict. */}
              {sendResult && !wrongTemplate && (
                <button
                  type="button"
                  onClick={onSent}
                  className="text-sm font-semibold px-4 py-2 rounded-lg bg-emerald-600 text-white hover:opacity-90"
                >
                  Done
                </button>
              )}
              <button
                type="button"
                onClick={saveDraft}
                disabled={busy !== null || loading}
                className="text-sm font-semibold px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-white dark:hover:bg-gray-700 disabled:opacity-50"
              >
                {busy === "save" ? "Saving…" : "Save draft"}
              </button>
              <button
                type="button"
                onClick={sendToMerchant}
                disabled={busy !== null || loading || !canSend || sendLocked}
                title={
                  sendLocked
                    ? "Locked — GHL sent the wrong document. Fix the GHL workflow before sending again."
                    : canSend ? "Send the application to the merchant to e-sign" : "Fill all required (*) fields first"
                }
                className="text-sm font-semibold px-4 py-2 rounded-lg bg-ocean-blue text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
              >
                <PaperAirplaneIcon className="w-4 h-4" />
                {busy === "send" ? "Sending…" : "Send to merchant to e-sign"}
              </button>
            </div>
          </div>
          {/* PATH 1 — SELF-FILL. The other real business case: we could NOT get the
              merchant on the phone, so send them the ORIGINAL fillable application to
              complete themselves. Two-click arm/confirm — it can't fire by accident, and
              it deliberately has no required-field gate, because there is nothing to
              pre-fill. push-application-to-ghl enrolls MCA 04 directly, so this delivers
              the fillable template, not the prefill one. */}
          {/* PATH 3 — 04C PARTIAL: the default for a normal lead. Zero typing: we prefill
              what the vendor told us; the merchant completes EIN/SSN/addresses/banking on
              the document itself. */}
          <div className="mt-3 flex items-center justify-end gap-2 rounded-lg border border-mint-green/40 bg-mint-green/5 px-3 py-2">
            <p className="text-xs text-gray-600 dark:text-gray-300 mr-auto">
              <b>Fastest path:</b> send it now with the lead's info prefilled — the merchant completes
              the rest (EIN, SSN, banking) and signs. No form needed.
            </p>
            <button
              type="button"
              onClick={sendPartial}
              disabled={busy !== null || loading}
              title="Send the 04C partial application — lead fields prefilled, merchant completes the rest"
              className="text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50 inline-flex items-center gap-1.5 bg-mint-green text-white hover:opacity-90"
            >
              <PaperAirplaneIcon className="w-4 h-4" />
              {busy === "send" ? "Sending…" : "Send partial (merchant completes the rest)"}
            </button>
          </div>

          <div className="mt-3 flex items-center justify-end gap-2">
            <p className="text-xs text-gray-400 mr-auto">
              Couldn't reach them? Send the blank application for the merchant to fill in and sign themselves.
            </p>
            <button
              type="button"
              onClick={sendBlank}
              disabled={busy !== null || loading || sendLocked}
              title={sendLocked
                ? "Locked — GHL sent the wrong document. Fix the GHL workflow before sending again."
                : "Send the ORIGINAL fillable application — the merchant completes and e-signs it themselves"}
              className={`text-sm font-semibold px-4 py-2 rounded-lg border disabled:opacity-50 inline-flex items-center gap-1.5 ${
                blankArmed
                  ? "border-amber-500 bg-amber-500 text-white hover:opacity-90"
                  : "border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-white dark:hover:bg-gray-700"
              }`}
            >
              <PaperAirplaneIcon className="w-4 h-4" />
              {busy === "send" && blankArmed
                ? "Sending…"
                : blankArmed
                  ? "Click again to confirm — send blank"
                  : "Send blank app (merchant fills it in)"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
