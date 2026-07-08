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
  existing_positions: "", existing_balance: "", notes: "",
};

// Numeric columns — sent to the DB as numbers (or null), not strings.
const NUMERIC_KEYS: (keyof AppForm)[] = [
  "owner_ownership_pct", "amount_requested", "monthly_revenue", "average_daily_balance", "existing_balance",
];
const INTEGER_KEYS: (keyof AppForm)[] = ["existing_positions"];
const DATE_KEYS: (keyof AppForm)[] = ["business_start_date", "owner_dob"];

type Tab = "business" | "owner" | "banking" | "funding";

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
          next[k] = v === null || v === undefined ? "" : String(v);
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

  // Build the DB payload from the form: trim, drop empties to null, coerce types.
  function payload(): Record<string, unknown> {
    const out: Record<string, unknown> = { deal_id: deal.id, customer_id: deal.customer_id };
    for (const k of Object.keys(form) as (keyof AppForm)[]) {
      const raw = String(form[k] ?? "").trim();
      if (raw === "") { out[k] = null; continue; }
      if (NUMERIC_KEYS.includes(k)) out[k] = Number(raw);
      else if (INTEGER_KEYS.includes(k)) out[k] = parseInt(raw, 10);
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
    setBusy("send");
    setError(null);
    try {
      const id = await persist("sent");

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
  const Label = ({ children }: { children: React.ReactNode }) => (
    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{children}</label>
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

        {/* Tabs */}
        <div className="border-b border-gray-200 dark:border-gray-700 px-5">
          <nav className="flex gap-5">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  tab === t.id ? "border-ocean-blue text-ocean-blue" : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                }`}
              >
                {t.label}
              </button>
            ))}
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
                  <div className="sm:col-span-2"><Label>Business legal name</Label>
                    <input className={inputCls} value={form.business_legal_name} onChange={(e) => set("business_legal_name", e.target.value)} /></div>
                  <div><Label>DBA (if any)</Label>
                    <input className={inputCls} value={form.business_dba} onChange={(e) => set("business_dba", e.target.value)} /></div>
                  <div><Label>Entity type</Label>
                    <input className={inputCls} placeholder="LLC, Corp, Sole Prop…" value={form.business_type} onChange={(e) => set("business_type", e.target.value)} /></div>
                  <div><Label>EIN</Label>
                    <input className={inputCls} placeholder="XX-XXXXXXX" value={form.ein} onChange={(e) => set("ein", e.target.value)} /></div>
                  <div><Label>Business start date</Label>
                    <input type="date" className={inputCls} value={form.business_start_date} onChange={(e) => set("business_start_date", e.target.value)} /></div>
                  <div><Label>Industry</Label>
                    <input className={inputCls} value={form.industry} onChange={(e) => set("industry", e.target.value)} /></div>
                  <div><Label>Business phone</Label>
                    <input className={inputCls} value={form.business_phone} onChange={(e) => set("business_phone", e.target.value)} /></div>
                  <div className="sm:col-span-2"><Label>Business email (where the app is sent)</Label>
                    <input type="email" className={inputCls} value={form.business_email} onChange={(e) => set("business_email", e.target.value)} /></div>
                  <div className="sm:col-span-2"><Label>Business street address</Label>
                    <input className={inputCls} value={form.business_address} onChange={(e) => set("business_address", e.target.value)} /></div>
                  <div><Label>City</Label>
                    <input className={inputCls} value={form.business_city} onChange={(e) => set("business_city", e.target.value)} /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>State</Label>
                      <input className={inputCls} maxLength={2} value={form.business_state} onChange={(e) => set("business_state", e.target.value.toUpperCase())} /></div>
                    <div><Label>ZIP</Label>
                      <input className={inputCls} value={form.business_zip} onChange={(e) => set("business_zip", e.target.value)} /></div>
                  </div>
                </div>
              )}

              {tab === "owner" && (
                <div className="grid sm:grid-cols-2 gap-4">
                  <div><Label>First name</Label>
                    <input className={inputCls} value={form.owner_first_name} onChange={(e) => set("owner_first_name", e.target.value)} /></div>
                  <div><Label>Last name</Label>
                    <input className={inputCls} value={form.owner_last_name} onChange={(e) => set("owner_last_name", e.target.value)} /></div>
                  <div><Label>Title</Label>
                    <input className={inputCls} placeholder="Owner, President…" value={form.owner_title} onChange={(e) => set("owner_title", e.target.value)} /></div>
                  <div><Label>Ownership %</Label>
                    <input type="number" className={inputCls} value={form.owner_ownership_pct} onChange={(e) => set("owner_ownership_pct", e.target.value)} /></div>
                  <div><Label>SSN</Label>
                    <input className={inputCls} placeholder="•••-••-••••" value={form.owner_ssn} onChange={(e) => set("owner_ssn", e.target.value)} /></div>
                  <div><Label>Date of birth</Label>
                    <input type="date" className={inputCls} value={form.owner_dob} onChange={(e) => set("owner_dob", e.target.value)} /></div>
                  <div><Label>Email</Label>
                    <input type="email" className={inputCls} value={form.owner_email} onChange={(e) => set("owner_email", e.target.value)} /></div>
                  <div><Label>Phone</Label>
                    <input className={inputCls} value={form.owner_phone} onChange={(e) => set("owner_phone", e.target.value)} /></div>
                  <div className="sm:col-span-2"><Label>Home address</Label>
                    <input className={inputCls} value={form.owner_home_address} onChange={(e) => set("owner_home_address", e.target.value)} /></div>
                  <div><Label>City</Label>
                    <input className={inputCls} value={form.owner_home_city} onChange={(e) => set("owner_home_city", e.target.value)} /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>State</Label>
                      <input className={inputCls} maxLength={2} value={form.owner_home_state} onChange={(e) => set("owner_home_state", e.target.value.toUpperCase())} /></div>
                    <div><Label>ZIP</Label>
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
                    Optional — funders confirm banking from the statements. Capture it if the merchant reads it to you.
                  </p>
                  <div><Label>Bank name</Label>
                    <input className={inputCls} value={form.bank_name} onChange={(e) => set("bank_name", e.target.value)} /></div>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div><Label>Routing number</Label>
                      <input className={inputCls} value={form.bank_routing_number} onChange={(e) => set("bank_routing_number", e.target.value)} /></div>
                    <div><Label>Account number</Label>
                      <input className={inputCls} value={form.bank_account_number} onChange={(e) => set("bank_account_number", e.target.value)} /></div>
                  </div>
                </div>
              )}

              {tab === "funding" && (
                <div className="grid sm:grid-cols-2 gap-4">
                  <div><Label>Amount requested ($)</Label>
                    <input type="number" className={inputCls} placeholder="50000" value={form.amount_requested} onChange={(e) => set("amount_requested", e.target.value)} /></div>
                  <div><Label>Monthly revenue ($)</Label>
                    <input type="number" className={inputCls} placeholder="25000" value={form.monthly_revenue} onChange={(e) => set("monthly_revenue", e.target.value)} /></div>
                  <div><Label>Average daily balance ($)</Label>
                    <input type="number" className={inputCls} value={form.average_daily_balance} onChange={(e) => set("average_daily_balance", e.target.value)} /></div>
                  <div><Label># of existing positions</Label>
                    <input type="number" className={inputCls} placeholder="0" value={form.existing_positions} onChange={(e) => set("existing_positions", e.target.value)} /></div>
                  <div><Label>Existing MCA balance ($)</Label>
                    <input type="number" className={inputCls} value={form.existing_balance} onChange={(e) => set("existing_balance", e.target.value)} /></div>
                  <div className="sm:col-span-2"><Label>Use of funds</Label>
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
            <p className="text-xs text-gray-500 dark:text-gray-400 max-w-sm">
              Sending emails the merchant their application to review + e-sign (via GHL Documents & Contracts) and
              moves the deal to <b>Application Sent</b>.
            </p>
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
                disabled={busy !== null || loading}
                className="text-sm font-semibold px-4 py-2 rounded-lg bg-ocean-blue text-white hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5"
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
