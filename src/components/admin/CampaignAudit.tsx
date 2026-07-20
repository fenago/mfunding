import { useEffect, useMemo, useState } from "react";
import {
  ArrowPathIcon,
  ExclamationTriangleIcon,
  ShieldExclamationIcon,
  InformationCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
} from "@heroicons/react/24/outline";
import { CHANNEL_META, type Campaign } from "@/services/campaignService";
import { getCampaignAudit, AUDIT_FUNNEL, OPEN_TRACKING_SINCE, type AuditMetrics } from "@/services/campaignAuditService";
import { dateTimeET } from "@/utils/time";

// ── Formatters ───────────────────────────────────────────────────────────────
const money = (n: number | null | undefined) => (n == null ? "—" : `$${Math.round(n).toLocaleString()}`);
const pct = (n: number | null | undefined) => (n == null ? "—" : `${n.toFixed(n < 10 ? 1 : 0)}%`);
const int = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n)}`);
const mins = (n: number | null | undefined) =>
  n == null ? "—" : n < 60 ? `${Math.round(n)} min` : `${(n / 60).toFixed(1)} hr`;

// Green = healthy, red = concerning, amber = watch. Higher is better unless noted.
type Tone = "good" | "bad" | "warn" | "neutral";
const toneCls = (t: Tone) =>
  t === "good" ? "text-emerald-600 dark:text-emerald-400"
  : t === "bad" ? "text-red-600 dark:text-red-400"
  : t === "warn" ? "text-amber-600 dark:text-amber-400"
  : "text-gray-700 dark:text-gray-200";

const convoTone = (v: number | null): Tone => (v == null ? "neutral" : v >= 20 ? "good" : v >= 8 ? "warn" : "bad");
const dialTone = (v: number | null): Tone => (v == null ? "neutral" : v >= 85 ? "good" : v >= 60 ? "warn" : "bad");
const badEmailTone = (v: number | null): Tone => (v == null ? "neutral" : v <= 5 ? "good" : v <= 15 ? "warn" : "bad");
const realRevTone = (v: number | null): Tone => (v == null ? "neutral" : v >= 80 ? "good" : v >= 60 ? "warn" : "bad");
const bogusTone = (v: number | null): Tone => (v == null ? "neutral" : v === 0 ? "good" : v <= 5 ? "warn" : "bad");

const GRADE_CHIP: Record<string, string> = {
  A: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  B: "bg-lime-100 text-lime-700 dark:bg-lime-900/40 dark:text-lime-300",
  C: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  D: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  F: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  "—": "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
};

export default function CampaignAudit({ campaigns }: { campaigns: Campaign[] }) {
  const [audit, setAudit] = useState<Record<string, AuditMetrics>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setAudit(await getCampaignAudit(campaigns));
      setLoadedAt(new Date().toISOString());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load audit");
    } finally {
      setLoading(false);
    }
  }
  // Reload whenever the campaign set changes (and on mount).
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [campaigns]);

  // Worst-first: the owner is hunting for junk, so the lowest grades float up. No
  // score (no data yet) sinks to the bottom.
  const ranked = useMemo(() => {
    return [...campaigns]
      .map((c) => ({ c, m: audit[c.id] }))
      .filter((x) => x.m)
      .sort((a, b) => {
        const sa = a.m!.quality.score, sb = b.m!.quality.score;
        if (sa == null && sb == null) return b.m!.leads - a.m!.leads;
        if (sa == null) return 1;
        if (sb == null) return -1;
        return sa - sb;
      });
  }, [campaigns, audit]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <ShieldExclamationIcon className="w-5 h-5 text-ocean-blue" /> Lead-quality audit
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Live read of who these leads actually are — real conversations (from the call log, not stage flags),
            deliverable email, bank-verified revenue, and bogus "never asked for this" leads. Sorted worst-grade first.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {loadedAt && <span className="text-[11px] text-gray-400">as of {dateTimeET(loadedAt)} ET</span>}
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            <ArrowPathIcon className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </div>

      {/* What we can and can't see — honest about opens + portal sign-ins. */}
      <div className="flex items-start gap-2 rounded-lg bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 px-4 py-3 text-[12px] text-sky-800 dark:text-sky-200">
        <InformationCircleIcon className="w-4 h-4 shrink-0 mt-0.5" />
        <span>
          <b>Email opens are real</b> — a background poll reads each email record's open status from GoHighLevel and
          persists it per lead, covering opens back to the campaign start ({OPEN_TRACKING_SINCE}). "Emails opened" below
          is that data. Note it's pixel-based (GHL/Mailgun open tracking), so it's an upper bound — inflated by
          image-prefetch and by anyone cc'd on the send. <b>Portal sign-ins</b> are not shown — that lives in the auth
          system (service-role only). Everything else on this page is a live read of real data.
        </span>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          <ExclamationTriangleIcon className="w-5 h-5 shrink-0" /> {error}
        </div>
      )}

      {loading && ranked.length === 0 ? (
        <p className="text-sm text-gray-400">Auditing campaigns…</p>
      ) : ranked.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500">
          No attributed leads yet — nothing to audit. Once leads carry a campaign, their quality shows up here.
        </p>
      ) : (
        <>
          <ComparisonTable ranked={ranked} />
          <div className="space-y-4">
            {ranked.map(({ c, m }) => <CampaignAuditCard key={c.id} campaign={c} m={m!} />)}
          </div>
        </>
      )}
    </div>
  );
}

// ── Head-to-head comparison table — the vendor scoreboard ────────────────────
function ComparisonTable({ ranked }: { ranked: { c: Campaign; m?: AuditMetrics }[] }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
        <h3 className="font-semibold text-gray-900 dark:text-white">Vendor scoreboard</h3>
        <p className="text-xs text-gray-400">One row per campaign. Grade = real-conversation rate, email health, real revenue, and bogus rate.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 uppercase text-xs">
            <tr>
              <th className="px-4 py-3 font-medium">Campaign</th>
              <th className="px-4 py-3 font-medium">Grade</th>
              <th className="px-4 py-3 font-medium">Leads</th>
              <th className="px-4 py-3 font-medium">Dialed</th>
              <th className="px-4 py-3 font-medium">Real convo</th>
              <th className="px-4 py-3 font-medium">Median 1st dial</th>
              <th className="px-4 py-3 font-medium">Bad email</th>
              <th className="px-4 py-3 font-medium">Revenue real</th>
              <th className="px-4 py-3 font-medium">Bogus</th>
              <th className="px-4 py-3 font-medium">Funded</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {ranked.map(({ c, m }) => {
              if (!m) return null;
              const meta = CHANNEL_META[c.channel] ?? CHANNEL_META.other;
              return (
                <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${meta.chip}`}>{meta.short}</span>
                      <div className="min-w-0">
                        <div className="font-medium text-gray-900 dark:text-white truncate max-w-[220px]">{c.name}</div>
                        <div className="text-[11px] text-gray-400 font-mono">{c.code ?? "—"} · {c.partner}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3"><GradeBadge m={m} /></td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-200">{m.leads}</td>
                  <td className={`px-4 py-3 ${toneCls(dialTone(m.dialedPct))}`}>{pct(m.dialedPct)}</td>
                  <td className={`px-4 py-3 font-semibold ${toneCls(convoTone(m.realConversationsPct))}`}>
                    {m.realConversations} <span className="font-normal text-gray-400">({pct(m.realConversationsPct)})</span>
                  </td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-200">{mins(m.medianMinutesToFirstDial)}</td>
                  <td className={`px-4 py-3 ${toneCls(badEmailTone(m.badEmailPct))}`}>{pct(m.badEmailPct)}</td>
                  <td className={`px-4 py-3 ${toneCls(realRevTone(m.avgRevenueQualityPct))}`}>{pct(m.avgRevenueQualityPct)}</td>
                  <td className={`px-4 py-3 font-semibold ${toneCls(bogusTone(m.bogusPct))}`}>
                    {m.bogusNeverRequested > 0 ? `${m.bogusNeverRequested} (${pct(m.bogusPct)})` : "0"}
                  </td>
                  <td className="px-4 py-3 font-semibold text-gray-900 dark:text-white">{m.funded}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GradeBadge({ m }: { m: AuditMetrics }) {
  const g = m.quality.grade;
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`text-xs font-bold px-2 py-0.5 rounded ${GRADE_CHIP[g] ?? GRADE_CHIP["—"]}`}>{g}</span>
      {m.quality.provisional && <span className="text-[10px] text-gray-400" title="Thin sample or no bank data yet">prov.</span>}
    </span>
  );
}

// ── Per-campaign deep card ───────────────────────────────────────────────────
function CampaignAuditCard({ campaign: c, m }: { campaign: Campaign; m: AuditMetrics }) {
  const [open, setOpen] = useState(false);
  const meta = CHANNEL_META[c.channel] ?? CHANNEL_META.other;

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700/40"
      >
        {open ? <ChevronDownIcon className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronRightIcon className="w-4 h-4 text-gray-400 shrink-0" />}
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${meta.chip}`}>{meta.short}</span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-gray-900 dark:text-white truncate">{c.name}</div>
          <div className="text-[11px] text-gray-400 font-mono">{c.code ?? "—"} · {c.partner} · {m.leads} leads</div>
        </div>
        <GradeBadge m={m} />
      </button>

      {open && (
        <div className="border-t border-gray-100 dark:border-gray-700 p-4 space-y-5">
          <QualityBreakdown m={m} />

          {/* Contactability — from ghl_call_log ONLY, three honest tiers */}
          <MetricRow title="Contactability (from call log — not stage flags)">
            <Cell label="Dialed" value={pct(m.dialedPct)} sub={`${m.dialed}/${m.leads} ≥1 outbound call`} tone={dialTone(m.dialedPct)} />
            <Cell label="Connected (incl. voicemail)" value={pct(m.connectedPct)} sub={`${m.connected} answered ≥30s`} tone={m.connectedPct != null && m.connectedPct >= 40 ? "good" : "warn"} />
            <Cell label="Real conversation ≥120s" value={pct(m.realConversationsPct)} sub={`${m.realConversations} genuine talks`} tone={convoTone(m.realConversationsPct)} />
            <Cell label="Median to 1st dial" value={mins(m.medianMinutesToFirstDial)} sub="target < 5 min" />
            <Cell label="Never reached @ 7+ dials" value={int(m.neverReached7Plus)} sub={pct(m.neverReached7PlusPct)} tone={m.neverReached7Plus > 0 ? "warn" : "good"} />
            <Cell label="Calls 1–2 / 3–6 / 7+" value={`${m.callBuckets.light} / ${m.callBuckets.medium} / ${m.callBuckets.heavy}`} />
          </MetricRow>

          {/* Email health */}
          <MetricRow title="Email health">
            <Cell label="Bad email" value={pct(m.badEmailPct)} sub={`${m.badEmail} invalid/bounced`} tone={badEmailTone(m.badEmailPct)} />
            <Cell label="No email" value={pct(m.noEmailPct)} sub={`${m.noEmail} missing`} tone={m.noEmailPct != null && m.noEmailPct > 20 ? "warn" : "neutral"} />
            <Cell label="Unverified" value={int(m.unverifiedEmail)} sub="unknown/catch-all" />
            <Cell label="Has email" value={int(m.withEmail)} sub={`of ${m.leads}`} />
          </MetricRow>

          {/* Application — two distinct gates */}
          <MetricRow title="Application">
            <Cell label="App SENT" value={int(m.appSent)} sub="our outbound (application_sent_at)" />
            <Cell label="App RETURNED" value={int(m.appReturned)} sub="signed app / e-sign on file" tone={m.appReturned > 0 ? "good" : "neutral"} />
          </MetricRow>

          {/* Engagement / matriculation */}
          <MetricRow title="Engagement">
            <Cell label="Emails opened" value={int(m.emailOpens)} sub={`${pct(m.emailOpensPct)} of emailed · since ${OPEN_TRACKING_SINCE}`} tone={m.emailOpens > 0 ? "good" : "neutral"} />
            <Cell label="Merchant replies" value={int(m.merchantReplies)} sub={pct(m.merchantRepliesPct)} tone={m.merchantReplies > 0 ? "good" : "neutral"} />
            <Cell label="Docs received" value={int(m.docsReceived)} sub={pct(m.docsReceivedPct)} tone={m.docsReceived > 0 ? "good" : "neutral"} />
            <Cell label="E-sign completions" value={m.esignCompletions > 0 ? int(m.esignCompletions) : "—"} sub="signed docs on file" tone={m.esignCompletions > 0 ? "good" : "neutral"} />
          </MetricRow>

          {/* Truth gap */}
          <MetricRow title="Truth gap — bank-verified vs stated">
            <Cell label="Revenue is real" value={pct(m.avgRevenueQualityPct)} sub="true ÷ reported" tone={realRevTone(m.avgRevenueQualityPct)} />
            <Cell label="Avg true revenue" value={money(m.avgTrueRevenue)} sub="bank-verified /mo" />
            <Cell label="Avg reported" value={money(m.avgReportedRevenue)} sub="what they claimed /mo" />
            <Cell label="Unaffordable" value={pct(m.unaffordablePct)} sub={`${m.unaffordable}/${m.underwrittenDeals} analyzed`} tone={m.unaffordablePct != null && m.unaffordablePct > 50 ? "bad" : "neutral"} />
            <Cell label="High risk" value={pct(m.highRiskPct)} sub={`${m.highRisk} of ${m.underwrittenDeals}`} tone={m.highRiskPct != null && m.highRiskPct > 50 ? "bad" : "neutral"} />
          </MetricRow>

          <FunnelBars m={m} />
          <WhereTheyDie m={m} />
        </div>
      )}
    </div>
  );
}

// The composite grade, opened up so it's never a black box.
function QualityBreakdown({ m }: { m: AuditMetrics }) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Quality grade — how it's built</h4>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          composite {m.quality.score == null ? "—" : `${Math.round(m.quality.score)}/100`}
          {m.quality.provisional && " · provisional"}
        </span>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {m.quality.inputs.map((i) => (
          <div key={i.label} className="rounded-md bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-2.5 py-1.5">
            <div className="text-[11px] text-gray-500 dark:text-gray-400">{i.label} <span className="text-gray-400">· w{Math.round(i.weight * 100)}%</span></div>
            <div className="text-sm font-semibold text-gray-900 dark:text-white">{i.value == null ? "no data" : `${Math.round(i.value)}`}</div>
          </div>
        ))}
      </div>
      {m.quality.provisional && (
        <p className="text-[11px] text-gray-400 mt-2">Provisional — fewer than 5 leads or no bank analysis yet to anchor the revenue-truth score.</p>
      )}
    </div>
  );
}

function FunnelBars({ m }: { m: AuditMetrics }) {
  const leads = m.leads || 1;
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">Funnel — leads → dialed → connected → real conversation → …</h4>
      <div className="space-y-1.5 max-w-2xl">
        {AUDIT_FUNNEL.map((s) => {
          const count = s.key === "leads" ? m.leads : (m[s.key] as number);
          const w = Math.round((count / leads) * 100);
          return (
            <div key={s.key} className="flex items-center gap-3">
              <span className="w-40 shrink-0 text-xs text-gray-600 dark:text-gray-300 truncate">{s.label}</span>
              <span className="flex-1 h-5 rounded bg-gray-200 dark:bg-gray-900 overflow-hidden relative">
                <span className="absolute inset-y-0 left-0 bg-ocean-blue/70 rounded" style={{ width: `${Math.max(w, count > 0 ? 4 : 0)}%` }} />
              </span>
              <span className="w-20 shrink-0 text-right text-xs text-gray-600 dark:text-gray-300">
                {count} <span className="text-gray-400">({w}%)</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WhereTheyDie({ m }: { m: AuditMetrics }) {
  const terminal = Object.entries(m.terminalCounts).sort((a, b) => b[1] - a[1]);
  const reasons = Object.entries(m.closeReasons).sort((a, b) => b[1] - a[1]);
  const lost = Object.entries(m.lostReasons).sort((a, b) => b[1] - a[1]);
  if (terminal.length === 0 && reasons.length === 0 && lost.length === 0) {
    return <p className="text-[12px] text-gray-400">No closed/parked leads yet — nothing has died in this campaign.</p>;
  }
  const label = (s: string) => s.replace(/_/g, " ");
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">Where leads die</h4>
      <div className="grid gap-3 sm:grid-cols-3">
        <ReasonList title="Terminal status" items={terminal} render={label} />
        <ReasonList title="Close reason (closer-picked)" items={reasons} render={label} highlight="bogus_never_requested" />
        <ReasonList title="Lost reason (system)" items={lost} render={label} />
      </div>
    </div>
  );
}

function ReasonList({
  title, items, render, highlight,
}: {
  title: string; items: [string, number][]; render: (s: string) => string; highlight?: string;
}) {
  return (
    <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-2.5">
      <div className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1.5">{title}</div>
      {items.length === 0 ? (
        <p className="text-[11px] text-gray-400">—</p>
      ) : (
        <ul className="space-y-1">
          {items.map(([k, v]) => {
            const hot = k === highlight;
            return (
              <li key={k} className={`flex items-center justify-between text-[12px] ${hot ? "text-red-600 dark:text-red-400 font-semibold" : "text-gray-700 dark:text-gray-200"}`}>
                <span className="truncate">{hot && "⚠ "}{render(k)}</span>
                <span className="ml-2 tabular-nums">{v}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function MetricRow({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">{title}</h4>
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">{children}</div>
    </div>
  );
}

function Cell({ label, value, sub, tone = "neutral" }: { label: string; value: string; sub?: string; tone?: Tone }) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2.5 py-2">
      <div className="text-[11px] text-gray-500 dark:text-gray-400 leading-tight">{label}</div>
      <div className={`text-base font-bold mt-0.5 ${toneCls(tone)}`}>{value}</div>
      {sub && <div className="text-[10px] text-gray-400 mt-0.5 leading-tight">{sub}</div>}
    </div>
  );
}
