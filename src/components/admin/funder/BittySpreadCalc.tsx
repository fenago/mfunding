// ─────────────────────────────────────────────────────────────────────────────
// Bitty spread calculator
//
// Bitty does not pay points. It pays `Funded Amount × (Sell Rate − Buy Rate)`
// (Compensation Schedule §4 / §1(g)). Bitty names the buy rate and a cap on
// each approval; we set the sell rate underneath it. So our commission is a
// price WE choose, and nothing else on the shelf works that way — which is
// exactly why it needs a calculator and the other products do not.
//
// The design rule that matters: this shows BOTH SIDES. Every dollar of
// commission is, to the penny, a dollar the merchant pays — the same
// `F × spread` term appears in our cheque and in their payback. A tool that
// showed only our upside would quietly teach everyone to max the spread on
// every file, which is how you win a commission once and lose the renewal,
// and renewals are the best thing about this funder. So the merchant's cost
// is on screen at the same size as ours, and the clawback exposure sits next
// to it.
//
// Nothing here is a quote. Bitty's real buy rate arrives with the approval
// and the tier factors are "starting rates" by their own note, so the buy
// rate is an editable input with a tier-derived default, never a fixed table
// lookup.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from "react";

type Tier = {
  id: string;
  name: string;
  factor: number;
  weeks: number;
  capPts: number;
  fico: string;
};

// Bitty Underwriting Guide, October 2026, v10. `factor` is their published
// STARTING rate for the tier and seeds the buy-rate field; `capPts` is the
// commission ceiling, which drops to 8 on Access.
const TIERS: Tier[] = [
  { id: "premier", name: "Premier", factor: 1.39, weeks: 69, capPts: 12, fico: "675+" },
  { id: "preferred", name: "Preferred", factor: 1.45, weeks: 60, capPts: 12, fico: "650+" },
  { id: "select", name: "Select", factor: 1.49, weeks: 56, capPts: 12, fico: "625+" },
  { id: "standard", name: "Standard", factor: 1.52, weeks: 54, capPts: 12, fico: "600+" },
  { id: "essential", name: "Essential", factor: 1.55, weeks: 52, capPts: 12, fico: "550+" },
  { id: "access", name: "Access", factor: 1.59, weeks: 50, capPts: 8, fico: "500+" },
];

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const money2 = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

// Parse a field the user is mid-way through typing. An empty or half-typed
// box must read as "nothing yet", never as a zero that renders a confident
// $0 commission.
const numOrNull = (s: string): number | null => {
  const t = s.replace(/[$,\s]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

export function BittySpreadCalc() {
  const [tierId, setTierId] = useState("select");
  const tier = TIERS.find((t) => t.id === tierId) ?? TIERS[2];

  const [funded, setFunded] = useState("25000");
  const [buy, setBuy] = useState("1.49");
  const [sell, setSell] = useState("1.59");
  const [weeks, setWeeks] = useState("56");

  // Changing tier reseeds buy rate and term, because those are the tier's
  // published starting values — but both stay editable, since the approval
  // carries the real ones.
  const pickTier = (id: string) => {
    const t = TIERS.find((x) => x.id === id);
    if (!t) return;
    setTierId(id);
    setBuy(t.factor.toFixed(2));
    setWeeks(String(t.weeks));
    const b = t.factor;
    const capped = b + t.capPts / 100;
    const cur = numOrNull(sell);
    if (cur === null || cur <= b || cur > capped) setSell(capped.toFixed(2));
  };

  const calc = useMemo(() => {
    const F = numOrNull(funded);
    const b = numOrNull(buy);
    const s = numOrNull(sell);
    const w = numOrNull(weeks);
    if (F === null || b === null || s === null || F <= 0 || b <= 0 || s <= 0) return null;

    const spread = s - b;
    const pts = spread * 100;
    const commission = F * spread;
    const payback = F * s;
    const term = w !== null && w > 0 ? w : null;
    const weekly = term ? payback / term : null;
    // Our markup is exactly what the merchant pays for it — same term.
    const weeklyMarkup = term ? commission / term : null;
    const clawbackUntil = payback * 0.2;
    // Level remittances, so 20% of the money is 20% of the schedule.
    const weeksAtRisk = term ? term * 0.2 : null;

    return {
      F, b, s, spread, pts, commission, payback, term, weekly, weeklyMarkup,
      clawbackUntil, weeksAtRisk,
      over: pts > tier.capPts + 1e-9,
      zero: spread <= 1e-9,
    };
  }, [funded, buy, sell, weeks, tier.capPts]);

  const maxSell = (() => {
    const b = numOrNull(buy);
    return b === null ? null : b + tier.capPts / 100;
  })();

  return (
    <div className="fp-panel">
      <div className="fp-calc">
        <div className="fp-field">
          <label htmlFor="bsc-tier">Tier</label>
          <select id="bsc-tier" value={tierId} onChange={(e) => pickTier(e.target.value)}>
            {TIERS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · {t.fico}
              </option>
            ))}
          </select>
          <span className="fp-hint">
            Cap {tier.capPts}% · starts at {tier.factor.toFixed(2)}
          </span>
        </div>

        <div className="fp-field">
          <label htmlFor="bsc-amt">Funded amount</label>
          <input
            id="bsc-amt"
            inputMode="decimal"
            value={funded}
            onChange={(e) => setFunded(e.target.value)}
            placeholder="25000"
          />
          <span className="fp-hint">$2,000 – $100,000</span>
        </div>

        <div className="fp-field">
          <label htmlFor="bsc-buy">Buy rate</label>
          <input id="bsc-buy" inputMode="decimal" value={buy} onChange={(e) => setBuy(e.target.value)} placeholder="1.49" />
          <span className="fp-hint">Bitty sets this on the approval</span>
        </div>

        <div className="fp-field">
          <label htmlFor="bsc-sell">Sell rate</label>
          <input id="bsc-sell" inputMode="decimal" value={sell} onChange={(e) => setSell(e.target.value)} placeholder="1.59" />
          <span className="fp-hint">{maxSell === null ? "You choose this" : `You choose this · max ${maxSell.toFixed(2)}`}</span>
        </div>

        <div className="fp-field">
          <label htmlFor="bsc-weeks">Term (weeks)</label>
          <input id="bsc-weeks" inputMode="numeric" value={weeks} onChange={(e) => setWeeks(e.target.value)} placeholder="56" />
          <span className="fp-hint">{tier.name} maximum is {tier.weeks}</span>
        </div>
      </div>

      {calc === null ? (
        <div className="fp-verdict" style={{ color: "var(--ink-soft)" }}>
          Fill in the funded amount, the buy rate Bitty gave you and the rate you intend to sell. Nothing is
          calculated from a blank box.
        </div>
      ) : (
        <>
          {calc.zero ? (
            <div className="fp-capbar zero">
              <b>At this sell rate you earn nothing.</b> Your commission is the amount the sell rate exceeds the buy
              rate — sell at or below {calc.b.toFixed(2)} and a funded deal pays us <b>$0</b>.
            </div>
          ) : calc.over ? (
            <div className="fp-capbar over">
              <b>Over Bitty's cap.</b> This spread is {calc.pts.toFixed(2)} points against a {tier.capPts}% ceiling
              on {tier.name}. Bitty sets a rate cap on every approval and will not let this through — drop the sell
              rate to {maxSell === null ? "the cap" : maxSell.toFixed(2)} or lower.
            </div>
          ) : (
            <div className="fp-capbar ok">
              <b>{calc.pts.toFixed(2)} points</b> of spread, inside the {tier.capPts}% cap on {tier.name}.
              {maxSell !== null && calc.s < maxSell - 1e-9 ? (
                <> You have {((maxSell - calc.s) * 100).toFixed(2)} points of room left.</>
              ) : (
                <> You are at the ceiling.</>
              )}
            </div>
          )}

          <div className="fp-out">
            <div className={`fp-ocell ${calc.zero || calc.over ? "bad" : "hero"}`}>
              <div className="fp-ok2">We earn</div>
              <div className="fp-ov">{money(calc.commission)}</div>
              <div className="fp-on">
                {calc.pts.toFixed(2)} pts of {money(calc.F)} · <b>paid the day it funds</b>
              </div>
            </div>

            <div className="fp-ocell cost">
              <div className="fp-ok2">What our markup costs them</div>
              <div className="fp-ov">{money(calc.commission)}</div>
              <div className="fp-on">
                Identical figure, by construction — every dollar we make is a dollar the merchant repays
                {calc.weeklyMarkup !== null ? <> · {money2(calc.weeklyMarkup)} a week</> : null}
              </div>
            </div>

            <div className="fp-ocell">
              <div className="fp-ok2">Merchant repays</div>
              <div className="fp-ov">{money(calc.payback)}</div>
              <div className="fp-on">
                {money(calc.F)} × {calc.s.toFixed(2)} factor — their RTR
              </div>
            </div>

            <div className="fp-ocell">
              <div className="fp-ok2">Their weekly payment</div>
              <div className="fp-ov">{calc.weekly === null ? "—" : money(calc.weekly)}</div>
              <div className="fp-on">
                {calc.term === null ? "Enter a term in weeks" : <>over {calc.term} weeks</>}
              </div>
            </div>

            <div className="fp-ocell">
              <div className="fp-ok2">Commission at risk until</div>
              <div className="fp-ov">{money(calc.clawbackUntil)}</div>
              <div className="fp-on">
                20% of RTR repaid
                {calc.weeksAtRisk !== null ? <> · about week {Math.ceil(calc.weeksAtRisk)}</> : null} — before that,
                a default <b>or one returned debit</b> claws back the whole {money(calc.commission)}
              </div>
            </div>
          </div>
        </>
      )}

      <div className="fp-foot" style={{ margin: "14px 16px 16px" }}>
        <b>How to read this.</b> The spread in factor points <i>is</i> the commission percentage — sell 0.12 above
        the buy rate and you earn 12% of the funded amount. The cap is per-approval and Bitty enforces it on their
        side, so treat the ceiling as real. Weekly figures assume level remittances; Bitty debits on a schedule, but
        a real file can vary. <b>Nothing here is a quote to a merchant</b> — the buy rate and the true cap arrive
        with the approval, and the tier factors are starting rates by Bitty's own note.
      </div>
    </div>
  );
}
