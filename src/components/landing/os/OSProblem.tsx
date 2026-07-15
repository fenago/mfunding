// OSProblem — "The bank said no" section for the Momentum OS landing.
// Signature element: a two-column BANK vs MOMENTUM dispatch/ledger table (Space Mono),
// bank side dimmed with red-ish ✗, Momentum side with a subtle green edge and ✓.
// Composes entirely from OSKit — shared tokens, type, eyebrow, section surface.
import { OSSection, Eyebrow, Display, Lede } from "./OSKit";

type RowSpec = { label: string; bank: string; mo: string };

const ROWS: RowSpec[] = [
  { label: "Decision time", bank: "2–6 weeks", mo: "24–48 hours" },
  { label: "Credit minimum", bank: "700+", mo: "no score minimum" },
  { label: "Collateral", bank: "home / assets", mo: "none (MCA)" },
  { label: "Paperwork", bank: "tax returns + more", mo: "3 bank statements" },
  { label: "Approval odds", bank: "most get declined", mo: 'built for a "no"' },
];

export default function OSProblem() {
  return (
    <OSSection tone="panel" id="problem">
      <div className="osp">
        <style>{CSS}</style>

        <div className="osp-head">
          <Eyebrow>THE PROBLEM</Eyebrow>
          <Display>
            BANKS SEE A CREDIT SCORE.<br />
            <span className="os-go">WE SEE A BUSINESS.</span>
          </Display>
          <Lede>
            A bank takes <strong>weeks</strong>, wants tax returns and collateral, and
            still turns down healthy businesses over a single number. Momentum reads your{" "}
            <strong>cash flow</strong> — the money actually moving through your account —
            and funds on it.
          </Lede>
        </div>

        <div className="osp-ledger" role="table" aria-label="Traditional bank versus Momentum">
          {/* Column headers */}
          <div className="osp-col osp-col-bank" role="columnheader">
            <span className="osp-col-tag">TRADITIONAL BANK</span>
            <span className="osp-col-verdict osp-x">✗ SLOW · GATED</span>
          </div>
          <div className="osp-col osp-col-mo" role="columnheader">
            <span className="osp-col-tag">MOMENTUM</span>
            <span className="osp-col-verdict osp-c">✓ FAST · CASH-FLOW BASED</span>
          </div>

          {/* Rows */}
          {ROWS.map((r) => (
            <div className="osp-rowgroup" key={r.label} role="row">
              <span className="osp-rlabel" role="rowheader">{r.label}</span>
              <span className="osp-cell osp-cell-bank" role="cell">
                <span className="osp-mk osp-x" aria-hidden>✗</span>
                <span>{r.bank}</span>
              </span>
              <span className="osp-cell osp-cell-mo" role="cell">
                <span className="osp-mk osp-c" aria-hidden>✓</span>
                <span>{r.mo}</span>
              </span>
            </div>
          ))}
        </div>

        <p className="osp-stat">
          <span className="osp-stat-num os-mono">~80%</span>
          <span className="osp-stat-txt">
            Industry-wide, most small-business bank loan applications are declined or
            under-funded. A profitable business gets a <span className="os-amber">no</span> for
            reasons that have nothing to do with whether it can pay.
          </span>
        </p>

        <p className="osp-fine os-mono">Not a loan. An MCA is a purchase of future receivables.</p>
      </div>
    </OSSection>
  );
}

const CSS = `
.osp{position:relative}
.osp-head{max-width:52em;animation:os-in .6s cubic-bezier(.2,.7,.2,1) both}

/* ── the dispatch/ledger table ── */
.osp-ledger{
  margin-top:44px;
  display:grid;
  grid-template-columns:180px 1fr 1fr;
  column-gap:0;
  border:1px solid var(--hair);
  border-radius:14px;
  overflow:hidden;
  background:linear-gradient(180deg,var(--panel),var(--panel2));
}

/* column header cells — bank spans label+bank col visually via placement */
.osp-col{
  padding:16px 22px;
  display:flex;flex-direction:column;gap:6px;
  border-bottom:1px solid var(--hair);
  font-family:'Space Mono',monospace;
}
.osp-col-bank{grid-column:1 / 3;background:rgba(255,255,255,.015)}
.osp-col-mo{grid-column:3 / 4;position:relative;background:rgba(22,217,146,.05)}
.osp-col-mo::before{content:"";position:absolute;left:0;top:0;bottom:0;width:2px;background:linear-gradient(180deg,var(--go),var(--go-deep))}
.osp-col-tag{font-size:12px;letter-spacing:.16em;color:var(--tx)}
.osp-col-mo .osp-col-tag{color:var(--tx)}
.osp-col-verdict{font-size:11px;letter-spacing:.1em}
.osp-x{color:#D9553F}
.osp-c{color:var(--go)}

/* data rows: label | bank | momentum */
.osp-rowgroup{
  display:grid;grid-column:1 / 4;grid-template-columns:180px 1fr 1fr;
  align-items:stretch;
  border-bottom:1px solid var(--hair2);
}
.osp-rowgroup:last-of-type{border-bottom:none}
.osp-rlabel{
  display:flex;align-items:center;
  padding:15px 22px;
  font-family:'Space Mono',monospace;font-size:12px;letter-spacing:.06em;
  color:var(--muted);text-transform:uppercase;
  border-right:1px solid var(--hair2);
}
.osp-cell{
  display:flex;align-items:center;gap:10px;
  padding:15px 22px;
  font-family:'Space Mono',monospace;font-size:13.5px;letter-spacing:.01em;
}
.osp-cell-bank{color:var(--muted);opacity:.85;background:rgba(0,0,0,.12)}
.osp-cell-mo{color:var(--tx);position:relative;background:rgba(22,217,146,.045)}
.osp-cell-mo::before{content:"";position:absolute;left:0;top:0;bottom:0;width:2px;background:linear-gradient(180deg,rgba(22,217,146,.5),rgba(11,169,104,.5))}
.osp-mk{font-size:12px;flex:none;transition:transform .18s}
.osp-rowgroup:hover .osp-cell-mo .osp-mk{transform:scale(1.18)}
.osp-rowgroup:hover .osp-cell-mo{background:rgba(22,217,146,.08)}

/* ── honest stat line ── */
.osp-stat{
  margin:40px 0 0;display:flex;gap:20px;align-items:baseline;flex-wrap:wrap;
  max-width:56em;
}
.osp-stat-num{
  font-weight:700;font-size:clamp(30px,4vw,42px);color:var(--amber);
  line-height:1;letter-spacing:.01em;flex:none;
}
.osp-stat-txt{font-size:15.5px;line-height:1.6;color:var(--lede);max-width:40em}
.osp-stat-txt .os-amber{font-weight:600}

.osp-fine{margin:22px 0 0;font-size:11.5px;letter-spacing:.04em;color:var(--faint)}

@media (max-width:760px){
  .osp-ledger{grid-template-columns:1fr 1fr;margin-top:32px}
  .osp-col-bank{grid-column:1 / 2}
  .osp-col-mo{grid-column:2 / 3}
  /* stack each row: label full-width, then the two cells side by side */
  .osp-rowgroup{grid-column:1 / 3;grid-template-columns:1fr 1fr}
  .osp-rlabel{
    grid-column:1 / 3;border-right:none;
    border-bottom:1px solid var(--hair2);
    padding:12px 18px 8px;background:rgba(0,0,0,.12);
  }
  .osp-cell{padding:12px 18px;font-size:12.5px}
  .osp-stat{gap:12px}
}
@media (prefers-reduced-motion:reduce){
  .osp-head{animation:none}
  .osp-mk{transition:none}
}
`;
