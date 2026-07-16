// OSNav — the standalone top nav for INTERIOR pages on the Momentum OS design.
// Mirrors the header embedded in OSHero (which owns the "/" hero and keeps its own
// copy so the landing stays self-contained); interior pages mount this instead.
// Any link change here should be mirrored in OSHero's header, and vice versa.
import { Link } from "react-router-dom";
import ThemeToggle from "../../ui/ThemeToggle";

export default function OSNav() {
  return (
    <header className="osn-nav">
      <style>{CSS}</style>
      <div className="os-container osn-navrow">
        <Link to="/" className="osn-brand">
          <span className="osn-mark">M</span>
          <span className="osn-brandname">Momentum</span>
          <span className="osn-brandsub">by Agentic Voice Inc.</span>
        </Link>
        <nav className="osn-links">
          <Link to="/business-loans">Funding</Link>
          <Link to="/real-estate">Real estate</Link>
          <Link to="/resources">Resources</Link>
          <Link to="/auth/sign-in" className="osn-signin">Sign in</Link>
          <Link to="/apply" className="osn-navcta">Check your rate</Link>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}

const CSS = `
.osn-nav{position:relative;z-index:3;border-bottom:1px solid var(--hair2);background:var(--ink)}
.osn-navrow{display:flex;align-items:center;justify-content:space-between;padding-top:20px;padding-bottom:20px}
.osn-brand{display:flex;align-items:baseline;gap:10px;text-decoration:none;color:var(--tx)}
.osn-mark{font-family:'Anton',sans-serif;font-size:20px;width:34px;height:34px;display:grid;place-items:center;color:var(--on-green);background:var(--go);border-radius:8px;transform:translateY(2px)}
.osn-brandname{font-family:'Anton',sans-serif;letter-spacing:.02em;font-size:22px}
.osn-brandsub{font-family:'Space Mono',monospace;font-size:11px;color:var(--faint)}
.osn-links{display:flex;align-items:center;gap:26px}
.osn-links a{color:var(--muted);text-decoration:none;font-size:14px;font-weight:500}
.osn-links a:hover{color:var(--tx)}
.osn-navcta{color:var(--on-green)!important;background:var(--go);padding:9px 16px;border-radius:8px;font-weight:600!important}
.osn-signin{padding:9px 12px;border:1px solid var(--hair2);border-radius:8px}
@media (max-width:920px){
  .osn-links a:not(.osn-navcta):not(.osn-signin){display:none}
  .osn-brandsub{display:none}
}
`;
