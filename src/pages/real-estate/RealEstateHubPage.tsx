import { Link } from 'react-router-dom';
import ScrollToTop from '../../components/ui/ScrollToTop';
import SEO from '../../components/seo/SEO';
import { getAllCREProducts } from '../../data/cre-products';
import { OS_CSS, useOSFonts, OSSection, Eyebrow, Display, Lede, CTAPrimary } from '../../components/landing/os/OSKit';
import OSNav from '../../components/landing/os/OSNav';
import OSFooter from '../../components/landing/os/OSFooter';
import { MONEY_CSS, MoneyCTA } from '../../components/landing/os/money/MoneyKit';

export default function RealEstateHubPage() {
  useOSFonts();
  const products = getAllCREProducts();

  return (
    <div className="os-root">
      <style>{OS_CSS}</style>
      <style>{MONEY_CSS}</style>
      <style>{RE_CSS}</style>
      <SEO
        title="Commercial Real Estate Loans"
        description="Explore Momentum Funding's real estate financing: Hard Money Bridge Loans, Rental Investment Property Loans, Commercial Mortgages, and Ground Up Construction Loans. Close in as little as 2 weeks."
        keywords="commercial real estate loans, hard money bridge loan, rental property financing, commercial mortgage, construction loan, fix and flip loan, investment property loan, real estate financing"
      />
      <ScrollToTop />
      <OSNav />

      {/* Hero */}
      <OSSection tone="ink">
        <div className="re-hero">
          <Eyebrow>COMMERCIAL REAL ESTATE</Eyebrow>
          <Display>
            FINANCING THAT CLOSES<br /><span className="os-go">WHEN YOU NEED IT.</span>
          </Display>
          <Lede>
            From fix-and-flip bridge loans to long-term commercial mortgages — close in as little as{' '}
            <strong>2 weeks</strong> with financing from <strong>$100K to $50M</strong> across all 50 states.
            One application taps a network of 50+ private lenders; we find the best terms for your deal.
          </Lede>
          <div className="re-hero-cta">
            <CTAPrimary href="/apply">Submit your loan scenario</CTAPrimary>
            <span className="os-mono re-fine">TERM SHEET IN 48 HRS · NO CREDIT IMPACT TO CHECK</span>
          </div>
        </div>
      </OSSection>

      {/* Program grid */}
      <OSSection tone="panel">
        <div className="money-secthead">
          <Eyebrow>OUR PROGRAMS</Eyebrow>
          <Display>PICK THE RIGHT <span className="os-go">PROGRAM.</span></Display>
        </div>
        <div className="re-grid">
          {products.map((p) => {
            const rate = p.specs.find((s) => s.label.includes('Interest'))?.value || 'N/A';
            return (
              <Link key={p.slug} to={`/real-estate/${p.slug}`} className="os-card re-card">
                <span className="re-card-ico"><p.icon className="re-card-svg" /></span>
                <h3 className="re-card-name">{p.shortName}</h3>
                <p className="re-card-blurb">{p.tagline}</p>
                <dl className="re-card-specs">
                  <div><dt className="os-mono">AMOUNT</dt><dd>{p.hero.amountRange}</dd></div>
                  <div><dt className="os-mono">TIME TO CLOSE</dt><dd>{p.hero.approvalTime}</dd></div>
                  <div><dt className="os-mono">RATE</dt><dd>{rate}</dd></div>
                </dl>
                <span className="re-card-see os-mono">Learn more <span aria-hidden>→</span></span>
              </Link>
            );
          })}
        </div>
      </OSSection>

      <MoneyCTA
        eyebrow="HAVE A DEAL?"
        title={<>LET&rsquo;S <span className="os-go">TALK.</span></>}
        sub="Submit your loan scenario and get a term sheet within 48 hours. No obligation, no credit impact."
        cta="Submit your loan scenario"
        chips={['ALL 50 STATES', '$100K – $50M', 'CLOSE IN 2–6 WEEKS']}
      />

      <OSFooter />
    </div>
  );
}

const RE_CSS = `
.re-hero{max-width:44em}
.re-hero-cta{display:flex;flex-wrap:wrap;align-items:center;gap:16px 22px;margin-top:30px}
.re-fine{font-size:11px;letter-spacing:.05em;color:var(--faint)}

.re-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:18px}
.re-card{display:flex;flex-direction:column;text-decoration:none}
.re-card-ico{width:48px;height:48px;border-radius:12px;display:grid;place-items:center;margin-bottom:18px;
  color:var(--go-text);background:rgba(22,217,146,.08);border:1px solid rgba(22,217,146,.22)}
.re-card-svg{width:24px;height:24px}
.re-card-name{font-family:'Anton',sans-serif;font-weight:400;text-transform:uppercase;letter-spacing:.01em;
  font-size:23px;line-height:1.03;color:var(--tx);margin:0 0 10px}
.re-card-blurb{font-size:14.5px;line-height:1.55;color:var(--muted);margin:0 0 20px}
.re-card-specs{margin:0 0 18px;padding:16px 0 4px;border-top:1px solid var(--hair);display:flex;flex-direction:column;gap:11px}
.re-card-specs>div{display:flex;align-items:baseline;justify-content:space-between;gap:14px}
.re-card-specs dt{font-size:11px;letter-spacing:.1em;color:var(--faint)}
.re-card-specs dd{margin:0;font-size:14px;font-weight:600;color:var(--tx);text-align:right}
.re-card-see{margin-top:auto;font-size:12px;letter-spacing:.04em;color:var(--go-text);display:inline-flex;align-items:center;gap:7px}
.re-card:hover .re-card-see{gap:11px}

@media (max-width:760px){.re-grid{grid-template-columns:1fr}}
`;
