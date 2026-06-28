import { useEffect, useState } from "react";
import { MegaphoneIcon, PlusIcon, TrashIcon } from "@heroicons/react/24/outline";
import {
  listLeadSources, saveLeadSource, deleteLeadSource, costPerFunded, roiPct,
  LEAD_SOURCE_TYPES, type LeadSource, type LeadSourceType,
} from "../../services/leadSourceService";

const BLANK = {
  name: "", type: "live_transfer" as LeadSourceType, cost_per_lead: "", monthly_budget: "",
  total_leads: "", total_funded: "", total_spend: "", total_revenue: "", status: "active" as const,
};

export default function LeadSourcesPage() {
  const [rows, setRows] = useState<LeadSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<typeof BLANK>(BLANK);

  async function load() { setLoading(true); try { setRows(await listLeadSources()); } finally { setLoading(false); } }
  useEffect(() => { load(); }, []);

  function add() { setEditId(null); setForm(BLANK); setOpen(true); }
  function edit(s: LeadSource) {
    setEditId(s.id);
    setForm({
      name: s.name, type: s.type, cost_per_lead: s.cost_per_lead?.toString() ?? "",
      monthly_budget: s.monthly_budget?.toString() ?? "", total_leads: String(s.total_leads ?? ""),
      total_funded: String(s.total_funded ?? ""), total_spend: String(s.total_spend ?? ""),
      total_revenue: String(s.total_revenue ?? ""), status: s.status as "active",
    });
    setOpen(true);
  }
  async function save() {
    const n = (v: string) => (v === "" ? null : Number(v));
    await saveLeadSource(editId, {
      name: form.name, type: form.type, cost_per_lead: n(form.cost_per_lead), monthly_budget: n(form.monthly_budget),
      total_leads: Number(form.total_leads || 0), total_funded: Number(form.total_funded || 0),
      total_spend: Number(form.total_spend || 0), total_revenue: Number(form.total_revenue || 0), status: form.status,
    });
    setOpen(false); load();
  }
  async function remove(id: string) { await deleteLeadSource(id); load(); }

  const money = (n: number | null) => (n == null ? "—" : `$${Math.round(n).toLocaleString()}`);
  const input = "mt-1 w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100";

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <MegaphoneIcon className="w-6 h-6 text-ocean-blue" /> Lead Sources
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Cost per lead, spend, and ROI by source. Target: cost per funded deal under $1,500.</p>
        </div>
        <button onClick={add} className="btn-primary inline-flex items-center gap-2"><PlusIcon className="w-4 h-4" /> Add source</button>
      </div>

      {loading ? <p className="text-sm text-gray-400">Loading…</p> : (
        <div className="overflow-x-auto bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b border-gray-100 dark:border-gray-700">
                <th className="py-3 px-4">Source</th><th className="py-3 px-4">Type</th><th className="py-3 px-4">CPL</th>
                <th className="py-3 px-4">Leads</th><th className="py-3 px-4">Funded</th><th className="py-3 px-4">Cost/Funded</th>
                <th className="py-3 px-4">ROI</th><th className="py-3 px-4"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const cpf = costPerFunded(s); const roi = roiPct(s);
                return (
                  <tr key={s.id} className="border-b border-gray-50 dark:border-gray-800">
                    <td className="py-3 px-4 font-medium text-gray-900 dark:text-white">{s.name}</td>
                    <td className="py-3 px-4 text-gray-500">{LEAD_SOURCE_TYPES.find((t) => t.value === s.type)?.label ?? s.type}</td>
                    <td className="py-3 px-4">{money(s.cost_per_lead)}</td>
                    <td className="py-3 px-4">{s.total_leads}</td>
                    <td className="py-3 px-4">{s.total_funded}</td>
                    <td className={`py-3 px-4 font-medium ${cpf != null && cpf > 1500 ? "text-red-600" : cpf != null ? "text-emerald-600" : "text-gray-400"}`}>{money(cpf)}</td>
                    <td className={`py-3 px-4 ${roi != null && roi < 0 ? "text-red-600" : "text-gray-700 dark:text-gray-300"}`}>{roi == null ? "—" : `${Math.round(roi)}%`}</td>
                    <td className="py-3 px-4 text-right">
                      <button onClick={() => edit(s)} className="text-ocean-blue hover:underline mr-3">Edit</button>
                      <button onClick={() => remove(s.id)} className="text-gray-400 hover:text-red-500"><TrashIcon className="w-4 h-4 inline" /></button>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={8} className="py-8 text-center text-gray-400">No lead sources yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setOpen(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4">{editId ? "Edit" : "Add"} lead source</h3>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm col-span-2"><span className="text-gray-500">Name</span>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={input} /></label>
              <label className="text-sm"><span className="text-gray-500">Type</span>
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as LeadSourceType })} className={input}>
                  {LEAD_SOURCE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select></label>
              <label className="text-sm"><span className="text-gray-500">Status</span>
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as "active" })} className={input}>
                  <option value="active">active</option><option value="inactive">inactive</option><option value="archived">archived</option>
                </select></label>
              <label className="text-sm"><span className="text-gray-500">Cost per lead ($)</span>
                <input type="number" value={form.cost_per_lead} onChange={(e) => setForm({ ...form, cost_per_lead: e.target.value })} className={input} /></label>
              <label className="text-sm"><span className="text-gray-500">Monthly budget ($)</span>
                <input type="number" value={form.monthly_budget} onChange={(e) => setForm({ ...form, monthly_budget: e.target.value })} className={input} /></label>
              <label className="text-sm"><span className="text-gray-500">Total leads</span>
                <input type="number" value={form.total_leads} onChange={(e) => setForm({ ...form, total_leads: e.target.value })} className={input} /></label>
              <label className="text-sm"><span className="text-gray-500">Total funded</span>
                <input type="number" value={form.total_funded} onChange={(e) => setForm({ ...form, total_funded: e.target.value })} className={input} /></label>
              <label className="text-sm"><span className="text-gray-500">Total spend ($)</span>
                <input type="number" value={form.total_spend} onChange={(e) => setForm({ ...form, total_spend: e.target.value })} className={input} /></label>
              <label className="text-sm"><span className="text-gray-500">Total revenue ($)</span>
                <input type="number" value={form.total_revenue} onChange={(e) => setForm({ ...form, total_revenue: e.target.value })} className={input} /></label>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setOpen(false)} className="px-4 py-2 text-sm text-gray-500">Cancel</button>
              <button onClick={save} disabled={!form.name} className="btn-primary text-sm disabled:opacity-60">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
