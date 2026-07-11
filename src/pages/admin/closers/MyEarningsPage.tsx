import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  BanknotesIcon,
  CheckBadgeIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  ArrowTrendingUpIcon,
  ArrowUturnLeftIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/outline";
import { useUserProfile } from "../../../context/UserProfileContext";
import {
  getMyCloserRecord,
  getMyCommissions,
  getMyProjectedPipeline,
  splitForDeal,
  type ProjectedCommission,
} from "../../../services/commissionService";
import type { Closer, CommissionWithDetails, PaymentStatus } from "../../../types/commissions";
import { DEAL_STATUS_CONFIG, type DealStatus } from "../../../types/deals";

const fmt = (v: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(v || 0);

const PAID_STATUSES: PaymentStatus[] = ["closer_paid", "completed"];

/** Which bucket a commission row lands in on this page. */
type Bucket = "paid" | "approved" | "pending" | "on_hold" | "clawback";

function bucketOf(status: PaymentStatus): Bucket {
  if (PAID_STATUSES.includes(status)) return "paid";
  if (status === "approved") return "approved";
  if (status === "on_hold") return "on_hold";
  if (status === "clawback") return "clawback";
  // pending + funder_paid (funder has paid us, closer payout still queued)
  return "pending";
}

const BUCKET_META: Record<Bucket, { label: string; blurb: string; chip: string }> = {
  paid: {
    label: "Paid to you",
    blurb: "Money already sent.",
    chip: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  },
  approved: {
    label: "Approved — awaiting payout",
    blurb: "Signed off. Payout goes out within 5 business days of the funder paying us.",
    chip: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300",
  },
  pending: {
    label: "Pending approval",
    blurb: "Deal funded — commission is booked and waiting on sign-off.",
    chip: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  },
  on_hold: {
    label: "On hold",
    blurb: "Payout paused. Reason is shown on the row.",
    chip: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  },
  clawback: {
    label: "Clawback",
    blurb: "Commission reversed (merchant defaulted early or the deal unwound).",
    chip: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
  },
};

/** The math line — the whole point of this page. */
function MathLine({
  base,
  points,
  pool,
  split,
  payout,
  projected = false,
}: {
  base: number;
  points: number;
  pool: number;
  split: number;
  payout: number;
  projected?: boolean;
}) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 font-mono text-xs text-gray-600 dark:text-gray-400">
      <span className="font-bold text-gray-900 dark:text-gray-100">{fmt(base)}</span>
      <span>×</span>
      <span className="rounded bg-[#007EA7]/10 px-1.5 py-0.5 font-semibold text-[#007EA7] dark:bg-[#007EA7]/20 dark:text-sky-300">
        {points} pts
      </span>
      <span>=</span>
      <span className="font-bold text-gray-900 dark:text-gray-100">{fmt(pool)} pool</span>
      <span>×</span>
      <span className="rounded bg-[#00A896]/10 px-1.5 py-0.5 font-semibold text-[#00786B] dark:bg-[#00A896]/20 dark:text-[#00D49D]">
        {split}% your split
      </span>
      <span>=</span>
      <span
        className={`font-bold ${projected ? "text-[#007EA7] dark:text-sky-300" : "text-[#00786B] dark:text-[#00D49D]"}`}
      >
        {fmt(payout)} to you
      </span>
    </div>
  );
}

function StatTile({
  label,
  value,
  sub,
  icon: Icon,
  accent,
  starred = false,
}: {
  label: string;
  value: string;
  sub: string;
  icon: typeof BanknotesIcon;
  accent: string;
  starred?: boolean;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {starred ? "⭐ " : ""}
          {label}
        </span>
        <Icon className="h-5 w-5" style={{ color: accent }} />
      </div>
      <div className="mt-2 text-2xl font-bold" style={{ color: accent }}>
        {value}
      </div>
      <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{sub}</div>
    </div>
  );
}

export default function MyEarningsPage() {
  const { profile, effectiveUserId, isAdmin, isSuperAdmin } = useUserProfile();
  const userId = effectiveUserId || profile?.id || null;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [closer, setCloser] = useState<Closer | null>(null);
  const [commissions, setCommissions] = useState<CommissionWithDetails[]>([]);
  const [projected, setProjected] = useState<ProjectedCommission[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!userId) return;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const rec = await getMyCloserRecord(userId);
        if (cancelled) return;
        setCloser(rec);

        if (rec) {
          const [comms, pipeline] = await Promise.all([
            getMyCommissions(rec.id),
            getMyProjectedPipeline(rec, userId),
          ]);
          if (cancelled) return;
          setCommissions(comms);
          setProjected(pipeline);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load your earnings.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const totals = useMemo(() => {
    const sumOf = (b: Bucket) =>
      commissions
        .filter((c) => bucketOf(c.payment_status) === b)
        .reduce((s, c) => s + (Number(c.closer_amount) || 0), 0);

    return {
      paid: sumOf("paid"),
      approved: sumOf("approved"),
      pending: sumOf("pending"),
      onHold: sumOf("on_hold"),
      clawback: commissions
        .filter((c) => c.payment_status === "clawback")
        .reduce((s, c) => s + (Number(c.clawback_amount) || 0), 0),
      projected: projected.reduce((s, p) => s + p.projectedPayout, 0),
    };
  }, [commissions, projected]);

  const grouped = useMemo(() => {
    const g: Record<Bucket, CommissionWithDetails[]> = {
      paid: [],
      approved: [],
      pending: [],
      on_hold: [],
      clawback: [],
    };
    for (const c of commissions) g[bucketOf(c.payment_status)].push(c);
    return g;
  }, [commissions]);

  if (loading) {
    return (
      <div className="p-6">
        <div className="h-8 w-56 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
          ))}
        </div>
      </div>
    );
  }

  // No closer profile — friendly redirect for admins/owners.
  if (!closer) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">My Earnings</h1>
        <div className="mt-6 max-w-2xl rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <BanknotesIcon className="mx-auto h-10 w-10 text-gray-400" />
          <h2 className="mt-3 text-lg font-bold text-gray-900 dark:text-white">
            You don't have a closer profile
          </h2>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            This page shows a single closer's own commissions. Your account isn't linked to a closer
            record, so there's nothing to scope it to.
          </p>
          {(isAdmin || isSuperAdmin) && (
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Link
                to="/admin/commissions"
                className="rounded-lg bg-[#00A896] px-4 py-2 text-sm font-semibold text-white hover:bg-[#00897b]"
              >
                Open Commissions (full company view)
              </Link>
              <Link
                to="/admin/closers"
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                Manage closers
              </Link>
            </div>
          )}
        </div>
      </div>
    );
  }

  const hasAnything = commissions.length > 0 || projected.length > 0;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">My Earnings</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Every dollar you've made and every dollar still on the table —{" "}
            <span className="font-semibold text-gray-900 dark:text-gray-200">
              {closer.first_name} {closer.last_name}
            </span>
            . Only your deals appear here.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5 text-xs">
          <span className="rounded-full bg-[#00A896]/10 px-2.5 py-1 font-semibold text-[#00786B] dark:bg-[#00A896]/20 dark:text-[#00D49D]">
            Company leads · {Number(closer.company_lead_split)}%
          </span>
          <span className="rounded-full bg-[#007EA7]/10 px-2.5 py-1 font-semibold text-[#007EA7] dark:bg-[#007EA7]/20 dark:text-sky-300">
            Self-gen · {Number(closer.self_gen_split)}%
          </span>
          <span className="rounded-full bg-violet-100 px-2.5 py-1 font-semibold text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
            Renewals · {Number(closer.renewal_split)}%
          </span>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Headline totals */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile
          label="Paid to date"
          value={fmt(totals.paid)}
          sub={`${grouped.paid.length} deal${grouped.paid.length === 1 ? "" : "s"} cashed`}
          icon={BanknotesIcon}
          accent="#00A896"
          starred
        />
        <StatTile
          label="Approved"
          value={fmt(totals.approved)}
          sub="Signed off — payout queued"
          icon={CheckBadgeIcon}
          accent="#6366F1"
        />
        <StatTile
          label="Pending"
          value={fmt(totals.pending)}
          sub="Booked, awaiting approval"
          icon={ClockIcon}
          accent="#D97706"
        />
        <StatTile
          label="On hold"
          value={fmt(totals.onHold)}
          sub={grouped.on_hold.length ? "Reason on the row" : "Nothing held up"}
          icon={ExclamationTriangleIcon}
          accent="#DC2626"
        />
        <StatTile
          label="On the table"
          value={fmt(totals.projected)}
          sub={`${projected.length} open deal${projected.length === 1 ? "" : "s"} · projection`}
          icon={ArrowTrendingUpIcon}
          accent="#007EA7"
          starred
        />
      </div>

      {!hasAnything && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center dark:border-gray-600 dark:bg-gray-800">
          <ArrowTrendingUpIcon className="mx-auto h-10 w-10 text-gray-400" />
          <h2 className="mt-3 text-lg font-bold text-gray-900 dark:text-white">
            Nothing on the board yet
          </h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-gray-600 dark:text-gray-400">
            The moment a deal is assigned to you, its projected payout shows up here. When it funds,
            the commission moves to <strong>Closed / earned</strong>. Your math:{" "}
            <strong>$50,000 × 8 pts = $4,000 pool × {Number(closer.company_lead_split)}% = {fmt(
              (50000 * 0.08 * Number(closer.company_lead_split)) / 100,
            )} to you</strong> on a typical company lead.
          </p>
          <Link
            to="/admin/playbooks"
            className="mt-4 inline-block rounded-lg bg-[#00A896] px-4 py-2 text-sm font-semibold text-white hover:bg-[#00897b]"
          >
            Go work the playbook
          </Link>
        </div>
      )}

      {/* ---------------- On the table (projection) ---------------- */}
      <section className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 p-4 dark:border-gray-700">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900 dark:text-white">
              <ArrowTrendingUpIcon className="h-5 w-5 text-[#007EA7]" />
              On the table
              <span className="rounded-full bg-[#007EA7]/10 px-2 py-0.5 text-xs font-semibold text-[#007EA7] dark:bg-[#007EA7]/20 dark:text-sky-300">
                PROJECTION
              </span>
            </h2>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Your open deals, priced off the <strong>amount requested</strong>. Nothing here is
              earned until the deal funds and the funder pays.
            </p>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Projected to you
            </div>
            <div className="text-xl font-bold text-[#007EA7] dark:text-sky-300">
              {fmt(totals.projected)}
            </div>
          </div>
        </div>

        {projected.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-500 dark:text-gray-400">
            <InformationCircleIcon className="mx-auto mb-2 h-6 w-6 text-gray-400" />
            No open deals assigned to you right now. Anything you're working gets priced here
            automatically.
          </div>
        ) : (
          <ul className="divide-y divide-gray-200 dark:divide-gray-700">
            {projected.map((p) => {
              const cfg = DEAL_STATUS_CONFIG[p.status as DealStatus];
              return (
                <li key={p.dealId} className="p-4 hover:bg-gray-50 dark:hover:bg-gray-700/40">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          to={`/admin/deals/${p.dealId}`}
                          className="font-semibold text-gray-900 hover:underline dark:text-white"
                        >
                          {p.businessName || p.dealNumber || "Untitled deal"}
                        </Link>
                        {cfg && (
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${cfg.bgColor} ${cfg.color}`}
                          >
                            {cfg.label}
                          </span>
                        )}
                        {p.isRenewal && (
                          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                            renewal · 6 pts
                          </span>
                        )}
                        {p.amountRequested === 0 && (
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                            no amount yet
                          </span>
                        )}
                      </div>
                      {p.amountRequested > 0 ? (
                        <MathLine
                          base={p.amountRequested}
                          points={p.points}
                          pool={p.projectedGross}
                          split={p.splitPercentage}
                          payout={p.projectedPayout}
                          projected
                        />
                      ) : (
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          Add the amount requested on the deal and your projection appears here.
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-[#007EA7] dark:text-sky-300">
                        {fmt(p.projectedPayout)}
                      </div>
                      <div className="text-[11px] uppercase tracking-wide text-gray-400">
                        projected
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ---------------- Closed / earned ---------------- */}
      <section className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 p-4 dark:border-gray-700">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900 dark:text-white">
              <BanknotesIcon className="h-5 w-5 text-[#00A896]" />
              Closed / earned
            </h2>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Real commissions off <strong>funded</strong> deals, priced on the amount actually
              funded.
            </p>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Paid to date
            </div>
            <div className="text-xl font-bold text-[#00786B] dark:text-[#00D49D]">
              {fmt(totals.paid)}
            </div>
          </div>
        </div>

        {commissions.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-500 dark:text-gray-400">
            <InformationCircleIcon className="mx-auto mb-2 h-6 w-6 text-gray-400" />
            No commissions booked yet. A commission row is created for you the moment one of your
            deals is marked <strong>Funded</strong> — then it walks{" "}
            <span className="font-semibold">pending → approved → paid</span> right on this page.
          </div>
        ) : (
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {(["paid", "approved", "pending", "on_hold", "clawback"] as Bucket[]).map((b) => {
              const rows = grouped[b];
              if (rows.length === 0) return null;
              const meta = BUCKET_META[b];
              const bucketTotal = rows.reduce(
                (s, c) =>
                  s + (b === "clawback" ? Number(c.clawback_amount) || 0 : Number(c.closer_amount) || 0),
                0,
              );

              return (
                <div key={b} className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${meta.chip}`}>
                        {meta.label} · {rows.length}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">{meta.blurb}</span>
                    </div>
                    <span className="text-sm font-bold text-gray-900 dark:text-gray-100">
                      {fmt(bucketTotal)}
                    </span>
                  </div>

                  <ul className="mt-3 space-y-2">
                    {rows.map((c) => {
                      const funded = Number(c.deal?.amount_funded) || 0;
                      const pool = Number(c.gross_commission) || 0;
                      const points = Number(c.commission_points) || 0;
                      const split = Number(c.closer_split_percentage) || 0;
                      const payout = Number(c.closer_amount) || 0;
                      const isClawback = c.payment_status === "clawback";

                      return (
                        <li
                          key={c.id}
                          className="rounded-lg border border-gray-200 p-3 dark:border-gray-700"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <Link
                                  to={`/admin/deals/${c.deal_id}`}
                                  className="font-semibold text-gray-900 hover:underline dark:text-white"
                                >
                                  {c.deal?.deal_number || "Deal"}
                                </Link>
                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                  {new Date(c.created_at).toLocaleDateString()}
                                </span>
                                {c.closer_paid_at && (
                                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                                    paid {new Date(c.closer_paid_at).toLocaleDateString()}
                                  </span>
                                )}
                              </div>
                              <MathLine
                                base={funded || pool * (100 / (points || 8))}
                                points={points}
                                pool={pool}
                                split={split}
                                payout={payout}
                              />
                              {c.payment_status === "on_hold" && c.hold_reason && (
                                <p className="mt-2 text-xs font-semibold text-red-700 dark:text-red-300">
                                  <ExclamationTriangleIcon className="mr-1 inline h-4 w-4" />
                                  Hold reason: <u>{c.hold_reason}</u>
                                </p>
                              )}
                              {isClawback && c.clawback_reason && (
                                <p className="mt-2 text-xs font-semibold text-rose-700 dark:text-rose-300">
                                  <ArrowUturnLeftIcon className="mr-1 inline h-4 w-4" />
                                  Clawback: {c.clawback_reason}
                                </p>
                              )}
                            </div>
                            <div className="text-right">
                              <div
                                className={`text-lg font-bold ${
                                  isClawback
                                    ? "text-rose-600 dark:text-rose-400"
                                    : "text-[#00786B] dark:text-[#00D49D]"
                                }`}
                              >
                                {isClawback
                                  ? `-${fmt(Number(c.clawback_amount) || 0)}`
                                  : fmt(payout)}
                              </div>
                              <div className="text-[11px] uppercase tracking-wide text-gray-400">
                                {isClawback ? "reversed" : "your cut"}
                              </div>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* How the math works — reference, folds away */}
      <details className="rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <summary className="cursor-pointer p-4 text-sm font-semibold text-gray-900 dark:text-white">
          How your money is calculated
        </summary>
        <div className="space-y-2 border-t border-gray-200 p-4 text-sm text-gray-600 dark:border-gray-700 dark:text-gray-400">
          <p>
            <strong>New deal:</strong> funded amount × <strong>8 points</strong> = the commission
            pool the funder pays Momentum. Your split comes out of that pool.
          </p>
          <p>
            <strong>Renewal:</strong> funded amount × <strong>6 points</strong>, then your renewal
            split.
          </p>
          <p>
            <strong>Your splits:</strong> company lead{" "}
            <strong>{Number(closer.company_lead_split)}%</strong> · self-generated{" "}
            <strong>{Number(closer.self_gen_split)}%</strong> · renewal{" "}
            <strong>{Number(closer.renewal_split)}%</strong>. Example on a company lead:{" "}
            <strong>
              $50,000 × 8 pts = $4,000 pool × {Number(closer.company_lead_split)}% ={" "}
              {fmt(
                (50000 *
                  0.08 *
                  splitForDeal(closer, { isRenewal: false, leadSource: "company" })
                    .splitPercentage) /
                  100,
              )}{" "}
              to you
            </strong>
            .
          </p>
          <p>
            <strong>Payout timing:</strong> commissions are paid{" "}
            <strong>5 business days after the funder pays Momentum</strong>. Questions on any row go
            to the owner — this page is read-only.
          </p>
        </div>
      </details>
    </div>
  );
}
