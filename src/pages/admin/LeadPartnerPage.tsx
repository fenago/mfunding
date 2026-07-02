import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  BoltIcon, EnvelopeIcon, PhoneIcon, GlobeAltIcon, CheckBadgeIcon,
  CalculatorIcon, ArrowTrendingUpIcon, BuildingStorefrontIcon,
} from "@heroicons/react/24/outline";
import PageGuide from "../../components/admin/PageGuide";
import { SYNERGY, PRODUCTS, TIER_META, volumePrice, type LeadProduct } from "../../data/synergyLeads";

const usd = (n: number) =>
  n >= 1000 ? `$${Math.round(n).toLocaleString()}` : `$${n.toFixed(n < 10 && n % 1 !== 0 ? 2 : 0)}`;
const usdc = (n: number) => (n < 1 ? `${(n * 100).toFixed(n < 0.1 ? 1 : 0)}¢` : `$${n.toFixed(2)}`);

function priceTierHint(p: LeadProduct): string {
  if (!p.volume || p.volume.length < 2) return "";
  const first = p.volume[0].price, last = p.volume[p.volume.length - 1].price;
  return `${usdc(first)} → ${usdc(last)} per ${p.unit} as volume rises`;
}

// Smooth count-up for the metric numbers.
function useCountUp(value: number, duration = 600) {
  const [display, setDisplay] = useState(value);
  const prev = useRef(value);
  useEffect(() => {
    const start = prev.current, end = value, t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - k, 3);
      setDisplay(start + (end - start) * eased);
      if (k < 1) raf = requestAnimationFrame(tick); else prev.current = end;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return display;
}

function Metric({ label, value, fmt, tone = "default", sub }: {
  label: string; value: number; fmt: (n: number) => string;
  tone?: "default" | "good" | "bad" | "accent"; sub?: string;
}) {
  const d = useCountUp(value);
  const toneCls = {
    default: "text-gray-900 dark:text-white",
    good: "text-emerald-600 dark:text-emerald-400",
    bad: "text-red-600 dark:text-red-400",
    accent: "text-ocean-blue",
  }[tone];
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`text-2xl font-bold tabular-nums mt-1 ${toneCls}`}>{fmt(d)}</p>
      {sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function LeadPartnerPage() {
  const [productId, setProductId] = useState("live-transfer");
  const product = PRODUCTS.find((p) => p.id === productId)!;

  // Inputs
  const [qty, setQty] = useState(50);
  const [ageIdx, setAgeIdx] = useState(0);
  const [hoursWeek, setHoursWeek] = useState(25);
  const [weeks, setWeeks] = useState(4);
  const [fundRate, setFundRate] = useState(product.defaultFundRate);
  const [avgCommission, setAvgCommission] = useState(4000);
  const [closerSplit, setCloserSplit] = useState(30); // % of commission paid to the closer

  // Reset per-product defaults when switching products.
  useEffect(() => {
    setFundRate(product.defaultFundRate);
    setAgeIdx(0);
    if (product.unit === "record") setQty(50000);
    else if (product.pricing !== "hourly") setQty(50);
  }, [productId]); // eslint-disable-line react-hooks/exhaustive-deps

  const calc = useMemo(() => {
    let spend = 0, units = 0, unitPrice = 0;
    if (product.pricing === "hourly" && product.hourly) {
      const totalHours = hoursWeek * weeks;
      spend = totalHours * product.hourly.rate;
      units = totalHours / product.hourly.hoursPerTransfer; // live transfers produced
      unitPrice = units > 0 ? spend / units : 0;
    } else if (product.pricing === "age" && product.age) {
      unitPrice = product.age[ageIdx]?.price ?? 0;
      units = qty;
      spend = unitPrice * qty;
    } else {
      unitPrice = volumePrice(product, qty);
      units = qty;
      spend = unitPrice * qty;
    }
    const funded = units * (fundRate / 100);
    const grossRevenue = funded * avgCommission;        // total commission from funders
    const closerPay = grossRevenue * (closerSplit / 100); // paid out to the closer
    const revenue = grossRevenue - closerPay;             // net to house after closer split
    const profit = revenue - spend;
    const costPerFunded = funded > 0 ? spend / funded : 0;
    const roi = spend > 0 ? (profit / spend) * 100 : 0;
    return { spend, units, unitPrice, funded, grossRevenue, closerPay, revenue, profit, costPerFunded, roi };
  }, [product, qty, ageIdx, hoursWeek, weeks, fundRate, avgCommission, closerSplit]);

  const profitable = calc.costPerFunded > 0 && calc.costPerFunded < 1500;
  const maxBar = Math.max(calc.spend, calc.grossRevenue, 1);

  const tiers: Array<"1" | "2" | "3" | "service"> = ["1", "2", "3", "service"];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <BuildingStorefrontIcon className="w-6 h-6 text-ocean-blue" /> Synergy Direct Solution — Lead Partner
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Our primary lead source. Every product, every price tier, and a calculator for what it actually costs to fund a deal — one place.
        </p>
      </div>

      <PageGuide
        title="Lead Partner — Synergy Direct Solution"
        storageKey="lead-partner"
        what="The full Synergy lead catalog (3 tiers + telemarketing) with live pricing, plus a unit-economics calculator."
        value="Decide which lead type to buy and how much, knowing your cost-per-funded-deal before you spend a dollar."
        howToUse={["Pick a lead type", "Set quantity / age / hours", "Tune your fund rate, avg commission + closer split", "Read the net-to-house profit + cost-per-funded deal"]}
        howToRead="Green = profitable (cost per funded under the $1,500 golden ratio). Red = you'd lose money at that fund rate."
      />

      {/* Contact / how to order */}
      <div className="rounded-xl border border-ocean-blue/30 bg-ocean-blue/5 dark:bg-ocean-blue/10 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-semibold text-gray-900 dark:text-white">{SYNERGY.name} · {SYNERGY.contactName}</p>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-gray-600 dark:text-gray-300">
              <a href={`mailto:${SYNERGY.email}`} className="inline-flex items-center gap-1 hover:text-ocean-blue"><EnvelopeIcon className="w-4 h-4" />{SYNERGY.email}</a>
              <span className="inline-flex items-center gap-1"><PhoneIcon className="w-4 h-4" />Cell {SYNERGY.cell}</span>
              <span className="inline-flex items-center gap-1"><PhoneIcon className="w-4 h-4" />Office {SYNERGY.office}</span>
              <span className="inline-flex items-center gap-1"><GlobeAltIcon className="w-4 h-4" />{SYNERGY.website}</span>
            </div>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 max-w-2xl">{SYNERGY.howToOrder}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {SYNERGY.badges.map((b) => (
              <span key={b} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                <CheckBadgeIcon className="w-3.5 h-3.5" /> {b}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ───────────── Calculator ───────────── */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-gradient-to-br from-white to-gray-50 dark:from-gray-800 dark:to-gray-900 p-5 lg:p-6">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2 mb-4">
          <CalculatorIcon className="w-5 h-5 text-ocean-blue" /> Lead Cost & Unit-Economics Calculator
        </h2>

        {/* Product picker */}
        <div className="flex flex-wrap gap-2 mb-5">
          {PRODUCTS.map((p) => {
            const on = p.id === productId;
            return (
              <button
                key={p.id}
                onClick={() => setProductId(p.id)}
                className={`text-sm px-3 py-1.5 rounded-lg border transition-all ${
                  on ? "border-ocean-blue bg-ocean-blue text-white shadow"
                     : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:border-ocean-blue/50"
                }`}
              >
                {p.name}
              </button>
            );
          })}
        </div>

        <div className="grid lg:grid-cols-[1fr_1.4fr] gap-6">
          {/* Controls */}
          <div className="space-y-5">
            <div className="rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-4">
              <p className={`text-sm font-semibold ${product.accent}`}>{product.name}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{product.signal}</p>
            </div>

            {product.pricing === "hourly" ? (
              <>
                <Slider label="Hours per week" value={hoursWeek} min={25} max={120} step={5} onChange={setHoursWeek} suffix=" hrs" hint="25 hrs/week minimum" />
                <Slider label="Weeks" value={weeks} min={1} max={26} step={1} onChange={setWeeks} suffix=" wk" />
                <p className="text-xs text-gray-400">≈ 1 live transfer per {product.hourly!.hoursPerTransfer} hrs of dialing → ~{calc.units.toFixed(0)} transfers.</p>
              </>
            ) : product.pricing === "age" ? (
              <>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Lead age</label>
                  <div className="flex flex-wrap gap-2">
                    {product.age!.map((a, i) => (
                      <button key={a.label} onClick={() => setAgeIdx(i)}
                        className={`text-xs px-2.5 py-1.5 rounded-lg border ${i === ageIdx ? "border-ocean-blue bg-ocean-blue/10 text-ocean-blue" : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300"}`}>
                        {a.label} · {usdc(a.price)}
                      </button>
                    ))}
                  </div>
                </div>
                <Slider label="Quantity" value={qty} min={10} max={2000} step={10} onChange={setQty} suffix=" leads" />
              </>
            ) : (
              <>
                <Slider
                  label="Quantity"
                  value={qty}
                  min={product.unit === "record" ? 1000 : 5}
                  max={product.unit === "record" ? 300000 : 300}
                  step={product.unit === "record" ? 1000 : 5}
                  onChange={setQty}
                  suffix={product.unit === "record" ? " records" : " leads"}
                  hint={priceTierHint(product)}
                />
                <TierLadder product={product} qty={qty} onJump={setQty} />
              </>
            )}

            <Slider label="Lead → funded rate" value={fundRate} min={0.05} max={20} step={0.05} onChange={setFundRate} suffix="%" hint="Your assumption — tune to your real numbers" decimals />
            <Slider label="Avg commission / funded deal" value={avgCommission} min={1000} max={15000} step={250} onChange={setAvgCommission} suffix="" money hint="8 pts on a $50K advance ≈ $4,000" />
            <Slider
              label="Closer split — % of commission paid to the closer"
              value={closerSplit} min={0} max={70} step={5} onChange={setCloserSplit} suffix="%"
              hint={`Company-lead default 35% (self-gen 65%). Closer earns ≈ ${usd(calc.closerPay)} · house keeps ${100 - closerSplit}%.`}
            />
          </div>

          {/* Output */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Metric label="Total spend" value={calc.spend} fmt={usd} tone="accent" />
              <Metric label={product.pricing === "hourly" ? "Cost / transfer" : "Cost / lead"} value={calc.unitPrice} fmt={(n) => (n < 1 ? usdc(n) : usd(n))} />
              <Metric label={product.pricing === "hourly" ? "Transfers" : product.unit === "record" ? "Records" : "Leads"} value={calc.units} fmt={(n) => Math.round(n).toLocaleString()} />
              <Metric label="Funded deals" value={calc.funded} fmt={(n) => n.toFixed(n < 10 ? 1 : 0)} tone="accent" />
              <Metric label="Gross commission" value={calc.grossRevenue} fmt={usd} sub="before closer split" />
              <Metric label="Net to house" value={calc.revenue} fmt={usd} tone="good" sub={`after ${closerSplit}% closer split`} />
              <Metric label="Closer earns" value={calc.closerPay} fmt={usd} sub={`${closerSplit}% of gross`} />
              <Metric label="Profit (net)" value={calc.profit} fmt={usd} tone={calc.profit >= 0 ? "good" : "bad"} sub="net to house − spend" />
            </div>

            {/* Spend vs revenue bars */}
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-2">
              <Bar label="Spend" value={calc.spend} max={maxBar} color="bg-ocean-blue" fmt={usd} />
              <Bar label="Gross" value={calc.grossRevenue} max={maxBar} color="bg-emerald-300" fmt={usd} />
              <Bar label="Closer" value={calc.closerPay} max={maxBar} color="bg-amber-400" fmt={usd} />
              <Bar label="Net" value={calc.revenue} max={maxBar} color="bg-emerald-500" fmt={usd} />
            </div>

            {/* Golden ratio verdict */}
            <motion.div
              key={profitable ? "good" : "bad"}
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
              className={`rounded-xl p-4 border ${profitable
                ? "border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800"
                : "border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800"}`}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Cost per funded deal</p>
                  <p className={`text-3xl font-bold tabular-nums ${profitable ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                    {calc.funded > 0 ? usd(calc.costPerFunded) : "—"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-500 dark:text-gray-400">ROI</p>
                  <p className={`text-xl font-bold tabular-nums ${calc.roi >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                    {calc.roi >= 0 ? "+" : ""}{Math.round(calc.roi)}%
                  </p>
                </div>
              </div>
              <p className={`text-xs mt-2 ${profitable ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}>
                <BoltIcon className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />
                {profitable
                  ? "In the profitable zone — cost per funded is under the $1,500 golden ratio (avg commission > $4,000)."
                  : "Above the $1,500 golden ratio. Raise your fund rate, buy at a higher volume tier, or pick a cheaper lead type."}
              </p>
            </motion.div>
          </div>
        </div>
      </div>

      {/* ───────────── Catalog ───────────── */}
      {tiers.map((t) => {
        const items = PRODUCTS.filter((p) => String(p.tier) === t);
        if (!items.length) return null;
        const meta = TIER_META[t];
        return (
          <div key={t}>
            <div className="mb-3">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">{meta.title}</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">{meta.sub}</p>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              {items.map((p) => <ProductCard key={p.id} p={p} onPick={() => { setProductId(p.id); window.scrollTo({ top: 0, behavior: "smooth" }); }} />)}
            </div>
          </div>
        );
      })}

      {/* Quals + AI bot note */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Standard qualification bar</h3>
          <ul className="space-y-1.5 text-sm text-gray-600 dark:text-gray-300 list-disc pl-5">
            {SYNERGY.baseQuals.map((q) => <li key={q}>{q}</li>)}
          </ul>
        </div>
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Notes</h3>
          <ul className="space-y-1.5 text-sm text-gray-600 dark:text-gray-300 list-disc pl-5">
            <li><strong>No minimum orders</strong> on any data/lead product — start with a small test.</li>
            <li>Payment by ACH / Zelle / wire / PayPal (no cards). Invoice via DocuSign, same-day start.</li>
            <li>Try their AI inbound sales bot: <strong>{SYNERGY.aiBotDemo}</strong> (Kyle asked for feedback).</li>
            <li>Pilot idea: 50K each of UCC + Trigger + Aged for Claude-driven A/B testing.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

// ── pieces ───────────────────────────────────────────────────────────────────

function Slider({ label, value, min, max, step, onChange, suffix = "", hint, money, decimals }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (n: number) => void; suffix?: string; hint?: string; money?: boolean; decimals?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs font-medium text-gray-600 dark:text-gray-400">{label}</label>
        <span className="text-sm font-bold text-gray-900 dark:text-white tabular-nums">
          {money ? `$${Math.round(value).toLocaleString()}` : `${decimals ? value.toFixed(2) : value.toLocaleString()}${suffix}`}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-ocean-blue" />
      {hint && <p className="text-[11px] text-gray-400 mt-0.5">{hint}</p>}
    </div>
  );
}

function Bar({ label, value, max, color, fmt }: { label: string; value: number; max: number; color: string; fmt: (n: number) => string }) {
  const pct = Math.max(2, Math.min(100, (value / max) * 100));
  return (
    <div className="flex items-center gap-3">
      <span className="w-16 shrink-0 text-xs text-gray-500 dark:text-gray-400">{label}</span>
      <div className="flex-1 h-6 rounded bg-gray-100 dark:bg-gray-900 overflow-hidden">
        <motion.div className={`h-full ${color} rounded`} initial={false} animate={{ width: `${pct}%` }} transition={{ type: "spring", stiffness: 120, damping: 20 }} />
      </div>
      <span className="w-20 shrink-0 text-right text-sm font-semibold tabular-nums text-gray-900 dark:text-white">{fmt(value)}</span>
    </div>
  );
}

// Shows the volume price ladder with the ACTIVE tier highlighted + a nudge to the
// next discount tier — makes the quantity-based scaling explicit in the calculator.
function TierLadder({ product, qty, onJump }: { product: LeadProduct; qty: number; onJump: (n: number) => void }) {
  if (!product.volume || product.volume.length < 2) return null;
  const breaks = product.volume;
  const base = breaks[0].price;
  const activeIdx = breaks.reduce((acc, b, i) => (qty >= b.min ? i : acc), 0);
  const current = breaks[activeIdx].price;
  const next = breaks[activeIdx + 1];
  const savePct = base > 0 ? Math.round((1 - current / base) * 100) : 0;
  const unit = product.unit === "record" ? "record" : "lead";
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-gray-600 dark:text-gray-400">Volume pricing</p>
        {savePct > 0 && (
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
            {savePct}% off base
          </span>
        )}
      </div>
      <div className="space-y-1">
        {breaks.map((b, i) => {
          const on = i === activeIdx;
          const label = b.min === 1 ? `1+` : `${b.min.toLocaleString()}+`;
          return (
            <button
              key={b.min}
              onClick={() => onJump(Math.max(b.min, product.unit === "record" ? 1000 : 5))}
              className={`w-full flex items-center justify-between rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                on ? "bg-ocean-blue text-white font-semibold"
                   : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              }`}
            >
              <span>{label} {unit}s</span>
              <span className="tabular-nums">{usdc(b.price)}/{unit}{on ? "  ◄ you" : ""}</span>
            </button>
          );
        })}
      </div>
      {next ? (
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2">
          Order <button onClick={() => onJump(next.min)} className="text-ocean-blue font-medium hover:underline">{next.min.toLocaleString()}+</button>{" "}
          to drop to <strong>{usdc(next.price)}/{unit}</strong> ({Math.round((1 - next.price / current) * 100)}% cheaper).
        </p>
      ) : (
        <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-2">You're at the best volume price. 🎉</p>
      )}
    </div>
  );
}

function ProductCard({ p, onPick }: { p: LeadProduct; onPick: () => void }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className={`font-bold ${p.accent}`}>{p.name}</h3>
          <p className="text-[11px] uppercase tracking-wide text-gray-400 mt-0.5">{p.badge}</p>
        </div>
        <button onClick={onPick} className="text-[11px] px-2 py-1 rounded-lg bg-ocean-blue/10 text-ocean-blue hover:bg-ocean-blue/20 inline-flex items-center gap-1 shrink-0">
          <ArrowTrendingUpIcon className="w-3.5 h-3.5" /> Calc
        </button>
      </div>
      <p className="text-sm text-gray-600 dark:text-gray-300 mt-2 leading-relaxed">{p.description}</p>

      {/* Pricing */}
      <div className="mt-3 rounded-lg bg-gray-50 dark:bg-gray-900 p-3">
        {p.pricing === "hourly" && p.hourly ? (
          <p className="text-sm text-gray-700 dark:text-gray-200"><strong>${p.hourly.rate}/hr</strong> · {p.hourly.minHoursWeek} hr/wk min · ~1 transfer / {p.hourly.hoursPerTransfer} hrs</p>
        ) : p.pricing === "age" && p.age ? (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-700 dark:text-gray-200">
            {p.age.map((a) => <span key={a.label}><strong>{usdc(a.price)}</strong> · {a.label}</span>)}
            {p.returnPolicy && <span className="basis-full text-[11px] text-gray-400">{p.returnPolicy}</span>}
          </div>
        ) : p.volume ? (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-700 dark:text-gray-200">
            {p.volume.map((b, i) => (
              <span key={b.min}>
                <strong>{usdc(b.price)}</strong>
                <span className="text-gray-400"> · {b.min === 1 ? "1+" : `${b.min.toLocaleString()}+`}{i === 0 && p.unit === "record" ? " rec" : ""}</span>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500 dark:text-gray-400">
        <span>🎯 {p.exclusivity}</span>
        <span>📦 {p.delivery}</span>
      </div>
      {p.returnPolicy && p.pricing !== "age" && <p className="text-[11px] text-gray-400 mt-2">↩ {p.returnPolicy}</p>}
    </div>
  );
}
