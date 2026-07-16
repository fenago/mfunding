// AssessKit — the shared "Momentum OS" design layer for the free assessment pages
// (src/pages/assessments/*). It reuses the OS tokens from OSKit (--ink, --go, --amber,
// Anton/Inter/Space Mono) and adds assessment-specific chrome: the wizard card, progress,
// slider, choice options, verdict panels, stat readouts, and the shared lead-capture gate.
//
// Direction matches the landing "dispatch board": deep-ink surfaces, one owned go-green
// "approved" signal, amber for caution, a red only for the genuinely critical readout.
// Score/dollar readouts render in Space Mono. Every page mounts <AssessLayout> which loads
// the OS fonts + both stylesheets once, so nothing else needs to import OSKit directly.
//
// ONLY the assessment pages use this file — safe to evolve as a set. Pages should compose
// the primitives below (and the documented `as-*` classes) rather than re-add local styles.
import { type ReactNode } from "react";
import { LockClosedIcon, ShieldCheckIcon } from "@heroicons/react/24/outline";
import { OS_CSS, useOSFonts } from "../OSKit";
import OSNav from "../OSNav";
import OSFooter from "../OSFooter";
import ScrollToTop from "../../../ui/ScrollToTop";

// ── Shared data helpers (identical across every assessment) ──────────────────
export const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
export const pct = (n: number) => `${Math.round(n)}%`;

export interface ContactForm {
  business_name: string;
  contact_first_name: string;
  contact_last_name: string;
  email: string;
  phone: string;
}
export const EMPTY_CONTACT: ContactForm = {
  business_name: "",
  contact_first_name: "",
  contact_last_name: "",
  email: "",
  phone: "",
};

// ── Page shell ───────────────────────────────────────────────────────────────
/** Wraps a page in os-root, loads fonts + stylesheets once, mounts OSNav + OSFooter.
 *  Pass the page's <SEO/> as `seo` so it stays inside the document head flow. */
export function AssessLayout({ seo, children }: { seo?: ReactNode; children: ReactNode }) {
  useOSFonts();
  return (
    <div className="os-root as-root">
      <style>{OS_CSS}</style>
      <style>{ASSESS_CSS}</style>
      {seo}
      <ScrollToTop />
      <OSNav />
      <main>{children}</main>
      <OSFooter />
    </div>
  );
}

/** Interior hero: mono badge (with optional icon), Anton display title, lede. */
export function AssessHero({
  badge,
  icon,
  title,
  lede,
}: {
  badge: string;
  icon?: ReactNode;
  title: ReactNode;
  lede: ReactNode;
}) {
  return (
    <section className="as-hero">
      <div className="os-container">
        <div className="as-hero-inner">
          <span className="as-badge">
            {icon}
            {badge}
          </span>
          <h1 className="as-hero-title">{title}</h1>
          <p className="as-hero-lede">{lede}</p>
        </div>
      </div>
    </section>
  );
}

/** The body section beneath the hero — carries the dispatch-grid texture. */
export function AssessBody({ children }: { children: ReactNode }) {
  return (
    <section className="as-body">
      <div className="os-container">{children}</div>
    </section>
  );
}

// ── Wizard chrome ────────────────────────────────────────────────────────────
/** A framed panel (no hover lift) — the wizard and result cards live in these. */
export function AssessCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`as-card ${className}`}>{children}</div>;
}

/** Linear progress with a "Step N of M" / percent header row. */
export function AssessProgress({
  step,
  total,
  label,
  percentOverride,
}: {
  step: number; // 0-based current step
  total: number;
  label?: string; // overrides the left "Step N of M" text
  percentOverride?: number; // overrides the computed percent
}) {
  const percent = percentOverride ?? Math.round(((step + 1) / total) * 100);
  return (
    <div className="as-progress">
      <div className="as-progress-head">
        <span className="os-mono">{label ?? `STEP ${step + 1} / ${total}`}</span>
        <span className="os-mono">{percent}%</span>
      </div>
      <div className="as-progress-track">
        <div className="as-progress-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

/** Segmented step ticks (used where steps are labeled Advances / Balance / …). */
export function AssessSteps({ steps, current }: { steps: readonly string[]; current: number }) {
  return (
    <div className="as-steps">
      {steps.map((s, i) => (
        <div key={s} className="as-step">
          <div className={`as-step-bar ${i <= current ? "is-on" : ""}`} />
          <span className={`as-step-label os-mono ${i <= current ? "is-on" : ""}`}>{s}</span>
        </div>
      ))}
    </div>
  );
}

/** Full-width choice option (radio-style). */
export function AssessOption({
  label,
  selected,
  onClick,
}: {
  label: ReactNode;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className={`as-option ${selected ? "is-sel" : ""}`}>
      {label}
    </button>
  );
}

/** A range slider with a header row (label + mono value) and min/max scale.
 *  `value` is the raw number that drives the input; `display` is the formatted
 *  readout shown in the header (e.g. usd(value) or `${value}%`). */
export function AssessSlider({
  label,
  value,
  display,
  min,
  max,
  step = 1,
  onChange,
  minLabel,
  maxLabel,
  hint,
}: {
  label: ReactNode;
  value: number;
  display: ReactNode;
  min: number;
  max: number;
  step?: number;
  onChange: (n: number) => void;
  minLabel: string;
  maxLabel: string;
  hint?: ReactNode;
}) {
  return (
    <div>
      <div className="as-slider-head">
        <span className="as-slider-label">{label}</span>
        <span className="as-value">{display}</span>
      </div>
      {hint && <p className="as-hint">{hint}</p>}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="as-slider"
      />
      <div className="as-slider-scale os-mono">
        <span>{minLabel}</span>
        <span>{maxLabel}</span>
      </div>
    </div>
  );
}

/** Back / Next footer for a wizard step. */
export function AssessNav({
  onBack,
  onNext,
  backDisabled,
  nextDisabled,
  nextLabel = "Next",
  nextHint,
}: {
  onBack: () => void;
  onNext?: () => void; // omit on the final step to render `nextHint` as static text
  backDisabled?: boolean;
  nextDisabled?: boolean;
  nextLabel?: string;
  nextHint?: ReactNode; // static text shown when there is no onNext (final step)
}) {
  return (
    <div className="as-nav">
      <button type="button" onClick={onBack} disabled={backDisabled} className="as-back">
        <span aria-hidden>←</span> Back
      </button>
      {onNext ? (
        <button type="button" onClick={onNext} disabled={nextDisabled} className="as-next">
          {nextLabel} <span aria-hidden>→</span>
        </button>
      ) : (
        <span className="as-nexthint">{nextHint}</span>
      )}
    </div>
  );
}

// ── Result primitives ────────────────────────────────────────────────────────
/** A small stat readout tile (mono number + caption). */
export function AssessStat({ value, label }: { value: ReactNode; label: ReactNode }) {
  return (
    <div className="as-stat">
      <p className="as-stat-num as-value">{value}</p>
      <p className="as-stat-label">{label}</p>
    </div>
  );
}

/** A verdict / headline panel. `tone` sets the accent (go / amber / danger / info). */
export function AssessVerdict({
  tone = "go",
  children,
  className = "",
}: {
  tone?: "go" | "amber" | "danger" | "info";
  children: ReactNode;
  className?: string;
}) {
  return <div className={`as-verdict is-${tone} ${className}`}>{children}</div>;
}

/** The compliance/estimate footnote (shield icon + small print). */
export function AssessNote({ children }: { children: ReactNode }) {
  return (
    <p className="as-note">
      <ShieldCheckIcon className="as-note-ico" />
      {children}
    </p>
  );
}

// ── The shared lead-capture gate ─────────────────────────────────────────────
/** Identical five-field capture form used by every assessment. */
export function GateForm({
  form,
  onSet,
  onSubmit,
  submitting,
  error,
  heading,
  blurb,
  submitIdle,
  submitBusy,
  footnote,
  disabled,
}: {
  form: ContactForm;
  onSet: <K extends keyof ContactForm>(k: K, v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  submitting: boolean;
  error: string | null;
  heading: string;
  blurb: ReactNode;
  submitIdle: string;
  submitBusy: string;
  footnote: ReactNode;
  disabled?: boolean;
}) {
  return (
    <>
      <div className="as-gate-head">
        <LockClosedIcon className="as-gate-lock" />
        <h2 className="as-card-title">{heading}</h2>
      </div>
      <p className="as-gate-blurb">{blurb}</p>
      <form onSubmit={onSubmit} className="as-form">
        <div className="as-form-grid">
          <label className="as-field as-field-full">
            <span>Business name</span>
            <input value={form.business_name} onChange={(e) => onSet("business_name", e.target.value)} />
          </label>
          <label className="as-field">
            <span>First name *</span>
            <input
              required
              value={form.contact_first_name}
              onChange={(e) => onSet("contact_first_name", e.target.value)}
            />
          </label>
          <label className="as-field">
            <span>Last name</span>
            <input
              value={form.contact_last_name}
              onChange={(e) => onSet("contact_last_name", e.target.value)}
            />
          </label>
          <label className="as-field">
            <span>Email *</span>
            <input required type="email" value={form.email} onChange={(e) => onSet("email", e.target.value)} />
          </label>
          <label className="as-field">
            <span>Phone *</span>
            <input required type="tel" value={form.phone} onChange={(e) => onSet("phone", e.target.value)} />
          </label>
        </div>
        {error && <p className="as-error">{error}</p>}
        <button type="submit" disabled={submitting || disabled} className="as-submit">
          {submitting ? submitBusy : submitIdle} {!submitting && <span aria-hidden>→</span>}
        </button>
        <p className="as-note as-note-center">
          <ShieldCheckIcon className="as-note-ico" />
          {footnote}
        </p>
      </form>
    </>
  );
}

// ── Stylesheet (rendered once by AssessLayout) ───────────────────────────────
export const ASSESS_CSS = `
/* Assessment-only semantic tokens layered on the OS palette. Danger is reserved
   for the single critical readout; go/amber come from OSKit. */
.as-root{--as-danger:#C2410C; --as-danger-soft:rgba(194,65,12,.10); --as-danger-hair:rgba(194,65,12,.34);
  --as-info:var(--go-text); --as-info-soft:rgba(22,217,146,.08);}
.dark .as-root{--as-danger:#F98D6B; --as-danger-soft:rgba(249,141,107,.14); --as-danger-hair:rgba(249,141,107,.34);}

.as-root main{display:block}

/* hero — ink surface with the dispatch grid */
.as-hero{
  position:relative; padding:72px 0 64px;
  background:
    linear-gradient(var(--hair2) 1px,transparent 1px),
    linear-gradient(90deg,var(--hair2) 1px,transparent 1px),
    var(--ink);
  background-size:64px 64px,64px 64px,auto;
  border-bottom:1px solid var(--hair);
}
.as-hero-inner{max-width:44rem}
.as-badge{
  font-family:'Space Mono',monospace; font-size:12px; letter-spacing:.14em; text-transform:uppercase;
  color:var(--go-text); background:rgba(22,217,146,.08); border:1px solid rgba(22,217,146,.28);
  border-radius:999px; padding:8px 14px; display:inline-flex; align-items:center; gap:8px; margin-bottom:22px;
}
.as-badge svg{width:15px;height:15px}
.as-hero-title{
  font-family:'Anton',sans-serif; font-weight:400; text-transform:uppercase; letter-spacing:.006em;
  line-height:.94; font-size:clamp(32px,4.4vw,54px); margin:0 0 18px; color:var(--tx);
}
.as-hero-lede{font-size:17px; line-height:1.6; color:var(--lede); max-width:40em; margin:0}
.as-hero-lede strong{color:var(--tx); font-weight:600}

/* body */
.as-body{padding:60px 0 90px; background:var(--ink)}
.as-narrow{max-width:640px; margin:0 auto}
.as-wide{max-width:1040px; margin:0 auto}
.as-cols{display:grid; grid-template-columns:1fr 1fr; gap:26px; align-items:start; max-width:1040px; margin:0 auto}
.as-stack{display:flex; flex-direction:column; gap:22px}

/* card */
.as-card{
  background:linear-gradient(180deg,var(--panel),var(--panel2));
  border:1px solid var(--hair); border-radius:16px; padding:28px;
}
.as-card-title{font-family:'Anton',sans-serif; font-weight:400; text-transform:uppercase; letter-spacing:.01em;
  font-size:22px; line-height:1.05; color:var(--tx); margin:0}
.as-card-head{display:flex; align-items:center; gap:10px; margin-bottom:20px}
.as-card-head svg{width:22px;height:22px;color:var(--go-text)}

/* progress (linear) */
.as-progress{margin-bottom:26px}
.as-progress-head{display:flex; justify-content:space-between; font-size:12px; letter-spacing:.08em;
  color:var(--muted); margin-bottom:8px}
.as-progress-track{height:8px; width:100%; border-radius:999px; background:var(--hair); overflow:hidden}
.as-progress-fill{height:100%; border-radius:999px; background:var(--go); transition:width .35s ease;
  box-shadow:0 0 14px rgba(22,217,146,.5)}

/* progress (segmented) */
.as-steps{display:flex; gap:8px; margin-bottom:24px}
.as-step{flex:1}
.as-step-bar{height:5px; border-radius:999px; background:var(--hair); transition:background .2s}
.as-step-bar.is-on{background:var(--go); box-shadow:0 0 10px rgba(22,217,146,.5)}
.as-step-label{display:block; margin-top:6px; font-size:10px; letter-spacing:.06em; text-transform:uppercase; color:var(--muted)}
.as-step-label.is-on{color:var(--go-text)}

/* question heading + hint */
.as-qlabel{font-family:'Space Mono',monospace; font-size:12px; letter-spacing:.1em; text-transform:uppercase;
  color:var(--go-text); display:inline-flex; align-items:center; gap:8px; margin:0 0 10px}
.as-qlabel svg{width:15px;height:15px}
.as-qtitle{font-size:22px; line-height:1.25; font-weight:700; color:var(--tx); margin:0 0 18px; letter-spacing:-.01em}
.as-hint{font-size:14px; line-height:1.55; color:var(--muted); margin:0 0 14px}
.as-hint strong{color:var(--tx); font-weight:600}

/* choice options */
.as-option{
  display:block; width:100%; text-align:left; padding:14px 18px; margin-bottom:12px;
  border:1px solid var(--hair); border-radius:12px; background:var(--ink2); color:var(--lede);
  font-size:15px; font-weight:500; cursor:pointer; transition:border-color .15s, background .15s, color .15s;
}
.as-option:hover{border-color:var(--go-text); background:rgba(22,217,146,.05)}
.as-option.is-sel{border-color:var(--go); background:rgba(22,217,146,.1); color:var(--tx);
  box-shadow:inset 0 0 0 1px var(--go)}
.as-optgrid{display:grid; grid-template-columns:1fr 1fr; gap:12px}
.as-optgrid .as-option{margin-bottom:0}
.as-monthgrid{display:grid; grid-template-columns:repeat(4,1fr); gap:10px}
.as-monthgrid .as-option{margin-bottom:0; text-align:center; padding:12px 6px; font-weight:600}

/* segmented toggle (e.g. daily / weekly) */
.as-toggle{display:inline-flex; border:1px solid var(--hair); border-radius:10px; overflow:hidden}
.as-toggle button{padding:9px 22px; font-size:14px; font-weight:600; text-transform:capitalize; background:var(--ink2);
  color:var(--muted); border:0; cursor:pointer; transition:background .15s, color .15s}
.as-toggle button.is-on{background:var(--go); color:var(--on-green)}

/* slider */
.as-slider-head{display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:6px}
.as-slider-label{font-size:14px; font-weight:600; color:var(--lede)}
.as-slider{-webkit-appearance:none; appearance:none; width:100%; height:6px; border-radius:999px;
  background:var(--hair); outline:none; cursor:pointer; margin-top:8px}
.as-slider::-webkit-slider-thumb{-webkit-appearance:none; appearance:none; width:22px; height:22px; border-radius:50%;
  background:var(--go); border:3px solid var(--panel); box-shadow:0 2px 10px rgba(0,0,0,.35); cursor:pointer}
.as-slider::-moz-range-thumb{width:22px; height:22px; border-radius:50%; background:var(--go);
  border:3px solid var(--panel); box-shadow:0 2px 10px rgba(0,0,0,.35); cursor:pointer}
.as-slider-scale{display:flex; justify-content:space-between; font-size:11px; color:var(--faint); margin-top:8px}

/* mono values */
.as-value{font-family:'Space Mono',monospace; font-weight:700; color:var(--go-text); font-variant-numeric:tabular-nums}

/* nav */
.as-nav{display:flex; align-items:center; justify-content:space-between; margin-top:30px}
.as-back{background:none; border:0; color:var(--muted); font-size:14px; font-weight:600; cursor:pointer;
  display:inline-flex; align-items:center; gap:6px; padding:6px 2px}
.as-back:hover:not(:disabled){color:var(--tx)}
.as-back:disabled{opacity:.35; cursor:default}
.as-next{background:var(--go); color:var(--on-green); border:0; font-weight:700; font-size:15px;
  padding:13px 24px; border-radius:10px; cursor:pointer; display:inline-flex; align-items:center; gap:8px;
  box-shadow:0 10px 26px -10px rgba(22,217,146,.55); transition:transform .15s, box-shadow .15s}
.as-next:hover:not(:disabled){transform:translateY(-2px)}
.as-next:disabled{opacity:.45; cursor:default; box-shadow:none}
.as-nexthint{font-family:'Space Mono',monospace; font-size:13px; color:var(--go-text); font-weight:700}

/* stat tiles */
.as-statrow{display:grid; gap:12px; margin:16px 0}
.as-statrow.cols-2{grid-template-columns:1fr 1fr}
.as-statrow.cols-3{grid-template-columns:1fr 1fr 1fr}
.as-stat{background:var(--ink2); border:1px solid var(--hair2); border-radius:12px; padding:16px; text-align:center}
.as-stat-num{font-size:19px; margin:0}
.as-stat-label{font-size:11px; color:var(--muted); margin:6px 0 0; line-height:1.3}

/* verdict / readout panels */
.as-verdict{border:1px solid var(--hair); border-left-width:4px; border-radius:12px; padding:22px; text-align:center}
.as-verdict.is-go{border-left-color:var(--go); background:rgba(22,217,146,.07)}
.as-verdict.is-amber{border-left-color:var(--amber); background:rgba(180,116,15,.08)}
.as-verdict.is-danger{border-left-color:var(--as-danger); background:var(--as-danger-soft)}
.as-verdict.is-info{border-left-color:var(--go-text); background:var(--as-info-soft)}
.as-verdict-cap{font-size:13px; color:var(--muted); margin:0 0 6px}
.as-verdict-big{font-family:'Space Mono',monospace; font-weight:700; font-variant-numeric:tabular-nums;
  font-size:clamp(30px,5vw,42px); line-height:1; margin:0}
.as-verdict-sub{font-size:12px; color:var(--muted); margin:8px 0 0}
.as-verdict-blurb{font-size:14px; line-height:1.55; color:var(--lede); margin:12px 0 0}
.as-chip{display:inline-block; font-family:'Space Mono',monospace; font-size:12px; font-weight:700;
  letter-spacing:.05em; text-transform:uppercase; padding:6px 14px; border-radius:999px; margin-bottom:12px}
.as-chip.is-go{background:rgba(22,217,146,.14); color:var(--go-text)}
.as-chip.is-amber{background:rgba(180,116,15,.16); color:var(--amber)}
.as-chip.is-danger{background:var(--as-danger-soft); color:var(--as-danger)}
.as-chip.is-info{background:rgba(22,217,146,.12); color:var(--go-text)}

/* grade / tone text colors for pages to map onto */
.as-t-go{color:var(--go-text)}
.as-t-amber{color:var(--amber)}
.as-t-danger{color:var(--as-danger)}

/* big grade readout */
.as-grade{font-family:'Anton',sans-serif; font-weight:400; font-size:88px; line-height:.85; margin:0}

/* meter bars (score breakdown) */
.as-meter{height:8px; width:100%; border-radius:999px; background:var(--hair); overflow:hidden}
.as-meter-fill{height:100%; border-radius:999px}
.as-meter-fill.is-go{background:var(--go)}
.as-meter-fill.is-amber{background:var(--amber)}
.as-meter-fill.is-danger{background:var(--as-danger)}
.as-meter-row{display:flex; justify-content:space-between; font-size:13px; margin-bottom:6px}
.as-meter-row .os-mono{color:var(--muted)}

/* locked preview */
.as-locked{position:relative; overflow:hidden}
.as-blur{filter:blur(9px); user-select:none; pointer-events:none}
.as-lockchip{position:absolute; inset:0; display:flex; align-items:center; justify-content:center}
.as-lockchip span{display:inline-flex; align-items:center; gap:8px; font-family:'Space Mono',monospace;
  font-size:13px; font-weight:700; color:var(--tx); background:var(--panel); border:1px solid var(--hair);
  padding:9px 16px; border-radius:999px}
.as-lockchip svg{width:15px;height:15px}

/* success + list rows */
.as-success{border:1px solid rgba(22,217,146,.34); background:rgba(22,217,146,.07); border-radius:12px;
  padding:16px; display:flex; align-items:flex-start; gap:12px}
.as-success svg{width:22px; height:22px; color:var(--go-text); flex-shrink:0}
.as-success p{font-size:14px; line-height:1.55; color:var(--lede); margin:0}
.as-success strong{color:var(--tx); font-weight:700}
.as-rowcard{border:1px solid var(--hair); border-radius:12px; padding:16px}
.as-checkrow{display:flex; align-items:center; gap:8px; color:var(--lede); font-size:15px; padding:5px 0}
.as-checkrow svg{width:20px;height:20px;color:var(--go-text);flex-shrink:0}

/* gate form */
.as-gate-head{display:flex; align-items:center; gap:10px; margin-bottom:8px}
.as-gate-lock{width:22px;height:22px;color:var(--go-text)}
.as-gate-blurb{font-size:15px; line-height:1.55; color:var(--muted); margin:0 0 22px}
.as-form{display:flex; flex-direction:column; gap:16px}
.as-form-grid{display:grid; grid-template-columns:1fr 1fr; gap:14px}
.as-field{display:flex; flex-direction:column; gap:6px; font-size:13px}
.as-field-full{grid-column:1 / -1}
.as-field span{color:var(--muted)}
.as-field input{width:100%; padding:11px 13px; border-radius:10px; border:1px solid var(--hair);
  background:var(--ink2); color:var(--tx); font-size:15px; font-family:inherit; outline:none;
  transition:border-color .15s, box-shadow .15s}
.as-field input:focus{border-color:var(--go); box-shadow:0 0 0 3px rgba(22,217,146,.16)}
.as-error{font-size:14px; color:var(--as-danger); margin:0}
.as-submit{width:100%; padding:14px; border-radius:10px; border:0; background:var(--go); color:var(--on-green);
  font-weight:700; font-size:15px; cursor:pointer; display:inline-flex; align-items:center; justify-content:center;
  gap:8px; box-shadow:0 10px 26px -10px rgba(22,217,146,.55); transition:transform .15s}
.as-submit:hover:not(:disabled){transform:translateY(-2px)}
.as-submit:disabled{opacity:.55; cursor:default; box-shadow:none}

/* notes / footnotes */
.as-note{font-size:12px; line-height:1.6; color:var(--faint); margin:18px 0 0}
.as-note-center{text-align:center}
.as-note strong{color:var(--muted); font-weight:600}
.as-note-ico{width:14px; height:14px; display:inline-block; vertical-align:-2px; margin-right:5px}

/* footer links inside results */
.as-backlink{display:inline-flex; align-items:center; gap:5px; margin-top:22px; font-size:14px;
  color:var(--go-text); text-decoration:none}
.as-backlink:hover{text-decoration:underline}
.as-sep{margin:0 10px; color:var(--faint)}

@media (max-width:820px){
  .as-cols{grid-template-columns:1fr}
  .as-hero{padding:56px 0 48px}
  .as-body{padding:44px 0 64px}
  .as-monthgrid{grid-template-columns:repeat(3,1fr)}
}
@media (prefers-reduced-motion:reduce){
  .as-next:hover,.as-submit:hover{transform:none}
}
`;
