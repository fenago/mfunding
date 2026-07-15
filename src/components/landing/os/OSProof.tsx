// OSProof — the "Proof" belief-building section for the Momentum OS landing.
// Emotional truth of this business is RELIEF. Real verbatim quotes from the current
// site, generic role-based attributions (no invented names/photos). NO fabricated
// volume stats — only real, defensible product facts in the trust strip.
import { OSSection, Eyebrow, Display, CTAPrimary, Card } from "./OSKit";

const QUOTES: { quote: string; who: string }[] = [
  {
    quote:
      "They understood my business when banks just saw numbers. That human touch made all the difference.",
    who: "— OWNER · CONSTRUCTION",
  },
  {
    quote:
      "Fast, simple, and they kept me informed every step of the way. This is how business should be done.",
    who: "— OWNER · RESTAURANT",
  },
  {
    quote:
      "For the first time in months, I can take a full, deep breath. The weight is gone.",
    who: "— OWNER · RETAIL",
  },
  {
    quote:
      "I'm not just a guy trying to survive anymore — I'm thinking about growth. About the future.",
    who: "— OWNER · TRUCKING",
  },
];

const FACTS = [
  "NO UPFRONT FEES",
  "NO COLLATERAL ON AN MCA",
  "CHECK YOUR RATE WITH NO CREDIT IMPACT",
  "FUNDS IN 24–48 HRS (TYPICAL)",
];

export default function OSProof() {
  return (
    <OSSection tone="panel" id="proof">
      <style>{CSS}</style>

      <div className="osproof-head">
        <Eyebrow>PROOF</Eyebrow>
        <Display>
          THEY SAID NO.
          <br />
          <span className="os-go">WE SAID GO.</span>
        </Display>
      </div>

      <div className="osproof-grid">
        {QUOTES.map((q) => (
          <Card key={q.who} className="osproof-card">
            <span className="osproof-mark" aria-hidden>
              &ldquo;
            </span>
            <p className="osproof-quote">{q.quote}</p>
            <p className="osproof-who">{q.who}</p>
          </Card>
        ))}
      </div>

      <div className="osproof-strip" role="list">
        {FACTS.map((f, i) => (
          <span key={f} className="osproof-fact" role="listitem">
            {i > 0 && <span className="osproof-dot" aria-hidden>·</span>}
            <span className="osproof-facttext">{f}</span>
          </span>
        ))}
      </div>

      <div className="osproof-cta">
        <CTAPrimary href="/apply">Check your rate — free</CTAPrimary>
        <span className="osproof-range os-mono">$5K–$1M ADVANCE RANGE</span>
      </div>

      <p className="osproof-fine">Not a loan. An MCA is a purchase of future receivables.</p>
    </OSSection>
  );
}

const CSS = `
.osproof-head{margin-bottom:40px}

.osproof-grid{
  display:grid; grid-template-columns:repeat(2,1fr); gap:18px; margin-bottom:40px;
}
.osproof-card{position:relative; display:flex; flex-direction:column; padding:30px 28px}
.osproof-mark{
  font-family:'Anton',sans-serif; font-size:62px; line-height:.6; color:var(--go-text);
  opacity:.28; height:26px; margin-bottom:6px; user-select:none;
}
.osproof-quote{
  font-family:'Inter',sans-serif; font-size:19px; line-height:1.5; color:var(--tx);
  font-weight:500; margin:0 0 20px; flex:1;
}
.osproof-who{
  font-family:'Space Mono',monospace; font-size:12px; letter-spacing:.1em;
  color:var(--go-text); margin:0;
}

.osproof-strip{
  display:flex; flex-wrap:wrap; align-items:center; justify-content:center; gap:4px 6px;
  border:1px solid var(--hair); border-radius:12px; padding:18px 22px;
  background:rgba(255,255,255,.015); margin-bottom:34px;
}
.osproof-fact{display:inline-flex; align-items:center; gap:6px}
.osproof-facttext{
  font-family:'Space Mono',monospace; font-size:12.5px; letter-spacing:.08em;
  color:var(--muted); text-transform:uppercase;
}
.osproof-dot{color:var(--faint); font-family:'Space Mono',monospace}

.osproof-cta{display:flex; align-items:center; gap:20px; flex-wrap:wrap; margin-bottom:16px}
.osproof-range{font-size:12px; letter-spacing:.1em; color:var(--faint)}

.osproof-fine{font-size:12.5px; color:var(--faint); margin:0}

@media (max-width:820px){
  .osproof-grid{grid-template-columns:1fr; gap:14px}
  .osproof-quote{font-size:17px}
}
`;
