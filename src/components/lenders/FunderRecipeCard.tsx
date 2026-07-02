// FunderRecipeCard — the admin editor for a funder's submission "recipe"
// (funder_submission_profiles row). This is how a funder's exact submission
// format is captured once and then reused by the submit-to-funders engine on
// every deal: their email, subject convention, body layout (merge tokens),
// which docs to include, required stips, and their portal flow. "Send test to
// myself" renders the recipe against a sample deal and emails ONLY the logged-in
// admin so you can QA a funder's format before trusting it on a real deal.
import { useEffect, useState } from "react";
import {
  ArrowPathIcon, CheckIcon, PaperAirplaneIcon, DocumentTextIcon,
} from "@heroicons/react/24/outline";
import supabase from "../../supabase";

type Method = "email" | "portal" | "email_and_portal";
type AttachmentMode = "links" | "attachments" | "both";

// Doc slugs = customer_document_type enum values (what the DB actually stores).
const DOC_SLUGS: { value: string; label: string }[] = [
  { value: "application", label: "Signed application" },
  { value: "bank_statement", label: "Bank statements" },
  { value: "id", label: "Photo ID" },
  { value: "voided_check", label: "Voided check" },
  { value: "credit_authorization", label: "Credit authorization" },
  { value: "business_license", label: "Business license" },
  { value: "personal_guarantee", label: "Personal guarantee" },
  { value: "tax_return", label: "Tax return" },
  { value: "other", label: "Other" },
];

const MERGE_TOKENS = [
  "business_name", "dba", "owner_name", "owner_email", "owner_phone", "ein",
  "amount_requested", "monthly_revenue", "time_in_business", "industry",
  "use_of_funds", "state", "positions", "deal_number", "closer_name",
  "closer_email", "doc_links",
];

interface RecipeForm {
  method: Method;
  to_email: string;
  cc_emails: string;        // comma-separated in the UI
  subject_template: string;
  body_template: string;
  attach_docs: string[];
  attachment_mode: AttachmentMode;
  max_statement_months: string;
  portal_url: string;
  portal_steps: string;     // newline-separated in the UI
  portal_credentials_hint: string;
  required_stips: string[];
  special_instructions: string;
  active: boolean;
}

const EMPTY: RecipeForm = {
  method: "email", to_email: "", cc_emails: "", subject_template: "",
  body_template: "", attach_docs: [], attachment_mode: "links",
  max_statement_months: "4", portal_url: "", portal_steps: "",
  portal_credentials_hint: "", required_stips: [], special_instructions: "",
  active: true,
};

export default function FunderRecipeCard({ lenderId, submissionEmail }: { lenderId: string; submissionEmail: string | null }) {
  const [form, setForm] = useState<RecipeForm>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("funder_submission_profiles").select("*").eq("lender_id", lenderId).maybeSingle();
      if (cancelled) return;
      if (data) {
        setForm({
          method: (data.method as Method) ?? "email",
          to_email: data.to_email ?? "",
          cc_emails: (data.cc_emails ?? []).join(", "),
          subject_template: data.subject_template ?? "",
          body_template: data.body_template ?? "",
          attach_docs: data.attach_docs ?? [],
          attachment_mode: (data.attachment_mode as AttachmentMode) ?? "links",
          max_statement_months: data.max_statement_months != null ? String(data.max_statement_months) : "4",
          portal_url: data.portal_url ?? "",
          portal_steps: (data.portal_steps ?? []).join("\n"),
          portal_credentials_hint: data.portal_credentials_hint ?? "",
          required_stips: data.required_stips ?? [],
          special_instructions: data.special_instructions ?? "",
          active: data.active ?? true,
        });
      } else {
        setForm({ ...EMPTY, to_email: submissionEmail ?? "" });
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [lenderId, submissionEmail]);

  const set = <K extends keyof RecipeForm>(k: K, v: RecipeForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const toggleArr = (k: "attach_docs" | "required_stips", val: string) =>
    setForm((f) => ({ ...f, [k]: f[k].includes(val) ? f[k].filter((x) => x !== val) : [...f[k], val] }));

  async function save() {
    setSaving(true); setSaved(false); setErr(null);
    try {
      const payload = {
        lender_id: lenderId,
        method: form.method,
        to_email: form.to_email.trim() || null,
        cc_emails: form.cc_emails.split(",").map((s) => s.trim()).filter(Boolean),
        subject_template: form.subject_template.trim() || null,
        body_template: form.body_template.trim() || null,
        attach_docs: form.attach_docs,
        attachment_mode: form.attachment_mode,
        max_statement_months: form.max_statement_months ? parseInt(form.max_statement_months) : null,
        portal_url: form.portal_url.trim() || null,
        portal_steps: form.portal_steps.split("\n").map((s) => s.trim()).filter(Boolean),
        portal_credentials_hint: form.portal_credentials_hint.trim() || null,
        required_stips: form.required_stips,
        special_instructions: form.special_instructions.trim() || null,
        active: form.active,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase
        .from("funder_submission_profiles").upsert(payload, { onConflict: "lender_id" });
      if (error) throw error;
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save recipe");
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    setTesting(true); setTestMsg(null); setErr(null);
    try {
      // Save first so the test uses the current recipe.
      await save();
      const { data, error } = await supabase.functions.invoke("submit-to-funders", {
        body: { lenderIds: [lenderId], test_email: true },
      });
      if (error) throw error;
      const r = data?.results?.[0];
      if (r?.status === "sent") setTestMsg(`Test emailed to ${data.sentTo} — check your inbox.`);
      else setTestMsg(`Test not sent: ${r?.error ?? "unknown error"}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to send test");
    } finally {
      setTesting(false);
    }
  }

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
        <p className="text-sm text-gray-400">Loading submission recipe…</p>
      </div>
    );
  }

  const showEmail = form.method === "email" || form.method === "email_and_portal";
  const showPortal = form.method === "portal" || form.method === "email_and_portal";

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          <span className="w-2 h-2 bg-emerald-500 rounded-full"></span>
          Submission Recipe
        </h3>
        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          <input type="checkbox" checked={form.active} onChange={(e) => set("active", e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-ocean-blue focus:ring-ocean-blue" />
          Active
        </label>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        How the submit-to-funders engine sends this funder every deal. Falls back to a
        generic email format if left blank.
      </p>

      {/* Method */}
      <div className="grid md:grid-cols-3 gap-4 mb-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Method</label>
          <select value={form.method} onChange={(e) => set("method", e.target.value as Method)} className="input-field">
            <option value="email">Email</option>
            <option value="portal">Portal only</option>
            <option value="email_and_portal">Email + Portal</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Attachment mode</label>
          <select value={form.attachment_mode} onChange={(e) => set("attachment_mode", e.target.value as AttachmentMode)} className="input-field">
            <option value="links">Secure links</option>
            <option value="attachments">Real attachments (Phase 6)</option>
            <option value="both">Both (Phase 6)</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Max statement months</label>
          <input type="number" value={form.max_statement_months} onChange={(e) => set("max_statement_months", e.target.value)} className="input-field" placeholder="4" />
        </div>
      </div>

      {showEmail && (
        <>
          <div className="grid md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">To email <span className="text-gray-400 font-normal">(overrides funder submission email)</span></label>
              <input type="email" value={form.to_email} onChange={(e) => set("to_email", e.target.value)} className="input-field" placeholder={submissionEmail ?? "deals@funder.com"} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">CC emails <span className="text-gray-400 font-normal">(comma-separated)</span></label>
              <input type="text" value={form.cc_emails} onChange={(e) => set("cc_emails", e.target.value)} className="input-field" placeholder="processing@funder.com" />
            </div>
          </div>

          <div className="mb-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Subject template</label>
            <input type="text" value={form.subject_template} onChange={(e) => set("subject_template", e.target.value)} className="input-field" placeholder="New MCA Submission — {{business_name}} — {{amount_requested}}" />
          </div>
          <div className="mb-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Body template</label>
            <textarea value={form.body_template} onChange={(e) => set("body_template", e.target.value)} className="input-field font-mono text-xs" rows={10} placeholder="Funder's required body layout using merge tokens…" />
          </div>
          {/* Token palette */}
          <div className="mb-4 flex flex-wrap gap-1">
            {MERGE_TOKENS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => set("body_template", `${form.body_template}{{${t}}}`)}
                title="Insert token into body"
                className="text-[10px] px-1.5 py-0.5 rounded border border-ocean-blue/30 text-ocean-blue hover:bg-ocean-blue/10"
              >
                {"{{"}{t}{"}}"}
              </button>
            ))}
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-1">
              <DocumentTextIcon className="w-4 h-4 text-gray-400" /> Documents to include (as {"{{doc_links}}"})
            </label>
            <div className="flex flex-wrap gap-2">
              {DOC_SLUGS.map((d) => (
                <button key={d.value} type="button" onClick={() => toggleArr("attach_docs", d.value)}
                  className={`text-xs px-2 py-1 rounded-full border transition-colors ${form.attach_docs.includes(d.value) ? "bg-ocean-blue text-white border-ocean-blue" : "bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-ocean-blue"}`}>
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {showPortal && (
        <div className="mb-4 rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-900/10 p-4 space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Portal URL <span className="text-gray-400 font-normal">(overrides funder portal)</span></label>
            <input type="url" value={form.portal_url} onChange={(e) => set("portal_url", e.target.value)} className="input-field" placeholder="https://portal.funder.com/submit" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Portal steps <span className="text-gray-400 font-normal">(one per line)</span></label>
            <textarea value={form.portal_steps} onChange={(e) => set("portal_steps", e.target.value)} className="input-field text-sm" rows={4} placeholder={"Log in with the Funders vault credentials\nNew Deal → paste merchant details\nUpload bank statements + application\nSubmit and copy the deal ID back here"} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Credentials hint</label>
            <input type="text" value={form.portal_credentials_hint} onChange={(e) => set("portal_credentials_hint", e.target.value)} className="input-field" placeholder="Login is in 1Password → Funders vault" />
          </div>
        </div>
      )}

      {/* Required stips guard */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Required stips <span className="text-gray-400 font-normal">(blocks submit until on file)</span></label>
        <div className="flex flex-wrap gap-2">
          {DOC_SLUGS.map((d) => (
            <button key={d.value} type="button" onClick={() => toggleArr("required_stips", d.value)}
              className={`text-xs px-2 py-1 rounded-full border transition-colors ${form.required_stips.includes(d.value) ? "bg-amber-500 text-white border-amber-500" : "bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-amber-400"}`}>
              {d.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Special instructions</label>
        <textarea value={form.special_instructions} onChange={(e) => set("special_instructions", e.target.value)} className="input-field text-sm" rows={2} placeholder="e.g. No PDFs over 10MB · Subject MUST start with ISO#4412" />
      </div>

      {err && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{err}</p>}
      {testMsg && <p className="text-sm text-emerald-600 dark:text-emerald-400 mb-3">{testMsg}</p>}

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className="btn-primary flex items-center gap-2 disabled:opacity-50">
          {saving ? <ArrowPathIcon className="w-4 h-4 animate-spin" /> : <CheckIcon className="w-4 h-4" />}
          {saving ? "Saving…" : "Save recipe"}
        </button>
        <button onClick={sendTest} disabled={testing} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-ocean-blue border border-ocean-blue rounded-lg hover:bg-ocean-blue/10 disabled:opacity-50">
          {testing ? <ArrowPathIcon className="w-4 h-4 animate-spin" /> : <PaperAirplaneIcon className="w-4 h-4" />}
          Send test to myself
        </button>
        {saved && <span className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1"><CheckIcon className="w-4 h-4" /> Saved</span>}
      </div>
    </div>
  );
}
