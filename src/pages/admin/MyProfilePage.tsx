import { useState, useEffect } from "react";
import {
  UserCircleIcon,
  MapPinIcon,
  BriefcaseIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { useUserProfile } from "../../context/UserProfileContext";
import { updateMyProfile, type EditableProfileFields } from "../../services/profileService";

type TabId = "personal" | "address" | "business";

const TABS: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "personal", label: "Personal", icon: UserCircleIcon },
  { id: "address", label: "Mailing Address", icon: MapPinIcon },
  { id: "business", label: "Business & Tax (1099)", icon: BriefcaseIcon },
];

const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID",
  "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO",
  "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA",
  "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
];

// A compact, common set — enough for a US-based 1099 sales team.
const TIMEZONES = [
  { value: "America/New_York", label: "Eastern (ET)" },
  { value: "America/Chicago", label: "Central (CT)" },
  { value: "America/Denver", label: "Mountain (MT)" },
  { value: "America/Phoenix", label: "Arizona (no DST)" },
  { value: "America/Los_Angeles", label: "Pacific (PT)" },
  { value: "America/Anchorage", label: "Alaska (AKT)" },
  { value: "Pacific/Honolulu", label: "Hawaii (HT)" },
];

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
];

// Local editable shape — all string-based for controlled inputs.
type FormState = {
  first_name: string;
  last_name: string;
  display_name: string;
  phone_number: string;
  date_of_birth: string;
  timezone: string;
  preferred_language: string;
  bio: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  postal_code: string;
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
  date_of_birth: "",
  timezone: "",
  preferred_language: "",
  bio: "",
  address_line1: "",
  address_line2: "",
  city: "",
  state: "",
  postal_code: "",
  company_name: "",
  ein: "",
  business_address: "",
  company_phone: "",
};

export default function MyProfilePage() {
  const { profile, realProfile, refetchProfile } = useUserProfile();
  const [activeTab, setActiveTab] = useState<TabId>("personal");
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Writes always target the real signed-in user (impersonation is view-only),
  // so prefill from realProfile when present. displayed identity uses `profile`.
  const source = realProfile ?? profile;

  useEffect(() => {
    if (!source) return;
    setForm({
      first_name: source.first_name || "",
      last_name: source.last_name || "",
      display_name: source.display_name || "",
      phone_number: source.phone_number || "",
      date_of_birth: source.date_of_birth || "",
      timezone: source.timezone || "",
      preferred_language: source.preferred_language || "",
      bio: source.bio || "",
      address_line1: source.address_line1 || "",
      address_line2: source.address_line2 || "",
      city: source.city || "",
      state: source.state || "",
      postal_code: source.postal_code || "",
      company_name: source.company_name || "",
      ein: source.ein || "",
      business_address: source.business_address || "",
      company_phone: source.company_phone || "",
    });
  }, [source]);

  const set = (key: keyof FormState) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setSuccess(false);
    setError(null);
  };

  const isImpersonating = !!realProfile && !!profile && realProfile.id !== profile.id;

  const handleSave = async () => {
    if (!source?.id) {
      setError("No signed-in user.");
      return;
    }
    setSaving(true);
    setSuccess(false);
    setError(null);
    try {
      // Send the full whitelist on every save — the service normalizes blanks
      // to null and only writes editable columns. This keeps all three tabs in
      // sync regardless of which tab's Save button was pressed.
      const fields: EditableProfileFields = { ...form };
      await updateMyProfile(source.id, fields);
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

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">My Profile</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Keep your personal, mailing, and tax details current. This is your own record —
          only you (and an admin) can see it.
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
                <input type="tel" className="input-field" value={form.phone_number} onChange={set("phone_number")} placeholder="(555) 123-4567" />
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
              <Field label="Email" hint="Contact an admin to change your login email.">
                <input type="email" className="input-field" value={source?.email || ""} disabled />
              </Field>
            </div>
            <Field label="Short bio" hint="Optional — a sentence or two about you.">
              <textarea className="input-field" rows={3} value={form.bio} onChange={set("bio")} placeholder="Closer on the growth-markets team…" />
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
            <Field label="Address line 2" hint="Apt, suite, unit (optional).">
              <input type="text" className="input-field" value={form.address_line2} onChange={set("address_line2")} placeholder="Suite 100" />
            </Field>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="City">
                <input type="text" className="input-field" value={form.city} onChange={set("city")} placeholder="Indianapolis" />
              </Field>
              <Field label="State">
                <select className="input-field" value={form.state} onChange={set("state")}>
                  <option value="">—</option>
                  {US_STATES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </Field>
              <Field label="ZIP / postal code">
                <input type="text" className="input-field" value={form.postal_code} onChange={set("postal_code")} placeholder="46204" />
              </Field>
            </div>
          </div>
        )}

        {activeTab === "business" && (
          <div className="space-y-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Used for your 1099 as an independent contractor. Fill this in if you invoice
              through a business entity; otherwise your personal details are used.
            </p>
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
          </div>
        )}

        {/* Save row — shared across tabs (one save persists all fields). */}
        <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700 flex items-center gap-4">
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
