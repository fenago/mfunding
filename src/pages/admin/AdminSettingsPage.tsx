import { useState, useEffect } from "react";
import {
  UserIcon,
  BellIcon,
  ShieldCheckIcon,
  BuildingOfficeIcon,
  CreditCardIcon,
  CheckIcon,
  DocumentIcon,
} from "@heroicons/react/24/outline";
import { useUserProfile } from "../../context/UserProfileContext";
import supabase from "../../supabase";
import DocumentUploader from "../../components/shared/DocumentUploader";
import DocumentList from "../../components/shared/DocumentList";

interface CompanyDocument {
  id: string;
  document_type: string;
  filename: string;
  storage_path: string;
  file_size: number;
  status: string;
  created_at: string;
}

interface SettingSection {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}

const SETTINGS_SECTIONS: SettingSection[] = [
  {
    id: "profile",
    label: "Profile",
    icon: UserIcon,
    description: "Manage your account information",
  },
  {
    id: "company",
    label: "Company",
    icon: BuildingOfficeIcon,
    description: "Company settings and branding",
  },
  {
    id: "notifications",
    label: "Notifications",
    icon: BellIcon,
    description: "Email and notification preferences",
  },
  {
    id: "security",
    label: "Security",
    icon: ShieldCheckIcon,
    description: "Password and security settings",
  },
  {
    id: "billing",
    label: "Billing",
    icon: CreditCardIcon,
    description: "Subscription and payment info",
  },
];

export default function AdminSettingsPage() {
  const { profile, updateProfile } = useUserProfile();
  const [activeSection, setActiveSection] = useState("profile");
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Profile form state
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  // Company form state
  const [companyName, setCompanyName] = useState("");
  const [businessAddress, setBusinessAddress] = useState("");
  const [companyPhone, setCompanyPhone] = useState("");
  const [ein, setEin] = useState("");

  // Company documents state
  const [companyDocuments, setCompanyDocuments] = useState<CompanyDocument[]>([]);
  const [documentType, setDocumentType] = useState("business_license");

  // Initialize form values when profile loads
  useEffect(() => {
    if (profile) {
      setFirstName(profile.first_name || "");
      setLastName(profile.last_name || "");
      setCompanyName(profile.company_name || "");
      setBusinessAddress(profile.business_address || "");
      setCompanyPhone(profile.company_phone || "");
      setEin(profile.ein || "");
    }
  }, [profile]);

  // Fetch company documents
  useEffect(() => {
    fetchCompanyDocuments();
  }, []);

  const fetchCompanyDocuments = async () => {
    const { data, error } = await supabase
      .from("company_documents")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching company documents:", error);
    } else {
      // Add a status field for DocumentList compatibility
      setCompanyDocuments((data || []).map(doc => ({ ...doc, status: "approved" })));
    }
  };

  const handleDocumentUploadComplete = () => {
    fetchCompanyDocuments();
  };

  const handleDocumentDelete = async (docId: string) => {
    const { error } = await supabase
      .from("company_documents")
      .delete()
      .eq("id", docId);

    if (error) {
      console.error("Error deleting document:", error);
    } else {
      setCompanyDocuments((prev) => prev.filter((d) => d.id !== docId));
    }
  };

  const handleSaveProfile = async () => {
    setIsSaving(true);
    setSaveSuccess(false);
    const { error } = await updateProfile({
      first_name: firstName,
      last_name: lastName,
    });
    setIsSaving(false);
    if (!error) {
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    }
  };

  const handleSaveCompany = async () => {
    setIsSaving(true);
    setSaveSuccess(false);
    const { error } = await updateProfile({
      company_name: companyName,
      business_address: businessAddress,
      company_phone: companyPhone,
      ein: ein,
    });
    setIsSaving(false);
    if (!error) {
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
        Settings
      </h1>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Settings Navigation */}
        <div className="lg:col-span-1">
          <nav className="space-y-1">
            {SETTINGS_SECTIONS.map((section) => {
              const Icon = section.icon;
              const isActive = activeSection === section.id;
              return (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors ${
                    isActive
                      ? "bg-ocean-blue text-white"
                      : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <div>
                    <p className="font-medium">{section.label}</p>
                    <p
                      className={`text-xs ${isActive ? "text-white/70" : "text-gray-500"}`}
                    >
                      {section.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Settings Content */}
        <div className="lg:col-span-3">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
            {activeSection === "profile" && (
              <div className="p-6">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-6">
                  Profile Settings
                </h2>
                <div className="space-y-6">
                  <div className="flex items-center gap-4">
                    <div className="w-20 h-20 bg-gradient-to-br from-ocean-blue to-mint-green rounded-full flex items-center justify-center text-white text-2xl font-bold">
                      {profile?.first_name?.[0] || "U"}
                      {profile?.last_name?.[0] || ""}
                    </div>
                    <div>
                      <button className="btn-secondary text-sm">
                        Change Avatar
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        First Name
                      </label>
                      <input
                        type="text"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        className="input-field"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Last Name
                      </label>
                      <input
                        type="text"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        className="input-field"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Email
                      </label>
                      <input
                        type="email"
                        defaultValue={profile?.email || ""}
                        className="input-field"
                        disabled
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Contact support to change your email
                      </p>
                    </div>
                  </div>
                  <div className="pt-4 border-t border-gray-200 dark:border-gray-700 flex items-center gap-4">
                    <button
                      className="btn-primary"
                      onClick={handleSaveProfile}
                      disabled={isSaving}
                    >
                      {isSaving ? "Saving..." : "Save Changes"}
                    </button>
                    {saveSuccess && (
                      <span className="flex items-center gap-1 text-sm text-green-600">
                        <CheckIcon className="w-4 h-4" />
                        Saved successfully
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeSection === "company" && (
              <div className="p-6">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-6">
                  Company Settings
                </h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Company Name
                    </label>
                    <input
                      type="text"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      className="input-field"
                      placeholder="Your Company Name"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Business Address
                    </label>
                    <textarea
                      className="input-field"
                      rows={3}
                      value={businessAddress}
                      onChange={(e) => setBusinessAddress(e.target.value)}
                      placeholder="123 Main St, Suite 100&#10;City, State 12345"
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Phone Number
                      </label>
                      <input
                        type="tel"
                        value={companyPhone}
                        onChange={(e) => setCompanyPhone(e.target.value)}
                        className="input-field"
                        placeholder="(555) 123-4567"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        EIN (Employer Identification Number)
                      </label>
                      <input
                        type="text"
                        value={ein}
                        onChange={(e) => setEin(e.target.value)}
                        className="input-field"
                        placeholder="XX-XXXXXXX"
                      />
                    </div>
                  </div>
                  <div className="pt-4 border-t border-gray-200 dark:border-gray-700 flex items-center gap-4">
                    <button
                      className="btn-primary"
                      onClick={handleSaveCompany}
                      disabled={isSaving}
                    >
                      {isSaving ? "Saving..." : "Save Changes"}
                    </button>
                    {saveSuccess && (
                      <span className="flex items-center gap-1 text-sm text-green-600">
                        <CheckIcon className="w-4 h-4" />
                        Saved successfully
                      </span>
                    )}
                  </div>

                  {/* Company Documents Section */}
                  <div className="pt-6 mt-6 border-t border-gray-200 dark:border-gray-700">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                      <DocumentIcon className="w-5 h-5" />
                      Company Documents
                    </h3>
                    <p className="text-sm text-gray-500 mb-4">
                      Upload important business documents like licenses, tax returns, insurance certificates, and operating agreements.
                    </p>

                    {/* Document Type Selector */}
                    <div className="mb-4">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Document Type
                      </label>
                      <select
                        value={documentType}
                        onChange={(e) => setDocumentType(e.target.value)}
                        className="input-field w-64"
                      >
                        <option value="business_license">Business License</option>
                        <option value="tax_return">Tax Return</option>
                        <option value="insurance">Insurance Certificate</option>
                        <option value="operating_agreement">Operating Agreement</option>
                        <option value="articles_of_incorporation">Articles of Incorporation</option>
                        <option value="ein_letter">EIN Letter</option>
                        <option value="bank_statement">Bank Statement</option>
                        <option value="lease_agreement">Lease Agreement</option>
                        <option value="iso_agreement">ISO Agreement</option>
                        <option value="other">Other</option>
                      </select>
                    </div>

                    {/* Document Uploader */}
                    <DocumentUploader
                      entityType="company"
                      entityId="company"
                      bucket="company-documents"
                      documentType={documentType}
                      onUploadComplete={handleDocumentUploadComplete}
                      onError={(error) => alert(error)}
                    />

                    {/* Documents List */}
                    {companyDocuments.length > 0 && (
                      <div className="mt-6">
                        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                          Uploaded Documents
                        </h4>
                        <DocumentList
                          documents={companyDocuments}
                          bucket="company-documents"
                          onDelete={handleDocumentDelete}
                          canDelete={true}
                          showStatus={false}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeSection === "notifications" && (
              <div className="p-6">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-6">
                  Notification Preferences
                </h2>
                <div className="space-y-4">
                  {[
                    { label: "New customer leads", description: "Get notified when new leads come in" },
                    { label: "Application updates", description: "Status changes on customer applications" },
                    { label: "Follow-up reminders", description: "Scheduled follow-up notifications" },
                    { label: "Document uploads", description: "When customers upload new documents" },
                    { label: "Funding approvals", description: "When deals get funded" },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="flex items-center justify-between py-3 border-b border-gray-200 dark:border-gray-700 last:border-0"
                    >
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">
                          {item.label}
                        </p>
                        <p className="text-sm text-gray-500">{item.description}</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" className="sr-only peer" defaultChecked />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-ocean-blue/20 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-ocean-blue"></div>
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeSection === "security" && (
              <div className="p-6">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-6">
                  Security Settings
                </h2>
                <div className="space-y-6">
                  <div className="p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
                    <h3 className="font-medium text-gray-900 dark:text-white mb-2">
                      Change Password
                    </h3>
                    <p className="text-sm text-gray-500 mb-4">
                      Update your password to keep your account secure
                    </p>
                    <button className="btn-secondary text-sm">
                      Change Password
                    </button>
                  </div>
                  <div className="p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
                    <h3 className="font-medium text-gray-900 dark:text-white mb-2">
                      Two-Factor Authentication
                    </h3>
                    <p className="text-sm text-gray-500 mb-4">
                      Add an extra layer of security to your account
                    </p>
                    <button className="btn-secondary text-sm">
                      Enable 2FA
                    </button>
                  </div>
                  <div className="p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
                    <h3 className="font-medium text-gray-900 dark:text-white mb-2">
                      Active Sessions
                    </h3>
                    <p className="text-sm text-gray-500 mb-4">
                      Manage your active login sessions
                    </p>
                    <button className="btn-secondary text-sm">
                      View Sessions
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeSection === "billing" && (
              <div className="p-6">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-6">
                  Billing & Subscription
                </h2>
                <div className="space-y-6">
                  <div className="p-4 bg-gradient-to-r from-ocean-blue to-mint-green rounded-lg text-white">
                    <p className="text-sm opacity-80">Current Plan</p>
                    <p className="text-2xl font-bold">Professional</p>
                    <p className="text-sm opacity-80 mt-1">
                      $99/month - Billed monthly
                    </p>
                  </div>
                  <div className="p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
                    <h3 className="font-medium text-gray-900 dark:text-white mb-2">
                      Payment Method
                    </h3>
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-8 bg-gray-200 dark:bg-gray-700 rounded flex items-center justify-center text-xs font-bold">
                        VISA
                      </div>
                      <span className="text-gray-600 dark:text-gray-400">
                        **** **** **** 4242
                      </span>
                    </div>
                    <button className="btn-secondary text-sm mt-4">
                      Update Payment
                    </button>
                  </div>
                  <div className="p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
                    <h3 className="font-medium text-gray-900 dark:text-white mb-2">
                      Billing History
                    </h3>
                    <p className="text-sm text-gray-500 mb-4">
                      Download invoices and view payment history
                    </p>
                    <button className="btn-secondary text-sm">
                      View History
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
