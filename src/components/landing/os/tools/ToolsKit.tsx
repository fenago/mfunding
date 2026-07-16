// ToolsKit — shared Momentum OS primitives for the public tools + calculators.
// These pages are "the operator's side, at speed": dispatch-board panels, Space Mono
// numerals, one owned go-green signal. Everything reads from OSKit's CSS variables so
// the tools sit inside the exact same system as the landing page — no hardcoded colors,
// both themes for free. Pages own all math + form state; this file is presentation only.
//
// COMPLIANCE NOTE: an MCA is a purchase of future receivables — never a "loan", never
// APR/interest language. Copy lives in the pages; keep it that way when editing.
import { type ReactNode, type InputHTMLAttributes } from "react";
import {
  OS_CSS,
  useOSFonts,
  OSSection,
  Eyebrow,
  Display,
  Lede,
} from "../OSKit";
import OSNav from "../OSNav";
import OSFooter from "../OSFooter";
import ScrollToTop from "../../../ui/ScrollToTop";

// ── Page shell ───────────────────────────────────────────────────────────────

/** The os-root wrapper: loads fonts + tokens once, mounts nav/footer. */
export function ToolShell({ children }: { children: ReactNode }) {
  useOSFonts();
  return (
    <div className="os-root">
      <style>{OS_CSS}</style>
      <style>{TOOLS_CSS}</style>
      <ScrollToTop />
      <OSNav />
      {children}
      <OSFooter />
    </div>
  );
}

/** Ink hero: eyebrow + billboard display + lede. Title may carry a green <span className="os-go">. */
export function ToolHero({
  eyebrow,
  title,
  lede,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  lede: ReactNode;
}) {
  return (
    <OSSection tone="ink">
      <div className="ost-herobox">
        <Eyebrow>{eyebrow}</Eyebrow>
        <Display>{title}</Display>
        <Lede>{lede}</Lede>
      </div>
    </OSSection>
  );
}

// ── Panels ───────────────────────────────────────────────────────────────────

/** A dispatch-board panel (the same card the landing uses). */
export function ToolPanel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`os-card ost-panel ${className}`}>{children}</div>;
}

export function PanelTitle({ children }: { children: ReactNode }) {
  return <h2 className="ost-paneltitle">{children}</h2>;
}

// ── Inputs ───────────────────────────────────────────────────────────────────

/** A labeled range slider with mono value + edge ticks. Math stays in the page. */
export function Slider({
  label,
  valueLabel,
  minTick,
  maxTick,
  ...rest
}: {
  label: ReactNode;
  valueLabel: ReactNode;
  minTick: ReactNode;
  maxTick: ReactNode;
} & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="ost-slider">
      <div className="ost-sliderhead">
        <span className="ost-sliderlabel">{label}</span>
        <span className="ost-slidernum">{valueLabel}</span>
      </div>
      <input type="range" className="ost-range" {...rest} />
      <div className="ost-sliderticks">
        <span>{minTick}</span>
        <span>{maxTick}</span>
      </div>
    </div>
  );
}

/** A mono-labeled segmented toggle. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="ost-seg" role="group">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          data-on={value === o}
          onClick={() => onChange(o)}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

/** A text/tel/email field wearing the OS look. Forwards all native input props. */
export function Field({
  label,
  col2,
  ...rest
}: { label: ReactNode; col2?: boolean } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={`ost-field${col2 ? " ost-col2" : ""}`}>
      <span className="ost-field-label">{label}</span>
      <input className="ost-input" {...rest} />
    </label>
  );
}

/** A select field wearing the OS look. */
export function SelectField({
  label,
  value,
  onChange,
  placeholder,
  options,
}: {
  label: ReactNode;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: readonly string[];
}) {
  return (
    <label className="ost-field">
      <span className="ost-field-label">{label}</span>
      <select className="ost-select" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

// ── Results ──────────────────────────────────────────────────────────────────

/** The headline result: big mono numeral on a green-tinted panel. */
export function ResultHero({
  cap,
  value,
  sub,
}: {
  cap: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div className="ost-result-hero">
      <p className="ost-result-cap">{cap}</p>
      <p className="ost-result-num">{value}</p>
      {sub && <p className="ost-result-sub">{sub}</p>}
    </div>
  );
}

/** A small stat tile. `go` tints it green for the "headline" metric. */
export function StatTile({ value, label, go }: { value: ReactNode; label: ReactNode; go?: boolean }) {
  return (
    <div className={`ost-stat${go ? " ost-stat-go" : ""}`}>
      <p className="ost-stat-num">{value}</p>
      <p className="ost-stat-label">{label}</p>
    </div>
  );
}

// ── Stylesheet ───────────────────────────────────────────────────────────────

export const TOOLS_CSS = `
.ost-herobox{max-width:44em}

/* layout */
.ost-cols{display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start}
.ost-panel{padding:30px}
.ost-paneltitle{
  font-family:'Anton',sans-serif;font-weight:400;text-transform:uppercase;letter-spacing:.01em;
  font-size:22px;line-height:1.02;color:var(--tx);margin:0 0 24px;
  display:flex;align-items:center;gap:11px;
}
.ost-paneltitle svg{width:22px;height:22px;color:var(--go-text);flex:0 0 auto}

/* slider */
.ost-slider{margin-bottom:26px}
.ost-slider:last-child{margin-bottom:0}
.ost-sliderhead{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:12px}
.ost-sliderlabel{font-family:'Space Mono',monospace;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--faint)}
.ost-slidernum{font-family:'Space Mono',monospace;font-weight:700;font-size:18px;color:var(--go-text);letter-spacing:-.01em}
.ost-sliderticks{display:flex;justify-content:space-between;font-family:'Space Mono',monospace;font-size:11px;letter-spacing:.04em;color:var(--faint);margin-top:9px}
.ost-range{
  -webkit-appearance:none;appearance:none;width:100%;height:6px;border-radius:999px;
  background:var(--hair);outline:none;cursor:pointer;
}
.ost-range::-webkit-slider-thumb{
  -webkit-appearance:none;appearance:none;width:20px;height:20px;border-radius:50%;
  background:var(--go);border:3px solid var(--panel);
  box-shadow:0 3px 10px -3px rgba(22,217,146,.65),0 0 0 1px var(--hair);
  cursor:pointer;transition:transform .12s;
}
.ost-range::-webkit-slider-thumb:hover{transform:scale(1.14)}
.ost-range::-moz-range-thumb{
  width:20px;height:20px;border-radius:50%;background:var(--go);border:3px solid var(--panel);
  box-shadow:0 3px 10px -3px rgba(22,217,146,.65);cursor:pointer;
}
.ost-range:focus-visible::-webkit-slider-thumb{outline:2px solid var(--go);outline-offset:2px}

/* segmented + fields */
.ost-seg{display:inline-flex;border:1px solid var(--hair);border-radius:10px;overflow:hidden;background:var(--ink2)}
.ost-seg button{
  font-family:'Space Mono',monospace;font-size:13px;letter-spacing:.04em;text-transform:uppercase;
  padding:10px 18px;background:transparent;border:none;color:var(--muted);cursor:pointer;
  transition:background .15s,color .15s;
}
.ost-seg button+button{border-left:1px solid var(--hair)}
.ost-seg button:hover{color:var(--tx)}
.ost-seg button[data-on="true"]{background:var(--go);color:var(--on-green);font-weight:700}

.ost-field{display:block}
.ost-field-label{
  font-family:'Space Mono',monospace;font-size:11px;letter-spacing:.1em;text-transform:uppercase;
  color:var(--faint);margin-bottom:7px;display:block;
}
.ost-input,.ost-select{
  width:100%;padding:12px 14px;border-radius:10px;border:1px solid var(--hair);
  background:var(--ink2);color:var(--tx);font-size:15px;font-family:'Inter',system-ui,sans-serif;
  outline:none;transition:border-color .15s;
}
.ost-input:focus,.ost-select:focus{border-color:var(--go-text)}
.ost-input::placeholder{color:var(--faint)}
.ost-select{appearance:none;cursor:pointer}
.ost-fieldnote{font-family:'Space Mono',monospace;font-size:11px;line-height:1.6;letter-spacing:.02em;color:var(--faint);margin:22px 0 0}

/* forms */
.ost-form{display:flex;flex-direction:column;gap:16px}
.ost-formgrid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.ost-formgrid .ost-col2{grid-column:1 / -1}
.ost-submit{
  width:100%;justify-content:center;border:none;cursor:pointer;font-family:'Inter',system-ui,sans-serif;
}
.ost-submit:disabled{opacity:.6;cursor:default;transform:none;box-shadow:0 10px 30px -8px rgba(22,217,146,.5)}
.ost-err{font-size:13px;color:#ef6b6b;margin:0}

/* results */
.ost-result-hero{
  border:1px solid rgba(22,217,146,.4);border-radius:14px;padding:26px;
  background:rgba(22,217,146,.06);text-align:center;
}
.ost-result-cap{font-family:'Space Mono',monospace;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--faint);margin:0 0 10px}
.ost-result-num{font-family:'Space Mono',monospace;font-weight:700;font-size:clamp(28px,5vw,40px);line-height:1;letter-spacing:-.02em;color:var(--go-text);margin:0;text-shadow:0 0 40px rgba(22,217,146,.25)}
.ost-result-num small{font-size:.5em;font-weight:400;color:var(--muted)}
.ost-result-sub{font-family:'Space Mono',monospace;font-size:12px;letter-spacing:.02em;color:var(--muted);margin:12px 0 0}

.ost-statgrid{display:grid;gap:12px;margin:16px 0}
.ost-statgrid-3{grid-template-columns:repeat(3,1fr)}
.ost-statgrid-2{grid-template-columns:repeat(2,1fr)}
.ost-stat{
  border:1px solid var(--hair);border-radius:12px;padding:18px 14px;
  background:linear-gradient(180deg,var(--panel),var(--panel2));text-align:center;
}
.ost-stat-num{font-family:'Space Mono',monospace;font-weight:700;font-size:18px;letter-spacing:-.01em;color:var(--tx);margin:0}
.ost-stat-label{font-family:'Space Mono',monospace;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--faint);margin:7px 0 0}
.ost-stat-go{border-color:rgba(22,217,146,.4);background:rgba(22,217,146,.07)}
.ost-stat-go .ost-stat-num{color:var(--go-text)}

/* callouts + fine print */
.ost-note{
  border:1px solid rgba(22,217,146,.3);border-radius:12px;background:rgba(22,217,146,.05);
  padding:16px;display:flex;gap:12px;align-items:flex-start;
}
.ost-note svg{width:22px;height:22px;color:var(--go-text);flex:0 0 auto}
.ost-note p{font-size:14px;line-height:1.55;color:var(--lede);margin:0}
.ost-note strong{color:var(--tx);font-weight:600}
.ost-fine{
  font-family:'Space Mono',monospace;font-size:11px;line-height:1.7;letter-spacing:.01em;
  color:var(--faint);margin:0;
}
.ost-fine svg{width:14px;height:14px;display:inline-block;vertical-align:-2px;margin-right:5px}
.ost-fine strong{color:var(--muted)}
.ost-back{font-family:'Space Mono',monospace;font-size:12px;letter-spacing:.04em;color:var(--muted);text-decoration:none;display:inline-block;margin-top:6px}
.ost-back:hover{color:var(--go-text)}

.ost-lockhead{display:flex;align-items:center;gap:11px;margin-bottom:10px}
.ost-lockhead svg{width:22px;height:22px;color:var(--muted);flex:0 0 auto}
.ost-lead{font-size:15px;line-height:1.6;color:var(--lede);margin:0 0 22px}

/* tools hub (FreeToolsPage) */
.ost-groupbar{
  display:flex;align-items:center;justify-content:space-between;gap:16px;
  font-family:'Space Mono',monospace;font-size:12px;letter-spacing:.14em;text-transform:uppercase;
  color:var(--muted);padding:0 2px 12px;border-bottom:1px solid var(--hair);margin-bottom:20px;
}
.ost-groupbar-title{display:inline-flex;align-items:center;gap:9px;color:var(--tx)}
.ost-groupbar-title svg{width:16px;height:16px;color:var(--go-text)}
.ost-groupbar-count{color:var(--faint)}
.ost-toolgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.ost-toolcard{display:flex;flex-direction:column;text-decoration:none;min-height:190px}
.ost-toolico{
  width:44px;height:44px;border-radius:11px;display:grid;place-items:center;margin-bottom:16px;
  background:rgba(22,217,146,.1);color:var(--go-text);border:1px solid rgba(22,217,146,.25);
}
.ost-toolico svg{width:22px;height:22px}
.ost-toolname{
  font-family:'Anton',sans-serif;font-weight:400;text-transform:uppercase;letter-spacing:.01em;
  font-size:18px;line-height:1.05;color:var(--tx);margin:0 0 9px;
}
.ost-tooldesc{font-size:13.5px;line-height:1.55;color:var(--muted);margin:0 0 18px;flex:1}
.ost-toolopen{
  font-family:'Space Mono',monospace;font-size:11.5px;letter-spacing:.04em;color:var(--faint);
  display:inline-flex;align-items:center;gap:6px;padding-top:14px;border-top:1px solid var(--hair);
  transition:color .15s;
}
.ost-toolcard:hover .ost-toolopen{color:var(--go-text)}
.ost-group{margin-bottom:56px}
.ost-group:last-child{margin-bottom:0}

/* closing CTA band */
.ost-ctaband{
  border:1px solid rgba(22,217,146,.35);border-radius:16px;padding:44px 32px;text-align:center;
  background:rgba(22,217,146,.05);
}
.ost-ctaband h2{
  font-family:'Anton',sans-serif;font-weight:400;text-transform:uppercase;letter-spacing:.01em;
  font-size:clamp(26px,3.4vw,36px);line-height:1;color:var(--tx);margin:0 0 12px;
}
.ost-ctaband p{font-size:16px;line-height:1.6;color:var(--lede);max-width:38em;margin:0 auto 24px}

/* opt-in form (single-column lead capture) */
.ost-optin{max-width:640px;margin:0 auto}
.ost-optin-head{text-align:center;margin-bottom:32px}
.ost-optin-head .os-lede,.ost-optin-done .os-lede{margin-left:auto;margin-right:auto}
.ost-optin-done{text-align:center;padding:20px 0}
.ost-optin-badge{
  width:64px;height:64px;border-radius:50%;display:grid;place-items:center;margin:0 auto 22px;
  background:var(--go);color:var(--on-green);box-shadow:0 10px 30px -8px rgba(22,217,146,.5);
}
.ost-optin-badge svg{width:32px;height:32px}
.ost-fullform{display:flex;flex-direction:column;gap:18px}

@media (max-width:900px){
  .ost-cols{grid-template-columns:1fr}
  .ost-toolgrid{grid-template-columns:repeat(2,1fr)}
}
@media (max-width:600px){
  .ost-toolgrid{grid-template-columns:1fr}
  .ost-toolcard{min-height:0}
}
@media (max-width:520px){
  .ost-formgrid{grid-template-columns:1fr}
  .ost-statgrid-3{grid-template-columns:1fr}
  .ost-panel{padding:24px}
}
`;
