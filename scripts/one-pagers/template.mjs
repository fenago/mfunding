// One-pager template. One Letter page, print-first, also fine on screen.
import { BRAND } from "./content.mjs";

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const CSS = `
:root{
  --midnight:#0A2342; --deepsea:#0C516E; --ocean:#007EA7; --teal:#00A896; --mint:#00D49D;
  --ink:#0A2342; --ink-soft:#44596B; --ink-faint:#7B8C9A;
  --rule:#D8E0E6; --rule-soft:#EAEFF2; --wash:#F4F8FA; --paper:#FFFFFF;
}
*{box-sizing:border-box}
@page{size:letter;margin:0}
html,body{margin:0;padding:0;background:#51606B;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font-family:Inter,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink)}
.sheet{width:8.5in;height:11in;background:var(--paper);margin:0 auto;display:flex;flex-direction:column;overflow:hidden}
@media screen{.sheet{margin:18px auto;box-shadow:0 10px 40px rgba(0,0,0,.35)}}
@media print{html,body{background:#fff}.sheet{margin:0;box-shadow:none}}

/* ── header ── */
.hd{background:linear-gradient(135deg,var(--midnight) 0%,var(--deepsea) 72%,var(--ocean) 140%);
  color:#fff;padding:.42in .55in .40in;position:relative}
.hd::after{content:"";position:absolute;left:0;right:0;bottom:0;height:4px;
  background:linear-gradient(90deg,var(--teal),var(--mint))}
.brandrow{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:.22in}
.brand{display:flex;align-items:center;gap:8px}
.mark{width:17px;height:17px;border-radius:5px;background:linear-gradient(135deg,var(--mint),var(--teal));flex:none}
.bn{font-size:12.5px;font-weight:700;letter-spacing:.02em}
.eyebrow{font-size:8.5px;font-weight:700;letter-spacing:.17em;text-transform:uppercase;color:rgba(255,255,255,.72);text-align:right}
.pname{font-family:"DM Serif Display",Georgia,serif;font-size:33px;line-height:1.04;letter-spacing:-.012em;margin:0 0 .13in}
.headline{font-size:15.5px;font-weight:600;line-height:1.32;margin:0 0 .11in;max-width:7.1in;color:#EAF6F8}
.standfirst{font-size:10.3px;line-height:1.55;color:rgba(255,255,255,.76);margin:0;max-width:6.7in}

/* ── stats ── */
.stats{display:grid;grid-template-columns:repeat(3,1fr);border-bottom:1px solid var(--rule);background:var(--wash)}
.stat{padding:.19in .55in;border-right:1px solid var(--rule-soft)}
.stat:last-child{border-right:0}
.sk{font-size:8px;font-weight:800;letter-spacing:.15em;text-transform:uppercase;color:var(--ink-faint)}
.sv{font-family:"DM Serif Display",Georgia,serif;font-size:27px;line-height:1.05;color:var(--deepsea);margin-top:2px;
  font-variant-numeric:tabular-nums}
.ss{font-size:9.3px;color:var(--ink-soft);margin-top:3px;line-height:1.35}

/* ── body ── */
.body{flex:1;padding:.26in .55in .1in;display:flex;flex-direction:column;gap:.19in;justify-content:space-between}
.h{font-size:9px;font-weight:800;letter-spacing:.15em;text-transform:uppercase;color:var(--teal);
  margin:0 0 .11in;display:flex;align-items:center;gap:9px}
.h::after{content:"";flex:1;height:1px;background:var(--rule)}
.ticks{display:grid;grid-template-columns:1fr 1fr;gap:.07in .34in}
.tick{display:flex;gap:8px;font-size:10.4px;line-height:1.42;color:var(--ink)}
.tick i{flex:none;width:13px;height:13px;border-radius:50%;background:var(--mint);margin-top:1px;position:relative}
.tick i::after{content:"";position:absolute;left:4px;top:1.5px;width:3.5px;height:7px;
  border:solid #06321f;border-width:0 1.7px 1.7px 0;transform:rotate(43deg)}
.steps{display:grid;grid-template-columns:repeat(4,1fr);gap:.26in}
.step .n{font-family:"DM Serif Display",Georgia,serif;font-size:21px;color:var(--ocean);line-height:1}
.step .t{font-size:10.2px;font-weight:700;margin:3px 0 3px;line-height:1.28}
.step .d{font-size:9.1px;line-height:1.46;color:var(--ink-soft)}
.cols{display:grid;grid-template-columns:1.15fr 1fr;gap:.34in}
.cost{background:var(--wash);border-left:3px solid var(--teal);padding:.15in .19in;border-radius:0 6px 6px 0}
.cost b{display:block;font-size:12px;color:var(--deepsea);margin-bottom:4px}
.cost p{margin:0;font-size:9.4px;line-height:1.52;color:var(--ink-soft)}
.nf{margin:0;padding:0;list-style:none}
.nf li{font-size:9.4px;line-height:1.45;color:var(--ink-soft);padding-left:14px;position:relative;margin-bottom:5px}
.nf li::before{content:"";position:absolute;left:0;top:6px;width:7px;height:1.6px;background:#C2CED7}
.ready{display:grid;grid-template-columns:repeat(4,1fr);gap:.16in}
.rc{border:1px solid var(--rule);border-top:3px solid var(--ocean);border-radius:0 0 6px 6px;
  padding:.11in .13in;font-size:9.2px;line-height:1.42;color:var(--ink-soft)}

/* ── footer ── */
.cta{margin-top:auto;background:var(--midnight);color:#fff;padding:.2in .55in;
  display:flex;align-items:center;justify-content:space-between;gap:16px}
.cta .l{font-size:11.5px;font-weight:600;color:#D7E8EC}
.cta .r{display:flex;align-items:center;gap:18px}
.cta .ph{font-family:"DM Serif Display",Georgia,serif;font-size:22px;color:var(--mint);white-space:nowrap}
.cta .ap{font-size:10.5px;font-weight:700;color:#fff;border:1.4px solid rgba(255,255,255,.42);
  border-radius:999px;padding:5px 14px;white-space:nowrap}
.legal{padding:.14in .55in .17in;font-size:6.9px;line-height:1.5;color:#8C9BA6;border-top:1px solid var(--rule)}
.legal b{color:#5F6F7B}
`;

export function render(sheet) {
  const credit = sheet.vocab === "credit";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(sheet.name)} — ${esc(BRAND.company)}</title>
<meta name="description" content="${esc(sheet.standfirst)}" />
<meta name="robots" content="${sheet.restricted ? "noindex, nofollow" : "index, follow"}" />
${sheet.restricted ? `<!-- HANDLING NOTE, NOT FOR THE READER: ${esc(sheet.restricted)} -->` : ""}
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet" />
<style>${CSS}</style>
</head>
<body>
<div class="sheet">

  <header class="hd">
    <div class="brandrow">
      <span class="brand"><span class="mark"></span><span class="bn">${esc(BRAND.company)}</span></span>
      <span class="eyebrow">${esc(sheet.eyebrow)}</span>
    </div>
    <h1 class="pname">${esc(sheet.name)}</h1>
    <p class="headline">${esc(sheet.headline)}</p>
    <p class="standfirst">${esc(sheet.standfirst)}</p>
  </header>

  <div class="stats">
    ${sheet.stats
      .map(
        (s) => `<div class="stat">
      <div class="sk">${esc(s.k)}</div>
      <div class="sv">${esc(s.v)}</div>
      <div class="ss">${esc(s.sub)}</div>
    </div>`,
      )
      .join("")}
  </div>

  <main class="body">
    <section>
      <h2 class="h">Is this you?</h2>
      <div class="ticks">
        ${sheet.isThis.map((t) => `<div class="tick"><i></i><span>${esc(t)}</span></div>`).join("")}
      </div>
    </section>

    <section>
      <h2 class="h">How it works</h2>
      <div class="steps">
        ${sheet.steps
          .map(
            ([t, d], i) => `<div class="step">
          <div class="n">${i + 1}</div>
          <div class="t">${esc(t)}</div>
          <div class="d">${esc(d)}</div>
        </div>`,
          )
          .join("")}
      </div>
    </section>

    <section>
      <h2 class="h">Have these ready and this takes one call</h2>
      <div class="ready">
        ${sheet.ready.map((r) => `<div class="rc">${esc(r)}</div>`).join("")}
      </div>
    </section>

    <section class="cols">
      <div>
        <h2 class="h">What it costs you</h2>
        <div class="cost">
          <b>${esc(sheet.cost.lead)}</b>
          <p>${esc(sheet.cost.body)}</p>
        </div>
      </div>
      <div>
        <h2 class="h">This probably isn&rsquo;t you if&hellip;</h2>
        <ul class="nf">
          ${sheet.notFor.map((n) => `<li>${esc(n)}</li>`).join("")}
        </ul>
      </div>
    </section>
  </main>

  <div class="cta">
    <span class="l">${credit ? "Talk to someone who will tell you if it is a no." : "One call tells you whether this is worth your time."}</span>
    <span class="r">
      <span class="ph">${esc(BRAND.phone)}</span>
      <span class="ap">${esc(BRAND.site)}/apply</span>
    </span>
  </div>

  <div class="legal"><b>${esc(BRAND.legal)}.</b> ${esc(sheet.legal)}</div>

</div>
</body>
</html>`;
}

/**
 * The index at /programs/. Generated from the same content as the sheets so
 * the two cannot drift. Restricted sheets are not listed — they are not
 * written to public/ at all.
 */
const WORD = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight"];

export function renderIndex(sheets) {
  const cards = sheets
    .map(
      (s) => `<a class="card" href="./${s.slug}.pdf" download>
      <span class="ceyebrow">${esc(s.eyebrow)}</span>
      <span class="cname">${esc(s.name)}</span>
      <span class="chead">${esc(s.headline)}</span>
      <span class="camt">${esc(s.stats[0].v)} <em>${esc(s.stats[0].sub)}</em></span>
      <span class="cgo">Download the PDF &rarr;</span>
    </a>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Our programs — ${esc(BRAND.company)}</title>
<meta name="description" content="One page on each kind of business funding we arrange. Download any of them." />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet" />
<style>
:root{--midnight:#0A2342;--deepsea:#0C516E;--ocean:#007EA7;--teal:#00A896;--mint:#00D49D;
  --ink:#0A2342;--ink-soft:#44596B;--ink-faint:#7B8C9A;--rule:#D8E0E6;--wash:#F4F8FA}
*{box-sizing:border-box}
body{margin:0;font-family:Inter,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  color:var(--ink);background:var(--wash)}
header{background:linear-gradient(135deg,var(--midnight),var(--deepsea) 75%,var(--ocean) 140%);
  color:#fff;padding:52px 24px 46px}
.in{max-width:1040px;margin:0 auto}
.brand{display:flex;align-items:center;gap:9px;margin-bottom:26px}
.mark{width:18px;height:18px;border-radius:5px;background:linear-gradient(135deg,var(--mint),var(--teal))}
.bn{font-size:13.5px;font-weight:700}
h1{font-family:"DM Serif Display",Georgia,serif;font-size:clamp(32px,6vw,52px);line-height:1.05;margin:0 0 14px;
  letter-spacing:-.015em;text-wrap:balance}
header p{margin:0;font-size:clamp(14px,2.4vw,16.5px);line-height:1.6;color:rgba(255,255,255,.76);max-width:56ch}
main{max-width:1040px;margin:0 auto;padding:40px 24px 64px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:18px}
.card{display:flex;flex-direction:column;gap:7px;background:#fff;border:1px solid var(--rule);
  border-top:4px solid var(--teal);border-radius:0 0 10px 10px;padding:20px;text-decoration:none;color:inherit;
  transition:transform .14s ease,box-shadow .14s ease}
.card:hover{transform:translateY(-2px);box-shadow:0 10px 26px rgba(10,35,66,.12)}
.ceyebrow{font-size:9px;font-weight:800;letter-spacing:.15em;text-transform:uppercase;color:var(--ink-faint)}
.cname{font-family:"DM Serif Display",Georgia,serif;font-size:23px;line-height:1.15;color:var(--midnight)}
.chead{font-size:13px;line-height:1.45;color:var(--ink-soft)}
.camt{font-family:"DM Serif Display",Georgia,serif;font-size:21px;color:var(--deepsea);margin-top:4px}
.camt em{font-style:normal;font-family:Inter,sans-serif;font-size:11.5px;color:var(--ink-faint)}
.cgo{margin-top:auto;padding-top:10px;font-size:12px;font-weight:700;color:var(--ocean)}
.foot{margin-top:38px;padding-top:22px;border-top:1px solid var(--rule);
  font-size:11.5px;line-height:1.65;color:var(--ink-faint);max-width:80ch}
.foot b{color:var(--ink-soft)}
.call{margin-top:26px;background:var(--midnight);color:#fff;border-radius:10px;padding:20px 24px;
  display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:14px}
.call span{font-size:14.5px;font-weight:600;color:#D7E8EC}
.call a{font-family:"DM Serif Display",Georgia,serif;font-size:25px;color:var(--mint);text-decoration:none}
@media (prefers-color-scheme:dark){
  :root:not([data-theme="light"]){--wash:#0B1620;--ink:#E8F1F5;--ink-soft:#A8BCC8;--ink-faint:#7B8C9A;--rule:#1E3140}
  :root:not([data-theme="light"]) body{background:var(--wash)}
  :root:not([data-theme="light"]) .card{background:#11212D}
  :root:not([data-theme="light"]) .cname{color:#E8F1F5}
  :root:not([data-theme="light"]) .camt{color:var(--mint)}
}
</style>
</head>
<body>
<header><div class="in">
  <div class="brand"><span class="mark"></span><span class="bn">${esc(BRAND.company)}</span></div>
  <h1>One page on each way we can fund you.</h1>
  <p>${WORD[sheets.length] ?? sheets.length} programs, and the honest version of each — what it is for, what you need, what it costs you to talk to us, and when it is the wrong fit. Download any of them.</p>
</div></header>
<main>
  <div class="grid">
${cards}
  </div>

  <div class="call">
    <span>Not sure which one you are? That is a two-minute phone call.</span>
    <a href="${esc(BRAND.phoneHref)}">${esc(BRAND.phone)}</a>
  </div>

  <p class="foot"><b>${esc(BRAND.legal)}.</b> ${esc(BRAND.company)} is a broker, not a funder or a lender. We are paid by the funding company or lender when your funding completes, never by you, and we charge no upfront fees of any kind. Nothing on this page or in these documents is an offer, an approval or a commitment to fund or to lend. A merchant cash advance is the purchase of a portion of your future receivables and is not a loan. Amounts, costs and terms are set by underwriting and are given to you in writing before you sign anything.</p>
</main>
</body>
</html>`;
}
