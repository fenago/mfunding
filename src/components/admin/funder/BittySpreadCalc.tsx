// ─────────────────────────────────────────────────────────────────────────────
// Bitty spread calculator
//
// Bitty does not pay points. It pays `Funded Amount × (Sell Rate − Buy Rate)`
// (Compensation Schedule §4 / §1(g)). Bitty names the buy rate and a cap on
// each approval; we set the sell rate underneath it. So our commission is a
// price WE choose, and nothing else on the shelf works that way — which is
// exactly why it needs a calculator and the other products do not.
//
// REBUILT 2026-10-30 on the owner's note: "Nobody knows what the fuck the sell
// rate is… I know this stuff and I'm still confused by it." The maths was
// right and the teaching was absent, so the tool assumed the vocabulary it
// exists to explain. Two changes:
//
//   • It teaches before it calculates. The block at the top walks the actual
//     numbers on screen, in order, in words — what a factor rate is, who sets
//     which one, and where the commission comes from.
//   • Buy and sell rates are DROPDOWNS, not free text. The sell list contains
//     only legal values — above the buy rate, at or under the tier cap — and
//     every option is labelled with the points and the dollars it pays. You
//     pick the outcome, not a number you have to reason about. The two ways to
//     get this wrong (sell at the buy rate and earn nothing, sell over the cap
//     and have Bitty reject it) are now unreachable rather than warned about.
//
// The design rule that still matters: this shows BOTH SIDES. Every dollar of
// commission is, to the penny, a dollar the merchant pays — the same
// `F × spread` term appears in our cheque and in their payback. A tool that
// showed only our upside would quietly teach everyone to max the spread on
// every file, which is how you win a commission once and lose the renewal,
// and renewals are the best thing about this funder.
//
// Nothing here is a quote. Bitty's real buy rate arrives with the approval and
// the tier factors are "starting rates" by their own note.
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

// The buy rate arrives on the approval, so the list has to be wider than the
// published starting factors without pretending to be unbounded. 1.35–1.85 in
// one-point steps covers every rate Bitty's own guide contemplates with room
// either side; the tier's published start is flagged inside the list.
const BUY_MIN = 1.35;
const BUY_MAX = 1.85;

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const money2 = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

// Factor rates are compared and summed all over this file. Doing that in
// floating point gives you 1.4900000000000002, so every rate is handled as an
// integer number of basis points and only converted at the edges.
const bp = (factor: number) => Math.round(factor * 100);
const fromBp = (points: number) => points / 100;
const fmt = (points: number) => fromBp(points).toFixed(2);

// Parse a field the user is mid-way through typing. An empty or half-typed box
// must read as "nothing yet", never as a zero that renders a confident $0.
const numOrNull = (s: string): number | null => {
  const t = s.replace(/[$,\s]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const BUY_OPTIONS: number[] = [];
for (let p = bp(BUY_MIN); p <= bp(BUY_MAX); p += 1) BUY_OPTIONS.push(p);

export function BittySpreadCalc() {
  const [tierId, setTierId] = useState("select");
  const tier = TIERS.find((t) => t.id === tierId) ?? TIERS[2];

  const [funded, setFunded] = useState("25000");
  const [weeks, setWeeks] = useState("56");
  // Both rates are held in basis points so the dropdowns, the cap arithmetic
  // and the spread all agree exactly.
  const [buyBp, setBuyBp] = useState(bp(1.49));
  const [sellBp, setSellBp] = useState(bp(1.49) + 10);

  // Every sell rate that is both profitable and inside the cap. The list IS
  // the validation — there is no illegal value to choose.
  const sellOptions = useMemo(() => {
    const out: number[] = [];
    for (let p = buyBp + 1; p <= buyBp + tier.capPts; p += 1) out.push(p);
    return out;
  }, [buyBp, tier.capPts]);

  // Keep the chosen sell rate legal when the buy rate or the tier moves. Hold
  // the POINTS the user picked rather than the rate, so changing the buy rate
  // keeps their commission intent instead of silently repricing the file.
  const reconcile = (nextBuy: number, nextCap: number, prevBuy: number, prevSell: number) => {
    const wantPts = Math.min(Math.max(prevSell - prevBuy, 1), nextCap);
    setSellBp(nextBuy + wantPts);
  };

  const pickTier = (id: string) => {
    const t = TIERS.find((x) => x.id === id);
    if (!t) return;
    setTierId(id);
    const nextBuy = bp(t.factor);
    setBuyBp(nextBuy);
    setWeeks(String(t.weeks));
    reconcile(nextBuy, t.capPts, buyBp, sellBp);
  };

  const pickBuy = (nextBuy: number) => {
    reconcile(nextBuy, tier.capPts, buyBp, sellBp);
    setBuyBp(nextBuy);
  };

  const spreadPts = sellBp - buyBp;
  const roomPts = tier.capPts - spreadPts;

  const calc = useMemo(() => {
    const F = numOrNull(funded);
    const w = numOrNull(weeks);
    if (F === null || F <= 0) return null;

    const spread = fromBp(spreadPts);
    const commission = F * spread;
    const payback = F * fromBp(sellBp);
    const term = w !== null && w > 0 ? w : null;
    const weekly = term ? payback / term : null;
    // Our markup is exactly what the merchant pays for it — same term.
    const weeklyMarkup = term ? commission / term : null;
    const clawbackUntil = payback * 0.2;
    // Level remittances, so 20% of the money is 20% of the schedule.
    const weeksAtRisk = term ? term * 0.2 : null;

    return { F, commission, payback, term, weekly, weeklyMarkup, clawbackUntil, weeksAtRisk };
  }, [funded, weeks, spreadPts, sellBp]);

  return (
    <div className="fp-panel">
      {/* ── Teach it before you ask for it ─────────────────────────────── */}
      <div className="fp-teach">
        <div className="fp-tlead">
          <b>Read this once and you will never be confused by a Bitty number again.</b> Bitty is the only funder on
          the shelf that does not pay us a commission percentage. We set our own price, and these four numbers are
          how.
          {calc === null ? (
            <>
              {" "}
              <i>The amounts below use a $25,000 example until you type a funded amount.</i>
            </>
          ) : null}
        </div>

        <ol className="fp-tsteps">
          <li>
            <span className="fp-tk">A factor rate is not interest.</span> It is a multiplier. A{" "}
            <b>{fmt(sellBp)}</b> factor on <b>{money(calc?.F ?? 25000)}</b> means the merchant repays{" "}
            <b>{money((calc?.F ?? 25000) * fromBp(sellBp))}</b> in total. That is the whole calculation — there is
            no APR, no compounding, and it does not change if they pay early (except for Bitty's own early-payoff
            discount).
          </li>
          <li>
            <span className="fp-tk">The BUY rate is Bitty's price to us.</span> It comes back on the approval and we
            do not negotiate it. At <b>{fmt(buyBp)}</b>, Bitty wants{" "}
            <b>{money((calc?.F ?? 25000) * fromBp(buyBp))}</b> back on a {money(calc?.F ?? 25000)} advance. Every
            cent of that is theirs.
          </li>
          <li>
            <span className="fp-tk">The SELL rate is our price to the merchant.</span> We choose it, above the buy
            rate, up to a ceiling Bitty puts on each approval — <b>{tier.capPts} points</b> on {tier.name}. You are
            picking it right now in the dropdown below.
          </li>
          <li>
            <span className="fp-tk">The gap between them is our entire pay.</span>{" "}
            <b>
              {fmt(sellBp)} − {fmt(buyBp)} = {(spreadPts / 100).toFixed(2)}
            </b>
            , which is <b>{spreadPts} points</b>, which is <b>{spreadPts}% of the funded amount</b> — a factor point
            and a commission point are the same thing here. Sell at the buy rate and we are paid nothing, which is
            why the dropdown does not offer it.
          </li>
        </ol>

        <div className="fp-twarn">
          The merchant pays our commission. It is not a fee Bitty absorbs — it is added to what they owe, so a
          bigger spread is a bigger bill for them and a worse renewal for us. Price the file, do not max it.
        </div>
      </div>

      <div className="fp-calc">
        <div className="fp-field">
          <label htmlFor="bsc-tier">1 · Tier Bitty approved</label>
          <select id="bsc-tier" value={tierId} onChange={(e) => pickTier(e.target.value)}>
            {TIERS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · FICO {t.fico}
              </option>
            ))}
          </select>
          <span className="fp-hint">
            Sets the starting rate and your {tier.capPts}-point ceiling. It comes from the merchant's FICO.
          </span>
        </div>

        <div className="fp-field">
          <label htmlFor="bsc-amt">2 · Funded amount</label>
          <input
            id="bsc-amt"
            inputMode="decimal"
            value={funded}
            onChange={(e) => setFunded(e.target.value)}
            placeholder="25000"
          />
          <span className="fp-hint">What the merchant receives. Bitty's range is $2,000 – $100,000.</span>
        </div>

        <div className="fp-field">
          <label htmlFor="bsc-buy">3 · Buy rate — Bitty's</label>
          <select id="bsc-buy" value={buyBp} onChange={(e) => pickBuy(Number(e.target.value))}>
            {BUY_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {fmt(p)}
                {p === bp(tier.factor) ? ` · ${tier.name} starting rate` : ""}
              </option>
            ))}
          </select>
          <span className="fp-hint">
            Copy this off the approval email. Until it arrives, {tier.name} starts at {tier.factor.toFixed(2)}.
          </span>
        </div>

        <div className="fp-field">
          <label htmlFor="bsc-sell">4 · Sell rate — yours</label>
          <select id="bsc-sell" value={sellBp} onChange={(e) => setSellBp(Number(e.target.value))}>
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
            Every option here is legal — above the buy rate, at or under the {tier.capPts}-point cap. Pick the pay,
            not the number.
          </span>
        </div>

        <div className="fp-field">
          <label htmlFor="bsc-weeks">5 · Term (weeks)</label>
          <input id="bsc-weeks" inputMode="numeric" value={weeks} onChange={(e) => setWeeks(e.target.value)} placeholder="56" />
          <span className="fp-hint">
            How long they repay over. {tier.name} allows up to {tier.weeks}. Longer term, smaller weekly payment,
            same total.
          </span>
        </div>
      </div>

      <div className="fp-capbar ok">
        <b>
          You are selling {fmt(buyBp)} at {fmt(sellBp)} — a {spreadPts}-point spread.
        </b>{" "}
        {roomPts > 0 ? (
          <>
            That is {roomPts} point{roomPts === 1 ? "" : "s"} below the {tier.capPts}-point ceiling on {tier.name}
            {calc === null ? null : <> — another {money(calc.F * fromBp(roomPts))} is available if the file warrants it</>}.
          </>
        ) : (
          <>That is the ceiling on {tier.name}. There is no more room on this approval.</>
        )}
      </div>

      {calc === null ? (
        <div className="fp-verdict" style={{ color: "var(--ink-soft)" }}>
          Put in the funded amount and the rest fills itself in. Nothing is calculated from a blank box.
        </div>
      ) : (
        <div className="fp-out">
          <div className="fp-ocell hero">
            <div className="fp-ok2">We earn</div>
            <div className="fp-ov">{money(calc.commission)}</div>
            <div className="fp-on">
              {spreadPts} pts of {money(calc.F)} · <b>paid the day it funds</b>
            </div>
          </div>

          <div className="fp-ocell cost">
            <div className="fp-ok2">What our markup costs them</div>
            <div className="fp-ov">{money(calc.commission)}</div>
            <div className="fp-on">
              The same figure, by construction — every dollar we make is a dollar the merchant repays
              {calc.weeklyMarkup !== null ? <> · {money2(calc.weeklyMarkup)} a week of their payment</> : null}
            </div>
          </div>

          <div className="fp-ocell">
            <div className="fp-ok2">Merchant repays in total</div>
            <div className="fp-ov">{money(calc.payback)}</div>
            <div className="fp-on">
              {money(calc.F)} × {fmt(sellBp)} — the industry calls this their RTR, the Return To Recipient
            </div>
          </div>

          <div className="fp-ocell">
            <div className="fp-ok2">Their weekly payment</div>
            <div className="fp-ov">{calc.weekly === null ? "—" : money(calc.weekly)}</div>
            <div className="fp-on">
              {calc.term === null ? "Enter a term in weeks" : <>{money(calc.payback)} over {calc.term} weeks</>}
            </div>
          </div>

          <div className="fp-ocell">
            <div className="fp-ok2">Our commission is at risk until</div>
            <div className="fp-ov">{money(calc.clawbackUntil)}</div>
            <div className="fp-on">
              is repaid — 20% of the RTR
              {calc.weeksAtRisk !== null ? <>, about week {Math.ceil(calc.weeksAtRisk)}</> : null}. Before that, a
              default <b>or a single returned debit</b> claws back the whole {money(calc.commission)}.
            </div>
          </div>
        </div>
      )}

      <div className="fp-gloss">
        <b>The five words, plainly.</b>
        <dl>
          <dt>Factor rate</dt>
          <dd>A multiplier, not an interest rate. 1.49 means repay 1.49× what you received.</dd>
          <dt>Buy rate</dt>
          <dd>Bitty's price to us. Arrives on the approval. Not negotiable, not ours.</dd>
          <dt>Sell rate</dt>
          <dd>Our price to the merchant. We choose it, above the buy rate, under the cap.</dd>
          <dt>Spread</dt>
          <dd>Sell minus buy. Our whole commission. One factor point = 1% of the funded amount.</dd>
          <dt>RTR</dt>
          <dd>Funded amount × sell rate. The total the merchant repays. What you quote them.</dd>
        </dl>
      </div>

      <div className="fp-foot" style={{ margin: "14px 16px 16px" }}>
        <b>Where this is approximate.</b> Weekly figures assume level remittances; Bitty debits on a schedule and a
        real file can vary. The cap is per-approval and Bitty enforces it on their side, so treat the ceiling as
        real even though this tool now makes it impossible to exceed. <b>Nothing here is a quote to a merchant</b> —
        the buy rate and the true cap arrive with the approval, and the tier factors are starting rates by Bitty's
        own note. Source: Bitty Underwriting Guide, October 2026 v10, and the Compensation Schedule §1(g) / §4 of
        the Referral Agreement.
      </div>
    </div>
  );
}
