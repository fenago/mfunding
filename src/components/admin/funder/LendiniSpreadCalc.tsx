// ─────────────────────────────────────────────────────────────────────────────
// Lendini commission calculator
//
// Lendini is the SECOND funder on the shelf whose margin we choose. Like Bitty
// it pays no fixed commission percentage: the ISO points are built into the
// factor rate the merchant is quoted, so the moment a closer cuts the rate to
// win the deal, the cut comes out of OUR cheque, not Lendini's. Up to 15
// points on a full document submission — the most any funder in the network
// pays us — and paid within 24 hours of origination, the fastest in the book.
// With a string attached: 100% is clawed back if the merchant defaults inside
// 30 days.
//
// Two deliberate differences from the Bitty calculator:
//
//   • POINTS ARE A DROPDOWN, THE FACTOR IS NOT. Bitty publishes a tier grid,
//     so its buy rate can be a bounded list. Lendini publishes no buy-rate or
//     factor range to ISOs anywhere we can find, so a dropdown of factors
//     would be a list we invented. The real limit here is the 15-point
//     ceiling, and that is what gets bounded. The factor is typed in off the
//     approval, and the screen says why.
//   • IT SHOWS THE COST OF DISCOUNTING. The single thing a closer needs to
//     feel on this funder is that a rate concession is a pay cut, so the
//     panel prices the next point down in dollars rather than leaving it as
//     an abstraction.
//
// `fp-` prefixed: the page injects `.fcs` unlayered, which outranks any
// Tailwind utility sharing a class name.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from "react";

const MAX_POINTS = 15;

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const money2 = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

// Half points, held as integer halves so the arithmetic never drifts.
const HALVES: number[] = [];
for (let h = 1; h <= MAX_POINTS * 2; h += 1) HALVES.push(h);

const numOrNull = (s: string): number | null => {
  const t = s.replace(/[$,\s]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

export function LendiniSpreadCalc() {
  const [funded, setFunded] = useState("40000");
  const [halves, setHalves] = useState(24); // 12.0 points
  const [factor, setFactor] = useState("");
  const [freq, setFreq] = useState<"daily" | "weekly">("daily");
  const [periods, setPeriods] = useState("120");

  const points = halves / 2;

  const calc = useMemo(() => {
    const F = numOrNull(funded);
    if (F === null || F <= 0) return null;

    const commission = F * (points / 100);
    const onePointLess = F * 0.01;

    const f = numOrNull(factor);
    const n = numOrNull(periods);
    const payback = f !== null && f > 1 ? F * f : null;
    const perPayment = payback !== null && n !== null && n > 0 ? payback / n : null;
    // What the merchant pays for our margin, in their own currency: the same
    // dollars, spread over the same schedule.
    const markupPerPayment = n !== null && n > 0 ? commission / n : null;

    return { F, commission, onePointLess, payback, perPayment, markupPerPayment, f };
  }, [funded, points, factor, periods]);

  return (
    <div className="fp-panel">
      <div className="fp-teach">
        <div className="fp-tlead">
          <b>Lendini does not pay a commission rate. You set one.</b> This is the second funder in the book that
          works this way — Bitty is the other — and it pays the most of anything we have.
        </div>

        <ol className="fp-tsteps">
          <li>
            <span className="fp-tk">Your points are inside the merchant&rsquo;s rate.</span> Lendini does not add
            your commission on top and absorb it. It is baked into the factor the merchant is quoted, so{" "}
            <b>every point you take is a point the merchant pays</b>, and every point you give away to win the deal
            comes out of your cheque rather than theirs.
          </li>
          <li>
            <span className="fp-tk">The ceiling is 15 points on a full document submission.</span> That is the
            highest in the entire network — Bitty caps at 12, Reliant pays 6 to 10. A referral-only lead earns a
            negotiated referral fee instead, not points.
          </li>
          <li>
            <span className="fp-tk">You are paid within 24 hours of origination.</span> ACH or cheque. Nothing else
            on the shelf is close; most funders take five business days and one of them argues with itself about
            whether it is five or thirty.
          </li>
          <li>
            <span className="fp-tk">And it can all be taken back for 30 days.</span> If the merchant defaults inside
            30 days of funding, <b>100% of the commission is clawed back</b>. It comes back to you once Lendini has
            received 90% of the total repayment, and only if the account was cured inside a 48-hour window. Fast
            money with a string on it — do not spend it in the first month.
          </li>
        </ol>

        <div className="fp-twarn">
          The 15-point figure comes from a third-party lender review, not from a Lendini document. It is the
          working number and it is almost certainly right, but nobody here has it in writing from Mia Stephenson.
          Treat the output below as a model, not a promise.
        </div>
      </div>

      <div className="fp-calc">
        <div className="fp-field">
          <label htmlFor="lsc-amt">1 · Funded amount</label>
          <input
            id="lsc-amt"
            inputMode="decimal"
            value={funded}
            onChange={(e) => setFunded(e.target.value)}
            placeholder="40000"
          />
          <span className="fp-hint">What the merchant receives. Lendini&rsquo;s range is $5,100 – $300,000.</span>
        </div>

        <div className="fp-field">
          <label htmlFor="lsc-pts">2 · Points you take</label>
          <select id="lsc-pts" value={halves} onChange={(e) => setHalves(Number(e.target.value))}>
            {HALVES.map((h) => {
              const p = h / 2;
              const dollars = calc === null ? null : calc.F * (p / 100);
              return (
                <option key={h} value={h}>
                  {p.toFixed(1)} pt{p === 1 ? "" : "s"}
                  {dollars === null ? "" : ` · ${money(dollars)} to us`}
                </option>
              );
            })}
          </select>
          <span className="fp-hint">
            Bounded at {MAX_POINTS} because that is a real ceiling. One point = 1% of the funded amount.
          </span>
        </div>

        <div className="fp-field">
          <label htmlFor="lsc-factor">3 · Factor on the approval</label>
          <input
            id="lsc-factor"
            inputMode="decimal"
            value={factor}
            onChange={(e) => setFactor(e.target.value)}
            placeholder="e.g. 1.45"
          />
          <span className="fp-hint">
            Typed, not picked — Lendini publishes no factor range to ISOs, so a dropdown here would be a list we
            invented. Copy it off the approval. Leave it blank and you still get your commission figure.
          </span>
        </div>

        <div className="fp-field">
          <label htmlFor="lsc-freq">4 · Payment frequency</label>
          <select id="lsc-freq" value={freq} onChange={(e) => setFreq(e.target.value as "daily" | "weekly")}>
            <option value="daily">Daily, Monday–Friday</option>
            <option value="weekly">Weekly</option>
          </select>
          <span className="fp-hint">Lendini debits by ACH on one of these two schedules.</span>
        </div>

        <div className="fp-field">
          <label htmlFor="lsc-n">5 · Number of payments</label>
          <input id="lsc-n" inputMode="numeric" value={periods} onChange={(e) => setPeriods(e.target.value)} placeholder="120" />
          <span className="fp-hint">
            {freq === "daily"
              ? "Business days, so roughly 21 a month — 120 is about six months."
              : "Weeks — 26 is about six months."}
          </span>
        </div>
      </div>

      {calc === null ? (
        <div className="fp-verdict" style={{ color: "var(--ink-soft)" }}>
          Put in the funded amount and the rest fills itself in. Nothing is calculated from a blank box.
        </div>
      ) : (
        <>
          <div className="fp-capbar ok">
            <b>
              {points.toFixed(1)} points of {money(calc.F)} pays us {money(calc.commission)}.
            </b>{" "}
            Drop the rate by a single point to close it and you are giving away{" "}
            <b>{money(calc.onePointLess)}</b> of your own money — not Lendini&rsquo;s.
            {points < MAX_POINTS ? (
              <> You have {(MAX_POINTS - points).toFixed(1)} points of room left before the ceiling.</>
            ) : (
              <> You are at the 15-point ceiling.</>
            )}
          </div>

          <div className="fp-out">
            <div className="fp-ocell hero">
              <div className="fp-ok2">We earn</div>
              <div className="fp-ov">{money(calc.commission)}</div>
              <div className="fp-on">
                {points.toFixed(1)} pts of {money(calc.F)} · <b>paid within 24 hours of origination</b>
              </div>
            </div>

            <div className="fp-ocell bad">
              <div className="fp-ok2">At risk for 30 days</div>
              <div className="fp-ov">{money(calc.commission)}</div>
              <div className="fp-on">
                All of it. A default inside 30 days of funding claws back <b>100%</b>, returned only once Lendini
                has received 90% of the repayment and only if the account was cured within 48 hours.
              </div>
            </div>

            <div className="fp-ocell cost">
              <div className="fp-ok2">What our margin costs them</div>
              <div className="fp-ov">{money(calc.commission)}</div>
              <div className="fp-on">
                The same figure, by construction — our points live inside their factor
                {calc.markupPerPayment !== null ? (
                  <> · {money2(calc.markupPerPayment)} of every {freq === "daily" ? "daily" : "weekly"} debit</>
                ) : null}
              </div>
            </div>

            <div className="fp-ocell">
              <div className="fp-ok2">Merchant repays in total</div>
              <div className="fp-ov">{calc.payback === null ? "—" : money(calc.payback)}</div>
              <div className="fp-on">
                {calc.payback === null ? (
                  "Enter the factor from the approval to see this"
                ) : (
                  <>
                    {money(calc.F)} × {calc.f?.toFixed(2)} — their RTR
                  </>
                )}
              </div>
            </div>

            <div className="fp-ocell">
              <div className="fp-ok2">Each {freq === "daily" ? "daily" : "weekly"} payment</div>
              <div className="fp-ov">{calc.perPayment === null ? "—" : money2(calc.perPayment)}</div>
              <div className="fp-on">
                {calc.perPayment === null
                  ? "Needs the factor and the number of payments"
                  : `${periods} payments, ${freq === "daily" ? "Monday to Friday" : "weekly"}`}
              </div>
            </div>
          </div>
        </>
      )}

      <div className="fp-gloss">
        <b>The words, plainly.</b>
        <dl>
          <dt>Factor rate</dt>
          <dd>A multiplier, not interest. 1.45 means the merchant repays 1.45× what they received.</dd>
          <dt>Points</dt>
          <dd>Our commission. One point = 1% of the funded amount, and it sits inside the factor.</dd>
          <dt>Down-selling</dt>
          <dd>Cutting the merchant&rsquo;s rate to win the deal. At Lendini it cuts your pay, not theirs.</dd>
          <dt>RTR</dt>
          <dd>Funded amount × factor. The total the merchant repays. What you quote them.</dd>
          <dt>Clawback</dt>
          <dd>Commission taken back. Here: all of it, for the first 30 days after funding.</dd>
        </dl>
      </div>

      <div className="fp-foot" style={{ margin: "14px 16px 16px" }}>
        <b>Where this is approximate.</b> Payment figures assume a level schedule. The 15-point ceiling, the
        24-hour payment and the 30-day clawback all come from a third-party lender review of Lendini rather than
        from a Lendini document — get them confirmed by Mia Stephenson before anyone treats them as terms. The
        credit box, the restricted states and the industry caps DO come from Lendini, confirmed on a call on
        2026-10-23. <b>Nothing here is a quote to a merchant.</b>
      </div>
    </div>
  );
}
