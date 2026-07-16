// MoneyKit — shared OS ("Momentum OS", dispatch-board) primitives for the money
// pages (apply, business-loans, real-estate, debt-relief). Everything here reads
// from OSKit's CSS variables so the money pages sit inside the SAME design system
// as the landing page: deep-ink base, one owned go-green signal, amber for the
// clock/urgency, Anton + Inter + Space Mono. Per the house direction we deliberately
// drop the old per-product accent colors — the whole surface speaks one green.
//
// COMPLIANCE: nothing here hard-codes "loan" language. The MCA is a purchase of
// future receivables; product copy comes from the data files and is rendered as-is.
import { useState, useRef, useCallback, type ReactNode } from "react";
import { OSSection, Eyebrow, Display, CTAPrimary } from "../OSKit";

// The shape the money components need from a product record. Both LoanProduct and
// CREProduct satisfy it structurally.
export interface MoneyProductLike {
  name: string;
  shortName: string;
  tagline: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  hero: {
    badge: string;
    headline: string;
    highlightWord: string;
    subheadline: string;
    description: string;
    approvalTime: string;
    amountRange: string;
  };
  specs: { label: string; value: string }[];
  benefits: { title: string; description: string; icon: React.ComponentType<{ className?: string }> }[];
  documents: string[];
  restrictions?: string[];
  faqs: { question: string; answer: string }[];
  highlights: string[];
}

// ── Small helpers ─────────────────────────────────────────────────────────────

/** Wrap the hero's highlight word in the go-green run, leaving the rest plain. */
export function Highlight({ text, word }: { text: string; word: string }) {
  if (!word || !text.includes(word)) return <>{text}</>;
  const [before, ...rest] = text.split(word);
  const after = rest.join(word);
  return (
    <>
      {before}
      <span className="os-go">{word}</span>
      {after}
    </>
  );
}

// ── Product / program detail hero ───────────────────────────────────────────────
// Left: badge, billboard headline, subhead, description, CTA + trust line.
// Right: the "manifest" — a mono spec readout that reads like a dispatch printout.

export function MoneyDetailHero({ product }: { product: MoneyProductLike }) {
  return (
    <section className="os-section os-section-ink money-hero">
      <div className="os-container money-hero-grid">
        <div className="money-hero-copy">
          <Eyebrow>{product.hero.badge}</Eyebrow>
          <h1 className="os-display money-hero-h1">
            <Highlight text={product.hero.headline} word={product.hero.highlightWord} />
          </h1>
          <p className="money-hero-sub">{product.hero.subheadline}</p>
          <p className="money-hero-desc">{product.hero.description}</p>
          <div className="money-hero-cta">
            <CTAPrimary href="/apply">Check your rate — free</CTAPrimary>
            <span className="money-fine os-mono">NO UPFRONT FEES · CHECKING WON&rsquo;T AFFECT YOUR CREDIT</span>
          </div>
        </div>

        <aside className="money-manifest" aria-label={`${product.shortName} at a glance`}>
          <div className="money-manifest-top">
            <span className="money-manifest-title os-mono">{product.shortName.toUpperCase()} · SPEC</span>
            <span className="money-manifest-dot" aria-hidden />
          </div>
          <div className="money-manifest-heads">
            <div>
              <span className="money-manifest-k os-mono">DECISION</span>
              <span className="money-manifest-v money-amber">{product.hero.approvalTime}</span>
            </div>
            <div>
              <span className="money-manifest-k os-mono">RANGE</span>
              <span className="money-manifest-v money-go">{product.hero.amountRange}</span>
            </div>
          </div>
          <dl className="money-manifest-rows">
            {product.specs.map((s) => (
              <div className="money-manifest-row" key={s.label}>
                <dt className="os-mono">{s.label}</dt>
                <dd>{s.value}</dd>
              </div>
            ))}
          </dl>
        </aside>
      </div>
    </section>
  );
}

// ── Benefits grid ────────────────────────────────────────────────────────────

export function BenefitGrid({
  benefits, eyebrow = "WHY IT WORKS", title,
}: { benefits: MoneyProductLike["benefits"]; eyebrow?: string; title: ReactNode }) {
  return (
    <OSSection tone="panel">
      <div className="money-secthead">
        <Eyebrow>{eyebrow}</Eyebrow>
        <Display>{title}</Display>
      </div>
      <div className="money-benefit-grid">
        {benefits.map((b) => (
          <div className="os-card money-benefit" key={b.title}>
            <span className="money-benefit-ico"><b.icon className="money-benefit-svg" /></span>
            <h3 className="money-benefit-title">{b.title}</h3>
            <p className="money-benefit-desc">{b.description}</p>
          </div>
        ))}
      </div>
    </OSSection>
  );
}

// ── Documents + restrictions ─────────────────────────────────────────────────

export function DocChecklist({
  documents, restrictions,
}: { documents: string[]; restrictions?: string[] }) {
  return (
    <OSSection tone="ink">
      <div className="money-secthead">
        <Eyebrow>WHAT TO BRING</Eyebrow>
        <Display>THE <span className="os-go">SHORT LIST.</span></Display>
      </div>
      <div className="money-doc-grid">
        <div className="os-card money-doc-card">
          <span className="money-doc-label os-mono">DOCUMENTS TO GET FUNDED</span>
          <ul className="money-doc-list">
            {documents.map((d) => (
              <li key={d}><span className="money-doc-check" aria-hidden>✓</span>{d}</li>
            ))}
          </ul>
        </div>
        {restrictions && restrictions.length > 0 && (
          <div className="os-card money-doc-card money-doc-card-warn">
            <span className="money-doc-label os-mono money-doc-label-warn">GOOD TO KNOW</span>
            <ul className="money-doc-list money-doc-list-warn">
              {restrictions.map((r) => (
                <li key={r}><span className="money-doc-warn" aria-hidden>!</span>{r}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </OSSection>
  );
}

// ── FAQ accordion (closed by default — house rule) ───────────────────────────

export function FAQAccordion({
  faqs, tone = "panel",
}: { faqs: { question: string; answer: string }[]; tone?: "ink" | "panel" }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <OSSection tone={tone}>
      <div className="money-secthead">
        <Eyebrow>QUESTIONS</Eyebrow>
        <Display>STRAIGHT <span className="os-go">ANSWERS.</span></Display>
      </div>
      <div className="money-faq">
        {faqs.map((f, i) => {
          const isOpen = open === i;
          return (
            <div className={`money-faq-item${isOpen ? " money-faq-open" : ""}`} key={f.question}>
              <button
                className="money-faq-q"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : i)}
              >
                <span>{f.question}</span>
                <span className="money-faq-sign" aria-hidden>{isOpen ? "–" : "+"}</span>
              </button>
              {isOpen && <p className="money-faq-a">{f.answer}</p>}
            </div>
          );
        })}
      </div>
    </OSSection>
  );
}

// ── Closing CTA band ─────────────────────────────────────────────────────────

export function MoneyCTA({
  eyebrow = "READY WHEN YOU ARE", title, sub, cta = "Check your rate — free", chips,
}: { eyebrow?: string; title: ReactNode; sub: string; cta?: string; chips: string[] }) {
  return (
    <OSSection tone="ink" className="money-cta">
      <div className="money-cta-inner">
        <Eyebrow>{eyebrow}</Eyebrow>
        <Display>{title}</Display>
        <p className="money-cta-sub">{sub}</p>
        <div className="money-cta-row">
          <CTAPrimary href="/apply">{cta}</CTAPrimary>
          <div className="money-cta-chips">
            {chips.map((c) => <span className="os-chip" key={c}>{c}</span>)}
          </div>
        </div>
      </div>
    </OSSection>
  );
}

// ── Shared OS range slider (used by both calculators) ────────────────────────
// Same drag/snap behaviour as the legacy sliders, restyled to the go-green track.

export function OSRange({
  value, onChange, min, max, step, minLabel, maxLabel,
}: {
  value: number; onChange: (v: number) => void;
  min: number; max: number; step: number; minLabel: string; maxLabel: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const pct = ((value - min) / (max - min)) * 100;

  const update = useCallback((clientX: number) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const stepped = Math.round((min + p * (max - min)) / step) * step;
    onChange(Math.max(min, Math.min(max, stepped)));
  }, [min, max, step, onChange]);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    update(e.clientX);
  };

  return (
    <div className="money-range">
      <div
        ref={trackRef}
        className="money-range-track"
        onPointerDown={onPointerDown}
        onPointerMove={(e) => e.buttons === 1 && update(e.clientX)}
        role="slider"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowUp") onChange(Math.min(max, value + step));
          if (e.key === "ArrowLeft" || e.key === "ArrowDown") onChange(Math.max(min, value - step));
        }}
      >
        <span className="money-range-fill" style={{ width: `${pct}%` }} />
        <span className="money-range-thumb" style={{ left: `${pct}%` }} />
      </div>
      <div className="money-range-labels os-mono">
        <span>{minLabel}</span>
        <span>{maxLabel}</span>
      </div>
    </div>
  );
}

// ── The money-page stylesheet (rendered once per page next to OS_CSS) ─────────

export const MONEY_CSS = `
/* detail hero */
.money-hero-grid{display:grid;grid-template-columns:1.15fr .85fr;gap:48px;align-items:center}
.money-hero-h1{font-size:clamp(32px,4.4vw,54px);margin:0 0 18px}
.money-hero-sub{font-size:19px;line-height:1.5;color:var(--tx);font-weight:500;margin:0 0 16px;max-width:34em}
.money-hero-desc{font-size:16px;line-height:1.65;color:var(--lede);margin:0 0 28px;max-width:36em}
.money-hero-cta{display:flex;flex-wrap:wrap;align-items:center;gap:16px 22px}
.money-fine{font-size:11px;letter-spacing:.05em;color:var(--faint)}

/* the spec "manifest" panel */
.money-manifest{background:linear-gradient(180deg,var(--panel),var(--panel2));border:1px solid var(--hair);border-radius:16px;padding:22px 22px 8px;box-shadow:0 30px 60px -30px var(--shadow)}
.money-manifest-top{display:flex;align-items:center;justify-content:space-between;padding-bottom:14px;border-bottom:1px solid var(--hair)}
.money-manifest-title{font-size:12px;letter-spacing:.16em;color:var(--muted)}
.money-manifest-dot{width:8px;height:8px;border-radius:9px;background:var(--go);box-shadow:0 0 0 4px rgba(22,217,146,.16)}
.money-manifest-heads{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:16px 0;border-bottom:1px solid var(--hair)}
.money-manifest-heads>div{display:flex;flex-direction:column;gap:4px}
.money-manifest-k{font-size:10px;letter-spacing:.14em;color:var(--faint)}
.money-manifest-v{font-family:'Anton',sans-serif;font-size:24px;line-height:1;letter-spacing:.01em}
.money-go{color:var(--go-text)}
.money-amber{color:var(--amber)}
.money-manifest-rows{margin:0;padding:6px 0}
.money-manifest-row{display:flex;align-items:baseline;justify-content:space-between;gap:16px;padding:11px 0;border-bottom:1px solid var(--hair2)}
.money-manifest-row:last-child{border-bottom:none}
.money-manifest-row dt{font-size:12px;letter-spacing:.06em;color:var(--muted);text-transform:uppercase}
.money-manifest-row dd{margin:0;font-size:14px;font-weight:600;color:var(--tx);text-align:right}

/* shared section header */
.money-secthead{max-width:44em;margin-bottom:40px}

/* benefits */
.money-benefit-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
.money-benefit{display:flex;flex-direction:column}
.money-benefit-ico{width:44px;height:44px;border-radius:11px;display:grid;place-items:center;margin-bottom:16px;
  color:var(--go-text);background:rgba(22,217,146,.08);border:1px solid rgba(22,217,146,.22)}
.money-benefit-svg{width:22px;height:22px}
.money-benefit-title{font-family:'Anton',sans-serif;font-weight:400;text-transform:uppercase;letter-spacing:.01em;
  font-size:19px;line-height:1.05;color:var(--tx);margin:0 0 10px}
.money-benefit-desc{font-size:14.5px;line-height:1.6;color:var(--muted);margin:0}

/* documents */
.money-doc-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.money-doc-card{padding:24px 26px}
.money-doc-label{font-size:11px;letter-spacing:.16em;color:var(--muted);display:block;margin-bottom:16px}
.money-doc-label-warn{color:var(--amber-hi)}
.money-doc-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:13px}
.money-doc-list li{display:flex;gap:12px;font-size:15px;line-height:1.5;color:var(--lede)}
.money-doc-check{color:var(--go-text);font-weight:700;flex:0 0 auto}
.money-doc-card-warn{border-color:rgba(180,116,15,.28);background:linear-gradient(180deg,rgba(180,116,15,.05),var(--panel2))}
.money-doc-warn{color:var(--amber);font-weight:700;flex:0 0 auto;width:16px;text-align:center}
.money-doc-list-warn li{color:var(--muted)}

/* faq */
.money-faq{max-width:52em;border-top:1px solid var(--hair)}
.money-faq-item{border-bottom:1px solid var(--hair)}
.money-faq-q{width:100%;display:flex;align-items:center;justify-content:space-between;gap:18px;
  background:none;border:none;cursor:pointer;text-align:left;padding:20px 4px;
  font-family:'Inter',sans-serif;font-size:16.5px;font-weight:600;color:var(--tx)}
.money-faq-q:hover{color:var(--go-text)}
.money-faq-sign{font-family:'Space Mono',monospace;font-size:22px;line-height:1;color:var(--go-text);flex:0 0 auto}
.money-faq-a{margin:0 4px 22px;font-size:15px;line-height:1.65;color:var(--lede);max-width:60ch;animation:os-in .2s ease both}

/* closing cta */
.money-cta-inner{max-width:46em}
.money-cta-sub{font-size:18px;line-height:1.6;color:var(--lede);margin:0 0 30px;max-width:38em}
.money-cta-row{display:flex;flex-wrap:wrap;align-items:center;gap:18px 26px}
.money-cta-chips{display:flex;flex-wrap:wrap;gap:10px}

/* calculator */
.money-calc-shell{max-width:960px;margin:0 auto;border:1px solid var(--hair);border-radius:16px;overflow:hidden;
  background:linear-gradient(180deg,var(--panel),var(--panel2));box-shadow:0 34px 70px -34px var(--shadow)}
.money-calc-grid{display:grid;grid-template-columns:2fr 3fr}
.money-calc-left{padding:34px 32px;display:flex;flex-direction:column;justify-content:space-between;gap:26px;
  background:
    linear-gradient(var(--hair2) 1px,transparent 1px),
    linear-gradient(90deg,var(--hair2) 1px,transparent 1px),
    linear-gradient(180deg,rgba(22,217,146,.10),transparent);
  background-size:40px 40px,40px 40px,auto;border-right:1px solid var(--hair)}
.money-calc-left-title{font-family:'Anton',sans-serif;font-weight:400;text-transform:uppercase;font-size:26px;line-height:1.02;color:var(--tx);margin:0 0 22px}
.money-calc-hi{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:14px}
.money-calc-hi li{display:flex;gap:11px;font-size:14px;line-height:1.45;color:var(--lede)}
.money-calc-hi .money-doc-check{margin-top:1px}
.money-calc-note{font-size:11px;line-height:1.6;color:var(--faint);padding-top:18px;border-top:1px solid var(--hair)}
.money-calc-right{padding:30px 32px}
.money-calc-field{margin-bottom:22px}
.money-calc-row{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:11px}
.money-calc-label{font-size:14px;font-weight:600;color:var(--tx)}
.money-calc-input{font-family:'Space Mono',monospace;font-weight:700;font-size:14px;color:var(--go-text);
  background:var(--ink2);border:1px solid var(--hair);border-radius:8px;padding:7px 11px;text-align:right;width:130px;outline:none}
.money-calc-input:focus{border-color:var(--go)}
.money-calc-seg{display:inline-flex;border:1px solid var(--hair);border-radius:9px;overflow:hidden}
.money-calc-seg button{font-family:'Space Mono',monospace;font-size:12px;letter-spacing:.04em;text-transform:capitalize;
  padding:8px 15px;background:var(--ink2);color:var(--muted);border:none;cursor:pointer;transition:background .15s,color .15s}
.money-calc-seg button.on{background:var(--go);color:var(--on-green);font-weight:700}
.money-calc-select{position:relative;margin-bottom:26px}
.money-calc-selbtn{width:100%;display:flex;align-items:center;justify-content:space-between;gap:10px;
  background:var(--ink2);border:1px solid var(--hair);border-radius:10px;padding:12px 15px;cursor:pointer;
  font-size:14px;font-weight:600;color:var(--tx)}
.money-calc-selbtn:hover{border-color:var(--go-text)}
.money-calc-sellabel{font-size:11px;letter-spacing:.14em;color:var(--faint);display:block;margin-bottom:8px}
.money-calc-selico{width:18px;height:18px;color:var(--go-text)}
.money-calc-menu{position:absolute;z-index:20;top:calc(100% + 6px);left:0;right:0;
  background:var(--panel);border:1px solid var(--hair);border-radius:10px;overflow:hidden;box-shadow:0 24px 50px -20px var(--shadow)}
.money-calc-menu button{width:100%;display:flex;align-items:center;gap:11px;text-align:left;
  padding:11px 15px;background:none;border:none;cursor:pointer;font-size:14px;color:var(--muted)}
.money-calc-menu button:hover{background:rgba(22,217,146,.06);color:var(--tx)}
.money-calc-menu button.on{background:rgba(22,217,146,.08);color:var(--go-text);font-weight:600}
.money-calc-menu button svg,.money-calc-selbtn svg.money-calc-pico{width:18px;height:18px;flex:0 0 auto}
.money-calc-result{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;
  padding-top:22px;margin-top:4px;border-top:1px solid var(--hair)}
.money-calc-pay{font-family:'Anton',sans-serif;font-weight:400;font-size:40px;line-height:1;color:var(--go-text);text-shadow:0 0 34px rgba(22,217,146,.24)}
.money-calc-pay small{font-family:'Space Mono',monospace;font-size:16px;color:var(--muted);margin-left:4px}
.money-calc-total{font-family:'Space Mono',monospace;font-size:12px;color:var(--faint);margin-top:6px}
.money-calc-cells{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:4px}
.money-calc-cell{background:var(--ink2);border:1px solid var(--hair2);border-radius:10px;padding:13px 15px;text-align:center}
.money-calc-cell-k{font-size:10px;letter-spacing:.1em;color:var(--faint);text-transform:uppercase;display:block;margin-bottom:5px}
.money-calc-cell-v{font-family:'Space Mono',monospace;font-weight:700;font-size:16px;color:var(--tx)}
.money-calc-cell-v.hero{color:var(--go-text);font-size:19px}

@media (max-width:820px){
  .money-calc-grid{grid-template-columns:1fr}
  .money-calc-left{border-right:none;border-bottom:1px solid var(--hair)}
  .money-calc-cells{grid-template-columns:1fr 1fr}
}

/* range slider */
.money-range{margin-top:2px}
.money-range-track{position:relative;height:8px;border-radius:9px;background:var(--hair);cursor:pointer;touch-action:none}
.money-range-fill{position:absolute;inset-block:0;left:0;border-radius:9px;
  background:linear-gradient(90deg,var(--go-deep),var(--go));box-shadow:0 0 14px -2px rgba(22,217,146,.45)}
.money-range-thumb{position:absolute;top:50%;width:20px;height:20px;margin-left:-10px;transform:translateY(-50%);
  border-radius:50%;background:var(--panel);border:3px solid var(--go);box-shadow:0 4px 12px -2px var(--shadow)}
.money-range-track:focus-visible{outline:2px solid var(--go);outline-offset:6px}
.money-range-labels{display:flex;justify-content:space-between;margin-top:9px;font-size:11px;color:var(--faint)}

@media (max-width:900px){
  .money-hero-grid{grid-template-columns:1fr;gap:34px}
  .money-benefit-grid{grid-template-columns:1fr 1fr}
  .money-doc-grid{grid-template-columns:1fr}
}
@media (max-width:600px){
  .money-benefit-grid{grid-template-columns:1fr}
}
`;
