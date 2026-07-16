// 404Page — "route not found" on the Momentum OS design, played as a dispatch board
// that lost the signal. Same route behavior (a dead-end that points home); the copy
// leans into the operator/dispatch voice.
import { Link } from "react-router-dom";
import ScrollToTop from "../components/ui/ScrollToTop";
import { OS_CSS, useOSFonts } from "../components/landing/os/OSKit";
import OSNav from "../components/landing/os/OSNav";
import OSFooter from "../components/landing/os/OSFooter";
import SEO from "../components/seo/SEO";

const NotFoundPage: React.FC = () => {
  useOSFonts();
  return (
    <div className="os-root">
      <style>{OS_CSS}</style>
      <style>{CSS}</style>
      <SEO title="Page Not Found" description="This route isn't on the board. Head back to Momentum Funding." />
      <ScrollToTop />
      <OSNav />

      <main className="os404-main">
        <div className="os-container">
          <div className="os404-panel">
            <div className="os404-boardtop">
              <span className="os404-boardtitle os-mono"><span className="os404-dot" />DISPATCH BOARD</span>
              <span className="os404-status os-mono">NO SIGNAL</span>
            </div>

            <p className="os404-eyebrow os-mono">ERROR 404 · ROUTE NOT FOUND</p>
            <h1 className="os404-code">404</h1>
            <p className="os404-head">
              THIS ROUTE ISN&rsquo;T<br /><span className="os-go">ON THE BOARD.</span>
            </p>
            <p className="os404-lede">
              The page you were looking for got rerouted, retired, or never existed.
              No dead ends here — let&rsquo;s get you back to something that moves.
            </p>

            <div className="os404-log os-mono">
              <span className="os404-logline"><span className="os404-x">✗</span> requested page … <em>not found</em></span>
              <span className="os404-logline"><span className="os404-c">✓</span> nearest exit … <em>homepage</em></span>
              <span className="os404-logline"><span className="os404-c">✓</span> fastest path to capital … <em>check your rate</em></span>
            </div>

            <div className="os404-cta">
              <Link to="/" className="os404-primary">Back to home <span aria-hidden>→</span></Link>
              <Link to="/apply" className="os404-ghost">Check your rate</Link>
            </div>
          </div>
        </div>
      </main>

      <OSFooter />
    </div>
  );
};

export default NotFoundPage;

const CSS = `
.os404-main{background:var(--ink);padding:64px 0 96px;min-height:64vh;display:flex;align-items:center}
.os404-panel{
  max-width:680px;margin:0 auto;
  background:linear-gradient(180deg,var(--panel),var(--panel2));
  border:1px solid var(--hair);border-radius:18px;padding:34px 34px 38px;
  position:relative;overflow:hidden;
}
.os404-panel::before{
  content:"";position:absolute;inset:0;pointer-events:none;
  background:
    linear-gradient(var(--hair2) 1px,transparent 1px),
    linear-gradient(90deg,var(--hair2) 1px,transparent 1px);
  background-size:44px 44px,44px 44px;opacity:.7;
}
.os404-panel>*{position:relative}

.os404-boardtop{
  display:flex;align-items:center;justify-content:space-between;gap:16px;
  font-size:12px;letter-spacing:.14em;color:var(--muted);
  padding-bottom:14px;margin-bottom:22px;border-bottom:1px solid var(--hair);
}
.os404-boardtitle{display:inline-flex;align-items:center;gap:10px;color:var(--tx)}
.os404-dot{width:8px;height:8px;border-radius:9px;background:var(--amber);animation:os-ping 1.6s ease-out infinite}
.os404-status{color:var(--amber)}

.os404-eyebrow{font-size:12px;letter-spacing:.18em;color:var(--muted);margin:0 0 8px}
.os404-code{
  font-family:'Anton',sans-serif;font-weight:400;letter-spacing:.02em;line-height:.9;
  font-size:clamp(72px,15vw,132px);color:var(--tx);margin:0;
}
.os404-head{
  font-family:'Anton',sans-serif;font-weight:400;text-transform:uppercase;letter-spacing:.006em;
  line-height:.94;font-size:clamp(24px,4.4vw,40px);color:var(--tx);margin:6px 0 0;
}
.os404-lede{font-size:16.5px;line-height:1.65;color:var(--lede);max-width:40em;margin:20px 0 0}

.os404-log{
  margin:28px 0 0;padding:18px 20px;border:1px solid var(--hair);border-radius:12px;
  background:rgba(0,0,0,.14);display:flex;flex-direction:column;gap:9px;
  font-size:13px;letter-spacing:.02em;color:var(--muted);
}
.dark .os404-log{background:rgba(0,0,0,.28)}
.os404-logline{display:flex;align-items:center;gap:10px}
.os404-logline em{font-style:normal;color:var(--tx)}
.os404-x{color:#D9553F}
.os404-c{color:var(--go-text)}

.os404-cta{margin-top:30px;display:flex;flex-wrap:wrap;align-items:center;gap:14px}
.os404-primary{
  background:var(--go);color:var(--on-green);font-weight:700;font-size:15px;
  padding:14px 26px;border-radius:10px;text-decoration:none;display:inline-flex;align-items:center;gap:10px;
  box-shadow:0 10px 30px -8px rgba(22,217,146,.5);transition:transform .15s,box-shadow .15s;
}
.os404-primary:hover{transform:translateY(-2px);box-shadow:0 16px 40px -10px rgba(22,217,146,.6)}
.os404-ghost{
  border:1px solid var(--hair);color:var(--tx);font-weight:600;font-size:15px;
  padding:14px 24px;border-radius:10px;text-decoration:none;display:inline-flex;align-items:center;
  transition:border-color .15s,background .15s;
}
.os404-ghost:hover{border-color:var(--go-text);background:rgba(22,217,146,.06)}

@media (max-width:560px){
  .os404-panel{padding:26px 22px 30px}
}
@media (prefers-reduced-motion:reduce){
  .os404-dot{animation:none}
  .os404-primary:hover{transform:none}
}
`;

