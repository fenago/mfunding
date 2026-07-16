// OSFooter — the standalone footer for INTERIOR pages on the Momentum OS design.
// Mirrors the footer embedded in OSFinalCTA (which owns the "/" closing panel and
// keeps its own copy); interior pages mount this instead. Any link or legal-copy
// change here should be mirrored there, and vice versa.
import { Link } from "react-router-dom";

export default function OSFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="osnf">
      <style>{CSS}</style>
      <div className="os-container osnf-row">
        <div className="osnf-brand">
          <span className="osnf-mark">M</span>
          <div>
            <div className="osnf-name">Momentum Funding</div>
            <div className="osnf-sub os-mono">Agentic Voice Inc. · mfunding.net</div>
          </div>
        </div>
        <div className="osnf-links">
          <Link to="/business-loans">Funding</Link>
          <Link to="/apply">Apply</Link>
          <Link to="/about">About</Link>
          <Link to="/contact">Contact</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
        </div>
      </div>
      <div className="os-container osnf-legal os-mono">
        © {year} Agentic Voice Inc. d/b/a Momentum Funding. Momentum Funding is a brand of
        Agentic Voice Inc., a financial services company. Funding is subject to approval; terms
        vary by business qualifications.
      </div>
    </footer>
  );
}

const CSS = `
.osnf{background:var(--ink);border-top:1px solid var(--hair);padding:44px 0 40px}
.osnf-row{display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap;margin-bottom:24px}
.osnf-brand{display:flex;align-items:center;gap:12px}
.osnf-mark{font-family:'Anton',sans-serif;font-size:18px;width:34px;height:34px;display:grid;place-items:center;color:var(--on-green);background:var(--go);border-radius:8px}
.osnf-name{font-family:'Anton',sans-serif;font-size:18px;letter-spacing:.02em}
.osnf-sub{font-size:11px;color:var(--faint);margin-top:2px}
.osnf-links{display:flex;gap:22px;flex-wrap:wrap}
.osnf-links a{color:var(--muted);text-decoration:none;font-size:14px}
.osnf-links a:hover{color:var(--go-text)}
.osnf-legal{font-size:11px;line-height:1.7;color:var(--faint);max-width:70em}
`;
