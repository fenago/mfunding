import { useEffect, useMemo, useState } from "react";
import {
  MegaphoneIcon,
  PlusIcon,
  TrashIcon,
  PencilSquareIcon,
  ExclamationTriangleIcon,
  ArrowLeftIcon,
  SparklesIcon,
  CheckCircleIcon,
  ClockIcon,
  ChevronRightIcon,
  ChevronLeftIcon,
  XMarkIcon,
  TableCellsIcon,
  ShoppingCartIcon,
} from "@heroicons/react/24/outline";
import { useUserProfile } from "@/context/UserProfileContext";
import CampaignMonteCarlo from "@/components/admin/CampaignMonteCarlo";
import CampaignAudit from "@/components/admin/CampaignAudit";
import {
  listCampaigns,
  saveCampaign,
  deleteCampaign,
  getCampaignMetrics,
  channelRollups,
  checklistForChannel,
  channelReminder,
  checklistProgress,
  updateChecklist,
  listAnalyses,
  analyzeCampaign,
  CHANNEL_META,
  STATUSES,
  type Campaign,
  type CampaignStatus,
  type CampaignMetrics,
  type ChecklistItem,
  type CampaignAnalysis,
  type CampaignAnalysisResult,
} from "../../services/campaignService";
import {
  SYNERGY_PRODUCTS,
  SYNERGY_MIN_QUALIFICATIONS,
  getProduct,
  matchTier,
  computePlan,
  suggestCampaignName,
  type SynergyProduct,
  type PricingSnapshot,
} from "@/data/synergyCatalog";

// ── Formatters ───────────────────────────────────────────────────────────────
const money = (n: number | null | undefined) => (n == null ? "—" : `$${Math.round(n).toLocaleString()}`);
const pct = (n: number | null | undefined) => (n == null ? "—" : `${n.toFixed(n < 10 ? 1 : 0)}%`);
const mult = (n: number | null | undefined) => (n == null ? "—" : `${n.toFixed(1)}×`);
const hrs = (n: number | null | undefined) =>
  n == null ? "—" : n < 1 ? `${Math.round(n * 60)} min` : `${n.toFixed(1)} hr`;

// ── Benchmarks (from CLAUDE.md funnel targets) ───────────────────────────────
type Verdict = "good" | "bad" | "neutral";
const benchTone = (v: Verdict) =>
  v === "good"
    ? "text-emerald-600 dark:text-emerald-400"
    : v === "bad"
      ? "text-red-600 dark:text-red-400"
      : "text-gray-700 dark:text-gray-200";

function judge(kind: "realconvo" | "close" | "cpf" | "roas", value: number | null): Verdict {
  if (value == null) return "neutral";
  switch (kind) {
    // REAL-conversation rate (≥2min outbound call) — a call-truth tier, NOT the old
    // contacted_at "contact" flag. Genuine two-way conversations run far lower than a
    // stage-move contact rate, so 10% is not a failure the way 10% "contact" was: only
    // flag red below 5%, green above 18%, neutral between.
    case "realconvo": return value >= 18 ? "good" : value < 5 ? "bad" : "neutral";
    case "close": return value >= 8 ? "good" : "bad";
    case "cpf": return value < 1500 ? "good" : "bad";
    case "roas": return value >= 1 ? "good" : "bad";
  }
}

const FUNNEL: { key: keyof CampaignMetrics | "leads"; label: string }[] = [
  { key: "leads", label: "Leads in" },
  { key: "connected", label: "Connected (incl. vm)" },
  { key: "qualified", label: "Qualified" },
  { key: "appSent", label: "Application" },
  { key: "docs", label: "Docs collected" },
  { key: "submitted", label: "Submitted" },
  { key: "offer", label: "Offer" },
  { key: "funded", label: "Funded" },
];

export default function CampaignsPage() {
  const [rows, setRows] = useState<Campaign[]>([]);
  const [metrics, setMetrics] = useState<Record<string, CampaignMetrics>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [rateCardOpen, setRateCardOpen] = useState(false);
  const [view, setView] = useState<"overview" | "audit">("overview");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const cs = await listCampaigns();
      setRows(cs);
      setMetrics(await getCampaignMetrics(cs));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load campaigns");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  const rollups = useMemo(() => channelRollups(rows, metrics), [rows, metrics]);
  const totals = useMemo(() => {
    let spent = 0, funded = 0, leads = 0, commission = 0;
    for (const c of rows) {
      const m = metrics[c.id];
      if (!m) continue;
      spent += m.spent;
      funded += m.funded;
      leads += m.leads;
      commission += m.estCommission;
    }
    return {
      spent, funded, leads, commission,
      cpf: funded ? spent / funded : null,
      roas: spent ? commission / spent : null,
    };
  }, [rows, metrics]);

  const selected = selectedId ? rows.find((c) => c.id === selectedId) ?? null : null;

  if (selected) {
    return (
      <>
        <CampaignDetail
          campaign={selected}
          metrics={metrics[selected.id]}
          onBack={() => setSelectedId(null)}
          onEdit={() => setEditing(selected)}
          onChanged={load}
        />
        {editing && (
          <CampaignEditModal
            campaign={editing}
            onClose={() => setEditing(null)}
            onSaved={() => { setEditing(null); load(); }}
          />
        )}
      </>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <MegaphoneIcon className="w-6 h-6 text-ocean-blue" /> Campaigns
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            One card per lead campaign. Track spend → funnel → funded, with per-channel benchmarks and an AI read on each.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setRateCardOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            <TableCellsIcon className="w-4 h-4" /> Synergy rate card
          </button>
          <button onClick={() => setWizardOpen(true)} className="btn-primary inline-flex items-center gap-2">
            <PlusIcon className="w-4 h-4" /> New campaign
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          <ExclamationTriangleIcon className="w-5 h-5 shrink-0" /> {error}
        </div>
      )}

      {/* Tabs — spend/ROI overview vs the lead-quality audit */}
      <div className="flex items-center gap-1 border-b border-gray-200 dark:border-gray-700">
        {([["overview", "Overview"], ["audit", "Audit"]] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setView(key)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
              view === key
                ? "border-ocean-blue text-ocean-blue"
                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {view === "audit" ? (
        <CampaignAudit campaigns={rows} />
      ) : (
      <>
      {/* Roll-up — the numbers that decide if the whole program is worth it */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Total spend" value={money(totals.spent)} />
        <Stat label="Funded deals" value={`${totals.funded}`} sub={`${totals.leads} attributed leads`} />
        <Stat label="⭐ Cost / funded" value={money(totals.cpf)} sub="Target < $1,500" highlight={totals.cpf != null && totals.cpf < 1500} />
        <Stat label="⭐ ROAS" value={mult(totals.roas)} sub={totals.roas == null ? "revenue ÷ spend" : totals.roas >= 1 ? "profitable" : "underwater"} highlight={totals.roas != null && totals.roas >= 1} />
        <Stat label="Est. commission" value={money(totals.commission)} sub="@ 8 pts of funded" />
      </div>

      {/* Campaign cards */}
      {loading ? (
        <p className="text-sm text-gray-400">Loading campaigns…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500">
          No campaigns yet. Click "New campaign" to add one.
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((c) => (
            <CampaignCard key={c.id} campaign={c} metrics={metrics[c.id]} onOpen={() => setSelectedId(c.id)} />
          ))}
        </div>
      )}

      {/* Per-channel head-to-head */}
      {rollups.length > 0 && <ChannelRollupTable rollups={rollups} />}
      </>
      )}

      {wizardOpen && (
        <CampaignWizardModal
          onClose={() => setWizardOpen(false)}
          onSaved={() => { setWizardOpen(false); load(); }}
        />
      )}

      {editing && (
        <CampaignEditModal
          campaign={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}

      {rateCardOpen && <RateCardDrawer onClose={() => setRateCardOpen(false)} />}
    </div>
  );
}

// ── Campaign card ────────────────────────────────────────────────────────────
function CampaignCard({ campaign: c, metrics: m, onOpen }: { campaign: Campaign; metrics?: CampaignMetrics; onOpen: () => void }) {
  const meta = CHANNEL_META[c.channel] ?? CHANNEL_META.other;
  const prog = checklistProgress(c);
  const spent = m?.spent ?? Number(c.spent ?? 0) ?? 0; // ACTUAL only — never c.budget (IMPORTANT_TODO #3)
  return (
    <button
      onClick={onOpen}
      className="text-left rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 hover:border-ocean-blue hover:shadow-md transition-all"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${meta.chip}`}>{meta.label}</span>
            <StatusBadge status={c.status} />
          </div>
          <h3 className="font-semibold text-gray-900 dark:text-white mt-2 truncate">{c.name}</h3>
          <p className="text-xs text-gray-400 font-mono mt-0.5">{c.code ?? "—"} · {c.partner}</p>
        </div>
      </div>

      {!prog.complete && (
        <div className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-300">
          <ExclamationTriangleIcon className="w-3.5 h-3.5" /> Setup incomplete · {prog.done}/{prog.total} done — open to finish ›
        </div>
      )}

      <div className="grid grid-cols-4 gap-2 mt-4 text-center">
        <MiniStat label="Spend" value={money(spent)} />
        <MiniStat label="Leads" value={`${m?.leads ?? 0}`} />
        <MiniStat label="Funded" value={`${m?.funded ?? 0}`} />
        <MiniStat label="ROAS" value={mult(m?.roas)} tone={judge("roas", m?.roas ?? null)} />
      </div>
    </button>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: Verdict }) {
  return (
    <div>
      <div className={`text-sm font-semibold ${tone ? benchTone(tone) : "text-gray-900 dark:text-white"}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-gray-400 mt-0.5">{label}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: CampaignStatus }) {
  const tone: Record<CampaignStatus, string> = {
    draft: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
    active: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    paused: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    completed: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  };
  return <span className={`text-[10px] font-medium px-2 py-0.5 rounded capitalize ${tone[status] ?? tone.draft}`}>{status}</span>;
}

// ── Per-channel rollup ───────────────────────────────────────────────────────
function ChannelRollupTable({ rollups }: { rollups: ReturnType<typeof channelRollups> }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
        <h2 className="font-semibold text-gray-900 dark:text-white">Channels head-to-head</h2>
        <p className="text-xs text-gray-400">Same KPIs, aggregated across every campaign in each channel.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 uppercase text-xs">
            <tr>
              <th className="px-4 py-3 font-medium">Channel</th>
              <th className="px-4 py-3 font-medium">Spend</th>
              <th className="px-4 py-3 font-medium">Leads</th>
              <th
                className="px-4 py-3 font-medium"
                title="Real conversation = an outbound call ≥2 min (from call logs, not the contacted_at stage flag). Connected (≥30s, incl. voicemail pickups) shown beneath."
              >
                Real convo %
              </th>
              <th className="px-4 py-3 font-medium">Funded</th>
              <th className="px-4 py-3 font-medium">Close</th>
              <th className="px-4 py-3 font-medium">Cost / funded</th>
              <th className="px-4 py-3 font-medium">ROAS</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {rollups.map((r) => {
              const meta = CHANNEL_META[r.channel] ?? CHANNEL_META.other;
              const m = r.metrics;
              return (
                <tr key={r.channel} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${meta.chip}`}>{meta.label}</span>
                    <span className="text-xs text-gray-400 ml-2">{r.campaigns} campaign{r.campaigns === 1 ? "" : "s"}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-200">{money(m.spent)}</td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-200">{m.leads}</td>
                  <td className={`px-4 py-3 ${benchTone(judge("realconvo", m.realConversationsPct))}`}>
                    {pct(m.realConversationsPct)}
                    <span
                      className="block text-[11px] font-normal text-gray-400"
                      title="connected ≥30s incl. voicemail"
                    >
                      {pct(m.connectedPct)} conn
                    </span>
                  </td>
                  <td className="px-4 py-3 font-semibold text-gray-900 dark:text-white">{m.funded}</td>
                  <td className={`px-4 py-3 ${benchTone(judge("close", m.closePct))}`}>{pct(m.closePct)}</td>
                  <td className={`px-4 py-3 ${benchTone(judge("cpf", m.costPerFunded))}`}>{money(m.costPerFunded)}</td>
                  <td className={`px-4 py-3 ${benchTone(judge("roas", m.roas))}`}>{mult(m.roas)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Detail ───────────────────────────────────────────────────────────────────
function CampaignDetail({
  campaign: c, metrics: m, onBack, onEdit, onChanged,
}: {
  campaign: Campaign; metrics?: CampaignMetrics; onBack: () => void; onEdit: () => void; onChanged: () => void;
}) {
  const meta = CHANNEL_META[c.channel] ?? CHANNEL_META.other;
  async function remove() {
    if (!confirm("Delete this campaign? Deals stay but lose their campaign tag.")) return;
    await deleteCampaign(c.id);
    onBack();
    onChanged();
  }

  return (
    <div className="p-6 space-y-6">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-ocean-blue">
        <ArrowLeftIcon className="w-4 h-4" /> All campaigns
      </button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${meta.chip}`}>{meta.label}</span>
            <StatusBadge status={c.status} />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mt-2">{c.name}</h1>
          <p className="text-sm text-gray-400 font-mono mt-1">{c.code ?? "—"} · {c.partner}{c.market ? ` · ${c.market}` : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onEdit} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">
            <PencilSquareIcon className="w-4 h-4" /> Edit
          </button>
          <button onClick={remove} className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20">
            <TrashIcon className="w-4 h-4" /> Delete
          </button>
        </div>
      </div>

      <PurchaseSummary campaign={c} />

      {m && <KpiGrid m={m} />}
      <CampaignMonteCarlo campaign={c} metrics={m} />
      {m && <FunnelBars m={m} />}

      <TrackingSummary campaign={c} onEdit={onEdit} />

      <div className="grid gap-6 lg:grid-cols-2">
        <ChecklistCard campaign={c} onChanged={onChanged} />
        <AnalysisPanel campaign={c} />
      </div>

      {c.notes && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Notes</h3>
          <p className="text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap">{c.notes}</p>
        </div>
      )}
    </div>
  );
}

// Read-only view of the attribution identifiers, sitting beside the checklist so
// it's obvious whether the dedicated email/number has been recorded yet.
function TrackingSummary({ campaign: c, onEdit }: { campaign: Campaign; onEdit: () => void }) {
  const unset = <span className="text-gray-400 italic">not set</span>;
  const InfoDot = ({ hint }: { hint: string }) => (
    <span
      title={hint}
      aria-label={hint}
      className="cursor-help select-none inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-gray-300 dark:border-gray-500 text-[9px] font-semibold text-gray-400 hover:text-ocean-blue hover:border-ocean-blue"
    >
      i
    </span>
  );
  const missingBoth = !c.tracking_email && !c.tracking_phone;
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
          Attribution identifiers
          <InfoDot hint="These are how leads get COUNTED to this campaign automatically. Give each campaign its own inbound email and/or phone number; any lead that arrives on that identifier is credited to this campaign — no guessing, and you can run several campaigns on the same channel without mixing up their numbers." />
        </h3>
        <button onClick={onEdit} className="text-xs text-ocean-blue hover:underline">Edit</button>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div>
          <div className="text-[11px] text-gray-400 flex items-center gap-1.5">
            Tracking email
            <InfoDot hint="For emailed leads (real-time transfers): create a dedicated inbound address for this campaign (e.g. synergy-rt@send.mfunding.net), have the vendor deliver leads TO that address, and save it here. Every lead delivered to it auto-attributes to this campaign." />
          </div>
          <div className="text-sm font-mono text-gray-800 dark:text-gray-100 break-all">{c.tracking_email || unset}</div>
        </div>
        <div>
          <div className="text-[11px] text-gray-400 flex items-center gap-1.5">
            Tracking phone
            <InfoDot hint="For live-transfer calls: buy a dedicated GHL tracking number for this campaign (GHL → Settings → Phone Numbers), give it to the vendor as the transfer number, and save it here. Calls to that number identify this campaign." />
          </div>
          <div className="text-sm font-mono text-gray-800 dark:text-gray-100">{c.tracking_phone || unset}</div>
        </div>
      </div>
      {missingBoth ? (
        <div className="mt-2 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
          ⚠ <b>Action needed for precise tracking:</b> set at least one identifier. Emailed leads (real-time) → create the dedicated inbound address with your vendor and save it under Edit. Live-transfer calls → get a dedicated GHL number and save it here. Until then, leads are attributed by channel (fine while this is the ONLY active {c.channel?.replace("_", " ")} campaign — ambiguous the moment you run two).
        </div>
      ) : (
        <p className="text-[11px] text-gray-400 mt-2">Leads delivered to the tracking email auto-attribute to this campaign regardless of channel.</p>
      )}
    </div>
  );
}

function KpiGrid({ m }: { m: CampaignMetrics }) {
  return (
    <div className="space-y-4">
      <Section title="Volume & spend">
        <Stat label="Leads in" value={`${m.leads}`} sub={m.leadsPurchased ? `${m.leadsPurchased} bought` : undefined} />
        <Stat label="Spend" value={money(m.spent)} />
        <Stat label="CPL" value={money(m.costPerLead)} sub="per attributed lead" />
        <Stat label="Acquisition CPL" value={money(m.acquisitionCpl)} sub="per lead bought" />
        <Stat label="Cost / connect" value={money(m.costPerConnect)} sub="per ≥30s answer" />
        <Stat label="Speed to 1st dial" value={hrs(m.speedToFirstDialHours)} sub="median, first outbound call" />
      </Section>

      <Section title="Funnel conversion vs targets">
        <Stat label="Real convo rate" value={pct(m.realConversationsPct)} sub="≥2min talk (call-truth)" tone={judge("realconvo", m.realConversationsPct)} />
        <Stat label="Connected" value={pct(m.connectedPct)} sub="≥30s incl. voicemail" />
        <Stat label="Qualify rate" value={pct(m.qualifyPct)} sub="of connected" />
        <Stat label="Application rate" value={pct(m.applicationPct)} sub="of qualified" />
        <Stat label="Submission rate" value={pct(m.submissionPct)} sub="of applications" />
        <Stat label="Close rate" value={pct(m.closePct)} sub="target 8–12%" tone={judge("close", m.closePct)} />
      </Section>

      <Section title="Outcomes & ROI">
        <Stat label="Funded" value={`${m.funded}`} />
        <Stat label="Funded volume" value={money(m.fundedAmount)} />
        <Stat label="Avg deal size" value={money(m.avgDealSize)} />
        <Stat label="Revenue (commission)" value={money(m.estCommission)} sub="@ 8 pts" />
        <Stat label="⭐ Cost / funded" value={money(m.costPerFunded)} sub="target < $1,500" tone={judge("cpf", m.costPerFunded)} />
        <Stat label="⭐ ROAS" value={mult(m.roas)} sub="revenue ÷ spend" tone={judge("roas", m.roas)} />
        <Stat label="Pipeline in flight" value={money(m.pipelineValue)} sub="requested, not yet funded" />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">{title}</h3>
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">{children}</div>
    </div>
  );
}

function FunnelBars({ m }: { m: CampaignMetrics }) {
  const leads = m.leads || 1;
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">Funnel</h3>
      <div className="space-y-1.5 max-w-2xl">
        {FUNNEL.map((s) => {
          const count = s.key === "leads" ? m.leads : (m[s.key] as number);
          const w = Math.round((count / leads) * 100);
          return (
            <div key={s.key} className="flex items-center gap-3">
              <span className="w-32 shrink-0 text-xs text-gray-600 dark:text-gray-300 truncate">{s.label}</span>
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

// ── Checklist ────────────────────────────────────────────────────────────────
function ChecklistCard({ campaign: c, onChanged }: { campaign: Campaign; onChanged: () => void }) {
  const { profile } = useUserProfile();
  const [items, setItems] = useState<ChecklistItem[]>(c.setup_checklist ?? []);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setItems(c.setup_checklist ?? []); }, [c.id, c.setup_checklist]);

  const who = profile?.display_name || profile?.email || "staff";

  async function persist(next: ChecklistItem[]) {
    setItems(next);
    setSaving(true);
    try {
      await updateChecklist(c.id, next);
      onChanged();
    } finally {
      setSaving(false);
    }
  }
  function toggle(i: number) {
    const next = items.map((it, idx) =>
      idx === i
        ? { ...it, done: !it.done, done_at: !it.done ? new Date().toISOString() : null, done_by: !it.done ? who : null }
        : it,
    );
    persist(next);
  }
  function setField(i: number, field: "value" | "note", val: string) {
    setItems(items.map((it, idx) => (idx === i ? { ...it, [field]: val } : it)));
  }
  function blurSave() {
    persist(items);
  }

  const doneCount = items.filter((i) => i.done).length;

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900 dark:text-white">Setup checklist</h3>
        <span className="text-xs text-gray-400">{doneCount}/{items.length} done{saving ? " · saving…" : ""}</span>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-gray-400 mt-3">No checklist items for this campaign.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {items.map((it, i) => (
            <li key={it.key} className="flex gap-3">
              <button onClick={() => toggle(i)} className="mt-0.5 shrink-0" aria-label={it.done ? "Mark not done" : "Mark done"}>
                {it.done ? (
                  <CheckCircleIcon className="w-5 h-5 text-emerald-500" />
                ) : (
                  <span className="block w-5 h-5 rounded-full border-2 border-gray-300 dark:border-gray-600" />
                )}
              </button>
              <div className="min-w-0 flex-1">
                <p className={`text-sm ${it.done ? "text-gray-400 line-through" : "text-gray-700 dark:text-gray-200"}`}>{it.label}</p>
                {it.done && it.done_by && (
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    {it.done_by}{it.done_at ? ` · ${new Date(it.done_at).toLocaleDateString()}` : ""}
                  </p>
                )}
                {it.needs_value && (
                  <input
                    className="mt-1.5 w-full px-2 py-1 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-xs text-gray-900 dark:text-gray-100"
                    placeholder="Record it here (e.g. the phone number / email created)…"
                    value={it.value ?? ""}
                    onChange={(e) => setField(i, "value", e.target.value)}
                    onBlur={blurSave}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── AI analysis panel ────────────────────────────────────────────────────────
const VERDICT_META: Record<string, { label: string; chip: string }> = {
  scale: { label: "Scale", chip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  keep: { label: "Keep", chip: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  fix: { label: "Fix", chip: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  kill: { label: "Kill", chip: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
};

function AnalysisPanel({ campaign: c }: { campaign: Campaign }) {
  const [history, setHistory] = useState<CampaignAnalysis[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadHistory() {
    try { setHistory(await listAnalyses(c.id)); } catch { /* non-blocking */ }
  }
  useEffect(() => { loadHistory(); }, [c.id]);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      await analyzeCampaign(c.id);
      await loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setRunning(false);
    }
  }

  const latest = history[0];
  const older = history.slice(1);

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-1.5">
          <SparklesIcon className="w-5 h-5 text-ocean-blue" /> AI analysis
        </h3>
        <button onClick={run} disabled={running} className="btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-sm disabled:opacity-50">
          <SparklesIcon className="w-4 h-4" /> {running ? "Analyzing…" : latest ? "Re-analyze" : "Analyze campaign"}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {!latest && !running && !error && (
        <p className="mt-3 text-sm text-gray-400">
          No analysis yet. Run one to get a verdict (scale / keep / fix / kill), what's working, what's underperforming, and 3 concrete next actions.
        </p>
      )}

      {latest && <AnalysisView run={latest} />}

      {older.length > 0 && (
        <details className="mt-4">
          <summary className="text-xs text-gray-400 cursor-pointer">Previous analyses ({older.length})</summary>
          <div className="mt-2 space-y-3">
            {older.map((r) => <AnalysisView key={r.id} run={r} compact />)}
          </div>
        </details>
      )}
    </div>
  );
}

function AnalysisView({ run, compact }: { run: CampaignAnalysis; compact?: boolean }) {
  const a: CampaignAnalysisResult = run.analysis;
  const vm = VERDICT_META[a.verdict] ?? VERDICT_META.keep;
  return (
    <div className={compact ? "rounded-lg border border-gray-100 dark:border-gray-700 p-3" : "mt-3"}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded uppercase ${vm.chip}`}>{vm.label}</span>
        <span className="text-xs text-gray-400 inline-flex items-center gap-1">
          <ClockIcon className="w-3.5 h-3.5" /> {new Date(run.created_at).toLocaleString()}{run.model ? ` · ${run.model}` : ""}
        </span>
      </div>
      {a.headline && <p className="text-sm font-medium text-gray-900 dark:text-white mt-2">{a.headline}</p>}
      {!compact && (
        <>
          {a.whats_working.length > 0 && <ListBlock title="What's working" items={a.whats_working} tone="good" />}
          {a.underperforming.length > 0 && <ListBlock title="Underperforming vs targets" items={a.underperforming} tone="bad" />}
          {a.projected_cost_per_funded && (
            <p className="text-sm text-gray-600 dark:text-gray-300 mt-3">
              <span className="font-medium">Projected cost / funded at current pace:</span> {a.projected_cost_per_funded}
            </p>
          )}
          {a.recommendations.length > 0 && <ListBlock title="Recommendations" items={a.recommendations} tone="neutral" numbered />}
        </>
      )}
    </div>
  );
}

function ListBlock({ title, items, tone, numbered }: { title: string; items: string[]; tone: Verdict; numbered?: boolean }) {
  const dot = tone === "good" ? "text-emerald-500" : tone === "bad" ? "text-red-500" : "text-ocean-blue";
  return (
    <div className="mt-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{title}</h4>
      <ul className="mt-1.5 space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2 text-sm text-gray-700 dark:text-gray-200">
            <span className={`shrink-0 font-semibold ${dot}`}>{numbered ? `${i + 1}.` : "•"}</span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── "What was purchased" summary (from the pricing snapshot) ─────────────────
function PurchaseSummary({ campaign: c }: { campaign: Campaign }) {
  const snap = c.pricing_snapshot as unknown as PricingSnapshot | null;
  if (!snap || !snap.product_name) return null;
  const unit = snap.unit_price;
  const chips: Array<[string, string]> = [];
  if (snap.tier_label) chips.push(["Tier", snap.tier_label]);
  if (snap.age_band) chips.push(["Age", `${snap.age_band} days`]);
  if (snap.quantity != null) chips.push([snap.pricing_model === "hourly" ? "Total hours" : "Quantity", snap.quantity.toLocaleString()]);
  if (snap.hours_per_week != null && snap.weeks != null) chips.push(["Schedule", `${snap.hours_per_week} hrs/wk × ${snap.weeks} wk`]);
  if (unit != null) chips.push(["Unit price", unit < 1 ? `$${unit.toFixed(2)}` : money(unit)]);
  if (snap.bonus_pct) chips.push(["Bonus", `+${snap.bonus_pct}%${snap.bonus_leads ? ` (${snap.bonus_leads.toLocaleString()} leads)` : ""}`]);

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-1.5">
          <ShoppingCartIcon className="w-5 h-5 text-ocean-blue" /> What was purchased
        </h3>
        <span className="text-lg font-bold text-gray-900 dark:text-white">{money(snap.budget)}</span>
      </div>
      <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
        <span className="font-medium text-gray-900 dark:text-white">{snap.product_name}</span>
        {snap.math ? <> · {snap.math}</> : null}
      </p>
      {chips.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {chips.map(([k, v]) => (
            <span key={k} className="inline-flex items-center gap-1 rounded-md bg-gray-100 dark:bg-gray-700/60 px-2 py-1 text-[11px] text-gray-700 dark:text-gray-200">
              <span className="text-gray-400 uppercase tracking-wide">{k}</span>
              <span className="font-semibold">{v}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── New-campaign wizard (channel-first, Synergy catalog-driven) ──────────────
const todayISO = () => new Date().toISOString().slice(0, 10);

function CampaignWizardModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [partner, setPartner] = useState("Synergy Direct");
  const [productId, setProductId] = useState<string | null>(null);
  const [qty, setQty] = useState("");
  const [tierOverride, setTierOverride] = useState<string | null>(null);
  const [ageBand, setAgeBand] = useState("");
  const [hoursPerWeek, setHoursPerWeek] = useState("");
  const [weeks, setWeeks] = useState("");
  const [status, setStatus] = useState<CampaignStatus>("active");
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState("");
  const [notes, setNotes] = useState("");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const product = productId ? getProduct(productId) : undefined;

  const plan = useMemo<PricingSnapshot | null>(() => {
    if (!productId) return null;
    return computePlan({
      productId,
      quantity: qty === "" ? 0 : Number(qty),
      tierLabel: tierOverride ?? undefined,
      ageBandValue: ageBand || undefined,
      hoursPerWeek: hoursPerWeek === "" ? 0 : Number(hoursPerWeek),
      weeks: weeks === "" ? 0 : Number(weeks),
    });
  }, [productId, qty, tierOverride, ageBand, hoursPerWeek, weeks]);

  const suggestedName = productId ? suggestCampaignName(partner, productId, startDate) : "";
  const effectiveName = nameTouched && name.trim() ? name : suggestedName;

  function pickProduct(p: SynergyProduct) {
    setProductId(p.id);
    setTierOverride(null);
    setQty("");
    setAgeBand(p.ageBands?.[0]?.value ?? "");
    setHoursPerWeek(p.pricingModel === "hourly" ? "25" : "");
    setWeeks("");
    setStep(2);
  }

  async function create() {
    if (!product || !plan) return;
    setError(null);
    setSaving(true);
    try {
      await saveCampaign(null, {
        name: effectiveName.trim(),
        channel: product.channel,
        partner: partner.trim() || "Synergy Direct",
        status,
        budget: Math.round(plan.budget),
        spent: 0,
        cost_per_lead_contracted: plan.unit_price,
        leads_target: plan.pricing_model === "hourly" ? null : plan.quantity,
        leads_purchased: null,
        clicks: null,
        market: null,
        start_date: startDate || null,
        end_date: endDate || null,
        notes: notes.trim() || null,
        product_id: plan.product_id,
        pricing_snapshot: plan as unknown as Record<string, unknown>,
        setup_checklist: checklistForChannel(product.channel),
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create campaign");
    } finally {
      setSaving(false);
    }
  }

  const input = "mt-1 w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100";
  const budgetReady = !!plan && plan.budget > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-2xl bg-white dark:bg-gray-800 shadow-xl" onClick={(e) => e.stopPropagation()}>
        {/* Header + step rail */}
        <div className="flex items-center justify-between px-6 pt-5">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">New campaign</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><XMarkIcon className="w-5 h-5" /></button>
        </div>
        <div className="flex items-center gap-2 px-6 mt-3 text-xs">
          {(["Product", "Volume & price", "Launch"] as const).map((lbl, i) => {
            const s = (i + 1) as 1 | 2 | 3;
            const active = step === s;
            const done = step > s;
            return (
              <div key={lbl} className="flex items-center gap-2">
                <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full font-medium ${active ? "bg-ocean-blue text-white" : done ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400"}`}>
                  {done ? <CheckCircleIcon className="w-3.5 h-3.5" /> : <span>{s}</span>} {lbl}
                </span>
                {s < 3 && <ChevronRightIcon className="w-3.5 h-3.5 text-gray-300 dark:text-gray-600" />}
              </div>
            );
          })}
        </div>

        <div className="p-6">
          {/* STEP 1 — partner + product */}
          {step === 1 && (
            <div className="space-y-4">
              <label className="block text-sm text-gray-600 dark:text-gray-300">
                Partner
                <input className={input} value={partner} onChange={(e) => setPartner(e.target.value)} placeholder="Synergy Direct" />
              </label>
              <div>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-200">Pick a product</p>
                <p className="text-xs text-gray-400 mb-2">Pricing comes straight from the {partner.split(/\s+/)[0] || "Synergy"} catalog.</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {SYNERGY_PRODUCTS.map((p) => {
                    const meta = CHANNEL_META[p.channel] ?? CHANNEL_META.other;
                    const selected = productId === p.id;
                    return (
                      <button
                        key={p.id}
                        onClick={() => pickProduct(p)}
                        className={`text-left rounded-xl border p-3 transition-all hover:border-ocean-blue hover:shadow-sm ${selected ? "border-ocean-blue ring-1 ring-ocean-blue bg-ocean-blue/5" : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-sm text-gray-900 dark:text-white">{p.name}</span>
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${meta.chip}`}>{meta.short}</span>
                        </div>
                        <p className="text-[11px] font-semibold text-ocean-blue mt-0.5">{p.priceRange}</p>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 leading-snug">{p.blurb}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
              <MinQualsHint />
            </div>
          )}

          {/* STEP 2 — product-specific volume + price */}
          {step === 2 && product && (
            <div className="space-y-4">
              <ProductHead product={product} />
              <ProductInputs
                product={product}
                qty={qty} setQty={setQty}
                tierOverride={tierOverride} setTierOverride={setTierOverride}
                ageBand={ageBand} setAgeBand={setAgeBand}
                hoursPerWeek={hoursPerWeek} setHoursPerWeek={setHoursPerWeek}
                weeks={weeks} setWeeks={setWeeks}
                input={input}
              />
              {/* Live math */}
              <div className={`rounded-lg border p-3 ${budgetReady ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20" : "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40"}`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Planned budget</span>
                  <span className="text-xl font-bold text-gray-900 dark:text-white">{plan ? money(plan.budget) : "—"}</span>
                </div>
                {plan?.math && <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">{plan.math}</p>}
                {plan?.bonus_leads ? (
                  <p className="text-[11px] text-emerald-700 dark:text-emerald-300 mt-1 font-medium">
                    +{plan.bonus_pct}% bonus ≈ {plan.bonus_leads.toLocaleString()} extra leads
                  </p>
                ) : null}
              </div>
            </div>
          )}

          {/* STEP 3 — name, date, notes */}
          {step === 3 && product && (
            <div className="space-y-4">
              <div className="rounded-lg bg-ocean-blue/5 border border-ocean-blue/20 p-3">
                <p className="text-sm text-gray-700 dark:text-gray-200 flex items-start gap-2">
                  <ExclamationTriangleIcon className="w-4 h-4 mt-0.5 text-ocean-blue shrink-0" />
                  {channelReminder(product.channel)}
                </p>
              </div>
              <label className="block text-sm text-gray-600 dark:text-gray-300">
                Campaign name
                <input
                  className={input}
                  value={effectiveName}
                  onChange={(e) => { setNameTouched(true); setName(e.target.value); }}
                  placeholder={suggestedName}
                />
                {!nameTouched && <span className="text-[11px] text-gray-400">Auto-suggested — edit if you like.</span>}
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm text-gray-600 dark:text-gray-300">
                  Start date
                  <input type="date" className={input} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </label>
                <label className="text-sm text-gray-600 dark:text-gray-300">
                  Status
                  <select className={input} value={status} onChange={(e) => setStatus(e.target.value as CampaignStatus)}>
                    {STATUSES.map((s) => <option key={s} value={s} className="capitalize">{s}</option>)}
                  </select>
                </label>
                <label className="col-span-2 text-sm text-gray-600 dark:text-gray-300">
                  End date <span className="text-xs text-gray-400">(optional — leave blank for ongoing)</span>
                  <input type="date" className={input} value={endDate} min={startDate || undefined} onChange={(e) => setEndDate(e.target.value)} />
                </label>
              </div>
              <label className="block text-sm text-gray-600 dark:text-gray-300">
                Notes
                <textarea className={input} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything the team should know about this order…" />
              </label>
              {/* Order recap */}
              {plan && (
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-3 text-sm">
                  <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">{product.name}</span><span className="font-semibold text-gray-900 dark:text-white">{money(plan.budget)}</span></div>
                  {plan.math && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{plan.math}</p>}
                  <p className="text-[11px] text-gray-400 mt-1">Code auto-generates on save (e.g. SYN-{CHANNEL_META[product.channel]?.short}-{new Date(startDate || todayISO()).getFullYear()}-###). The channel checklist attaches automatically.</p>
                </div>
              )}
            </div>
          )}

          {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

          {/* Footer nav */}
          <div className="mt-6 flex items-center justify-between">
            <button
              onClick={() => (step === 1 ? onClose() : setStep((s) => (s - 1) as 1 | 2 | 3))}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              {step === 1 ? "Cancel" : <><ChevronLeftIcon className="w-4 h-4" /> Back</>}
            </button>
            {step < 3 ? (
              <button
                onClick={() => setStep((s) => (s + 1) as 1 | 2 | 3)}
                disabled={step === 1 ? !productId : !budgetReady}
                className="btn-primary inline-flex items-center gap-1.5 px-5 py-2 text-sm disabled:opacity-50"
              >
                Next <ChevronRightIcon className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={create}
                disabled={saving || !effectiveName.trim() || !budgetReady}
                className="btn-primary px-5 py-2 text-sm disabled:opacity-50"
              >
                {saving ? "Creating…" : "Create campaign"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProductHead({ product }: { product: SynergyProduct }) {
  const meta = CHANNEL_META[product.channel] ?? CHANNEL_META.other;
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="font-semibold text-gray-900 dark:text-white">{product.name}</span>
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${meta.chip}`}>{meta.label}</span>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Includes: {product.includes}</p>
    </div>
  );
}

function ProductInputs({
  product, qty, setQty, tierOverride, setTierOverride, ageBand, setAgeBand,
  hoursPerWeek, setHoursPerWeek, weeks, setWeeks, input,
}: {
  product: SynergyProduct;
  qty: string; setQty: (v: string) => void;
  tierOverride: string | null; setTierOverride: (v: string | null) => void;
  ageBand: string; setAgeBand: (v: string) => void;
  hoursPerWeek: string; setHoursPerWeek: (v: string) => void;
  weeks: string; setWeeks: (v: string) => void;
  input: string;
}) {
  if (product.pricingModel === "hourly") {
    return (
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm text-gray-600 dark:text-gray-300">
          Hours per week <span className="text-xs text-gray-400">(min {product.minHours})</span>
          <input type="number" min={product.minHours} className={input} value={hoursPerWeek} onChange={(e) => setHoursPerWeek(e.target.value)} placeholder={String(product.minHours)} />
        </label>
        <label className="text-sm text-gray-600 dark:text-gray-300">
          Weeks
          <input type="number" min={1} className={input} value={weeks} onChange={(e) => setWeeks(e.target.value)} placeholder="4" />
        </label>
        <p className="col-span-2 text-[11px] text-gray-400">Billed at ${product.hourlyRate}/hour, {product.minHours}-hour weekly minimum.</p>
      </div>
    );
  }

  if (product.pricingModel === "age_band") {
    return (
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm text-gray-600 dark:text-gray-300">
          Lead age
          <select className={input} value={ageBand} onChange={(e) => setAgeBand(e.target.value)}>
            {product.ageBands?.map((b) => (
              <option key={b.value} value={b.value}>{b.label} — ${b.unit}/{product.unitLabel}</option>
            ))}
          </select>
        </label>
        <label className="text-sm text-gray-600 dark:text-gray-300">
          {product.qtyLabel}
          <input type="number" min={1} className={input} value={qty} onChange={(e) => setQty(e.target.value)} placeholder="100" />
        </label>
        {product.bonusTiers && (
          <p className="col-span-2 text-[11px] text-gray-400">
            Spend more, get free leads: {product.bonusTiers.slice().reverse().map((b) => `$${b.minSpend.toLocaleString()} → +${b.pct}%`).join(" · ")}.
          </p>
        )}
      </div>
    );
  }

  // volume_tier — quantity drives the tier; tier is shown and overridable.
  const matched = matchTier(product, qty === "" ? 0 : Number(qty));
  return (
    <div className="grid grid-cols-2 gap-3">
      <label className="text-sm text-gray-600 dark:text-gray-300">
        {product.qtyLabel}
        <input type="number" min={1} className={input} value={qty} onChange={(e) => { setQty(e.target.value); setTierOverride(null); }} placeholder="100" />
      </label>
      <label className="text-sm text-gray-600 dark:text-gray-300">
        Price tier <span className="text-xs text-gray-400">(auto)</span>
        <select
          className={input}
          value={tierOverride ?? matched?.label ?? ""}
          onChange={(e) => setTierOverride(e.target.value || null)}
        >
          {!matched && <option value="">Enter a quantity…</option>}
          {product.tiers?.map((t) => (
            <option key={t.label} value={t.label}>
              {t.label} — ${t.unit < 1 ? t.unit.toFixed(2) : t.unit}/{product.unitLabel}
            </option>
          ))}
        </select>
      </label>
      <div className="col-span-2 flex flex-wrap gap-1.5">
        {product.tiers?.map((t) => {
          const active = (tierOverride ?? matched?.label) === t.label;
          return (
            <span key={t.label} className={`text-[10px] px-1.5 py-0.5 rounded ${active ? "bg-ocean-blue text-white" : "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400"}`}>
              {t.label}: ${t.unit < 1 ? t.unit.toFixed(2) : t.unit}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function MinQualsHint() {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">Minimum qualifications (most lead types)</p>
      <div className="flex flex-wrap gap-1.5">
        {SYNERGY_MIN_QUALIFICATIONS.map((q) => (
          <span key={q} className="inline-flex items-center gap-1 rounded-md bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-2 py-0.5 text-[11px] text-gray-600 dark:text-gray-300">
            <CheckCircleIcon className="w-3 h-3 text-emerald-500" /> {q}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Rate-card reference drawer (so the owner never digs for the email) ───────
function RateCardDrawer({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div className="w-full max-w-md h-full overflow-y-auto bg-white dark:bg-gray-800 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 px-5 py-4 flex items-center justify-between">
          <h2 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <TableCellsIcon className="w-5 h-5 text-ocean-blue" /> Synergy rate card
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><XMarkIcon className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          {SYNERGY_PRODUCTS.map((p) => {
            const meta = CHANNEL_META[p.channel] ?? CHANNEL_META.other;
            return (
              <div key={p.id} className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-sm text-gray-900 dark:text-white">{p.name}</span>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${meta.chip}`}>{meta.short}</span>
                </div>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{p.blurb}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {p.tiers?.map((t) => (
                    <span key={t.label} className="text-[11px] rounded bg-gray-100 dark:bg-gray-700/60 px-1.5 py-0.5 text-gray-700 dark:text-gray-200">
                      {t.label}: <b>${t.unit < 1 ? t.unit.toFixed(2) : t.unit}</b>
                    </span>
                  ))}
                  {p.ageBands?.map((b) => (
                    <span key={b.value} className="text-[11px] rounded bg-gray-100 dark:bg-gray-700/60 px-1.5 py-0.5 text-gray-700 dark:text-gray-200">
                      {b.label}: <b>${b.unit}</b>
                    </span>
                  ))}
                  {p.pricingModel === "hourly" && (
                    <span className="text-[11px] rounded bg-gray-100 dark:bg-gray-700/60 px-1.5 py-0.5 text-gray-700 dark:text-gray-200">
                      <b>${p.hourlyRate}/hr</b> · {p.minHours}-hr weekly min
                    </span>
                  )}
                </div>
                {p.bonusTiers && (
                  <p className="text-[11px] text-emerald-700 dark:text-emerald-300 mt-1.5">
                    Bonus: {p.bonusTiers.slice().reverse().map((b) => `$${b.minSpend.toLocaleString()} → +${b.pct}%`).join(" · ")}
                  </p>
                )}
              </div>
            );
          })}
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">Minimum qualifications</p>
            <ul className="space-y-1">
              {SYNERGY_MIN_QUALIFICATIONS.map((q) => (
                <li key={q} className="flex items-center gap-1.5 text-[12px] text-gray-600 dark:text-gray-300">
                  <CheckCircleIcon className="w-3.5 h-3.5 text-emerald-500 shrink-0" /> {q}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Edit modal (existing campaign — spend/status/dates, no CPC noise) ────────
function CampaignEditModal({ campaign, onClose, onSaved }: { campaign: Campaign; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: campaign.name,
    status: campaign.status,
    market: campaign.market ?? "",
    tracking_email: campaign.tracking_email ?? "",
    tracking_phone: campaign.tracking_phone ?? "",
    budget: String(campaign.budget ?? ""),
    spent: String(campaign.spent ?? ""),
    leads_purchased: campaign.leads_purchased != null ? String(campaign.leads_purchased) : "",
    start_date: campaign.start_date ?? "",
    end_date: campaign.end_date ?? "",
    notes: campaign.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const meta = CHANNEL_META[campaign.channel] ?? CHANNEL_META.other;

  async function save() {
    setError(null);
    setSaving(true);
    try {
      await saveCampaign(campaign.id, {
        name: form.name.trim(),
        status: form.status,
        market: form.market.trim() || null,
        tracking_email: form.tracking_email.trim().toLowerCase() || null,
        tracking_phone: form.tracking_phone.trim() || null,
        budget: Number(form.budget || 0),
        spent: Number(form.spent || 0),
        leads_purchased: form.leads_purchased === "" ? null : Number(form.leads_purchased),
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        notes: form.notes.trim() || null,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const input = "mt-1 w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-gray-800 p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Edit campaign</h2>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${meta.chip}`}>{meta.label}</span>
        </div>
        <p className="text-xs text-gray-400 mt-1">{campaign.code ?? "—"} · {campaign.partner} · channel fixed at creation</p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="col-span-2 text-sm text-gray-600 dark:text-gray-300">
            Name
            <input className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="text-sm text-gray-600 dark:text-gray-300">
            Status
            <select className={input} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as CampaignStatus })}>
              {STATUSES.map((s) => <option key={s} value={s} className="capitalize">{s}</option>)}
            </select>
          </label>
          <label className="text-sm text-gray-600 dark:text-gray-300">
            Market
            <input className={input} value={form.market} onChange={(e) => setForm({ ...form, market: e.target.value })} placeholder="Phoenix" />
          </label>
          <label className="text-sm text-gray-600 dark:text-gray-300">
            Planned budget ($)
            <input type="number" className={input} value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} />
          </label>
          <label className="text-sm text-gray-600 dark:text-gray-300">
            Actual spend ($)
            <input type="number" className={input} value={form.spent} onChange={(e) => setForm({ ...form, spent: e.target.value })} />
          </label>
          <label className="text-sm text-gray-600 dark:text-gray-300">
            Leads purchased <span className="text-xs text-gray-400">(true CPL)</span>
            <input type="number" className={input} value={form.leads_purchased} onChange={(e) => setForm({ ...form, leads_purchased: e.target.value })} />
          </label>
          <label className="text-sm text-gray-600 dark:text-gray-300">
            Start date
            <input type="date" className={input} value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
          </label>
          <label className="text-sm text-gray-600 dark:text-gray-300">
            End date
            <input type="date" className={input} value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
          </label>
          <label className="col-span-2 text-sm text-gray-600 dark:text-gray-300">
            Tracking email
            <input
              type="email"
              className={input}
              value={form.tracking_email}
              onChange={(e) => setForm({ ...form, tracking_email: e.target.value })}
              placeholder="leads-syn-rt@send.mfunding.net"
            />
            <span className="text-[11px] text-gray-400">Inbound leads delivered to this address auto-attribute to this campaign (any channel).</span>
          </label>
          <label className="col-span-2 text-sm text-gray-600 dark:text-gray-300">
            Tracking phone
            <input
              type="tel"
              className={input}
              value={form.tracking_phone}
              onChange={(e) => setForm({ ...form, tracking_phone: e.target.value })}
              placeholder="+1 (555) 000-0000"
            />
            <span className="text-[11px] text-gray-400">Dedicated GHL number for live transfers. Reserved for call attribution.</span>
          </label>
          <label className="col-span-2 text-sm text-gray-600 dark:text-gray-300">
            Notes
            <textarea className={input} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </label>
        </div>

        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">Cancel</button>
          <button onClick={save} disabled={!form.name.trim() || saving} className="btn-primary px-5 py-2 text-sm disabled:opacity-50">
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Shared stat card ─────────────────────────────────────────────────────────
function Stat({ label, value, sub, highlight, tone }: { label: string; value: string; sub?: string; highlight?: boolean; tone?: Verdict }) {
  const valueTone = tone && tone !== "neutral" ? benchTone(tone) : "text-gray-900 dark:text-white";
  return (
    <div className={`rounded-xl p-4 border ${highlight ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800" : "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700"}`}>
      <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
      <div className={`text-xl font-bold mt-1 ${valueTone}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}
