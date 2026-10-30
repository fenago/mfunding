// ─────────────────────────────────────────────────────────────────────────────
// Lendini spread calculator
//
// Lendini is the SECOND funder on the shelf whose margin we choose. Their own
// ISO submission guidelines put it in five words — "15 Point maximum upsell" —
// against "Buy Rates Starting at 1.25" (Quick Fix Capital, their sister brand,
// starts at 1.35). So this is the same mechanic as Bitty: the funder names a
// buy rate, we sell above it, and the spread up to fifteen points is ours.
//
// ⚠ CORRECTED 2026-10-30, hours after first shipping. The first version of
// this file took the points as a flat percentage of the funded amount and said
// on screen that "Lendini publishes no factor range to ISOs, so a dropdown
// here would be a list we invented." That was wrong — their partner sheet
// publishes the buy rate, we simply had not read it yet. It is now a real
// spread calculator with a bounded buy rate, and the note it used to carry is
// gone rather than softened.
//
// The commission is paid by ACH "typically received the business day
// following origination" — their words, and the fastest in the network.
//
// `fp-` prefixed: the page injects `.fcs` unlayered, which outranks any
// Tailwind utility sharing a class name.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from "react";

const MAX_UPSELL_PTS = 15;

type Brand = {
  id: string;
  name: string;
  buyFrom: number;
  tib: string;
};

// Both brands are Funding Metrics, LLC. An ISO can submit to either, and the
// buy rate is the reason you would choose: Quick Fix takes a shorter trading
// history and charges ten points more for it.
const BRANDS: Brand[] = [
  { id: "lendini", name: "Lendini", buyFrom: 1.25, tib: "8 months trading" },
  { id: "qfc", name: "Quick Fix Capital", buyFrom: 1.35, tib: "5 months trading" },
];

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const money2 = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

// Rates are handled as integer basis points so the dropdowns, the cap
// arithmetic and the spread all agree exactly. 1.49 - 1.25 in floating point
// is 0.24000000000000002.
const bp = (factor: number) => Math.round(factor * 100);
const fromBp = (points: number) => points / 100;
const fmt = (points: number) => fromBp(points).toFixed(2);

const numOrNull = (s: string): number | null => {
  const t = s.replace(/[$,\s]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

export function LendiniSpreadCalc() {
  const [brandId, setBrandId] = useState("lendini");
  const brand = BRANDS.find((b) => b.id === brandId) ?? BRANDS[0];

  const [funded, setFunded] = useState("40000");
  const [buyBp, setBuyBp] = useState(bp(1.25));
  const [sellBp, setSellBp] = useState(bp(1.25) + 10);
  const [freq, setFreq] = useState<"daily" | "weekly">("daily");
  const [days, setDays] = useState("150");

  // The buy rate STARTS at the brand's floor — it can come back worse on the
  // approval, never better. 35 points of headroom covers anything their guide
  // contemplates without pretending the list is unbounded.
  const buyOptions = useMemo(() => {
    const out: number[] = [];
    for (let p = bp(brand.buyFrom); p <= bp(brand.buyFrom) + 35; p += 1) out.push(p);
    return out;
  }, [brand.buyFrom]);

  // Every sell rate that is both profitable and inside the 15-point upsell.
  // The list IS the validation — there is no illegal value to pick.
  const sellOptions = useMemo(() => {
    const out: number[] = [];
    for (let p = buyBp + 1; p <= buyBp + MAX_UPSELL_PTS; p += 1) out.push(p);
    return out;
  }, [buyBp]);

  // Hold the POINTS the closer picked, not the rate, so moving the buy rate
  // keeps their commission intent instead of silently repricing the file.
  const pickBuy = (nextBuy: number) => {
    const want = Math.min(Math.max(sellBp - buyBp, 1), MAX_UPSELL_PTS);
    setBuyBp(nextBuy);
    setSellBp(nextBuy + want);
  };

  const pickBrand = (id: string) => {
    const b = BRANDS.find((x) => x.id === id);
    if (!b) return;
    setBrandId(id);
    pickBuy(bp(b.buyFrom));
  };

  const spreadPts = sellBp - buyBp;
  const roomPts = MAX_UPSELL_PTS - spreadPts;

  const calc = useMemo(() => {
    const F = numOrNull(funded);
    const n = numOrNull(days);
    if (F === null || F <= 0) return null;

    const commission = F * fromBp(spreadPts);
    const onePointLess = F * 0.01;
    const payback = F * fromBp(sellBp);
    const periods = n !== null && n > 0 ? (freq === "daily" ? Math.round((n / 7) * 5) : Math.round(n / 7)) : null;
    const perPayment = periods !== null && periods > 0 ? payback / periods : null;
    const markupPerPayment = periods !== null && periods > 0 ? commission / periods : null;

    return { F, commission, onePointLess, payback, periods, perPayment, markupPerPayment };
  }, [funded, spreadPts, sellBp, days, freq]);

  return (
    <div className="fp-panel">
      <div className="fp-teach">
        <div className="fp-tlead">
          <b>Lendini does not pay a commission rate. You set one.</b> This is the second funder in the book that
          works this way — Bitty is the other — and it pays the most of anything we have. Their partner sheet
          gives two bullets and no mechanic: <i>&ldquo;15 Point maximum upsell&rdquo;</i> and{" "}
          <i>&ldquo;Buy Rates Starting at 1.25&rdquo;</i>. Reading those as a spread we choose is what upsell
          normally means, and it is almost certainly right — but they never actually say it, so treat the output
          as a model until Mia Stephenson confirms the mechanic.
          {calc === null ? (
            <>
              {" "}
              <i>Figures below use a $40,000 example until you type an amount.</i>
            </>
          ) : null}
        </div>

        <ol className="fp-tsteps">
          <li>
            <span className="fp-tk">A factor rate is a multiplier, not interest.</span> A <b>{fmt(sellBp)}</b>{" "}
            factor on <b>{money(calc?.F ?? 40000)}</b> means the merchant repays{" "}
            <b>{money((calc?.F ?? 40000) * fromBp(sellBp))}</b> in total. No APR and no compounding.
          </li>
          <li>
            <span className="fp-tk">The BUY rate is Lendini&rsquo;s price to us.</span> Their published floor is{" "}
            <b>{brand.buyFrom.toFixed(2)}</b> for {brand.name} — it can come back worse on the approval, never
            better. At <b>{fmt(buyBp)}</b> they want <b>{money((calc?.F ?? 40000) * fromBp(buyBp))}</b> back on a{" "}
            {money(calc?.F ?? 40000)} advance, and every cent of it is theirs.
          </li>
          <li>
            <span className="fp-tk">The SELL rate is our price to the merchant.</span> We choose it above the buy
            rate, up to fifteen points higher. You are picking it in the dropdown below.
          </li>
          <li>
            <span className="fp-tk">The gap is our entire pay — and discounting comes out of it.</span>{" "}
            <b>
              {fmt(sellBp)} &minus; {fmt(buyBp)} = {(spreadPts / 100).toFixed(2)}
            </b>
            , which is <b>{spreadPts} points</b>, which is <b>{spreadPts}% of the funded amount</b>. Cut the rate
            by one point to win the deal and you are giving away your own money, not Lendini&rsquo;s. The dropdown
            will not offer you the buy rate itself, because selling at it pays us nothing.
          </li>
          <li>
            <span className="fp-tk">You are paid the next business day — and it is at risk for 30.</span> Their
            sheet: ISO commission by ACH, <i>&ldquo;typically received the business day following
            origination.&rdquo;</i> Nothing else on the shelf is close. But a default inside 30 days of funding
            claws back <b>100%</b> of it, returned only once Lendini has received 90% of the repayment and only if
            the account was cured within a 48-hour window. Do not spend it in the first month.
          </li>
        </ol>

        <div className="fp-twarn">
          The merchant pays our spread. It is not a fee Lendini absorbs — it is inside the factor they are quoted,
          so a bigger spread is a bigger bill for them and a worse renewal for us. Price the file, do not max it.
        </div>
      </div>

      <div className="fp-calc">
        <div className="fp-field">
          <label htmlFor="lsc-brand">1 · Brand</label>
          <select id="lsc-brand" value={brandId} onChange={(e) => pickBrand(e.target.value)}>
            {BRANDS.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} · buy from {b.buyFrom.toFixed(2)}
              </option>
            ))}
          </select>
          <span className="fp-hint">
            Both are Funding Metrics. {brand.name} needs {brand.tib}
            {brand.id === "qfc"
              ? " — the shorter history costs the merchant ten points, and Quick Fix is the one with NO position limit."
              : ", and takes 1st to 4th positions only. A 5th-position merchant is a decline."}
          </span>
        </div>

        <div className="fp-field">
          <label htmlFor="lsc-amt">2 · Funded amount</label>
          <input id="lsc-amt" inputMode="decimal" value={funded} onChange={(e) => setFunded(e.target.value)} placeholder="40000" />
          <span className="fp-hint">What the merchant receives. Approvals up to $300,000.</span>
        </div>

        <div className="fp-field">
          <label htmlFor="lsc-buy">3 · Buy rate — theirs</label>
          <select id="lsc-buy" value={buyBp} onChange={(e) => pickBuy(Number(e.target.value))}>
            {buyOptions.map((p) => (
              <option key={p} value={p}>
                {fmt(p)}
                {p === bp(brand.buyFrom) ? ` · ${brand.name} floor` : ""}
              </option>
            ))}
          </select>
          <span className="fp-hint">
            Copy it off the approval. {brand.buyFrom.toFixed(2)} is a published FLOOR, not a quoted rate — it can
            come back worse and their sheet never says what moves it.
          </span>
        </div>

        <div className="fp-field">
          <label htmlFor="lsc-sell">4 · Sell rate — yours</label>
          <select id="lsc-sell" value={sellBp} onChange={(e) => setSellBp(Number(e.target.value))}>
            {sellOptions.map((p) => {
              const pts = p - buyBp;
              const dollars = calc === null ? null : calc.F * fromBp(pts);
              return (
                <option key={p} value={p}>
                  {fmt(p)} · {pts} pt{pts === 1 ? "" : "s"}
                  {dollars === null ? "" : ` · ${money(dollars)} to us`}
                </option>
              );
            })}
          </select>
          <span className="fp-hint">
            Every option is legal — above the buy rate, inside the 15-point upsell. Pick the pay, not the number.
          </span>
        </div>

        <div className="fp-field">
          <label htmlFor="lsc-days">5 · Term (days)</label>
          <input id="lsc-days" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} placeholder="150" />
          <span className="fp-hint">Their sheet says estimated terms up to 200 days.</span>
        </div>

        <div className="fp-field">
          <label htmlFor="lsc-freq">6 · Remittance</label>
          <select id="lsc-freq" value={freq} onChange={(e) => setFreq(e.target.value as "daily" | "weekly")}>
            <option value="daily">Daily, business days</option>
            <option value="weekly">Weekly</option>
          </select>
          <span className="fp-hint">Lendini offers both.</span>
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
              You are buying at {fmt(buyBp)} and selling at {fmt(sellBp)} — {spreadPts} points,{" "}
              {money(calc.commission)}.
            </b>{" "}
            Drop the rate one point to close it and you give away <b>{money(calc.onePointLess)}</b> of your own
            money.
            {roomPts > 0 ? (
              <> You have {roomPts} point{roomPts === 1 ? "" : "s"} of upsell left before the fifteen-point ceiling.</>
            ) : (
              <> You are at the fifteen-point ceiling.</>
            )}
          </div>

          <div className="fp-out">
            <div className="fp-ocell hero">
              <div className="fp-ok2">We earn</div>
              <div className="fp-ov">{money(calc.commission)}</div>
              <div className="fp-on">
                {spreadPts} pts of {money(calc.F)} · <b>ACH the business day after origination</b>
              </div>
            </div>

            <div className="fp-ocell bad">
              <div className="fp-ok2">At risk for 30 days</div>
              <div className="fp-ov">{money(calc.commission)}</div>
              <div className="fp-on">
                All of it. A default inside 30 days claws back <b>100%</b>, returned only once Lendini has 90% of
                the repayment and only if the account was cured within 48 hours.
              </div>
            </div>

            <div className="fp-ocell cost">
              <div className="fp-ok2">What our spread costs them</div>
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
              <div className="fp-ov">{money(calc.payback)}</div>
              <div className="fp-on">
                {money(calc.F)} × {fmt(sellBp)} — their RTR
              </div>
            </div>

            <div className="fp-ocell">
              <div className="fp-ok2">Each {freq === "daily" ? "daily" : "weekly"} payment</div>
              <div className="fp-ov">{calc.perPayment === null ? "—" : money2(calc.perPayment)}</div>
              <div className="fp-on">
                {calc.periods === null
                  ? "Enter a term in days"
                  : `${calc.periods} payments across ${days} days${freq === "daily" ? ", business days only" : ""}`}
              </div>
            </div>
          </div>
        </>
      )}

      <div className="fp-gloss">
        <b>The words, plainly.</b>
        <dl>
          <dt>Factor rate</dt>
          <dd>A multiplier, not interest. 1.40 means the merchant repays 1.40× what they received.</dd>
          <dt>Buy rate</dt>
          <dd>Lendini&rsquo;s price to us. Published from 1.25; the real one arrives on the approval.</dd>
          <dt>Upsell</dt>
          <dd>How far above the buy rate we sell. Capped at 15 points. This is our whole commission.</dd>
          <dt>RTR</dt>
          <dd>Funded amount × sell rate. The total the merchant repays. What you quote them.</dd>
          <dt>Clawback</dt>
          <dd>Commission taken back. Here: all of it, for the first 30 days after funding.</dd>
        </dl>
      </div>

      <div className="fp-foot" style={{ margin: "14px 16px 16px" }}>
        <b>Where this comes from and where it is approximate.</b> The 1.25 and 1.35 buy-rate floors, the 15-point
        maximum upsell, the next-business-day ACH and the 200-day term all come from Lendini&rsquo;s own ISO
        submission guidelines, filed on their funder record — first-party, not a third-party review. The 30-day
        clawback is still sourced to a third-party review and has not been confirmed by Lendini. Payment counts
        assume a level schedule and five business days a week. The guidelines are a print of their legacy partner
        site and carry their own &ldquo;consult your Account Manager&rdquo; caveat, so where this and the
        2026-10-23 call with Mia Stephenson disagree, the call is newer. <b>Nothing here is a quote to a
        merchant.</b>
      </div>
    </div>
  );
}
