import { useState, useMemo, useEffect, useCallback } from "react";
import supabase from "../../../supabase";
import { syncVendorToGHL } from "../../../services/ghlService";
import PageGuide from "../../../components/admin/PageGuide";

/* ---- design tokens (shared with the calculator for continuity) ---- */
const C = {
  ink: "#0E1B2A", ink2: "#15273C", paper: "#F7F5EF", card: "#FFFFFF",
  line: "#E4DECF", lineDark: "rgba(255,255,255,0.10)",
  green: "#1F9D6B", greenBright: "#34D399", amber: "#E0A53B", red: "#D9663F",
  slate: "#33445A", muted: "#6B7A8D", mutedDark: "#8AA0B6",
};

/* ---- the criteria you named, weighted ---- */
const CRITERIA = [
  { key: "exclusivity", label: "Exclusivity", w: 18, ask: "Sold once, to me only? How do they verify it isn't resold? Recorded call as proof." },
  { key: "billing", label: "Billing protection", w: 18, ask: "Reversible payment (card / PayPal G&S)? Per-lead billing with a talk-time buffer? Big upfront minimum = your money is trapped." },
  { key: "guarantee", label: "Replacement guarantee", w: 16, ask: "Written qualification criteria, and a replacement for any lead that misses them? Return window? Do they pull the call recording to adjudicate?" },
  { key: "quality", label: "Lead quality controls", w: 14, ask: "Pre-screens revenue, time-in-business, no open bankruptcy? QC reviews each call? 60-sec talk-time floor before it bills?" },
  { key: "credibility", label: "Credibility / track record", w: 14, ask: "Years in business, named owner, real broker references, deBanked / Trustpilot / DailyFunder footprint — not just testimonials on their own site." },
  { key: "price", label: "Price vs break-even", w: 8, ask: "Per-transfer cost vs the break-even in your calculator. Cheap junk loses to pricier exclusive every time on cost-per-funded-deal." },
  { key: "integration", label: "Delivery / GHL fit", w: 6, ask: "Will they hit a dedicated tracking number and POST lead data to a webhook? Can you set the hours they transfer?" },
  { key: "compliance", label: "TCPA / DNC scrubbing", w: 6, ask: "Litigator + DNC scrub in writing? This is your legal exposure, not theirs." },
] as const;

type CritKey = (typeof CRITERIA)[number]["key"];
type Recourse = boolean | "mid" | "ask";

const PAY: Record<string, { label: string; recourse: Recourse; note: string }> = {
  card: { label: "Credit card", recourse: true, note: "Chargeable — best protection" },
  paypal_gs: { label: "PayPal Goods&Svcs", recourse: true, note: "Disputable" },
  ach_invoice: { label: "ACH / invoice terms", recourse: "mid", note: "Some recourse via bank dispute" },
  wire: { label: "Wire only", recourse: false, note: "No recourse" },
  crypto: { label: "Crypto only", recourse: false, note: "Irreversible — no recourse" },
  zelle: { label: "Zelle / CashApp", recourse: false, note: "Irreversible — no recourse" },
  unknown: { label: "Unknown — ask", recourse: "ask", note: "Confirm before sending a dollar" },
};

interface Vendor {
  id: string; // uuid (db) or "new-N" (unsaved)
  dbId: string | null;
  name: string;
  url: string;
  pay: string;
  s: Record<CritKey, number>;
  note: string;
}

const tier = (score: number, recourse: Recourse) => {
  if (recourse === false) return { label: "Avoid · no recourse", color: C.red };
  if (score >= 75) return { label: "Test first", color: C.green };
  if (score >= 60) return { label: "Shortlist", color: C.greenBright };
  if (score >= 45) return { label: "Maybe", color: C.amber };
  return { label: "Pass", color: C.muted };
};

const clamp5 = (n: number) => Math.max(0, Math.min(5, Math.round(n)));

// Seed per-criterion 0-5 scores from a vendor's structured DB fields (used when
// the vendor hasn't been scored in the scorecard yet).
function seedScores(row: Record<string, unknown>): Record<CritKey, number> {
  const cpl = row.cost_per_lead == null ? null : Number(row.cost_per_lead);
  const price = cpl == null ? 3 : cpl <= 30 ? 5 : cpl <= 40 ? 4 : cpl <= 55 ? 3 : cpl <= 75 ? 2 : 1;
  const g = String(row.ghl_integration || "").toLowerCase();
  const integration = /yes|directly into your crm|webhook/.test(g) ? 5 : /crm delivery available|email or crm|email \/ sms \/ crm/.test(g) ? 3 : 2;
  const credibility = row.reputation_score == null ? 3 : clamp5(Number(row.reputation_score) / 6);
  const ex = String(row.exclusivity || "").toLowerCase();
  const exclusivity = /no resale|sold once|sold only once|1 buyer/.test(ex) ? 5 : /exclusive/.test(ex) ? 4 : 3;
  const rp = String(row.return_policy || "").toLowerCase();
  const billing = /crypto|no recourse/.test(rp) ? 0 : /60\+?\s*sec/.test(rp) ? 5 : /guarantee|replacement|93%|quality.control/.test(rp) ? 4 : /none|not stated/.test(rp) ? 2 : 3;
  const guarantee = /replacement|guarantee|93%|satisfaction|60\+?\s*sec/.test(rp) ? 4 : /none|not stated/.test(rp) ? 2 : 3;
  const compliance = /dnc|tcpa|scrub|litigator/.test(String(row.lead_generation_method || "") + rp) ? 4 : 3;
  return { exclusivity, billing, guarantee, quality: 3, credibility, price, integration, compliance };
}

export default function VendorScorecardPage() {
  const [weights, setWeights] = useState<Record<string, number>>(
    Object.fromEntries(CRITERIA.map((c) => [c.key, c.w]))
  );
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [nextId, setNextId] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("marketing_vendors")
        .select("id, vendor_name, website, payment_method, scorecard_scores, reputation, cost_per_lead, ghl_integration, reputation_score, exclusivity, return_policy, lead_generation_method")
        .in("status", ["testing", "active"])
        .contains("lead_types", ["live_transfer"]);
      if (error) throw error;
      const mapped: Vendor[] = (data || []).map((r: Record<string, any>) => ({
        id: r.id,
        dbId: r.id,
        name: r.vendor_name,
        url: (r.website || "").replace(/^https?:\/\//, ""),
        pay: r.payment_method || "unknown",
        s: r.scorecard_scores && typeof r.scorecard_scores === "object"
          ? { ...seedScores(r), ...r.scorecard_scores }
          : seedScores(r),
        note: r.reputation || "",
      }));
      setVendors(mapped);
      setSel((cur) => cur ?? mapped[0]?.id ?? null);
    } catch (e) {
      console.error("Scorecard load failed:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const totalW = Object.values(weights).reduce((a, b) => a + b, 0) || 1;

  const scored = useMemo(() => vendors.map((v) => {
    const raw = CRITERIA.reduce((sum, c) => sum + (v.s[c.key] ?? 0) / 5 * weights[c.key], 0);
    const score = Math.round(raw / totalW * 100);
    const rec = PAY[v.pay]?.recourse ?? "ask";
    return { ...v, score, t: tier(score, rec) };
  }).sort((a, b) => {
    const ar = (PAY[a.pay]?.recourse) === false, br = (PAY[b.pay]?.recourse) === false;
    if (ar !== br) return ar ? 1 : -1;
    return b.score - a.score;
  }), [vendors, weights, totalW]);

  const current = vendors.find((v) => v.id === sel) || vendors[0];

  const setScore = (key: CritKey, val: number) =>
    setVendors((vs) => vs.map((v) => (v.id === sel ? { ...v, s: { ...v.s, [key]: val } } : v)));
  const setField = (field: keyof Vendor, val: string) =>
    setVendors((vs) => vs.map((v) => (v.id === sel ? { ...v, [field]: val } : v)));
  const addVendor = () => {
    const id = `new-${nextId}`;
    const v: Vendor = { id, dbId: null, name: "New vendor", url: "", pay: "unknown",
      s: Object.fromEntries(CRITERIA.map((c) => [c.key, 3])) as Record<CritKey, number>, note: "" };
    setVendors((vs) => [...vs, v]); setSel(id); setNextId((n) => n + 1);
  };
  const delVendor = () => {
    if (vendors.length <= 1) return;
    const rest = vendors.filter((v) => v.id !== sel);
    setVendors(rest); setSel(rest[0].id);
  };

  // Persist: write normalized score + rank + payment + per-criterion scores back to the DB
  const saveAll = async () => {
    setSaving(true); setSavedMsg(null);
    try {
      const ranked = scored.map((v, i) => ({ ...v, rank: PAY[v.pay]?.recourse === false ? 99 + i : i + 1 }));
      for (const v of ranked) {
        const payload = {
          vendor_name: v.name,
          website: v.url ? (v.url.startsWith("http") ? v.url : `https://${v.url}`) : null,
          payment_method: v.pay,
          scorecard_scores: v.s,
          score: v.score,
          rank: v.rank,
          reputation: v.note || null,
        };
        if (v.dbId) {
          await supabase.from("marketing_vendors").update(payload).eq("id", v.dbId);
        } else {
          const { data: inserted } = await supabase.from("marketing_vendors").insert({
            ...payload, status: "testing", lead_types: ["live_transfer"],
          }).select("id").single();
          // New vendor → push into GHL/VibeReach. Best-effort.
          if (inserted?.id) void syncVendorToGHL(inserted.id).catch((e) => console.warn("GHL vendor sync failed:", e));
        }
      }
      setSavedMsg("Saved — scores & ranks updated.");
      await load();
    } catch (e) {
      console.error("Scorecard save failed:", e);
      setSavedMsg("Save failed — check console / permissions.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ background: C.paper, minHeight: "100vh", color: C.slate, fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif" }}>
      <style>{`
        .sc * { box-sizing: border-box; }
        .sc .wrap { max-width: 880px; margin: 0 auto; padding: 20px 16px 60px; }
        .sc .mono { font-variant-numeric: tabular-nums; }
        .sc .eyebrow { font-size: 11px; letter-spacing:.22em; text-transform:uppercase; color:${C.muted}; font-weight:600; }
        .sc h1 { font-size: 25px; line-height:1.15; margin:6px 0 2px; color:${C.ink}; font-weight:800; letter-spacing:-.02em; }
        .sc .sub { color:${C.muted}; font-size:13.5px; max-width:560px; }
        .sc .card { background:${C.card}; border:1px solid ${C.line}; border-radius:14px; padding:16px; margin-top:16px; }
        .sc .card h2 { font-size:12px; letter-spacing:.05em; text-transform:uppercase; color:${C.ink}; margin:0 0 12px; font-weight:700; }
        .sc .board { background:${C.ink}; border-radius:16px; padding:14px; margin-top:18px; }
        .sc .lbrow { display:flex; align-items:center; gap:12px; padding:11px 12px; border-radius:11px; cursor:pointer; }
        .sc .lbrow:hover { background:${C.ink2}; }
        .sc .lbrow.on { background:${C.ink2}; outline:1px solid rgba(52,211,153,.35); }
        .sc .rank { width:20px; color:${C.mutedDark}; font-weight:700; font-size:13px; }
        .sc .vn { flex:1; min-width:0; }
        .sc .vn .nm { color:#fff; font-weight:700; font-size:14.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .sc .vn .u { color:${C.mutedDark}; font-size:11.5px; }
        .sc .scorebig { font-size:21px; font-weight:800; }
        .sc .tag { font-size:10px; font-weight:700; letter-spacing:.04em; padding:3px 8px; border-radius:999px; white-space:nowrap; }
        .sc .row { display:flex; justify-content:space-between; align-items:center; gap:10px; }
        .sc .field label { font-size:12px; font-weight:600; color:${C.slate}; }
        .sc input, .sc select, .sc textarea { font-family:inherit; }
        .sc .txt { width:100%; border:1px solid ${C.line}; border-radius:9px; padding:9px 11px; font-size:14px; background:${C.paper}; color:${C.ink}; margin-top:5px; }
        .sc .crit { padding:11px 0; border-top:1px solid ${C.line}; }
        .sc .crit:first-of-type { border-top:0; }
        .sc .crit .top { display:flex; justify-content:space-between; align-items:baseline; gap:10px; }
        .sc .crit .lab { font-size:13.5px; font-weight:700; color:${C.ink}; }
        .sc .crit .wt { font-size:11px; color:${C.muted}; }
        .sc .crit .ask { font-size:11.5px; color:${C.muted}; margin-top:3px; line-height:1.5; }
        .sc .dots { display:flex; gap:6px; margin-top:8px; }
        .sc .dot { width:30px; height:30px; border-radius:8px; border:1px solid ${C.line}; background:${C.paper}; font-size:12px; font-weight:700; color:${C.muted}; cursor:pointer; }
        .sc .dot.on { background:${C.green}; color:#fff; border-color:${C.green}; }
        .sc .wstrip { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
        .sc .wrow { display:flex; justify-content:space-between; align-items:center; font-size:12px; gap:8px; }
        .sc .wrow input { width:52px; text-align:right; border:1px solid ${C.line}; border-radius:7px; padding:5px 7px; background:${C.paper}; }
        .sc .btn { border:1px solid ${C.line}; background:${C.paper}; color:${C.slate}; font-weight:600; font-size:12.5px; padding:8px 14px; border-radius:9px; cursor:pointer; }
        .sc .btn.dark { background:${C.ink}; color:#fff; border-color:${C.ink}; }
        .sc .btn.green { background:${C.green}; color:#fff; border-color:${C.green}; }
        .sc .pill { display:inline-block; font-size:11px; font-weight:600; padding:3px 9px; border-radius:999px; }
        @media (max-width:560px){ .sc h1{font-size:21px;} .sc .wstrip{grid-template-columns:1fr;} }
      `}</style>

      <div className="sc">
        <div className="wrap">
          <div className="eyebrow">MFunding · Vendor Vetting</div>
          <h1>Live-Lead Vendor Scorecard</h1>
          <p className="sub">Score each vendor on what actually matters before you spend. Crypto/wire/Zelle-only auto-drops to the bottom — no recourse is a dealbreaker, not a discount.</p>

          <div style={{ marginTop: 16 }}>
            <PageGuide
              title="Vendor Scorecard"
              storageKey="vendor-scorecard"
              what="An interactive tool to score and rank lead vendors on what actually matters."
              value="Turns gut feel into a defensible, repeatable ranking you can update as you learn."
              howToUse={[
                "Score each vendor 0–5 per criterion; tune the weights to your priorities.",
                "Add new vendors and click Save to persist scores + ranks.",
              ]}
              howToRead={[
                "Crypto/wire/Zelle-only auto-drop to the bottom (no recourse).",
                "Higher score = test first; the tier tag tells you the action.",
              ]}
            />
          </div>

          {loading ? (
            <div className="card">Loading vendors…</div>
          ) : (
            <>
              {/* leaderboard */}
              <div className="board">
                {scored.map((v, i) => (
                  <div key={v.id} className={"lbrow" + (v.id === sel ? " on" : "")} onClick={() => setSel(v.id)}>
                    <div className="rank">{PAY[v.pay]?.recourse === false ? "—" : i + 1}</div>
                    <div className="vn">
                      <div className="nm">{v.name}</div>
                      <div className="u">{v.url || "no url yet"} · {PAY[v.pay]?.label}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div className="scorebig mono" style={{ color: v.t.color }}>{v.score}</div>
                    </div>
                    <div className="tag" style={{ background: v.t.color + "22", color: v.t.color }}>{v.t.label}</div>
                  </div>
                ))}
                <div style={{ display: "flex", gap: 8, padding: "10px 6px 4px", flexWrap: "wrap" }}>
                  <button className="btn dark" onClick={addVendor}>+ Add vendor</button>
                  <button className="btn" onClick={delVendor} style={{ background: "transparent", color: C.mutedDark, borderColor: C.lineDark }}>Remove selected</button>
                  <button className="btn green" onClick={saveAll} disabled={saving} style={{ marginLeft: "auto" }}>
                    {saving ? "Saving…" : "Save scores & ranks to database"}
                  </button>
                </div>
                {savedMsg && <div style={{ color: C.greenBright, fontSize: 12, padding: "4px 6px" }}>{savedMsg}</div>}
              </div>

              {/* editor */}
              {current && (
                <div className="card">
                  <div className="row" style={{ marginBottom: 12 }}>
                    <h2 style={{ margin: 0 }}>Scoring: {current.name}</h2>
                  </div>
                  <div className="field" style={{ marginBottom: 10 }}>
                    <label>Vendor name</label>
                    <input className="txt" value={current.name} onChange={(e) => setField("name", e.target.value)} />
                  </div>
                  <div className="row" style={{ gap: 10 }}>
                    <div className="field" style={{ flex: 1 }}>
                      <label>Website</label>
                      <input className="txt" value={current.url} onChange={(e) => setField("url", e.target.value)} placeholder="example.com" />
                    </div>
                    <div className="field" style={{ flex: 1 }}>
                      <label>Payment method</label>
                      <select className="txt" value={current.pay} onChange={(e) => setField("pay", e.target.value)}>
                        {Object.entries(PAY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                      </select>
                    </div>
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <span className="pill" style={{
                      background: PAY[current.pay]?.recourse === false ? C.red + "22" : PAY[current.pay]?.recourse === true ? C.green + "22" : C.amber + "22",
                      color: PAY[current.pay]?.recourse === false ? C.red : PAY[current.pay]?.recourse === true ? C.green : C.amber,
                    }}>{PAY[current.pay]?.note}</span>
                  </div>

                  <div style={{ marginTop: 14 }}>
                    {CRITERIA.map((c) => (
                      <div className="crit" key={c.key}>
                        <div className="top">
                          <span className="lab">{c.label}</span>
                          <span className="wt">weight {weights[c.key]}</span>
                        </div>
                        <div className="ask">{c.ask}</div>
                        <div className="dots">
                          {[0, 1, 2, 3, 4, 5].map((n) => (
                            <button key={n} className={"dot" + ((current.s[c.key] ?? 0) === n ? " on" : "")} onClick={() => setScore(c.key, n)}>{n}</button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="field" style={{ marginTop: 14 }}>
                    <label>Notes</label>
                    <textarea className="txt" rows={3} value={current.note} onChange={(e) => setField("note", e.target.value)} />
                  </div>
                </div>
              )}

              {/* weights */}
              <div className="card">
                <h2>Tune the weights</h2>
                <div className="wstrip">
                  {CRITERIA.map((c) => (
                    <div className="wrow" key={c.key}>
                      <span>{c.label}</span>
                      <input type="number" min={0} max={40} value={weights[c.key]}
                        onChange={(e) => setWeights((w) => ({ ...w, [c.key]: Math.max(0, +e.target.value || 0) }))} />
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 11.5, color: C.muted, marginTop: 10 }}>
                  Weights total {totalW} — scores are normalized, so they don't need to sum to 100. Push the levers that matter most to you.
                </div>
              </div>

              <p style={{ fontSize: 11, color: C.muted, marginTop: 16, lineHeight: 1.6 }}>
                Pre-loaded scores are starting estimates derived from your vendor data — overwrite each one with what the vendor actually tells you on the call, then Save. A 0 on Billing protection plus a no-recourse payment method is your signal to walk.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
