// ─────────────────────────────────────────────────────────────────────────────
// Working Capital calculator — Reliant and Green Note
//
// The clean lane works the opposite way round from Bitty and Lendini. There
// the funder names a buy rate and WE choose the margin on top. Here the funder
// prices the deal and pays us points off it, so there is no spread to set —
// the job of this tool is to let a closer quote the merchant correctly and see
// what the file is worth.
//
// It has to do one more thing honestly. We hold a 6-10 point range for Reliant
// and we hold NOTHING for Green Note — not a rate, not a range, the fields are
// empty. So on the Green Note side the commission panel does not quietly show
// a zero or borrow Reliant's number; it says we cannot compute it, says why,
// and says who to ask. An empty read must never render as a figure.
//
// `fp-` prefixed: the page injects `.fcs` unlayered, which outranks any
// Tailwind utility sharing a class name.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from "react";

type FunderId = "reliant" | "greennote";

type Funder = {
  id: FunderId;
  name: string;
  /** Null where we genuinely hold no commission data. Never a guess. */
  points: { min: number; max: number } | null;
  factorHint: string;
  defaultFactor: string;
  maxMonths: number;
  note: string;
};

const FUNDERS: Funder[] = [
  {
    id: "reliant",
    name: "Reliant Funding",
    points: { min: 6, max: 10 },
    factorHint: "Their published starting factor is 1.20 — the cheapest on any line in this book.",
    defaultFactor: "1.20",
    maxMonths: 24,
    note:
      "$10,000 – $300,000 · 6 months trading · $4,000/mo, the lowest revenue floor in our network · no FICO minimum · all 50 states · 3 months of statements.",
  },
  {
    id: "greennote",
    name: "Green Note Capital",
    points: null,
    factorHint: "Their recorded buy rate is 1.3% (~1.30 factor). Terms run up to 12 months.",
    defaultFactor: "1.30",
    maxMonths: 12,
    note:
      "$10,000 – $2,000,000 · 12 months trading · $20,000/mo in deposits, the highest gate on this line · 550 FICO · max 5 NSFs · all 50 states · will stack, no position limit.",
  },
];

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const money2 = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

const numOrNull = (s: string): number | null => {
  const t = s.replace(/[$,\s]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

export function WorkingCapitalCalc() {
  const [who, setWho] = useState<FunderId>("reliant");
  const funder = FUNDERS.find((f) => f.id === who) ?? FUNDERS[0];

  const [funded, setFunded] = useState("60000");
  const [factor, setFactor] = useState("1.20");
  const [months, setMonths] = useState("12");
  const [freq, setFreq] = useState<"daily" | "weekly">("weekly");
  const [halves, setHalves] = useState(16); // 8.0 points

  const pickFunder = (id: FunderId) => {
    const f = FUNDERS.find((x) => x.id === id);
    if (!f) return;
    setWho(id);
    setFactor(f.defaultFactor);
    const m = numOrNull(months);
    if (m === null || m > f.maxMonths) setMonths(String(f.maxMonths));
    if (f.points) {
      const p = halves / 2;
      const clamped = Math.min(Math.max(p, f.points.min), f.points.max);
      setHalves(Math.round(clamped * 2));
    }
  };

  const pointOptions = useMemo(() => {
    if (!funder.points) return [];
    const out: number[] = [];
    for (let h = funder.points.min * 2; h <= funder.points.max * 2; h += 1) out.push(h);
    return out;
  }, [funder.points]);

  const calc = useMemo(() => {
    const F = numOrNull(funded);
    const f = numOrNull(factor);
    const m = numOrNull(months);
    if (F === null || F <= 0) return null;

    const payback = f !== null && f > 1 ? F * f : null;
    const periods = m !== null && m > 0 ? (freq === "daily" ? Math.round(m * 21) : Math.round(m * 4.33)) : null;
    const perPayment = payback !== null && periods !== null && periods > 0 ? payback / periods : null;
    const cost = payback !== null ? payback - F : null;

    const points = funder.points ? halves / 2 : null;
    const commission = points === null ? null : F * (points / 100);

    return { F, payback, periods, perPayment, cost, points, commission, f };
  }, [funded, factor, months, freq, halves, funder.points]);

  return (
    <div className="fp-panel">
      <div className="fp-teach">
        <div className="fp-tlead">
          <b>This lane works the opposite way round from Bitty and Lendini.</b> There the funder gives us a buy
          rate and we choose the margin on top. Here the funder prices the deal and pays us <i>points off it</i> —
          there is no spread to set, so your job is to quote the merchant correctly and know what the file is
          worth.
        </div>

        <ol className="fp-tsteps">
          <li>
            <span className="fp-tk">A factor rate is a multiplier, not interest.</span> {funder.defaultFactor} on{" "}
            {money(calc?.F ?? 60000)} means the merchant repays{" "}
            <b>{money((calc?.F ?? 60000) * Number(funder.defaultFactor))}</b> in total. No APR, no compounding.
          </li>
          <li>
            <span className="fp-tk">The gate on this line is the bank statement, not the credit score.</span>{" "}
            Reliant takes $4,000 a month and six months trading. Green Note needs <b>$20,000 a month</b> and a
            year. FICO barely separates them — 550 against no minimum at all. Ask about deposits early.
          </li>
          <li>
            <span className="fp-tk">Points are a percentage of the funded amount.</span> 8 points on $60,000 is
            $4,800 to us, and unlike Lendini it does not shrink if the rate moves — the funder sets the price, we
            take our cut off it.
          </li>
          <li>
            <span className="fp-tk">Cheaper money is the point of this lane.</span> A 1.20 factor costs the
            merchant a fifth of what they borrowed. The Bridge lane starts nearer 1.45. Sending a clean file down
            the expensive lane wins one commission and loses the renewal.
          </li>
        </ol>
      </div>

      <div className="fp-calc">
        <div className="fp-field">
          <label htmlFor="wcc-who">1 · Funder</label>
          <select id="wcc-who" value={who} onChange={(e) => pickFunder(e.target.value as FunderId)}>
            {FUNDERS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <span className="fp-hint">{funder.note}</span>
        </div>

        <div className="fp-field">
          <label htmlFor="wcc-amt">2 · Funded amount</label>
          <input id="wcc-amt" inputMode="decimal" value={funded} onChange={(e) => setFunded(e.target.value)} placeholder="60000" />
          <span className="fp-hint">What the merchant receives.</span>
        </div>

        <div className="fp-field">
          <label htmlFor="wcc-factor">3 · Factor</label>
          <input id="wcc-factor" inputMode="decimal" value={factor} onChange={(e) => setFactor(e.target.value)} placeholder={funder.defaultFactor} />
          <span className="fp-hint">
            {funder.factorHint} Typed rather than picked, because neither funder publishes a factor table to us —
            the real one arrives on the approval.
          </span>
        </div>

        <div className="fp-field">
          <label htmlFor="wcc-months">4 · Term (months)</label>
          <input id="wcc-months" inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} placeholder="12" />
          <span className="fp-hint">{funder.name} goes up to {funder.maxMonths} months.</span>
        </div>

        <div className="fp-field">
          <label htmlFor="wcc-freq">5 · Payments</label>
          <select id="wcc-freq" value={freq} onChange={(e) => setFreq(e.target.value as "daily" | "weekly")}>
            <option value="weekly">Weekly</option>
            <option value="daily">Daily, business days</option>
          </select>
          <span className="fp-hint">Both funders debit on either schedule.</span>
        </div>

        {funder.points ? (
          <div className="fp-field">
            <label htmlFor="wcc-pts">6 · Points we take</label>
            <select id="wcc-pts" value={halves} onChange={(e) => setHalves(Number(e.target.value))}>
              {pointOptions.map((h) => {
                const p = h / 2;
                const dollars = calc === null ? null : calc.F * (p / 100);
                return (
                  <option key={h} value={h}>
                    {p.toFixed(1)} pts{dollars === null ? "" : ` · ${money(dollars)} to us`}
                  </option>
                );
              })}
            </select>
            <span className="fp-hint">
              Bounded to the {funder.points.min}–{funder.points.max} range on their record. What moves a file
              inside that range is not documented anywhere — nobody has asked.
            </span>
          </div>
        ) : (
          <div className="fp-field">
            <label htmlFor="wcc-nopts">6 · Points we take</label>
            <select id="wcc-nopts" disabled value="">
              <option value="">Not known</option>
            </select>
            <span className="fp-hint">
              We hold no commission figure for Green Note. Not a rate, not a range — the fields are empty.
            </span>
          </div>
        )}
      </div>

      {calc === null ? (
        <div className="fp-verdict" style={{ color: "var(--ink-soft)" }}>
          Put in the funded amount and the rest fills itself in. Nothing is calculated from a blank box.
        </div>
      ) : (
        <>
          {funder.points === null ? (
            <div className="fp-capbar zero">
              <b>We cannot tell you what this file pays us.</b> Green Note&rsquo;s commission rate and structure
              are both empty on their record — this is a gap in what we hold, not a zero and not a bad deal. The
              merchant-side figures below are sound and you can quote them. Dean Simms answers quickly; one email
              closes this.
            </div>
          ) : (
            <div className="fp-capbar ok">
              <b>
                {calc.points?.toFixed(1)} points of {money(calc.F)} pays us {money(calc.commission ?? 0)}.
              </b>{" "}
              Points here are off the funded amount and do not move with the rate, so quoting the merchant a better
              factor costs us nothing — unlike Lendini on the Bridge line.
            </div>
          )}

          <div className="fp-out">
            <div className={`fp-ocell ${funder.points === null ? "" : "hero"}`}>
              <div className="fp-ok2">We earn</div>
              <div className="fp-ov">
                {calc.commission === null ? <span className="fp-miss">not known</span> : money(calc.commission)}
              </div>
              <div className="fp-on">
                {calc.commission === null ? (
                  <>No commission data on file for Green Note — ask Dean Simms</>
                ) : (
                  <>
                    {calc.points?.toFixed(1)} pts of {money(calc.F)}
                  </>
                )}
              </div>
            </div>

            <div className="fp-ocell">
              <div className="fp-ok2">Merchant repays in total</div>
              <div className="fp-ov">{calc.payback === null ? "—" : money(calc.payback)}</div>
              <div className="fp-on">
                {calc.payback === null ? (
                  "Enter a factor above 1.00"
                ) : (
                  <>
                    {money(calc.F)} × {calc.f?.toFixed(2)} — their RTR
                  </>
                )}
              </div>
            </div>

            <div className="fp-ocell cost">
              <div className="fp-ok2">What the money costs them</div>
              <div className="fp-ov">{calc.cost === null ? "—" : money(calc.cost)}</div>
              <div className="fp-on">
                {calc.cost === null ? "Needs a factor" : <>on top of the {money(calc.F)} they received</>}
              </div>
            </div>

            <div className="fp-ocell">
              <div className="fp-ok2">Each {freq === "daily" ? "daily" : "weekly"} payment</div>
              <div className="fp-ov">{calc.perPayment === null ? "—" : money2(calc.perPayment)}</div>
              <div className="fp-on">
                {calc.periods === null
                  ? "Needs a term"
                  : `${calc.periods} payments over ${months} months${freq === "daily" ? ", business days only" : ""}`}
              </div>
            </div>
          </div>
        </>
      )}

      <div className="fp-foot" style={{ margin: "14px 16px 16px" }}>
        <b>Where this is approximate.</b> Payment counts assume 21 business days or 4.33 weeks a month and a level
        schedule; a real file varies. Reliant charges an origination fee that varies by customer and advance size
        and has never been published to us, so the merchant&rsquo;s true cost is slightly higher than shown.
        Reliant&rsquo;s 6–10 points is recorded on their row; <b>Green Note has no commission data at all</b> and
        the panel says so rather than guessing. <b>Nothing here is a quote to a merchant.</b>
      </div>
    </div>
  );
}
