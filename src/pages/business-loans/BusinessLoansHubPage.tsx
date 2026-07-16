import { Link } from 'react-router-dom';
import ScrollToTop from '../../components/ui/ScrollToTop';
import SEO, { generateFAQSchema, generateBreadcrumbSchema } from '../../components/seo/SEO';
import { getAllProducts } from '../../data/products';
import { OS_CSS, useOSFonts, OSSection, Eyebrow, Display, Lede, CTAPrimary } from '../../components/landing/os/OSKit';
import OSNav from '../../components/landing/os/OSNav';
import OSFooter from '../../components/landing/os/OSFooter';
import { MONEY_CSS, FAQAccordion, MoneyCTA } from '../../components/landing/os/money/MoneyKit';

const HUB_FAQS = [
  {
    question: 'What types of business funding does Momentum Funding offer?',
    answer:
      'Momentum Funding offers six core products: merchant cash advances, business lines of credit, equipment financing, SBA 7(a) loans, business term loans, and startup loans. We match each business with the option that fits its revenue, time in business, and goals.',
  },
  {
    question: 'How fast can I get business funding?',
    answer:
      'Most business owners are approved within hours and funded within 24 to 48 hours. Merchant cash advances and lines of credit are the fastest; SBA loans take longer because of additional underwriting, but offer lower costs and larger amounts.',
  },
  {
    question: 'Can I qualify with bad credit?',
    answer:
      'Yes. For products like merchant cash advances we focus on your business revenue and cash flow rather than your personal credit score, so business owners with credit scores as low as 500 can qualify. Stronger credit unlocks lower-cost products like term loans and SBA loans.',
  },
  {
    question: 'Is a merchant cash advance a loan?',
    answer:
      'No. A merchant cash advance is not a loan — it is the purchase of a portion of your future receivables. You receive working capital today and repay it as a percentage of your daily or weekly sales, so payments flex with your revenue.',
  },
  {
    question: 'Will checking my options affect my credit score?',
    answer:
      'No. Checking your funding options uses a soft inquiry that does not impact your credit score. A hard pull only happens if you move forward with a formal funder submission, and we tell you before that happens.',
  },
];

export default function BusinessLoansHubPage() {
  useOSFonts();
  const products = getAllProducts();

  return (
    <div className="os-root">
      <style>{OS_CSS}</style>
      <style>{MONEY_CSS}</style>
      <style>{HUB_CSS}</style>
      <SEO
        title="Business Loans & Funding Options"
        description="Explore Momentum Funding's 6 business financing products: Merchant Cash Advance, Equipment Financing, Startup Loans, SBA 7(a) Loans, Term Loans, and Lines of Credit. Get funded in as little as 24 hours."
        keywords="business loans, merchant cash advance, equipment financing, SBA loans, business term loan, line of credit, small business funding, fast business loans"
        canonical="https://mfunding.net/business-loans"
        structuredData={[
          generateBreadcrumbSchema([
            { name: 'Home', url: 'https://mfunding.net/' },
            { name: 'Business Loans', url: 'https://mfunding.net/business-loans' },
          ]),
          generateFAQSchema(HUB_FAQS),
        ]}
      />
      <ScrollToTop />
      <OSNav />

      {/* Hero */}
      <OSSection tone="ink">
        <div className="hub-hero">
          <Eyebrow>BUSINESS FUNDING · 6 PRODUCTS</Eyebrow>
          <Display>
            FUNDING THAT FITS<br /><span className="os-go">YOUR SITUATION.</span>
          </Display>
          <Lede>
            Every business is different. Same-day cash, long-term growth capital, or a safety net for slow
            months — Momentum is a <strong>marketplace</strong>, so one application gets matched to the
            product that actually fits. No bank runarounds, no weeks of waiting.
          </Lede>
          <div className="hub-hero-cta">
            <CTAPrimary href="/apply">Check your rate — free</CTAPrimary>
            <span className="os-mono hub-fine">5-MIN APPLICATION · WON&rsquo;T AFFECT YOUR CREDIT</span>
          </div>
        </div>
      </OSSection>

      {/* Product grid */}
      <OSSection tone="panel" id="products">
        <div className="money-secthead">
          <Eyebrow>OUR PRODUCTS</Eyebrow>
          <Display>PICK YOUR <span className="os-go">LANE.</span></Display>
        </div>
        <div className="hub-grid">
          {products.map((p) => {
            const popular = p.slug === 'merchant-cash-advance';
            return (
              <Link key={p.slug} to={`/business-loans/${p.slug}`} className={`os-card hub-card${popular ? ' hub-card-pop' : ''}`}>
                {popular && <span className="hub-badge">MOST POPULAR</span>}
                <span className="hub-card-ico"><p.icon className="hub-card-svg" /></span>
                <h3 className="hub-card-name">{p.shortName}</h3>
                <p className="hub-card-blurb">{p.tagline}</p>
                <div className="hub-card-foot">
                  <span className="hub-card-spec os-mono">{p.hero.amountRange}</span>
                  <span className="hub-card-see os-mono">Details <span aria-hidden>→</span></span>
                </div>
              </Link>
            );
          })}
        </div>
      </OSSection>

      {/* How to choose + comparison */}
      <OSSection tone="ink">
        <div className="hub-prose">
          <Display>HOW TO CHOOSE THE <span className="os-go">RIGHT FUNDING.</span></Display>
          <p>
            The best business funding depends on three things: how fast you need the capital, how much you
            need, and the strength of your credit and revenue. If you need money the same day and have steady
            card or bank deposits, a <Link to="/business-loans/merchant-cash-advance">merchant cash advance</Link>{' '}
            or <Link to="/business-loans/line-of-credit">business line of credit</Link> is usually fastest. If
            you want the lowest cost and can wait a few weeks, an{' '}
            <Link to="/business-loans/sba-loans">SBA 7(a) loan</Link> or{' '}
            <Link to="/business-loans/term-loans">business term loan</Link> is often the better fit. To buy
            machinery, vehicles, or equipment, <Link to="/business-loans/equipment-financing">equipment
            financing</Link> lets the equipment itself serve as collateral.
          </p>
          <p>
            Momentum Funding is a funding marketplace, not a single lender. We submit your profile to a network
            of funders and lenders, then present you the strongest offers — so you compare real options instead
            of taking the first quote. There are no upfront fees; we are paid by the funder when your deal
            closes. Already carrying advances and feeling the daily payments? Our{' '}
            <Link to="/debt-relief">MCA debt relief</Link> program can help you restructure.
          </p>
        </div>

        <div className="hub-table-wrap">
          <table className="hub-table">
            <thead>
              <tr>
                <th>Product</th><th>Speed</th><th>Amount</th><th>Credit needed</th><th>Best for</th>
              </tr>
            </thead>
            <tbody>
              <tr><td className="hub-td-name">Merchant Cash Advance</td><td>Same day–48 hrs</td><td>$5K–$5M</td><td>None (revenue-based)</td><td>Fast cash, lower credit</td></tr>
              <tr><td className="hub-td-name">Line of Credit</td><td>1–3 days</td><td>$10K–$1.25M</td><td>Fair+</td><td>Flexible, recurring needs</td></tr>
              <tr><td className="hub-td-name">Equipment Financing</td><td>2–5 days</td><td>Up to $3M</td><td>Fair+</td><td>Buying equipment/vehicles</td></tr>
              <tr><td className="hub-td-name">Term Loan</td><td>2–7 days</td><td>$25K–$500K</td><td>Good</td><td>Predictable growth capital</td></tr>
              <tr><td className="hub-td-name">SBA 7(a) Loan</td><td>2–6 weeks</td><td>Up to $5M</td><td>Good–Excellent</td><td>Lowest cost, largest amounts</td></tr>
            </tbody>
          </table>
        </div>
        <p className="hub-glossary os-mono">
          New to these terms? See the <Link to="/resources/glossary">business funding glossary</Link>.
        </p>
      </OSSection>

      <FAQAccordion faqs={HUB_FAQS} tone="panel" />

      <MoneyCTA
        eyebrow="NOT SURE WHICH FITS?"
        title={<>APPLY ONCE. <span className="os-go">WE MATCH YOU.</span></>}
        sub="Our team matches you with the best option based on your business profile. 5-minute application, no credit impact."
        chips={['5-MINUTE APPLICATION', "WON'T AFFECT CREDIT", '24-HOUR DECISION']}
      />

      <OSFooter />
    </div>
  );
}

const HUB_CSS = `
.hub-hero{max-width:44em}
.hub-hero-cta{display:flex;flex-wrap:wrap;align-items:center;gap:16px 22px;margin-top:30px}
.hub-fine{font-size:11px;letter-spacing:.05em;color:var(--faint)}

.hub-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
.hub-card{position:relative;display:flex;flex-direction:column;text-decoration:none;min-height:210px}
.hub-card-ico{width:44px;height:44px;border-radius:11px;display:grid;place-items:center;margin-bottom:16px;
  color:var(--go-text);background:rgba(22,217,146,.08);border:1px solid rgba(22,217,146,.22)}
.hub-card-svg{width:22px;height:22px}
.hub-card-pop{border-color:rgba(22,217,146,.45)}
.hub-card-pop::before{content:"";position:absolute;inset:0;border-radius:14px;pointer-events:none;
  box-shadow:inset 0 0 0 1px rgba(22,217,146,.28),0 0 44px -14px rgba(22,217,146,.5)}
.hub-badge{position:absolute;top:-9px;left:22px;font-family:'Space Mono',monospace;font-size:10px;font-weight:700;
  letter-spacing:.14em;color:var(--on-green);background:var(--go);padding:4px 9px;border-radius:6px;
  box-shadow:0 6px 16px -6px rgba(22,217,146,.6)}
.hub-card-name{font-family:'Anton',sans-serif;font-weight:400;text-transform:uppercase;letter-spacing:.01em;
  font-size:21px;line-height:1.03;color:var(--tx);margin:0 0 10px}
.hub-card-blurb{font-size:14px;line-height:1.55;color:var(--muted);margin:0 0 20px;flex:1}
.hub-card-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:14px;border-top:1px solid var(--hair)}
.hub-card-spec{font-weight:700;font-size:13px;letter-spacing:.03em;color:var(--tx)}
.hub-card-see{font-size:11.5px;letter-spacing:.04em;color:var(--faint);display:inline-flex;align-items:center;gap:6px}
.hub-card:hover .hub-card-see{color:var(--go-text)}

.hub-prose{max-width:52em;margin-bottom:36px}
.hub-prose p{font-size:16px;line-height:1.7;color:var(--lede);margin:0 0 18px}
.hub-prose a{color:var(--go-text);text-decoration:none;border-bottom:1px solid rgba(22,217,146,.35)}
.hub-prose a:hover{border-bottom-color:var(--go-text)}

.hub-table-wrap{overflow-x:auto;border:1px solid var(--hair);border-radius:14px}
.hub-table{width:100%;border-collapse:collapse;font-size:14px;min-width:640px}
.hub-table th{font-family:'Space Mono',monospace;font-size:11px;letter-spacing:.1em;text-transform:uppercase;
  text-align:left;color:var(--muted);padding:14px 16px;background:var(--ink2);border-bottom:1px solid var(--hair)}
.hub-table td{padding:14px 16px;color:var(--lede);border-bottom:1px solid var(--hair2)}
.hub-table tr:last-child td{border-bottom:none}
.hub-td-name{font-weight:600;color:var(--tx)}
.hub-glossary{font-size:12px;color:var(--faint);margin:14px 0 0}
.hub-glossary a{color:var(--go-text);text-decoration:none}

@media (max-width:900px){.hub-grid{grid-template-columns:1fr 1fr}}
@media (max-width:560px){.hub-grid{grid-template-columns:1fr}.hub-card{min-height:0}}
`;
