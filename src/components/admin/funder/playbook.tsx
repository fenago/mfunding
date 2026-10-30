// ─────────────────────────────────────────────────────────────────────────────
// Funder Playbook — shared chrome for the per-funder deep-dive tabs
//
// The Funder Cheat Sheet's other tabs answer "WHICH funder takes this deal".
// A playbook tab answers the opposite question: "we have already chosen this
// funder — what exactly do I collect, and what will get this file killed".
// That is a different job, so it gets different furniture: a qualify/decline
// pair you can read in two seconds, a tier grid, and a working checklist.
//
// Styling rules this file obeys, both learned the hard way in this repo:
//
//  1. Every class here is `fp-` prefixed. The cheat sheet injects an UNLAYERED
//     <style> block scoped to `.fcs`, and an unlayered rule silently outranks
//     every Tailwind utility that shares its name — so a bare `grid` or
//     `flex` or `hidden` inside `.fcs` is a coin flip that passes tsc, passes
//     the build, and renders wrong. Prefixed names cannot collide.
//  2. Colours come from the `.fcs` custom properties, never hard-coded. That
//     is what makes dark mode work: `.dark .fcs` redefines the tokens and
//     everything below follows without a second rule.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export const PLAYBOOK_CSS = `
.fcs .fp-head{display:flex;flex-wrap:wrap;align-items:flex-start;gap:14px;justify-content:space-between;
  border:1px solid var(--line);border-radius:var(--radius);background:var(--panel);
  box-shadow:var(--shadow);padding:18px 20px;margin-top:18px}
.fcs .fp-head h2{font-size:22px;font-weight:800;letter-spacing:-.02em}
.fcs .fp-head .fp-role{margin:6px 0 0;font-size:14px;color:var(--ink-soft);max-width:62ch}
.fcs .fp-idchips{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.fcs .fp-idchip{font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;
  background:var(--chip);color:var(--chip-ink);border-radius:999px;padding:4px 10px}

/* ── section shell ── */
.fcs .fp-sec{margin-top:26px}
.fcs .fp-sechead{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:10px}
.fcs .fp-sechead h3{font-size:16px;font-weight:800;letter-spacing:-.01em}
.fcs .fp-num{font-size:11px;font-weight:800;color:#fff;background:var(--ink-faint);
  border-radius:6px;min-width:20px;height:20px;display:inline-flex;align-items:center;
  justify-content:center;padding:0 5px;font-variant-numeric:tabular-nums}
.fcs .fp-sechead .fp-sub{font-size:12.5px;color:var(--ink-faint)}
.fcs .fp-panel{border:1px solid var(--line);border-radius:var(--radius);background:var(--panel);
  box-shadow:var(--shadow);overflow:hidden}

/* ── severity callout ── */
.fcs .fp-alert{border-radius:var(--radius);padding:14px 18px;font-size:13.5px;line-height:1.55;
  border:1.5px solid;background:var(--panel);box-shadow:var(--shadow)}
.fcs .fp-alert + .fp-alert{margin-top:10px}
.fcs .fp-alert h4{font-size:13.5px;font-weight:800;margin:0 0 5px;letter-spacing:.01em}
.fcs .fp-alert p{margin:0 0 6px}
.fcs .fp-alert p:last-child{margin-bottom:0}
.fcs .fp-alert.stop{border-color:var(--d);background:var(--d-bg)}
.fcs .fp-alert.stop h4{color:var(--d)}
.fcs .fp-alert.warn{border-color:var(--c);background:var(--c-bg)}
.fcs .fp-alert.warn h4{color:var(--c)}
.fcs .fp-alert.good{border-color:var(--a);background:var(--a-bg)}
.fcs .fp-alert.good h4{color:var(--a)}
.fcs .fp-alert.info{border-color:var(--b);background:var(--b-bg)}
.fcs .fp-alert.info h4{color:var(--b)}

/* ── tier grid ── */
.fcs .fp-tiers{display:grid;grid-template-columns:repeat(auto-fit,minmax(176px,1fr));gap:0}
.fcs .fp-tier{padding:14px 16px;border-right:1px solid var(--line-soft);border-bottom:1px solid var(--line-soft)}
.fcs .fp-tier .fp-tname{font-weight:800;font-size:14.5px;display:flex;align-items:center;gap:7px}
.fcs .fp-tier .fp-stripe{width:4px;height:15px;border-radius:2px;background:var(--accent)}
.fcs .fp-tier.t1 .fp-stripe{background:var(--a)}
.fcs .fp-tier.t2 .fp-stripe{background:var(--b)}
.fcs .fp-tier.t3 .fp-stripe{background:var(--c)}
.fcs .fp-tier.t4 .fp-stripe{background:var(--d)}
.fcs .fp-tier dl{margin:9px 0 0;display:grid;grid-template-columns:auto 1fr;gap:3px 10px;font-size:12.5px}
.fcs .fp-tier dt{color:var(--ink-faint)}
.fcs .fp-tier dd{margin:0;text-align:right;font-weight:700;
  font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-variant-numeric:tabular-nums}
.fcs .fp-tier dd.fp-hi{color:var(--accent-ink)}

/* ── two-column qualify / decline ── */
.fcs .fp-two{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:14px}
.fcs .fp-gate{border:1.5px solid var(--line);border-radius:var(--radius);background:var(--panel);
  box-shadow:var(--shadow);overflow:hidden}
.fcs .fp-gate > h4{font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;
  padding:11px 16px;margin:0;border-bottom:1px solid var(--line)}
.fcs .fp-gate.pass{border-color:var(--a)}
.fcs .fp-gate.pass > h4{color:var(--a);background:var(--a-bg)}
.fcs .fp-gate.fail{border-color:var(--d)}
.fcs .fp-gate.fail > h4{color:var(--d);background:var(--d-bg)}
.fcs .fp-gate ul{list-style:none;margin:0;padding:6px 0}
.fcs .fp-gate li{display:flex;gap:10px;padding:8px 16px;font-size:13px;line-height:1.5;align-items:flex-start}
.fcs .fp-gate li + li{border-top:1px solid var(--line-soft)}
.fcs .fp-gate .fp-mk{flex:0 0 auto;font-weight:800;line-height:1.45}
.fcs .fp-gate.pass .fp-mk{color:var(--a)}
.fcs .fp-gate.fail .fp-mk{color:var(--d)}
.fcs .fp-gate li b{display:block}
.fcs .fp-gate li span.fp-why{color:var(--ink-soft);font-size:12.5px}

/* ── checklist ── */
.fcs .fp-ckbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;
  padding:12px 16px;border-bottom:1px solid var(--line);background:var(--line-soft)}
.fcs .fp-track{flex:1 1 180px;height:7px;border-radius:999px;background:var(--chip);overflow:hidden;min-width:120px}
.fcs .fp-fill{height:100%;background:var(--accent);transition:width .18s ease}
.fcs .fp-ckcount{font-size:12.5px;font-weight:700;color:var(--ink-soft);
  font-variant-numeric:tabular-nums;white-space:nowrap}
.fcs .fp-reset{font:inherit;font-size:12px;font-weight:700;color:var(--chip-ink);background:var(--panel);
  border:1px solid var(--line);border-radius:999px;padding:4px 12px;cursor:pointer}
.fcs .fp-reset:hover{border-color:var(--accent);color:var(--accent-ink)}
.fcs .fp-ckgroup{font-size:10.5px;font-weight:800;letter-spacing:.11em;text-transform:uppercase;
  color:var(--ink-faint);padding:12px 16px 6px;border-top:1px solid var(--line-soft)}
.fcs .fp-ckgroup:first-child{border-top:0}
.fcs .fp-ckitem{display:flex;gap:11px;padding:9px 16px;align-items:flex-start;cursor:pointer;
  border-top:1px solid var(--line-soft)}
.fcs .fp-ckitem:hover{background:var(--line-soft)}
.fcs .fp-ckitem input{margin:2px 0 0;width:16px;height:16px;flex:0 0 auto;accent-color:var(--accent);cursor:pointer}
.fcs .fp-ckbody{min-width:0}
.fcs .fp-cklabel{font-size:13.5px;font-weight:650;line-height:1.45}
.fcs .fp-ckitem.on .fp-cklabel{color:var(--ink-faint);text-decoration:line-through}
.fcs .fp-ckwhy{font-size:12.5px;color:var(--ink-soft);margin-top:2px;line-height:1.5}
.fcs .fp-ckwhy b{color:var(--ink)}
.fcs .fp-req{font-size:9.5px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;
  border-radius:4px;padding:2px 6px;margin-left:7px;vertical-align:1px;white-space:nowrap}
.fcs .fp-req.hard{background:var(--d-bg);color:var(--d)}
.fcs .fp-req.soft{background:var(--chip);color:var(--chip-ink)}

/* ── plain fact rows ── */
.fcs .fp-rows{display:grid;grid-template-columns:minmax(130px,auto) 1fr;gap:0}
.fcs .fp-rk,.fcs .fp-rv{padding:10px 16px;border-top:1px solid var(--line-soft);font-size:13px;line-height:1.55}
.fcs .fp-rows > .fp-rk:first-child,.fcs .fp-rows > .fp-rk:first-child + .fp-rv{border-top:0}
.fcs .fp-rk{color:var(--ink-faint);font-weight:700;font-size:12px;letter-spacing:.03em;text-transform:uppercase}
.fcs .fp-rv b{font-weight:750}
.fcs .fp-rv .fp-miss{color:var(--c);font-weight:700}

/* ── verbatim quote ── */
.fcs .fp-q{border-left:3px solid var(--ink-faint);padding:7px 0 7px 12px;margin:7px 0 0;
  font-size:12.5px;color:var(--ink-soft);font-style:italic;line-height:1.55}
.fcs .fp-q cite{display:block;font-style:normal;font-size:11px;font-weight:700;
  letter-spacing:.05em;text-transform:uppercase;color:var(--ink-faint);margin-top:5px}

/* ── industry finder ── */
.fcs .fp-find{display:flex;gap:9px;flex-wrap:wrap;align-items:center;padding:12px 16px;
  border-bottom:1px solid var(--line);background:var(--line-soft)}
.fcs .fp-input{font:inherit;font-size:13px;color:var(--ink);background:var(--panel);
  border:1px solid var(--line);border-radius:9px;padding:7px 11px;flex:1 1 210px;min-width:0}
.fcs .fp-input:focus{outline:2px solid var(--accent);outline-offset:1px}
.fcs .fp-verdict{padding:14px 16px;font-size:13.5px;line-height:1.55}
.fcs .fp-vhit{display:flex;gap:10px;align-items:baseline;padding:7px 0}
.fcs .fp-vhit + .fp-vhit{border-top:1px solid var(--line-soft)}
.fcs .fp-vtag{font-size:10px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;
  border-radius:5px;padding:3px 8px;flex:0 0 auto}
.fcs .fp-vtag.pref{background:var(--a-bg);color:var(--a)}
.fcs .fp-vtag.std{background:var(--b-bg);color:var(--b)}
.fcs .fp-vtag.no{background:var(--d-bg);color:var(--d)}
.fcs .fp-cols{columns:3 150px;column-gap:22px;padding:12px 16px;font-size:12.5px;line-height:1.75}
.fcs .fp-cols span{display:block;break-inside:avoid}
.fcs .fp-disc{font:inherit;font-size:12px;font-weight:700;color:var(--chip-ink);background:transparent;
  border:0;cursor:pointer;padding:9px 16px;width:100%;text-align:left;border-top:1px solid var(--line-soft)}
.fcs .fp-disc:hover{color:var(--accent-ink)}

/* ── money math ── */
.fcs .fp-math{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:0}
.fcs .fp-mcell{padding:13px 16px;border-right:1px solid var(--line-soft);border-bottom:1px solid var(--line-soft)}
.fcs .fp-mk2{font-size:10.5px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:var(--ink-faint)}
.fcs .fp-mv{font-size:19px;font-weight:800;margin-top:4px;
  font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-variant-numeric:tabular-nums}
.fcs .fp-mn{font-size:12px;color:var(--ink-soft);margin-top:3px;line-height:1.45}

.fcs .fp-foot{margin-top:22px;font-size:12px;color:var(--ink-faint);line-height:1.6;max-width:84ch}
.fcs .fp-foot b{color:var(--ink-soft)}

/* ── product cards ── */
.fcs .fp-pcard{border:1px solid var(--line);border-left-width:5px;border-radius:var(--radius);
  background:var(--panel);box-shadow:var(--shadow);overflow:hidden;margin-top:14px}
.fcs .fp-pcard.adv{border-left-color:var(--a)}
.fcs .fp-pcard.loan{border-left-color:var(--b)}
.fcs .fp-pcard.spec{border-left-color:var(--c)}
.fcs .fp-ptop{padding:15px 18px;border-bottom:1px solid var(--line);
  display:flex;flex-wrap:wrap;gap:10px 16px;align-items:baseline;justify-content:space-between}
.fcs .fp-pname{font-size:17px;font-weight:800;letter-spacing:-.01em}
.fcs .fp-pkind{font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;
  border-radius:5px;padding:3px 8px;margin-left:9px;vertical-align:2px}
.fcs .fp-pcard.adv .fp-pkind{background:var(--a-bg);color:var(--a)}
.fcs .fp-pcard.loan .fp-pkind{background:var(--b-bg);color:var(--b)}
.fcs .fp-pcard.spec .fp-pkind{background:var(--c-bg);color:var(--c)}
.fcs .fp-prange{font-size:17px;font-weight:800;white-space:nowrap;
  font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-variant-numeric:tabular-nums}
.fcs .fp-pvia{font-size:11.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--ink-faint)}
.fcs .fp-pline{padding:11px 18px;font-size:13px;line-height:1.55;border-top:1px solid var(--line-soft)}
.fcs .fp-pline:first-of-type{border-top:0}
.fcs .fp-plk{font-size:10.5px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;
  color:var(--ink-faint);display:block;margin-bottom:3px}
.fcs .fp-pgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:0}
.fcs .fp-pgrid > .fp-pline{border-top:1px solid var(--line-soft);border-right:1px solid var(--line-soft)}
.fcs .fp-pitch{padding:13px 18px;background:var(--line-soft);font-size:13px;line-height:1.6;font-style:italic;
  color:var(--ink-soft);border-top:1px solid var(--line-soft)}
.fcs .fp-pitch b{font-style:normal;color:var(--ink)}

/* ── routing ladder ── */
.fcs .fp-ladder{counter-reset:rung}
.fcs .fp-rung{display:flex;gap:13px;padding:13px 18px;border-top:1px solid var(--line-soft);
  font-size:13.5px;line-height:1.55;align-items:flex-start}
.fcs .fp-rung:first-child{border-top:0}
.fcs .fp-rnum{counter-increment:rung;flex:0 0 auto;width:23px;height:23px;border-radius:50%;
  background:var(--accent);color:#fff;font-size:11.5px;font-weight:800;display:inline-flex;
  align-items:center;justify-content:center;margin-top:1px}
.fcs .fp-rung.stopr .fp-rnum{background:var(--d)}
.fcs .fp-rnum::before{content:counter(rung)}
.fcs .fp-rq{font-weight:700;display:block}
.fcs .fp-ra{color:var(--ink-soft);font-size:12.5px;margin-top:2px;display:block}
.fcs .fp-ra b{color:var(--ink)}

/* ── spread calculator ── */
.fcs .fp-calc{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:0;
  border-bottom:1px solid var(--line);background:var(--line-soft)}
.fcs .fp-field{padding:11px 16px;border-right:1px solid var(--line);display:flex;flex-direction:column;gap:5px}
.fcs .fp-field label{font-size:10.5px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:var(--ink-faint)}
.fcs .fp-field input,.fcs .fp-field select{font:inherit;font-size:14px;font-weight:700;color:var(--ink);
  background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:7px 9px;width:100%;
  font-variant-numeric:tabular-nums}
.fcs .fp-field input:focus,.fcs .fp-field select:focus{outline:2px solid var(--accent);outline-offset:1px}
.fcs .fp-field .fp-hint{font-size:11px;color:var(--ink-faint);line-height:1.4}
.fcs .fp-out{display:grid;grid-template-columns:repeat(auto-fit,minmax(152px,1fr));gap:0}
.fcs .fp-ocell{padding:14px 16px;border-right:1px solid var(--line-soft);border-bottom:1px solid var(--line-soft)}
.fcs .fp-ocell.hero{background:var(--a-bg)}
.fcs .fp-ocell.bad{background:var(--d-bg)}
.fcs .fp-ocell.cost{background:var(--c-bg)}
.fcs .fp-ok2{font-size:10.5px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:var(--ink-faint)}
.fcs .fp-ov{font-size:22px;font-weight:800;margin-top:4px;letter-spacing:-.02em;
  font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-variant-numeric:tabular-nums}
.fcs .fp-ocell.hero .fp-ov{color:var(--a)}
.fcs .fp-ocell.bad .fp-ov{color:var(--d)}
.fcs .fp-ocell.cost .fp-ov{color:var(--c)}
.fcs .fp-on{font-size:11.5px;color:var(--ink-soft);margin-top:4px;line-height:1.45}
.fcs .fp-capbar{padding:11px 16px;font-size:13px;line-height:1.5;border-bottom:1px solid var(--line)}
.fcs .fp-capbar.ok{background:var(--a-bg);color:var(--a)}
.fcs .fp-capbar.over{background:var(--d-bg);color:var(--d)}
.fcs .fp-capbar.zero{background:var(--c-bg);color:var(--c)}
.fcs .fp-capbar b{font-weight:800}
.fcs .fp-teach{padding:14px 16px 2px;border-bottom:1px solid var(--line);background:var(--chip)}
.fcs .fp-tlead{font-size:13.5px;line-height:1.6;color:var(--ink)}
.fcs .fp-tlead i{color:var(--ink-soft);font-style:italic}
.fcs .fp-tsteps{margin:10px 0 0;padding-left:20px;font-size:13px;line-height:1.65;color:var(--ink-soft)}
.fcs .fp-tsteps li{margin-bottom:7px}
.fcs .fp-tsteps li::marker{color:var(--ink-faint);font-weight:800}
.fcs .fp-tsteps b{color:var(--ink);font-weight:800}
.fcs .fp-tk{display:block;font-size:11px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--accent-ink)}
.fcs .fp-twarn{margin:4px -16px 0;padding:10px 16px;border-top:1px solid var(--line-soft);
  background:var(--c-bg);color:var(--c);font-size:12.5px;line-height:1.55;font-weight:600}
.fcs .fp-gloss{padding:13px 16px;border-top:1px solid var(--line);background:var(--chip)}
.fcs .fp-gloss > b{display:block;font-size:11px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;
  color:var(--ink-faint);margin-bottom:7px}
.fcs .fp-gloss dl{display:grid;grid-template-columns:auto 1fr;gap:4px 14px;margin:0;font-size:12.5px;line-height:1.5}
.fcs .fp-gloss dt{font-weight:800;color:var(--ink);white-space:nowrap}
.fcs .fp-gloss dd{margin:0;color:var(--ink-soft)}
@media (max-width:620px){.fcs .fp-gloss dl{grid-template-columns:1fr;gap:1px}
  .fcs .fp-gloss dd{margin-bottom:6px}}
`;

export function PlaybookStyles() {
  return <style>{PLAYBOOK_CSS}</style>;
}

// ── section shell ────────────────────────────────────────────────────────────
export function Sec({
  n,
  title,
  sub,
  children,
}: {
  n: number;
  title: string;
  sub?: string;
  children: ReactNode;
}) {
  return (
    <section className="fp-sec">
      <div className="fp-sechead">
        <span className="fp-num">{n}</span>
        <h3>{title}</h3>
        {sub ? <span className="fp-sub">{sub}</span> : null}
      </div>
      {children}
    </section>
  );
}

export function Alert({
  tone,
  title,
  children,
}: {
  tone: "stop" | "warn" | "good" | "info";
  title: string;
  children: ReactNode;
}) {
  return (
    <div className={`fp-alert ${tone}`}>
      <h4>{title}</h4>
      {children}
    </div>
  );
}

export function Quote({ text, cite }: { text: string; cite: string }) {
  return (
    <blockquote className="fp-q">
      “{text}”<cite>{cite}</cite>
    </blockquote>
  );
}

export function Rows({ items }: { items: { k: string; v: ReactNode }[] }) {
  return (
    <div className="fp-panel">
      <div className="fp-rows">
        {items.map((r) => (
          <PlainRow key={r.k} k={r.k} v={r.v} />
        ))}
      </div>
    </div>
  );
}

function PlainRow({ k, v }: { k: string; v: ReactNode }) {
  return (
    <>
      <div className="fp-rk">{k}</div>
      <div className="fp-rv">{v}</div>
    </>
  );
}

// ── the checklist ────────────────────────────────────────────────────────────
export type CheckItem = {
  id: string;
  group: string;
  label: string;
  why?: ReactNode;
  hard?: boolean;
};

// Ticks persist per browser so a half-finished file survives a refresh — but
// ONLY as a convenience. localStorage throws in a private window and comes back
// empty after a clear, so every read and write is guarded and the list renders
// correctly with nothing stored. Nothing here is a record of anything; the deal
// file in the database is.
function loadTicks(key: string): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (v === true) out[k] = true;
    }
    return out;
  } catch {
    return {};
  }
}

export function Checklist({ storageKey, items }: { storageKey: string; items: CheckItem[] }) {
  const [ticks, setTicks] = useState<Record<string, boolean>>(() => loadTicks(storageKey));

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(ticks));
    } catch {
      // Storage unavailable. The list still works for this session; nothing of
      // record lives here, so there is nothing to warn about.
    }
  }, [storageKey, ticks]);

  const groups = useMemo(() => {
    const order: string[] = [];
    const by = new Map<string, CheckItem[]>();
    for (const it of items) {
      if (!by.has(it.group)) {
        by.set(it.group, []);
        order.push(it.group);
      }
      by.get(it.group)!.push(it);
    }
    return order.map((g) => ({ g, rows: by.get(g)! }));
  }, [items]);

  const done = items.reduce((n, it) => n + (ticks[it.id] ? 1 : 0), 0);
  const pct = items.length === 0 ? 0 : Math.round((done / items.length) * 100);
  const missingHard = items.filter((it) => it.hard && !ticks[it.id]).length;

  return (
    <div className="fp-panel">
      <div className="fp-ckbar">
        <div className="fp-track" role="presentation">
          <div className="fp-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="fp-ckcount">
          {done} of {items.length} collected
          {missingHard > 0 ? ` · ${missingHard} required still open` : " · ready to submit"}
        </span>
        <button type="button" className="fp-reset" onClick={() => setTicks({})}>
          Clear
        </button>
      </div>

      {groups.map(({ g, rows }) => (
        <div key={g}>
          <div className="fp-ckgroup">{g}</div>
          {rows.map((it) => {
            const on = ticks[it.id] === true;
            return (
              <label key={it.id} className={`fp-ckitem${on ? " on" : ""}`}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) =>
                    setTicks((prev) => {
                      const next = { ...prev };
                      if (e.target.checked) next[it.id] = true;
                      else delete next[it.id];
                      return next;
                    })
                  }
                />
                <span className="fp-ckbody">
                  <span className="fp-cklabel">
                    {it.label}
                    <span className={`fp-req ${it.hard ? "hard" : "soft"}`}>
                      {it.hard ? "required" : "if it applies"}
                    </span>
                  </span>
                  {it.why ? <span className="fp-ckwhy">{it.why}</span> : null}
                </span>
              </label>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ── industry lookup ──────────────────────────────────────────────────────────
export type IndustryBook = {
  preferred: string[];
  standard: string[];
  prohibited: string[];
};

export function IndustryFinder({ book, note }: { book: IndustryBook; note: string }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const needle = q.trim().toLowerCase();

  const hits = useMemo(() => {
    if (needle.length < 2) return null;
    const out: { name: string; verdict: "pref" | "std" | "no" }[] = [];
    for (const n of book.prohibited) if (n.toLowerCase().includes(needle)) out.push({ name: n, verdict: "no" });
    for (const n of book.preferred) if (n.toLowerCase().includes(needle)) out.push({ name: n, verdict: "pref" });
    for (const n of book.standard) if (n.toLowerCase().includes(needle)) out.push({ name: n, verdict: "std" });
    return out;
  }, [needle, book]);

  return (
    <div className="fp-panel">
      <div className="fp-find">
        <input
          className="fp-input"
          type="search"
          value={q}
          placeholder="Type the merchant's industry — e.g. roofing, salon, trucking"
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search Bitty's industry list"
        />
      </div>

      <div className="fp-verdict">
        {hits === null ? (
          <span style={{ color: "var(--ink-soft)" }}>{note}</span>
        ) : hits.length === 0 ? (
          <span>
            <b>No match in their published list.</b> That is <b>not</b> an approval and not a decline — their guide
            names {book.preferred.length + book.standard.length + book.prohibited.length} industries and this is not
            one of them. Ask Partner Support which bucket it falls in before you promise the merchant anything.
          </span>
        ) : (
          hits.map((h) => (
            <div className="fp-vhit" key={`${h.verdict}-${h.name}`}>
              <span className={`fp-vtag ${h.verdict}`}>
                {h.verdict === "pref" ? "Preferred" : h.verdict === "std" ? "Standard" : "Do not submit"}
              </span>
              <span>
                {h.name}
                {h.verdict === "pref" ? " — best pricing, lead with it" : null}
                {h.verdict === "std" ? " — eligible, standard terms" : null}
                {h.verdict === "no" ? " — prohibited, send it elsewhere" : null}
              </span>
            </div>
          ))
        )}
      </div>

      <button type="button" className="fp-disc" onClick={() => setOpen((v) => !v)}>
        {open ? "▾ Hide" : "▸ Show"} all {book.preferred.length + book.standard.length + book.prohibited.length}{" "}
        industries
      </button>
      {open ? (
        <div>
          <div className="fp-ckgroup">Preferred — {book.preferred.length} · strongest appetite, best pricing</div>
          <div className="fp-cols">
            {book.preferred.map((n) => (
              <span key={n}>{n}</span>
            ))}
          </div>
          <div className="fp-ckgroup">Standard — {book.standard.length} · eligible at standard terms</div>
          <div className="fp-cols">
            {book.standard.map((n) => (
              <span key={n}>{n}</span>
            ))}
          </div>
          <div className="fp-ckgroup">Prohibited — {book.prohibited.length} · do not submit</div>
          <div className="fp-cols">
            {book.prohibited.map((n) => (
              <span key={n}>{n}</span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
