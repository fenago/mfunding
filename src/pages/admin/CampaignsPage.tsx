import { useEffect, useMemo, useState, Fragment } from "react";
import {
  MegaphoneIcon,
  PlusIcon,
  TrashIcon,
  PencilSquareIcon,
  ChevronDownIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import {
  listCampaigns,
  saveCampaign,
  deleteCampaign,
  getCampaignMetrics,
  CHANNEL_LABELS,
  type Campaign,
  type CampaignChannel,
  type CampaignStatus,
  type CampaignMetrics,
} from "../../services/campaignService";
import { MCA_PIPELINE } from "../../data/pipelines";

const money = (n: number | null | undefined) => (n == null ? "—" : `$${Math.round(n).toLocaleString()}`);
const pct = (n: number | null | undefined) => (n == null ? "—" : `${n.toFixed(1)}%`);

const CHANNELS = Object.keys(CHANNEL_LABELS) as CampaignChannel[];
const STATUSES: CampaignStatus[] = ["active", "paused", "completed"];

const BLANK = {
  name: "",
  channel: "live_transfer" as CampaignChannel,
  status: "active" as CampaignStatus,
  budget: "",
  spent: "",
  leads_target: "",
  leads_purchased: "",
  clicks: "",
  market: "",
  start_date: "",
  end_date: "",
  notes: "",
};

export default function CampaignsPage() {
  const [rows, setRows] = useState<Campaign[]>([]);
  const [metrics, setMetrics] = useState<Record<string, CampaignMetrics>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<typeof BLANK>(BLANK);
  const [expanded, setExpanded] = useState<string | null>(null);

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

  const totals = useMemo(() => {
    let spent = 0,
      funded = 0,
      leads = 0,
      commission = 0;
    for (const c of rows) {
      spent += c.spent || c.budget || 0;
      const m = metrics[c.id];
      if (m) {
        funded += m.funded;
        leads += m.leads;
        commission += m.estCommission;
      }
    }
    return {
      spent, funded, leads, commission,
      cpf: funded ? spent / funded : null,
      roas: spent ? commission / spent : null,
      roi: spent ? ((commission - spent) / spent) * 100 : null,
    };
  }, [rows, metrics]);

  function add() {
    setEditId(null);
    setForm(BLANK);
    setOpen(true);
  }
  function edit(c: Campaign) {
    setEditId(c.id);
    setForm({
      name: c.name,
      channel: c.channel,
      status: c.status,
      budget: String(c.budget ?? ""),
      spent: String(c.spent ?? ""),
      leads_target: c.leads_target != null ? String(c.leads_target) : "",
      leads_purchased: c.leads_purchased != null ? String(c.leads_purchased) : "",
      clicks: c.clicks != null ? String(c.clicks) : "",
      market: c.market ?? "",
      start_date: c.start_date ?? "",
      end_date: c.end_date ?? "",
      notes: c.notes ?? "",
    });
    setOpen(true);
  }
  async function save() {
    setError(null);
    try {
      await saveCampaign(editId, {
        name: form.name.trim(),
        channel: form.channel,
        status: form.status,
        budget: Number(form.budget || 0),
        spent: Number(form.spent || 0),
        leads_target: form.leads_target === "" ? null : Number(form.leads_target),
        leads_purchased: form.leads_purchased === "" ? null : Number(form.leads_purchased),
        clicks: form.clicks === "" ? null : Number(form.clicks),
        market: form.market || null,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        notes: form.notes || null,
      });
      setOpen(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    }
  }
  async function remove(id: string) {
    if (!confirm("Delete this campaign? Deals stay but lose their campaign tag.")) return;
    await deleteCampaign(id);
    load();
  }

  const input = "mt-1 w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100";
  const funnelStages = MCA_PIPELINE.stages.filter((s) => !["nurture"].includes(s.key));

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <MegaphoneIcon className="w-6 h-6 text-ocean-blue" /> Campaigns
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Budget in, deals out. Track each campaign's spend → leads → funded %, cost per funded deal, and ROI through the pipeline.
          </p>
        </div>
        <button onClick={add} className="btn-primary inline-flex items-center gap-2">
          <PlusIcon className="w-4 h-4" /> New campaign
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          <ExclamationTriangleIcon className="w-5 h-5 shrink-0" /> {error}
        </div>
      )}

      {/* Roll-up — the numbers that decide if a channel is worth it */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Total spend" value={money(totals.spent)} />
        <Stat label="Funded deals" value={`${totals.funded}`} sub={`${totals.leads} attributed leads`} />
        <Stat label="⭐ Cost / funded" value={money(totals.cpf)} sub="Target < $1,500" highlight={totals.cpf != null && totals.cpf < 1500} />
        <Stat label="⭐ ROAS" value={totals.roas == null ? "—" : `${totals.roas.toFixed(1)}×`} sub={totals.roas == null ? "revenue ÷ spend" : totals.roas >= 1 ? "profitable" : "underwater"} highlight={totals.roas != null && totals.roas >= 1} />
        <Stat label="Est. commission · ROI" value={money(totals.commission)} sub={totals.roi == null ? undefined : `${totals.roi >= 0 ? "+" : ""}${totals.roi.toFixed(0)}% ROI`} />
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
        {loading ? (
          <p className="p-6 text-sm text-gray-400">Loading campaigns…</p>
        ) : rows.length === 0 ? (
          <p className="p-6 text-sm text-gray-500">No campaigns yet. Click "New campaign" to add one (e.g. "$3,000 Live Leads — June").</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 uppercase text-xs">
                <tr>
                  <th className="px-4 py-3 font-medium">Campaign</th>
                  <th className="px-4 py-3 font-medium">Spend</th>
                  <th className="px-4 py-3 font-medium">Leads</th>
                  <th className="px-4 py-3 font-medium">CPL <span className="normal-case text-[10px] text-gray-400">bought</span></th>
                  <th className="px-4 py-3 font-medium">Funded</th>
                  <th className="px-4 py-3 font-medium">Conv.</th>
                  <th className="px-4 py-3 font-medium">⭐ Cost / funded</th>
                  <th className="px-4 py-3 font-medium">⭐ ROAS</th>
                  <th className="px-4 py-3 font-medium">ROI</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {rows.map((c) => {
                  const m = metrics[c.id];
                  const isOpen = expanded === c.id;
                  return (
                    <Fragment key={c.id}>
                      <tr className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                        <td className="px-4 py-3">
                          <button onClick={() => setExpanded(isOpen ? null : c.id)} className="flex items-center gap-2 text-left">
                            <ChevronDownIcon className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                            <span>
                              <span className="font-medium text-gray-900 dark:text-white block">{c.name}</span>
                              <span className="text-xs text-gray-400">
                                {CHANNEL_LABELS[c.channel]}
                                {c.market ? ` · ${c.market}` : ""} · {c.status}
                              </span>
                            </span>
                          </button>
                        </td>
                        <td className="px-4 py-3 text-gray-700 dark:text-gray-200">
                          {money(c.spent || c.budget)}
                          {c.budget ? <span className="text-xs text-gray-400"> / {money(c.budget)}</span> : null}
                        </td>
                        <td className="px-4 py-3 text-gray-700 dark:text-gray-200">{m?.leads ?? 0}</td>
                        <td className="px-4 py-3 text-gray-700 dark:text-gray-200">
                          {m?.acquisitionCpl == null ? "—" : money(m.acquisitionCpl)}
                          {c.leads_purchased ? <span className="text-xs text-gray-400 block">{c.leads_purchased} bought</span> : null}
                        </td>
                        <td className="px-4 py-3 font-semibold text-gray-900 dark:text-white">{m?.funded ?? 0}</td>
                        <td className="px-4 py-3 text-gray-700 dark:text-gray-200">{pct(m?.conversionPct)}</td>
                        <td className={`px-4 py-3 font-medium ${m?.costPerFunded != null && m.costPerFunded < 1500 ? "text-emerald-600 dark:text-emerald-400" : "text-gray-700 dark:text-gray-200"}`}>{money(m?.costPerFunded)}</td>
                        <td className="px-4 py-3 font-medium">
                          {m?.roas == null ? "—" : (
                            <span className={m.roas >= 1 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>{m.roas.toFixed(1)}×</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {m?.roiPct == null ? (
                            "—"
                          ) : (
                            <span className={m.roiPct >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
                              {m.roiPct >= 0 ? "+" : ""}
                              {m.roiPct.toFixed(0)}%
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-3">
                            <button onClick={() => edit(c)} className="text-ocean-blue hover:underline inline-flex items-center gap-1">
                              <PencilSquareIcon className="w-4 h-4" /> Edit
                            </button>
                            <button onClick={() => remove(c.id)} className="text-red-500 hover:text-red-600">
                              <TrashIcon className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isOpen && m && (
                        <tr>
                          <td colSpan={10} className="px-4 pb-4 bg-gray-50 dark:bg-gray-900/40">
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mt-2 mb-2">
                              Where this campaign's leads are
                            </p>
                            <div className="space-y-1.5 max-w-2xl">
                              {funnelStages.map((s) => {
                                const count = m.byStatus[s.key] ?? 0;
                                const w = m.leads ? Math.round((count / m.leads) * 100) : 0;
                                return (
                                  <div key={s.key} className="flex items-center gap-3">
                                    <span className="w-32 shrink-0 text-xs text-gray-600 dark:text-gray-300 truncate">{s.label}</span>
                                    <span className="flex-1 h-5 rounded bg-gray-200 dark:bg-gray-800 overflow-hidden relative">
                                      <span className="absolute inset-y-0 left-0 bg-ocean-blue/70 rounded" style={{ width: `${Math.max(w, count > 0 ? 6 : 0)}%` }} />
                                    </span>
                                    <span className="w-16 shrink-0 text-right text-xs text-gray-600 dark:text-gray-300">
                                      {count} <span className="text-gray-400">({w}%)</span>
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                            <p className="text-xs text-gray-400 mt-3">
                              {m.funded} of {m.leads} leads funded · {money(m.fundedAmount)} funded · est. {money(m.estCommission)} commission @ 8 pts ·
                              cost per lead {money(m.costPerLead)}
                            </p>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400">
        Leads are deals tagged to a campaign. Tag a deal on the deal page (Lead Source → Campaign), or set the campaign when creating it. Commission is estimated at 8 points of funded amount.
      </p>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-gray-800 p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">{editId ? "Edit campaign" : "New campaign"}</h2>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="col-span-2 text-sm text-gray-600 dark:text-gray-300">
                Name
                <input className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="$3,000 Live Leads — June" />
              </label>
              <label className="text-sm text-gray-600 dark:text-gray-300">
                Channel
                <select className={input} value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value as CampaignChannel })}>
                  {CHANNELS.map((c) => (
                    <option key={c} value={c}>
                      {CHANNEL_LABELS[c]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-gray-600 dark:text-gray-300">
                Status
                <select className={input} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as CampaignStatus })}>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-gray-600 dark:text-gray-300">
                Budget ($)
                <input type="number" className={input} value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} placeholder="3000" />
              </label>
              <label className="text-sm text-gray-600 dark:text-gray-300">
                Spent so far ($)
                <input type="number" className={input} value={form.spent} onChange={(e) => setForm({ ...form, spent: e.target.value })} placeholder="3000" />
              </label>
              <label className="text-sm text-gray-600 dark:text-gray-300">
                Expected leads
                <input type="number" className={input} value={form.leads_target} onChange={(e) => setForm({ ...form, leads_target: e.target.value })} placeholder="40" />
              </label>
              <label className="text-sm text-gray-600 dark:text-gray-300">
                Leads purchased <span className="text-xs text-gray-400">(what you actually bought → true CPL)</span>
                <input type="number" className={input} value={form.leads_purchased} onChange={(e) => setForm({ ...form, leads_purchased: e.target.value })} placeholder="25" />
              </label>
              <label className="text-sm text-gray-600 dark:text-gray-300">
                Clicks <span className="text-xs text-gray-400">(paid/click channels → CPC)</span>
                <input type="number" className={input} value={form.clicks} onChange={(e) => setForm({ ...form, clicks: e.target.value })} placeholder="Google Ads only" />
              </label>
              <label className="text-sm text-gray-600 dark:text-gray-300">
                Market
                <input className={input} value={form.market} onChange={(e) => setForm({ ...form, market: e.target.value })} placeholder="Phoenix" />
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
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => setOpen(false)} className="px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">
                Cancel
              </button>
              <button onClick={save} disabled={!form.name.trim()} className="btn-primary px-5 py-2 text-sm disabled:opacity-50">
                {editId ? "Save changes" : "Create campaign"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl p-4 border ${highlight ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800" : "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700"}`}>
      <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
      <div className="text-2xl font-bold mt-1 text-gray-900 dark:text-white">{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}
