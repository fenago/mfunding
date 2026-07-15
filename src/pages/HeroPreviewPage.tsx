// HeroPreviewPage — a THROWAWAY design preview at /hero-preview.
//
// Purpose: prove a distinct hero direction next to the live one without touching it.
// Direction: "the operator's side, at speed." Not a fintech dashboard — a dispatch
// board. The one memorable element (the signature) is an honest 48-hour clock: the
// real Apply -> Review -> Funded process with a live countdown, framed explicitly as
// illustrative so it never pretends to be a real merchant's account.
//
// Fully self-contained: scoped palette + fonts + CSS live in this file, so it can't
// affect or be affected by the rest of the app. Reduced motion is respected. No
// scroll animations. Compliance kept: MCA is called a purchase of receivables, never
// a loan; no fabricated volume stats.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

const FONT_HREF =
  "https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap";

const START_SECONDS = 48 * 3600; // the promise, as a countdown

function fmt(total: number): [string, string, string] {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return [p(h), p(m), p(s)];
}

export default function HeroPreviewPage() {
  const [remaining, setRemaining] = useState(START_SECONDS - 8 * 60 - 12); // ~47:51:48
  const reduced = useRef(false);

  useEffect(() => {
    // Load the display/body/mono faces (scoped to this preview via useEffect).
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = FONT_HREF;
    document.head.appendChild(link);

    reduced.current =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    let id: number | undefined;
    if (!reduced.current) {
      id = window.setInterval(() => {
        setRemaining((r) => (r <= 0 ? START_SECONDS : r - 1));
      }, 1000);
    }
    return () => {
      if (id) clearInterval(id);
      link.remove();
    };
  }, []);

  const [hh, mm, ss] = fmt(remaining);

  return (
    <div className="hp-root">
      <style>{CSS}</style>

      {/* preview ribbon so it's obvious this isn't live */}
      <div className="hp-ribbon">
        <span className="hp-ribbon-dot" /> PREVIEW · new hero direction
        <Link to="/" className="hp-ribbon-link">compare to live ↗</Link>
      </div>

      <header className="hp-nav">
        <div className="hp-brand">
          <span className="hp-mark">M</span>
          <span className="hp-brandname">Momentum</span>
          <span className="hp-brandsub">by Agentic Voice Inc.</span>
        </div>
        <nav className="hp-navlinks">
          <a href="#">Funding</a>
          <a href="#">How it works</a>
          <a href="#">Who we fund</a>
          <a className="hp-navcta" href="#">Check your rate</a>
        </nav>
      </header>

      <main className="hp-hero">
        <div className="hp-grid">
          {/* LEFT — the pitch */}
          <div className="hp-left">
            <p className="hp-eyebrow"><span className="hp-eyedot" />THE BANK SAID NO?</p>
            <h1 className="hp-h1">
              FUNDED IN<br />
              <span className="hp-go">48 HOURS.</span>
            </h1>
            <p className="hp-sub">
              Working capital for the businesses banks won&rsquo;t touch — contractors,
              restaurants, trucking, retail. Approved on your <strong>cash flow</strong>,
              not your credit score.
            </p>

            <div className="hp-ctas">
              <a href="#" className="hp-cta-primary">Check your rate — free <span aria-hidden>→</span></a>
              <a href="#" className="hp-cta-ghost">How it works</a>
            </div>

            <p className="hp-trust">
              WON&rsquo;T AFFECT YOUR CREDIT&nbsp;&nbsp;·&nbsp;&nbsp;NO UPFRONT FEES&nbsp;&nbsp;·&nbsp;&nbsp;5-MIN APPLICATION
            </p>
            <p className="hp-fine">
              Not a loan. An MCA is a purchase of future receivables.
            </p>
          </div>

          {/* RIGHT — the signature: the 48-hour clock, as a dispatch board */}
          <div className="hp-right">
            <div className="hp-board">
              <div className="hp-board-top">
                <span className="hp-board-title">MOMENTUM · FUNDING QUEUE</span>
                <span className="hp-live"><span className="hp-live-dot" />LIVE</span>
              </div>

              <div className="hp-clock">
                <div className="hp-clock-num">
                  <span>{hh}</span><i>:</i><span>{mm}</span><i>:</i><span className="hp-clock-sec">{ss}</span>
                </div>
                <div className="hp-clock-label">TIME TO FUNDED · TYPICAL</div>
              </div>

              <div className="hp-rows">
                <Row n="01" label="APPLICATION" status="RECEIVED" note="~5 min" state="done" />
                <Row n="02" label="UNDERWRITING" status="IN REVIEW" note="~24 hrs" state="live" />
                <Row n="03" label="FUNDS WIRED" status="PENDING" note="same day" state="wait" />
              </div>

              <div className="hp-progress"><span style={{ width: "42%" }} /></div>
              <p className="hp-board-fine">Illustrative timeline — most deals fund in 24–48 hrs.</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function Row({
  n, label, status, note, state,
}: { n: string; label: string; status: string; note: string; state: "done" | "live" | "wait" }) {
  return (
    <div className={`hp-row hp-row-${state}`}>
      <span className="hp-row-n">{n}</span>
      <span className="hp-row-label">{label}</span>
      <span className="hp-row-status">
        {state === "done" && <span className="hp-check">✓</span>}
        {state === "live" && <span className="hp-pulse" />}
        {status}
      </span>
      <span className="hp-row-note">{note}</span>
    </div>
  );
}

const CSS = `
.hp-root{
  --ink:#070B14; --ink2:#0E1524; --panel:#111A2C; --hair:rgba(255,255,255,.09);
  --tx:#E9EEF2; --muted:#8695A6; --faint:#57687B;
  --go:#16D992; --go-deep:#0BA968; --amber:#F6B24B; --paper:#F3ECDD;
  min-height:100vh; background:var(--ink); color:var(--tx);
  font-family:'Inter',system-ui,sans-serif; position:relative; overflow-x:hidden;
  /* faint dispatch-board grid, NOT a gradient blob */
  background-image:
    linear-gradient(var(--hair) 1px,transparent 1px),
    linear-gradient(90deg,var(--hair) 1px,transparent 1px);
  background-size:64px 64px; background-position:center top;
}
.hp-root::before{
  content:""; position:absolute; inset:0; pointer-events:none;
  background:radial-gradient(120% 80% at 78% 0%, rgba(22,217,146,.10), transparent 55%),
             radial-gradient(80% 60% at 0% 100%, rgba(11,169,104,.08), transparent 60%);
}
.hp-root *{box-sizing:border-box}

.hp-ribbon{
  position:relative; z-index:3; display:flex; align-items:center; gap:10px;
  font-family:'Space Mono',monospace; font-size:12px; letter-spacing:.06em;
  color:var(--amber); background:rgba(246,178,75,.08);
  border-bottom:1px solid rgba(246,178,75,.22); padding:8px 20px;
}
.hp-ribbon-dot{width:7px;height:7px;border-radius:9px;background:var(--amber)}
.hp-ribbon-link{margin-left:auto;color:var(--muted);text-decoration:none}
.hp-ribbon-link:hover{color:var(--tx)}

.hp-nav{
  position:relative; z-index:3; display:flex; align-items:center; justify-content:space-between;
  max-width:1200px; margin:0 auto; padding:22px 24px;
}
.hp-brand{display:flex;align-items:baseline;gap:10px}
.hp-mark{
  font-family:'Anton',sans-serif; font-size:20px; line-height:1;
  width:34px;height:34px; display:grid;place-items:center; color:var(--ink);
  background:var(--go); border-radius:8px; transform:translateY(2px);
}
.hp-brandname{font-family:'Anton',sans-serif; letter-spacing:.02em; font-size:22px}
.hp-brandsub{font-family:'Space Mono',monospace; font-size:11px; color:var(--faint)}
.hp-navlinks{display:flex;align-items:center;gap:26px}
.hp-navlinks a{color:var(--muted);text-decoration:none;font-size:14px;font-weight:500}
.hp-navlinks a:hover{color:var(--tx)}
.hp-navcta{
  color:var(--ink)!important; background:var(--go); padding:9px 16px; border-radius:8px; font-weight:600!important;
}

.hp-hero{position:relative; z-index:2; max-width:1200px; margin:0 auto; padding:40px 24px 80px}
.hp-grid{display:grid; grid-template-columns:1.05fr .95fr; gap:56px; align-items:center}

.hp-left{animation:hp-in .7s cubic-bezier(.2,.7,.2,1) both}
.hp-eyebrow{
  font-family:'Space Mono',monospace; font-size:13px; letter-spacing:.18em; color:var(--muted);
  display:flex; align-items:center; gap:10px; margin:0 0 18px;
}
.hp-eyedot{width:8px;height:8px;border-radius:9px;background:var(--go);box-shadow:0 0 0 4px rgba(22,217,146,.16)}
.hp-h1{
  font-family:'Anton',sans-serif; font-weight:400; letter-spacing:.005em;
  font-size:clamp(52px,7.4vw,104px); line-height:.9; margin:0 0 22px; text-transform:uppercase;
}
.hp-go{color:var(--go); text-shadow:0 0 40px rgba(22,217,146,.28)}
.hp-sub{font-size:18px; line-height:1.6; color:#C4CFDA; max-width:30em; margin:0 0 30px}
.hp-sub strong{color:var(--tx); font-weight:600}

.hp-ctas{display:flex; gap:14px; flex-wrap:wrap; margin-bottom:26px}
.hp-cta-primary{
  background:var(--go); color:var(--ink); font-weight:700; font-size:15px;
  padding:15px 26px; border-radius:10px; text-decoration:none; display:inline-flex; gap:10px;
  box-shadow:0 10px 30px -8px rgba(22,217,146,.5); transition:transform .15s, box-shadow .15s;
}
.hp-cta-primary:hover{transform:translateY(-2px); box-shadow:0 16px 40px -10px rgba(22,217,146,.6)}
.hp-cta-ghost{
  border:1px solid var(--hair); color:var(--tx); font-weight:600; font-size:15px;
  padding:15px 24px; border-radius:10px; text-decoration:none; display:inline-flex; align-items:center;
  transition:border-color .15s, background .15s;
}
.hp-cta-ghost:hover{border-color:var(--go); background:rgba(22,217,146,.06)}
.hp-cta-primary:focus-visible,.hp-cta-ghost:focus-visible,.hp-navcta:focus-visible{outline:2px solid var(--go); outline-offset:3px}

.hp-trust{font-family:'Space Mono',monospace; font-size:12px; letter-spacing:.05em; color:var(--muted); margin:0 0 8px}
.hp-fine{font-size:12.5px; color:var(--faint); margin:0}

/* SIGNATURE — the dispatch board */
.hp-right{animation:hp-in .7s .1s cubic-bezier(.2,.7,.2,1) both}
.hp-board{
  background:linear-gradient(180deg,var(--panel),var(--ink2));
  border:1px solid var(--hair); border-radius:16px; padding:22px;
  box-shadow:0 40px 80px -30px rgba(0,0,0,.7), inset 0 1px 0 rgba(255,255,255,.05);
}
.hp-board-top{display:flex; align-items:center; justify-content:space-between; margin-bottom:18px}
.hp-board-title{font-family:'Space Mono',monospace; font-size:12px; letter-spacing:.12em; color:var(--muted)}
.hp-live{font-family:'Space Mono',monospace; font-size:11px; letter-spacing:.14em; color:var(--go); display:flex; align-items:center; gap:7px}
.hp-live-dot{width:7px;height:7px;border-radius:9px;background:var(--go); animation:hp-blink 1.6s ease-in-out infinite}

.hp-clock{
  text-align:center; padding:22px 12px 20px; margin-bottom:16px;
  border:1px solid rgba(246,178,75,.22); border-radius:12px; background:rgba(246,178,75,.05);
}
.hp-clock-num{font-family:'Space Mono',monospace; font-weight:700; font-size:clamp(38px,6vw,58px); color:var(--amber); letter-spacing:.02em; line-height:1}
.hp-clock-num i{opacity:.5; font-style:normal; padding:0 2px}
.hp-clock-sec{color:#FFD79A}
.hp-clock-label{font-family:'Space Mono',monospace; font-size:11px; letter-spacing:.18em; color:var(--faint); margin-top:12px}

.hp-rows{display:flex; flex-direction:column; gap:2px; margin-bottom:16px}
.hp-row{
  display:grid; grid-template-columns:auto 1fr auto auto; align-items:center; gap:14px;
  font-family:'Space Mono',monospace; font-size:13px; padding:13px 4px; border-bottom:1px solid var(--hair);
}
.hp-row:last-child{border-bottom:none}
.hp-row-n{color:var(--faint)}
.hp-row-label{color:var(--tx); letter-spacing:.04em}
.hp-row-status{display:flex; align-items:center; gap:8px; font-size:12px; letter-spacing:.06em; justify-self:end}
.hp-row-note{color:var(--faint); font-size:12px; min-width:64px; text-align:right}
.hp-row-done .hp-row-status{color:var(--go)}
.hp-row-live .hp-row-status{color:var(--amber)}
.hp-row-wait{opacity:.55}
.hp-row-wait .hp-row-status{color:var(--muted)}
.hp-check{color:var(--go)}
.hp-pulse{width:8px;height:8px;border-radius:9px;background:var(--amber); box-shadow:0 0 0 0 rgba(246,178,75,.6); animation:hp-ping 1.6s ease-out infinite}

.hp-progress{height:6px; border-radius:6px; background:rgba(255,255,255,.06); overflow:hidden; margin-bottom:12px}
.hp-progress span{display:block; height:100%; background:linear-gradient(90deg,var(--go-deep),var(--go)); border-radius:6px}
.hp-board-fine{font-family:'Space Mono',monospace; font-size:11px; color:var(--faint); text-align:center; margin:0}

@keyframes hp-in{from{opacity:0; transform:translateY(16px)} to{opacity:1; transform:none}}
@keyframes hp-blink{0%,100%{opacity:1} 50%{opacity:.25}}
@keyframes hp-ping{0%{box-shadow:0 0 0 0 rgba(246,178,75,.55)} 70%{box-shadow:0 0 0 10px rgba(246,178,75,0)} 100%{box-shadow:0 0 0 0 rgba(246,178,75,0)}}

@media (max-width:920px){
  .hp-grid{grid-template-columns:1fr; gap:40px}
  .hp-navlinks a:not(.hp-navcta){display:none}
  .hp-brandsub{display:none}
}
@media (prefers-reduced-motion:reduce){
  .hp-left,.hp-right{animation:none}
  .hp-live-dot,.hp-pulse{animation:none}
  .hp-cta-primary:hover{transform:none}
}
`;
