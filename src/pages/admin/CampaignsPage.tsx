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
} from "@heroicons/react/24/outline";
import { useUserProfile } from "@/context/UserProfileContext";
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
  SELECTABLE_CHANNELS,
  STATUSES,
  type Campaign,
  type CampaignChannel,
  type CampaignStatus,
  type CampaignMetrics,
  type ChecklistItem,
  type CampaignAnalysis,
  type CampaignAnalysisResult,
} from "../../services/campaignService";

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

function judge(kind: "contact" | "close" | "cpf" | "roas", value: number | null): Verdict {
  if (value == null) return "neutral";
  switch (kind) {
    case "contact": return value >= 65 ? "good" : "bad";
    case "close": return value >= 8 ? "good" : "bad";
    case "cpf": return value < 1500 ? "good" : "bad";
    case "roas": return value >= 1 ? "good" : "bad";
  }
}

const FUNNEL: { key: keyof CampaignMetrics | "leads"; label: string }[] = [
  { key: "leads", label: "Leads in" },
  { key: "contacted", label: "Contacted" },
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
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Campaign | null>(null);

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
      <CampaignDetail
        campaign={selected}
        metrics={metrics[selected.id]}
        onBack={() => setSelectedId(null)}
        onEdit={() => { setEditing(selected); setFormOpen(true); }}
        onChanged={load}
      />
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
        <button onClick={() => { setEditing(null); setFormOpen(true); }} className="btn-primary inline-flex items-center gap-2">
          <PlusIcon className="w-4 h-4" /> New campaign
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          <ExclamationTriangleIcon className="w-5 h-5 shrink-0" /> {error}
        </div>
      )}

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

      {formOpen && (
        <CampaignFormModal
          campaign={editing}
          onClose={() => setFormOpen(false)}
          onSaved={() => { setFormOpen(false); load(); }}
        />
      )}
    </div>
  );
}

// ── Campaign card ────────────────────────────────────────────────────────────
function CampaignCard({ campaign: c, metrics: m, onOpen }: { campaign: Campaign; metrics?: CampaignMetrics; onOpen: () => void }) {
  const meta = CHANNEL_META[c.channel] ?? CHANNEL_META.other;
  const prog = checklistProgress(c);
  const spent = m?.spent ?? c.spent ?? c.budget ?? 0;
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
          <ExclamationTriangleIcon className="w-3.5 h-3.5" /> Setup incomplete · {prog.done}/{prog.total} done
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
              <th className="px-4 py-3 font-medium">Contact</th>
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
                  <td className={`px-4 py-3 ${benchTone(judge("contact", m.contactPct))}`}>{pct(m.contactPct)}</td>
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

      {m && <KpiGrid m={m} />}
      {m && <FunnelBars m={m} />}

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

function KpiGrid({ m }: { m: CampaignMetrics }) {
  return (
    <div className="space-y-4">
      <Section title="Volume & spend">
        <Stat label="Leads in" value={`${m.leads}`} sub={m.leadsPurchased ? `${m.leadsPurchased} bought` : undefined} />
        <Stat label="Spend" value={money(m.spent)} />
        <Stat label="CPL" value={money(m.costPerLead)} sub="per attributed lead" />
        <Stat label="Acquisition CPL" value={money(m.acquisitionCpl)} sub="per lead bought" />
        <Stat label="Cost / contact" value={money(m.costPerContact)} />
        <Stat label="Speed to 1st touch" value={hrs(m.speedToFirstTouchHours)} sub="target < 5 min transfers" />
      </Section>

      <Section title="Funnel conversion vs targets">
        <Stat label="Contact rate" value={pct(m.contactPct)} sub="target ≥ 65%" tone={judge("contact", m.contactPct)} />
        <Stat label="Qualify rate" value={pct(m.qualifyPct)} sub="of contacted" />
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

// ── Create / edit modal ──────────────────────────────────────────────────────
const BLANK = {
  name: "",
  channel: "realtime_transfer" as CampaignChannel,
  partner: "Synergy Direct",
  status: "active" as CampaignStatus,
  budget: "",
  spent: "",
  cost_per_lead_contracted: "",
  leads_target: "",
  leads_purchased: "",
  clicks: "",
  market: "",
  start_date: "",
  end_date: "",
  notes: "",
};

function CampaignFormModal({ campaign, onClose, onSaved }: { campaign: Campaign | null; onClose: () => void; onSaved: () => void }) {
  const editing = !!campaign;
  const [form, setForm] = useState(() =>
    campaign
      ? {
          name: campaign.name,
          channel: campaign.channel,
          partner: campaign.partner,
          status: campaign.status,
          budget: String(campaign.budget ?? ""),
          spent: String(campaign.spent ?? ""),
          cost_per_lead_contracted: campaign.cost_per_lead_contracted != null ? String(campaign.cost_per_lead_contracted) : "",
          leads_target: campaign.leads_target != null ? String(campaign.leads_target) : "",
          leads_purchased: campaign.leads_purchased != null ? String(campaign.leads_purchased) : "",
          clicks: campaign.clicks != null ? String(campaign.clicks) : "",
          market: campaign.market ?? "",
          start_date: campaign.start_date ?? "",
          end_date: campaign.end_date ?? "",
          notes: campaign.notes ?? "",
        }
      : BLANK,
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // On a NEW campaign, picking a channel drives the reminder + checklist preview.
  const previewChecklist = useMemo(() => (editing ? [] : checklistForChannel(form.channel)), [editing, form.channel]);

  async function save() {
    setError(null);
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        channel: form.channel,
        partner: form.partner.trim() || "Synergy Direct",
        status: form.status,
        budget: Number(form.budget || 0),
        spent: Number(form.spent || 0),
        cost_per_lead_contracted: form.cost_per_lead_contracted === "" ? null : Number(form.cost_per_lead_contracted),
        leads_target: form.leads_target === "" ? null : Number(form.leads_target),
        leads_purchased: form.leads_purchased === "" ? null : Number(form.leads_purchased),
        clicks: form.clicks === "" ? null : Number(form.clicks),
        market: form.market || null,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        notes: form.notes || null,
        // Attach the channel checklist only on create; editing keeps existing.
        ...(editing ? {} : { setup_checklist: checklistForChannel(form.channel) }),
      };
      await saveCampaign(campaign?.id ?? null, payload);
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
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-gray-800 p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">{editing ? "Edit campaign" : "New campaign"}</h2>
        {!editing && <p className="text-xs text-gray-400 mt-1">The code (e.g. SYN-RT-2026-001) is generated automatically from partner + channel + year.</p>}

        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="col-span-2 text-sm text-gray-600 dark:text-gray-300">
            Name
            <input className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Synergy — Real-Time Transfers (emailed leads)" />
          </label>
          <label className="text-sm text-gray-600 dark:text-gray-300">
            Partner
            <input className={input} value={form.partner} onChange={(e) => setForm({ ...form, partner: e.target.value })} placeholder="Synergy Direct" />
          </label>
          <label className="text-sm text-gray-600 dark:text-gray-300">
            Channel
            <select className={input} value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value as CampaignChannel })} disabled={editing}>
              {SELECTABLE_CHANNELS.map((ch) => (
                <option key={ch} value={ch}>{CHANNEL_META[ch].label}</option>
              ))}
              {/* Keep a legacy channel selectable when editing an old row. */}
              {editing && !SELECTABLE_CHANNELS.includes(form.channel) && (
                <option value={form.channel}>{CHANNEL_META[form.channel]?.label ?? form.channel}</option>
              )}
            </select>
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
            <input type="number" className={input} value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} placeholder="3000" />
          </label>
          <label className="text-sm text-gray-600 dark:text-gray-300">
            Actual spend ($)
            <input type="number" className={input} value={form.spent} onChange={(e) => setForm({ ...form, spent: e.target.value })} placeholder="0" />
          </label>
          <label className="text-sm text-gray-600 dark:text-gray-300">
            Contracted CPL ($) <span className="text-xs text-gray-400">vendor quote</span>
            <input type="number" className={input} value={form.cost_per_lead_contracted} onChange={(e) => setForm({ ...form, cost_per_lead_contracted: e.target.value })} placeholder="60" />
          </label>
          <label className="text-sm text-gray-600 dark:text-gray-300">
            Leads purchased <span className="text-xs text-gray-400">(true CPL)</span>
            <input type="number" className={input} value={form.leads_purchased} onChange={(e) => setForm({ ...form, leads_purchased: e.target.value })} placeholder="25" />
          </label>
          <label className="text-sm text-gray-600 dark:text-gray-300">
            Expected leads
            <input type="number" className={input} value={form.leads_target} onChange={(e) => setForm({ ...form, leads_target: e.target.value })} placeholder="40" />
          </label>
          <label className="text-sm text-gray-600 dark:text-gray-300">
            Clicks <span className="text-xs text-gray-400">(click channels → CPC)</span>
            <input type="number" className={input} value={form.clicks} onChange={(e) => setForm({ ...form, clicks: e.target.value })} placeholder="Google Ads only" />
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
            Notes
            <textarea className={input} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </label>
        </div>

        {/* Channel-driven reminder + checklist preview (new campaigns) */}
        {!editing && (
          <div className="mt-4 rounded-lg bg-ocean-blue/5 border border-ocean-blue/20 p-3">
            <p className="text-sm text-gray-700 dark:text-gray-200 flex items-start gap-2">
              <ExclamationTriangleIcon className="w-4 h-4 mt-0.5 text-ocean-blue shrink-0" />
              {channelReminder(form.channel)}
            </p>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mt-3 mb-1">
              Setup checklist that will be attached
            </p>
            <ul className="space-y-1">
              {previewChecklist.map((it) => (
                <li key={it.key} className="text-xs text-gray-600 dark:text-gray-300 flex gap-2">
                  <span className="text-ocean-blue">•</span> {it.label}
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">Cancel</button>
          <button onClick={save} disabled={!form.name.trim() || saving} className="btn-primary px-5 py-2 text-sm disabled:opacity-50">
            {saving ? "Saving…" : editing ? "Save changes" : "Create campaign"}
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
