import { Link } from "react-router-dom";
import Navbar from "../components/landing/Navbar";
import Footer from "../components/landing/Footer";
import ScrollToTop from "../components/ui/ScrollToTop";
import SEO, { generateBreadcrumbSchema } from "../components/seo/SEO";

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
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
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
      <Navbar />
      <ScrollToTop />
      <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-12">
        <nav className="text-sm text-gray-400 mb-4">
          <Link to="/resources" className="hover:text-ocean-blue">Resources</Link> · Glossary
        </nav>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Business Funding Glossary</h1>
        <p className="text-gray-600 dark:text-gray-300 mt-3">
          Clear definitions of the business funding terms you'll encounter when getting capital for
          your business. Don't see a term?{" "}
          <Link to="/contact" className="text-ocean-blue hover:underline">Ask our team</Link>.
        </p>

        <dl className="mt-8 divide-y divide-gray-200 dark:divide-gray-800">
          {TERMS.map((t) => (
            <div key={t.term} className="py-5">
              <dt className="text-lg font-semibold text-gray-900 dark:text-white">{t.term}</dt>
              <dd className="mt-1 text-gray-600 dark:text-gray-300">{t.def}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-10 rounded-2xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Ready to get funded?</h2>
          <p className="text-gray-600 dark:text-gray-300 mt-2">
            Compare your options with no credit impact.
          </p>
          <Link to="/apply" className="inline-block mt-4 px-6 py-3 rounded-xl bg-ocean-blue text-white font-semibold hover:opacity-90 transition-opacity">
            Apply for funding →
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  );
}
