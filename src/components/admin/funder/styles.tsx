// The cheat sheet's scoped stylesheet, shared with every page that mounts a
// Funder* disclosure block. Everything is scoped under `.fcs`, which also
// defines the token set and its dark-mode variants, so a consumer wraps the
// markup in `<div className="fcs fcs-embed">` and renders <FunderDisclosureStyles/>
// once. Kept whole rather than split class-by-class: the disclosure components
// share .bchip / .dgrid / .drow / .more / .detail with the cheat sheet's own
// cards, and splitting it is how one of them silently loses its styling.

export const FUNDER_CSS = `
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
/* NAMESPACED ON PURPOSE. This was ".fcs .grid", and "grid" is also a Tailwind
   utility. The shared disclosure components are Tailwind now and emit
   class="grid grid-cols-[...]", so ".fcs .grid" matched them — and because this
   stylesheet is UNLAYERED while Tailwind utilities live in @layer utilities, the
   legacy rule won the cascade whatever the specificity. FunderProgramBox's stat
   grid collapsed to one 320px track inside a 293px card and overflowed, on this
   page only; the same component was correct on the processor chase tab, which
   injects no stylesheet. A bare, generic class name in a page-scoped sheet is a
   trap for any utility framework mounted inside it. */
.fcs .fcs-cardgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px;margin-top:16px}
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
/* Embedded on another page (the processor's Funder chase rows): keep the tokens
   and the component styles, drop the full-page canvas so it sits inside that
   page's panel instead of painting over it. */
.fcs.fcs-embed{background:transparent;min-height:0;font-family:inherit}
`;

/** Render once per page that mounts any Funder* disclosure component. */
export function FunderDisclosureStyles() {
  return <style>{FUNDER_CSS}</style>;
}
