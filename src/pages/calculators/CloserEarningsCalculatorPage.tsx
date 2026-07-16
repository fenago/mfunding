import { useState } from "react";
import { Link } from "react-router-dom";
import {
  BriefcaseIcon,
  LockClosedIcon,
  CheckCircleIcon,
  ShieldCheckIcon,
  TrophyIcon,
} from "@heroicons/react/24/outline";
import SEO from "../../components/seo/SEO";
import supabase from "../../supabase";
import { mustWrite } from "@/supabase/writes";
import { OSSection } from "../../components/landing/os/OSKit";
import {
  ToolShell,
  ToolHero,
  ToolPanel,
  PanelTitle,
  Slider,
  Field,
  ResultHero,
  StatTile,
} from "../../components/landing/os/tools/ToolsKit";

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

interface ContactForm {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
}
const EMPTY_CONTACT: ContactForm = { first_name: "", last_name: "", email: "", phone: "" };

export default function CloserEarningsCalculatorPage() {
  // Calculator inputs
  const [dealsPerMonth, setDealsPerMonth] = useState(6);
  const [avgDealSize, setAvgDealSize] = useState(50000);
  const [splitPct, setSplitPct] = useState(30);

  // Contact-capture / gating
  const [form, setForm] = useState<ContactForm>(EMPTY_CONTACT);
  const [submitting, setSubmitting] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof ContactForm>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  // Commission = 8 points (8% of funded amount); the closer keeps their split.
  const commissionPerDeal = avgDealSize * 0.08;
  const earningsPerDeal = commissionPerDeal * (splitPct / 100);
  const monthly = earningsPerDeal * dealsPerMonth;
  const annual = monthly * 12;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await mustWrite(
        "submit closer recruiting application",
        supabase.from("contact_submissions").insert({
          name: `${form.first_name} ${form.last_name}`.trim(),
          email: form.email,
          phone: form.phone || null,
          subject: "MCA Closer Recruiting Application",
          message:
            `Recruiting lead from closer-earnings calculator. ` +
            `Inputs: ${dealsPerMonth} deals/mo, avg deal ${usd(avgDealSize)}, ${splitPct}% split. ` +
            `Projected: ${usd(monthly)}/mo, ${usd(annual)}/yr.`,
        }),
      );
      setUnlocked(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ToolShell>
      <SEO title="MCA Closer Earnings Calculator" description="Estimate your potential earnings as a 1099 MCA closer with Momentum Funding. Calculate commission on funded deals." keywords="MCA closer earnings, commission calculator, MCA sales rep income" />

      <ToolHero
        eyebrow="CLOSER EARNINGS CALCULATOR"
        title={
          <>
            HOW MUCH CAN YOU EARN
            <br />
            <span className="os-go">AS AN MCA CLOSER?</span>
          </>
        }
        lede={
          <>
            Our 1099 closers earn a generous split on <strong>every funded deal</strong> — company
            leads provided. Adjust the numbers to see your earning potential, then apply to join the
            team.
          </>
        }
      />

      <OSSection tone="panel">
        <div className="ost-cols">
          {/* Inputs */}
          <ToolPanel>
            <PanelTitle>
              <BriefcaseIcon /> Your potential
            </PanelTitle>

            <Slider
              label="Funded deals per month"
              valueLabel={dealsPerMonth}
              min={1}
              max={30}
              step={1}
              value={dealsPerMonth}
              onChange={(e) => setDealsPerMonth(Number(e.target.value))}
              minTick="1"
              maxTick="30"
            />

            <Slider
              label="Average deal size"
              valueLabel={usd(avgDealSize)}
              min={10000}
              max={250000}
              step={5000}
              value={avgDealSize}
              onChange={(e) => setAvgDealSize(Number(e.target.value))}
              minTick="$10K"
              maxTick="$250K"
            />

            <Slider
              label="Your commission split"
              valueLabel={`${splitPct}%`}
              min={30}
              max={70}
              step={5}
              value={splitPct}
              onChange={(e) => setSplitPct(Number(e.target.value))}
              minTick="30% company leads"
              maxTick="70% self-gen"
            />

            <p className="ost-fieldnote">
              Based on 8 points (8% of funded amount) per new deal — the standard MCA broker
              commission. Your split is applied to that commission.
            </p>
          </ToolPanel>

          {/* Result + gate */}
          <ToolPanel>
            {unlocked ? (
              <>
                <PanelTitle>
                  <TrophyIcon /> Your earning potential
                </PanelTitle>

                <div className="ost-statgrid ost-statgrid-2">
                  <StatTile value={usd(monthly)} label="Per month" go />
                  <StatTile value={usd(annual)} label="Per year" go />
                </div>

                <ResultHero
                  cap="Per funded deal"
                  value={usd(earningsPerDeal)}
                  sub={`at a ${splitPct}% split`}
                />

                <div className="ost-note" style={{ margin: "18px 0 16px" }}>
                  <CheckCircleIcon />
                  <p>
                    Thanks, {form.first_name || "there"}! Your application is in. Our team will reach
                    out to talk through the role, leads, and onboarding.
                  </p>
                </div>

                <p className="ost-fine">
                  <ShieldCheckIcon />
                  Figures are <strong>estimates</strong> of earning potential, not a guarantee of
                  income. Actual earnings depend on close rate, deal flow, and individual
                  performance. Closers are independent (1099) contractors.
                </p>

                <Link to="/" className="ost-back">
                  ← Back to home
                </Link>
              </>
            ) : (
              <>
                <div className="ost-lockhead">
                  <LockClosedIcon />
                  <PanelTitle>See your earning potential</PanelTitle>
                </div>
                <p className="ost-lead">
                  Enter your info to unlock your projected monthly and annual earnings — and apply to
                  join our closer team.
                </p>

                <form onSubmit={handleSubmit} className="ost-form">
                  <div className="ost-formgrid">
                    <Field
                      label="First name *"
                      required
                      value={form.first_name}
                      onChange={(e) => set("first_name", e.target.value)}
                    />
                    <Field
                      label="Last name"
                      value={form.last_name}
                      onChange={(e) => set("last_name", e.target.value)}
                    />
                    <Field
                      label="Email *"
                      required
                      type="email"
                      value={form.email}
                      onChange={(e) => set("email", e.target.value)}
                    />
                    <Field
                      label="Phone *"
                      required
                      type="tel"
                      value={form.phone}
                      onChange={(e) => set("phone", e.target.value)}
                    />
                  </div>

                  {error && <p className="ost-err">{error}</p>}

                  <button type="submit" disabled={submitting} className="os-cta-primary ost-submit">
                    {submitting ? "Submitting…" : "Show my earnings & apply to join →"}
                  </button>
                  <p className="ost-fine" style={{ textAlign: "center" }}>
                    <ShieldCheckIcon />
                    Earning potential is an estimate, not a guarantee of income.
                  </p>
                </form>
              </>
            )}
          </ToolPanel>
        </div>
      </OSSection>
    </ToolShell>
  );
}
