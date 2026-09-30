import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import supabase from "@/supabase";
import {
  type FunderCriteria,
  acceptsPositions,
  collectionsLabel,
  collectionsTone,
  criteriaOf,
  fmtFico,
  fmtRev,
  fmtTib,
  listOf,
  positionStance,
} from "@/lib/funderCriteria";

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
/* criteria box — max positions + the collections gate, always visible */
.fcs .box{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.fcs .bchip{font-size:11px;font-weight:750;padding:3px 8px;border-radius:7px;background:var(--chip);color:var(--chip-ink);white-space:nowrap}
.fcs .bchip.pos{background:color-mix(in srgb,var(--accent) 16%,transparent);color:var(--accent-ink)}
.fcs .bchip.pos.deep{background:var(--b-bg);color:var(--b)}
.fcs .bchip.pos.unk{background:var(--chip);color:var(--ink-faint);font-weight:600}
.fcs .bchip.hard{background:var(--d-bg);color:var(--d)}
.fcs .bchip.open{background:var(--a-bg);color:var(--a)}
.fcs .more{align-self:flex-start;font:inherit;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--accent-ink);background:none;border:0;padding:0;cursor:pointer}
.fcs .more:hover{text-decoration:underline}
.fcs .more:focus-visible{outline:2px solid var(--gold);outline-offset:2px;border-radius:3px}
.fcs .detail{border-top:1px dashed var(--line);padding-top:9px;display:flex;flex-direction:column;gap:8px}
.fcs .dgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(108px,1fr));gap:6px}
.fcs .dcell{background:var(--line-soft);border-radius:8px;padding:6px 8px}
.fcs .dcell .k{font-size:9.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--ink-faint)}
.fcs .dcell .v{font-size:12.5px;font-weight:750;color:var(--ink);font-variant-numeric:tabular-nums}
.fcs .drow{font-size:12px;color:var(--ink-soft);line-height:1.45}
.fcs .drow b{color:var(--ink);font-weight:750}
.fcs .quote{border-left:3px solid var(--d);background:var(--d-bg);border-radius:0 8px 8px 0;padding:8px 11px;font-size:12px;color:var(--ink);line-height:1.45}
.fcs .quote .k{display:block;font-size:9.5px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:var(--d);margin-bottom:2px}
.fcs .fhint{font-size:11.5px;color:var(--ink-faint);flex-basis:100%;margin-top:2px}
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
/* product tabs */
.fcs .tabs{display:flex;flex-wrap:wrap;gap:4px;margin:18px 0 0;border-bottom:2px solid var(--line)}
.fcs .tab{font:inherit;font-size:13.5px;font-weight:700;color:var(--ink-soft);background:none;border:0;border-bottom:3px solid transparent;padding:9px 14px;cursor:pointer;margin-bottom:-2px;border-radius:8px 8px 0 0}
.fcs .tab:hover{color:var(--ink);background:var(--line-soft)}
.fcs .tab[aria-selected="true"]{color:var(--accent-ink);border-bottom-color:var(--accent)}
.fcs .tab:focus-visible{outline:2px solid var(--gold);outline-offset:-2px}
.fcs .vocab{font-size:12px;color:var(--ink-faint);margin:12px 0 0;max-width:86ch}
/* per-product reference blocks */
.fcs .guide{display:inline-block;font-size:10.5px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:var(--gold);border:1px solid var(--gold);border-radius:6px;padding:2px 7px;margin-bottom:9px}
.fcs .reqnote{font-size:12.5px;color:var(--ink-soft);margin:0 0 12px;max-width:86ch;line-height:1.5}
.fcs .checkbox{border:1px solid var(--line);border-radius:var(--radius);background:var(--panel);box-shadow:var(--shadow);overflow:hidden}
.fcs .checkbox .chead{display:flex;align-items:center;gap:10px;padding:11px 14px;border-bottom:1px solid var(--line);background:var(--line-soft);flex-wrap:wrap}
.fcs .checkbox .chead .t{font-size:13px;font-weight:800}
.fcs .checkbox .chead .s{font-size:11.5px;color:var(--ink-faint)}
.fcs .copy{margin-left:auto;font:inherit;font-size:11.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#fff;background:var(--accent);border:0;border-radius:8px;padding:6px 12px;cursor:pointer}
.dark .fcs .copy{color:#08131c}
.fcs .copy:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
.fcs .checkbox pre{margin:0;padding:14px;font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:12px;line-height:1.6;color:var(--ink);white-space:pre-wrap}
/* apply-once marketplaces */
.fcs .mkt{display:flex;flex-direction:column;gap:5px;padding:14px 18px;border-bottom:1px solid var(--line-soft)}
.fcs .mkt:last-child{border-bottom:0}
.fcs .mkt .mnm{font-weight:800;font-size:15px}
.fcs .mkt .mln{font-size:12.5px;color:var(--ink-soft);line-height:1.45}
.fcs .mkt .mln b{color:var(--ink)}
.fcs .mkt a{font-family:ui-monospace,Menlo,monospace;font-size:12px;word-break:break-all}
/* per-product funder rows */
.fcs .grouphead{font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-faint);margin:20px 0 9px}
.fcs .frows{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px}
.fcs .frow{border:1px solid var(--line);border-radius:var(--radius);background:var(--panel);box-shadow:var(--shadow);padding:13px 15px;display:flex;flex-direction:column;gap:7px}
.fcs .frow .fhead{display:flex;align-items:baseline;justify-content:space-between;gap:9px;flex-wrap:wrap}
.fcs .frow .fnm{font-weight:750;font-size:15px}
.fcs .path{font-size:12.5px;color:var(--ink-soft);line-height:1.45;word-break:break-word}
.fcs .path b{color:var(--ink);font-weight:750}
.fcs .nocrit{font-size:12.5px;color:var(--c);background:var(--c-bg);border-radius:8px;padding:7px 10px;line-height:1.45}
.dark .fcs .nocrit{color:var(--c)}
.fcs .bchip.warn{background:var(--c-bg);color:var(--c)}
.fcs .bchip.off{background:var(--chip);color:var(--ink-faint);font-weight:600}
.fcs .loadnote{padding:26px;text-align:center;color:var(--ink-faint);border:1px dashed var(--line);border-radius:var(--radius)}
/* who to call */
.fcs .contact{border-top:1px dashed var(--line);padding-top:9px;display:flex;flex-direction:column;gap:9px}
.fcs .cgroup .ck{font-size:9.5px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:var(--ink-faint);margin-bottom:3px}
.fcs .cline{font-size:12.5px;color:var(--ink);line-height:1.5;display:flex;flex-wrap:wrap;align-items:baseline;gap:6px}
.fcs .cline .who{font-weight:750}
.fcs .cline .lbl{color:var(--ink-faint);font-size:11.5px;min-width:52px}
.fcs .cnone{font-size:12px;color:var(--ink-faint);font-style:italic}
.fcs .cunk{font-size:12px;font-weight:700;color:var(--c)}
.fcs a.cmail,.fcs a.cphone{font-family:ui-monospace,Menlo,monospace;font-size:12px;word-break:break-all}
.fcs .cmini{font:inherit;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--chip-ink);background:var(--chip);border:0;border-radius:5px;padding:2px 6px;cursor:pointer;flex-shrink:0}
.fcs .cmini:hover{background:color-mix(in srgb,var(--accent) 20%,transparent);color:var(--accent-ink)}
.fcs .cmini:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
.fcs .cperson{border-left:2px solid var(--line);padding-left:9px;margin-top:6px}
.fcs .cnote{border-left:3px solid var(--b);background:var(--b-bg);border-radius:0 8px 8px 0;padding:8px 11px;font-size:11.5px;color:var(--ink);line-height:1.5;white-space:pre-wrap;max-height:190px;overflow:auto}
.fcs .cnote .k{display:block;font-size:9.5px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:var(--b);margin-bottom:3px}
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
  // Underwriting box extracted from the funder's own packets / decline emails.
  // Absent on most rows — read it only through the @/lib/funderCriteria helpers.
  criteria?: FunderCriteria | null;
};

// Reach-someone fields. Every one of them is sparsely populated across the 125
// funders (95 have a phone, 58 an email, 42 a name, 42 a `contacts` array), so
// the contact block is built for the SPARSE row and states the gaps in words.
export type ContactFields = {
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  primary_contact_phone: string | null;
  contacts: ContactPerson[] | null;
  submission_email: string | null;
  website: string | null;
  notes: string | null;
};
type ContactPerson = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
};

type LenderRow = ContactFields & {
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

// Max positions — the closer's first question on a stacked merchant. "2+" means
// the funder's published ceiling is at least a 2nd position (or they publish no
// cap at all); a funder whose box we haven't recorded never counts as a yes.
type PosFilter = "all" | "2" | "3" | "4" | "deep";
const POSITION_FILTERS: { v: PosFilter; label: string }[] = [
  { v: "all", label: "All" },
  { v: "2", label: "Accepts 2+" },
  { v: "3", label: "3+" },
  { v: "4", label: "4+" },
  { v: "deep", label: "Deep / no cap" },
];
const matchesPositions = (l: LenderRow, f: PosFilter): boolean => {
  if (f === "all") return true;
  if (f === "deep") return positionStance(l).deep;
  return acceptsPositions(l, Number(f));
};

// ── Who to call ──────────────────────────────────────────────────────────────
// Two different jobs, kept apart on purpose: the AE is who you CHASE, the
// submission address is where the DEAL GOES. A processor needs both and must
// never have to guess which is which.
//
// Everything here is sparse. A missing field always renders the words "not
// recorded" — a blank contact block reads as "this funder has no rep", and a
// processor who believes that stops calling.

// A US phone number inside free text. Used ONLY to make the digits tappable:
// the original string is rendered verbatim around the links, labels and all
// ("929-531-9989 (direct) · 646-491-1130 (cell)"), so a bad match can mislink
// but can never rewrite or hide what was recorded.
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g;
const telHref = (s: string) => {
  const d = s.replace(/\D/g, "");
  return d.length === 11 && d.startsWith("1") ? `tel:+${d}` : d.length === 10 ? `tel:+1${d}` : `tel:${d}`;
};

function PhoneText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  PHONE_RE.lastIndex = 0;
  for (let m = PHONE_RE.exec(text); m !== null; m = PHONE_RE.exec(text)) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(
      <a className="cphone" href={telHref(m[0])} key={`${m.index}-${m[0]}`}>
        {m[0]}
      </a>,
    );
    last = m.index + m[0].length;
  }
  if (parts.length === 0) return <>{text}</>;
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function CopyMini({ value, what }: { value: string; what: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="cmini"
      aria-label={`Copy ${what}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          window.setTimeout(() => setDone(false), 1800);
        } catch {
          // Clipboard blocked. Say nothing false — the address is on screen.
          setDone(false);
        }
      }}
    >
      {done ? "✓" : "copy"}
    </button>
  );
}

function MailLine({ label, email }: { label: string; email: string }) {
  return (
    <div className="cline">
      <span className="lbl">{label}</span>
      <a className="cmail" href={`mailto:${email}`}>
        {email}
      </a>
      <CopyMini value={email} what={`${label} address`} />
    </div>
  );
}

const clean = (s: string | null | undefined) => {
  const t = (s ?? "").trim();
  return t === "" ? null : t;
};
// Prose in `lenders.notes` / the submission profile's `internal_notes` carries
// real contact detail ("Francine Grimaldi (Account Manager) - Direct
// 929-531-9989, Cell 646-491-1130"). It is QUOTED, never parsed into fields: a
// wrong phone number is worse than a sentence someone has to read.
const mentionsContact = (s: string | null) => !!s && (s.includes("@") || /\d{3}[).\-\s]?\d{3}[.\-\s]?\d{4}/.test(s));

function ContactBlock({
  l,
  profile,
  profilesReadable,
}: {
  l: ContactFields & { company_name: string };
  profile: ProfileRow | undefined;
  profilesReadable: boolean;
}) {
  const name = clean(l.primary_contact_name);
  const email = clean(l.primary_contact_email);
  const phone = clean(l.primary_contact_phone);
  const site = clean(l.website);
  const people = (l.contacts ?? []).filter((p) => clean(p?.name) || clean(p?.email) || clean(p?.phone));
  // The primary rep is usually repeated inside `contacts` — don't print them twice.
  const others = people.filter((p) => !email || clean(p.email)?.toLowerCase() !== email.toLowerCase());

  const subTo = clean(profile?.to_email);
  const subCc = (profile?.cc_emails ?? []).map(clean).filter((x): x is string => !!x);
  const subPortal = clean(profile?.portal_url);
  const catalogSub = clean(l.submission_email);

  const profNote = clean(profile?.internal_notes);
  const lenderNote = clean(l.notes);
  const notes: { k: string; v: string }[] = [];
  if (mentionsContact(profNote)) notes.push({ k: "From the submission profile's notes", v: profNote as string });
  if (mentionsContact(lenderNote)) notes.push({ k: "From the funder record's notes", v: lenderNote as string });

  return (
    <div className="contact">
      <div className="cgroup">
        <div className="ck">Who to chase — the rep</div>
        {name ? <div className="cline"><span className="who">{name}</span></div> : <div className="cnone">Name not recorded.</div>}
        {email ? <MailLine label="Email" email={email} /> : <div className="cnone">Email not recorded.</div>}
        {phone ? (
          <div className="cline">
            <span className="lbl">Phone</span>
            <span>
              <PhoneText text={phone} />
            </span>
            <CopyMini value={phone} what="phone number" />
          </div>
        ) : (
          <div className="cnone">Phone not recorded.</div>
        )}
      </div>

      <div className="cgroup">
        <div className="ck">Other people on file</div>
        {others.length === 0 ? (
          <div className="cnone">No other contacts recorded for this funder.</div>
        ) : (
          others.map((p, i) => (
            <div className="cperson" key={`${clean(p.email) ?? clean(p.phone) ?? i}`}>
              <div className="cline">
                <span className="who">{clean(p.name) ?? "Name not recorded"}</span>
                {clean(p.title) && <span className="lbl">{clean(p.title)}</span>}
              </div>
              {clean(p.email) && <MailLine label="Email" email={clean(p.email) as string} />}
              {clean(p.phone) && (
                <div className="cline">
                  <span className="lbl">Phone</span>
                  <span>
                    <PhoneText text={clean(p.phone) as string} />
                  </span>
                  <CopyMini value={clean(p.phone) as string} what="phone number" />
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div className="cgroup">
        <div className="ck">Where the deal goes — submission</div>
        {!profilesReadable ? (
          <>
            <div className="cunk">
              Submission recipe UNKNOWN — the profile table came back empty or unreadable for your account. Not
              "no address": ask Ops before sending anything.
            </div>
            {catalogSub && <MailLine label="Catalog" email={catalogSub} />}
          </>
        ) : subTo || subPortal || catalogSub ? (
          <>
            {subTo && <MailLine label="Deals to" email={subTo} />}
            {subCc.map((cc) => (
              <MailLine key={cc} label="CC" email={cc} />
            ))}
            {subPortal && (
              <div className="cline">
                <span className="lbl">Portal</span>
                <a className="cmail" href={subPortal} target="_blank" rel="noreferrer">
                  {subPortal}
                </a>
              </div>
            )}
            {!subTo && !subPortal && catalogSub && (
              <>
                <MailLine label="Catalog" email={catalogSub} />
                <div className="cnone">
                  From the funder record, not from a send recipe — no submission profile is set up for this funder.
                </div>
              </>
            )}
          </>
        ) : (
          <div className="cnone">No submission address or portal recorded for this funder.</div>
        )}
      </div>

      {notes.length > 0 && (
        <div className="cgroup">
          {notes.map((n) => (
            <div className="cnote" key={n.k}>
              <span className="k">{n.k} — quoted, not parsed into fields</span>
              {n.v}
            </div>
          ))}
        </div>
      )}

      <div className="cgroup">
        {site ? (
          <div className="cline">
            <span className="lbl">Website</span>
            <a className="cmail" href={site} target="_blank" rel="noreferrer">
              {site}
            </a>
          </div>
        ) : (
          <div className="cnone">Website not recorded.</div>
        )}
      </div>
    </div>
  );
}

// ── Product tabs ─────────────────────────────────────────────────────────────
// MCA is the working product and keeps the whole original page. The four credit
// products get their own tab, sourced from lenders.lender_types.
//
// TWO THINGS ARE DELIBERATE HERE AND MUST STAY THAT WAY:
//  1. `lender_programs` holds 112 rows and every one of them is product_type
//     'mca'. There is NO recorded term-loan / LOC / SBA / equipment credit box
//     for any funder, and `category.criteria` on a lender row was extracted from
//     MCA packets and decline emails — quoting it on a loan tab would relabel an
//     MCA box as a term-loan box. So these tabs say in words that we have not
//     recorded the funder's criteria, and never render a blank cell that could
//     be read as "no requirement".
//  2. Vocabulary. An MCA is a purchase of future receivables and is never a
//     loan. Term loans, lines of credit, SBA and equipment financing ARE credit,
//     so they use ordinary lending language. Neither vocabulary leaks.
type ProductId = "mca" | "term_loan" | "line_of_credit" | "sba" | "equipment";
const PRODUCT_TABS: { v: ProductId; label: string }[] = [
  { v: "mca", label: "MCA" },
  { v: "term_loan", label: "Term Loan" },
  { v: "line_of_credit", label: "Line of Credit" },
  { v: "sba", label: "SBA" },
  { v: "equipment", label: "Equipment" },
];
const CREDIT_PRODUCTS: Exclude<ProductId, "mca">[] = ["term_loan", "line_of_credit", "sba", "equipment"];

type ReqRow = { k: string; v: string; strong?: boolean };
type ProductSpec = {
  label: string;
  blurb: string;
  // General industry guidance — orientation for a phone call. NOT any named
  // funder's credit box; a processor must never quote it as one.
  requirements: ReqRow[] | null;
  checklist: string | null;
};

const PRODUCT_SPEC: Record<Exclude<ProductId, "mca">, ProductSpec> = {
  term_loan: {
    label: "Term loan",
    blurb:
      "A fixed amount of credit repaid on a set schedule. Slower than an advance and priced on credit quality, so it wants a cleaner file: real time in business, a real credit score, and financial statements.",
    requirements: [
      { k: "Time in business", v: "2+ years" },
      { k: "Credit", v: "650+" },
      { k: "Bank statements", v: "3–6 months" },
      { k: "Business tax returns", v: "1–2 years" },
      { k: "Personal tax returns", v: "Sometimes — lender by lender" },
      { k: "P&L + balance sheet", v: "Year-to-date plus prior year" },
      { k: "Business debt schedule", v: "Yes" },
      { k: "Personal financial statement", v: "Sometimes — lender by lender" },
      { k: "Collateral documentation", v: "Sometimes — if anything is pledged" },
      { k: "Time to close", v: "1–2 weeks", strong: true },
    ],
    checklist: `To put together your term loan offers, please send over:

• Last 3–6 months of business bank statements (every page, PDF)
• Business tax returns — the last 1–2 years, complete
• Year-to-date P&L and balance sheet, plus last year's
• Business debt schedule — who you owe, the balance, and the monthly payment
• Driver's license and a voided business check
• Personal tax returns (last 2 years) if the lender asks for them

Send whatever you have now — we can start the file and add the rest as it comes in.`,
  },
  line_of_credit: {
    label: "Line of credit",
    blurb:
      "Revolving credit the merchant draws on and repays as needed — pay interest only on what's drawn. Easier to qualify for than a term loan, lighter on paperwork, and the right answer when the need is recurring rather than one big purchase.",
    requirements: [
      { k: "Time in business", v: "1–2 years" },
      { k: "Credit", v: "600+" },
      { k: "Bank statements", v: "3–6 months" },
      { k: "Business tax returns", v: "Sometimes — lender by lender" },
      { k: "Personal tax returns", v: "Not typically required" },
      { k: "P&L + balance sheet", v: "Sometimes — lender by lender" },
      { k: "Business debt schedule", v: "Yes" },
      { k: "Personal financial statement", v: "Not typically required" },
      { k: "Collateral documentation", v: "Not typically required" },
      { k: "Time to close", v: "1–2 weeks", strong: true },
    ],
    checklist: `To get your line of credit approved, please send over:

• Last 3–6 months of business bank statements (every page, PDF)
• Business debt schedule — who you owe, the balance, and the monthly payment
• Year-to-date P&L and balance sheet if you have them
• Most recent business tax return, if the lender asks for it
• Driver's license and a voided business check

Send whatever you have now — we can start the file and add the rest as it comes in.`,
  },
  sba: {
    label: "SBA loan",
    blurb:
      "The cheapest money on the shelf and the longest road to it — 30 to 90 days, with a document list that is an order of magnitude longer than anything else here. Worth starting only when the merchant can wait and the file is clean.",
    requirements: [
      { k: "Time in business", v: "2+ years" },
      { k: "Credit", v: "680+" },
      { k: "Bank statements", v: "3–6 months" },
      { k: "Business tax returns", v: "3 years", strong: true },
      { k: "Personal tax returns", v: "3 years — every 20%+ owner", strong: true },
      { k: "P&L + balance sheet", v: "Yes — YTD plus prior year-ends" },
      { k: "Business debt schedule", v: "Yes" },
      { k: "Personal financial statement", v: "Yes — SBA Form 413", strong: true },
      { k: "Use of proceeds", v: "Itemized, by dollar amount", strong: true },
      { k: "Collateral documentation", v: "Usually" },
      { k: "Time to close", v: "30–90 days", strong: true },
    ],
    checklist: `An SBA loan is the cheapest money available, and it takes 30–90 days. The sooner these come back, the sooner the clock starts:

• Last 3–6 months of business bank statements (every page, PDF)
• Business tax returns — last 3 years, complete with all schedules
• Personal tax returns — last 3 years, for every owner with 20% or more
• Year-to-date P&L and balance sheet, plus the last 2 year-ends
• Business debt schedule — who you owe, the balance, and the monthly payment
• Personal financial statement — SBA Form 413 (we'll send you the form)
• Itemized use of proceeds — exactly what the money is for, by dollar amount
• Business licenses, entity documents, and your lease if you rent
• Collateral documentation if you're pledging property or equipment
• Driver's license and a voided business check

Send whatever you have now — we can start the file and add the rest as it comes in.`,
  },
  equipment: {
    // Nothing recorded and nothing invented. The requirements table the owner
    // signed off on covers term / LOC / SBA only; equipment gets an explicit
    // "not recorded yet" instead of a plausible-looking guess.
    label: "Equipment financing",
    blurb:
      "Credit secured by the equipment itself. We have funders who route equipment deals today, but no requirement set has been recorded for this product yet.",
    requirements: null,
    checklist: null,
  },
};

const STATUS_LABEL: Record<string, string> = {
  live_vendor: "Live vendor",
  application_submitted: "ISO app submitted",
  potential: "Prospect",
  inactive: "Inactive",
};

// Apply-once marketplaces — one application routed to many lenders. This is the
// fastest path to a first submission on any of these products today, so it sits
// at the top of the tab rather than inside a funder row.
const MARKETPLACES: {
  name: string;
  url: string;
  products: Exclude<ProductId, "mca">[];
  lines: { k: string; v: string }[];
}[] = [
  {
    name: "1 West",
    url: "https://apply.1west.com/?iso=a10PZ00000socCfYAI",
    products: ["term_loan", "line_of_credit", "sba", "equipment"],
    lines: [
      { k: "Relationship", v: "Signed referral agreement. We refer, 1 West runs it through its lender network." },
      { k: "ISO code", v: "a10PZ00000socCfYAI — baked into the link, it identifies Momentum Funding." },
      {
        k: "The other route",
        v: "Our closers' primary path is still email: packaged application + last 4 months of business bank statements to partnersubs@1west.com.",
      },
      { k: "Compensation", v: "50% of 1 West compensation, new and renewal. Never charge the merchant a fee." },
    ],
  },
  {
    name: "ROK Financial",
    url: "https://www.rok.biz/partner-multistep-apply",
    products: ["term_loan", "line_of_credit", "sba", "equipment"],
    lines: [
      {
        k: "Relationship",
        v: "Referral. ROK runs the full application and underwriting and funds through its own sources.",
      },
      { k: "Compensation", v: "20% of ROK upfront revenue. Never charge the merchant a fee." },
      { k: "Careful", v: "Non-circumvention applies once ROK funds a client." },
    ],
  },
];

type ProductLenderRow = ContactFields & {
  id: string;
  company_name: string;
  status: string | null;
  lender_types: string[] | null;
  min_funding_amount: number | string | null;
  max_funding_amount: number | string | null;
};
type ProfileRow = {
  lender_id: string;
  method: string | null;
  to_email: string | null;
  cc_emails: string[] | null;
  portal_url: string | null;
  required_stips: string[] | null;
  active: boolean | null;
  special_instructions: string | null;
  internal_notes: string | null;
};
type ProfileState = {
  map: Record<string, ProfileRow>;
  // FALSE means UNREADABLE — never "no profile exists".
  readable: boolean;
  error: string | null;
};

const PROFILE_COLS =
  "lender_id, method, to_email, cc_emails, portal_url, required_stips, active, special_instructions, internal_notes";

// One read of the submission recipes, shared by every tab. Both failure modes
// collapse to `readable: false`, because a setter (role `closer`) is not on the
// RLS policy for funder_submission_profiles and gets zero rows with NO error —
// "none recorded" and "you may not read these" are indistinguishable from here.
// Merging keeps the pessimistic side: once any read came back unreadable, the
// page keeps saying so rather than letting a later partial read imply coverage.
function mergeProfiles(prev: ProfileState, next: ProfileState): ProfileState {
  return {
    map: { ...prev.map, ...next.map },
    readable: prev.readable && next.readable,
    error: prev.error ?? next.error,
  };
}

async function loadProfiles(ids: string[]): Promise<ProfileState> {
  if (ids.length === 0) return { map: {}, readable: true, error: null };
  const { data, error } = await supabase.from("funder_submission_profiles").select(PROFILE_COLS).in("lender_id", ids);
  if (error) {
    return {
      map: {},
      readable: false,
      error: `Submission addresses and recipes could not be read — ${error.message}. This is a READ FAILURE: every submission contact below is UNKNOWN, not absent.`,
    };
  }
  const rows = (data ?? []) as ProfileRow[];
  if (rows.length === 0) {
    return {
      map: {},
      readable: false,
      error:
        "No submission profile came back for any funder. Either none is recorded or your role can't read them — Ops can see these, a setter account cannot. Treat every submission address below as UNKNOWN, not as absent, and confirm with Ops before sending a deal anywhere.",
    };
  }
  const map: Record<string, ProfileRow> = {};
  for (const r of rows) map[r.lender_id] = r;
  return { map, readable: true, error: null };
}
type ProductData = {
  state: "idle" | "loading" | "ready" | "error";
  rows: ProductLenderRow[];
  error: string | null;
};

const PROD_SIZE = (l: ProductLenderRow) => {
  const lo = fmtMoney(num(l.min_funding_amount));
  const hi = fmtMoney(num(l.max_funding_amount));
  if (lo && hi) return `${lo}–${hi}`;
  if (hi) return `up to ${hi}`;
  if (lo) return `${lo}+`;
  return null;
};

function CopyBlock({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      // Clipboard blocked (insecure context / permission). Don't lie about it —
      // and never pop a dialog. The text is already on screen to select by hand.
      setCopied(false);
    }
  };
  return (
    <div className="checkbox">
      <div className="chead">
        <span className="t">{label}</span>
        <span className="s">paste straight into an email or text to the merchant</span>
        <button type="button" className="copy" onClick={copy}>
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
      <pre>{text}</pre>
    </div>
  );
}

// One funder on a credit-product tab. The whole point of this card is the
// submission path and an honest statement about what we do NOT know.
function ProductFunderRow({
  l,
  product,
  profile,
  profilesReadable,
}: {
  l: ProductLenderRow;
  product: Exclude<ProductId, "mca">;
  profile: ProfileRow | undefined;
  profilesReadable: boolean;
}) {
  const [who, setWho] = useState(false);
  const [open, setOpen] = useState(false);
  const spec = PRODUCT_SPEC[product];
  const live = l.status === "live_vendor";
  const active = profile?.active === true;
  const path = profile?.method === "portal" ? profile.portal_url : (profile?.to_email ?? null);
  const canSubmit = live && active && !!path;
  const size = PROD_SIZE(l);
  const stips = (profile?.required_stips ?? []).filter(Boolean);

  return (
    <article className="frow">
      <div className="fhead">
        <span className="fnm">{l.company_name}</span>
        <span className="box">
          {!profilesReadable ? (
            <span className="bchip hard">submission path unreadable</span>
          ) : canSubmit ? (
            <span className="bchip open">submit today ✓</span>
          ) : live && active ? (
            <span className="bchip warn">live — no submission path on file</span>
          ) : (
            <span className="bchip off">not activated · {STATUS_LABEL[l.status ?? ""] ?? l.status ?? "unknown"}</span>
          )}
        </span>
      </div>

      {!profilesReadable ? (
        <div className="path">
          <b>How we submit:</b> could not be read — see the banner above. Do not read this as "no path on file."
        </div>
      ) : path ? (
        <div className="path">
          <b>How we submit:</b>{" "}
          {profile?.method === "portal" ? (
            <>
              portal —{" "}
              <a href={path} target="_blank" rel="noreferrer">
                {path}
              </a>
            </>
          ) : (
            <>email — {path}</>
          )}
        </div>
      ) : (
        <div className="path">
          <b>How we submit:</b> no submission address or portal recorded on this funder's profile yet.
        </div>
      )}

      {size && <div className="size mono">Catalog funding range {size} — recorded for the funder overall, not for {spec.label.toLowerCase()}</div>}

      <div className="nocrit">
        We have not recorded {l.company_name}'s {spec.label.toLowerCase()} criteria yet — nothing here is a published
        credit box. Confirm time in business, credit and documents with the rep before you quote anything to a merchant.
      </div>

      <button type="button" className="more" onClick={() => setWho((w) => !w)} aria-expanded={who}>
        {who ? "Hide who to call ↑" : "Who to call ↓"}
      </button>
      {who && <ContactBlock l={l} profile={profile} profilesReadable={profilesReadable} />}

      {(stips.length > 0 || profile?.special_instructions) && (
        <>
          <button type="button" className="more" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? "Hide what's on file ↑" : "What's on file for this funder ↓"}
          </button>
          {open && (
            <div className="detail">
              {stips.length > 0 && (
                <div className="drow">
                  <b>Submission packet on file:</b> {stips.join(" · ").replace(/_/g, " ")}{" "}
                  <span style={{ color: "var(--ink-faint)" }}>
                    — recorded for this funder's submissions generally, not for {spec.label.toLowerCase()}
                  </span>
                </div>
              )}
              {profile?.special_instructions && <div className="drow">{profile.special_instructions}</div>}
            </div>
          )}
        </>
      )}
    </article>
  );
}

function ProductTabView({
  product,
  data,
  profiles,
}: {
  product: Exclude<ProductId, "mca">;
  data: ProductData;
  profiles: ProfileState;
}) {
  const spec = PRODUCT_SPEC[product];
  const markets = MARKETPLACES.filter((m) => m.products.includes(product));
  const matching = useMemo(
    () =>
      data.rows
        .filter((r) => (r.lender_types ?? []).includes(product))
        .slice()
        .sort((a, b) => {
          const rank = (l: ProductLenderRow) => (l.status === "live_vendor" ? 0 : 1);
          const d = rank(a) - rank(b);
          return d !== 0 ? d : a.company_name.localeCompare(b.company_name);
        }),
    [data.rows, product],
  );
  const liveOnes = matching.filter((l) => l.status === "live_vendor");
  const restOnes = matching.filter((l) => l.status !== "live_vendor");

  return (
    <>
      <p className="vocab">
        A <b>{spec.label.toLowerCase()}</b> is credit, so ordinary lending language is correct here. That vocabulary
        stops at this tab: an MCA is a purchase of future receivables and is never called a loan.
      </p>

      {/* APPLY ONCE — fastest path to a first submission */}
      {markets.length > 0 && (
        <section aria-labelledby={`mkt-${product}`}>
          <div className="callout">
            <div className="band">
              <h2 id={`mkt-${product}`}>⚡ Apply once — the fastest submission you can make today</h2>
              <p>
                These partners take <b>one application</b> and route it across their whole lender network for term
                loans, lines of credit, SBA and equipment. If the merchant is on the phone now, this is the move — no
                funder shortlist required.
              </p>
            </div>
            {markets.map((m) => (
              <div className="mkt" key={m.name}>
                <div className="mnm">{m.name}</div>
                <a href={m.url} target="_blank" rel="noreferrer">
                  {m.url}
                </a>
                {m.lines.map((ln) => (
                  <div className="mln" key={ln.k}>
                    <b>{ln.k}:</b> {ln.v}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* WHAT THE PRODUCT NEEDS */}
      <section aria-labelledby={`req-${product}`}>
        <div className="sec-head">
          <h2 id={`req-${product}`}>What a {spec.label.toLowerCase()} needs</h2>
          <span className="note">before you name a funder</span>
        </div>
        <p className="reqnote">{spec.blurb}</p>
        {spec.requirements ? (
          <>
            <span className="guide">General industry guidance — not any funder's credit box</span>
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>Requirement</th>
                    <th>What it takes</th>
                  </tr>
                </thead>
                <tbody>
                  {spec.requirements.map((r) => (
                    <tr key={r.k}>
                      <td>{r.k}</td>
                      <td>{r.strong ? <b>{r.v}</b> : r.v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="rule">
              <b>Use this to orient a phone call, never to quote a funder.</b> These are the typical industry numbers
              for the product — no funder on this page has agreed to them. The moment you name a funder, the only
              numbers that count are the ones that funder's rep gives you.
            </div>
          </>
        ) : (
          <div className="rule">
            <b>We have not recorded a requirement set for {spec.label.toLowerCase()} yet.</b> That is a gap in our
            notes, not a product without requirements — an equipment deal absolutely has a credit box. Route it through
            an apply-once partner above, or ask the funder's rep and get it written down.
          </div>
        )}
      </section>

      {/* MERCHANT CHECKLIST */}
      {spec.checklist && (
        <section aria-labelledby={`chk-${product}`}>
          <div className="sec-head">
            <h2 id={`chk-${product}`}>Send the merchant this list</h2>
            <span className="note">plain language, copy and paste</span>
          </div>
          <CopyBlock label={`${spec.label} — merchant document checklist`} text={spec.checklist} />
        </section>
      )}

      {/* WHO DOES IT */}
      <section aria-labelledby={`fnd-${product}`}>
        <div className="sec-head">
          <h2 id={`fnd-${product}`}>Who does {spec.label.toLowerCase()}s</h2>
          <span className="note">
            {data.state === "ready" ? `${matching.length} in the catalog · ${liveOnes.length} live` : "from the funder catalog"}
          </span>
        </div>

        {data.error && <div className="err">{data.error}</div>}
        {profiles.error && <div className="err">{profiles.error}</div>}

        {data.state === "loading" && <div className="loadnote">Reading the funder catalog…</div>}
        {data.state === "error" && (
          <div className="loadnote">
            Nothing is listed below because the read failed — <b>not</b> because no funder does this product.
          </div>
        )}

        {data.state === "ready" && matching.length === 0 && (
          <div className="empty">
            No funder in the catalog is tagged for {spec.label.toLowerCase()} yet. That is a tagging gap in the catalog
            — the apply-once partners above still route this product today.
          </div>
        )}

        {data.state === "ready" && liveOnes.length > 0 && (
          <>
            <div className="grouphead">Live vendors</div>
            <div className="frows">
              {liveOnes.map((l) => (
                <ProductFunderRow
                  key={l.id}
                  l={l}
                  product={product}
                  profile={profiles.map[l.id]}
                  profilesReadable={profiles.readable}
                />
              ))}
            </div>
          </>
        )}

        {data.state === "ready" && restOnes.length > 0 && (
          <>
            <div className="grouphead">In the network — not activated for submissions</div>
            <div className="frows">
              {restOnes.map((l) => (
                <ProductFunderRow
                  key={l.id}
                  l={l}
                  product={product}
                  profile={profiles.map[l.id]}
                  profilesReadable={profiles.readable}
                />
              ))}
            </div>
          </>
        )}
      </section>

      <footer>
        Funders on this tab come from <b>lenders.lender_types</b> in the funder catalog, so the list updates as funders
        are tagged · <b>no {spec.label.toLowerCase()} credit box has been recorded for any funder</b> — every criteria
        line on this page is general industry guidance, and a funder's real box comes from their rep · the requirement
        table is orientation for a phone call, never a quote to a merchant · internal working tool, not a
        merchant-facing document.
      </footer>
    </>
  );
}

export default function FunderCheatSheetPage() {
  const [lenders, setLenders] = useState<LenderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paper, setPaper] = useState<(typeof PAPER_FILTERS)[number]>("all");
  const [bucket, setBucket] = useState<"all" | BucketId>("all");
  const [positions, setPositions] = useState<PosFilter>("all");
  const [tab, setTab] = useState<ProductId>("mca");
  const [prod, setProd] = useState<ProductData>({ state: "idle", rows: [], error: null });
  // Submission recipes — the "where the deal goes" half of every contact block.
  // Shared by the MCA cards and the credit tabs; merged as each tab loads.
  const [profiles, setProfiles] = useState<ProfileState>({ map: {}, readable: true, error: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: err } = await supabase
        .from("lenders")
        .select(
          "id, company_name, min_funding_amount, max_funding_amount, category, primary_contact_name, primary_contact_email, primary_contact_phone, contacts, submission_email, website, notes",
        )
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
      const res = await loadProfiles(rows.map((r) => r.id));
      if (cancelled) return;
      setProfiles((prev) => mergeProfiles(prev, res));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Credit-product tabs load on first use, so the MCA tab's first paint is
  // exactly what it was. A failed read is reported loudly and NEVER collapses
  // into an empty list.
  useEffect(() => {
    if (tab === "mca" || prod.state !== "idle") return;
    let cancelled = false;
    setProd((p) => ({ ...p, state: "loading" }));
    (async () => {
      const { data, error: err } = await supabase
        .from("lenders")
        .select(
          "id, company_name, status, lender_types, min_funding_amount, max_funding_amount, primary_contact_name, primary_contact_email, primary_contact_phone, contacts, submission_email, website, notes",
        )
        .neq("status", "rejected")
        .overlaps("lender_types", CREDIT_PRODUCTS);
      if (cancelled) return;
      if (err) {
        setProd({
          state: "error",
          rows: [],
          error: `Could not read the funder catalog for the product tabs — ${err.message}. This is a READ FAILURE, not an empty network.`,
        });
        return;
      }
      const rows = (data ?? []) as ProductLenderRow[];
      setProd({ state: "ready", rows, error: null });
      const res = await loadProfiles(rows.map((r) => r.id));
      if (cancelled) return;
      setProfiles((prev) => mergeProfiles(prev, res));
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, prod.state]);

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
          (bucket === "all" || d.buckets.includes(bucket)) &&
          matchesPositions(d.l, positions),
      ),
    [decorated, paper, bucket, positions],
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
          {tab === "mca" ? (
            <p>
              Match the deal to the funder. Read the merchant's <b>paper grade</b>, check whether they're{" "}
              <b>stacked</b> (needs consolidation), then filter to the right shortlist. Covers the funders you work
              today — your <b>{loading ? "…" : `${lenders.length}`} live vendors</b> plus{" "}
              <b>active referral partners</b>.
            </p>
          ) : (
            <p>
              The merchant doesn't want an advance. Here's who does{" "}
              <b>{PRODUCT_SPEC[tab as Exclude<ProductId, "mca">].label.toLowerCase()}s</b>, what the product needs, and
              the fastest way to get a submission out today.
            </p>
          )}
        </header>

        <div className="tabs" role="tablist" aria-label="Funding product">
          {PRODUCT_TABS.map((t) => (
            <button
              key={t.v}
              type="button"
              role="tab"
              className="tab"
              aria-selected={tab === t.v}
              onClick={() => setTab(t.v)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab !== "mca" && (
          <ProductTabView product={tab as Exclude<ProductId, "mca">} data={prod} profiles={profiles} />
        )}

        {tab === "mca" && (
          <>
        {error && <div className="err">{error}</div>}
        {profiles.error && <div className="err">{profiles.error}</div>}

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
              <span className="flabel">Positions</span>
              {POSITION_FILTERS.map((p) => (
                <button
                  key={p.v}
                  type="button"
                  className="pill"
                  aria-pressed={positions === p.v}
                  onClick={() => setPositions(p.v)}
                >
                  {p.label}
                </button>
              ))}
              {positions !== "all" && (
                <span className="fhint">
                  Only funders with a published position box count — anyone whose ceiling we haven't recorded is hidden.
                </span>
              )}
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
              <FunderCard
                key={l.id}
                l={l}
                papers={papers}
                tags={tags}
                profile={profiles.map[l.id]}
                profilesReadable={profiles.readable}
              />
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
          updates as the network changes · position caps, floors and restrictions come from each funder's own packets
          and rate sheets; <b>decline signals are quoted from real decline emails</b> · a blank field means the funder
          never published it, not that there's no limit · buckets are directional — always confirm the current credit
          box and any consolidation product with the funder's rep · this is an internal working tool, not a
          merchant-facing document.
        </footer>
          </>
        )}
      </div>
    </div>
  );
}

// ── Live-funder card ─────────────────────────────────────────────────────────
// Compact face = name, paper, size, and the two criteria the closer screens on
// first: how deep a stack the funder takes, and whether defaults/collections are
// a hard stop. Everything else folds away (reference content folds; the box the
// closer acts on stays visible).
function FunderCard({
  l,
  papers,
  tags,
  profile,
  profilesReadable,
}: {
  l: LenderRow;
  papers: string[];
  tags: string[];
  profile: ProfileRow | undefined;
  profilesReadable: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState(false);
  const c = criteriaOf(l);
  const pos = positionStance(l);
  const ctone = collectionsTone(l);
  const clabel = collectionsLabel(ctone);

  const industries = listOf(c.restricted_industries);
  const states = listOf(c.restricted_states);
  const floors: { k: string; v: string }[] = [];
  const tib = fmtTib(c.min_tib_months);
  const rev = fmtRev(c.min_monthly_revenue);
  const fico = fmtFico(c.fico_floor);
  if (tib) floors.push({ k: "Time in biz", v: tib });
  if (rev) floors.push({ k: "Revenue", v: rev });
  if (fico) floors.push({ k: "FICO", v: fico });
  if (c.max_nsf_monthly != null) floors.push({ k: "NSF / mo", v: `max ${c.max_nsf_monthly}` });

  const hasDetail =
    floors.length > 0 ||
    industries.length > 0 ||
    states.length > 0 ||
    !!c.negative_days_policy ||
    !!c.funding_speed ||
    !!c.factor_range ||
    !!c.positions_note ||
    !!c.collections_policy ||
    !!c.decline_signal;

  return (
    <article className="card">
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

      {(pos.tone !== "na" || clabel) && (
        <div className="box">
          {pos.tone !== "na" && (
            <span
              className={`bchip pos${pos.tone === "deep" ? " deep" : pos.tone === "cap" ? "" : " unk"}`}
              title={c.positions_note ?? undefined}
            >
              {pos.label}
            </span>
          )}
          {clabel && (
            <span className={`bchip ${ctone}`} title={c.collections_policy ?? c.decline_signal ?? undefined}>
              {ctone === "hard" ? "🔴" : "🟢"} {clabel}
            </span>
          )}
        </div>
      )}

      {cat(l).known_for && <div className="known">{cat(l).known_for}</div>}
      {cat(l).deal_fit && <div className="fit">{cat(l).deal_fit}</div>}

      {hasDetail && (
        <button type="button" className="more" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "Hide the box ↑" : "The full box ↓"}
        </button>
      )}

      {open && hasDetail && (
        <div className="detail">
          {floors.length > 0 && (
            <div className="dgrid">
              {floors.map((f) => (
                <div className="dcell" key={f.k}>
                  <div className="k">{f.k}</div>
                  <div className="v">{f.v}</div>
                </div>
              ))}
            </div>
          )}
          {c.positions_note && (
            <div className="drow">
              <b>Positions:</b> {c.positions_note}
            </div>
          )}
          {c.negative_days_policy && (
            <div className="drow">
              <b>Negative days:</b> {c.negative_days_policy}
            </div>
          )}
          {c.collections_policy && (
            <div className="drow">
              <b>Collections / defaults:</b> {c.collections_policy}
            </div>
          )}
          {industries.length > 0 && (
            <div className="drow">
              <b>Restricted industries:</b> {industries.join(" · ")}
            </div>
          )}
          {states.length > 0 && (
            <div className="drow">
              <b>Restricted states:</b> {states.join(" · ")}
            </div>
          )}
          {(c.funding_speed || c.factor_range) && (
            <div className="drow">
              {c.funding_speed && (
                <>
                  <b>Speed:</b> {c.funding_speed}
                </>
              )}
              {c.funding_speed && c.factor_range && " · "}
              {c.factor_range && (
                <>
                  <b>Factor:</b> {c.factor_range}
                </>
              )}
            </div>
          )}
          {c.decline_signal && (
            <div className="quote">
              <span className="k">Decline signal — from a real decline email</span>
              {c.decline_signal}
            </div>
          )}
        </div>
      )}

      <button type="button" className="more" onClick={() => setWho((w) => !w)} aria-expanded={who}>
        {who ? "Hide who to call ↑" : "Who to call ↓"}
      </button>
      {who && <ContactBlock l={l} profile={profile} profilesReadable={profilesReadable} />}

      <div className="tags">
        {tags.map((t) => (
          <span className={tagClass(t)} key={t}>
            {t}
          </span>
        ))}
      </div>
    </article>
  );
}
