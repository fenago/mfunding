import { useEffect, useMemo, useState } from "react";
import supabase from "@/supabase";

// ─────────────────────────────────────────────────────────────────────────────
// Funder Deal-Matching Cheat Sheet
//
// A faithful in-app port of the cheat-sheet the owner signed off on. The design
// (navy/mint/gold tokens, semantic A/B/C/D paper colors, callouts, sticky filter
// bar, card grid) is reproduced 1:1 — the ONLY change is that the live-funder
// grid is sourced from the database instead of a hard-coded array, so it can
// never drift from the funder catalog.
//
// Theming: the artifact keyed off prefers-color-scheme / [data-theme]. The app
// drives dark mode with a `dark` class on <html> (see lib/theme-context), so the
// dark token block is scoped to `.dark .fcs` instead. Same colors, app's switch.
// ─────────────────────────────────────────────────────────────────────────────

const CSS = `
.fcs{
  --ink:#0f2942; --ink-soft:#40546b; --ink-faint:#6b7d92;
  --ground:#f6f8fb; --panel:#ffffff; --line:#dfe6ee; --line-soft:#eaeff5;
  --accent:#0f9d6b; --accent-ink:#0a7a52; --gold:#c08a2d;
  --a:#1f8a5b; --a-bg:#e6f4ec; --b:#2f6fb0; --b-bg:#e7f0f9;
  --c:#b7791f; --c-bg:#faf1dd; --d:#c0433d; --d-bg:#fae8e7;
  --chip:#eef2f7; --chip-ink:#42566c;
  --shadow:0 1px 2px rgba(15,41,66,.06),0 4px 16px rgba(15,41,66,.05);
  --radius:14px;
  background:var(--ground);color:var(--ink);min-height:100%;
  font-family:-apple-system,"SF Pro Text",system-ui,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  line-height:1.5;-webkit-font-smoothing:antialiased;
}
.dark .fcs{
  --ink:#e8eef5; --ink-soft:#a9b8c8; --ink-faint:#7d8ea0;
  --ground:#0b1620; --panel:#111e2b; --line:#23303f; --line-soft:#1a2733;
  --accent:#2fc98d; --accent-ink:#57d7a5; --gold:#d9ab52;
  --a:#54c68d; --a-bg:#123024; --b:#6aa6e0; --b-bg:#122238; --c:#dcab55; --c-bg:#2c2413; --d:#e57b74; --d-bg:#2f1817;
  --chip:#1b2836; --chip-ink:#a9b8c8;
  --shadow:0 1px 2px rgba(0,0,0,.3),0 6px 20px rgba(0,0,0,.25);
}
.fcs *{box-sizing:border-box}
.fcs .wrap{max-width:1120px;margin:0 auto;padding:32px 22px 72px}
.fcs .mono{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-variant-numeric:tabular-nums}
.fcs h1,.fcs h2,.fcs h3{text-wrap:balance;letter-spacing:-.02em;margin:0}
.fcs .eyebrow{font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--accent-ink)}
/* header */
.fcs header{border-bottom:2px solid var(--line);padding-bottom:20px;margin-bottom:26px}
.fcs header h1{font-size:clamp(26px,4vw,38px);font-weight:800;margin:.28em 0 .12em;line-height:1.04}
.fcs header p{margin:0;color:var(--ink-soft);max-width:66ch;font-size:15px}
.fcs .brandrow{display:flex;align-items:center;gap:10px}
.fcs .logo{width:26px;height:26px;border-radius:7px;background:linear-gradient(135deg,var(--accent),var(--gold));display:inline-block;box-shadow:var(--shadow)}
.fcs .brandname{font-weight:800;letter-spacing:-.01em}
/* section shells */
.fcs section{margin-top:34px}
.fcs .sec-head{display:flex;align-items:baseline;gap:12px;margin-bottom:14px;flex-wrap:wrap}
.fcs .sec-head h2{font-size:19px;font-weight:800}
.fcs .sec-head .note{color:var(--ink-faint);font-size:13px}
/* paper table */
.fcs .tablewrap{overflow-x:auto;border:1px solid var(--line);border-radius:var(--radius);background:var(--panel);box-shadow:var(--shadow)}
.fcs table{border-collapse:collapse;width:100%;min-width:720px;font-size:13.5px}
.fcs thead th{background:var(--line-soft);text-align:left;padding:11px 14px;font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--ink-faint);font-weight:700;border-bottom:1px solid var(--line)}
.fcs tbody td{padding:13px 14px;border-bottom:1px solid var(--line-soft);vertical-align:top}
.fcs tbody tr:last-child td{border-bottom:0}
.fcs .tier{font-weight:800;font-size:14px;white-space:nowrap;display:inline-flex;align-items:center;gap:8px}
.fcs .dot{width:10px;height:10px;border-radius:50%;display:inline-block}
.fcs .tierA .dot{background:var(--a)} .fcs .tierB .dot{background:var(--b)} .fcs .tierC .dot{background:var(--c)} .fcs .tierD .dot{background:var(--d)}
.fcs .tierA{color:var(--a)} .fcs .tierB{color:var(--b)} .fcs .tierC{color:var(--c)} .fcs .tierD{color:var(--d)}
.fcs .rule{margin-top:12px;padding:13px 16px;border-left:3px solid var(--gold);background:var(--panel);border-radius:0 10px 10px 0;font-size:13.5px;color:var(--ink-soft);box-shadow:var(--shadow)}
.fcs .rule b{color:var(--ink)}
/* callouts */
.fcs .callout{border:1.5px solid var(--accent);border-radius:var(--radius);background:var(--panel);box-shadow:var(--shadow);overflow:hidden}
.fcs .callout .band{background:linear-gradient(90deg,color-mix(in srgb,var(--accent) 16%,transparent),transparent);padding:14px 18px;border-bottom:1px solid var(--line)}
.fcs .callout .band h2{font-size:18px;font-weight:800}
.fcs .callout .band p{margin:.3em 0 0;font-size:13px;color:var(--ink-soft);max-width:80ch}
.fcs .callout.gold{border-color:var(--gold)}
.fcs .callout.gold .band{background:linear-gradient(90deg,color-mix(in srgb,var(--gold) 20%,transparent),transparent)}
.fcs .clist{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:0}
.fcs .citem{padding:14px 18px;border-right:1px solid var(--line-soft);border-bottom:1px solid var(--line-soft)}
.fcs .citem .nm{font-weight:750;font-size:14.5px}
.fcs .citem .ty{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--accent-ink);margin:2px 0 5px}
.fcs .citem .ds{font-size:12.5px;color:var(--ink-soft)}
.fcs .citem.gold .ty{color:var(--gold)}
/* filter bar */
.fcs .controls{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--ground) 88%,transparent);backdrop-filter:blur(8px);padding:12px 0;margin:8px 0 4px;border-bottom:1px solid var(--line)}
.fcs .fgroup{display:flex;flex-wrap:wrap;gap:7px;align-items:center}
.fcs .fgroup + .fgroup{margin-top:9px}
.fcs .flabel{font-size:10.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-faint);margin-right:4px;min-width:52px}
.fcs .pill{font:inherit;font-size:12.5px;font-weight:600;color:var(--chip-ink);background:var(--chip);border:1px solid transparent;padding:5px 11px;border-radius:999px;cursor:pointer;transition:.12s}
.fcs .pill:hover{border-color:var(--accent)}
.fcs .pill[aria-pressed="true"]{background:var(--accent);color:#fff;border-color:var(--accent)}
.dark .fcs .pill[aria-pressed="true"]{color:#08131c}
.fcs .pill:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
.fcs .count{font-size:12.5px;color:var(--ink-faint);margin-left:auto}
/* funder grid */
.fcs .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px;margin-top:16px}
.fcs .card{border:1px solid var(--line);border-radius:var(--radius);background:var(--panel);box-shadow:var(--shadow);padding:15px 16px;display:flex;flex-direction:column;gap:9px}
.fcs .card .top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
.fcs .card .nm{font-weight:750;font-size:15.5px;line-height:1.2}
.fcs .card .rel{font-size:11px;color:var(--ink-faint);margin-top:2px;font-weight:600;letter-spacing:.02em}
.fcs .papers{display:flex;gap:4px;flex-shrink:0}
.fcs .pchip{font-family:ui-monospace,Menlo,monospace;font-size:11px;font-weight:700;width:20px;height:20px;display:grid;place-items:center;border-radius:5px}
.fcs .pA{background:var(--a-bg);color:var(--a)} .fcs .pB{background:var(--b-bg);color:var(--b)} .fcs .pC{background:var(--c-bg);color:var(--c)} .fcs .pD{background:var(--d-bg);color:var(--d)}
.fcs .size{font-size:12px;color:var(--ink-faint);font-variant-numeric:tabular-nums}
.fcs .known{font-size:12px;color:var(--ink-faint);line-height:1.4}
.fcs .fit{font-size:13px;color:var(--ink);line-height:1.42}
.fcs .fit b{color:var(--accent-ink)}
.fcs .tags{display:flex;flex-wrap:wrap;gap:5px;margin-top:auto;padding-top:4px}
.fcs .tag{font-size:10.5px;font-weight:600;letter-spacing:.02em;text-transform:uppercase;padding:3px 7px;border-radius:6px;background:var(--chip);color:var(--chip-ink)}
.fcs .tag.consol{background:color-mix(in srgb,var(--accent) 18%,transparent);color:var(--accent-ink)}
.fcs .tag.ref{background:var(--b-bg);color:var(--b)}
.fcs .tag.re{background:var(--c-bg);color:var(--c)}
.fcs .tag.dr{background:color-mix(in srgb,var(--gold) 20%,transparent);color:var(--gold)}
.fcs .empty{padding:40px;text-align:center;color:var(--ink-faint);border:1px dashed var(--line);border-radius:var(--radius);margin-top:16px}
/* pipeline */
.fcs .pipe{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}
.fcs .pbox{border:1px dashed var(--line);border-radius:var(--radius);background:var(--panel);padding:15px 17px}
.fcs .pbox h3{font-size:14px;font-weight:800;margin-bottom:3px}
.fcs .pbox .sub{font-size:11.5px;color:var(--ink-faint);margin-bottom:10px}
.fcs .pbox ul{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:8px}
.fcs .pbox li{font-size:12.5px;color:var(--ink-soft)}
.fcs .pbox li b{color:var(--ink);font-weight:700}
.fcs footer{margin-top:44px;padding-top:16px;border-top:1px solid var(--line);color:var(--ink-faint);font-size:12px}
.fcs a{color:var(--accent-ink)}
/* loud, non-blocking error banner (no popups, ever) */
.fcs .err{border:1.5px solid var(--d);background:var(--d-bg);color:var(--d);border-radius:var(--radius);padding:14px 16px;font-size:13.5px;font-weight:600;margin-bottom:16px}
@media (max-width:560px){.fcs .wrap{padding:22px 15px 56px}.fcs .count{width:100%;margin:6px 0 0}}
`;

// ── Data shape (lenders.category jsonb — every field optional by design) ──────
type PaperTier = "A" | "B" | "C" | "D" | "all_credit";
type LenderCategory = {
  relationship?: string | null;
  // Some funders are worked in more than one mode — Giggle funds off its own
  // book but the broker channel is a pure referral, ROK is a marketplace we
  // refer to. Those rows carry the full set here; older rows only have the
  // singular `relationship`. Always read both through relSet().
  relationships?: string[] | null;
  size_tier?: string | null;
  paper?: PaperTier[] | null;
  // `type` is a string on most rows but an ARRAY where a funder does both
  // structures (Funderial) — always read it through consoTypes().
  consolidation?: { type?: string | string[] | null; confidence?: string | null; note?: string | null } | null;
  flags?: {
    sba?: boolean;
    real_estate?: boolean;
    micro?: boolean;
    first_position_only?: boolean;
    high_risk_dpaper?: boolean;
    fast_funding?: boolean;
    consolidation?: boolean;
    equipment?: boolean;
    factoring?: boolean;
  } | null;
  known_for?: string | null;
  deal_fit?: string | null;
};

type LenderRow = {
  id: string;
  company_name: string;
  min_funding_amount: number | string | null;
  max_funding_amount: number | string | null;
  category: LenderCategory | null;
};

const cat = (l: LenderRow): LenderCategory => l.category ?? {};
const flags = (l: LenderRow) => cat(l).flags ?? {};

const consoTypes = (l: LenderRow): string[] => {
  const t = cat(l).consolidation?.type;
  const raw = Array.isArray(t) ? t : t == null ? [] : [t];
  return raw.map((x) => String(x).toLowerCase().trim()).filter((x) => x !== "" && x !== "none");
};
// Debt-relief restructure is NOT a consolidation advance — it gets its own lane,
// and must never show up in the Consolidation bucket.
const isRestructure = (l: LenderRow) => consoTypes(l).some((t) => /restructure|relief|settle/.test(t));
const isConsolidation = (l: LenderRow) =>
  !isRestructure(l) && (flags(l).consolidation === true || consoTypes(l).length > 0);
const isReverse = (l: LenderRow) => consoTypes(l).some((t) => /reverse|both/.test(t));
const isPayoff = (l: LenderRow) => consoTypes(l).some((t) => /payoff|true|both/.test(t));

const consoLabel = (l: LenderRow) => {
  const rev = isReverse(l);
  const payoff = isPayoff(l);
  if (rev && payoff) return "Both — true + reverse";
  if (rev) return "Reverse consolidation";
  if (payoff) return "True payoff consolidation";
  return "Consolidation";
};

const REL_LABEL: Record<string, string> = {
  direct_funder: "Direct funder",
  marketplace_aggregator: "Marketplace",
  referral_affiliate: "Referral",
  white_label: "White-label",
};

// The full relationship set: the `relationships` array when the row has one,
// otherwise the singular `relationship`. Everything downstream reads this, so a
// funder we work as BOTH a direct funder and a referral partner lands in both
// places instead of only the first one.
const relSet = (l: LenderRow): string[] => {
  const c = cat(l);
  const many = (c.relationships ?? []).map((r) => String(r).toLowerCase().trim()).filter(Boolean);
  if (many.length > 0) return many;
  const one = (c.relationship ?? "").toLowerCase().trim();
  return one ? [one] : [];
};
const isReferralPartner = (l: LenderRow) => relSet(l).some((r) => /referral|affiliate/.test(r));
const isMarketplace = (l: LenderRow) => relSet(l).some((r) => /marketplace|aggregator/.test(r));
// The "Referral / marketplace" bucket: anything we refer out rather than submit
// a package to — referral partners AND marketplaces.
const isReferralModel = (l: LenderRow) =>
  isReferralPartner(l) || isMarketplace(l) || relSet(l).some((r) => r === "white_label");

const relLabel = (l: LenderRow) => {
  const set = relSet(l);
  if (set.length === 0) return "Funder";
  const label = (r: string) => REL_LABEL[r] ?? r.replace(/_/g, " ");
  // Worked as a referral on top of what they actually are — lead with the
  // relationship the closer acts on, then how the funder itself operates.
  if (isReferralPartner(l) && set.length > 1) {
    const other = set.find((r) => !/referral|affiliate/.test(r));
    return other ? `Active referral · ${label(other).toLowerCase()}` : "Active referral";
  }
  return label(set[0]);
};

const SIZE_TIER_LABEL: Record<string, string> = {
  micro: "Micro",
  small: "Small",
  small_mid: "Small–mid",
  mid_large: "Mid–large",
  jumbo: "Jumbo",
};

const num = (v: number | string | null): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const fmtMoney = (n: number | null) =>
  n == null
    ? null
    : n >= 1_000_000
      ? `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
      : n >= 1000
        ? `$${Math.round(n / 1000)}K`
        : `$${n}`;

const sizeRange = (l: LenderRow): string => {
  const lo = fmtMoney(num(l.min_funding_amount));
  const hi = fmtMoney(num(l.max_funding_amount));
  if (lo && hi) return `${lo}–${hi}`;
  if (hi) return `up to ${hi}`;
  if (lo) return `${lo}+`;
  return SIZE_TIER_LABEL[cat(l).size_tier ?? ""] ?? "—";
};

const paperChips = (l: LenderRow): string[] =>
  (cat(l).paper ?? []).filter((p): p is "A" | "B" | "C" | "D" => p === "A" || p === "B" || p === "C" || p === "D");

// ── Buckets — derived from the category payload, so the filters can never drift
// from the catalog. Debt relief and Consolidation are mutually exclusive.
type BucketId = "consol" | "debtrelief" | "micro" | "realestate" | "sba" | "direct" | "referral" | "fast";
const bucketsOf = (l: LenderRow): BucketId[] => {
  const f = flags(l);
  const b: BucketId[] = [];
  if (isConsolidation(l)) b.push("consol");
  if (isRestructure(l)) b.push("debtrelief");
  if (f.micro) b.push("micro");
  if (f.real_estate) b.push("realestate");
  if (f.sba) b.push("sba");
  if (isReferralModel(l)) b.push("referral");
  else b.push("direct");
  if (f.fast_funding) b.push("fast");
  return b;
};

const tagsOf = (l: LenderRow): string[] => {
  const f = flags(l);
  const t: string[] = [];
  if (isRestructure(l)) t.push("Debt relief");
  if (isConsolidation(l)) t.push(consoLabel(l).replace(/ consolidation$/i, " consol."));
  if (isReferralPartner(l)) t.push("Referral");
  if (isMarketplace(l)) t.push("Marketplace");
  if (relSet(l).includes("white_label")) t.push("White-label");
  if (f.sba) t.push("SBA");
  if (f.real_estate) t.push("Real estate");
  if (f.micro) t.push("Micro");
  if (f.fast_funding) t.push("Fast");
  if ((cat(l).paper ?? []).includes("all_credit")) t.push("All-credit");
  if (f.high_risk_dpaper) t.push("High-risk OK");
  return t;
};

const tagClass = (t: string) => {
  const l = t.toLowerCase();
  if (l.includes("debt relief")) return "tag dr";
  if (l.includes("consol")) return "tag consol";
  if (l.includes("referral") || l.includes("marketplace") || l.includes("white-label")) return "tag ref";
  if (l.includes("real estate")) return "tag re";
  return "tag";
};

// Curated reading order from the sheet the owner approved — widest/first-stop
// funders, then the consolidation lane, then the high-risk desks, then the
// marketplaces. Anything new in the catalog falls in after, alphabetically, so
// the page keeps working as funders are added.
const ORDER = [
  "cobalt",
  "nationwide",
  "relfi",
  "gokapital",
  "bizcap",
  "fundkite",
  "uplyft",
  "highland hill",
  "diesel",
  "green note",
  "funderial",
  "value capital",
  "the lcf",
  "cashable",
  "velocity",
  "capital express",
  "instafunders",
  "lendini",
  "instagreen",
  "true advance",
  "corfin",
  "fantastic",
  "reliant",
  "elite funders",
  "1 west",
  "united capital source",
  "guidant",
];
const orderRank = (name: string) => {
  const n = name.toLowerCase();
  const i = ORDER.findIndex((frag) => n.startsWith(frag));
  return i === -1 ? ORDER.length : i;
};

const PAPER_FILTERS = ["all", "A", "B", "C", "D"] as const;
const BUCKET_FILTERS: { v: "all" | BucketId; label: string }[] = [
  { v: "all", label: "All" },
  { v: "consol", label: "Consolidation" },
  { v: "debtrelief", label: "Debt relief" },
  { v: "micro", label: "Micro ($5–25K)" },
  { v: "realestate", label: "Real estate" },
  { v: "sba", label: "SBA" },
  { v: "direct", label: "Direct funder" },
  { v: "referral", label: "Referral / marketplace" },
  { v: "fast", label: "Fast / light stips" },
];

export default function FunderCheatSheetPage() {
  const [lenders, setLenders] = useState<LenderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paper, setPaper] = useState<(typeof PAPER_FILTERS)[number]>("all");
  const [bucket, setBucket] = useState<"all" | BucketId>("all");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: err } = await supabase
        .from("lenders")
        .select("id, company_name, min_funding_amount, max_funding_amount, category")
        .eq("status", "live_vendor");
      if (cancelled) return;
      if (err) {
        setError(`Could not load the live funder list — ${err.message}`);
        setLoading(false);
        return;
      }
      const rows = ((data ?? []) as LenderRow[]).slice().sort((a, b) => {
        const ra = orderRank(a.company_name);
        const rb = orderRank(b.company_name);
        if (ra !== rb) return ra - rb;
        return a.company_name.localeCompare(b.company_name);
      });
      setLenders(rows);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const decorated = useMemo(
    () =>
      lenders.map((l) => ({
        l,
        papers: paperChips(l),
        buckets: bucketsOf(l),
        tags: tagsOf(l),
      })),
    [lenders],
  );

  const shown = useMemo(
    () =>
      decorated.filter(
        (d) =>
          (paper === "all" || d.papers.includes(paper)) &&
          (bucket === "all" || d.buckets.includes(bucket)),
      ),
    [decorated, paper, bucket],
  );

  const consolidators = useMemo(() => lenders.filter(isConsolidation), [lenders]);
  const debtRelief = useMemo(() => lenders.filter(isRestructure), [lenders]);

  return (
    <div className="fcs">
      <style>{CSS}</style>
      <div className="wrap">
        <header>
          <div className="brandrow">
            <span className="logo" aria-hidden="true" />
            <span className="brandname">Momentum Funding</span>
          </div>
          <p className="eyebrow" style={{ marginTop: 14 }}>
            Internal · Deal-Matching Reference
          </p>
          <h1>Funder Cheat Sheet</h1>
          <p>
            Match the deal to the funder. Read the merchant's <b>paper grade</b>, check whether they're{" "}
            <b>stacked</b> (needs consolidation), then filter to the right shortlist. Covers the funders you work
            today — your <b>{loading ? "…" : `${lenders.length}`} live vendors</b> plus{" "}
            <b>active referral partners</b>.
          </p>
        </header>

        {error && <div className="err">{error}</div>}

        {/* PAPER EDUCATION */}
        <section aria-labelledby="paper-h">
          <div className="sec-head">
            <h2 id="paper-h">What A / B / C / D paper means</h2>
            <span className="note">the single biggest driver of who to send it to</span>
          </div>
          <p style={{ margin: "0 0 14px", color: "var(--ink-soft)", fontSize: 14, maxWidth: "82ch" }}>
            “Paper” = the credit quality / risk grade of the <em>merchant</em> — it determines who will fund them, at
            what cost, and on what terms.
          </p>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Tier</th>
                  <th>Merchant profile</th>
                  <th>Typical terms</th>
                  <th>Who funds it</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <span className="tier tierA">
                      <span className="dot" />A paper
                    </span>
                  </td>
                  <td>
                    Strong: ~680+ FICO, 2+ yrs in business, healthy consistent revenue, <b>no existing MCAs</b>, clean
                    statements (no NSFs, good balances)
                  </td>
                  <td>Low factor (~1.10–1.25), longer terms (12–18mo), often weekly/monthly</td>
                  <td>Bank-like / prime funders (Kapitus, BriteCap, IOU, Vox, Nationwide)</td>
                </tr>
                <tr>
                  <td>
                    <span className="tier tierB">
                      <span className="dot" />B paper
                    </span>
                  </td>
                  <td>
                    Good-not-perfect: ~600–680 FICO, decent revenue, <b>0–1 existing position</b>, minor blemishes
                  </td>
                  <td>Factor ~1.25–1.35, terms ~6–12mo</td>
                  <td>Most mainstream MCA funders</td>
                </tr>
                <tr>
                  <td>
                    <span className="tier tierC">
                      <span className="dot" />C paper
                    </span>
                  </td>
                  <td>
                    Subprime: ~500–600 FICO, shorter history, some NSFs/negative days, <b>1–2 stacked positions</b>
                  </td>
                  <td>Factor ~1.35–1.45, terms ~3–6mo, daily payments</td>
                  <td>High-risk MCA shops</td>
                </tr>
                <tr>
                  <td>
                    <span className="tier tierD">
                      <span className="dot" />D paper
                    </span>
                  </td>
                  <td>
                    Bottom tier: &lt;500 FICO, <b>heavily stacked</b> (multiple positions), frequent NSFs/negative days,
                    distressed
                  </td>
                  <td>Factor ~1.45–1.49+, short terms (2–4mo), daily debits, smaller amounts</td>
                  <td>Last-resort funders who'll stack onto already-stacked merchants</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="rule">
            <b>Rule of thumb:</b> the further toward D, the worse the credit, the higher the cost, the shorter the term
            — but the more willing the funder is to touch a stacked or blemished merchant. Sending an{" "}
            <b>A-paper merchant to a D-paper funder overprices them</b> (you'll lose the deal to a competitor); sending
            a <b>D-paper merchant to an A-paper funder gets an instant decline.</b>
          </div>
        </section>

        {/* CONSOLIDATION */}
        <section aria-labelledby="con-h">
          <div className="callout">
            <div className="band">
              <h2 id="con-h">🔗 Consolidation &amp; Reverse-Consolidation — the stacked-book lifeline</h2>
              <p>
                A distinct product for over-stacked merchants (we saw it live with <b>Bay Finish</b> — stacked on CFG +
                SBFS, couldn't afford a new advance). <b>True consolidation / payoff</b> pays the existing positions off
                into one. <b>Reverse consolidation</b> deposits money to cover the existing daily debits while the
                merchant makes one smaller payment over a longer term. When a lead is too stacked to fund, this is where
                it goes instead of being written off.
              </p>
            </div>
            <div className="clist">
              {consolidators.map((l) => (
                <div className="citem" key={l.id}>
                  <div className="nm">{l.company_name}</div>
                  <div className="ty">{consoLabel(l)}</div>
                  <div className="ds">{cat(l).known_for ?? cat(l).deal_fit}</div>
                </div>
              ))}
              {!loading && consolidators.length === 0 && (
                <div className="citem">
                  <div className="ds">No live funder is flagged for consolidation right now.</div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* DEBT RELIEF */}
        <section aria-labelledby="dr-h">
          <div className="callout gold">
            <div className="band">
              <h2 id="dr-h">🛟 Debt Relief — the distressed-merchant exit</h2>
              <p>
                A different product from consolidation: not a new advance, a <b>workout</b>. For the merchant too
                stacked to fund at all — near or in default — this is where the file goes instead of being written off.
              </p>
            </div>
            <div className="clist">
              {debtRelief.map((l) => (
                <div className="citem gold" key={l.id}>
                  <div className="nm">{l.company_name}</div>
                  <div className="ty">Debt-relief / restructure · {relLabel(l).toLowerCase()}</div>
                  <div className="ds">{cat(l).deal_fit ?? cat(l).known_for}</div>
                </div>
              ))}
              {!loading && debtRelief.length === 0 && (
                <div className="citem">
                  <div className="ds">No live debt-relief partner on the roster right now.</div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* LIVE FUNDERS + FILTERS */}
        <section aria-labelledby="live-h">
          <div className="sec-head">
            <h2 id="live-h">Live funders</h2>
            <span className="note">filter to the shortlist for the deal in front of you</span>
          </div>
          <div className="controls">
            <div className="fgroup">
              <span className="flabel">Paper</span>
              {PAPER_FILTERS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="pill"
                  aria-pressed={paper === p}
                  onClick={() => setPaper(p)}
                >
                  {p === "all" ? "All" : p}
                </button>
              ))}
            </div>
            <div className="fgroup">
              <span className="flabel">Bucket</span>
              {BUCKET_FILTERS.map((b) => (
                <button
                  key={b.v}
                  type="button"
                  className="pill"
                  aria-pressed={bucket === b.v}
                  onClick={() => setBucket(b.v)}
                >
                  {b.label}
                </button>
              ))}
              <span className="count">
                {loading ? "loading…" : `${shown.length} of ${decorated.length} live funders`}
              </span>
            </div>
          </div>

          <div className="grid">
            {shown.map(({ l, papers, tags }) => (
              <article className="card" key={l.id}>
                <div className="top">
                  <div>
                    <div className="nm">{l.company_name}</div>
                    <div className="rel">{relLabel(l)}</div>
                  </div>
                  <div className="papers">
                    {papers.map((p) => (
                      <span className={`pchip p${p}`} key={p}>
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="size mono">{sizeRange(l)}</div>
                {cat(l).known_for && <div className="known">{cat(l).known_for}</div>}
                {cat(l).deal_fit && <div className="fit">{cat(l).deal_fit}</div>}
                <div className="tags">
                  {tags.map((t) => (
                    <span className={tagClass(t)} key={t}>
                      {t}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
          {!loading && shown.length === 0 && (
            <div className="empty">No live funder matches that combination — widen the filters.</div>
          )}
        </section>

        {/* PIPELINE */}
        <section aria-labelledby="pipe-h">
          <div className="sec-head">
            <h2 id="pipe-h">Pipeline — activate these to fill the gaps</h2>
            <span className="note">applied / potential, not live yet</span>
          </div>
          <div className="pipe">
            <div className="pbox">
              <h3>🎯 Direct-submit micro ($500–$25K)</h3>
              <div className="sub">
                Giggle already covers referral micro (live). These would add micro you keep in-house / direct-submit.
              </div>
              <ul>
                <li>
                  <b>Fundo</b> — $500–$10K, no credit check, no personal guarantee (gig/1099).
                </li>
                <li>
                  <b>Bitty Advance</b> — $2K+, small-ticket fast MCA, 500 FICO / all-credit.
                </li>
                <li>
                  <b>Cresthill Capital</b> — micro-ticket, will sit behind 1st–3rd positions.
                </li>
                <li>
                  <b>CapitaWize · Cedar Advance</b> — small Miami boutiques, same-day small tickets.
                </li>
              </ul>
            </div>
            <div className="pbox">
              <h3>🔗 More consolidation</h3>
              <div className="sub">Extra stacked-book capacity in the pipeline.</div>
              <ul>
                <li>
                  <b>Genuine Funding</b> — deep D-paper positions well beyond 3rd + reverse consolidations.
                </li>
                <li>
                  <b>Berkman Financial</b> — same-day $10K–$2M; will consolidate existing balances.
                </li>
                <li>
                  <b>Fenix Capital Funding</b> — strong 2nd/3rd positions + balance consolidations.
                </li>
              </ul>
            </div>
            <div className="pbox">
              <h3>⭐ Prime A/B to activate</h3>
              <div className="sub">Clean-file coverage you're light on when live.</div>
              <ul>
                <li>
                  <b>Kapitus · BriteCap · IOU · Vox</b> — mainstream A/B-paper funders.
                </li>
                <li>
                  <b>Fora Financial · Rapid Finance · Credibly</b> — big shelves, MCA→SBA.
                </li>
                <li>
                  <b>Libertas Funding</b> — jumbo $100K–$10M for your largest clean files.
                </li>
              </ul>
            </div>
          </div>
        </section>

        <footer>
          Live-funder data reads straight from the funder catalog (lenders marked <b>live vendor</b>), so this page
          updates as the network changes · buckets are directional — always confirm the current credit box and any
          consolidation product with the funder's rep · this is an internal working tool, not a merchant-facing
          document.
        </footer>
      </div>
    </div>
  );
}
