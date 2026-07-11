import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  BanknotesIcon,
  UserGroupIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  CalculatorIcon,
  ArrowTrendingUpIcon,
} from '@heroicons/react/24/outline';
import PageGuide from '../../components/admin/PageGuide';

const fmt = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);

function Slider({
  value, onChange, min, max, step, label, suffix = '', color = '#00A896',
}: {
  value: number; onChange: (v: number) => void; min: number; max: number; step: number;
  label: string; suffix?: string; color?: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="p-4 rounded-xl bg-white border border-gray-200 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        <span className="text-lg font-bold" style={{ color }}>
          {suffix === '$' ? fmt(value) : `${value}${suffix}`}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-2 rounded-full appearance-none cursor-pointer"
        style={{ background: `linear-gradient(to right, ${color} 0%, ${color} ${pct}%, #E5E7EB ${pct}%, #E5E7EB 100%)` }}
      />
    </div>
  );
}

export default function CloserCompPage() {
  // Deal economics
  const [dealSize, setDealSize] = useState(50000);
  const [points, setPoints] = useState(8); // company commission points
  // Splits
  const [companyLeadSplit, setCompanyLeadSplit] = useState(30); // % to closer on company leads (Momentum Standard)
  const [selfGenSplit, setSelfGenSplit] = useState(65); // % to closer on self-gen
  // Volume
  const [companyDeals, setCompanyDeals] = useState(6);
  const [selfGenDeals, setSelfGenDeals] = useState(2);
  // Draw
  const [draw, setDraw] = useState(2500);

  const c = useMemo(() => {
    const commission = dealSize * (points / 100); // company's gross commission per funded deal
    // company leads
    const closerCoLead = commission * (companyLeadSplit / 100);
    const companyKeepCoLead = commission - closerCoLead;
    // self-gen
    const closerSelfGen = commission * (selfGenSplit / 100);
    const companyKeepSelfGen = commission - closerSelfGen;
    // monthly
    const closerMonthly = closerCoLead * companyDeals + closerSelfGen * selfGenDeals;
    const companyMonthly = companyKeepCoLead * companyDeals + companyKeepSelfGen * selfGenDeals;
    const totalDeals = companyDeals + selfGenDeals;
    // draw: recoverable advance — if closer earns more than draw, draw is recovered (net cost $0)
    const drawShortfall = Math.max(0, draw - closerMonthly); // unrecovered draw (real cost to company that month)
    return {
      commission, closerCoLead, companyKeepCoLead, closerSelfGen, companyKeepSelfGen,
      closerMonthly, companyMonthly, totalDeals, drawShortfall,
      closerAnnual: closerMonthly * 12, companyAnnual: companyMonthly * 12,
    };
  }, [dealSize, points, companyLeadSplit, selfGenSplit, companyDeals, selfGenDeals, draw]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-8 py-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
          <BanknotesIcon className="w-7 h-7 text-mint-green" />
          Closer Compensation Plan
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Offer sheet for recruiting 1099 closers + an interactive comp calculator
        </p>
      </div>

      <div className="p-8 space-y-8">
        <PageGuide
          title="Closer Compensation"
          storageKey="closer-comp"
          what="Your closer comp plan + an interactive payout calculator."
          value="Set splits/draws that attract closers while protecting your margin."
          howToUse="Slide splits, deal size, volume, and draw to see take-home vs what you keep."
          howToRead="30% is the Momentum Standard company-lead split; you can set a different rate per closer in Admin → Closers."
        />

        {/* ============ CALCULATOR ============ */}
        <div className="grid lg:grid-cols-3 gap-8">
          {/* Inputs */}
          <div className="lg:col-span-1 space-y-4">
            <h2 className="text-lg font-semibold text-midnight-blue flex items-center gap-2">
              <CalculatorIcon className="w-5 h-5 text-mint-green" /> Comp Calculator
            </h2>
            <Slider value={dealSize} onChange={setDealSize} min={25000} max={250000} step={5000} label="Average Deal Size" suffix="$" color="#00D49D" />
            <Slider value={points} onChange={setPoints} min={1} max={12} step={0.5} label="Your Commission (points)" suffix=" pts" color="#007EA7" />
            <Slider value={companyLeadSplit} onChange={setCompanyLeadSplit} min={20} max={60} step={5} label="Closer Split — Company Leads" suffix="%" color="#9333EA" />
            <Slider value={selfGenSplit} onChange={setSelfGenSplit} min={40} max={80} step={5} label="Closer Split — Self-Generated" suffix="%" color="#9333EA" />
            <Slider value={companyDeals} onChange={setCompanyDeals} min={0} max={30} step={1} label="Company-Lead Deals / mo" suffix="" color="#F59E0B" />
            <Slider value={selfGenDeals} onChange={setSelfGenDeals} min={0} max={20} step={1} label="Self-Gen Deals / mo" suffix="" color="#F59E0B" />
            <Slider value={draw} onChange={setDraw} min={0} max={6000} step={250} label="Monthly Draw (recoverable)" suffix="$" color="#E11D48" />
          </div>

          {/* Outputs */}
          <div className="lg:col-span-2 space-y-6">
            {/* Per-deal */}
            <div className="grid md:grid-cols-2 gap-4">
              <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
                <p className="text-sm font-semibold text-gray-500 mb-3">Per Company-Lead Deal</p>
                <p className="text-xs text-gray-400">Your gross commission</p>
                <p className="text-2xl font-bold text-gray-800 mb-3">{fmt(c.commission)}</p>
                <div className="flex justify-between text-sm py-1 border-t border-gray-100">
                  <span className="text-gray-600">Closer gets ({companyLeadSplit}%)</span>
                  <span className="font-semibold text-purple-600">{fmt(c.closerCoLead)}</span>
                </div>
                <div className="flex justify-between text-sm py-1">
                  <span className="text-gray-600">You keep</span>
                  <span className="font-semibold text-mint-green">{fmt(c.companyKeepCoLead)}</span>
                </div>
              </div>
              <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
                <p className="text-sm font-semibold text-gray-500 mb-3">Per Self-Generated Deal</p>
                <p className="text-xs text-gray-400">Your gross commission</p>
                <p className="text-2xl font-bold text-gray-800 mb-3">{fmt(c.commission)}</p>
                <div className="flex justify-between text-sm py-1 border-t border-gray-100">
                  <span className="text-gray-600">Closer gets ({selfGenSplit}%)</span>
                  <span className="font-semibold text-purple-600">{fmt(c.closerSelfGen)}</span>
                </div>
                <div className="flex justify-between text-sm py-1">
                  <span className="text-gray-600">You keep</span>
                  <span className="font-semibold text-mint-green">{fmt(c.companyKeepSelfGen)}</span>
                </div>
              </div>
            </div>

            {/* Monthly totals */}
            <div className="grid md:grid-cols-3 gap-4">
              <motion.div whileHover={{ y: -2 }} className="bg-gradient-to-br from-purple-50 to-purple-100/50 rounded-2xl p-6 border border-purple-200">
                <UserGroupIcon className="w-6 h-6 text-purple-600 mb-2" />
                <p className="text-sm text-purple-700 font-medium">Closer earns / mo</p>
                <p className="text-3xl font-bold text-purple-700">{fmt(c.closerMonthly)}</p>
                <p className="text-xs text-purple-500 mt-1">{fmt(c.closerAnnual)}/yr · {c.totalDeals} deals/mo</p>
              </motion.div>
              <motion.div whileHover={{ y: -2 }} className="bg-gradient-to-br from-mint-green/10 to-teal/10 rounded-2xl p-6 border border-mint-green/30">
                <ArrowTrendingUpIcon className="w-6 h-6 text-mint-green mb-2" />
                <p className="text-sm text-gray-600 font-medium">You keep / mo</p>
                <p className="text-3xl font-bold text-mint-green">{fmt(c.companyMonthly)}</p>
                <p className="text-xs text-gray-500 mt-1">{fmt(c.companyAnnual)}/yr from this closer</p>
              </motion.div>
              <motion.div whileHover={{ y: -2 }} className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
                <BanknotesIcon className="w-6 h-6 text-rose-500 mb-2" />
                <p className="text-sm text-gray-600 font-medium">Unrecovered draw / mo</p>
                <p className="text-3xl font-bold text-rose-500">{fmt(c.drawShortfall)}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {c.drawShortfall === 0 ? 'Draw fully recovered by commissions ✓' : 'Real cost if closer underperforms draw'}
                </p>
              </motion.div>
            </div>

            {/* 30% Momentum Standard callout */}
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 flex items-start gap-3">
              <ExclamationTriangleIcon className="w-6 h-6 text-amber-500 flex-shrink-0" />
              <div className="text-sm text-amber-800">
                <p className="font-semibold mb-1">30% is the Momentum Standard company-lead split</p>
                <p>
                  On <strong>company-provided leads</strong> we start every closer at the <strong>Momentum Standard
                  30%</strong> — paired with a ramp-up draw, performance escalators, and renewal upside — and you can raise
                  an individual closer's rate in <strong>Admin → Closers</strong> as they prove out. Keep
                  <strong> self-generated</strong> deals higher (60–70%); never use 30% there. Slide the values above to
                  model the trade-off.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ============ OFFER SHEET ============ */}
        <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100 max-w-4xl">
          <h2 className="text-xl font-bold text-midnight-blue mb-1">MCA Closer — Compensation Offer Sheet</h2>
          <p className="text-sm text-gray-500 mb-6">1099 Independent Contractor · Commission-only · Momentum Funding</p>

          <Section title="The Role">
            <p>Close inbound and transferred merchant leads for working-capital and business-funding products. You own the
              conversation from first call to funded. We provide the CRM, phone system, funder relationships, and (for company
              leads) the leads themselves. You bring the hustle and the close.</p>
          </Section>

          <Section title="How You Get Paid">
            <ul className="list-disc pl-5 space-y-1.5">
              <li><strong>Commission-only, 1099.</strong> No cap. You earn a share of the commission on every deal you fund.</li>
              <li><strong>Company-provided leads:</strong> <strong>30%</strong> of the deal commission to you — the Momentum Standard company-lead split.</li>
              <li><strong>Self-generated leads:</strong> <strong>65%</strong> of the deal commission to you.</li>
              <li><strong>Renewals</strong> on your <strong>self-generated</strong> funded book: <strong>30%</strong> (or routed to a renewals specialist). Renewals apply to your self-gen deals only — company-lead deals are not renewal-eligible for the closer.</li>
              <li>Example: $50K advance, 8-point commission = $4,000. Company lead → <strong>you earn $1,200</strong>. Self-gen → <strong>you earn $2,600</strong>.</li>
            </ul>
          </Section>

          <Section title="Ramp-Up Draw (optional)">
            <p>To support you while you build a pipeline, we offer a <strong>recoverable draw of up to $2,500/month for your
              first 90 days</strong>. A draw is an advance against your future commissions — it's recovered from what you earn,
              not a salary. If you out-earn the draw (you will, quickly), there's nothing to recover.</p>
          </Section>

          <Section title="When You're Paid">
            <p>Commissions are paid <strong>within 5 business days after the funder pays Momentum</strong> on a funded deal —
              not at the point of sale. We pay when we get paid.</p>
          </Section>

          <Section title="Clawback (important)">
            <p>If a merchant defaults within the funder's clawback window (typically the first payments/days), the funder reverses
              our commission — and the corresponding portion of your commission is <strong>clawed back or deducted from future
              commissions</strong>. This protects everyone and keeps us underwriting quality, performing deals. Full terms are in
              the Independent Contractor Commission Agreement.</p>
          </Section>

          <Section title="Performance Escalators (grow your split)">
            <p className="mb-2">Your company-lead split climbs with your monthly funded volume — <strong>30% → 35% → 40%</strong>:</p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li><strong>Tier 1 — Base:</strong> <strong>30%</strong> company-lead split (the Momentum Standard).</li>
              <li><strong>Tier 2:</strong> fund <strong>$150K+</strong> in a month (≈3 funded deals) → company-lead split rises to <strong>35%</strong>.</li>
              <li><strong>Tier 3:</strong> fund <strong>$300K+</strong> in a month (≈6 funded deals) → company-lead split rises to <strong>40%</strong>.</li>
              <li>Top performers get first pick of premium live transfers.</li>
            </ul>
            <p className="mt-2 text-xs text-gray-500">Escalators apply to company-lead deals funded in the qualifying month and reset monthly; self-gen and renewal rates are unaffected. Thresholds are set by management and may be adjusted.</p>
          </Section>

          <Section title="What We Provide vs. What You Bring">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="rounded-xl bg-mint-green/5 border border-mint-green/20 p-4">
                <p className="font-semibold text-mint-green mb-2">We provide</p>
                <ul className="text-sm space-y-1 text-gray-700">
                  <li>• VibeReach (the CRM) + dialer + local numbers</li>
                  <li>• Company leads / live transfers (30% company-lead split)</li>
                  <li>• Funder network + submission support</li>
                  <li>• Scripts, training, doc-collection automation</li>
                </ul>
              </div>
              <div className="rounded-xl bg-gray-50 border border-gray-200 p-4">
                <p className="font-semibold text-gray-700 mb-2">You bring</p>
                <ul className="text-sm space-y-1 text-gray-700">
                  <li>• Phone hustle + closing skill</li>
                  <li>• &lt;60-second speed-to-lead + relentless follow-up</li>
                  <li>• Your own taxes/expenses (1099)</li>
                  <li>• Integrity + compliance (never call an MCA a "loan")</li>
                </ul>
              </div>
            </div>
          </Section>

          <Section title="The Terms (summary)">
            <p>1099 independent contractor · commission-only + optional draw · non-solicitation &amp; non-circumvention (12 months)
              · confidentiality · TCPA/regulatory compliance required · full terms in the signed Independent Contractor Commission
              Agreement (Schedule A sets your exact rates).</p>
          </Section>

          <div className="mt-6 rounded-xl bg-midnight-blue text-white p-5">
            <p className="font-semibold">The math that matters to you</p>
            <p className="text-white/80 text-sm mt-1">
              Close 8 funded deals/month (6 company + 2 self-gen) at $50K average and you take home about
              <strong className="text-mint-green"> {fmt(4000 * 0.3 * 6 + 4000 * 0.65 * 2)}/month</strong> — commission-only, no cap,
              paid 5 days after funding. Hit the escalators and top closers do far more.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
        <CheckCircleIcon className="w-5 h-5 text-mint-green" /> {title}
      </h3>
      <div className="text-gray-700 text-sm leading-relaxed pl-7">{children}</div>
    </div>
  );
}
