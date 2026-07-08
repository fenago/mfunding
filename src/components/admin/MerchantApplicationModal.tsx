// MerchantApplicationModal — the closer fills the merchant's MCA application
// IN-APP while they're on the phone (pre-filled from the customer + deal), saves
// it to public.mca_applications, then sends it to the merchant to e-sign.
//
// This replaces the old "Send the application" behavior, which just opened the
// merchant's GHL contact in a new tab — the closer had to retype everything into
// GHL and nothing was stored in our own system. Now: fill once here, it's saved,
// and one click sends it out.
//
// E-SIGN NOTE: the formal embedded signature is still executed by GHL Documents
// & Contracts, fired by moving the deal to the Application Sent stage (the MCA 04
// automation emails the merchant the app + disclosure + upload link). "Send to
// merchant to e-sign" does exactly that move, PLUS emails a personal cover note
// through the existing send-merchant-email transport so it lands in the merchant's
// Conversations thread. TODO: when a native embedded e-sign exists, deliver a
// direct signing link here instead of relying on the GHL automation.

import { useEffect, useMemo, useState } from "react";
import { XMarkIcon, DocumentTextIcon, PaperAirplaneIcon, CheckCircleIcon } from "@heroicons/react/24/outline";
import supabase from "../../supabase";
import { mustWrite, tryWrite } from "@/supabase/writes";
import { updateDealStatus } from "../../services/dealService";
import type { DealWithCustomer } from "../../types/deals";

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
  business_zip: "", industry: "",
  owner_first_name: "", owner_last_name: "", owner_title: "", owner_ownership_pct: "", owner_ssn: "",
  owner_dob: "", owner_email: "", owner_phone: "", owner_home_address: "", owner_home_city: "",
  owner_home_state: "", owner_home_zip: "", owner_dl_number: "", owner_dl_state: "",
  bank_name: "", bank_routing_number: "", bank_account_number: "",
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
const REQUIRED_KEYS: (keyof AppForm)[] = [
  // Business
  "business_legal_name", "business_type", "ein", "business_start_date", "industry",
  "business_phone", "business_email", "business_address", "business_city", "business_state", "business_zip",
  // Owner / guarantor
  "owner_first_name", "owner_last_name", "owner_title", "owner_ownership_pct", "owner_ssn", "owner_dob",
  "owner_dl_number", "owner_email", "owner_phone",
  "owner_home_address", "owner_home_city", "owner_home_state", "owner_home_zip",
  // Banking
  "bank_name", "bank_routing_number", "bank_account_number",
  // Funding request
  "amount_requested", "use_of_funds", "monthly_revenue",
];

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
  business_zip: "Business ZIP", industry: "Industry",
  owner_first_name: "Owner first name", owner_last_name: "Owner last name", owner_title: "Owner title",
  owner_ownership_pct: "Ownership %", owner_ssn: "Owner SSN", owner_dob: "Owner date of birth",
  owner_email: "Owner email", owner_phone: "Owner phone", owner_home_address: "Home address",
  owner_home_city: "Home city", owner_home_state: "Home state", owner_home_zip: "Home ZIP",
  owner_dl_number: "Driver's license #", owner_dl_state: "DL state",
  bank_name: "Bank name", bank_routing_number: "Routing number", bank_account_number: "Account number",
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
  const [tab, setTab] = useState<Tab>("business");
  const [loading, setLoading] = useState(true);
  const [existingId, setExistingId] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "send" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const cust = deal.customer;

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
      } else {
        // Fresh — seed from what we already have on the customer + deal.
        setForm({
          ...EMPTY,
          business_legal_name: cust?.business_name ?? "",
          business_email: cust?.email ?? "",
          business_phone: cust?.phone ?? "",
          industry: cust?.industry ?? "",
          owner_first_name: cust?.first_name ?? "",
          owner_last_name: cust?.last_name ?? "",
          owner_email: cust?.email ?? "",
          owner_phone: cust?.phone ?? "",
          amount_requested: deal.amount_requested != null ? String(deal.amount_requested) : "",
          use_of_funds: deal.use_of_funds ?? "",
          monthly_revenue: cust?.monthly_revenue != null ? String(cust.monthly_revenue) : "",
        });
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
    setBusy("send");
    setError(null);
    try {
      const id = await persist("sent");

      // CRITICAL: push the application into the merchant's GHL contact custom
      // fields (the source the e-sign document MERGES from) BEFORE anything else.
      // If this fails we STOP — advancing the stage fires the GHL doc automation,
      // and without this push the merchant would e-sign a BLANK application.
      const { data: pushData, error: pushErr } = await supabase.functions.invoke("push-application-to-ghl", {
        body: { dealId: deal.id },
      });
      if (pushErr) throw pushErr;
      if ((pushData as { error?: string })?.error) throw new Error((pushData as { error?: string }).error);

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
        `Most of it is already filled in — you just need to confirm and sign. It takes about three minutes. ` +
        `Reply here if anything looks off or you have questions.\n\n` +
        `Talk soon.`;

      const { data, error: fnErr } = await supabase.functions.invoke("send-merchant-email", {
        body: { dealId: deal.id, subject, body: emailBody, regarding: "MCA application" },
      });
      if (fnErr) throw fnErr;
      if ((data as { error?: string })?.error) throw new Error((data as { error?: string }).error);

      // Stamp who/when sent (best-effort — the send already went out).
      const { data: auth } = await supabase.auth.getUser();
      await tryWrite(
        "stamp application sent",
        supabase
          .from("mca_applications")
          .update({ sent_to_merchant_at: new Date().toISOString(), sent_by: auth?.user?.id ?? null })
          .eq("id", id),
      );

      // Advance the deal → Application Sent (fires MCA 04). Forward-only guard in
      // updateDealStatus is fine; if it's already past this stage it no-ops.
      try { await updateDealStatus(deal.id, "application_sent"); } catch { /* stage already ahead */ }

      onSent();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the application.");
      setBusy(null);
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
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
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
                  <div><Label req>Entity type</Label>
                    <input className={inputCls} placeholder="LLC, Corp, Sole Prop…" value={form.business_type} onChange={(e) => set("business_type", e.target.value)} /></div>
                  <div><Label req>EIN</Label>
                    <input className={inputCls} placeholder="XX-XXXXXXX" value={form.ein} onChange={(e) => set("ein", e.target.value)} /></div>
                  <div><Label req>Business start date</Label>
                    <input type="date" className={inputCls} value={form.business_start_date} onChange={(e) => set("business_start_date", e.target.value)} /></div>
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
                  <div><Label req>SSN</Label>
                    <input className={inputCls} placeholder="•••-••-••••" value={form.owner_ssn} onChange={(e) => set("owner_ssn", e.target.value)} /></div>
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
                  <div><Label req>Driver's license #</Label>
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
                  <div><Label req>Bank name</Label>
                    <input className={inputCls} value={form.bank_name} onChange={(e) => set("bank_name", e.target.value)} /></div>
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
          {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
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
            </div>
            <div className="flex items-center gap-2">
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
                disabled={busy !== null || loading || !canSend}
                title={canSend ? "Send the application to the merchant to e-sign" : "Fill all required (*) fields first"}
                className="text-sm font-semibold px-4 py-2 rounded-lg bg-ocean-blue text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
              >
                <PaperAirplaneIcon className="w-4 h-4" />
                {busy === "send" ? "Sending…" : "Send to merchant to e-sign"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
