// A recorded credit box — see @/lib/funderDisclosure for why a funder WITHOUT
// one must never render as a blank cell.
import { type ProgramRow, fmtMonths, fmtMoney, fmtPts, num, prettyExtra } from "@/lib/funderDisclosure";
import { FX } from "./tw";


export function FunderProgramBox({ p, productLabel }: { p: ProgramRow; productLabel: string }) {
  const cells: { k: string; v: string }[] = [];
  const lo = fmtMoney(num(p.approval_min));
  const hi = fmtMoney(num(p.approval_max));
  if (lo || hi) cells.push({ k: "Amount", v: lo && hi ? `${lo}–${hi}` : (hi ?? `${lo}+`) });
  const tib = fmtMonths(p.time_in_business_months);
  if (tib) cells.push({ k: "Time in biz", v: tib });
  if (p.min_credit_score != null) cells.push({ k: "FICO", v: `${p.min_credit_score}+` });
  const mrev = fmtMoney(num(p.monthly_revenue_required));
  const arev = fmtMoney(num(p.annual_revenue_required));
  if (mrev) cells.push({ k: "Revenue / mo", v: mrev });
  else if (arev) cells.push({ k: "Revenue / yr", v: arev });
  if (p.term_text) cells.push({ k: "Term", v: p.term_text });
  if (p.cost_of_capital) cells.push({ k: "Cost", v: p.cost_of_capital });
  if (p.time_to_approve) cells.push({ k: "Decision", v: p.time_to_approve });
  if (p.payment_frequency) cells.push({ k: "Payments", v: p.payment_frequency });

  const docs: string[] = [];
  if (p.doc_bank_statement_months != null) docs.push(`${p.doc_bank_statement_months} mo bank statements`);
  const tr = p.doc_tax_returns;
  if (tr?.business_years != null) docs.push(`business tax returns ${tr.business_years} yr`);
  if (tr?.personal_years != null) docs.push(`personal tax returns ${tr.personal_years} yr`);
  const thr = fmtMoney(num(p.doc_financials_threshold));
  if (thr) docs.push(`P&L + balance sheet over ${thr}`);
  for (const x of p.doc_extras ?? []) docs.push(prettyExtra(x));
  for (const x of p.required_documents ?? []) docs.push(prettyExtra(x));

  const pts = fmtPts(p.points_min, p.points_max);
  const details = (p.important_details ?? []).filter(Boolean);

  return (
    <div className={FX.prog}>
      <div className={FX.ph}>Recorded {productLabel.toLowerCase()} box — from this funder's own packet</div>
      {pts && (
        <div className={FX.pay}>
          We get paid <span className={FX.n}>{pts}</span>
          {details.length === 0 && (
            <span style={{ fontWeight: 600, color: "var(--c)" }}>
              {" "}
              — qualifier not recorded, confirm before quoting
            </span>
          )}
        </div>
      )}
      {cells.length > 0 && (
        <div className={FX.dgrid}>
          {cells.map((c) => (
            <div className={FX.dcell} key={c.k}>
              <div className={FX.k}>{c.k}</div>
              <div className={FX.v}>{c.v}</div>
            </div>
          ))}
        </div>
      )}
      {docs.length > 0 && (
        <div>
          <div className={FX.ph} style={{ marginBottom: 4 }}>Documents</div>
          <div className={FX.chips}>
            {docs.map((d) => (
              <span className={FX.c} key={d}>
                {d}
              </span>
            ))}
          </div>
        </div>
      )}
      {p.doc_conditions && <div className={FX.drow}>{p.doc_conditions}</div>}
      {p.doc_other && <div className={FX.drow}>{p.doc_other}</div>}
      {p.industries_note && (
        <div className={FX.drow}>
          <b className={FX.drowB}>Industries:</b> {p.industries_note}
        </div>
      )}
      {details.length > 0 && (
        <ul className={FX.progUl}>
          {details.map((d) => (
            <li key={d} className={FX.progLi}>{d}</li>
          ))}
        </ul>
      )}
      {p.notes && <div className={FX.drow}>{p.notes}</div>}
    </div>
  );
}

// ── Submission links, partner portals, marketing material ────────────────────
