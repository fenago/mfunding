import { Link } from 'react-router-dom';
import Logo from '../ui/Logo';

const footerLinks = {
  businessLoans: [
    { name: 'Merchant Cash Advance', href: '/business-loans/merchant-cash-advance' },
    { name: 'Equipment Financing', href: '/business-loans/equipment-financing' },
    { name: 'Startup Loans', href: '/business-loans/startup-loans' },
    { name: 'SBA 7(a) Loan', href: '/business-loans/sba-loans' },
    { name: 'Business Term Loan', href: '/business-loans/term-loans' },
    { name: 'Line of Credit', href: '/business-loans/line-of-credit' },
  ],
  realEstate: [
    { name: 'Hard Money Bridge Loans', href: '/real-estate/hard-money-bridge' },
    { name: 'Rental Property Loans', href: '/real-estate/rental-investment' },
    { name: 'Commercial Mortgage', href: '/real-estate/commercial-mortgage' },
    { name: 'Construction Loans', href: '/real-estate/construction-loans' },
  ],
  resources: [
    { name: 'Free Tools & Calculators', href: '/tools' },
    { name: 'Guides & Articles', href: '/resources' },
    { name: 'Funding Glossary', href: '/resources/glossary' },
    { name: 'How It Works', href: '/#how-it-works' },
    { name: 'MCA Debt Relief', href: '/debt-relief' },
    { name: 'Apply Now', href: '/apply' },
  ],
  company: [
    { name: 'About Us', href: '/about' },
    { name: 'Contact', href: '/contact' },
  ],
  legal: [
    { name: 'Privacy Policy', href: '/privacy' },
    { name: 'Terms of Service', href: '/terms' },
  ],
};

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-midnight-blue text-white">
      <div className="container-max py-16 lg:py-20">
        {/* Main Footer Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-8 lg:gap-10">
          {/* Company Info */}
          <div className="col-span-2 md:col-span-3 lg:col-span-2">
            {/* Logo */}
            <Link to="/" className="inline-block mb-4">
              <Logo variant="full" size="md" theme="dark" />
            </Link>

            {/* Tagline */}
            <p className="text-white/60 text-sm">
              Fast, simple funding for the businesses that keep America running.
            </p>

            {/* Contact */}
            <div className="mt-5 space-y-1.5 text-sm">
              <a href="tel:+19547375692" className="block text-white/60 hover:text-white transition-colors">
                (954) 737-5692
              </a>
              <a href="mailto:sales@send.mfunding.net" className="block text-white/60 hover:text-white transition-colors">
                sales@send.mfunding.net
              </a>
            </div>
          </div>

          {/* Business Loans */}
          <div>
            <h4 className="font-semibold text-white mb-4">Business Loans</h4>
            <ul className="space-y-3">
              {footerLinks.businessLoans.map((link) => (
                <li key={link.name}>
                  <Link to={link.href} className="text-white/60 hover:text-white text-sm transition-colors">
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Real Estate */}
          <div>
            <h4 className="font-semibold text-white mb-4">Real Estate</h4>
            <ul className="space-y-3">
              {footerLinks.realEstate.map((link) => (
                <li key={link.name}>
                  <Link to={link.href} className="text-white/60 hover:text-white text-sm transition-colors">
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h4 className="font-semibold text-white mb-4">Resources</h4>
            <ul className="space-y-3">
              {footerLinks.resources.map((link) => (
                <li key={link.name}>
                  <Link to={link.href} className="text-white/60 hover:text-white text-sm transition-colors">
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
            <h4 className="font-semibold text-white mb-4 mt-6">Company</h4>
            <ul className="space-y-3">
              {footerLinks.company.map((link) => (
                <li key={link.name}>
                  <Link to={link.href} className="text-white/60 hover:text-white text-sm transition-colors">
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="font-semibold text-white mb-4">Legal</h4>
            <ul className="space-y-3">
              {footerLinks.legal.map((link) => (
                <li key={link.name}>
                  <Link to={link.href} className="text-white/60 hover:text-white text-sm transition-colors">
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="mt-16 pt-8 border-t border-white/10">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-white/40 text-sm">
              &copy; {currentYear} Agentic Voice Inc. d/b/a Momentum Funding. All rights reserved.
            </p>
            <p className="text-white/40 text-xs">
              Momentum Funding is a brand of Agentic Voice Inc., a financial services company. Funding
              provided is subject to approval and terms may vary based on business qualifications.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
