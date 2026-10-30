// ─────────────────────────────────────────────────────────────────────────────
// Term & Line of Credit calculator — UCS, GoKapital, and 1 West last
//
// This line is unlike every other calculator in this book. On Bitty and
// Lendini we choose a margin. On Working Capital the funder prices the deal
// and pays us points. Here BOTH funders publish a per-product commission
// grid — and the two grids disagree with each other so sharply that the same
// borrower is worth four times as much at one funder as at the other,
// depending only on which product they end up taking.
//
// Three things this tool exists to stop:
//
//  1. Routing a term loan to GoKapital. UCS pays up to 10%; GoKapital pays
//     2.5% for the same work. On a $150,000 file that is $15,000 against
//     $3,750.
//  2. Routing a line of credit to UCS without thinking. UCS pays on the
//     INITIAL DRAW ONLY; GoKapital pays on the TOTAL APPROVED AND ACCEPTED
//     amount. A borrower approved for $100,000 who draws $20,000 is worth
//     $600 at UCS and $2,500 at GoKapital — the rule flips.
//  3. Selling SBA for the commission. 50 basis points at UCS. It is a
//     relationship product, and the tool says so out loud.
//
// 1 West is the last resort here by the owner's rule, exactly as on the other
// lines, and it is the one funder whose file CANNOT be priced: we are paid a
// share of 1 West's own compensation and we have never seen that number. The
// panel refuses to print a figure rather than borrowing one. An empty read
// must never render as a zero.
//
// Every rate below is first-party, from the funders' own published grids as
// recorded on their funder records. Nothing here is inferred.
//
// `fp-` prefixed: the page injects `.fcs` unlayered, which outranks any
// Tailwind utility sharing a class name.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from "react";

type FunderId = "ucs" | "gk" | "onewest";
type ProductId = "term" | "loc" | "sba" | "equip" | "mca" | "personal" | "hardmoney" | "cre";
type Tier = "broker" | "affiliate";
type Role = "brokered" | "referred";

/** What the percentage is taken OF. The whole point of this line. */
type Basis = "net" | "firstDraw" | "approved";

type UcsPay = { min: number; max: number; basis: Basis; note: string };
type GkPay = { broker: number; affiliate: number; basis: Basis; note: string };

type Product = {
  id: ProductId;
  label: string;
  blurb: string;
  ucs: UcsPay | null;
  gk: GkPay | null;
  /** Rendered as a stop strip rather than a commission figure. */
  caution?: string;
};

const PRODUCTS: Product[] = [
  {
    id: "term",
    label: "Business term loan",
    blurb:
      "A fixed sum, a fixed end date, monthly or weekly payments. The flagship of this line and the best-paying product on it.",
    ucs: { min: 1, max: 10, basis: "net", note: "Up to 10% of the NET funded amount." },
    gk: { broker: 2.5, affiliate: 0.5, basis: "net", note: "2.5% broker tier, 0.5% affiliate, on net funded." },
  },
  {
    id: "loc",
    label: "Line of credit",
    blurb:
      "A revolving facility the borrower draws against. Read the basis line below before you route this one anywhere.",
    ucs: {
      min: 1,
      max: 3,
      basis: "firstDraw",
      note: "1–3% ON THE INITIAL DRAW ONLY. No residual on later draws — a revolving facility pays us once however often it is redrawn.",
    },
    gk: {
      broker: 2.5,
      affiliate: 0.5,
      basis: "approved",
      note: "2.5% broker tier on the TOTAL APPROVED AND ACCEPTED amount, paid after the first draw.",
    },
  },
  {
    id: "sba",
    label: "SBA 7(a)",
    blurb:
      "The cheapest money a borrower on this shelf can get, and the worst-paying file we can write. Sell it as the relationship, not the commission.",
    ucs: { min: 0.5, max: 0.5, basis: "net", note: "50 basis points. Half of one percent, fixed." },
    gk: { broker: 1, affiliate: 0.5, basis: "net", note: "1% broker tier, 0.5% affiliate." },
  },
  {
    id: "equip",
    label: "Equipment finance",
    blurb: "Secured against the kit. UCS goes to $10M at 575 FICO and three months trading.",
    ucs: { min: 1, max: 10, basis: "net", note: "Up to 10% of net funded." },
    gk: { broker: 4, affiliate: 1, basis: "net", note: "4% broker tier, 1% affiliate — equipment leasing." },
  },
  {
    id: "mca",
    label: "MCA / revenue-based",
    blurb:
      "Shown for comparison only. An advance does not belong on this tab — it belongs on Working Capital or Bridge. Both funders here publish a rate, so a closer weighing a cross-sell can see it.",
    ucs: { min: 1, max: 10, basis: "net", note: "Up to 10%, by the rate sold." },
    gk: { broker: 6, affiliate: 2, basis: "net", note: "6% broker tier, 2% affiliate." },
  },
  {
    id: "personal",
    label: "Personal & start-up",
    blurb: "On GoKapital's published grid. UCS does not offer it to us.",
    ucs: null,
    gk: { broker: 3, affiliate: 1, basis: "net", note: "3% broker tier, 1% affiliate." },
    caution:
      "A personal loan is CONSUMER credit and Momentum is a commercial broker. The same caution applies to 1 West's personal loan and home equity line. Nobody here has established whether we are licensed or permitted to place consumer paper — until somebody does, do not place it and do not offer it. The rate is printed because the grid prints it, not as a green light.",
  },
  {
    id: "hardmoney",
    label: "Hard money — real estate",
    blurb: "GoKapital's own lane. Nobody else on our shelf competes here, which is the argument for using them at all.",
    ucs: null,
    gk: { broker: 2, affiliate: 0.25, basis: "net", note: "2% broker tier, 0.25% affiliate." },
  },
  {
    id: "cre",
    label: "Commercial mortgage",
    blurb: "Also GoKapital's own lane, and also uncontested on our shelf.",
    ucs: null,
    gk: { broker: 2, affiliate: 0.25, basis: "net", note: "2% broker tier, 0.25% affiliate." },
  },
];

const FUNDER_LABEL: Record<FunderId, string> = {
  ucs: "United Capital Source",
  gk: "GoKapital",
  onewest: "1 West — last resort",
};

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const numOrNull = (s: string): number | null => {
  const t = s.replace(/[$,\s]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const BASIS_WORD: Record<Basis, string> = {
  net: "the net funded amount",
  firstDraw: "the first draw only",
  approved: "the total approved and accepted amount",
};

export function TermLocCalc() {
  const [who, setWho] = useState<FunderId>("ucs");
  const [prodId, setProdId] = useState<ProductId>("term");
  const [tier, setTier] = useState<Tier>("broker");

  const [funded, setFunded] = useState("150000");
  const [approved, setApproved] = useState("100000");
  const [draw, setDraw] = useState("20000");

  /** Halves of a point, so 10.0 and 0.5 are both reachable from one select. */
  const [halves, setHalves] = useState(20);

  /** 1 West only. Deliberately empty: we do not know this number. */
  const [westBase, setWestBase] = useState("");
  const [role, setRole] = useState<Role>("brokered");

  const product = PRODUCTS.find((p) => p.id === prodId) ?? PRODUCTS[0];
  const isLoc = product.id === "loc";

  /** Products the chosen funder actually offers us. 1 West brokers four. */
  const available = useMemo(() => {
    if (who === "ucs") return PRODUCTS.filter((p) => p.ucs !== null);
    if (who === "gk") return PRODUCTS.filter((p) => p.gk !== null);
    return PRODUCTS.filter((p) => p.id === "term" || p.id === "loc" || p.id === "sba" || p.id === "equip");
  }, [who]);

  const pickFunder = (id: FunderId) => {
    setWho(id);
    const stillThere =
      id === "ucs"
        ? PRODUCTS.find((p) => p.id === prodId)?.ucs !== null
        : id === "gk"
          ? PRODUCTS.find((p) => p.id === prodId)?.gk !== null
          : ["term", "loc", "sba", "equip"].includes(prodId);
    if (!stillThere) setProdId("term");
  };

  const pickProduct = (id: ProductId) => {
    setProdId(id);
    const p = PRODUCTS.find((x) => x.id === id);
    if (p?.ucs) {
      const pts = halves / 2;
      const clamped = Math.min(Math.max(pts, p.ucs.min), p.ucs.max);
      setHalves(Math.round(clamped * 2));
    }
  };

  const amountFor = (basis: Basis): number | null => {
    if (basis === "net") return numOrNull(funded);
    if (basis === "firstDraw") return numOrNull(draw);
    return numOrNull(approved);
  };

  const pointOptions = useMemo(() => {
    if (!product.ucs) return [];
    const out: number[] = [];
    for (let h = Math.round(product.ucs.min * 2); h <= Math.round(product.ucs.max * 2); h += 1) out.push(h);
    return out;
  }, [product.ucs]);

  const calc = useMemo(() => {
    // Both funders, always, so the routing line can be drawn.
    const ucsPct = product.ucs ? halves / 2 : null;
    const ucsBase = product.ucs ? amountFor(product.ucs.basis) : null;
    const ucsPay = ucsPct !== null && ucsBase !== null && ucsBase > 0 ? ucsBase * (ucsPct / 100) : null;

    const gkPct = product.gk ? (tier === "broker" ? product.gk.broker : product.gk.affiliate) : null;
    const gkBase = product.gk ? amountFor(product.gk.basis) : null;
    const gkPay = gkPct !== null && gkBase !== null && gkBase > 0 ? gkBase * (gkPct / 100) : null;

    const mine = who === "ucs" ? ucsPay : who === "gk" ? gkPay : null;
    const minePct = who === "ucs" ? ucsPct : who === "gk" ? gkPct : null;
    const mineBase = who === "ucs" ? ucsBase : who === "gk" ? gkBase : null;
    const mineBasis = who === "ucs" ? product.ucs?.basis : who === "gk" ? product.gk?.basis : undefined;

    // 1 West: a share of a number we have never seen. Null unless somebody
    // types an explicit assumption, and even then it is labelled as one.
    const wb = numOrNull(westBase);
    const westPay = wb !== null && wb > 0 ? wb * (role === "brokered" ? 0.5 : 0.25) : null;

    return { ucsPct, ucsPay, gkPct, gkPay, mine, minePct, mineBase, mineBasis, westPay, wb };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product, halves, tier, who, funded, approved, draw, westBase, role]);

  const better =
    calc.ucsPay !== null && calc.gkPay !== null
      ? calc.ucsPay === calc.gkPay
        ? "tie"
        : calc.ucsPay > calc.gkPay
          ? "ucs"
          : "gk"
      : null;

  return (
    <div className="fp-panel">
      <div className="fp-teach">
        <div className="fp-tlead">
          <b>On this line the funder sets the price and publishes what it pays us — per product.</b> There is no
          spread to choose. What you choose is <i>where the file goes</i>, and that decision is worth more here
          than on any other tab in this book, because the two grids disagree violently. Same borrower, same work,
          four times the commission.
        </div>

        <ol className="fp-tsteps">
          <li>
            <span className="fp-tk">A point is one percent of the amount funded.</span> 10 points on a $150,000
            term loan is <b>$15,000</b>. These are real loans, so the money is paid on the <b>net</b> funded
            amount — what actually reaches the borrower after the funder&rsquo;s own fees come out, not the
            approval headline.
          </li>
          <li>
            <span className="fp-tk">Term loans go to UCS. This is close to a rule.</span> UCS pays up to 10%;
            GoKapital pays 2.5% for identical work. Use GoKapital for term only where UCS has declined, or where
            the borrower fits GoKapital and not UCS.
          </li>
          <li>
            <span className="fp-tk">A line of credit reverses that, and the reason is the basis.</span> UCS pays
            1–3% <b>of the first draw only</b> — nothing on any later draw, ever. GoKapital pays 2.5% of the{" "}
            <b>whole approved facility</b>. A borrower approved for $100,000 who draws $20,000 pays us $600 at
            UCS and $2,500 at GoKapital. Set the two amounts below and watch the figures move apart.
          </li>
          <li>
            <span className="fp-tk">SBA is a relationship, not a commission.</span> 50 basis points at UCS — on a
            $150,000 file, $750, against $15,000 for a term loan of the same size. Write it to keep a borrower
            you would otherwise lose, and know what you are choosing.
          </li>
          <li>
            <span className="fp-tk">At GoKapital, which tier we are on changes everything.</span> Broker means we
            own the file through funding. Affiliate means we handed over a lead. The affiliate rate is a fifth of
            the broker rate on a term loan. Work the file.
          </li>
        </ol>

        <div className="fp-twarn">
          <b>Two UCS clauses sit on top of all of this and neither is on the grid.</b> A referred merchant who
          does not sign within <b>30 days</b> forfeits our commission entirely — and term underwriting, with its
          P&amp;L and balance-sheet stips, routinely runs past 30 days. Separately, a merchant who defaults within
          30 days of funding triggers a <b>full clawback</b> of the lump sum, which UCS may set off against
          anything else it owes us. Price a UCS file knowing both.
        </div>
      </div>

      <div className="fp-calc">
        <div className="fp-field">
          <label htmlFor="tlc-who">1 · Funder</label>
          <select id="tlc-who" value={who} onChange={(e) => pickFunder(e.target.value as FunderId)}>
            {(["ucs", "gk", "onewest"] as FunderId[]).map((f) => (
              <option key={f} value={f}>
                {FUNDER_LABEL[f]}
              </option>
            ))}
          </select>
          <span className="fp-hint">
            {who === "ucs"
              ? "12 months trading · 575 FICO · $25,000/mo. The best-paying funder on this line."
              : who === "gk"
                ? "24 months trading for term, 36 for a line of credit · 660 / 650 FICO. Higher bars, lower pay — but it owns real estate and hard money outright."
                : "A marketplace, not a funder. Direct funders first — that ordering is a rule."}
          </span>
        </div>

        <div className="fp-field">
          <label htmlFor="tlc-prod">2 · Product</label>
          <select id="tlc-prod" value={prodId} onChange={(e) => pickProduct(e.target.value as ProductId)}>
            {available.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <span className="fp-hint">{product.blurb}</span>
        </div>

        {isLoc ? (
          <>
            <div className="fp-field">
              <label htmlFor="tlc-appr">3 · Total approved</label>
              <input
                id="tlc-appr"
                inputMode="decimal"
                value={approved}
                onChange={(e) => setApproved(e.target.value)}
                placeholder="100000"
              />
              <span className="fp-hint">The whole facility the borrower accepts. GoKapital pays on this.</span>
            </div>
            <div className="fp-field">
              <label htmlFor="tlc-draw">4 · First draw</label>
              <input
                id="tlc-draw"
                inputMode="decimal"
                value={draw}
                onChange={(e) => setDraw(e.target.value)}
                placeholder="20000"
              />
              <span className="fp-hint">
                What they actually take out on day one. UCS pays on this and on nothing after it.
              </span>
            </div>
          </>
        ) : (
          <div className="fp-field">
            <label htmlFor="tlc-amt">3 · Net funded</label>
            <input
              id="tlc-amt"
              inputMode="decimal"
              value={funded}
              onChange={(e) => setFunded(e.target.value)}
              placeholder="150000"
            />
            <span className="fp-hint">
              What reaches the borrower. Both grids pay on net, not on the approval headline.
            </span>
          </div>
        )}

        {who === "ucs" ? (
          <div className="fp-field">
            <label htmlFor="tlc-pts">{isLoc ? "5" : "4"} · Points we take</label>
            <select id="tlc-pts" value={halves} onChange={(e) => setHalves(Number(e.target.value))}>
              {pointOptions.map((h) => {
                const p = h / 2;
                const base = product.ucs ? amountFor(product.ucs.basis) : null;
                const dollars = base === null || base <= 0 ? null : base * (p / 100);
                return (
                  <option key={h} value={h}>
                    {p.toFixed(1)}%{dollars === null ? "" : ` · ${money(dollars)} to us`}
                  </option>
                );
              })}
            </select>
            <span className="fp-hint">
              {product.ucs?.min === product.ucs?.max
                ? "Fixed on their schedule. There is nothing to negotiate here."
                : `Bounded to the ${product.ucs?.min}–${product.ucs?.max}% their schedule publishes. What moves a file inside that range is not documented — nobody has asked.`}
            </span>
          </div>
        ) : who === "gk" ? (
          <div className="fp-field">
            <label htmlFor="tlc-tier">{isLoc ? "5" : "4"} · Our tier</label>
            <select id="tlc-tier" value={tier} onChange={(e) => setTier(e.target.value as Tier)}>
              <option value="broker">Broker — we own the file through funding</option>
              <option value="affiliate">Affiliate — we supplied the lead only</option>
            </select>
            <span className="fp-hint">{product.gk?.note}</span>
          </div>
        ) : (
          <>
            <div className="fp-field">
              <label htmlFor="tlc-role">{isLoc ? "5" : "4"} · How we worked it</label>
              <select id="tlc-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                <option value="brokered">Brokered — 50% of their compensation</option>
                <option value="referred">Referred by link — 25%</option>
              </select>
              <span className="fp-hint">
                Owner&rsquo;s ruling, settled. Brokering pays twice what the self-serve link pays.
              </span>
            </div>
            <div className="fp-field">
              <label htmlFor="tlc-west">{isLoc ? "6" : "5"} · If 1 West earned…</label>
              <input
                id="tlc-west"
                inputMode="decimal"
                value={westBase}
                onChange={(e) => setWestBase(e.target.value)}
                placeholder="we do not know"
              />
              <span className="fp-hint">
                Left blank on purpose. Type a figure only to test a what-if — it is not a quote and not a
                forecast.
              </span>
            </div>
          </>
        )}
      </div>

      {product.caution ? <div className="fp-capbar over">{product.caution}</div> : null}

      {who === "onewest" ? (
        <>
          <div className="fp-capbar zero">
            <b>A 1 West file cannot be priced, and that is structural.</b> We are paid a share of{" "}
            <i>1 West&rsquo;s own compensation</i> — not points on what the borrower receives — and we have never
            seen that number on any file. Nobody has asked them what it is. This is a hole in what we hold, not a
            zero and not a bad deal.
          </div>
          <div className="fp-out">
            <div className="fp-ocell">
              <div className="fp-ok2">We earn</div>
              <div className="fp-ov">
                {calc.westPay === null ? <span className="fp-miss">not knowable</span> : money(calc.westPay)}
              </div>
              <div className="fp-on">
                {calc.westPay === null ? (
                  <>
                    {role === "brokered" ? "50%" : "25%"} of a number we never see. Ask Michael Bernier what 1
                    West earns on a term file
                  </>
                ) : (
                  <>
                    A WHAT-IF, not a forecast — {role === "brokered" ? "50%" : "25%"} of the {money(calc.wb ?? 0)}{" "}
                    you typed
                  </>
                )}
              </div>
            </div>
            <div className="fp-ocell">
              <div className="fp-ok2">Why it is last</div>
              <div className="fp-ov">45–50</div>
              <div className="fp-on">
                partner lenders see the file at once. A decline here can mean the whole pool declined, which
                burns the direct funders above. Five sends, five declines, zero funded
              </div>
            </div>
            <div className="fp-ocell">
              <div className="fp-ok2">What they broker</div>
              <div className="fp-ov">4</div>
              <div className="fp-on">
                term loan, line of credit, SBA and equipment — confirmed by their VP of Business Development on a
                call, 2026-10-23
              </div>
            </div>
            <div className="fp-ocell">
              <div className="fp-ok2">Paid</div>
              <div className="fp-ov">30 days</div>
              <div className="fp-on">
                within 30 calendar days of 1 West receiving its own compensation. Our agreement with them carries
                no clawback and no non-circumvention — a real advantage over everything above
              </div>
            </div>
          </div>
        </>
      ) : calc.mine === null ? (
        <div className="fp-verdict" style={{ color: "var(--ink-soft)" }}>
          Put an amount in and the figures fill themselves in. Nothing is calculated from a blank box.
        </div>
      ) : (
        <>
          <div
            className={`fp-capbar ${
              better === null ? "zero" : better === who || better === "tie" ? "ok" : "over"
            }`}
          >
            {better === "tie" ? (
              <>
                <b>Both funders pay the same on this file.</b> Route it on the credit box and on speed instead —
                UCS decides in 1–3 business days.
              </>
            ) : better === who ? (
              <>
                <b>
                  {FUNDER_LABEL[who]} is the right home for this one — {money(calc.mine)} against{" "}
                  {money((who === "ucs" ? calc.gkPay : calc.ucsPay) ?? 0)}.
                </b>{" "}
                {isLoc
                  ? "On a line of credit the answer depends entirely on how much of the facility gets drawn on day one. Change the draw and watch it flip."
                  : "Check the borrower clears their credit box before you commit to it."}
              </>
            ) : calc.ucsPay === null || calc.gkPay === null ? (
              <>
                <b>Only {FUNDER_LABEL[who]} offers this product to us.</b> There is no second home for it on this
                line, so there is nothing to compare.
              </>
            ) : (
              <>
                <b>
                  This file is worth more at {better === "ucs" ? "UCS" : "GoKapital"} —{" "}
                  {money((better === "ucs" ? calc.ucsPay : calc.gkPay) ?? 0)} against the {money(calc.mine)} you
                  are looking at.
                </b>{" "}
                {isLoc
                  ? "That is the draw basis doing it, not the rate. Confirm the borrower fits before you move the file."
                  : "Confirm the borrower fits their credit box before you move the file — GoKapital wants 24 months trading for a term loan and 36 for a line."}
              </>
            )}
          </div>

          <div className="fp-out">
            <div className="fp-ocell hero">
              <div className="fp-ok2">We earn</div>
              <div className="fp-ov">{money(calc.mine)}</div>
              <div className="fp-on">
                {calc.minePct?.toFixed(calc.minePct < 1 ? 2 : 1)}% of {money(calc.mineBase ?? 0)} —{" "}
                {BASIS_WORD[calc.mineBasis ?? "net"]}
              </div>
            </div>

            <div className="fp-ocell">
              <div className="fp-ok2">The same file at {who === "ucs" ? "GoKapital" : "UCS"}</div>
              <div className="fp-ov">
                {(who === "ucs" ? calc.gkPay : calc.ucsPay) === null ? (
                  <span className="fp-miss">not offered</span>
                ) : (
                  money((who === "ucs" ? calc.gkPay : calc.ucsPay) ?? 0)
                )}
              </div>
              <div className="fp-on">
                {(who === "ucs" ? calc.gkPay : calc.ucsPay) === null
                  ? "they do not offer this product to us"
                  : who === "ucs"
                    ? `${calc.gkPct}% on ${BASIS_WORD[product.gk?.basis ?? "net"]}, ${tier} tier`
                    : `up to ${product.ucs?.max}% on ${BASIS_WORD[product.ucs?.basis ?? "net"]}`}
              </div>
            </div>

            <div className="fp-ocell">
              <div className="fp-ok2">Paid when</div>
              <div className="fp-ov">{who === "ucs" ? "30 bd" : "1st / 15th"}</div>
              <div className="fp-on">
                {who === "ucs"
                  ? "their compensation schedule says 5 business days and the agreement body says 30. The agreement normally governs — assume 30 and be pleased if it is sooner"
                  : "GoKapital pays on the 1st or the 15th. A file they class as high-risk is held 45 business days"}
              </div>
            </div>

            <div className="fp-ocell cost">
              <div className="fp-ok2">What can take it back</div>
              <div className="fp-ov">{who === "ucs" ? "100%" : "—"}</div>
              <div className="fp-on">
                {who === "ucs"
                  ? "a default inside 30 days of funding returns the whole lump sum, and UCS may set it off against anything else owed. The 30-day referral fuse can also void it before it is ever earned"
                  : "no clawback term is recorded on GoKapital's grid. That is an absence in what we hold, not a confirmed absence of one — the duplicate rule is documented, the clawback is not"}
              </div>
            </div>
          </div>
        </>
      )}

      <div className="fp-gloss">
        <b>The words on this tab</b>
        <dl>
          <dt>Net funded</dt>
          <dd>
            What actually reaches the borrower after the funder&rsquo;s own fees. Both grids pay on net, so an
            origination fee comes out of the number our commission is calculated on.
          </dd>
          <dt>Draw</dt>
          <dd>
            Money taken out of a line of credit. The facility can sit unused; only a draw is real money — and at
            UCS only the FIRST one pays us.
          </dd>
          <dt>Basis point</dt>
          <dd>A hundredth of a percent. UCS&rsquo;s 50 bps on SBA is 0.50%.</dd>
          <dt>Broker vs affiliate</dt>
          <dd>
            GoKapital&rsquo;s two tiers. Broker: we own the file through funding. Affiliate: we passed a lead.
            The gap is five-fold on a term loan.
          </dd>
          <dt>Referral fuse</dt>
          <dd>
            UCS&rsquo;s 30-day clock. If the merchant has not signed a Merchant Agreement within 30 days of the
            referral, the commission is forfeited — however the deal ends up funding.
          </dd>
        </dl>
      </div>

      <div className="fp-foot" style={{ margin: "14px 16px 16px" }}>
        <b>What this does not do.</b> It does not price the borrower&rsquo;s side. UCS publishes term pricing as
        &ldquo;from 1–4% per month&rdquo; and GoKapital publishes &ldquo;6%–25%&rdquo; with no unit attached — one
        is monthly, the other is unlabelled, and converting either into a payment would mean inventing the part
        they did not state. Ask for the amortisation on the approval instead.{" "}
        <b>Where these rates come from, and how firmly.</b> The UCS figures are the strongest thing on this page:
        the 1–3% line-of-credit rate and its initial-draw basis are both extracted verbatim from UCS ISO
        Compensation Schedule A Rev 04-2018 and held as a quoted fact. The GoKapital figures are weaker in one
        specific way — they sit on GoKapital&rsquo;s funder record attributing them to Broker Referral Agreement
        Exhibit A, nothing anywhere contradicts them, and no figure differing from 2.5% / 0.5% exists in our
        records, <b>but no extraction from that document is on file</b>, so the 2.5%-of-the-whole-facility basis
        that makes a line of credit worth four times as much here is our own record speaking, not theirs. It is
        the number to confirm before a line-of-credit file is routed on the strength of it.{" "}
        <b>Nothing here is a quote to a borrower.</b>
      </div>
    </div>
  );
}
