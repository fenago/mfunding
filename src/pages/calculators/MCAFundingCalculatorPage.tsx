import { useState } from "react";
import { Link } from "react-router-dom";
import {
  BanknotesIcon,
  LockClosedIcon,
  CheckCircleIcon,
  ShieldCheckIcon,
  BoltIcon,
} from "@heroicons/react/24/outline";
import SEO from "../../components/seo/SEO";
import supabase from "../../supabase";
import { OSSection } from "../../components/landing/os/OSKit";
import {
  ToolShell,
  ToolHero,
  ToolPanel,
  PanelTitle,
  Slider,
  Field,
  SelectField,
  ResultHero,
} from "../../components/landing/os/tools/ToolsKit";

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const TIME_OPTIONS = [
  "Less than 6 months",
  "6 months - 1 year",
  "1 - 2 years",
  "2 - 5 years",
  "5+ years",
];
const INDUSTRY_OPTIONS = [
  "Retail",
  "Restaurant / Food Service",
  "Healthcare",
  "Construction",
  "Transportation",
  "Professional Services",
  "Manufacturing",
  "E-commerce",
  "Other",
];

interface ContactForm {
  business_name: string;
  contact_first_name: string;
  contact_last_name: string;
  email: string;
  phone: string;
}
const EMPTY_CONTACT: ContactForm = {
  business_name: "",
  contact_first_name: "",
  contact_last_name: "",
  email: "",
  phone: "",
};

export default function MCAFundingCalculatorPage() {
  // Calculator inputs
  const [monthlyRevenue, setMonthlyRevenue] = useState(50000);
  const [timeInBusiness, setTimeInBusiness] = useState("");
  const [industry, setIndustry] = useState("");

  // Contact-capture / gating
  const [form, setForm] = useState<ContactForm>(EMPTY_CONTACT);
  const [submitting, setSubmitting] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof ContactForm>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  // Approvals run 50%–150% of average monthly sales.
  const low = monthlyRevenue * 0.5;
  const high = monthlyRevenue * 1.5;
  const estimate = monthlyRevenue; // ~100% midpoint, used for the saved lead amount

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { data, error: submitError } = await supabase.functions.invoke("mca-intake", {
        body: {
          business_name: form.business_name || "",
          contact_first_name: form.contact_first_name,
          contact_last_name: form.contact_last_name || "",
          email: form.email,
          phone: form.phone,
          amount_requested: Math.round(estimate),
          use_of_funds: "Working capital",
          lead_source: "calculator",
          lead_source_detail: `Funding calculator — est. ${usd(low)}–${usd(high)} on ${usd(monthlyRevenue)}/mo${industry ? `, ${industry}` : ""}${timeInBusiness ? `, ${timeInBusiness}` : ""}`,
        },
      });
      if (submitError) throw new Error(submitError.message);
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      setUnlocked(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ToolShell>
      <SEO title="How Much Business Funding Can I Get?" description="Estimate how much business funding you qualify for based on your monthly revenue. Free instant calculator — no credit impact." keywords="how much business funding can I get, business funding calculator, merchant cash advance amount calculator" />

      <ToolHero
        eyebrow="WORKING CAPITAL CALCULATOR"
        title={
          <>
            HOW MUCH WORKING CAPITAL
            <br />
            <span className="os-go">CAN YOU GET?</span>
          </>
        }
        lede={
          <>
            Approvals typically run <strong>50%–150% of your average monthly sales</strong> — no
            minimum credit score, all industries welcome, funded in as little as 24 hours. Tell us
            your revenue to see your estimated range.
          </>
        }
      />

      <OSSection tone="panel">
        <div className="ost-cols">
          {/* Inputs */}
          <ToolPanel>
            <PanelTitle>
              <BanknotesIcon /> Your business
            </PanelTitle>

            <Slider
              label="Average monthly revenue"
              valueLabel={usd(monthlyRevenue)}
              min={5000}
              max={1000000}
              step={5000}
              value={monthlyRevenue}
              onChange={(e) => setMonthlyRevenue(Number(e.target.value))}
              minTick="$5K"
              maxTick="$1M"
            />

            <div style={{ marginBottom: 20 }}>
              <SelectField
                label="Time in business (optional)"
                value={timeInBusiness}
                onChange={setTimeInBusiness}
                placeholder="Select duration"
                options={TIME_OPTIONS}
              />
            </div>

            <SelectField
              label="Industry (optional)"
              value={industry}
              onChange={setIndustry}
              placeholder="Select industry"
              options={INDUSTRY_OPTIONS}
            />
          </ToolPanel>

          {/* Result + gate */}
          <ToolPanel>
            {unlocked ? (
              <>
                <PanelTitle>
                  <BoltIcon /> Your estimated funding
                </PanelTitle>

                <ResultHero
                  cap="Estimated advance range"
                  value={`${usd(low)} – ${usd(high)}`}
                  sub={`based on ${usd(monthlyRevenue)}/mo in revenue`}
                />

                <div className="ost-note" style={{ margin: "18px 0 16px" }}>
                  <CheckCircleIcon />
                  <p>
                    Thanks, {form.contact_first_name || "there"}! A funding specialist will reach out
                    within 24 hours with real options matched to your business — no credit impact to
                    check your rate.
                  </p>
                </div>

                <p className="ost-fine">
                  <ShieldCheckIcon />
                  This is an <strong>estimate only</strong>, not an offer, approval, or guarantee. A
                  merchant cash advance is a purchase of future receivables, not a loan. Final amounts
                  depend on underwriting and funder review.
                </p>

                <Link to="/" className="ost-back">
                  ← Back to home
                </Link>
              </>
            ) : (
              <>
                <div className="ost-lockhead">
                  <LockClosedIcon />
                  <PanelTitle>See your estimate</PanelTitle>
                </div>
                <p className="ost-lead">
                  Enter your info to unlock your estimated working-capital range and get matched with
                  funders. Free, no obligation, and checking won't affect your credit.
                </p>

                <form onSubmit={handleSubmit} className="ost-form">
                  <div className="ost-formgrid">
                    <Field
                      label="Business name"
                      col2
                      value={form.business_name}
                      onChange={(e) => set("business_name", e.target.value)}
                    />
                    <Field
                      label="First name *"
                      required
                      value={form.contact_first_name}
                      onChange={(e) => set("contact_first_name", e.target.value)}
                    />
                    <Field
                      label="Last name"
                      value={form.contact_last_name}
                      onChange={(e) => set("contact_last_name", e.target.value)}
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
                    {submitting ? "Calculating…" : "Show my funding estimate →"}
                  </button>
                  <p className="ost-fine" style={{ textAlign: "center" }}>
                    <ShieldCheckIcon />
                    No credit impact to check. Estimates only — not an offer or guarantee.
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
