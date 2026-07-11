import { useEffect, useMemo, useState } from "react";
import {
  RocketLaunchIcon,
  EnvelopeIcon,
  GlobeAltIcon,
  InformationCircleIcon,
  PlusIcon,
  PencilSquareIcon,
  TrashIcon,
  XMarkIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  BanknotesIcon,
  BoltIcon,
  SignalIcon,
} from "@heroicons/react/24/outline";
import supabase from "@/supabase";
import { mustWrite } from "@/supabase/writes";
// Reuse the shared live-Instantly warmup model so the two pages agree on what
// "warmed" means (single source of truth — do not fork this logic).
import { groupDomains, WARM_TONE, type DomainGroup, type Overview } from "@/lib/instantlyWarmup";

// ── Live Instantly analytics (action "analytics") ────────────────────────────
interface InstantlyAnalytics {
  ok?: boolean;
  warning?: string;
  totals?: {
    sent?: number;
    opened?: number;
    replied?: number;
    leads?: number;
    opportunities?: number;
    bounced?: number;
  };
  campaigns?: { id?: string; name?: string; sent?: number; opened?: number; replied?: number; leads?: number }[];
  error?: string;
}

// ============================================================================
// Cold Email Planner
//
// SECTION 1 — Capacity calculator (stateless): the cold-email scaling model has
// hard constraints — each mailbox sends a capped number of cold emails/day, and
// each domain holds a fixed max number of mailboxes (you scale by adding DOMAINS,
// not stuffing more mailboxes per domain). This turns those two knobs into a plan.
//
// SECTION 2 — Warmup seasoning tracker (persisted to `email_domains`): a domain
// isn't safe to send cold volume from until its mailboxes have warmed. 3 weeks is
// the minimum usable point, 6 weeks (42d) is fully seasoned. This clock shows,
// per domain, how far along warmup is and how much cold capacity is safe TODAY.
// ============================================================================

const MIN_WARMUP_DAYS = 21; // 3 weeks — usable
const FULL_WARMUP_DAYS = 42; // 6 weeks — optimal

type Purpose = "cold" | "transactional" | "brand";

interface EmailDomain {
  id: string;
  domain: string;
  provider: string;
  purpose: Purpose;
  owner: string | null;
  mailbox_count: number;
  warmup_started_at: string | null;
  notes: string | null;
}

// --- formatting helpers ------------------------------------------------------

const fmtInt = (n: number) =>
  !Number.isFinite(n) ? "—" : Math.round(n).toLocaleString();

const fmtMoney = (n: number) =>
  !Number.isFinite(n) ? "—" : `$${Math.round(n).toLocaleString()}`;

const fmtVol = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : fmtInt(n);

const fmtDate = (d: Date) =>
  d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

// Parse a date-only string ("YYYY-MM-DD") as LOCAL midnight (not UTC) so the day
// count doesn't drift by one across timezones.
const parseLocalDate = (s: string) => new Date(`${s}T00:00:00`);

const startOfToday = () => {
  const t = new Date();
  return new Date(t.getFullYear(), t.getMonth(), t.getDate());
};

const daysBetween = (from: Date, to: Date) =>
  Math.floor((to.getTime() - from.getTime()) / 86400000);

const addDays = (d: Date, n: number) => {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
};

// ============================================================================
// SECTION 2 — seasoning math (pure, tested by eye against the badge spec)
// ============================================================================

type SeasonStatus = "not_started" | "warming" | "ready" | "seasoned";

interface Seasoning {
  status: SeasonStatus;
  days: number; // days elapsed since warmup started (0 if not started)
  pct: number; // progress toward full warmup (42d), 0–100
  readyOn: Date | null; // start + 21d
  optimalOn: Date | null; // start + 42d
  readyCountdown: string; // "ready" | "ready in 12 days"
  seasonedCountdown: string; // "seasoned" | "seasoned in 30 days"
}

function computeSeasoning(startStr: string | null): Seasoning {
  if (!startStr) {
    return {
      status: "not_started",
      days: 0,
      pct: 0,
      readyOn: null,
      optimalOn: null,
      readyCountdown: "not started",
      seasonedCountdown: "not started",
    };
  }
  const start = parseLocalDate(startStr);
  const today = startOfToday();
  const days = Math.max(0, daysBetween(start, today));
  const readyOn = addDays(start, MIN_WARMUP_DAYS);
  const optimalOn = addDays(start, FULL_WARMUP_DAYS);

  const daysToReady = daysBetween(today, readyOn);
  const daysToSeasoned = daysBetween(today, optimalOn);

  const status: SeasonStatus =
    days >= FULL_WARMUP_DAYS ? "seasoned" : days >= MIN_WARMUP_DAYS ? "ready" : "warming";

  return {
    status,
    days,
    pct: Math.min(100, Math.round((days / FULL_WARMUP_DAYS) * 100)),
    readyOn,
    optimalOn,
    readyCountdown: daysToReady <= 0 ? "ready" : `ready in ${daysToReady} day${daysToReady === 1 ? "" : "s"}`,
    seasonedCountdown:
      daysToSeasoned <= 0 ? "seasoned" : `seasoned in ${daysToSeasoned} day${daysToSeasoned === 1 ? "" : "s"}`,
  };
}

const BADGE: Record<SeasonStatus, { label: (d: number) => string; cls: string }> = {
  not_started: {
    label: () => "⏳ Not started",
    cls: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
  },
  warming: {
    label: (d) => `🔴 Warming — ${d}d (not ready)`,
    cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  },
  ready: {
    label: (d) => `🟡 Ready — ${d}d (usable; 6wk optimal)`,
    cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  },
  seasoned: {
    label: (d) => `🟢 Seasoned — ${d}d (fully warmed)`,
    cls: "bg-mint-green/15 text-emerald-700 dark:bg-mint-green/15 dark:text-mint-green",
  },
};

// ============================================================================

const numCls =
  "w-full px-2 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:bg-white dark:focus:bg-gray-800 focus:border-ocean-blue outline-none";

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "mint" | "ocean" | "plain";
}) {
  const color =
    accent === "mint" ? "text-mint-green" : accent === "ocean" ? "text-ocean-blue" : "text-gray-900 dark:text-white";
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`text-3xl font-extrabold mt-1 tabular-nums ${color}`}>{value}</p>
      {sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

const SCALE_ROWS = [1, 2, 3, 5, 10, 20];

export default function ColdEmailPlannerPage() {
  // Shared model knobs — perMailbox is used by BOTH sections (it drives the
  // "safe capacity today" header in Section 2), which is why it lives up here.
  const [perMailbox, setPerMailbox] = useState(30); // cold emails/day per mailbox
  const [perDomain, setPerDomain] = useState(5); // max mailboxes per domain (their rule)
  const [workingDays, setWorkingDays] = useState(22); // sending days per month
  const [costPerMailbox, setCostPerMailbox] = useState(4); // $/mailbox/month

  // Calculator A — target-driven
  const [targetPerDay, setTargetPerDay] = useState(1000);
  // Calculator B — inventory-driven
  const [numDomains, setNumDomains] = useState(5);
  // Funnel assumptions
  const [replyRate, setReplyRate] = useState(3); // % of sends that reply
  const [positiveToLead, setPositiveToLead] = useState(30); // % of replies that become a lead
  // Financial assumptions (platform economics: 8 points on a ~$50K advance = $4,000)
  const [leadToFunded, setLeadToFunded] = useState(8); // % of leads that fund
  const [avgCommission, setAvgCommission] = useState(4000); // $ commission per funded deal

  const safePerMailbox = Math.max(1, perMailbox);
  const safePerDomain = Math.max(1, perDomain);

  // --- Calculator A: "I want to send N emails/day" -------------------------
  const calcA = useMemo(() => {
    const mailboxes = Math.ceil(targetPerDay / safePerMailbox);
    const domains = Math.ceil(mailboxes / safePerDomain);
    const monthly = targetPerDay * workingDays;
    return { mailboxes, domains, monthly, cost: mailboxes * costPerMailbox };
  }, [targetPerDay, safePerMailbox, safePerDomain, workingDays, costPerMailbox]);

  // --- Calculator B: "I have D domains" ------------------------------------
  const calcB = useMemo(() => {
    const mailboxes = numDomains * safePerDomain;
    const perDay = mailboxes * safePerMailbox;
    return { mailboxes, perDay, monthly: perDay * workingDays, cost: mailboxes * costPerMailbox };
  }, [numDomains, safePerDomain, safePerMailbox, workingDays, costPerMailbox]);

  // --- Funnel (assumptions) — applied to Calculator A's monthly volume ------
  const funnel = useMemo(() => {
    const replies = calcA.monthly * (replyRate / 100);
    const leads = replies * (positiveToLead / 100);
    return { replies, leads };
  }, [calcA.monthly, replyRate, positiveToLead]);

  // --- Financial projection (from the modeled leads) ------------------------
  const financials = useMemo(() => {
    const leads = funnel.leads;
    const funded = leads * (leadToFunded / 100);
    const revenue = funded * avgCommission;
    const cost = calcA.cost; // mailboxes × $/mailbox/mo
    const net = revenue - cost;
    return {
      funded,
      revenue,
      cost,
      net,
      roi: cost > 0 ? net / cost : NaN, // net ROI multiple on spend
      costPerLead: leads > 0 ? cost / leads : NaN,
      costPerFunded: funded > 0 ? cost / funded : NaN,
    };
  }, [funnel.leads, leadToFunded, avgCommission, calcA.cost]);

  // --- Scaling table -------------------------------------------------------
  const scaleRows = useMemo(
    () =>
      SCALE_ROWS.map((d) => {
        const mailboxes = d * safePerDomain;
        const perDay = mailboxes * safePerMailbox;
        return {
          domains: d,
          mailboxes,
          perDay,
          monthly: perDay * workingDays,
          cost: mailboxes * costPerMailbox,
        };
      }),
    [safePerDomain, safePerMailbox, workingDays, costPerMailbox],
  );

  // ==========================================================================
  // SECTION 2 state
  // ==========================================================================
  const [domains, setDomains] = useState<EmailDomain[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EmailDomain | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadDomains = async () => {
    setLoading(true);
    setLoadError(null);
    const { data, error } = await supabase
      .from("email_domains")
      .select("id, domain, provider, purpose, owner, mailbox_count, warmup_started_at, notes")
      .order("created_at", { ascending: true });
    if (error) setLoadError(error.message);
    else setDomains((data ?? []) as EmailDomain[]);
    setLoading(false);
  };

  useEffect(() => {
    void loadDomains();
  }, []);

  // ── Live Instantly (real data — the source of truth) ─────────────────────
  const [overview, setOverview] = useState<Overview | null>(null);
  const [analytics, setAnalytics] = useState<InstantlyAnalytics | null>(null);
  const [liveLoading, setLiveLoading] = useState(true);
  const [liveError, setLiveError] = useState<string | null>(null);

  const loadLive = async () => {
    setLiveLoading(true);
    setLiveError(null);
    const [ov, an] = await Promise.all([
      supabase.functions.invoke("instantly", { body: { action: "overview" } }),
      supabase.functions.invoke("instantly", { body: { action: "analytics" } }),
    ]);
    if (ov.error) setLiveError(ov.error.message || "Failed to reach Instantly");
    else if ((ov.data as { error?: string } | undefined)?.error)
      setLiveError((ov.data as { error?: string }).error ?? null);
    else setOverview(ov.data as Overview);
    // Analytics is best-effort — never hard-fail the page on it.
    if (!an.error && an.data && !(an.data as InstantlyAnalytics).error) {
      setAnalytics(an.data as InstantlyAnalytics);
    }
    setLiveLoading(false);
  };

  useEffect(() => {
    void loadLive();
  }, []);

  // Real sending domains grouped from the live Instantly accounts (reuses the
  // exact grouping/warmup model from EmailPage).
  const liveGroups = useMemo(
    () => groupDomains(overview?.accounts ?? [], overview?.forwarding ?? {}, Date.now()),
    [overview],
  );
  const liveDomainSet = useMemo(
    () => new Set(liveGroups.map((g) => g.domain.trim().toLowerCase())),
    [liveGroups],
  );
  const realSite = overview?.real_site ?? "mfunding.net";

  // Safe cold sending capacity RIGHT NOW, computed from the LIVE seasoned
  // domains (≥21 real warmup days) × the per-mailbox rate from Section 1.
  const liveSafe = useMemo(() => {
    const seasoned = liveGroups.filter((g) => g.ws.days >= MIN_WARMUP_DAYS);
    return {
      capacity: seasoned.reduce((sum, g) => sum + g.accts.length * safePerMailbox, 0),
      count: seasoned.length,
    };
  }, [liveGroups, safePerMailbox]);

  // Only show manual rows that are NOT already live in Instantly and are cold.
  // (Naturally hides the brand row and stops a domain double-showing once live.)
  const plannedDomains = useMemo(
    () =>
      domains.filter(
        (d) => d.purpose === "cold" && !liveDomainSet.has(d.domain.trim().toLowerCase()),
      ),
    [domains, liveDomainSet],
  );

  // ── Real reply/lead actuals from Instantly analytics ─────────────────────
  const actuals = useMemo(() => {
    const t = analytics?.totals;
    if (!t) return null;
    const sent = Number(t.sent) || 0;
    const opened = Number(t.opened) || 0;
    const replied = Number(t.replied) || 0;
    const leads = Number(t.leads) || 0;
    if (sent === 0 && replied === 0 && leads === 0) return null; // no meaningful data yet
    return {
      sent,
      opened,
      replied,
      leads,
      replyRate: sent > 0 ? (replied / sent) * 100 : 0, // real reply rate
      replyToLead: replied > 0 ? (leads / replied) * 100 : 0, // real reply→lead
    };
  }, [analytics]);

  const useActuals = () => {
    if (!actuals) return;
    setReplyRate(Number(actuals.replyRate.toFixed(2)));
    setPositiveToLead(Number(actuals.replyToLead.toFixed(1)));
  };

  // ── Real cold-email-attributed funded deals from the pipeline ────────────
  const [realDeals, setRealDeals] = useState<{ funded: number; revenue: number } | null>(null);
  const [realDealsLoading, setRealDealsLoading] = useState(true);

  const loadRealDeals = async () => {
    setRealDealsLoading(true);
    const COLD_SOURCES = new Set(["cold_email", "coldemail", "instantly", "email", "email_outreach"]);
    const { data: deals, error } = await supabase
      .from("deals")
      .select("amount_funded, lead_source, status, campaign_id")
      .in("status", ["funded", "renewal_eligible"]);
    if (error || !deals) {
      setRealDeals({ funded: 0, revenue: 0 });
      setRealDealsLoading(false);
      return;
    }
    // Campaigns whose channel is email → their funded deals count as cold-sourced.
    const { data: camps } = await supabase.from("campaigns").select("id, channel");
    const emailCampaignIds = new Set(
      (camps ?? [])
        .filter((c) => ["email", "cold_email"].includes(String((c as { channel?: string }).channel)))
        .map((c) => (c as { id: string }).id),
    );
    let funded = 0;
    let amount = 0;
    for (const d of deals as { amount_funded: number | null; lead_source: string | null; campaign_id: string | null }[]) {
      const src = (d.lead_source ?? "").toString().toLowerCase();
      const bySource = COLD_SOURCES.has(src);
      const byCampaign = d.campaign_id != null && emailCampaignIds.has(d.campaign_id);
      if (bySource || byCampaign) {
        funded += 1;
        amount += Number(d.amount_funded) || 0;
      }
    }
    setRealDeals({ funded, revenue: amount * 0.08 }); // 8 points
    setRealDealsLoading(false);
  };

  useEffect(() => {
    void loadRealDeals();
  }, []);

  // --- CRUD ----------------------------------------------------------------
  const openCreate = () => {
    setEditing(null);
    setFormError(null);
    setShowForm(true);
  };
  const openEdit = (d: EmailDomain) => {
    setEditing(d);
    setFormError(null);
    setShowForm(true);
  };

  const handleSave = async (payload: {
    domain: string;
    provider: string;
    purpose: Purpose;
    owner: string;
    mailbox_count: number;
    warmup_started_at: string | null;
    notes: string;
  }) => {
    setSaving(true);
    setFormError(null);
    try {
      const row = {
        domain: payload.domain.trim(),
        provider: payload.provider.trim() || "instantly",
        purpose: payload.purpose,
        owner: payload.owner.trim() || null,
        mailbox_count: Math.max(0, Math.round(payload.mailbox_count)),
        warmup_started_at: payload.warmup_started_at || null,
        notes: payload.notes.trim() || null,
      };
      if (editing) {
        await mustWrite(
          "update email domain",
          supabase
            .from("email_domains")
            .update({ ...row, updated_at: new Date().toISOString() })
            .eq("id", editing.id),
        );
      } else {
        await mustWrite("create email domain", supabase.from("email_domains").insert(row));
      }
      setShowForm(false);
      setEditing(null);
      await loadDomains();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (d: EmailDomain) => {
    if (!window.confirm(`Delete ${d.domain}? This can't be undone.`)) return;
    try {
      await mustWrite("delete email domain", supabase.from("email_domains").delete().eq("id", d.id));
      await loadDomains();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-start gap-3 mb-6">
        <RocketLaunchIcon className="w-8 h-8 text-mint-green flex-shrink-0" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Cold Email Planner</h1>
          <p className="text-gray-600 dark:text-gray-300 mt-1 max-w-3xl">
            Size the cold-email machine and track domain warmup. You scale by adding <b>domains</b> — each holds a
            fixed number of mailboxes, and each mailbox sends a capped number of emails/day. A domain isn't safe to
            send from until its mailboxes have seasoned (3 weeks minimum, 6 weeks optimal).
          </p>
        </div>
      </div>

      {/* Shared model knobs */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <label className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700 block">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Emails / mailbox / day</span>
          <input
            type="number"
            min={1}
            step={1}
            value={perMailbox}
            onChange={(e) => setPerMailbox(Math.max(1, Number(e.target.value)))}
            className="w-full text-2xl font-bold text-mint-green bg-transparent outline-none mt-1"
          />
          <span className="text-[11px] text-gray-400">warmed range 25–50</span>
        </label>
        <label className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700 block">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Max mailboxes / domain</span>
          <input
            type="number"
            min={1}
            step={1}
            value={perDomain}
            onChange={(e) => setPerDomain(Math.max(1, Number(e.target.value)))}
            className="w-full text-2xl font-bold text-gray-900 dark:text-white bg-transparent outline-none mt-1"
          />
          <span className="text-[11px] text-gray-400">the hard rule — scale via domains</span>
        </label>
        <label className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700 block">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Sending days / month</span>
          <input
            type="number"
            min={1}
            step={1}
            value={workingDays}
            onChange={(e) => setWorkingDays(Math.max(1, Number(e.target.value)))}
            className="w-full text-2xl font-bold text-gray-900 dark:text-white bg-transparent outline-none mt-1"
          />
          <span className="text-[11px] text-gray-400">monthly volume = daily × this</span>
        </label>
        <label className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700 block">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">$ / mailbox / month</span>
          <div className="flex items-center gap-1 mt-1">
            <span className="text-2xl font-bold text-gray-900 dark:text-white">$</span>
            <input
              type="number"
              min={0}
              step={0.5}
              value={costPerMailbox}
              onChange={(e) => setCostPerMailbox(Math.max(0, Number(e.target.value)))}
              className="w-full text-2xl font-bold text-gray-900 dark:text-white bg-transparent outline-none"
            />
          </div>
          <span className="text-[11px] text-gray-400">for the cost column</span>
        </label>
      </div>

      {/* ================= SECTION 1 ================= */}
      <div className="flex items-center gap-2 mb-3">
        <CalculatorHeading />
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mb-4">
        {/* Calculator A */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 border border-gray-200 dark:border-gray-700">
          <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <EnvelopeIcon className="w-5 h-5 text-ocean-blue" /> I want to send N emails/day
          </h3>
          <label className="block mt-3">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Target emails / day</span>
            <input
              type="number"
              min={0}
              step={100}
              value={targetPerDay}
              onChange={(e) => setTargetPerDay(Math.max(0, Number(e.target.value)))}
              className={`${numCls} mt-1 text-lg font-bold`}
            />
          </label>
          <div className="grid grid-cols-3 gap-3 mt-4">
            <StatCard label="Mailboxes needed" value={fmtInt(calcA.mailboxes)} accent="mint" />
            <StatCard label="Domains needed" value={fmtInt(calcA.domains)} accent="ocean" />
            <StatCard label="Volume / month" value={fmtVol(calcA.monthly)} sub={`× ${workingDays} days`} />
          </div>
          <p className="text-[11px] text-gray-400 mt-2">
            mailboxes = ⌈target ÷ {safePerMailbox}⌉ · domains = ⌈mailboxes ÷ {safePerDomain}⌉ · est. cost{" "}
            {fmtMoney(calcA.cost)}/mo
          </p>

          {/* Funnel (assumptions) */}
          <div className="mt-4 rounded-xl border border-dashed border-gray-300 dark:border-gray-600 p-3">
            <p className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-2">
              Lead funnel <span className="font-normal text-gray-400">(assumptions — from {fmtVol(calcA.monthly)} emails/mo)</span>
            </p>
            <div className="flex flex-wrap items-end gap-4">
              <label className="text-xs text-gray-500 dark:text-gray-400">
                Reply rate %
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={replyRate}
                  onChange={(e) => setReplyRate(Math.max(0, Number(e.target.value)))}
                  className={`${numCls} w-20 mt-1`}
                />
              </label>
              <label className="text-xs text-gray-500 dark:text-gray-400">
                Reply → lead %
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={positiveToLead}
                  onChange={(e) => setPositiveToLead(Math.max(0, Number(e.target.value)))}
                  className={`${numCls} w-20 mt-1`}
                />
              </label>
              <div className="ml-auto text-right">
                <p className="text-[11px] text-gray-400">Est. leads / month</p>
                <p className="text-2xl font-extrabold text-mint-green tabular-nums">{fmtInt(funnel.leads)}</p>
                <p className="text-[11px] text-gray-400">{fmtInt(funnel.replies)} replies</p>
              </div>
            </div>
          </div>
        </div>

        {/* Calculator B */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 border border-gray-200 dark:border-gray-700">
          <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <GlobeAltIcon className="w-5 h-5 text-ocean-blue" /> I have D domains
          </h3>
          <label className="block mt-3">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400"># of domains</span>
            <input
              type="number"
              min={0}
              step={1}
              value={numDomains}
              onChange={(e) => setNumDomains(Math.max(0, Number(e.target.value)))}
              className={`${numCls} mt-1 text-lg font-bold`}
            />
          </label>
          <div className="grid grid-cols-3 gap-3 mt-4">
            <StatCard label="Mailboxes" value={fmtInt(calcB.mailboxes)} accent="mint" />
            <StatCard label="Emails / day" value={fmtVol(calcB.perDay)} accent="ocean" />
            <StatCard label="Emails / month" value={fmtVol(calcB.monthly)} sub={`× ${workingDays} days`} />
          </div>
          <p className="text-[11px] text-gray-400 mt-2">
            mailboxes = {numDomains} × {safePerDomain} · emails/day = mailboxes × {safePerMailbox} · est. cost{" "}
            {fmtMoney(calcB.cost)}/mo
          </p>
        </div>
      </div>

      {/* Actuals (Instantly) — real reply/lead numbers to calibrate the model */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 border border-gray-200 dark:border-gray-700 mb-4">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <SignalIcon className="w-5 h-5 text-ocean-blue" />
          <h3 className="font-semibold text-gray-900 dark:text-white">Actuals (Instantly)</h3>
          <span className="text-[11px] text-gray-400">real send performance — the model above is assumptions</span>
          {actuals && (
            <button
              onClick={useActuals}
              className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-ocean-blue text-white text-xs font-semibold hover:opacity-90"
              title="Set the funnel's reply rate and reply→lead % from these real numbers"
            >
              <ArrowPathIcon className="w-3.5 h-3.5" /> Use my actuals
            </button>
          )}
        </div>
        {liveLoading && !actuals ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading live analytics…</p>
        ) : actuals ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard label="Sent" value={fmtInt(actuals.sent)} />
            <StatCard label="Opened" value={fmtInt(actuals.opened)} />
            <StatCard label="Replied" value={fmtInt(actuals.replied)} accent="ocean" />
            <StatCard label="Leads" value={fmtInt(actuals.leads)} accent="mint" />
            <StatCard label="Reply rate" value={`${actuals.replyRate.toFixed(1)}%`} sub="replied ÷ sent" />
            <StatCard label="Reply → lead" value={`${actuals.replyToLead.toFixed(0)}%`} sub="leads ÷ replied" />
          </div>
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No live analytics yet — showing your assumptions. Real reply/lead numbers appear here once campaigns start
            sending.
          </p>
        )}
      </div>

      {/* Financial projection — modeled revenue from the funnel, plus real pipeline */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 border border-gray-200 dark:border-gray-700 mb-4">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <BanknotesIcon className="w-5 h-5 text-mint-green" />
          <h3 className="font-semibold text-gray-900 dark:text-white">Financial projection</h3>
          <span className="text-[11px] text-gray-400">
            from {fmtInt(funnel.leads)} modeled leads/mo · cost = {fmtInt(calcA.mailboxes)} mailboxes ×{" "}
            {fmtMoney(costPerMailbox)}
          </span>
        </div>

        <div className="flex flex-wrap items-end gap-4 mt-3">
          <label className="text-xs text-gray-500 dark:text-gray-400">
            Lead → funded %
            <input
              type="number"
              min={0}
              step={0.5}
              value={leadToFunded}
              onChange={(e) => setLeadToFunded(Math.max(0, Number(e.target.value)))}
              className={`${numCls} w-24 mt-1`}
            />
          </label>
          <label className="text-xs text-gray-500 dark:text-gray-400">
            Avg commission $
            <input
              type="number"
              min={0}
              step={250}
              value={avgCommission}
              onChange={(e) => setAvgCommission(Math.max(0, Number(e.target.value)))}
              className={`${numCls} w-28 mt-1`}
            />
          </label>
          <span className="text-[11px] text-gray-400 mb-1.5">default: 8% of leads fund, 8 points on ~$50K = $4,000</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          <StatCard label="Funded deals / mo" value={fmtInt(financials.funded)} accent="mint" />
          <StatCard label="Revenue / mo" value={fmtMoney(financials.revenue)} accent="ocean" />
          <StatCard label="Sending cost / mo" value={fmtMoney(financials.cost)} />
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Net profit / mo</p>
            <p
              className={`text-3xl font-extrabold mt-1 tabular-nums ${
                financials.net >= 0 ? "text-mint-green" : "text-red-500"
              }`}
            >
              {fmtMoney(financials.net)}
            </p>
            <p className="text-[11px] text-gray-400 mt-0.5">revenue − sending cost</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
          <StatCard
            label="ROI on send spend"
            value={Number.isFinite(financials.roi) ? `${financials.roi.toFixed(1)}×` : "—"}
            sub="net ÷ sending cost"
          />
          <StatCard label="Cost / lead" value={fmtMoney(financials.costPerLead)} />
          <StatCard label="Cost / funded deal" value={fmtMoney(financials.costPerFunded)} sub="target < $1,500" />
        </div>

        {/* Real pipeline overlay — cold-email-attributed funded deals */}
        <div className="mt-4 rounded-xl border border-dashed border-gray-300 dark:border-gray-600 p-3">
          <div className="flex items-center gap-2 mb-1">
            <BoltIcon className="w-4 h-4 text-ocean-blue" />
            <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">Real — cold-email-sourced funded deals</p>
          </div>
          {realDealsLoading ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">Checking the pipeline…</p>
          ) : realDeals && realDeals.funded > 0 ? (
            <div className="flex flex-wrap items-center gap-6">
              <div>
                <p className="text-[11px] text-gray-400">Funded (actual)</p>
                <p className="text-2xl font-extrabold text-mint-green tabular-nums">{fmtInt(realDeals.funded)}</p>
              </div>
              <div>
                <p className="text-[11px] text-gray-400">Revenue (actual, 8 pts)</p>
                <p className="text-2xl font-extrabold text-ocean-blue tabular-nums">{fmtMoney(realDeals.revenue)}</p>
              </div>
              <p className="text-[11px] text-gray-400 max-w-xs">
                vs. modeled {fmtInt(financials.funded)} funded / {fmtMoney(financials.revenue)} above. Attributed by
                lead source or email-channel campaign.
              </p>
            </div>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No cold-email-sourced funded deals yet — projection shown above. Deals attribute here once they fund with
              a cold-email lead source or an email-channel campaign.
            </p>
          )}
        </div>
      </div>

      {/* Scaling table */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-x-auto mb-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
              <th className="py-3 px-4 font-semibold">Domains</th>
              <th className="py-3 px-4 font-semibold text-right">Mailboxes</th>
              <th className="py-3 px-4 font-semibold text-right">Emails / day</th>
              <th className="py-3 px-4 font-semibold text-right">Emails / month</th>
              <th className="py-3 px-4 font-semibold text-right">Cost / month</th>
            </tr>
          </thead>
          <tbody>
            {scaleRows.map((r) => (
              <tr key={r.domains} className="border-b border-gray-100 dark:border-gray-700/50 last:border-0">
                <td className="py-2.5 px-4 font-semibold text-gray-900 dark:text-white">{r.domains}</td>
                <td className="py-2.5 px-4 text-right tabular-nums text-gray-700 dark:text-gray-300">{fmtInt(r.mailboxes)}</td>
                <td className="py-2.5 px-4 text-right tabular-nums text-gray-700 dark:text-gray-300">{fmtInt(r.perDay)}</td>
                <td className="py-2.5 px-4 text-right tabular-nums font-semibold text-ocean-blue">{fmtInt(r.monthly)}</td>
                <td className="py-2.5 px-4 text-right tabular-nums text-gray-700 dark:text-gray-300">{fmtMoney(r.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-gray-400 mb-8">
        At {safePerMailbox} emails/mailbox/day and {safePerDomain} mailboxes/domain. Cost at {fmtMoney(costPerMailbox)}
        /mailbox/mo.
      </p>

      {/* ================= SECTION 2 ================= */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <GlobeAltIcon className="w-5 h-5 text-mint-green" /> Warmup Seasoning Tracker
        </h2>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-mint-green text-midnight-blue text-sm font-semibold hover:opacity-90"
        >
          <PlusIcon className="w-4 h-4" /> Add domain
        </button>
        <div className="ml-auto bg-mint-green/10 border border-mint-green/30 rounded-xl px-4 py-2 text-right">
          <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400">Safe cold capacity today</p>
          <p className="text-2xl font-extrabold text-mint-green tabular-nums leading-tight">
            ~{fmtInt(liveSafe.capacity)} <span className="text-sm font-semibold">emails/day</span>
          </p>
          <p className="text-[11px] text-gray-400">
            from {liveSafe.count} live seasoned domain{liveSafe.count === 1 ? "" : "s"} (≥21d, real warmup)
          </p>
        </div>
      </div>

      {/* Live in Instantly — the source of truth (real mailboxes + warmup) */}
      <LiveInstantlyDomains
        groups={liveGroups}
        realSite={realSite}
        perMailbox={safePerMailbox}
        loading={liveLoading}
        error={liveError}
        onRefresh={loadLive}
      />

      {/* Planned domains — manual tracker for domains owned but not yet connected */}
      <div className="flex items-center gap-2 mb-2 mt-8">
        <h3 className="text-base font-bold text-gray-900 dark:text-white">
          Planned domains{" "}
          <span className="font-normal text-gray-400 text-sm">(owned, not yet connected to Instantly)</span>
        </h3>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
        Cold domains you're seasoning outside Instantly. Once a domain shows up live above, it drops off this list
        automatically. Add/edit/delete here as your plan changes.
      </p>

      {loadError && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 text-sm text-red-700 dark:text-red-300 mb-4">
          Failed to load domains: {loadError}
        </div>
      )}

      {loading ? (
        <p className="text-gray-500 dark:text-gray-400 text-sm">Loading domains…</p>
      ) : plannedDomains.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400 text-sm">
          {domains.length === 0
            ? "No planned domains yet. Add a cold domain you own but haven't connected to Instantly."
            : "No planned domains — every cold domain you track is already live in Instantly above."}
        </p>
      ) : (
        <div className="space-y-3 mb-8">
          {plannedDomains.map((d) => (
            <DomainRow key={d.id} d={d} perMailbox={safePerMailbox} onEdit={() => openEdit(d)} onDelete={() => handleDelete(d)} />
          ))}
        </div>
      )}

      {/* Caveat */}
      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 text-sm text-amber-900 dark:text-amber-200">
        <div className="flex items-center gap-2 font-semibold mb-1">
          <InformationCircleIcon className="w-5 h-5" /> Reality check
        </div>
        Warmup ramps sending volume gradually — a domain at 21 days is <i>usable</i> but shouldn't jump straight to its
        full per-mailbox cap. 6 weeks (42 days) is where deliverability settles. Confirm real mailbox counts and warmup
        start dates in your ESP (Instantly) — this tracker is a planning view, not the source of truth for what's
        actually sending.
      </div>

      {/* Add / Edit modal */}
      {showForm && (
        <DomainForm
          editing={editing}
          saving={saving}
          error={formError}
          onCancel={() => {
            setShowForm(false);
            setEditing(null);
          }}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live in Instantly — real sending domains grouped from the live accounts.
// Uses EmailPage's groupDomains/warmState output + WARM_TONE so it agrees with
// the Email page exactly. This is the truth; the manual list below is planning.
// ---------------------------------------------------------------------------

function LiveInstantlyDomains({
  groups,
  realSite,
  perMailbox,
  loading,
  error,
  onRefresh,
}: {
  groups: DomainGroup[];
  realSite: string;
  perMailbox: number;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  return (
    <div className="mb-2">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <BoltIcon className="w-5 h-5 text-mint-green" />
        <h3 className="text-base font-bold text-gray-900 dark:text-white">Live in Instantly</h3>
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-mint-green/15 text-emerald-700 dark:text-mint-green font-semibold">
          source of truth
        </span>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-xs text-gray-700 dark:text-gray-200 hover:border-ocean-blue disabled:opacity-60"
        >
          <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
        Real mailboxes and real warmup days pulled from Instantly — <span className="text-red-600 dark:text-red-400 font-medium">red &lt; 3 wks</span> ·{" "}
        <span className="text-amber-600 dark:text-amber-400 font-medium">yellow 3–6 wks</span> ·{" "}
        <span className="text-emerald-600 dark:text-emerald-400 font-medium">green ≥ 6 wks</span>. Forwarding should point to {realSite}.
      </p>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-300 mb-3">
          <ExclamationTriangleIcon className="w-5 h-5 flex-shrink-0" />
          <div>
            <b>Couldn't load live Instantly data.</b> {error}
          </div>
        </div>
      )}

      {loading && groups.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading live Instantly domains…</p>
      ) : groups.length === 0 && !error ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No live sending domains in Instantly yet. Connect a domain in the Email page, then it appears here as the
          source of truth.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((g) => {
            const t = WARM_TONE[g.ws.tone];
            const seasoned = g.ws.days >= MIN_WARMUP_DAYS;
            return (
              <div key={g.domain} className={`rounded-xl border-2 ${t.ring} bg-white dark:bg-gray-800 p-4`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-gray-900 dark:text-white truncate">{g.domain}</span>
                  <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${t.chip}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${t.dot}`} /> {g.ws.tone}
                  </span>
                </div>

                <div className="mt-2 flex items-end gap-2">
                  <span className={`text-3xl font-extrabold tabular-nums ${t.text}`}>{g.ws.started ? g.ws.days : "—"}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400 mb-1">days warming</span>
                </div>
                <p className={`text-xs font-medium ${t.text}`}>{g.ws.label}</p>

                <div className="mt-2 h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                  <div className={`h-full ${t.bar} transition-all`} style={{ width: `${g.ws.pct}%` }} />
                </div>

                <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Mailboxes</span>
                    <span className="text-gray-800 dark:text-gray-200 font-medium">{g.accts.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Warmup health</span>
                    <span className="text-gray-800 dark:text-gray-200 font-medium">{g.avgHealth}%</span>
                  </div>
                  <div className="flex justify-between items-center gap-2">
                    <span className="text-gray-500">Forwarding</span>
                    {g.fwd?.ok ? (
                      <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                        <CheckCircleIcon className="w-3.5 h-3.5" />
                        {realSite}
                      </span>
                    ) : g.fwd?.target ? (
                      <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400 font-medium" title={`Should forward to ${realSite}`}>
                        <ExclamationTriangleIcon className="w-3.5 h-3.5" />→ {g.fwd.target} ✕
                      </span>
                    ) : (
                      <span className="text-gray-400">unknown</span>
                    )}
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Cold capacity</span>
                    <span className="text-gray-800 dark:text-gray-200 font-medium">
                      {seasoned ? `~${fmtInt(g.accts.length * perMailbox)}/day now` : `~${fmtInt(g.accts.length * perMailbox)}/day when seasoned`}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CalculatorHeading() {
  return (
    <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
      <RocketLaunchIcon className="w-5 h-5 text-mint-green" /> Capacity Calculator
    </h2>
  );
}

// ---------------------------------------------------------------------------

function DomainRow({
  d,
  perMailbox,
  onEdit,
  onDelete,
}: {
  d: EmailDomain;
  perMailbox: number;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const isCold = d.purpose === "cold";
  const s = computeSeasoning(d.warmup_started_at);
  const badge = BADGE[s.status];

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-gray-900 dark:text-white truncate">{d.domain}</p>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300 capitalize">
              {d.purpose}
            </span>
            <span className="text-[11px] text-gray-400 capitalize">{d.provider}</span>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {d.owner || "—"} · {d.mailbox_count} mailbox{d.mailbox_count === 1 ? "" : "es"}
            {isCold && d.mailbox_count > 0 && (
              <> · caps at {fmtInt(d.mailbox_count * perMailbox)} emails/day when seasoned</>
            )}
          </p>
          {d.notes && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 max-w-2xl">{d.notes}</p>}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onEdit}
            className="p-1.5 rounded-lg text-gray-400 hover:text-ocean-blue hover:bg-gray-100 dark:hover:bg-gray-700"
            title="Edit"
          >
            <PencilSquareIcon className="w-4 h-4" />
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-gray-700"
            title="Delete"
          >
            <TrashIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      {isCold ? (
        <div className="mt-3">
          <div className="flex flex-wrap items-center gap-2 mb-1.5">
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${badge.cls}`}>
              {badge.label(s.days)}
            </span>
            {s.status !== "not_started" && (
              <span className="text-xs text-gray-400">
                {s.readyCountdown === "ready" ? (
                  <>ready · {s.seasonedCountdown}</>
                ) : (
                  <>{s.readyCountdown}</>
                )}
              </span>
            )}
          </div>
          {/* Progress toward 6 weeks (42d) */}
          <div className="h-2.5 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                s.status === "seasoned"
                  ? "bg-mint-green"
                  : s.status === "ready"
                    ? "bg-amber-400"
                    : s.status === "warming"
                      ? "bg-red-400"
                      : "bg-gray-300 dark:bg-gray-600"
              }`}
              style={{ width: `${s.pct}%` }}
            />
          </div>
          <div className="flex justify-between text-[11px] text-gray-400 mt-1">
            <span>
              {s.readyOn
                ? `ready ${fmtDate(s.readyOn)} (21d)`
                : "set a warmup start date to begin the clock"}
            </span>
            <span>{s.optimalOn ? `optimal ${fmtDate(s.optimalOn)} (42d)` : ""}</span>
          </div>
        </div>
      ) : (
        <div className="mt-3 text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/40 rounded-lg px-3 py-2">
          Brand / transactional domain — not warming for cold volume. Keep cold sends off this domain to protect its
          reputation.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

const PURPOSES: Purpose[] = ["cold", "transactional", "brand"];

function DomainForm({
  editing,
  saving,
  error,
  onCancel,
  onSave,
}: {
  editing: EmailDomain | null;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (p: {
    domain: string;
    provider: string;
    purpose: Purpose;
    owner: string;
    mailbox_count: number;
    warmup_started_at: string | null;
    notes: string;
  }) => void;
}) {
  const [domain, setDomain] = useState(editing?.domain ?? "");
  const [provider, setProvider] = useState(editing?.provider ?? "instantly");
  const [purpose, setPurpose] = useState<Purpose>(editing?.purpose ?? "cold");
  const [owner, setOwner] = useState(editing?.owner ?? "");
  const [mailboxCount, setMailboxCount] = useState(editing?.mailbox_count ?? 0);
  const [warmupStart, setWarmupStart] = useState(editing?.warmup_started_at ?? "");
  const [notes, setNotes] = useState(editing?.notes ?? "");

  const canSave = domain.trim().length > 0 && !saving;
  const inputCls = `${numCls} mt-1`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onCancel}>
      <div
        className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 w-full max-w-lg max-h-[90vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">
            {editing ? "Edit domain" : "Add domain"}
          </h3>
          <button onClick={onCancel} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-300 mb-4">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400 col-span-2">
            Domain
            <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="getmfunding.com" className={inputCls} />
          </label>
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
            Owner (real name)
            <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Ernesto Lee" className={inputCls} />
          </label>
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
            Provider
            <input value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="instantly" className={inputCls} />
          </label>
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
            Purpose
            <select value={purpose} onChange={(e) => setPurpose(e.target.value as Purpose)} className={inputCls}>
              {PURPOSES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
            Mailbox count
            <input
              type="number"
              min={0}
              step={1}
              value={mailboxCount}
              onChange={(e) => setMailboxCount(Math.max(0, Number(e.target.value)))}
              className={inputCls}
            />
          </label>
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400 col-span-2">
            Warmup started {purpose !== "cold" && <span className="text-gray-400">(cold only)</span>}
            <input
              type="date"
              value={warmupStart}
              onChange={(e) => setWarmupStart(e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400 col-span-2">
            Notes
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className={`${inputCls} resize-y`}
            />
          </label>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-200 hover:border-gray-400"
          >
            Cancel
          </button>
          <button
            onClick={() =>
              onSave({
                domain,
                provider,
                purpose,
                owner,
                mailbox_count: mailboxCount,
                warmup_started_at: warmupStart || null,
                notes,
              })
            }
            disabled={!canSave}
            className="px-4 py-2 rounded-lg bg-mint-green text-midnight-blue text-sm font-semibold hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : editing ? "Save changes" : "Add domain"}
          </button>
        </div>
      </div>
    </div>
  );
}
