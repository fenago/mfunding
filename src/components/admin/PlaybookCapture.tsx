import { useEffect, useMemo, useState } from "react";
import { normalizePhoneForStorage } from "@/lib/phone";
import { Link } from "react-router-dom";
import {
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ArrowRightIcon,
  UserPlusIcon,
  MegaphoneIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import supabase from "../../supabase";
import { mustWrite } from "@/supabase/writes";
import { createDeal } from "../../services/dealService";
import { listCampaigns, defaultCampaignIdForSource, type Campaign } from "../../services/campaignService";
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
  { leadSource: string; startStatus: DealStatus; isLiveTransfer: boolean; isRenewal?: boolean; manualEntry?: boolean; defaultMode?: "new" | "existing" }
> = {
  // manualEntry: does the closer ever TYPE a new lead here? Only when there's no
  // prior record — a live transfer (merchant on the phone) or a walk-in web/VCF
  // add. manualEntry:false (Synergy import + email + cold-email paths) hides the
  // "+ New lead" option entirely — the lead always already exists.
  // defaultMode: which view opens first WHEN manual entry is allowed. Website
  // opens on the existing-customer picker ("Work this lead"), with "+ New lead"
  // still one click away; Live Transfer opens on the "+ New lead" form.
  website: { leadSource: "website", startStatus: "new", isLiveTransfer: false, defaultMode: "existing" },
  // A live transfer is CONTACTED the instant the lead is created — the merchant
  // is on the phone and you've greeted them in the intake. Born at "contacted"
  // so the pipeline flows contacted → qualifying (merged Qualify step) cleanly,
  // with no skipped stage and no Speed-to-Lead "call in 5 min" nudge.
  "live-transfer": { leadSource: "live_transfer", startStatus: "contacted", isLiveTransfer: true, defaultMode: "new" },
  "web-lead": { leadSource: "web_purchased", startStatus: "new", isLiveTransfer: false, manualEntry: false },
  "aged-transfer": { leadSource: "aged_transfer", startStatus: "new", isLiveTransfer: false, manualEntry: false },
  realtime: { leadSource: "realtime_appt", startStatus: "new", isLiveTransfer: true, manualEntry: false },
  "cold-email": { leadSource: "cold_email", startStatus: "new", isLiveTransfer: false, manualEntry: false },
  vcf: { leadSource: "referral", startStatus: "new_distressed", isLiveTransfer: false },
  // Renewal deals get is_renewal=true so commissions calculate at 6 points.
  renewal: { leadSource: "renewal", startStatus: "new", isLiveTransfer: false, isRenewal: true },
};

// Only what's needed to START the lead: who they are + attribution. The
// qualifier questions (revenue, amount, time-in-business, VCF positions, etc.)
// are captured INLINE at the step where the closer asks them — no scrolling.
// Statuses where a deal is finished — a new deal for the same customer is
// legitimate (renewal / comeback). Anything else counts as an open deal.
// A deal in one of these statuses is "done" for dedup purposes — picking the
// customer again starts a FRESH deal (renewal after funding, comeback after
// declined/dead). NOTE: "nurture" is deliberately NOT here — a nurtured lead is
// still active (long re-engagement sequence), so picking them must RESUME the
// nurture deal, not mint a duplicate (that was the "new lead created out of an
// existing nurture" bug).
const CLOSED_STATUSES = ["funded", "declined", "dead", "renewal_eligible", "restructure_executed", "servicing"];

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
  // Live-transfer intake: the merchant is already on the phone, so the "+ New
  // lead" form leads with the OPENING SCRIPT + a minimal name/phone/business-email
  // capture; the rest of the routing fields fold into "More details".
  const isLiveIntake = defaults.isLiveTransfer;

  const [open, setOpen] = useState(true);
  // "More details" (market / source / campaign / closer / notes) — collapsed by
  // default on a live-transfer intake so name + phone + business email is the
  // fast path; always expanded on non-live flows (unchanged behavior).
  const [moreOpen, setMoreOpen] = useState(false);
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerSearch, setCustomerSearch] = useState("");
  const [existingId, setExistingId] = useState("");
  const [closers, setClosers] = useState<{ id: string; user_id: string | null; first_name: string | null; last_name: string | null }[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [form, setForm] = useState({ ...emptyForm, lead_source: defaults.leadSource });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matchNotice, setMatchNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState<Deal | null>(null);
  // Whether the closer has hand-picked a campaign. While false, the campaign
  // field re-derives its smart default as the lead source changes; once the
  // closer picks one it stays put (no surprise re-selection).
  const [campaignDirty, setCampaignDirty] = useState(false);

  // Only ACTIVE campaigns can be attached / drive the smart default. When there
  // are none, we don't hard-block the closer — we warn and let the save through.
  const activeCampaigns = useMemo(() => campaigns.filter((c) => c.status === "active"), [campaigns]);

  // Whether this flow ever creates a lead by hand. Import/email/pool paths never
  // do — the lead already exists, so the closer only ever loads an existing one.
  const allowsManualEntry = defaults.manualEntry !== false;

  // Reset the form whenever the closer switches playbook tabs.
  useEffect(() => {
    setForm({ ...emptyForm, lead_source: defaults.leadSource });
    setSaved(null);
    setError(null);
    setCampaignDirty(false);
    setMode(allowsManualEntry ? (defaults.defaultMode ?? "new") : "existing");
    setExistingId("");
  }, [playbook.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Smart default: attach the newest active campaign that matches the lead
  // source (re-derives when the source changes), until the closer picks one.
  useEffect(() => {
    if (campaignDirty) return;
    const id = defaultCampaignIdForSource(campaigns, form.lead_source);
    setForm((f) => (f.campaign_id === id ? f : { ...f, campaign_id: id }));
  }, [campaigns, form.lead_source, campaignDirty]);

  useEffect(() => {
    listCampaigns().then(setCampaigns).catch(() => setCampaigns([]));
    supabase
      .from("closers")
      .select("id, user_id, first_name, last_name")
      .eq("status", "active")
      .order("first_name", { ascending: true })
      .then(({ data }) => setClosers(data || []));
    // Default list = most recent customers (the ones a closer is most likely
    // to be working). Search hits the SERVER — works at thousands of leads.
    supabase
      .from("customers")
      .select("id, first_name, last_name, business_name")
      .order("created_at", { ascending: false })
      .limit(8)
      .then(({ data }) => setCustomers(data || []));
  }, []);

  // Debounced server-side customer search across name + business.
  useEffect(() => {
    const s = customerSearch.trim().replace(/[,()]/g, " ");
    const t = setTimeout(async () => {
      let q = supabase
        .from("customers")
        .select("id, first_name, last_name, business_name")
        .limit(8);
      q = s
        ? q.or(`first_name.ilike.%${s}%,last_name.ilike.%${s}%,business_name.ilike.%${s}%`)
        : q.order("created_at", { ascending: false });
      const { data } = await q;
      setCustomers(data || []);
    }, 250);
    return () => clearTimeout(t);
  }, [customerSearch]);

  const set = (k: keyof typeof emptyForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // ONE CLICK on an existing customer does the right thing immediately:
  //  - open deal of this type → load it into the guided workspace (resume), or
  //  - only closed history / brand new → create a fresh deal (carrying their
  //    last market/source/campaign/closer forward) and load that.
  const [picking, setPicking] = useState<string | null>(null);
  async function pickCustomer(customerId: string) {
    setError(null);
    setPicking(customerId);
    try {
      // Look for an OPEN deal specifically — NOT just the latest deal. (Bug:
      // a customer whose newest deal was dead/declined but who still had an
      // older open deal got a duplicate created instead of a resume.)
      const { data: openData, error: openErr } = await supabase
        .from("deals")
        .select("*")
        .eq("customer_id", customerId)
        .eq("deal_type", isVcf ? "vcf" : "mca")
        .not("status", "in", `(${CLOSED_STATUSES.join(",")})`)
        .order("created_at", { ascending: false })
        .limit(1);
      if (openErr) throw openErr; // never fall through to create on a failed lookup
      const open = (openData?.[0] as Deal | undefined) ?? null;
      if (open) {
        onCreated?.(open); // resume the open deal
        return;
      }
      // No open deal → new deal, carrying attribution from their latest (closed) one.
      const { data: lastData } = await supabase
        .from("deals")
        .select("lead_source, campaign_id, market, assigned_closer_id")
        .eq("customer_id", customerId)
        .eq("deal_type", isVcf ? "vcf" : "mca")
        .order("created_at", { ascending: false })
        .limit(1);
      const last = lastData?.[0] as Partial<Deal> | undefined;
      const deal = await createDeal({
        customer_id: customerId,
        deal_type: isVcf ? "vcf" : "mca",
        status: defaults.startStatus,
        is_renewal: defaults.isRenewal ?? false,
        lead_source: last?.lead_source || defaults.leadSource,
        campaign_id: last?.campaign_id || null,
        market: (last?.market as Market) || undefined,
        assigned_closer_id: last?.assigned_closer_id || undefined,
      });
      onCreated?.(deal);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load that customer. Please try again.");
    } finally {
      setPicking(null);
    }
  }

  // Search is server-side now — the list is already filtered.
  const filteredCustomers = customers;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMatchNotice(null);

    // Campaign attribution is effectively required — every manual lead must be
    // tracked. Block only when there's actually an active campaign to pick (never
    // hard-block the business on missing config; the amber warning covers that).
    if (activeCampaigns.length > 0 && !form.campaign_id) {
      setError("Attach a campaign — every lead must be tracked. Pick one below, or create it under Campaigns.");
      return;
    }

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
        // On a live transfer, email is REQUIRED — it's how we send the merchant
        // their application, so we can't finish the deal without it.
        if (isLiveIntake && !form.email.trim()) {
          setError("Grab a business email before saving — on a live transfer it's how we send the application.");
          setSaving(false);
          return;
        }
        // Dedupe: reuse an existing customer that matches on digits-only phone OR
        // lower(email) instead of minting a duplicate (merchant self-serve + manual
        // capture both create leads, so collisions are real). Non-blocking notice.
        const digits = form.phone.replace(/\D/g, "");
        const emailNorm = form.email.trim().toLowerCase();
        let matched: { id: string; first_name: string | null; last_name: string | null; business_name: string | null } | null = null;
        try {
          const orClauses: string[] = [];
          if (emailNorm) orClauses.push(`email.ilike.${emailNorm}`);
          if (digits) orClauses.push(`phone.ilike.%${digits.slice(-10)}%`);
          if (orClauses.length > 0) {
            const { data: candidates } = await supabase
              .from("customers")
              .select("id, first_name, last_name, business_name, phone, email")
              .or(orClauses.join(","))
              .order("created_at", { ascending: true })
              .limit(10);
            matched = (candidates ?? []).find((c) => {
              const cDigits = (c.phone ?? "").replace(/\D/g, "");
              const phoneHit = digits.length >= 10 && cDigits.length >= 10 && cDigits.slice(-10) === digits.slice(-10);
              const emailHit = !!emailNorm && (c.email ?? "").trim().toLowerCase() === emailNorm;
              return phoneHit || emailHit;
            }) ?? null;
          }
        } catch { /* dedupe is best-effort — fall through to insert on lookup error */ }

        if (matched) {
          customerId = matched.id;
          const nm = [matched.first_name, matched.last_name].filter(Boolean).join(" ").trim() ||
            matched.business_name || "existing customer";
          setMatchNotice(`Matched existing customer ${nm} — reusing their record instead of creating a duplicate.`);
        } else {
          let created: { id: string } | undefined;
          try {
            created = (await mustWrite<{ id: string }>("create lead", supabase
              .from("customers")
              .insert({
                first_name: form.first_name.trim(),
                last_name: form.last_name.trim() || null,
                business_name: form.business_name.trim() || null,
                email: form.email.trim() || null,
                phone: normalizePhoneForStorage(form.phone.trim()),
                status: "lead",
                source: "other",
                is_live_transfer: defaults.isLiveTransfer,
              })))[0];
          } catch (e) {
            setError(`Could not create the lead: ${e instanceof Error ? e.message : "unknown error"}`);
            setSaving(false);
            return;
          }
          customerId = created.id;
        }
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
      const { data: openDeals } = await supabase
        .from("deals")
        .select("*")
        .eq("customer_id", customerId)
        .eq("deal_type", isVcf ? "vcf" : "mca")
        .not("status", "in", `(${CLOSED_STATUSES.join(",")})`)
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
        is_renewal: defaults.isRenewal ?? false,
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
            {isLiveIntake
              ? "Start the call — read the script, type name & phone as you talk"
              : "Start the lead — name & phone is all you need"}
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
                {isLiveIntake && mode === "new" ? (
                  <>They're on the line — <span className="font-medium">read the greeting below and type their name &amp; phone as you talk</span>.
                  Saving creates the {isVcf ? "VCF" : "MCA"} deal, pushes them to GoHighLevel, and opens the Qualify step so you keep going.</>
                ) : (
                  <>Just get them into the system: Saving creates the {isVcf ? "VCF" : "MCA"} deal and pushes the contact into
                  GoHighLevel. Then work the steps below — <span className="font-medium">each question you ask has its
                  own field right there</span>, so you capture answers without scrolling back up.</>
                )}
              </p>

              {error && (
                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg text-sm text-red-700 dark:text-red-300">
                  {error}
                </div>
              )}

              {matchNotice && (
                <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg text-sm text-amber-800 dark:text-amber-300">
                  {matchNotice}
                </div>
              )}

              {/* New vs existing toggle — only when this flow ever creates a
                  lead by hand (live transfer / walk-in). Import/email/pool paths
                  never type a lead in, so we don't offer "+ New lead" there. */}
              {allowsManualEntry ? (
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
              ) : (
                <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg text-xs text-blue-800 dark:text-blue-200">
                  These leads are <b>already in the system</b> — you don't type them in.
                  Open one from <b>My Day</b> above, or from <b>{playbook.workFrom.screen}</b>.
                  Use the search below only to pull up a specific existing lead.
                </div>
              )}

              {mode === "existing" ? (
                <div>
                  <input
                    type="text"
                    placeholder="Search all customers by name or business…"
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
                    className="input-field w-full mb-2"
                    autoFocus
                  />
                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700 overflow-hidden bg-white dark:bg-gray-800">
                    {filteredCustomers.slice(0, 8).map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        disabled={picking !== null}
                        onClick={() => pickCustomer(c.id)}
                        className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-emerald-50 dark:hover:bg-emerald-900/20 disabled:opacity-60"
                      >
                        <span className="text-gray-900 dark:text-white">
                          {c.first_name} {c.last_name}
                          {c.business_name ? <span className="text-gray-500"> — {c.business_name}</span> : null}
                        </span>
                        <span className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-ocean-blue">
                          {picking === c.id ? "Loading…" : "Work this lead"} <ArrowRightIcon className="w-3.5 h-3.5" />
                        </span>
                      </button>
                    ))}
                    {filteredCustomers.length === 0 && (
                      <p className="px-3 py-3 text-sm text-gray-500">No customers match — switch to “+ New lead”.</p>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    One click does it: their open deal loads right here — or, if their last deal closed, a fresh one starts
                    with their market / source / closer carried over.
                  </p>
                </div>
              ) : isLiveIntake ? (
                // Live-transfer intake: the opening script sits right above a
                // minimal capture — name + phone (required) and business name +
                // business email (prompted). Read the greeting while you type.
                // Live-transfer intake: the merchant is ALREADY on the line and you
                // don't know anything yet — so each script line ASKS for the piece,
                // and the box to type it sits right under that line. Read top to
                // bottom; name + cell is enough to Save (~15s).
                <div className="space-y-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-mint-green">
                    Read each line out loud — type the answer in the box under it. <span className="text-red-500">*</span> = needed to Save (~15s).
                  </p>
                  {/* 1 — greeting ASKS for the name; first required, last optional */}
                  <div className="rounded-lg bg-white/70 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 p-3">
                    <p className="text-sm text-gray-800 dark:text-gray-100 mb-2">
                      “Hi — this is <span className="font-semibold">[you]</span> with Momentum Funding, thanks for holding! <span className="text-mint-green font-semibold">Who do I have the pleasure of speaking with?</span>”
                    </p>
                    <div className="grid sm:grid-cols-2 gap-2">
                      <label className="block">
                        <span className="text-[11px] text-gray-500 dark:text-gray-400">First name <span className="text-red-500">*</span></span>
                        <input className="input-field w-full" value={form.first_name} onChange={(e) => set("first_name", e.target.value)} placeholder="Jane" autoFocus />
                      </label>
                      <label className="block">
                        <span className="text-[11px] text-gray-500 dark:text-gray-400">Last name <span className="text-gray-400">(optional)</span></span>
                        <input className="input-field w-full" value={form.last_name} onChange={(e) => set("last_name", e.target.value)} placeholder="Doe" />
                      </label>
                    </div>
                  </div>
                  {/* 2 — business name (optional) */}
                  <div className="rounded-lg bg-white/70 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 p-3">
                    <p className="text-sm text-gray-800 dark:text-gray-100 mb-2">
                      “Great to meet you{form.first_name.trim() ? `, ${form.first_name.trim()}` : ""} — <span className="text-mint-green font-semibold">and what’s the name of your business?</span>”
                    </p>
                    <label className="block">
                      <span className="text-[11px] text-gray-500 dark:text-gray-400">Business name <span className="text-gray-400">(optional)</span></span>
                      <input className="input-field w-full" value={form.business_name} onChange={(e) => set("business_name", e.target.value)} placeholder="Acme Co." />
                    </label>
                  </div>
                  {/* 3 — cell (required) */}
                  <div className="rounded-lg bg-white/70 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 p-3">
                    <p className="text-sm text-gray-800 dark:text-gray-100 mb-2">
                      “Perfect. <span className="text-mint-green font-semibold">What’s the best cell for you?</span> I’ll text your application link right there so it’s in your hand.”
                    </p>
                    <label className="block">
                      <span className="text-[11px] text-gray-500 dark:text-gray-400">Cell phone <span className="text-red-500">*</span></span>
                      <input className="input-field w-full" type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="(555) 123-4567" />
                    </label>
                  </div>
                  {/* 4 — email (optional) */}
                  <div className="rounded-lg bg-white/70 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 p-3">
                    <p className="text-sm text-gray-800 dark:text-gray-100 mb-2">
                      “And <span className="text-mint-green font-semibold">the best email</span> to send your application and secure upload link?”
                    </p>
                    <label className="block">
                      <span className="text-[11px] text-gray-500 dark:text-gray-400">Business email <span className="text-red-500">*</span></span>
                      <input className="input-field w-full" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="jane@acme.com" />
                    </label>
                  </div>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">
                    First name, cell + email (the <span className="text-red-500">*</span> fields) are required — the email is how we send their application. Hit <span className="font-medium">Save lead</span> and keep talking; the deal loads here and you roll into qualifying. Full legal name comes on the application.
                  </p>
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

              {mode === "new" && (<>
              {/* Qualifiers are captured inline at the Qualify step — not here.
                  On a live intake this note is redundant with the minimal-capture
                  hint above, so it's hidden there. */}
              {!isLiveIntake && (
                <p className="text-xs text-gray-500 dark:text-gray-400 rounded-md bg-white/60 dark:bg-gray-800/60 border border-dashed border-gray-300 dark:border-gray-600 px-3 py-2">
                  Name + phone is all you need to start. You'll capture {isVcf ? "positions, balances and daily debit" : "revenue, amount requested and time-in-business"} right inside the <span className="font-medium">Qualify</span> step below — as you ask each question, so you're never scrolling back up here.
                </p>
              )}

              {/* Campaign — promoted OUT of "More details" so it's front-and-center
                  on every flow (it was buried and leads saved untracked). Required
                  with a red * whenever an active campaign exists; the smart default
                  pre-picks the closest active match and the closer can change it. */}
              <div className="rounded-lg border-2 border-ocean-blue/40 dark:border-ocean-blue/50 bg-ocean-blue/5 dark:bg-ocean-blue/10 p-3">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-white">
                    <MegaphoneIcon className="w-4 h-4 text-ocean-blue" /> Campaign <span className="text-red-500">*</span>
                  </span>
                  <Link to="/admin/campaigns" className="text-[11px] font-medium text-ocean-blue hover:underline">
                    Manage campaigns ↗
                  </Link>
                </div>
                {activeCampaigns.length > 0 ? (
                  <>
                    <select
                      className="input-field w-full"
                      value={form.campaign_id}
                      onChange={(e) => { set("campaign_id", e.target.value); setCampaignDirty(true); }}
                    >
                      <option value="">Select a campaign…</option>
                      {activeCampaigns.map((c) => (
                        <option key={c.id} value={c.id}>{c.code ? `${c.code} — ${c.name}` : c.name}</option>
                      ))}
                    </select>
                    <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                      Every lead attaches to a campaign so cost-per-funded is real — we pre-picked the closest active match; change it if it's wrong.
                    </p>
                  </>
                ) : (
                  <div className="flex items-start gap-1.5 rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-2.5 py-2 text-[11px] text-amber-800 dark:text-amber-300">
                    <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      No active campaigns — this lead won't be tracked.{" "}
                      <Link to="/admin/campaigns" className="underline font-medium">Create one in Campaigns</Link> so cost-per-funded works.
                    </span>
                  </div>
                )}
              </div>

              {/* On a live intake, market/source/closer fold into "More details"
                  so name + phone + business email stays the fast path — the Save
                  button is reachable without scrolling past routing. On every other
                  flow these fields show inline (unchanged). Campaign now lives
                  above, outside the fold. */}
              {isLiveIntake && (
                <button
                  type="button"
                  onClick={() => setMoreOpen((o) => !o)}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                >
                  {moreOpen ? <ChevronUpIcon className="w-4 h-4" /> : <ChevronDownIcon className="w-4 h-4" />}
                  More details (market, closer) — optional
                </button>
              )}

              {(!isLiveIntake || moreOpen) && (<>
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
                <Field label="Assigned closer">
                  <select className="input-field w-full" value={form.assigned_closer_id} onChange={(e) => set("assigned_closer_id", e.target.value)}>
                    <option value="">Unassigned</option>
                    {closers.filter((c) => c.user_id).map((c) => (
                      // value MUST be the profile id (deals.assigned_closer_id → profiles.id);
                      // sending closers.id was a FK violation that failed every assigned save.
                      <option key={c.id} value={c.user_id!}>{c.first_name} {c.last_name}</option>
                    ))}
                  </select>
                </Field>
              </div>

              <Field label="Notes">
                <textarea className="input-field w-full h-16" value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Anything the next person should know…" />
              </Field>
              </>)}

              <div className="flex items-center justify-between gap-3 pt-1">
                <p className="text-xs text-gray-400">
                  {isLiveIntake
                    ? "Confirm the campaign above, then Save to start the call — the attribution is what makes cost-per-funded real."
                    : "The campaign above is what makes the cost-per-funded math work."}
                </p>
                <button type="submit" disabled={saving} className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed">
                  {saving ? "Saving…" : isVcf ? "Save VCF lead" : "Save lead"}
                </button>
              </div>
              </>)}
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
