import { useCallback, useEffect, useMemo, useState } from "react";
import { XMarkIcon, BoltIcon, PhoneIcon, PaperAirplaneIcon } from "@heroicons/react/24/outline";
import supabase from "@/supabase";
import { getDealById } from "@/services/dealService";
import { mustWrite } from "@/supabase/writes";
import { normalizePhoneForStorage } from "@/lib/phone";
import { REQUIRED_APPLICATION_FIELDS, SECTION_LABEL, type AppSection } from "@/lib/applicationCompleteness";
import { PLAYBOOKS } from "@/data/playbooks";

/**
 * QuickAppModal — the fastest path to a complete application for a processor on a
 * live transfer. It shows the live-transfer opening script and ONLY the mandatory
 * fields, with three time-savers baked in:
 *   • the business address auto-fills the home address (editable after),
 *   • the business phone auto-fills the owner cell (editable after),
 *   • account #, routing #, and DOB get safe placeholder defaults (XXXX / 1980-10-01)
 *     so completeness clears and the merchant/processor fixes them later.
 * Saving writes mca_applications, mirrors the shared fields to the deal/customer,
 * and syncs to VibeReach (same fields_only path as the full modal).
 */

// Placeholder defaults — deliberate "get it moving" values the owner approved. They
// print as-is until someone updates them; never a blocker on a fast first pass.
const DEFAULTS: Record<string, string> = {
  bank_account_number: "XXXX",
  bank_routing_number: "XXXX",
  owner_dob: "1980-10-01",
};

const NUMERIC = new Set(["amount_requested", "monthly_revenue", "owner_ownership_pct"]);
const DATE = new Set(["owner_dob", "business_start_date"]);

// Entity type is a dropdown (same options as the full application).
const ENTITY_OPTS = ["LLC", "S-Corp", "C-Corp", "Sole Proprietor", "Partnership", "LLP", "Other"];
// Field-label overrides for the Quick App.
const LABEL_OVERRIDE: Record<string, string> = { ein: "EIN / Tax ID" };

type Form = Record<string, string>;

const s = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

/** The live-transfer opening script, pulled from the shared playbook so it never
 *  drifts from the Revenue Playbook. */
function ltScript(): { title: string; say: string }[] {
  const lt = PLAYBOOKS.find((p) => p.id === "live-transfer");
  return (lt?.steps ?? [])
    .filter((st) => st.say)
    .map((st) => ({ title: st.title, say: st.say as string }));
}

export default function QuickAppModal({
  dealId,
  onClose,
  onSaved,
}: {
  dealId: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [form, setForm] = useState<Form>({});
  const [existingId, setExistingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showScript, setShowScript] = useState(false);

  const script = useMemo(ltScript, []);

  // Live completeness — recomputed as the processor fills fields.
  const filledCount = useMemo(
    () => REQUIRED_APPLICATION_FIELDS.filter((f) => (form[f.key] ?? "").trim() !== "").length,
    [form],
  );
  const totalReq = REQUIRED_APPLICATION_FIELDS.length;
  const pct = Math.round((filledCount / totalReq) * 100);

  // Seed the form from the application (if any) → customer/deal fallbacks → defaults.
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        // Load via getDealById (own-deal for a setter, whole-board masked for a
        // processor) + a direct application read — works for BOTH roles, unlike the
        // processor-only detail RPC.
        const found = await getDealById(dealId);
        if (!found) throw new Error("Couldn't load that deal.");
        const { data: appRow } = await supabase
          .from("mca_applications").select("*").eq("deal_id", dealId).maybeSingle();
        if (!alive) return;
        const deal = (found.deal ?? {}) as unknown as Record<string, unknown>;
        const cust = (found.deal?.customer ?? {}) as unknown as Record<string, unknown>;
        const app = (appRow ?? {}) as Record<string, unknown>;
        setExistingId((app.id as string) ?? null);
        const seed: Form = {};
        for (const { key } of REQUIRED_APPLICATION_FIELDS) {
          let v = s(app[key]);
          if (!v) {
            // fall back to what we already know about the merchant
            if (key === "business_legal_name") v = s(cust.business_name);
            else if (key === "business_email") v = s(cust.email);
            else if (key === "business_phone") v = s(cust.phone);
            else if (key === "business_address") v = s(cust.address_street);
            else if (key === "business_city") v = s(cust.address_city);
            else if (key === "business_state") v = s(cust.address_state);
            else if (key === "business_zip") v = s(cust.address_zip);
            else if (key === "industry") v = s(cust.industry);
            else if (key === "owner_first_name") v = s(cust.first_name);
            else if (key === "owner_last_name") v = s(cust.last_name);
            else if (key === "owner_email") v = s(cust.email);
            else if (key === "owner_phone") v = s(cust.phone);
            else if (key === "amount_requested") v = s(deal.amount_requested);
            else if (key === "use_of_funds") v = s(deal.use_of_funds);
            else if (key === "monthly_revenue") v = s(cust.monthly_revenue);
          }
          seed[key] = v || DEFAULTS[key] || "";
        }
        setForm(seed);
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : "Couldn't load this deal.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [dealId]);

  // Field setter with the two auto-fills: business address → home address, and
  // business phone → owner cell (each only when the target is still empty, so an
  // edit the processor made by hand is never overwritten).
  const set = useCallback((key: string, value: string) => {
    setForm((f) => {
      const next: Form = { ...f, [key]: value };
      if (key === "business_address" && !f.owner_home_address?.trim()) next.owner_home_address = value;
      if (key === "business_city" && !f.owner_home_city?.trim()) next.owner_home_city = value;
      if (key === "business_state" && !f.owner_home_state?.trim()) next.owner_home_state = value;
      if (key === "business_zip" && !f.owner_home_zip?.trim()) next.owner_home_zip = value;
      if (key === "business_phone" && !f.owner_phone?.trim()) next.owner_phone = value;
      return next;
    });
  }, []);

  async function save(): Promise<boolean> {
    setBusy(true);
    setErr(null);
    try {
      // Build the mca_applications row from the required keys.
      const row: Record<string, unknown> = { deal_id: dealId };
      for (const { key } of REQUIRED_APPLICATION_FIELDS) {
        const raw = (form[key] ?? "").trim();
        if (key === "business_phone" || key === "owner_phone") {
          row[key] = raw ? normalizePhoneForStorage(raw) || raw : null;
        } else if (NUMERIC.has(key)) {
          row[key] = raw ? Number(raw.replace(/[^0-9.]/g, "")) : null;
        } else {
          row[key] = raw || null;
        }
      }
      if (existingId) {
        await mustWrite("save application", supabase.from("mca_applications").update(row).eq("id", existingId));
      } else {
        const rows = await mustWrite<{ id: string }>(
          "save application",
          supabase.from("mca_applications").insert(row),
        );
        setExistingId(rows?.[0]?.id ?? null);
      }
      // Mirror the shared numbers to the deal so the Playbook/board agree.
      const dealPatch: Record<string, unknown> = {};
      if (row.amount_requested != null) dealPatch.amount_requested = row.amount_requested;
      if (row.use_of_funds != null) dealPatch.use_of_funds = row.use_of_funds;
      if (Object.keys(dealPatch).length) {
        await mustWrite("save the ask on the deal", supabase.from("deals").update(dealPatch).eq("id", dealId));
      }
      // Sync to VibeReach (no document sent) — same path as the full modal.
      let vibe = "";
      try {
        const { data, error } = await supabase.functions.invoke("push-application-to-ghl", {
          body: { dealId, fields_only: true },
        });
        const r = (data ?? {}) as { synced?: boolean };
        if (error) vibe = " · VibeReach sync will retry";
        else vibe = r.synced ? " · synced to VibeReach" : " · not synced yet (add an email)";
      } catch { vibe = " · VibeReach sync will retry"; }
      onSaved?.();
      setToast(`Quick App saved${vibe}.`);
      setTimeout(() => setToast(null), 4500);
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save the Quick App.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveAndSend() {
    const ok = await save();
    if (!ok) return;
    setBusy(true);
    setErr(null);
    try {
      const { data, error } = await supabase.functions.invoke("push-application-to-ghl", { body: { dealId } });
      if (error) throw new Error(error.message);
      const r = (data ?? {}) as { error?: string };
      if (r.error) throw new Error(r.error);
      setToast("Sent to the merchant to e-sign.");
      setTimeout(() => { setToast(null); onClose(); }, 2500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Saved, but the send failed.");
    } finally {
      setBusy(false);
    }
  }

  const bySection = useMemo(() => {
    const g: Record<AppSection, typeof REQUIRED_APPLICATION_FIELDS> = { business: [], owner: [], banking: [], funding: [] };
    for (const f of REQUIRED_APPLICATION_FIELDS) g[f.section].push(f);
    return g;
  }, []);

  const inputBase =
    "mt-1 w-full px-2.5 py-1.5 rounded-lg border text-sm text-gray-900 dark:text-gray-100";
  // Field tint: light red = empty, amber = still the pre-filled placeholder default
  // (double-check before final submit), light green = a real value the processor entered.
  const tint = (key: string, v: string | undefined) => {
    const val = (v ?? "").trim();
    if (val === "") return "border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-900/15";
    if (DEFAULTS[key] && val === DEFAULTS[key])
      return "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20";
    return "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/20";
  };

  return (
    <div className="fixed inset-0 z-[60] flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-lg bg-white dark:bg-gray-900 h-full shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <BoltIcon className="w-5 h-5 text-amber-500" /> Quick App
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Mandatory fields only — address & phone auto-fill; account/routing/DOB pre-defaulted.
            </p>
            {/* Live progress as they fill. */}
            <div className="mt-2 flex items-center gap-2">
              <div className="h-1.5 w-40 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${pct >= 100 ? "bg-emerald-500" : "bg-amber-500"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-[11px] font-semibold tabular-nums text-gray-600 dark:text-gray-300">
                {filledCount}/{totalReq} · {pct}%
              </span>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800" title="Close">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Live-transfer script */}
          {script.length > 0 && (
            <section className="rounded-xl border border-ocean-blue/40 bg-ocean-blue/5 dark:bg-ocean-blue/10 overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-ocean-blue/20">
                <PhoneIcon className="w-4 h-4 text-ocean-blue" />
                <span className="text-sm font-semibold text-gray-900 dark:text-white">Live-transfer script</span>
                <button type="button" onClick={() => setShowScript((v) => !v)} className="ml-auto text-[11px] font-semibold text-ocean-blue hover:underline">
                  {showScript ? "hide" : "show"}
                </button>
              </div>
              {showScript && (
                <div className="p-3 space-y-2">
                  {script.map((st, i) => (
                    <div key={i}>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{st.title}</div>
                      <p className="text-sm text-gray-800 dark:text-gray-200 italic">"{st.say}"</p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}
          {loading ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
          ) : (
            (Object.keys(bySection) as AppSection[]).map((sec) => (
              <section key={sec}>
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">{SECTION_LABEL[sec]}</h3>
                <div className="grid grid-cols-2 gap-2.5">
                  {bySection[sec].map((f) => (
                    <label
                      key={f.key}
                      className={`text-xs text-gray-600 dark:text-gray-300 ${["business_address", "owner_home_address", "use_of_funds", "business_legal_name"].includes(f.key) ? "col-span-2" : ""}`}
                    >
                      {LABEL_OVERRIDE[f.key] ?? f.label}
                      {f.key === "business_type" ? (
                        <select
                          className={`${inputBase} ${tint(f.key, form[f.key])}`}
                          value={form[f.key] ?? ""}
                          onChange={(e) => set(f.key, e.target.value)}
                        >
                          <option value="">Select…</option>
                          {ENTITY_OPTS.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : (
                        <input
                          className={`${inputBase} ${tint(f.key, form[f.key])}`}
                          type={DATE.has(f.key) ? "date" : NUMERIC.has(f.key) ? "number" : "text"}
                          value={form[f.key] ?? ""}
                          onChange={(e) => set(f.key, e.target.value)}
                        />
                      )}
                    </label>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 dark:border-gray-700 px-5 py-3 space-y-2">
          {toast && <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">{toast}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || loading}
              onClick={() => void save()}
              className="flex-1 inline-flex items-center justify-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save Quick App"}
            </button>
            <button
              type="button"
              disabled={busy || loading}
              onClick={() => void saveAndSend()}
              className="flex-1 inline-flex items-center justify-center gap-1.5 text-sm font-bold px-3 py-2 rounded-lg bg-ocean-blue text-white hover:bg-deep-sea disabled:opacity-50"
            >
              <PaperAirplaneIcon className="w-4 h-4" /> Save & send to e-sign
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
