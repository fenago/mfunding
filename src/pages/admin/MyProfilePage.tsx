import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  UserCircleIcon,
  MapPinIcon,
  BanknotesIcon,
  DocumentTextIcon,
  CheckCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  LockClosedIcon,
} from "@heroicons/react/24/outline";
import { useUserProfile } from "../../context/UserProfileContext";
import { updateMyProfile, type EditableProfileFields } from "../../services/profileService";
import {
  getMyPayout,
  upsertMyPayout,
  type EditablePayoutFields,
  type PayoutProfile,
} from "../../services/payoutService";
import {
  getMyCloser,
  getCloserDocuments,
  materializeMyDoc,
  type DocStatus,
} from "../../services/closerDocsService";
import TimePayTab from "../../components/admin/time/TimePayTab";

type TabId = "personal" | "address" | "payment" | "tax" | "time";

const TABS: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "personal", label: "Personal", icon: UserCircleIcon },
  { id: "address", label: "Mailing Address", icon: MapPinIcon },
  { id: "payment", label: "Payment", icon: BanknotesIcon },
  { id: "tax", label: "Tax", icon: DocumentTextIcon },
  { id: "time", label: "Time & Pay", icon: ClockIcon },
];

const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID",
  "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO",
  "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA",
  "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
];

// Value === label so `country` stores a display string. The tax fork keys on
// "United States"; everything else is treated as a foreign contractor (W-8BEN).
const COUNTRIES = [
  "Philippines",
  "United States",
  "India",
  "Mexico",
  "Canada",
  "United Kingdom",
  "Colombia",
  "Argentina",
  "Brazil",
  "Nigeria",
  "Pakistan",
  "Other",
];

const US_COUNTRY = "United States";
const DEFAULT_COUNTRY = "Philippines";

// A compact, common set — enough for a US-based 1099 sales team.
const TIMEZONES = [
  { value: "America/New_York", label: "Eastern (ET)" },
  { value: "America/Chicago", label: "Central (CT)" },
  { value: "America/Denver", label: "Mountain (MT)" },
  { value: "America/Phoenix", label: "Arizona (no DST)" },
  { value: "America/Los_Angeles", label: "Pacific (PT)" },
  { value: "America/Anchorage", label: "Alaska (AKT)" },
  { value: "Pacific/Honolulu", label: "Hawaii (HT)" },
  { value: "Asia/Manila", label: "Philippines (PHT)" },
];

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
];

const CURRENCIES = ["PHP", "USD"];

const PAYOUT_METHODS: { value: string; label: string }[] = [
  { value: "wise", label: "Wise" },
  { value: "payoneer", label: "Payoneer" },
  { value: "zelle", label: "Zelle" },
  { value: "gcash", label: "GCash" },
  { value: "bank_ph", label: "PH bank transfer" },
  { value: "other", label: "Other" },
];

// Local editable shape — all string-based for controlled inputs.
type FormState = {
  first_name: string;
  last_name: string;
  display_name: string;
  phone_number: string;
  whatsapp_number: string;
  contact_email: string;
  date_of_birth: string;
  timezone: string;
  preferred_language: string;
  bio: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  company_name: string;
  ein: string;
  business_address: string;
  company_phone: string;
};

const EMPTY: FormState = {
  first_name: "",
  last_name: "",
  display_name: "",
  phone_number: "",
  whatsapp_number: "",
  contact_email: "",
  date_of_birth: "",
  timezone: "",
  preferred_language: "",
  bio: "",
  address_line1: "",
  address_line2: "",
  city: "",
  state: "",
  postal_code: "",
  country: "",
  company_name: "",
  ein: "",
  business_address: "",
  company_phone: "",
};

type PayForm = {
  account_holder_name: string;
  currency: string;
  preferred_method: string;
  wise_email: string;
  payoneer_email: string;
  zelle_handle: string;
  zelle_name: string;
  gcash_number: string;
  gcash_name: string;
  bank_name: string;
  bank_account_name: string;
  bank_account_number: string;
  bank_swift_bic: string;
  bank_branch: string;
  other_method_name: string;
  other_method_details: string;
  tax_country: string;
  foreign_tax_id: string;
  foreign_status_certified: boolean;
  payout_notes: string;
};

const EMPTY_PAY: PayForm = {
  account_holder_name: "",
  currency: "PHP",
  preferred_method: "",
  wise_email: "",
  payoneer_email: "",
  zelle_handle: "",
  zelle_name: "",
  gcash_number: "",
  gcash_name: "",
  bank_name: "",
  bank_account_name: "",
  bank_account_number: "",
  bank_swift_bic: "",
  bank_branch: "",
  other_method_name: "",
  other_method_details: "",
  tax_country: "Philippines",
  foreign_tax_id: "",
  foreign_status_certified: false,
  payout_notes: "",
};

export default function MyProfilePage() {
  const { profile, realProfile, refetchProfile } = useUserProfile();
  const [activeTab, setActiveTab] = useState<TabId>("personal");
  const [form, setForm] = useState<FormState>(EMPTY);
  const [pay, setPay] = useState<PayForm>(EMPTY_PAY);
  const [payoutRow, setPayoutRow] = useState<PayoutProfile | null>(null);
  const [payoutLoading, setPayoutLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- Substitute W-8BEN self-service (foreign contractors) ---
  const [w8benRow, setW8benRow] = useState<{ status: DocStatus; signed_at: string | null } | null>(null);
  const [w8benBusy, setW8benBusy] = useState(false);
  const [w8benMissing, setW8benMissing] = useState<{ label: string }[] | null>(null);
  const [w8benErr, setW8benErr] = useState<string | null>(null);
  const [hasCloserRecord, setHasCloserRecord] = useState<boolean | null>(null);

  // Writes always target the real signed-in user (impersonation is view-only),
  // so prefill from realProfile when present. Displayed identity uses `profile`.
  const source = realProfile ?? profile;
  const isImpersonating = !!realProfile && !!profile && realProfile.id !== profile.id;

  useEffect(() => {
    if (!source) return;
    setForm({
      first_name: source.first_name || "",
      last_name: source.last_name || "",
      display_name: source.display_name || "",
      phone_number: source.phone_number || "",
      whatsapp_number: source.whatsapp_number || "",
      contact_email: source.contact_email || "",
      date_of_birth: source.date_of_birth || "",
      timezone: source.timezone || "",
      preferred_language: source.preferred_language || "",
      bio: source.bio || "",
      address_line1: source.address_line1 || "",
      address_line2: source.address_line2 || "",
      city: source.city || "",
      state: source.state || "",
      postal_code: source.postal_code || "",
      // Default these PH-based contractors to Philippines when no country is set.
      country: source.country || DEFAULT_COUNTRY,
      company_name: source.company_name || "",
      ein: source.ein || "",
      business_address: source.business_address || "",
      company_phone: source.company_phone || "",
    });
  }, [source]);

  // Payout data is SENSITIVE — fetched on demand for the real signed-in user
  // only, never through the app-wide profile context.
  useEffect(() => {
    let cancelled = false;
    const uid = source?.id;
    if (!uid) return;
    setPayoutLoading(true);
    getMyPayout(uid)
      .then((row) => {
        if (cancelled) return;
        setPayoutRow(row);
        if (row) {
          setPay({
            account_holder_name: row.account_holder_name || "",
            currency: row.currency || "PHP",
            preferred_method: row.preferred_method || "",
            wise_email: row.wise_email || "",
            payoneer_email: row.payoneer_email || "",
            zelle_handle: row.zelle_handle || "",
            zelle_name: row.zelle_name || "",
            gcash_number: row.gcash_number || "",
            gcash_name: row.gcash_name || "",
            bank_name: row.bank_name || "",
            bank_account_name: row.bank_account_name || "",
            bank_account_number: row.bank_account_number || "",
            bank_swift_bic: row.bank_swift_bic || "",
            bank_branch: row.bank_branch || "",
            other_method_name: row.other_method_name || "",
            other_method_details: row.other_method_details || "",
            tax_country: row.tax_country || DEFAULT_COUNTRY,
            foreign_tax_id: row.foreign_tax_id || "",
            foreign_status_certified: !!row.foreign_status_certified,
            payout_notes: row.payout_notes || "",
          });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("Error fetching payout profile:", err);
        }
      })
      .finally(() => {
        if (!cancelled) setPayoutLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [source?.id]);

  // Load the signed-in contractor's W-8BEN status (real user only — the action
  // always targets the real account, so we never read it while impersonating).
  const refreshW8ben = async () => {
    const me = await getMyCloser();
    setHasCloserRecord(!!me);
    if (!me) { setW8benRow(null); return; }
    const rows = await getCloserDocuments(me.id);
    const w = rows.find((r) => r.doc_slug === "w-8ben") ?? null;
    setW8benRow(w ? { status: w.status, signed_at: w.signed_at } : null);
  };

  useEffect(() => {
    if (isImpersonating) { setW8benRow(null); setHasCloserRecord(null); return; }
    let cancelled = false;
    void (async () => {
      try {
        const me = await getMyCloser();
        if (cancelled) return;
        setHasCloserRecord(!!me);
        if (!me) { setW8benRow(null); return; }
        const rows = await getCloserDocuments(me.id);
        if (cancelled) return;
        const w = rows.find((r) => r.doc_slug === "w-8ben") ?? null;
        setW8benRow(w ? { status: w.status, signed_at: w.signed_at } : null);
      } catch { /* non-fatal; the button will surface any error on click */ }
    })();
    return () => { cancelled = true; };
  }, [source?.id, isImpersonating]);

  const handleGenerateW8ben = async () => {
    setW8benBusy(true);
    setW8benErr(null);
    setW8benMissing(null);
    try {
      const res = await materializeMyDoc("w-8ben");
      if (res.ok) {
        await refreshW8ben();
      } else if (res.blocked?.length) {
        setW8benMissing(res.blocked[0].missing.map((m) => ({ label: m.label })));
      } else {
        setW8benErr(res.error ?? "Could not prepare your W-8BEN.");
      }
    } catch (e) {
      setW8benErr(e instanceof Error ? e.message : "Could not prepare your W-8BEN.");
    } finally {
      setW8benBusy(false);
    }
  };

  const set = (key: keyof FormState) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setSuccess(false);
    setError(null);
  };

  const setPayField = (key: keyof PayForm) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => {
    const value = e.target.type === "checkbox"
      ? (e.target as HTMLInputElement).checked
      : e.target.value;
    setPay((p) => ({ ...p, [key]: value }));
    setSuccess(false);
    setError(null);
  };

  const isUS = form.country === US_COUNTRY;

  const handleSave = async () => {
    if (!source?.id) {
      setError("No signed-in user.");
      return;
    }
    setSaving(true);
    setSuccess(false);
    setError(null);
    try {
      // Persist BOTH the profiles fields and the payout row. Payout keeps tax_country
      // in sync with the profile country so the foreign/US fork stays consistent.
      const profileFields: EditableProfileFields = {
        first_name: form.first_name,
        last_name: form.last_name,
        display_name: form.display_name,
        phone_number: form.phone_number,
        whatsapp_number: form.whatsapp_number,
        contact_email: form.contact_email,
        date_of_birth: form.date_of_birth,
        timezone: form.timezone,
        preferred_language: form.preferred_language,
        bio: form.bio,
        address_line1: form.address_line1,
        address_line2: form.address_line2,
        city: form.city,
        state: form.state,
        postal_code: form.postal_code,
        country: form.country,
        company_name: form.company_name,
        ein: form.ein,
        business_address: form.business_address,
        company_phone: form.company_phone,
      };

      const payFields: EditablePayoutFields = {
        account_holder_name: pay.account_holder_name,
        currency: pay.currency,
        preferred_method: pay.preferred_method || null,
        country: isUS ? US_COUNTRY : "PH",
        wise_email: pay.wise_email,
        payoneer_email: pay.payoneer_email,
        zelle_handle: pay.zelle_handle,
        zelle_name: pay.zelle_name,
        gcash_number: pay.gcash_number,
        gcash_name: pay.gcash_name,
        bank_name: pay.bank_name,
        bank_account_name: pay.bank_account_name,
        bank_account_number: pay.bank_account_number,
        bank_swift_bic: pay.bank_swift_bic,
        bank_branch: pay.bank_branch,
        other_method_name: pay.other_method_name,
        other_method_details: pay.other_method_details,
        // Only foreign contractors carry W-8BEN tax fields.
        tax_country: isUS ? null : (pay.tax_country || DEFAULT_COUNTRY),
        foreign_tax_id: isUS ? null : pay.foreign_tax_id,
        foreign_status_certified: isUS ? false : pay.foreign_status_certified,
        payout_notes: pay.payout_notes,
      };

      await updateMyProfile(source.id, profileFields);
      const savedRow = await upsertMyPayout(source.id, payFields, payoutRow);
      setPayoutRow(savedRow);
      setPay((p) => ({
        ...p,
        foreign_status_certified: !!savedRow.foreign_status_certified,
      }));

      await refetchProfile();
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your profile. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const completed = source?.profile_completed;
  const method = pay.preferred_method;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">My Profile</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Keep your personal, mailing, payment, and tax details current, and check in with your
          hours each day. This is your own record — only you (and MFunding payroll) can see it.
        </p>
      </div>

      {isImpersonating && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700/50 dark:bg-amber-900/20 dark:text-amber-300">
          <ExclamationTriangleIcon className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <span>
            You're viewing the app as another user. Edits here save to{" "}
            <strong>your own</strong> profile ({realProfile?.email}), not theirs.
          </span>
        </div>
      )}

      {!completed && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-800/50 dark:bg-blue-900/20 dark:text-blue-300">
          <ExclamationTriangleIcon className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <span>
            Your profile is incomplete. Add your <strong>first name</strong>,{" "}
            <strong>last name</strong>, and <strong>personal phone</strong> to finish it.
          </span>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-700 mb-6">
        <nav className="flex gap-1 -mb-px">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  isActive
                    ? "border-mint-green text-mint-green"
                    : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600"
                }`}
              >
                <Icon className="w-5 h-5" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        {activeTab === "personal" && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="First name">
                <input type="text" className="input-field" value={form.first_name} onChange={set("first_name")} placeholder="Jane" />
              </Field>
              <Field label="Last name">
                <input type="text" className="input-field" value={form.last_name} onChange={set("last_name")} placeholder="Doe" />
              </Field>
              <Field label="Display name" hint="How your name shows in the app (defaults to your first/last).">
                <input type="text" className="input-field" value={form.display_name} onChange={set("display_name")} placeholder="Jane D." />
              </Field>
              <Field label="Personal phone">
                <input type="tel" className="input-field" value={form.phone_number} onChange={set("phone_number")} placeholder="+63 917 123 4567" />
              </Field>
              <Field label="WhatsApp number" hint="Best number to reach you on WhatsApp (include country code).">
                <input type="tel" className="input-field" value={form.whatsapp_number} onChange={set("whatsapp_number")} placeholder="+63 917 123 4567" />
              </Field>
              <Field label="Alternate / contact email" hint="A backup email — separate from your login email.">
                <input type="email" className="input-field" value={form.contact_email} onChange={set("contact_email")} placeholder="you@personal.com" />
              </Field>
              <Field label="Date of birth">
                <input type="date" className="input-field" value={form.date_of_birth} onChange={set("date_of_birth")} />
              </Field>
              <Field label="Timezone">
                <select className="input-field" value={form.timezone} onChange={set("timezone")}>
                  <option value="">Select a timezone…</option>
                  {TIMEZONES.map((tz) => (
                    <option key={tz.value} value={tz.value}>{tz.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Preferred language">
                <select className="input-field" value={form.preferred_language} onChange={set("preferred_language")}>
                  <option value="">Select…</option>
                  {LANGUAGES.map((l) => (
                    <option key={l.value} value={l.value}>{l.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Login email" hint="Contact an admin to change your login email.">
                <input type="email" className="input-field" value={source?.email || ""} disabled />
              </Field>
            </div>
            <Field label="Short bio" hint="Optional — a sentence or two about you.">
              <textarea className="input-field" rows={3} value={form.bio} onChange={set("bio")} placeholder="Setter on the growth-markets team…" />
            </Field>
          </div>
        )}

        {activeTab === "address" && (
          <div className="space-y-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Your mailing address is used for tax forms and physical mail. Please keep it accurate.
            </p>
            <Field label="Address line 1">
              <input type="text" className="input-field" value={form.address_line1} onChange={set("address_line1")} placeholder="123 Main St" />
            </Field>
            <Field label="Address line 2" hint="Apt, suite, unit, barangay (optional).">
              <input type="text" className="input-field" value={form.address_line2} onChange={set("address_line2")} placeholder="Barangay / Suite 100" />
            </Field>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="City">
                <input type="text" className="input-field" value={form.city} onChange={set("city")} placeholder="Cebu City" />
              </Field>
              <Field label="Country" hint="Sets which tax form applies (US 1099 vs. foreign W-8BEN).">
                <select className="input-field" value={form.country} onChange={set("country")}>
                  {COUNTRIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label={isUS ? "State" : "State / province / region"}>
                {isUS ? (
                  <select className="input-field" value={form.state} onChange={set("state")}>
                    <option value="">—</option>
                    {US_STATES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                ) : (
                  <input type="text" className="input-field" value={form.state} onChange={set("state")} placeholder="Cebu" />
                )}
              </Field>
              <Field label={isUS ? "ZIP code" : "ZIP / postal code"}>
                <input type="text" className="input-field" value={form.postal_code} onChange={set("postal_code")} placeholder={isUS ? "46204" : "6000"} />
              </Field>
            </div>
          </div>
        )}

        {activeTab === "payment" && (
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-300">
              <LockClosedIcon className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <span>
                Your payment details are private — visible only to you and MFunding payroll.
                Every field is optional until you're ready.
              </span>
            </div>

            {payoutLoading ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">Loading your payment details…</p>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Field label="Account holder name" hint="Exactly as it appears on the receiving account.">
                    <input type="text" className="input-field" value={pay.account_holder_name} onChange={setPayField("account_holder_name")} placeholder="Juan D. Dela Cruz" />
                  </Field>
                  <Field label="Payout currency">
                    <select className="input-field" value={pay.currency} onChange={setPayField("currency")}>
                      {CURRENCIES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </Field>
                </div>

                <Field label="How would you like to get paid?">
                  <select className="input-field" value={pay.preferred_method} onChange={setPayField("preferred_method")}>
                    <option value="">Choose a payout method…</option>
                    {PAYOUT_METHODS.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </Field>

                {/* Progressive disclosure — show only the selected method's fields. */}
                {method === "wise" && (
                  <Field label="Wise email" hint="The email tied to your Wise account.">
                    <input type="email" className="input-field" value={pay.wise_email} onChange={setPayField("wise_email")} placeholder="you@wise.com" />
                  </Field>
                )}

                {method === "payoneer" && (
                  <Field label="Payoneer email" hint="The email tied to your Payoneer account.">
                    <input type="email" className="input-field" value={pay.payoneer_email} onChange={setPayField("payoneer_email")} placeholder="you@payoneer.com" />
                  </Field>
                )}

                {method === "zelle" && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Field label="Zelle email or U.S. mobile number" hint="The email or U.S. mobile number enrolled with Zelle.">
                        <input type="text" className="input-field" value={pay.zelle_handle} onChange={setPayField("zelle_handle")} placeholder="you@email.com or (555) 123-4567" />
                      </Field>
                      <Field label="Name on Zelle account">
                        <input type="text" className="input-field" value={pay.zelle_name} onChange={setPayField("zelle_name")} placeholder="Jane Doe" />
                      </Field>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Zelle pays into U.S. bank accounts only.
                    </p>
                  </div>
                )}

                {method === "gcash" && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Field label="GCash number" hint="Your registered GCash mobile number.">
                      <input type="tel" className="input-field" value={pay.gcash_number} onChange={setPayField("gcash_number")} placeholder="0917 123 4567" />
                    </Field>
                    <Field label="Name on GCash">
                      <input type="text" className="input-field" value={pay.gcash_name} onChange={setPayField("gcash_name")} placeholder="Juan Dela Cruz" />
                    </Field>
                  </div>
                )}

                {method === "bank_ph" && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Field label="Bank name">
                      <input type="text" className="input-field" value={pay.bank_name} onChange={setPayField("bank_name")} placeholder="BDO / BPI / Metrobank" />
                    </Field>
                    <Field label="Account name">
                      <input type="text" className="input-field" value={pay.bank_account_name} onChange={setPayField("bank_account_name")} placeholder="Juan Dela Cruz" />
                    </Field>
                    <Field label="Account number">
                      <input type="text" className="input-field" value={pay.bank_account_number} onChange={setPayField("bank_account_number")} placeholder="0012 3456 7890" />
                    </Field>
                    <Field label="Branch" hint="Branch where the account was opened (optional).">
                      <input type="text" className="input-field" value={pay.bank_branch} onChange={setPayField("bank_branch")} placeholder="Cebu — Ayala" />
                    </Field>
                    <Field label="SWIFT / BIC" hint="For international wires (e.g. BNORPHMM).">
                      <input type="text" className="input-field" value={pay.bank_swift_bic} onChange={setPayField("bank_swift_bic")} placeholder="BNORPHMM" />
                    </Field>
                  </div>
                )}

                {method === "other" && (
                  <div className="space-y-4">
                    <Field label="Method name" hint="e.g. Remitly, PayPal, Western Union.">
                      <input type="text" className="input-field" value={pay.other_method_name} onChange={setPayField("other_method_name")} placeholder="Remitly" />
                    </Field>
                    <Field label="Details" hint="Whatever we need to send you money on this method.">
                      <textarea className="input-field" rows={3} value={pay.other_method_details} onChange={setPayField("other_method_details")} placeholder="Account handle, email, phone, or instructions…" />
                    </Field>
                  </div>
                )}

                <Field label="Notes for payroll" hint="Optional — anything else we should know about paying you.">
                  <textarea className="input-field" rows={2} value={pay.payout_notes} onChange={setPayField("payout_notes")} placeholder="e.g. prefer payouts on the 15th…" />
                </Field>
              </>
            )}
          </div>
        )}

        {activeTab === "tax" && (
          <div className="space-y-4">
            <Field label="Tax country" hint="Change your country on the Mailing Address tab, or here — it sets which tax form applies.">
              <select className="input-field" value={form.country} onChange={set("country")}>
                {COUNTRIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Field>

            {isUS ? (
              <>
                <div className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-300">
                  <DocumentTextIcon className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <span>
                    <strong>US contractor (1099).</strong> Fill this in if you invoice through a
                    business entity; otherwise your personal details are used.
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Field label="Company / entity name">
                    <input type="text" className="input-field" value={form.company_name} onChange={set("company_name")} placeholder="Doe Enterprises LLC" />
                  </Field>
                  <Field label="EIN" hint="Employer Identification Number (XX-XXXXXXX).">
                    <input type="text" className="input-field" value={form.ein} onChange={set("ein")} placeholder="XX-XXXXXXX" />
                  </Field>
                  <Field label="Business phone">
                    <input type="tel" className="input-field" value={form.company_phone} onChange={set("company_phone")} placeholder="(555) 987-6543" />
                  </Field>
                </div>
                <Field label="Business address">
                  <textarea className="input-field" rows={3} value={form.business_address} onChange={set("business_address")} placeholder="123 Main St, Suite 100&#10;City, State 12345" />
                </Field>
              </>
            ) : (
              <>
                <div className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-300">
                  <DocumentTextIcon className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <span>
                    <strong>Foreign contractor (W-8BEN).</strong> US companies collect a signed IRS
                    Form W-8BEN from foreign contractors. This records your status; MFunding will
                    send the official W-8BEN to sign.
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Field label="Country of tax residence">
                    <select className="input-field" value={pay.tax_country} onChange={setPayField("tax_country")}>
                      {COUNTRIES.filter((c) => c !== US_COUNTRY).map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Foreign tax ID (TIN)" hint="Your Philippine TIN, or the tax ID for your country.">
                    <input type="text" className="input-field" value={pay.foreign_tax_id} onChange={setPayField("foreign_tax_id")} placeholder="000-000-000-000" />
                  </Field>
                </div>
                <label className="flex items-start gap-3 rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-3 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-mint-green focus:ring-mint-green"
                    checked={pay.foreign_status_certified}
                    onChange={setPayField("foreign_status_certified")}
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    I certify I am <strong>not a U.S. person</strong> for tax purposes.
                    {payoutRow?.foreign_status_certified && payoutRow?.foreign_status_certified_at && (
                      <span className="block text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Certified {new Date(payoutRow.foreign_status_certified_at).toLocaleDateString()}.
                      </span>
                    )}
                  </span>
                </label>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  We never collect an SSN from foreign contractors.
                </p>

                {/* Substitute W-8BEN e-sign — the real action behind the checkbox. */}
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">
                  <div className="flex items-start gap-2">
                    <DocumentTextIcon className="w-5 h-5 flex-shrink-0 mt-0.5 text-gray-500 dark:text-gray-400" />
                    <div>
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">
                        Substitute IRS Form W-8BEN
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        We generate this from your profile details, then you read it and sign it in the
                        app. We keep it on file for our records — it is not tax advice.
                      </p>
                    </div>
                  </div>

                  {w8benRow?.status === "signed" ? (
                    <div className="flex items-center gap-2 rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200">
                      <CheckCircleIcon className="w-5 h-5 flex-shrink-0" />
                      <span>
                        W-8BEN signed
                        {w8benRow.signed_at && <> on {new Date(w8benRow.signed_at).toLocaleDateString()}</>}.
                      </span>
                      <Link to="/admin/closer-docs/w-8ben" className="ml-auto text-xs font-semibold text-ocean-blue hover:underline">
                        View
                      </Link>
                    </div>
                  ) : isImpersonating ? (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Switch out of impersonation to generate your own W-8BEN.
                    </p>
                  ) : hasCloserRecord === false ? (
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      Your contractor record isn&apos;t set up yet — ask an admin to add you before
                      generating your W-8BEN.
                    </p>
                  ) : (
                    <>
                      {w8benMissing && w8benMissing.length > 0 && (
                        <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2">
                          <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">
                            Add these to your profile first, then try again:
                          </p>
                          <ul className="mt-1 space-y-0.5">
                            {w8benMissing.map((m) => (
                              <li key={m.label} className="text-xs text-amber-800 dark:text-amber-200 flex gap-1.5">
                                <span className="opacity-60">▸</span>
                                <span>{m.label}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {w8benErr && (
                        <p className="text-xs text-rose-600 dark:text-rose-400">{w8benErr}</p>
                      )}
                      {w8benRow?.status === "sent" ? (
                        <div className="flex flex-wrap items-center gap-3">
                          <Link to="/admin/closer-docs/w-8ben" className="btn-primary">
                            Open to read &amp; sign
                          </Link>
                          <button
                            onClick={handleGenerateW8ben}
                            disabled={w8benBusy}
                            className="text-xs text-gray-500 dark:text-gray-400 hover:underline disabled:opacity-50"
                          >
                            {w8benBusy ? "Refreshing…" : "Regenerate from current profile"}
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={handleGenerateW8ben}
                          disabled={w8benBusy}
                          className="btn-primary disabled:opacity-50"
                        >
                          {w8benBusy ? "Preparing…" : "Generate & sign my W-8BEN"}
                        </button>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === "time" && (
          <TimePayTab userId={source?.id} isImpersonating={isImpersonating} />
        )}

        {/* Save row — shared across tabs (one save persists profile + payment).
            Time & Pay saves through its own Check in button, so it's hidden there. */}
        <div
          className={`mt-6 pt-4 border-t border-gray-200 dark:border-gray-700 items-center gap-4 ${
            activeTab === "time" ? "hidden" : "flex"
          }`}
        >
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </button>
          {success && (
            <span className="flex items-center gap-1 text-sm text-green-600 dark:text-green-400">
              <CheckCircleIcon className="w-5 h-5" />
              Saved
            </span>
          )}
          {error && (
            <span className="flex items-center gap-1 text-sm text-red-600 dark:text-red-400">
              <ExclamationTriangleIcon className="w-5 h-5" />
              {error}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}
