import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ArrowRightIcon,
  UserPlusIcon,
} from "@heroicons/react/24/outline";
import supabase from "../../supabase";
import { createDeal } from "../../services/dealService";
import { listCampaigns, type Campaign } from "../../services/campaignService";
import { MARKET_CONFIG } from "../../types/deals";
import type { Deal, Market, DealStatus, CreateDealData } from "../../types/deals";
import type { Playbook } from "../../data/playbooks";

interface Customer {
  id: string;
  first_name: string;
  last_name: string | null;
  business_name: string | null;
}

// Per-playbook defaults so the form arrives pre-configured for the flow.
const PLAYBOOK_DEFAULTS: Record<
  Playbook["id"],
  { leadSource: string; startStatus: DealStatus; isLiveTransfer: boolean }
> = {
  website: { leadSource: "website", startStatus: "new", isLiveTransfer: false },
  "live-transfer": { leadSource: "live_transfer", startStatus: "new", isLiveTransfer: true },
  vcf: { leadSource: "referral", startStatus: "new_distressed", isLiveTransfer: false },
};

// Only what's needed to START the lead: who they are + attribution. The
// qualifier questions (revenue, amount, time-in-business, VCF positions, etc.)
// are captured INLINE at the step where the closer asks them — no scrolling.
const emptyForm = {
  first_name: "",
  last_name: "",
  business_name: "",
  phone: "",
  email: "",
  // routing / attribution (set once)
  market: "" as Market | "",
  lead_source: "",
  campaign_id: "",
  assigned_closer_id: "",
  notes: "",
};

export default function PlaybookCapture({
  playbook,
  onCreated,
}: {
  playbook: Playbook;
  /** When provided, the parent takes over after creation (loads the deal into
   * the guided workspace) and this component does NOT show its own success card. */
  onCreated?: (deal: Deal) => void;
}) {
  const isVcf = playbook.pipeline === "vcf";
  const defaults = PLAYBOOK_DEFAULTS[playbook.id];

  const [open, setOpen] = useState(true);
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerSearch, setCustomerSearch] = useState("");
  const [existingId, setExistingId] = useState("");
  const [closers, setClosers] = useState<{ id: string; first_name: string | null; last_name: string | null }[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [form, setForm] = useState({ ...emptyForm, lead_source: defaults.leadSource });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Deal | null>(null);

  // Reset the form whenever the closer switches playbook tabs.
  useEffect(() => {
    setForm({ ...emptyForm, lead_source: defaults.leadSource });
    setSaved(null);
    setError(null);
    setMode("new");
    setExistingId("");
  }, [playbook.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    listCampaigns().then(setCampaigns).catch(() => setCampaigns([]));
    supabase
      .from("closers")
      .select("id, first_name, last_name")
      .eq("status", "active")
      .order("first_name", { ascending: true })
      .then(({ data }) => setClosers(data || []));
    supabase
      .from("customers")
      .select("id, first_name, last_name, business_name")
      .order("first_name", { ascending: true })
      .limit(200)
      .then(({ data }) => setCustomers(data || []));
  }, []);

  const set = (k: keyof typeof emptyForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const filteredCustomers = customers.filter((c) => {
    if (!customerSearch) return true;
    const s = customerSearch.toLowerCase();
    return (
      `${c.first_name} ${c.last_name ?? ""}`.toLowerCase().includes(s) ||
      (c.business_name || "").toLowerCase().includes(s)
    );
  });

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Resolve the customer — existing pick or a brand-new lead created inline.
    let customerId = existingId;
    setSaving(true);
    try {
      if (mode === "new") {
        if (!form.first_name.trim() || !form.phone.trim()) {
          setError("A new lead needs at least a first name and a phone number.");
          setSaving(false);
          return;
        }
        const { data: created, error: cErr } = await supabase
          .from("customers")
          .insert({
            first_name: form.first_name.trim(),
            last_name: form.last_name.trim() || null,
            business_name: form.business_name.trim() || null,
            email: form.email.trim() || null,
            phone: form.phone.trim(),
            status: "lead",
            source: "other",
            is_live_transfer: defaults.isLiveTransfer,
          })
          .select("id")
          .single();
        if (cErr || !created) {
          setError(`Could not create the lead: ${cErr?.message ?? "unknown error"}`);
          setSaving(false);
          return;
        }
        customerId = created.id;
      } else if (!customerId) {
        setError("Pick an existing customer, or switch to “New lead”.");
        setSaving(false);
        return;
      }

      // Dedupe guard: if this customer already has an OPEN deal of this type,
      // resume it instead of creating a duplicate (duplicate deals were a real
      // bug — one click on an existing customer minted a second open deal and a
      // second GHL opportunity). Closed deals (funded/declined/dead) don't count:
      // a fresh deal there is correct (e.g. a renewal or a comeback).
      const CLOSED = ["funded", "declined", "dead", "nurture", "renewal_eligible", "restructure_executed", "servicing"];
      const { data: openDeals } = await supabase
        .from("deals")
        .select("*")
        .eq("customer_id", customerId)
        .eq("deal_type", isVcf ? "vcf" : "mca")
        .not("status", "in", `(${CLOSED.join(",")})`)
        .order("created_at", { ascending: false })
        .limit(1);
      if (openDeals && openDeals.length > 0) {
        const existing = openDeals[0] as Deal;
        setForm({ ...emptyForm, lead_source: defaults.leadSource });
        setExistingId("");
        setCustomerSearch("");
        setSaving(false);
        if (onCreated) {
          onCreated(existing); // parent loads the open deal — work continues where it left off
          return;
        }
        setSaved(existing);
        return;
      }

      // Create the deal with just identity + attribution. The qualifier numbers
      // (amount, revenue, VCF balances…) are saved inline at the Qualify step.
      const data: CreateDealData = {
        customer_id: customerId,
        deal_type: isVcf ? "vcf" : "mca",
        status: defaults.startStatus,
        lead_source: form.lead_source || undefined,
        campaign_id: form.campaign_id || null,
        market: form.market || undefined,
        assigned_closer_id: form.assigned_closer_id || undefined,
        notes: form.notes.trim() || undefined,
      };

      const deal = await createDeal(data);
      // Clear the inputs so the next lead starts fresh.
      setForm({ ...emptyForm, lead_source: defaults.leadSource });
      setExistingId("");
      setCustomerSearch("");
      if (onCreated) {
        // Parent loads the deal into the guided workspace — no success card here.
        setSaving(false);
        onCreated(deal);
        return;
      }
      setSaved(deal);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save the lead. Please try again.");
    }
    setSaving(false);
  }

  return (
    <div className="rounded-xl border-2 border-emerald-300 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-900/10 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2">
          <UserPlusIcon className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          <span className="font-semibold text-gray-900 dark:text-white">
            Start the lead — name &amp; phone is all you need
          </span>
        </span>
        <span className="flex items-center gap-2">
          <span className="hidden sm:inline text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
            {isVcf ? "Creates a VCF deal" : "Creates an MCA deal"} + pushes to GHL
          </span>
          {open ? <ChevronUpIcon className="w-5 h-5 text-gray-400" /> : <ChevronDownIcon className="w-5 h-5 text-gray-400" />}
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4">
          {saved ? (
            <div className="rounded-lg border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-gray-800 p-4">
              <div className="flex items-start gap-3">
                <CheckCircleIcon className="w-6 h-6 text-emerald-500 shrink-0" />
                <div className="flex-1">
                  <p className="font-semibold text-gray-900 dark:text-white">
                    Lead saved{saved.deal_number ? ` — ${saved.deal_number}` : ""}.
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                    The deal is in the pipeline and the contact was pushed to GoHighLevel (Speed-to-Lead fired). Keep
                    working the steps below — log the call and advance the stage on the deal when you're ready.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link
                      to={`/admin/deals/${saved.id}`}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-ocean-blue text-white text-sm font-semibold hover:opacity-90"
                    >
                      Open the deal <ArrowRightIcon className="w-4 h-4" />
                    </Link>
                    <button
                      onClick={() => setSaved(null)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
                    >
                      + Capture another lead
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSave} className="space-y-4">
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Just get them into the system: Saving creates the {isVcf ? "VCF" : "MCA"} deal and pushes the contact into
                GoHighLevel. Then work the steps below — <span className="font-medium">each question you ask has its
                own field right there</span>, so you capture answers without scrolling back up.
              </p>

              {error && (
                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg text-sm text-red-700 dark:text-red-300">
                  {error}
                </div>
              )}

              {/* New vs existing toggle */}
              <div className="inline-flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden text-xs">
                <button
                  type="button"
                  onClick={() => setMode("new")}
                  className={`px-3 py-1.5 ${mode === "new" ? "bg-ocean-blue text-white" : "text-gray-600 dark:text-gray-300"}`}
                >
                  + New lead
                </button>
                <button
                  type="button"
                  onClick={() => setMode("existing")}
                  className={`px-3 py-1.5 ${mode === "existing" ? "bg-ocean-blue text-white" : "text-gray-600 dark:text-gray-300"}`}
                >
                  Existing customer
                </button>
              </div>

              {mode === "existing" ? (
                <div>
                  <input
                    type="text"
                    placeholder="Search customers…"
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    className="input-field w-full mb-2"
                  />
                  <select
                    value={existingId}
                    onChange={(e) => setExistingId(e.target.value)}
                    className="input-field w-full"
                  >
                    <option value="">Select a customer</option>
                    {filteredCustomers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.first_name} {c.last_name}
                        {c.business_name ? ` — ${c.business_name}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label="First name *">
                    <input className="input-field w-full" value={form.first_name} onChange={(e) => set("first_name", e.target.value)} placeholder="Jane" />
                  </Field>
                  <Field label="Last name">
                    <input className="input-field w-full" value={form.last_name} onChange={(e) => set("last_name", e.target.value)} placeholder="Doe" />
                  </Field>
                  <Field label="Business name" full>
                    <input className="input-field w-full" value={form.business_name} onChange={(e) => set("business_name", e.target.value)} placeholder="Acme Co." />
                  </Field>
                  <Field label="Phone *">
                    <input className="input-field w-full" type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="(555) 123-4567" />
                  </Field>
                  <Field label="Email">
                    <input className="input-field w-full" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="jane@acme.com" />
                  </Field>
                </div>
              )}

              {/* Qualifiers are captured inline at the Qualify step — not here. */}
              <p className="text-xs text-gray-500 dark:text-gray-400 rounded-md bg-white/60 dark:bg-gray-800/60 border border-dashed border-gray-300 dark:border-gray-600 px-3 py-2">
                Name + phone is all you need to start. You'll capture {isVcf ? "positions, balances and daily debit" : "revenue, amount requested and time-in-business"} right inside the <span className="font-medium">Qualify</span> step below — as you ask each question, so you're never scrolling back up here.
              </p>

              {/* Routing */}
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Market">
                  <select className="input-field w-full" value={form.market} onChange={(e) => set("market", e.target.value)}>
                    <option value="">Select market</option>
                    {Object.entries(MARKET_CONFIG).map(([v, c]) => (
                      <option key={v} value={v}>{c.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Lead source">
                  <select className="input-field w-full" value={form.lead_source} onChange={(e) => set("lead_source", e.target.value)}>
                    <option value="">Select source</option>
                    <option value="live_transfer">Live Transfer</option>
                    <option value="google_ads">Google Ads</option>
                    <option value="website">Website</option>
                    <option value="aged_lead">Aged Lead</option>
                    <option value="ucc_lead">UCC Filing</option>
                    <option value="referral">Referral</option>
                    <option value="cold_call">Cold Call</option>
                    <option value="repeat_customer">Repeat Customer</option>
                    <option value="other">Other</option>
                  </select>
                </Field>
                <Field label="Campaign">
                  <select className="input-field w-full" value={form.campaign_id} onChange={(e) => set("campaign_id", e.target.value)}>
                    <option value="">No campaign</option>
                    {campaigns.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Assigned closer">
                  <select className="input-field w-full" value={form.assigned_closer_id} onChange={(e) => set("assigned_closer_id", e.target.value)}>
                    <option value="">Unassigned</option>
                    {closers.map((c) => (
                      <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>
                    ))}
                  </select>
                </Field>
              </div>

              <Field label="Notes">
                <textarea className="input-field w-full h-16" value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Anything the next person should know…" />
              </Field>

              <div className="flex items-center justify-between gap-3 pt-1">
                <p className="text-xs text-gray-400">
                  Tagging the campaign here is what makes the cost-per-funded math work.
                </p>
                <button type="submit" disabled={saving} className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed">
                  {saving ? "Saving…" : isVcf ? "Save VCF lead" : "Save lead"}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{label}</label>
      {children}
    </div>
  );
}
