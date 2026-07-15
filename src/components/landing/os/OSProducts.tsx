// OSProducts — the "What we fund" section for the Momentum OS landing.
// Momentum is a marketplace/broker: one application, matched to the product that
// fits. Cards read like a dispatch board (Space Mono spec chips, hairline panels).
// COMPLIANCE: the MCA is a PURCHASE OF FUTURE RECEIVABLES — never a "loan", never
// APR/interest language. Only the actual loan products use lending terminology.
import { OSSection, Eyebrow, Display, Lede, CTAPrimary } from "./OSKit";

type Product = {
  name: string;
  blurb: string;
  spec: string;
  href: string;
  popular?: boolean;
};

const PRODUCTS: Product[] = [
  {
    name: "Merchant Cash Advance",
    blurb: "Cash flow-based funding you repay as a % of daily sales. Slow week, smaller payment.",
    spec: "$5K – $1M",
    href: "/business-loans/merchant-cash-advance",
    popular: true,
  },
  {
    name: "Business Line of Credit",
    blurb: "Draw what you need, when you need it. Only pay for what you use.",
    spec: "UP TO $1.25M",
    href: "/business-loans/line-of-credit",
  },
  {
    name: "Equipment Financing",
    blurb: "The equipment is the collateral — nothing else at risk.",
    spec: "UP TO $3M",
    href: "/business-loans/equipment-financing",
  },
  {
    name: "SBA 7(a) Loans",
    blurb: "Lower-cost, longer-term capital when you qualify and can wait.",
    spec: "UP TO $5M",
    href: "/business-loans/sba-loans",
  },
  {
    name: "Business Term Loan",
    blurb: "A lump sum with fixed, predictable payments.",
    spec: "$10K – $500K",
    href: "/business-loans/term-loan",
  },
  {
    name: "Startup Funding",
    blurb: "Early-stage capital based on potential, not just history.",
    spec: "ASK",
    href: "/business-loans/startup-funding",
  },
];

export default function OSProducts() {
  return (
    <OSSection tone="panel" id="products">
      <style>{CSS}</style>

      <div className="osprod-head">
        <Eyebrow>WHAT WE FUND</Eyebrow>
        <Display>
          ONE APPLICATION.
          <br />
          <span className="os-go">EVERY WAY TO GET FUNDED.</span>
        </Display>
        <Lede>
          Momentum is a funding <strong>marketplace</strong>, not a single lender.
          One 5-minute application gets matched to the product that actually fits
          your business — across our whole network.
        </Lede>
      </div>

      <div className="osprod-grid">
        {PRODUCTS.map((p) => (
          <a key={p.name} href={p.href} className={`os-card osprod-card${p.popular ? " osprod-card-pop" : ""}`}>
            {p.popular && <span className="osprod-badge">MOST POPULAR</span>}
            <h3 className="osprod-name">{p.name}</h3>
            <p className="osprod-blurb">{p.blurb}</p>
            <div className="osprod-foot">
              <span className="osprod-spec">{p.spec}</span>
              <span className="osprod-see">See details <span aria-hidden>→</span></span>
            </div>
          </a>
        ))}
      </div>

      <div className="osprod-cta">
        <CTAPrimary href="/apply">Check your rate — free</CTAPrimary>
        <p className="osprod-cta-fine">Matched to your business — no obligation.</p>
      </div>

      <p className="osprod-fine">
        Not a loan. A Merchant Cash Advance is a purchase of future receivables.
      </p>
    </OSSection>
  );
}

const CSS = `
.osprod-head{max-width:44em;margin-bottom:44px}

.osprod-grid{
  display:grid;grid-template-columns:repeat(3,1fr);gap:18px;
}
.osprod-card{
  display:flex;flex-direction:column;text-decoration:none;position:relative;
  min-height:206px;
}
.osprod-card:hover .osprod-see{color:var(--go)}
.osprod-card-pop{border-color:rgba(22,217,146,.45)}
.osprod-card-pop::before{
  content:"";position:absolute;inset:0;border-radius:14px;pointer-events:none;
  box-shadow:inset 0 0 0 1px rgba(22,217,146,.28),0 0 44px -14px rgba(22,217,146,.5);
}
.osprod-badge{
  position:absolute;top:-9px;left:22px;
  font-family:'Space Mono',monospace;font-size:10px;font-weight:700;letter-spacing:.14em;
  color:var(--ink);background:var(--go);padding:4px 9px;border-radius:6px;
  box-shadow:0 6px 16px -6px rgba(22,217,146,.6);
}

.osprod-name{
  font-family:'Anton',sans-serif;font-weight:400;text-transform:uppercase;letter-spacing:.01em;
  font-size:22px;line-height:1.02;color:var(--tx);margin:2px 0 12px;
}
.osprod-blurb{font-size:14.5px;line-height:1.55;color:var(--muted);margin:0 0 20px;flex:1}

.osprod-foot{
  display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding-top:14px;border-top:1px solid var(--hair);
}
.osprod-spec{
  font-family:'Space Mono',monospace;font-weight:700;font-size:13px;letter-spacing:.03em;
  color:var(--tx);
}
.osprod-see{
  font-family:'Space Mono',monospace;font-size:11.5px;letter-spacing:.04em;color:var(--faint);
  display:inline-flex;align-items:center;gap:6px;transition:color .15s;white-space:nowrap;
}

.osprod-cta{display:flex;align-items:center;gap:20px;flex-wrap:wrap;margin-top:40px}
.osprod-cta-fine{font-size:14px;color:var(--muted);margin:0}
.osprod-fine{font-family:'Space Mono',monospace;font-size:11.5px;color:var(--faint);margin:20px 0 0}

@media (max-width:900px){
  .osprod-grid{grid-template-columns:repeat(2,1fr)}
}
@media (max-width:560px){
  .osprod-grid{grid-template-columns:1fr}
  .osprod-card{min-height:0}
}
`;
