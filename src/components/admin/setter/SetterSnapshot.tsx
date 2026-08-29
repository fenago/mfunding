import {
  BanknotesIcon,
  CalendarDaysIcon,
  ClockIcon,
  CurrencyDollarIcon,
  RectangleStackIcon,
  TagIcon,
} from "@heroicons/react/24/outline";
import { sourceMeta, SOURCE_TONE_CLASS } from "../../../lib/sourceLabel";
import { dateTimeET } from "../../../utils/time";
import type { DealWithCustomer } from "../../../types/deals";

/**
 * SetterSnapshot — the "know the merchant before you talk" facts strip for the
 * setter Operations console. Pure read-only display of fields ALREADY on the
 * already-loaded deal/customer (never re-fetches):
 *
 *   · Existing MCA positions / stack   — deal.existing_positions + existing_funders
 *                                        (mapped on by the UCC→merchant automap)
 *   · Monthly revenue                  — customer.monthly_revenue (or annual/12 estimate)
 *   · Time in business                 — customer.time_in_business (MONTHS)
 *   · The ask                          — deal.amount_requested
 *   · Lead source                      — deal.lead_source (canonical sourceMeta chip)
 *   · Last contact / attempt           — deal.spoke_at / contacted_at / last_attempt_at
 *
 * Every field is independently optional — a UCC lead has positions but no ask, a
 * Google lead has an ask but no positions. Missing values render a muted "—",
 * never a broken row. Nothing here mutates, so onRefresh is part of the standard
 * setter-panel signature but unused.
 */

const POSITION_SOURCE_LABEL: Record<string, string> = {
  manual: "entered manually",
  application: "from application",
  bank_statements: "verified (bank statements)",
  ucc: "from UCC",
};

/** MONTHS → "18 mo · ~1.5 yr" (years only once it's worth saying). */
function tibLabel(months: number): string {
  const base = `${months} mo`;
  if (months >= 12) {
    const yrs = months / 12;
    return `${base} · ~${yrs % 1 === 0 ? yrs : yrs.toFixed(1)} yr`;
  }
  return base;
}

function Fact({
  icon,
  label,
  children,
  star,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
  star?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
        <span className="text-gray-400 dark:text-gray-500">{icon}</span>
        {label}
        {star && <span title="A metric that matters">⭐</span>}
      </div>
      <div className="mt-0.5 text-sm text-gray-900 dark:text-white">{children}</div>
    </div>
  );
}

const missing = <span className="text-gray-400 dark:text-gray-500">—</span>;

export default function SetterSnapshot({
  deal,
}: {
  deal: DealWithCustomer;
  onRefresh: () => void;
}) {
  const c = deal.customer;

  // ── Existing stack (UCC→merchant automap) ──
  const positions = deal.existing_positions ?? null;
  const funders = (deal.existing_funders ?? []).filter(Boolean);
  const posSource = deal.existing_positions_source ?? null;
  const posSourceLabel = posSource ? POSITION_SOURCE_LABEL[posSource] ?? posSource : null;
  const hasStack = positions != null || funders.length > 0;

  // ── Revenue — real monthly, else annual/12 (labelled an estimate). ──
  const monthly = c?.monthly_revenue != null && Number(c.monthly_revenue) > 0 ? Number(c.monthly_revenue) : null;
  const annual = c?.annual_revenue != null && Number(c.annual_revenue) > 0 ? Number(c.annual_revenue) : null;
  const monthlyFromAnnual = monthly == null && annual != null ? Math.round(annual / 12) : null;

  const tib = c?.time_in_business != null && Number(c.time_in_business) > 0 ? Number(c.time_in_business) : null;
  const ask = deal.amount_requested != null && Number(deal.amount_requested) > 0 ? Number(deal.amount_requested) : null;

  const src = sourceMeta(deal.lead_source);

  // ── Last touch — derive from the deal's own call telemetry. ──
  const attempts = deal.contact_attempts ?? 0;
  const lastTouch = deal.last_attempt_at ?? deal.contacted_at ?? deal.first_attempt_at ?? null;

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Before you dial
        </h3>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${SOURCE_TONE_CLASS[src.tone]}`}
        >
          <TagIcon className="h-3 w-3" />
          {src.label}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        {/* Existing stack — the single most important thing a setter should know. */}
        <div className="col-span-2 sm:col-span-3">
          <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
            <RectangleStackIcon className="h-3.5 w-3.5" />
            Existing MCA positions
            <span title="A metric that matters">⭐</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm">
            {hasStack ? (
              <>
                <span className="font-bold text-gray-900 dark:text-white">
                  {positions != null ? `${positions} position${positions === 1 ? "" : "s"}` : "Has positions"}
                </span>
                {funders.map((f) => (
                  <span
                    key={f}
                    className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-800 dark:bg-violet-900/30 dark:text-violet-200"
                  >
                    {f}
                  </span>
                ))}
                {posSourceLabel && (
                  <span className="text-[11px] text-gray-400 dark:text-gray-500">· {posSourceLabel}</span>
                )}
              </>
            ) : (
              <span className="text-gray-400 dark:text-gray-500">No known positions on file</span>
            )}
          </div>
        </div>

        <Fact icon={<CurrencyDollarIcon className="h-3.5 w-3.5" />} label="Monthly revenue" star>
          {monthly != null ? (
            <span className="font-bold">${monthly.toLocaleString()}/mo</span>
          ) : monthlyFromAnnual != null ? (
            <span>
              <span className="font-bold">~${monthlyFromAnnual.toLocaleString()}/mo</span>{" "}
              <span className="text-[11px] text-gray-400 dark:text-gray-500">est. (annual ÷ 12)</span>
            </span>
          ) : (
            missing
          )}
        </Fact>

        <Fact icon={<CalendarDaysIcon className="h-3.5 w-3.5" />} label="Time in business">
          {tib != null ? tibLabel(tib) : missing}
        </Fact>

        <Fact icon={<BanknotesIcon className="h-3.5 w-3.5" />} label="Requested">
          {ask != null ? <span className="font-bold">${ask.toLocaleString()}</span> : missing}
        </Fact>

        <Fact icon={<ClockIcon className="h-3.5 w-3.5" />} label="Last contact">
          {deal.spoke_at ? (
            <span>
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">Spoke ✓</span>{" "}
              <span className="text-[11px] text-gray-500 dark:text-gray-400">{dateTimeET(deal.spoke_at)}</span>
            </span>
          ) : lastTouch ? (
            <span>
              {dateTimeET(lastTouch)}
              {attempts > 0 && (
                <span className="text-[11px] text-gray-400 dark:text-gray-500">
                  {" "}
                  · {attempts} attempt{attempts === 1 ? "" : "s"}
                </span>
              )}
            </span>
          ) : (
            <span className="text-gray-400 dark:text-gray-500">Never contacted</span>
          )}
        </Fact>

        {c?.industry && (
          <Fact icon={<TagIcon className="h-3.5 w-3.5" />} label="Industry">
            {c.industry}
          </Fact>
        )}
      </div>
    </div>
  );
}
