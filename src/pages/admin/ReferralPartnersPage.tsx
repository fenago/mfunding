import { useEffect, useState } from "react";
import { UserPlusIcon, PlusIcon, TrashIcon } from "@heroicons/react/24/outline";
import {
  listReferralPartners, saveReferralPartner, deleteReferralPartner,
  PARTNER_TYPES, type ReferralPartner, type PartnerType,
} from "../../services/referralService";

const BLANK = {
  name: "", company: "", partner_type: "cpa" as PartnerType, email: "", phone: "",
  referral_count: "", funded_count: "", total_paid: "", reward_per_funded: "100", status: "active" as const, notes: "",
};

export default function ReferralPartnersPage() {
  const [rows, setRows] = useState<ReferralPartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<typeof BLANK>(BLANK);

  async function load() { setLoading(true); try { setRows(await listReferralPartners()); } finally { setLoading(false); } }
  useEffect(() => { load(); }, []);

  function add() { setEditId(null); setForm(BLANK); setOpen(true); }
  function edit(p: ReferralPartner) {
    setEditId(p.id);
    setForm({
      name: p.name, company: p.company ?? "", partner_type: p.partner_type, email: p.email ?? "", phone: p.phone ?? "",
      referral_count: String(p.referral_count ?? ""), funded_count: String(p.funded_count ?? ""),
      total_paid: String(p.total_paid ?? ""), reward_per_funded: String(p.reward_per_funded ?? "100"),
      status: p.status as "active", notes: p.notes ?? "",
    });
    setOpen(true);
  }
  async function save() {
    await saveReferralPartner(editId, {
      name: form.name, company: form.company || null, partner_type: form.partner_type,
      email: form.email || null, phone: form.phone || null,
      referral_count: Number(form.referral_count || 0), funded_count: Number(form.funded_count || 0),
      total_paid: Number(form.total_paid || 0), reward_per_funded: Number(form.reward_per_funded || 100),
      status: form.status, notes: form.notes || null,
    });
    setOpen(false); load();
  }
  async function remove(id: string) { await deleteReferralPartner(id); load(); }

  const totals = rows.reduce((a, p) => ({ ref: a.ref + p.referral_count, fund: a.fund + p.funded_count, paid: a.paid + Number(p.total_paid) }), { ref: 0, fund: 0, paid: 0 });
  const input = "mt-1 w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100";

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <UserPlusIcon className="w-6 h-6 text-ocean-blue" /> Referral Partners
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">CPAs, bookkeepers, RE agents, and vendors who send deals. Reward per funded referral.</p>
        </div>
        <button onClick={add} className="btn-primary inline-flex items-center gap-2"><PlusIcon className="w-4 h-4" /> Add partner</button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[["Referrals", totals.ref], ["Funded", totals.fund], ["Paid out", `$${Math.round(totals.paid).toLocaleString()}`]].map(([l, v]) => (
          <div key={l} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <div className="text-2xl font-bold text-gray-900 dark:text-white">{v}</div>
            <div className="text-xs text-gray-400">{l}</div>
          </div>
        ))}
      </div>

      {loading ? <p className="text-sm text-gray-400">Loading…</p> : (
        <div className="overflow-x-auto bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b border-gray-100 dark:border-gray-700">
                <th className="py-3 px-4">Partner</th><th className="py-3 px-4">Type</th><th className="py-3 px-4">Contact</th>
                <th className="py-3 px-4">Refs</th><th className="py-3 px-4">Funded</th><th className="py-3 px-4">Paid</th>
                <th className="py-3 px-4">Status</th><th className="py-3 px-4"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-b border-gray-50 dark:border-gray-800">
                  <td className="py-3 px-4">
                    <div className="font-medium text-gray-900 dark:text-white">{p.name}</div>
                    {p.company && <div className="text-xs text-gray-400">{p.company}</div>}
                  </td>
                  <td className="py-3 px-4 text-gray-500">{PARTNER_TYPES.find((t) => t.value === p.partner_type)?.label ?? p.partner_type}</td>
                  <td className="py-3 px-4 text-gray-500">{p.email || p.phone || "—"}</td>
                  <td className="py-3 px-4">{p.referral_count}</td>
                  <td className="py-3 px-4">{p.funded_count}</td>
                  <td className="py-3 px-4">${Math.round(Number(p.total_paid)).toLocaleString()}</td>
                  <td className="py-3 px-4">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${p.status === "active" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-gray-100 text-gray-500 dark:bg-gray-700"}`}>{p.status}</span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button onClick={() => edit(p)} className="text-ocean-blue hover:underline mr-3">Edit</button>
                    <button onClick={() => remove(p.id)} className="text-gray-400 hover:text-red-500"><TrashIcon className="w-4 h-4 inline" /></button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={8} className="py-8 text-center text-gray-400">No referral partners yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setOpen(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4">{editId ? "Edit" : "Add"} referral partner</h3>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm"><span className="text-gray-500">Name</span>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={input} /></label>
              <label className="text-sm"><span className="text-gray-500">Company</span>
                <input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} className={input} /></label>
              <label className="text-sm"><span className="text-gray-500">Type</span>
                <select value={form.partner_type} onChange={(e) => setForm({ ...form, partner_type: e.target.value as PartnerType })} className={input}>
                  {PARTNER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select></label>
              <label className="text-sm"><span className="text-gray-500">Status</span>
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as "active" })} className={input}>
                  <option value="active">active</option><option value="inactive">inactive</option>
                </select></label>
              <label className="text-sm"><span className="text-gray-500">Email</span>
                <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={input} /></label>
              <label className="text-sm"><span className="text-gray-500">Phone</span>
                <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={input} /></label>
              <label className="text-sm"><span className="text-gray-500">Referrals</span>
                <input type="number" value={form.referral_count} onChange={(e) => setForm({ ...form, referral_count: e.target.value })} className={input} /></label>
              <label className="text-sm"><span className="text-gray-500">Funded</span>
                <input type="number" value={form.funded_count} onChange={(e) => setForm({ ...form, funded_count: e.target.value })} className={input} /></label>
              <label className="text-sm"><span className="text-gray-500">Reward per funded ($)</span>
                <input type="number" value={form.reward_per_funded} onChange={(e) => setForm({ ...form, reward_per_funded: e.target.value })} className={input} /></label>
              <label className="text-sm"><span className="text-gray-500">Total paid ($)</span>
                <input type="number" value={form.total_paid} onChange={(e) => setForm({ ...form, total_paid: e.target.value })} className={input} /></label>
              <label className="text-sm col-span-2"><span className="text-gray-500">Notes</span>
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={`${input} h-16`} /></label>
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
