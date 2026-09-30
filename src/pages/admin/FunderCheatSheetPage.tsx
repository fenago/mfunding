import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import supabase from "@/supabase";
import {
  type ProductId as CanonicalProduct,
  PRODUCT_SOURCE_COLUMNS,
  hasProduct,
} from "@/lib/lenderProducts";
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
.fcs .warn{border:1.5px solid var(--c);background:var(--c-bg);color:var(--c);border-radius:var(--radius);padding:12px 15px;font-size:13px;font-weight:600;margin-bottom:16px}
.fcs .prog{border:1px solid var(--a);background:color-mix(in srgb,var(--a) 7%,transparent);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:8px}
.fcs .prog .ph{font-size:10px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:var(--a)}
.fcs .prog .pay{font-size:13.5px;font-weight:800;color:var(--ink)}
.fcs .prog .pay .n{color:var(--a)}
.fcs .prog ul{margin:0;padding-left:16px;display:flex;flex-direction:column;gap:5px}
.fcs .prog li{font-size:11.5px;color:var(--ink-soft);line-height:1.45}
.fcs .chips{display:flex;flex-wrap:wrap;gap:4px}
.fcs .chips .c{font-size:10.5px;font-weight:700;background:var(--chip);color:var(--chip-ink);border-radius:5px;padding:2px 7px}
/* submission links + portals */
.fcs .lrow{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px;font-size:12.5px;line-height:1.5}
.fcs .lrow .lk{font-size:11.5px;color:var(--ink-faint);min-width:74px}
.fcs .portal{background:var(--b-bg);border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:5px}
.fcs .portal .pt{font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--b)}
.fcs .cred{font-size:11.5px;color:var(--ink-soft);line-height:1.45}
.fcs .cred b{color:var(--ink)}
.fcs .credhold{font-size:11.5px;color:var(--c);background:var(--c-bg);border-radius:7px;padding:6px 9px;line-height:1.45}
.fcs .doclist{display:flex;flex-direction:column;gap:4px}
.fcs .docrow{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px;font-size:12px}
.fcs .docrow .dt{font-size:10px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--ink-faint);background:var(--chip);border-radius:5px;padding:2px 6px}
.fcs .docopen{font:inherit;font-size:10.5px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--accent-ink);background:none;border:0;padding:0;cursor:pointer;text-decoration:underline}
.fcs .docerr{font-size:11.5px;color:var(--d);font-weight:600}
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
  // Product list maintained by a different process than `lender_types` — read
  // BOTH, always through productsOf() in @/lib/lenderProducts.
  products?: string[] | null;
  known_for?: string | null;
  deal_fit?: string | null;
  // Underwriting box extracted from the funder's own packets / decline emails.
  // Absent on most rows — read it only through the @/lib/funderCriteria helpers.
  criteria?: FunderCriteria | null;
};

// Reach-someone fields. Every one of them is sparsely populated across the 125
// funders (95 have a phone, 58 an email, 42 a name, 42 a `contacts` array), so
// the contact block is built for the SPARSE row and states the gaps in words.
type ContactFields = {
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  primary_contact_phone: string | null;
  contacts: ContactPerson[] | null;
  submission_email: string | null;
  // The broker/ISO portal — where you LOG IN (rate sheets, marketing material,
  // sometimes submission). Not the same thing as a submission address.
  submission_portal_url: string | null;
  submission_notes: string | null;
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

// Prose in `lenders.notes` / the submission profile's `internal_notes` carries
// real contact detail ("Francine Grimaldi (Account Manager) - Direct
// 929-531-9989, Cell 646-491-1130"). It is QUOTED, never parsed into fields: a
// wrong phone number is worse than a sentence someone has to read.
const mentionsContact = (s: string | null) => !!s && (s.includes("@") || /\d{3}[).\-\s]?\d{3}[.\-\s]?\d{4}/.test(s));




const clean = (s: string | null | undefined) => {
  const t = (s ?? "").trim();
  return t === "" ? null : t;
};

// ── Never print a credential ─────────────────────────────────────────────────
// The free-text columns this page quotes are NOT a safe place to read from
// blind. `lenders.submission_notes` carries the live password for our own
// mailbox on three funders (IOU Financial, Lendini, Uplyft: the literal string
// "sales@send.mfunding.net / Descartes2!"), and this page is open to every
// setter. A note that looks like it contains a credential is withheld WHOLE —
// not partially redacted, because a partial redaction that misses is worse than
// no redaction at all, and a withheld note is recoverable by asking Ops.
//
// Two shapes catch it:
//   1. the word — password / pwd / un/pw / credentials / login:
//   2. an email followed by a separator and a token that is NOT a phone number,
//      an email or a URL — which is what "x@y.com / Descartes2!" is, and what
//      "team@mcashadvance.com / 855-433-8641" is not.
// `pw:` and `uid:` are here because of a real row: Guidant's `lenders.notes`
// holds a pasted partner-portal dump with "uid: <email>" and "pw: <secret>" on
// consecutive lines — a complete working pair that the first version of this
// guard sailed straight past, because it only knew the word "password".
const SECRET_WORD_RX =
  /\b(pass(word|wd)?|pwd|credentials?)\b|\b(un\s*\/\s*pw|u\s*\/\s*p)\b|\b(pw|uid|un|user(name)?|login)\s*[:=]/i;
const EMAIL_PAIR_RX = /[\w.+-]+@[\w.-]+\.[a-z]{2,}\s*[/:]\s*(\S+)/gi;
const TOKEN_IS_HARMLESS = (t: string) =>
  /^[\d()+.\-\s]{7,}$/.test(t) || t.includes("@") || /^https?:/i.test(t) || /^www\./i.test(t);

function looksLikeSecret(text: string | null | undefined): boolean {
  const t = (text ?? "").trim();
  if (t === "") return false;
  if (SECRET_WORD_RX.test(t)) return true;
  EMAIL_PAIR_RX.lastIndex = 0;
  for (let m = EMAIL_PAIR_RX.exec(t); m !== null; m = EMAIL_PAIR_RX.exec(t)) {
    if (!TOKEN_IS_HARMLESS(m[1])) return true;
  }
  return false;
}

// Every free-text quote on this page goes through here. Returns the text, or
// null plus the reason it is being withheld.
function safeQuote(text: string | null | undefined): { text: string | null; withheld: boolean } {
  const t = clean(text);
  if (!t) return { text: null, withheld: false };
  return looksLikeSecret(t) ? { text: null, withheld: true } : { text: t, withheld: false };
}

function Quoted({ label, text }: { label: string; text: string | null | undefined }) {
  const q = safeQuote(text);
  if (q.withheld) {
    return (
      <div className="credhold">
        {label} — <b>not shown.</b> This note contains what looks like a credential, and this page is open to every
        setter. Ops has it.
      </div>
    );
  }
  if (!q.text) return null;
  return (
    <div className="cnote">
      <span className="k">{label}</span>
      {q.text}
    </div>
  );
}

// ── What a link actually is ──────────────────────────────────────────────────
// A URL on a page headed "the fastest submission you can make today" reads as
// safe to send a merchant. For most of these URLs that is FALSE, and the risk
// is invisible — no identifier in the link means the merchant is a walk-in and
// the commission is gone. So every rendered URL is classified and labelled.
type LinkClass = "attributed" | "internal" | "unattributed";
const ATTRIBUTION_PARAM_RX = /[?&](iso|plid|ref|referral|partner|partnerid|aff|affiliate|agent|promo|pid|lid)=[^&]+/i;
// Our own account, not a merchant route: a portal/app/broker host, a broker
// path carrying our account id (Uplyft's daydreamos.com/broker/<uuid>), or an
// e-signature link, which is a document WE sign and never a merchant apply page.
const INTERNAL_HOST_RX =
  /\b(portal|app|broker|brokers|iso|dashboard|login|my|go)\.|mypartner\.io|\/dashboard|\/login|\/partner\/center|\/brokers?\/[0-9a-f-]{8,}|signnow\.com|docusign\.|boldsign\.|hellosign\.|adobesign\./i;

function classifyLink(url: string): LinkClass {
  if (ATTRIBUTION_PARAM_RX.test(url)) return "attributed";
  if (INTERNAL_HOST_RX.test(url)) return "internal";
  return "unattributed";
}

const LINK_CHIP: Record<LinkClass, { cls: string; label: string; title: string }> = {
  attributed: {
    cls: "bchip open",
    label: "carries our ID ✓",
    title: "This link identifies Momentum Funding. Safe to send a merchant.",
  },
  internal: {
    cls: "bchip",
    label: "we log in — never send",
    title: "Our own portal. Sending it to a merchant does nothing useful.",
  },
  unattributed: {
    cls: "bchip warn",
    label: "⚠ no ID — we are not credited",
    title:
      "This URL carries nothing that identifies Momentum Funding. If a merchant applies through it they are a walk-in and the commission is gone. Check how attribution actually works for this funder before sending it to anyone.",
  },
};

function LinkLine({ label, url }: { label: string; url: string }) {
  const k = classifyLink(url);
  const chip = LINK_CHIP[k];
  return (
    <div className="lrow">
      <span className="lk">{label}</span>
      <a className="cmail" href={url} target="_blank" rel="noreferrer">
        {url}
      </a>
      <span className={chip.cls} title={chip.title}>
        {chip.label}
      </span>
    </div>
  );
}

// ── A recorded credit box, when one exists ───────────────────────────────────
// `lender_programs` rows are loaded from a funder's own signed packet. Most
// funders have none for these products; a funder WITHOUT a row keeps the
// "we have not recorded this" wording, because the distinction between
// "recorded" and "not recorded" is the whole safety property of these tabs.
//
// Commission NEVER renders alone. `points_max` without its qualifier overstates
// the economics — UCS's line of credit pays "1–3% of the INITIAL DRAW", which
// on a $250K line drawn at $50K is a different number than it looks. The
// qualifier lives in `important_details` and is always printed with the number.
type ProgramRow = {
  id: string;
  lender_id: string;
  product_type: string | null;
  points_min: number | string | null;
  points_max: number | string | null;
  important_details: string[] | null;
  required_documents: string[] | null;
  approval_min: number | string | null;
  approval_max: number | string | null;
  term_text: string | null;
  min_credit_score: number | null;
  monthly_revenue_required: number | string | null;
  annual_revenue_required: number | string | null;
  time_in_business_months: number | null;
  cost_of_capital: string | null;
  time_to_approve: string | null;
  payment_frequency: string | null;
  doc_bank_statement_months: number | null;
  doc_tax_returns: { business_years?: number | null; personal_years?: number | null } | null;
  doc_financials_threshold: number | string | null;
  doc_extras: string[] | null;
  doc_conditions: string | null;
  doc_other: string | null;
  industries_note: string | null;
  notes: string | null;
};
type ProgramState = { byKey: Record<string, ProgramRow>; readable: boolean };

const progKey = (lenderId: string, product: string) => `${lenderId}::${product}`;

const fmtMonths = (m: number | null) => {
  if (m == null) return null;
  if (m % 12 === 0 && m >= 12) return `${m / 12} yr${m === 12 ? "" : "s"}`;
  return `${m} mo`;
};
const fmtPts = (lo: number | string | null, hi: number | string | null) => {
  const a = num(lo);
  const b = num(hi);
  if (a != null && b != null) return a === b ? `${b}%` : `${a}–${b}%`;
  if (b != null) return `up to ${b}%`;
  if (a != null) return `${a}%+`;
  return null;
};
const prettyExtra = (x: string) => x.replace(/_/g, " ");

function ProgramBox({ p, productLabel }: { p: ProgramRow; productLabel: string }) {
  const cells: { k: string; v: string }[] = [];
  const lo = fmtMoney(num(p.approval_min));
  const hi = fmtMoney(num(p.approval_max));
  if (lo || hi) cells.push({ k: "Amount", v: lo && hi ? `${lo}–${hi}` : (hi ?? `${lo}+`) });
  const tib = fmtMonths(p.time_in_business_months);
  if (tib) cells.push({ k: "Time in biz", v: tib });
  if (p.min_credit_score != null) cells.push({ k: "FICO", v: `${p.min_credit_score}+` });
  const mrev = fmtMoney(num(p.monthly_revenue_required));
  const arev = fmtMoney(num(p.annual_revenue_required));
  if (mrev) cells.push({ k: "Revenue / mo", v: mrev });
  else if (arev) cells.push({ k: "Revenue / yr", v: arev });
  if (p.term_text) cells.push({ k: "Term", v: p.term_text });
  if (p.cost_of_capital) cells.push({ k: "Cost", v: p.cost_of_capital });
  if (p.time_to_approve) cells.push({ k: "Decision", v: p.time_to_approve });
  if (p.payment_frequency) cells.push({ k: "Payments", v: p.payment_frequency });

  const docs: string[] = [];
  if (p.doc_bank_statement_months != null) docs.push(`${p.doc_bank_statement_months} mo bank statements`);
  const tr = p.doc_tax_returns;
  if (tr?.business_years != null) docs.push(`business tax returns ${tr.business_years} yr`);
  if (tr?.personal_years != null) docs.push(`personal tax returns ${tr.personal_years} yr`);
  const thr = fmtMoney(num(p.doc_financials_threshold));
  if (thr) docs.push(`P&L + balance sheet over ${thr}`);
  for (const x of p.doc_extras ?? []) docs.push(prettyExtra(x));
  for (const x of p.required_documents ?? []) docs.push(prettyExtra(x));

  const pts = fmtPts(p.points_min, p.points_max);
  const details = (p.important_details ?? []).filter(Boolean);

  return (
    <div className="prog">
      <div className="ph">Recorded {productLabel.toLowerCase()} box — from this funder's own packet</div>
      {pts && (
        <div className="pay">
          We get paid <span className="n">{pts}</span>
          {details.length === 0 && (
            <span style={{ fontWeight: 600, color: "var(--c)" }}>
              {" "}
              — qualifier not recorded, confirm before quoting
            </span>
          )}
        </div>
      )}
      {cells.length > 0 && (
        <div className="dgrid">
          {cells.map((c) => (
            <div className="dcell" key={c.k}>
              <div className="k">{c.k}</div>
              <div className="v">{c.v}</div>
            </div>
          ))}
        </div>
      )}
      {docs.length > 0 && (
        <div>
          <div className="ph" style={{ marginBottom: 4 }}>Documents</div>
          <div className="chips">
            {docs.map((d) => (
              <span className="c" key={d}>
                {d}
              </span>
            ))}
          </div>
        </div>
      )}
      {p.doc_conditions && <div className="drow">{p.doc_conditions}</div>}
      {p.doc_other && <div className="drow">{p.doc_other}</div>}
      {p.industries_note && (
        <div className="drow">
          <b>Industries:</b> {p.industries_note}
        </div>
      )}
      {details.length > 0 && (
        <ul>
          {details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
      {p.notes && <div className="drow">{p.notes}</div>}
    </div>
  );
}

// ── Submission links, partner portals, marketing material ────────────────────
// Three different things that a single "link" column would flatten into one:
//   • the submission ROUTE  — where a deal goes (profile to_email / portal_url)
//   • the partner PORTAL    — where you log in for rate sheets and material
//   • the material ITSELF   — what we already hold in lender-documents
// A processor needs to tell them apart without guessing.

type LenderDoc = {
  id: string;
  lender_id: string;
  document_type: string | null;
  filename: string | null;
  storage_path: string | null;
  description: string | null;
};
type DocState = {
  byLender: Record<string, LenderDoc[]>;
  // FALSE means UNREADABLE — `lender_documents` is admin/super-admin only, so a
  // setter reads zero rows with NO error. Same trap as the submission profiles.
  readable: boolean;
};

const DOC_TYPE_LABEL: Record<string, string> = {
  rate_sheet: "rate sheet",
  agreement: "agreement",
  terms: "guidelines",
  other: "material",
};

// A credential hint is meant to say WHERE the credentials live, not to be one.
// Anything that doesn't look like a labelled hint is withheld rather than
// printed on a page setters can open — a bare two-word string is as likely to
// be a passphrase as a note, and there is no upside to guessing right.
const CREDENTIAL_LOOKS_LABELLED = /@|https?:|\b(login|user|username|reset|sso|portal|ask|set via|not stored|invite)\b/i;

function LinksBlock({
  l,
  profile,
  profilesReadable,
  docs,
}: {
  l: ContactFields & { id: string; company_name: string };
  profile: ProfileRow | undefined;
  profilesReadable: boolean;
  docs: DocState;
}) {
  const [docErr, setDocErr] = useState<string | null>(null);
  const brokerPortal = clean(l.submission_portal_url);
  const profilePortal = clean(profile?.portal_url);
  const subNotes = clean(l.submission_notes);
  const hint = clean(profile?.portal_credentials_hint);
  const hintSafe = !!hint && CREDENTIAL_LOOKS_LABELLED.test(hint);
  const mine = docs.byLender[l.id] ?? [];
  // Same URL recorded in both columns is one portal, not two.
  const sameUrl = brokerPortal && profilePortal && brokerPortal.trim() === profilePortal.trim();

  const open = async (d: LenderDoc) => {
    setDocErr(null);
    if (!d.storage_path) {
      setDocErr(`${d.filename ?? "That file"} has no storage path recorded — it can't be opened from here.`);
      return;
    }
    const { data, error } = await supabase.storage.from("lender-documents").createSignedUrl(d.storage_path, 60);
    if (error || !data?.signedUrl) {
      setDocErr(`Could not open ${d.filename ?? "that file"} — ${error?.message ?? "no link came back"}.`);
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <>
      <div className="cgroup">
        <div className="ck">Partner portal — where you log in</div>
        {brokerPortal || profilePortal ? (
          <div className="portal">
            {brokerPortal && (
              <>
                <div className="pt">Broker / ISO portal</div>
                <LinkLine label="" url={brokerPortal} />
              </>
            )}
            {profilePortal && !sameUrl && (
              <>
                <div className="pt">{brokerPortal ? "Portal on the submission profile" : "Submission portal"}</div>
                <LinkLine label="" url={profilePortal} />
                {brokerPortal && (
                  <div className="cred">
                    Two different portal links are recorded for this funder. Neither has been confirmed as the current
                    one — try the broker portal first and tell Ops which works.
                  </div>
                )}
              </>
            )}
            {hint ? (
              hintSafe ? (
                <div className="cred">
                  <b>Credentials:</b> {hint}
                </div>
              ) : (
                <div className="credhold">
                  A credential hint is on file but it isn't labelled — it may be the credential itself, so it is not
                  shown here. Ask Ops.
                </div>
              )
            ) : profilesReadable ? (
              <div className="credhold">
                <b>Portal on file, no credentials recorded.</b> Someone has to request access — that's an action item,
                not a dead end.
              </div>
            ) : (
              <div className="credhold">Credentials unknown — the submission profile could not be read.</div>
            )}
          </div>
        ) : (
          <div className="cnone">No partner portal recorded for this funder.</div>
        )}
      </div>

      {subNotes && (
        <div className="cgroup">
          <Quoted label="Submission notes — quoted, not parsed" text={subNotes} />
        </div>
      )}

      <div className="cgroup">
        <div className="ck">Material we already hold</div>
        {!docs.readable ? (
          <div className="cunk">
            Stored material is UNKNOWN — `lender_documents` is admin-only and returned nothing for your account. Not
            "no material": ask Ops.
          </div>
        ) : mine.length === 0 ? (
          <div className="cnone">Nothing captured from this funder's packet yet.</div>
        ) : (
          <div className="doclist">
            {mine.map((d) => {
              // UCS stores two copies each of its ISO Agreement and Partner Info
              // Sheet — same filename, different bytes, both approved. Say that
              // out loud rather than silently showing one of them.
              const twins = mine.filter((x) => (x.filename ?? "") === (d.filename ?? "")).length;
              return (
                <div className="docrow" key={d.id}>
                  <span className="dt">{DOC_TYPE_LABEL[d.document_type ?? ""] ?? d.document_type ?? "file"}</span>
                  <span>{d.filename ?? "unnamed file"}</span>
                  {twins > 1 && (
                    <span className="dt" title="Same filename stored more than once, with different contents. Nobody has said which is current.">
                      {twins} copies
                    </span>
                  )}
                  <button type="button" className="docopen" onClick={() => open(d)}>
                    open
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {docErr && <div className="docerr">{docErr}</div>}
      </div>
    </>
  );
}

function ContactBlock({
  l,
  profile,
  profilesReadable,
  docs,
}: {
  l: ContactFields & { id: string; company_name: string };
  profile: ProfileRow | undefined;
  profilesReadable: boolean;
  docs: DocState;
}) {
  const name = clean(l.primary_contact_name);
  const email = clean(l.primary_contact_email);
  const phone = clean(l.primary_contact_phone);
  const site = clean(l.website);
  // `contacts` is jsonb — shape-check it rather than trusting the column.
  const people = (Array.isArray(l.contacts) ? l.contacts : []).filter(
    (p) => clean(p?.name) || clean(p?.email) || clean(p?.phone),
  );
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
            <Quoted key={n.k} label={`${n.k} — quoted, not parsed into fields`} text={n.v} />
          ))}
        </div>
      )}

      <LinksBlock l={l} profile={profile} profilesReadable={profilesReadable} docs={docs} />

      <div className="cgroup">
        {site ? (
          <LinkLine label="Website" url={site} />
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
//  1. `lender_programs` now holds recorded credit boxes for a SMALL number of
//     funders on these products (United Capital Source and GoKapital, loaded
//     2026-09-30 from their signed ISO packets). Most funders have none. A
//     funder with no row for this product has criteria we have NOT recorded —
//     say that in words. Never render a blank cell that could read as "no
//     requirement", and never fall back to `category.criteria`: that box was
//     extracted from MCA packets and decline emails, so showing it under a loan
//     heading relabels an MCA box as a term-loan box. The distinction matters
//     MORE now that recorded and unrecorded funders sit on the same tab, not
//     less.
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
// Tab id → the canonical product spelling used by `category->'products'`,
// `deals.products_interested` and `lender_programs.product_type`. The tab ids
// are this page's own shorthand; every lookup crosses through here.
const TAB_PRODUCT: Record<ProductId, CanonicalProduct> = {
  mca: "mca",
  term_loan: "term_loan",
  line_of_credit: "line_of_credit",
  sba: "sba_loan",
  equipment: "equipment_financing",
};

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
  // The link a MERCHANT may be sent. Present ONLY when the URL carries an
  // identifier that ties the application back to us. A partner with no such
  // link gets `null` and says so — a plausible-looking marketing URL in this
  // slot is a commission leak, because everything on this callout reads as
  // "safe to send".
  merchantLink: string | null;
  // Where WE work the relationship. Never sent to a merchant.
  ourPortal?: string;
  products: Exclude<ProductId, "mca">[];
  lines: { k: string; v: string }[];
}[] = [
  {
    name: "1 West",
    merchantLink: "https://apply.1west.com/?iso=a10PZ00000socCfYAI",
    products: ["term_loan", "line_of_credit", "sba", "equipment"],
    lines: [
      { k: "Relationship", v: "Signed referral agreement. We refer, 1 West runs it through its lender network." },
      {
        k: "How we get paid",
        v: "The ISO code a10PZ00000socCfYAI is baked into the link and identifies Momentum Funding. Send the merchant THAT link, never 1west.com.",
      },
      {
        k: "The other route",
        v: "Or package it yourself: application + last 4 months of business bank statements to partnersubs@1west.com.",
      },
      { k: "Compensation", v: "50% of 1 West compensation, new and renewal. Never charge the merchant a fee." },
    ],
  },
  {
    name: "ROK Financial",
    // ROK has NO attributed merchant link. rok.biz/partner-multistep-apply is
    // the page where a BROKER signs up, carries no identifier, and was being
    // shown here as a merchant apply link — a merchant who used it was a
    // walk-in and the 20% was gone. Per the signed referral agreement
    // (DocuSign 7/6/2026) attribution comes from submitting through our
    // affiliate account, and the referral locks for 21 calendar days.
    merchantLink: null,
    ourPortal: "https://rok.mypartner.io",
    products: ["term_loan", "line_of_credit", "sba", "equipment"],
    lines: [
      {
        k: "⚠ No merchant link",
        v: "ROK has no referral URL that identifies us. A merchant who applies on rok.biz by themselves is a walk-in and we are paid nothing. Do not send a merchant to ROK's website.",
      },
      {
        k: "How to submit",
        v: "Executed ROK application + 3 months of business bank statements, submitted through OUR affiliate account at rok.mypartner.io (username sales@send.mfunding.net). The referral then locks for 21 calendar days.",
      },
      { k: "Contact", v: "Tony Cimino — tonyc@rok.biz, (833) 376-5249." },
      {
        k: "Relationship",
        v: "Referral. ROK runs the full application and underwriting and funds through its own sources. 20% of ROK upfront revenue; never charge the merchant a fee.",
      },
      { k: "Careful", v: "Non-circumvention applies once ROK funds a client." },
    ],
  },
];

type ProductLenderRow = ContactFields & {
  id: string;
  company_name: string;
  status: string | null;
  lender_types: string[] | null;
  category: LenderCategory | null;
  min_funding_amount: number | string | null;
  max_funding_amount: number | string | null;
};
type ProfileRow = {
  lender_id: string;
  method: string | null;
  to_email: string | null;
  cc_emails: string[] | null;
  portal_url: string | null;
  portal_credentials_hint: string | null;
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
  // A query that failed is a fault and shouts in red. A setter who is simply
  // not on the RLS policy is NOT a fault — it's a standing limit of their
  // account, and painting it red on every page load just teaches everyone to
  // ignore red. Both still mean UNKNOWN in every row that depends on them.
  severity: "error" | "limited";
};

const PROFILE_COLS =
  "lender_id, method, to_email, cc_emails, portal_url, portal_credentials_hint, required_stips, active, special_instructions, internal_notes";

// One read of the submission recipes, shared by every tab. Both failure modes
// collapse to `readable: false`, because a setter (role `closer`) is not on the
// RLS policy for funder_submission_profiles and gets zero rows with NO error —
// "none recorded" and "you may not read these" are indistinguishable from here.
// Merging keeps the pessimistic side: once any read came back unreadable, the
// page keeps saying so rather than letting a later partial read imply coverage.
function mergeProfiles(prev: ProfileState, next: ProfileState): ProfileState {
  const error = prev.error ?? next.error;
  return {
    map: { ...prev.map, ...next.map },
    readable: prev.readable && next.readable,
    error,
    severity: prev.severity === "error" || next.severity === "error" ? "error" : "limited",
  };
}

// "I got zero rows" and "I am not allowed to see this table" are the same
// response under RLS. They are NOT the same sentence to a processor, and this
// page has spent four commits keeping such pairs apart, so it is worth one
// extra query to tell them apart: ask the table for ANY single row, unfiltered.
//   error or zero rows back  → this account cannot see the table → UNKNOWN
//   a row back               → the table is readable → an empty filtered read
//                              genuinely means "none for these funders"
// Without this, a credit tab whose visible funders happen to have no recorded
// box reports "can't read" when the truth is "we haven't recorded it".
// `.in()` goes in the query STRING, so 121 UUIDs is a ~4.7KB URL — long enough
// for a proxy or CDN to answer 414 instead of the funder list, and a read that
// fails for a reason nobody can see is the thing this page keeps being wrong
// about. Ask in chunks.
const ID_CHUNK = 40;
const chunk = <T,>(xs: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

async function canRead(table: "lender_documents" | "lender_programs" | "funder_submission_profiles"): Promise<boolean> {
  const { data, error } = await supabase.from(table).select("lender_id").limit(1);
  return !error && (data ?? []).length > 0;
}

// `lender_documents` is admin/super-admin only. A setter reads zero rows with
// no error, so an empty result is UNKNOWN, never "nothing on file".
async function loadDocs(ids: string[]): Promise<DocState> {
  if (ids.length === 0) return { byLender: {}, readable: true };
  const parts = await Promise.all(
    chunk(ids, ID_CHUNK).map((c) =>
      supabase
        .from("lender_documents")
        .select("id, lender_id, document_type, filename, storage_path, description")
        .in("lender_id", c),
    ),
  );
  const error = parts.find((r) => r.error)?.error ?? null;
  const data = parts.flatMap((r) => r.data ?? []);
  if (error) return { byLender: {}, readable: false };
  if ((data ?? []).length === 0) return { byLender: {}, readable: await canRead("lender_documents") };
  const byLender: Record<string, LenderDoc[]> = {};
  for (const d of (data ?? []) as LenderDoc[]) (byLender[d.lender_id] ??= []).push(d);
  return { byLender, readable: true };
}

function mergeDocs(prev: DocState, next: DocState): DocState {
  return { byLender: { ...prev.byLender, ...next.byLender }, readable: prev.readable && next.readable };
}

// Recorded credit boxes. `lender_programs` is ops-staff/processor only, so a
// setter's empty read is UNKNOWN, never "no box recorded". Selected with * on
// purpose: columns are still being added to this table and a column list would
// 400 the whole page the day one lands.
async function loadPrograms(ids: string[]): Promise<ProgramState> {
  if (ids.length === 0) return { byKey: {}, readable: true };
  const parts = await Promise.all(
    chunk(ids, ID_CHUNK).map((c) => supabase.from("lender_programs").select("*").in("lender_id", c)),
  );
  const error = parts.find((r) => r.error)?.error ?? null;
  const data = parts.flatMap((r) => r.data ?? []);
  if (error) return { byKey: {}, readable: false };
  if ((data ?? []).length === 0) return { byKey: {}, readable: await canRead("lender_programs") };
  const byKey: Record<string, ProgramRow> = {};
  for (const r of (data ?? []) as ProgramRow[]) {
    if (r.product_type) byKey[progKey(r.lender_id, r.product_type)] = r;
  }
  return { byKey, readable: true };
}

function mergePrograms(prev: ProgramState, next: ProgramState): ProgramState {
  return { byKey: { ...prev.byKey, ...next.byKey }, readable: prev.readable && next.readable };
}

async function loadProfiles(ids: string[]): Promise<ProfileState> {
  if (ids.length === 0) return { map: {}, readable: true, error: null, severity: "limited" };
  const parts = await Promise.all(
    chunk(ids, ID_CHUNK).map((c) => supabase.from("funder_submission_profiles").select(PROFILE_COLS).in("lender_id", c)),
  );
  const error = parts.find((r) => r.error)?.error ?? null;
  const data = parts.flatMap((r) => r.data ?? []);
  if (error) {
    return {
      map: {},
      readable: false,
      error: `Submission addresses and recipes could not be read — ${error.message}. This is a READ FAILURE: every submission contact below is UNKNOWN, not absent.`,
      severity: "error",
    };
  }
  const rows = (data ?? []) as ProfileRow[];
  if (rows.length === 0 && !(await canRead("funder_submission_profiles"))) {
    return {
      map: {},
      readable: false,
      error:
        "Submission addresses are UNKNOWN on this page — your account cannot read the submission profiles (Ops can; a setter account cannot). Treat every submission address as unknown, not as absent: there IS somewhere to send a deal, ask Ops where.",
      severity: "limited",
    };
  }
  const map: Record<string, ProfileRow> = {};
  for (const r of rows) map[r.lender_id] = r;
  return { map, readable: true, error: null, severity: "limited" };
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
  docs,
  program,
  programsReadable,
}: {
  l: ProductLenderRow;
  product: Exclude<ProductId, "mca">;
  profile: ProfileRow | undefined;
  profilesReadable: boolean;
  docs: DocState;
  program: ProgramRow | undefined;
  programsReadable: boolean;
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

      {program ? (
        <ProgramBox p={program} productLabel={spec.label} />
      ) : !programsReadable ? (
        <div className="nocrit">
          Whether we hold {l.company_name}'s {spec.label.toLowerCase()} box is UNKNOWN — the recorded-criteria table
          could not be read by your account. Not "nothing recorded": ask Ops.
        </div>
      ) : (
        <div className="nocrit">
          We have not recorded {l.company_name}'s {spec.label.toLowerCase()} criteria yet — nothing here is a published
          credit box. Confirm time in business, credit and documents with the rep before you quote anything to a
          merchant.
        </div>
      )}

      <button type="button" className="more" onClick={() => setWho((w) => !w)} aria-expanded={who}>
        {who ? "Hide contacts & links ↑" : "Who to call · submission links ↓"}
      </button>
      {who && <ContactBlock l={l} profile={profile} profilesReadable={profilesReadable} docs={docs} />}

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
              <Quoted label="Funder submission notes" text={profile?.special_instructions} />
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
  docs,
  programs,
  onRetry,
}: {
  product: Exclude<ProductId, "mca">;
  data: ProductData;
  profiles: ProfileState;
  docs: DocState;
  programs: ProgramState;
  onRetry: () => void;
}) {
  const spec = PRODUCT_SPEC[product];
  const markets = MARKETPLACES.filter((m) => m.products.includes(product));
  const matching = useMemo(
    () =>
      data.rows
        .filter((r) => hasProduct(r, TAB_PRODUCT[product]))
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
                {m.merchantLink ? (
                  <LinkLine label="Send the merchant" url={m.merchantLink} />
                ) : (
                  <div className="credhold">
                    <b>No merchant-facing link for {m.name}.</b> Nothing on their site identifies us, so a merchant who
                    applies there is a walk-in and we are paid nothing. Submit through our own account instead — see
                    below.
                  </div>
                )}
                {m.ourPortal && <LinkLine label="We log in at" url={m.ourPortal} />}
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
        {profiles.error && (
          <div className={profiles.severity === "error" ? "err" : "warn"}>{profiles.error}</div>
        )}

        {data.state === "loading" && <div className="loadnote">Reading the funder catalog…</div>}
        {data.state === "error" && (
          <div className="loadnote">
            Nothing is listed below because the read failed — <b>not</b> because no funder does this product.{" "}
            <button type="button" className="docopen" onClick={onRetry}>
              try again
            </button>
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
                  docs={docs}
                  program={programs.byKey[progKey(l.id, TAB_PRODUCT[product])]}
                  programsReadable={programs.readable}
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
                  docs={docs}
                  program={programs.byKey[progKey(l.id, TAB_PRODUCT[product])]}
                  programsReadable={programs.readable}
                />
              ))}
            </div>
          </>
        )}
      </section>

      <footer>
        Funders on this tab are the <b>union</b> of <b>lenders.lender_types</b> and{" "}
        <b>category.products</b> in the funder catalog — two columns that disagree in both directions, so reading
        either alone hides funders · a funder showing a <b>recorded {spec.label.toLowerCase()} box</b> has one loaded
        from their own packet; <b>most funders have none</b>, and those rows say so rather than leaving a blank that
        reads as "no requirement" · every criteria line that is NOT in a recorded box is general industry guidance,
        and the requirement table above is orientation for a phone call, <b>never a quote to a merchant</b> · a link
        with no identifier does not pay us — check the chip before sending one · internal working tool, not a
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
  const [profiles, setProfiles] = useState<ProfileState>({
    map: {},
    readable: true,
    error: null,
    severity: "limited",
  });
  // Rate sheets / packets already captured per funder.
  const [docs, setDocs] = useState<DocState>({ byLender: {}, readable: true });
  // Recorded credit boxes, used by the credit tabs.
  const [programs, setPrograms] = useState<ProgramState>({ byKey: {}, readable: true });
  // "Has the shared credit-tab load been started / finished" — a ref, NOT the
  // rendered state, so that setting the state can never re-enter the effect.
  const creditLoad = useRef<"idle" | "running" | "done">("idle");
  // Only a page teardown abandons an in-flight read. Changing tabs must not.
  const alive = useRef(true);
  // The only way back out of a failed load, without reloading the page. The
  // tick is what re-runs the effect: `prod.state` is deliberately NOT a
  // dependency (that was the hang), so resetting the state alone would sit
  // there doing nothing.
  const [retryTick, setRetryTick] = useState(0);
  const retryCredit = () => {
    creditLoad.current = "idle";
    setProd({ state: "idle", rows: [], error: null });
    setRetryTick((t) => t + 1);
  };
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  // Same three-outcome rule as the credit tabs: this must end in loaded, empty
  // or failed. `setLoading(false)` lives in the finally so no branch — including
  // a thrown rejection, which is NOT the `{ error }` shape — can leave the MCA
  // tab spinning forever.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
      const { data, error: err } = await supabase
        .from("lenders")
        .select(
          "id, company_name, min_funding_amount, max_funding_amount, category, primary_contact_name, primary_contact_email, primary_contact_phone, contacts, submission_email, submission_portal_url, submission_notes, website, notes",
        )
        .eq("status", "live_vendor");
      if (cancelled) return;
      if (err) {
        setError(`Could not load the live funder list — ${err.message}`);
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
      const ids = rows.map((r) => r.id);
      const [res, dres, pres] = await Promise.all([loadProfiles(ids), loadDocs(ids), loadPrograms(ids)]);
      if (cancelled) return;
      setProfiles((prev) => mergeProfiles(prev, res));
      setDocs((prev) => mergeDocs(prev, dres));
      setPrograms((prev) => mergePrograms(prev, pres));
      } catch (e) {
        if (cancelled) return;
        setError(
          `Could not load the live funder list — ${e instanceof Error ? e.message : String(e)}. This is a READ FAILURE, not an empty network.`,
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Credit-product tabs load on first use, so the MCA tab's first paint is
  // exactly what it was. A failed read is reported loudly and NEVER collapses
  // into an empty list.
  //
  // THREE OUTCOMES, ALWAYS — loaded, empty or failed. "Reading the funder
  // catalog…" must be able to end, and there are two ways to strand it:
  //
  //  1. A THROWN rejection. A dropped connection or a CORS failure does not
  //     come back as `{ error }`, it throws, and an uncaught throw kills the
  //     async body with the loading flag still set. Hence the try/catch.
  //
  //  2. A CANCELLED load — which is what actually broke this, and it broke it
  //     on the FIRST click, not on some race. `prod.state` was in the dep array
  //     AND set by the effect, so `setProd(loading)` re-ran the effect, React
  //     ran the previous cleanup, the cleanup set `cancelled = true`, and the
  //     fetch it had just started threw its own result away. The `!== "idle"`
  //     guard then blocked every retry. The tabs never loaded at all, for
  //     anyone, and grepping the deployed bundle for my own strings proved only
  //     that the code shipped — never that it ran.
  //
  // So: the effect depends on `tab` alone, "have we started" is a ref rather
  // than the rendered state, and the load is abandoned only when the PAGE goes
  // away — not when the user changes tab, because `prod.rows` is shared by all
  // four credit tabs and there is nothing tab-specific to cancel. A failure
  // resets the ref so the next visit (or the Try again button) retries.
  useEffect(() => {
    if (tab === "mca" || creditLoad.current !== "idle") return;
    creditLoad.current = "running";
    const cancelled = () => !alive.current;
    setProd((p) => ({ ...p, state: "loading" }));
    (async () => {
      try {
      const { data, error: err } = await supabase
        .from("lenders")
        .select(
          `id, company_name, status, min_funding_amount, max_funding_amount, ${PRODUCT_SOURCE_COLUMNS}, primary_contact_name, primary_contact_email, primary_contact_phone, contacts, submission_email, submission_portal_url, submission_notes, website, notes`,
        )
        .neq("status", "rejected");
      if (cancelled()) return;
      if (err) {
        creditLoad.current = "idle"; // a failure must be retryable
        setProd({
          state: "error",
          rows: [],
          error: `Could not read the funder catalog for the product tabs — ${err.message}. This is a READ FAILURE, not an empty network.`,
        });
        return;
      }
      const rows = (data ?? []) as ProductLenderRow[];
      creditLoad.current = "done";
      setProd({ state: "ready", rows, error: null });
      const ids = rows.map((r) => r.id);
      const [res, dres, pres] = await Promise.all([loadProfiles(ids), loadDocs(ids), loadPrograms(ids)]);
      if (cancelled()) return;
      setProfiles((prev) => mergeProfiles(prev, res));
      setDocs((prev) => mergeDocs(prev, dres));
      setPrograms((prev) => mergePrograms(prev, pres));
      } catch (e) {
        if (cancelled()) return;
        // Never leave the tab in "Reading…" — say what happened instead.
        setProd((prev) =>
          prev.state === "ready"
            ? prev
            : {
                state: "error",
                rows: [],
                error: `Could not read the funder catalog for the product tabs — ${
                  e instanceof Error ? e.message : String(e)
                }. This is a READ FAILURE, not an empty network.`,
              },
        );
      }
    })();
    // NO CLEANUP ON PURPOSE. Changing tab must not abandon this read: the rows
    // are shared by all four credit tabs, so there is nothing tab-specific to
    // cancel, and cancelling is precisely what stranded the spinner before.
    // Page teardown is handled by `alive`.
  }, [tab, retryTick]);

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
          <ProductTabView
            product={tab as Exclude<ProductId, "mca">}
            data={prod}
            profiles={profiles}
            docs={docs}
            programs={programs}
            onRetry={retryCredit}
          />
        )}

        {tab === "mca" && (
          <>
        {error && <div className="err">{error}</div>}
        {profiles.error && (
          <div className={profiles.severity === "error" ? "err" : "warn"}>{profiles.error}</div>
        )}

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
                docs={docs}
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
  docs,
}: {
  l: LenderRow;
  papers: string[];
  tags: string[];
  profile: ProfileRow | undefined;
  profilesReadable: boolean;
  docs: DocState;
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
        {who ? "Hide contacts & links ↑" : "Who to call · submission links ↓"}
      </button>
      {who && <ContactBlock l={l} profile={profile} profilesReadable={profilesReadable} docs={docs} />}

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
