// OSLegalShell — shared page shell + reading typography for the legal pages
// (Privacy, Terms) on the Momentum OS design. Presentation only: the legal copy
// itself lives verbatim in each page and is passed in as children. Provides the
// os-root wrapper, fonts, nav/footer, an Anton title, a mono "last updated" stamp,
// and calm long-form styling for <LegalSection>/<LegalList>.
import { type ReactNode } from "react";
import ScrollToTop from "../../../ui/ScrollToTop";
import { OS_CSS, useOSFonts } from "../OSKit";
import OSNav from "../OSNav";
import OSFooter from "../OSFooter";

export function OSLegalShell({
  title, eyebrow, lastUpdated, children,
}: { title: string; eyebrow: string; lastUpdated?: ReactNode; children: ReactNode }) {
  useOSFonts();
  return (
    <div className="os-root">
      <style>{OS_CSS}</style>
      <style>{CSS}</style>
      <ScrollToTop />
      <OSNav />
      <main className="oslegal-main">
        <div className="os-container">
          <div className="oslegal">
            <header className="oslegal-head">
              <p className="oslegal-eyebrow os-mono"><span className="oslegal-eyedot" />{eyebrow}</p>
              <h1 className="oslegal-title">{title}</h1>
              {lastUpdated && <p className="oslegal-updated os-mono">{lastUpdated}</p>}
            </header>
            <div className="oslegal-body">{children}</div>
          </div>
        </div>
      </main>
      <OSFooter />
    </div>
  );
}

/** A titled legal section — the heading gets a subtle mono index feel via the border. */
export function LegalSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="oslegal-section">
      <h2 className="oslegal-h2">{heading}</h2>
      {children}
    </section>
  );
}

export function LegalP({ children }: { children: ReactNode }) {
  return <p className="oslegal-p">{children}</p>;
}

export function LegalList({ children }: { children: ReactNode }) {
  return <ul className="oslegal-list">{children}</ul>;
}

const CSS = `
.oslegal-main{background:var(--ink);padding:44px 0 96px;min-height:60vh}
.oslegal{max-width:760px;margin:0 auto}

.oslegal-head{padding-bottom:30px;margin-bottom:34px;border-bottom:1px solid var(--hair)}
.oslegal-eyebrow{
  font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:var(--muted);
  display:inline-flex;align-items:center;gap:10px;margin:0 0 18px;
}
.oslegal-eyedot{width:8px;height:8px;border-radius:9px;background:var(--go);box-shadow:0 0 0 4px rgba(22,217,146,.16)}
.oslegal-title{
  font-family:'Anton',sans-serif;font-weight:400;text-transform:uppercase;letter-spacing:.006em;
  line-height:.96;font-size:clamp(34px,5.6vw,56px);color:var(--tx);margin:0;
}
.oslegal-updated{margin:20px 0 0;font-size:12px;letter-spacing:.08em;color:var(--faint)}

.oslegal-body{font-family:'Inter',sans-serif}
.oslegal-intro{font-size:18px;line-height:1.7;color:var(--lede);margin:0 0 34px}
.oslegal-intro strong{color:var(--tx);font-weight:600}

.oslegal-section{
  margin:0 0 14px;padding:26px 0 28px;border-top:1px solid var(--hair2);
}
.oslegal-section:first-of-type{border-top:none;padding-top:0}
.oslegal-h2{
  font-family:'Space Mono',monospace;font-size:13px;letter-spacing:.14em;text-transform:uppercase;
  color:var(--go-text);margin:0 0 16px;font-weight:700;
}
.oslegal-p{font-size:16.5px;line-height:1.7;color:var(--lede);margin:0 0 16px}
.oslegal-p:last-child{margin-bottom:0}
.oslegal-p strong{color:var(--tx);font-weight:600}

.oslegal-list{list-style:none;margin:0 0 4px;padding:0;display:flex;flex-direction:column;gap:12px}
.oslegal-list li{
  position:relative;padding-left:26px;font-size:16px;line-height:1.6;color:var(--lede);
}
.oslegal-list li::before{
  content:"";position:absolute;left:2px;top:9px;width:7px;height:7px;border-radius:2px;
  background:var(--go);box-shadow:0 0 0 3px rgba(22,217,146,.14);
}
.oslegal-list li strong{color:var(--tx);font-weight:600}

@media (max-width:820px){
  .oslegal-p,.oslegal-list li{font-size:15.5px}
}
`;
