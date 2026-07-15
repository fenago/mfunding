// OSFinalCTA — the closing "check your rate" panel + footer, dispatch-board style.
import { Link } from "react-router-dom";
import { OSSection, Eyebrow, CTAPrimary } from "./OSKit";

export default function OSFinalCTA() {
  const year = new Date().getFullYear();
  return (
    <>
      <OSSection tone="ink" className="osf">
        <style>{CSS}</style>
        <div className="osf-panel">
          <Eyebrow>YOUR 48-HOUR CLOCK STARTS NOW</Eyebrow>
          <h2 className="os-display osf-h">
            STOP WAITING ON<br /><span className="os-go">THE BANK.</span>
          </h2>
          <p className="os-lede osf-lede">
            Five minutes to apply. No hit to your credit. No upfront fees. See real
            numbers before you commit to anything.
          </p>
          <div className="osf-ctas">
            <CTAPrimary href="/apply">Check your rate — free</CTAPrimary>
            <a href="tel:+19547375692" className="osf-call">or call (954) 737-5692</a>
          </div>
          <p className="osf-fine os-mono">MON–FRI · 9AM–6PM ET · MCA = A PURCHASE OF FUTURE RECEIVABLES, NOT A LOAN</p>
        </div>
      </OSSection>

      <footer className="osfoot">
        <div className="os-container osfoot-row">
          <div className="osfoot-brand">
            <span className="osfoot-mark">M</span>
            <div>
              <div className="osfoot-name">Momentum Funding</div>
              <div className="osfoot-sub os-mono">Agentic Voice Inc. · mfunding.net</div>
            </div>
          </div>
          <div className="osfoot-links">
            <Link to="/business-loans">Funding</Link>
            <Link to="/apply">Apply</Link>
            <Link to="/about">About</Link>
            <Link to="/contact">Contact</Link>
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
          </div>
        </div>
        <div className="os-container osfoot-legal os-mono">
          © {year} Agentic Voice Inc. d/b/a Momentum Funding. Momentum Funding is a brand of
          Agentic Voice Inc., a financial services company. Funding is subject to approval; terms
          vary by business qualifications.
        </div>
      </footer>
    </>
  );
}

const CSS = `
.osf-panel{
  position:relative; text-align:center; max-width:820px; margin:0 auto;
  border:1px solid var(--hair); border-radius:20px; padding:64px 32px;
  background:
    radial-gradient(90% 120% at 50% -20%, rgba(22,217,146,.12), transparent 60%),
    linear-gradient(180deg,var(--panel),var(--ink2));
  box-shadow:0 40px 90px -40px var(--shadow);
}
.osf-panel .os-eyebrow{justify-content:center}
.osf-h{font-size:clamp(38px,5.4vw,72px)}
.osf-lede{margin:0 auto 30px}
.osf-ctas{display:flex;align-items:center;justify-content:center;gap:20px;flex-wrap:wrap;margin-bottom:22px}
.osf-call{color:var(--muted);text-decoration:none;font-weight:500;font-size:15px}
.osf-call:hover{color:var(--tx)}
.osf-fine{font-size:11px;letter-spacing:.08em;color:var(--faint);margin:0}

.osfoot{background:var(--ink);border-top:1px solid var(--hair);padding:44px 0 40px}
.osfoot-row{display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap;margin-bottom:24px}
.osfoot-brand{display:flex;align-items:center;gap:12px}
.osfoot-mark{font-family:'Anton',sans-serif;font-size:18px;width:34px;height:34px;display:grid;place-items:center;color:var(--on-green);background:var(--go);border-radius:8px}
.osfoot-name{font-family:'Anton',sans-serif;font-size:18px;letter-spacing:.02em}
.osfoot-sub{font-size:11px;color:var(--faint);margin-top:2px}
.osfoot-links{display:flex;gap:22px;flex-wrap:wrap}
.osfoot-links a{color:var(--muted);text-decoration:none;font-size:14px}
.osfoot-links a:hover{color:var(--go)}
.osfoot-legal{font-size:11px;line-height:1.7;color:var(--faint);max-width:70em}
`;
