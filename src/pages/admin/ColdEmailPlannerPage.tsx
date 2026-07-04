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
} from "@heroicons/react/24/outline";
import supabase from "@/supabase";
import { mustWrite } from "@/supabase/writes";

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

  // Safe cold sending capacity RIGHT NOW = sum over cold domains that are at
  // least 21 days seasoned of (mailbox_count × perMailbox/day). Ties Section 2
  // back to the per-mailbox rate from Section 1.
  const safeCapacityNow = useMemo(() => {
    return domains.reduce((sum, d) => {
      if (d.purpose !== "cold" || !d.warmup_started_at) return sum;
      const s = computeSeasoning(d.warmup_started_at);
      if (s.days < MIN_WARMUP_DAYS) return sum;
      return sum + d.mailbox_count * safePerMailbox;
    }, 0);
  }, [domains, safePerMailbox]);

  const seasonedColdDomains = useMemo(
    () =>
      domains.filter(
        (d) =>
          d.purpose === "cold" &&
          d.warmup_started_at &&
          computeSeasoning(d.warmup_started_at).days >= MIN_WARMUP_DAYS,
      ).length,
    [domains],
  );

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
            ~{fmtInt(safeCapacityNow)} <span className="text-sm font-semibold">emails/day</span>
          </p>
          <p className="text-[11px] text-gray-400">
            from {seasonedColdDomains} seasoned cold domain{seasonedColdDomains === 1 ? "" : "s"} (≥21d)
          </p>
        </div>
      </div>

      {loadError && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 text-sm text-red-700 dark:text-red-300 mb-4">
          Failed to load domains: {loadError}
        </div>
      )}

      {loading ? (
        <p className="text-gray-500 dark:text-gray-400 text-sm">Loading domains…</p>
      ) : domains.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400 text-sm">No domains yet. Add your first cold domain.</p>
      ) : (
        <div className="space-y-3 mb-8">
          {domains.map((d) => (
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
