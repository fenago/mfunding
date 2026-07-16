import { Link } from "react-router-dom";
import SEO, { generateBreadcrumbSchema } from "../components/seo/SEO";
import { OSSection, Eyebrow, Display, Lede, CTAPrimary } from "../components/landing/os/OSKit";
import { ToolShell } from "../components/landing/os/tools/ToolsKit";

// Plain-language definitions of business-funding terms. Answer-first format so
// answer engines (Google AI Overviews, ChatGPT, Perplexity) can quote each entry.
const TERMS: { term: string; def: string }[] = [
  { term: "Merchant Cash Advance (MCA)", def: "A purchase of a business's future receivables — not a loan. The business receives working capital upfront and repays it as a percentage of daily or weekly sales." },
  { term: "Factor Rate", def: "A multiplier (not an interest rate) used to price an advance. A 1.3 factor rate on $50,000 means total payback of $65,000." },
  { term: "Retrieval Rate", def: "The fixed percentage of daily or weekly sales a funder debits to repay an advance, typically 8%–15% of revenue." },
  { term: "Holdback", def: "The portion of card or bank deposits withheld each day to repay a merchant cash advance until the advance is paid off." },
  { term: "Working Capital", def: "Short-term capital a business uses to cover day-to-day operations such as payroll, inventory, and rent." },
  { term: "Business Line of Credit", def: "A revolving credit facility a business can draw from as needed, paying interest only on the amount used." },
  { term: "Term Loan", def: "A lump sum borrowed and repaid in fixed installments over a set period, usually with a fixed interest rate." },
  { term: "SBA 7(a) Loan", def: "A loan partially guaranteed by the U.S. Small Business Administration, offering lower rates and longer terms than most alternative funding." },
  { term: "Equipment Financing", def: "Financing used to purchase business equipment, where the equipment itself serves as collateral." },
  { term: "Stips (Stipulations)", def: "The supporting documents a funder requires to approve a deal — commonly bank statements, a photo ID, and a voided check." },
  { term: "Stacking", def: "When a business takes multiple merchant cash advances at the same time, increasing total daily repayment obligations." },
  { term: "UCC Filing", def: "A public lien filed when a funder advances capital, used by other funders to see a business's existing obligations." },
  { term: "Time in Business (TIB)", def: "How long a business has been operating — a key funding qualification, with most products requiring 6–12 months minimum." },
  { term: "Points", def: "Commission expressed as a percentage of the funded amount. 8 points on a $50,000 advance equals $4,000." },
  { term: "Renewal", def: "Additional capital offered to a business that has paid down a meaningful portion (often 40%–75%) of an existing advance." },
  { term: "Soft Credit Pull", def: "A credit inquiry that does not affect the business owner's credit score, used to check funding options before a formal submission." },
  { term: "Funder", def: "The company that provides the actual capital and underwrites the deal, paying commission to the broker who originates it." },
  { term: "ISO (Independent Sales Organization)", def: "A brokerage, like Momentum Funding, that originates funding deals and submits them to a network of funders and lenders." },
];

export default function GlossaryPage() {
  return (
    <ToolShell>
      <style>{CSS}</style>
      <SEO
        title="Business Funding Glossary — Key Terms Explained"
        description="Plain-language definitions of business funding terms: merchant cash advance, factor rate, retrieval rate, stips, UCC filing, SBA loan, and more — from Momentum Funding."
        keywords="business funding glossary, what is a factor rate, what is a merchant cash advance, MCA terms, retrieval rate, stips meaning"
        canonical="https://mfunding.net/resources/glossary"
        structuredData={[
          generateBreadcrumbSchema([
            { name: "Home", url: "https://mfunding.net/" },
            { name: "Resources", url: "https://mfunding.net/resources" },
            { name: "Glossary", url: "https://mfunding.net/resources/glossary" },
          ]),
          {
            "@context": "https://schema.org",
            "@type": "DefinedTermSet",
            name: "Business Funding Glossary",
            url: "https://mfunding.net/resources/glossary",
            hasDefinedTerm: TERMS.map((t) => ({
              "@type": "DefinedTerm",
              name: t.term,
              description: t.def,
            })),
          },
        ]}
      />

      <OSSection tone="ink">
        <div className="ost-herobox">
          <p className="glo-crumb os-mono">
            <Link to="/resources">RESOURCES</Link> · GLOSSARY
          </p>
          <Eyebrow>REFERENCE</Eyebrow>
          <Display>
            BUSINESS FUNDING <span className="os-go">GLOSSARY</span>
          </Display>
          <Lede>
            Clear definitions of the business-funding terms you'll encounter when getting capital for
            your business. Don't see a term?{" "}
            <Link to="/contact" className="glo-inline">Ask our team</Link>.
          </Lede>
        </div>
      </OSSection>

      <OSSection tone="panel">
        <div className="glo-boardtop">
          <span>TERMS · A–Z REFERENCE</span>
          <span className="glo-boardnote">{TERMS.length} DEFINITIONS</span>
        </div>
        <dl className="glo-grid">
          {TERMS.map((t, i) => (
            <div className="glo-row" key={t.term}>
              <span className="glo-code">{String(i + 1).padStart(2, "0")}</span>
              <dt className="glo-term">{t.term}</dt>
              <dd className="glo-def">{t.def}</dd>
            </div>
          ))}
        </dl>

        <div className="ost-ctaband" style={{ marginTop: 44 }}>
          <h2>Ready to get funded?</h2>
          <p>Compare your options with no credit impact.</p>
          <CTAPrimary href="/apply">Apply for funding</CTAPrimary>
        </div>
      </OSSection>
    </ToolShell>
  );
}

const CSS = `
.glo-crumb{font-size:11px;letter-spacing:.14em;color:var(--faint);margin:0 0 18px}
.glo-crumb a{color:var(--muted);text-decoration:none}
.glo-crumb a:hover{color:var(--go-text)}
.glo-inline{color:var(--go-text);text-decoration:none;border-bottom:1px solid rgba(22,217,146,.4)}
.glo-inline:hover{border-bottom-color:var(--go-text)}

.glo-boardtop{
  display:flex;align-items:center;justify-content:space-between;gap:16px;
  font-family:'Space Mono',monospace;font-size:12px;letter-spacing:.14em;color:var(--muted);
  padding:0 2px 12px;border-bottom:1px solid var(--hair);
}
.glo-boardnote{color:var(--faint)}
.glo-grid{
  display:grid;gap:1px;background:var(--hair);
  border:1px solid var(--hair);border-top:none;margin:0;
}
.glo-row{
  position:relative;background:linear-gradient(180deg,var(--panel),var(--panel2));
  display:grid;grid-template-columns:auto 1fr;gap:4px 16px;padding:22px 24px;
  transition:background .18s,box-shadow .18s;
}
.glo-row::before{content:"";position:absolute;left:0;top:0;bottom:0;width:2px;background:var(--go);opacity:0;transition:opacity .18s}
.glo-row:hover{background:linear-gradient(180deg,rgba(22,217,146,.05),var(--panel2))}
.glo-row:hover::before{opacity:1}
.glo-code{
  grid-row:1 / span 2;align-self:start;margin-top:2px;
  font-family:'Space Mono',monospace;font-size:12px;color:var(--faint);letter-spacing:.06em;
}
.glo-term{grid-column:2;font-size:16px;font-weight:600;color:var(--tx);letter-spacing:.005em;margin:0}
.glo-def{grid-column:2;font-size:14.5px;line-height:1.55;color:var(--muted);margin:5px 0 0}

@media (max-width:560px){
  .glo-boardtop{flex-direction:column;align-items:flex-start;gap:4px}
}
`;
