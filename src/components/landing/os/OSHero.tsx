// OSHero — the hero + top nav for the Momentum OS landing.
// Signature element: the honest 48-hour dispatch clock (Apply -> Underwriting ->
// Funded), framed as an illustrative timeline so it never poses as a real account.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CTAPrimary, CTAGhost } from "./OSKit";
import ThemeToggle from "../../ui/ThemeToggle";

const START = 48 * 3600;
const fmt = (t: number): [string, string, string] => {
  const p = (n: number) => String(n).padStart(2, "0");
  return [p(Math.floor(t / 3600)), p(Math.floor((t % 3600) / 60)), p(t % 60)];
};

export default function OSHero() {
  const [rem, setRem] = useState(START - 8 * 60 - 12);
  const reduced = useRef(false);
  useEffect(() => {
    reduced.current = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reduced.current) return;
    const id = window.setInterval(() => setRem((r) => (r <= 0 ? START : r - 1)), 1000);
    return () => clearInterval(id);
  }, []);
  const [hh, mm, ss] = fmt(rem);

  return (
    <div className="osh">
      <style>{CSS}</style>

      <header className="osh-nav">
        <div className="os-container osh-navrow">
          <Link to="/" className="osh-brand">
            <span className="osh-mark">M</span>
            <span className="osh-brandname">Momentum</span>
            <span className="osh-brandsub">by Agentic Voice Inc.</span>
          </Link>
          <nav className="osh-links">
            <Link to="/business-loans">Funding</Link>
            <a href="#how">How it works</a>
            <a href="#who">Who we fund</a>
            <Link to="/auth/sign-in" className="osh-signin">Sign in</Link>
            <Link to="/apply" className="osh-navcta">Check your rate</Link>
            <ThemeToggle />
          </nav>
        </div>
      </header>

      <div className="os-container osh-grid">
        <div className="osh-left">
          <p className="os-eyebrow"><span className="os-eyedot" />THE BANK SAID NO?</p>
          <h1 className="osh-h1">FUNDED IN<br /><span className="os-go">48 HOURS.</span></h1>
          <p className="osh-sub">
            Working capital for the businesses banks won&rsquo;t touch — contractors,
            restaurants, trucking, retail. Approved on your <strong>cash flow</strong>,
            not your credit score.
          </p>
          <div className="osh-ctas">
            <CTAPrimary href="/apply">Check your rate — free</CTAPrimary>
            <CTAGhost href="#how">How it works</CTAGhost>
          </div>
          <p className="osh-trust">WON&rsquo;T AFFECT YOUR CREDIT&nbsp;&nbsp;·&nbsp;&nbsp;NO UPFRONT FEES&nbsp;&nbsp;·&nbsp;&nbsp;5-MIN APPLICATION</p>
          <p className="osh-fine">Not a loan. An MCA is a purchase of future receivables.</p>
        </div>

        <div className="osh-right">
          <div className="osh-board">
            <div className="osh-board-top">
              <span className="osh-board-title">MOMENTUM · FUNDING QUEUE</span>
              <span className="osh-liveflag"><span className="osh-liveflag-dot" />LIVE</span>
            </div>
            <div className="osh-clock">
              <div className="osh-clock-num">
                <span>{hh}</span><i>:</i><span>{mm}</span><i>:</i><span className="osh-clock-sec">{ss}</span>
              </div>
              <div className="osh-clock-label">TIME TO FUNDED · TYPICAL</div>
            </div>
            <div className="osh-rows">
              <Row n="01" label="APPLICATION" status="RECEIVED" note="~5 min" state="done" />
              <Row n="02" label="UNDERWRITING" status="IN REVIEW" note="~24 hrs" state="live" />
              <Row n="03" label="FUNDS WIRED" status="PENDING" note="same day" state="wait" />
            </div>
            <div className="osh-progress"><span /></div>
            <p className="osh-board-fine">Illustrative timeline — most deals fund in 24&ndash;48 hrs.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ n, label, status, note, state }: {
  n: string; label: string; status: string; note: string; state: "done" | "live" | "wait";
}) {
  return (
    <div className={`osh-row osh-row-${state}`}>
      <span className="osh-row-n">{n}</span>
      <span className="osh-row-label">{label}</span>
      <span className="osh-row-status">
        {state === "done" && <span className="os-check">✓</span>}
        {state === "live" && <span className="osh-pulse" />}
        {status}
      </span>
      <span className="osh-row-note">{note}</span>
    </div>
  );
}

const CSS = `
.osh{position:relative; background:var(--ink);
  background-image:linear-gradient(var(--hair) 1px,transparent 1px),linear-gradient(90deg,var(--hair) 1px,transparent 1px);
  background-size:64px 64px;}
.osh::before{content:"";position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(120% 80% at 80% -5%,rgba(22,217,146,.10),transparent 55%),radial-gradient(70% 60% at 0% 110%,rgba(11,169,104,.08),transparent 60%);}

.osh-nav{position:relative;z-index:3;border-bottom:1px solid var(--hair2)}
.osh-navrow{display:flex;align-items:center;justify-content:space-between;padding-top:20px;padding-bottom:20px}
.osh-brand{display:flex;align-items:baseline;gap:10px;text-decoration:none;color:var(--tx)}
.osh-mark{font-family:'Anton',sans-serif;font-size:20px;width:34px;height:34px;display:grid;place-items:center;color:var(--on-green);background:var(--go);border-radius:8px;transform:translateY(2px)}
.osh-brandname{font-family:'Anton',sans-serif;letter-spacing:.02em;font-size:22px}
.osh-brandsub{font-family:'Space Mono',monospace;font-size:11px;color:var(--faint)}
.osh-links{display:flex;align-items:center;gap:26px}
.osh-links a{color:var(--muted);text-decoration:none;font-size:14px;font-weight:500}
.osh-links a:hover{color:var(--tx)}
.osh-navcta{color:var(--on-green)!important;background:var(--go);padding:9px 16px;border-radius:8px;font-weight:600!important}
.osh-signin{padding:9px 12px;border:1px solid var(--hair2);border-radius:8px}

.osh-grid{position:relative;z-index:2;display:grid;grid-template-columns:1.05fr .95fr;gap:56px;align-items:center;padding-top:64px;padding-bottom:96px}
.osh-left{animation:os-in .7s cubic-bezier(.2,.7,.2,1) both}
.osh-h1{font-family:'Anton',sans-serif;font-weight:400;text-transform:uppercase;letter-spacing:.005em;font-size:clamp(52px,7.2vw,100px);line-height:.9;margin:0 0 22px}
.osh-sub{font-size:18px;line-height:1.6;color:var(--lede);max-width:30em;margin:0 0 30px}
.osh-sub strong{color:var(--tx);font-weight:600}
.osh-ctas{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:26px}
.osh-trust{font-family:'Space Mono',monospace;font-size:12px;letter-spacing:.05em;color:var(--muted);margin:0 0 8px}
.osh-fine{font-size:12.5px;color:var(--faint);margin:0}

.osh-right{animation:os-in .7s .1s cubic-bezier(.2,.7,.2,1) both}
.osh-board{background:linear-gradient(180deg,var(--panel),var(--ink2));border:1px solid var(--hair);border-radius:16px;padding:22px;box-shadow:0 40px 80px -30px var(--shadow),inset 0 1px 0 rgba(255,255,255,.05)}
.osh-board-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px}
.osh-board-title{font-family:'Space Mono',monospace;font-size:12px;letter-spacing:.12em;color:var(--muted)}
.osh-liveflag{font-family:'Space Mono',monospace;font-size:11px;letter-spacing:.14em;color:var(--go-text);display:flex;align-items:center;gap:7px}
.osh-liveflag-dot{width:7px;height:7px;border-radius:9px;background:var(--go);animation:os-blink 1.6s ease-in-out infinite}
.osh-clock{text-align:center;padding:22px 12px 20px;margin-bottom:16px;border:1px solid rgba(246,178,75,.22);border-radius:12px;background:rgba(246,178,75,.05)}
.osh-clock-num{font-family:'Space Mono',monospace;font-weight:700;font-size:clamp(38px,6vw,58px);color:var(--amber);letter-spacing:.02em;line-height:1}
.osh-clock-num i{opacity:.5;font-style:normal;padding:0 2px}
.osh-clock-sec{color:var(--amber-hi)}
.osh-clock-label{font-family:'Space Mono',monospace;font-size:11px;letter-spacing:.18em;color:var(--faint);margin-top:12px}
.osh-rows{display:flex;flex-direction:column;gap:2px;margin-bottom:16px}
.osh-row{display:grid;grid-template-columns:auto 1fr auto auto;align-items:center;gap:14px;font-family:'Space Mono',monospace;font-size:13px;padding:13px 4px;border-bottom:1px solid var(--hair)}
.osh-row:last-child{border-bottom:none}
.osh-row-n{color:var(--faint)}
.osh-row-label{color:var(--tx);letter-spacing:.04em}
.osh-row-status{display:flex;align-items:center;gap:8px;font-size:12px;letter-spacing:.06em;justify-self:end}
.osh-row-note{color:var(--faint);font-size:12px;min-width:64px;text-align:right}
.osh-row-done .osh-row-status{color:var(--go-text)}
.osh-row-live .osh-row-status{color:var(--amber)}
.osh-row-wait{opacity:.55}
.osh-row-wait .osh-row-status{color:var(--muted)}
.osh-pulse{width:8px;height:8px;border-radius:9px;background:var(--amber);animation:os-ping 1.6s ease-out infinite}
.osh-progress{height:6px;border-radius:6px;background:rgba(255,255,255,.06);overflow:hidden;margin-bottom:12px}
.osh-progress span{display:block;height:100%;width:42%;background:linear-gradient(90deg,var(--go-deep),var(--go));border-radius:6px}
.osh-board-fine{font-family:'Space Mono',monospace;font-size:11px;color:var(--faint);text-align:center;margin:0}

@media (max-width:920px){
  .osh-grid{grid-template-columns:1fr;gap:40px;padding-top:44px;padding-bottom:64px}
  .osh-links a:not(.osh-navcta):not(.osh-signin){display:none}
  .osh-brandsub{display:none}
}
@media (prefers-reduced-motion:reduce){.osh-left,.osh-right{animation:none}.osh-liveflag-dot,.osh-pulse{animation:none}}
`;
