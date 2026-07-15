// OSFaq — the "Questions" accordion for the Momentum OS landing.
// Accessible disclosure pattern: each item is a native <button> with aria-expanded
// controlling a region. Keyboard-operable, visible focus, many-open allowed.
// Answers are verbatim from the current site (MCA compliance already respected).
import { useState } from "react";
import { OSSection, Eyebrow, Display, Lede, CTAPrimary } from "./OSKit";

const QA: { q: string; a: string }[] = [
  {
    q: "How fast can I get funded?",
    a: "Most business owners receive funding within 24–48 hours of approval. The application takes 5 minutes and you'll typically hear back within a few hours.",
  },
  {
    q: "What credit score do I need?",
    a: "We focus on your business performance, not just your credit score — we work with owners with scores as low as 500. What matters most is monthly revenue ($10K+) and time in business (6+ months).",
  },
  {
    q: "Can I get funded if the bank turned me down?",
    a: "Yes. We specialize in owners banks declined. We look at your current cash flow, not just past credit. A bank rejection is where most of our customers start.",
  },
  {
    q: "Will applying affect my credit score?",
    a: "No. Checking your rate uses a soft pull that does not impact your score. We only do a hard pull if you accept an offer and move forward — and we'll always tell you first.",
  },
  {
    q: "What's the difference between an MCA and a business loan?",
    a: "A Merchant Cash Advance is not a loan — it's an advance on your future sales. You repay as a percentage of daily sales, so payments adjust with your business. No fixed monthly payment, no collateral, no personal assets at risk.",
  },
  {
    q: "How much does an MCA cost?",
    a: "An MCA uses a fixed factor rate (typically 1.1–1.5), not an interest rate. Example: a $20,000 advance at 1.2 = $24,000 total, a fixed $4,000 fee that never changes or compounds. You'll always see the full cost in writing before you sign. No upfront or hidden fees.",
  },
  {
    q: "Do I need collateral?",
    a: "No collateral for a merchant cash advance or line of credit — your home, car, and personal assets are never at risk. For equipment financing the equipment itself is the collateral.",
  },
  {
    q: "What documents do I need?",
    a: "3 months of business bank statements, a valid ID, and basic business info. No tax returns, no lengthy financials. Most applications are done in under 5 minutes.",
  },
];

export default function OSFaq() {
  const [open, setOpen] = useState<Set<number>>(new Set([0]));
  const toggle = (i: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <OSSection tone="ink" id="faq">
      <style>{CSS}</style>

      <div className="osfaq-head">
        <Eyebrow>QUESTIONS</Eyebrow>
        <Display>
          STRAIGHT
          <br />
          <span className="os-go">ANSWERS.</span>
        </Display>
        <Lede>No fine print, no runaround.</Lede>
      </div>

      <div className="osfaq-list">
        {QA.map((item, i) => {
          const isOpen = open.has(i);
          const btnId = `osfaq-btn-${i}`;
          const panelId = `osfaq-panel-${i}`;
          return (
            <div className={`osfaq-item ${isOpen ? "is-open" : ""}`} key={item.q}>
              <h3 className="osfaq-h">
                <button
                  id={btnId}
                  className="osfaq-btn"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => toggle(i)}
                >
                  <span className="osfaq-idx os-mono" aria-hidden>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="osfaq-q">{item.q}</span>
                  <span className="osfaq-marker" aria-hidden>
                    {isOpen ? "–" : "+"}
                  </span>
                </button>
              </h3>
              <div
                id={panelId}
                role="region"
                aria-labelledby={btnId}
                className="osfaq-panel"
                hidden={!isOpen}
              >
                <p className="osfaq-a">{item.a}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="osfaq-cta">
        <span className="osfaq-cta-label os-mono">STILL DECIDING?</span>
        <CTAPrimary href="/apply">Check your rate — free</CTAPrimary>
      </div>

      <p className="osfaq-fine">Not a loan. An MCA is a purchase of future receivables.</p>
    </OSSection>
  );
}

const CSS = `
.osfaq-head{margin-bottom:38px}

.osfaq-list{
  border-top:1px solid var(--hair);
  margin-bottom:40px;
}
.osfaq-item{border-bottom:1px solid var(--hair)}

.osfaq-h{margin:0}
.osfaq-btn{
  width:100%; display:grid; grid-template-columns:auto 1fr auto; align-items:center; gap:16px;
  background:none; border:none; cursor:pointer; text-align:left;
  padding:22px 6px; color:var(--tx); font-family:'Inter',sans-serif;
  transition:color .15s;
}
.osfaq-btn:hover{color:var(--go)}
.osfaq-btn:hover .osfaq-marker{color:var(--go); border-color:var(--go)}

.osfaq-idx{font-size:12px; letter-spacing:.08em; color:var(--faint)}
.osfaq-q{font-size:clamp(16px,2.1vw,19px); font-weight:500; line-height:1.35}
.osfaq-marker{
  width:30px; height:30px; flex:none; display:grid; place-items:center;
  font-family:'Space Mono',monospace; font-size:20px; line-height:1; color:var(--muted);
  border:1px solid var(--hair); border-radius:8px; transition:color .15s, border-color .15s, background .15s;
}
.osfaq-item.is-open .osfaq-marker{
  color:var(--ink); background:var(--go); border-color:var(--go);
}
.osfaq-item.is-open .osfaq-q{color:var(--tx)}
.osfaq-item.is-open .osfaq-idx{color:var(--go)}

.osfaq-panel{
  padding:0 6px 24px calc(6px + 12px + 16px);
  animation:osfaq-reveal .22s ease both;
}
.osfaq-a{
  font-family:'Inter',sans-serif; font-size:16px; line-height:1.65; color:#C4CFDA;
  max-width:56ch; margin:0;
  border-left:2px solid var(--go); padding-left:16px;
}

.osfaq-cta{display:flex; align-items:center; gap:18px; flex-wrap:wrap; margin-bottom:16px}
.osfaq-cta-label{font-size:12px; letter-spacing:.14em; color:var(--muted)}

.osfaq-fine{font-size:12.5px; color:var(--faint); margin:0}

@keyframes osfaq-reveal{from{opacity:0; transform:translateY(-4px)} to{opacity:1; transform:none}}

@media (max-width:820px){
  .osfaq-btn{gap:12px; padding:18px 2px}
  .osfaq-idx{display:none}
  .osfaq-panel{padding-left:2px}
}
@media (prefers-reduced-motion:reduce){
  .osfaq-panel{animation:none}
}
`;
