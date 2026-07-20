import {
  AcademicCapIcon,
  ChatBubbleBottomCenterTextIcon,
  ArrowPathRoundedSquareIcon,
  DocumentMagnifyingGlassIcon,
  ShieldCheckIcon,
  ArrowTrendingUpIcon,
  NoSymbolIcon,
  ArrowRightCircleIcon,
} from "@heroicons/react/24/outline";

/* ------------------------------------------------------------------ */
/* Strategy — the sales doctrine for the floor's most common call:    */
/* a live-transfer merchant showing $15–20K/mo in real deposits who   */
/* asks for $50–100K. Staff-facing, direct voice.                     */
/* ------------------------------------------------------------------ */

interface Doctrine {
  n: number;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  why: React.ReactNode;
  /** The exact words to say, verbatim. */
  say: React.ReactNode;
  never: React.ReactNode;
}

const DOCTRINE: Doctrine[] = [
  {
    n: 1,
    icon: ChatBubbleBottomCenterTextIcon,
    title: "Anchor on the call — before the statements",
    why: (
      <>
        Ask <strong className="font-semibold text-gray-900 dark:text-white">
        “what are your average monthly deposits?”</strong> early, then set the ceiling in the same
        breath. That one sentence kills the <strong className="font-semibold text-gray-900 dark:text-white">$100K</strong>{" "}
        fantasy in minute two instead of day three — and filters the pipeline for free, before you
        spend an hour packaging a deal that was never going to fund.
      </>
    ),
    say: (
      <>
        “So we’re on the same page — funders typically approve{" "}
        <strong className="font-semibold text-white">70–100% of one month’s revenue</strong> on a
        first position. On your numbers that’s a starting <em>advance</em> in the{" "}
        <strong className="font-semibold text-white">$12–15K</strong> range, not the $100K. Here’s
        how we get you to the bigger number.”
      </>
    ),
    never: (
      <>
        Never let a merchant hold onto a number you already know is impossible. Silence now = a
        blown-up call on offer day.
      </>
    ),
  },
  {
    n: 2,
    icon: ArrowPathRoundedSquareIcon,
    title: "Sell the renewal ladder, not the number",
    why: (
      <>
        You can’t get them <strong className="font-semibold text-gray-900 dark:text-white">$100K</strong>{" "}
        today, so sell the <em>path</em> to it. Funders pay more to merchants with a repayment history
        than to strangers — so every renewal is a bigger advance{" "}
        <strong className="font-semibold text-gray-900 dark:text-white">and</strong> another commission
        with <strong className="font-semibold text-gray-900 dark:text-white">zero lead cost</strong>.
        Our micro-funders (<strong className="font-semibold text-gray-900 dark:text-white">Bitty
        Advance</strong>, <strong className="font-semibold text-gray-900 dark:text-white">Greenbox</strong>)
        are literally built on this flywheel.
      </>
    ),
    say: (
      <>
        “We can’t get you $100K today — here’s the path.{" "}
        <strong className="font-semibold text-white">$12–15K now</strong>, you build a clean payment
        history, renew at <strong className="font-semibold text-white">50% paydown in 60–90 days for
        ~$25K</strong>, then <strong className="font-semibold text-white">$40K+</strong> after that.
        Funders reward the history. Start the ladder and the big number comes to you.”
      </>
    ),
    never: (
      <>
        Never quote a stretch first position to “win the deal.” An over-sized advance defaults, kills
        the renewal, and torches the merchant for everyone.
      </>
    ),
  },
  {
    n: 3,
    icon: DocumentMagnifyingGlassIcon,
    title: "Get statements before you quote anything",
    why: (
      <>
        Self-reported revenue in this segment runs{" "}
        <strong className="font-semibold text-gray-900 dark:text-white">2–3× inflated</strong>. No
        number leaves your mouth until deposits are <strong className="font-semibold text-gray-900 dark:text-white">verified</strong> —
        Plaid link or statements in hand. The <strong className="font-semibold text-gray-900 dark:text-white">Documents</strong>{" "}
        step collects them; the <strong className="font-semibold text-gray-900 dark:text-white">AI
        Underwriter</strong> reads them and prints the true monthly revenue after padding is stripped.
        That readout — not the merchant’s memory — is your quote basis.
      </>
    ),
    say: (
      <>
        “I want to get you the most you actually qualify for, so before I quote anything I need to see
        the real deposits. <strong className="font-semibold text-white">Send me the last 3 months of
        bank statements</strong> or connect the account through the secure link — takes 60 seconds.
        Once I see the numbers I’ll tell you exactly what the funders will do.”
      </>
    ),
    never: (
      <>
        Never quote off a stated number. “You said $18K, so I can do…” is how you promise money the
        statements won’t support.
      </>
    ),
  },
  {
    n: 4,
    icon: ShieldCheckIcon,
    title: "Never pass inflated numbers upstream",
    why: (
      <>
        Funders verify deposits anyway — a pattern of inflated submissions gets an{" "}
        <strong className="font-semibold text-gray-900 dark:text-white">ISO agreement flagged or
        killed</strong>. Submission quality is our reputation with underwriters: clean packages get{" "}
        <strong className="font-semibold text-gray-900 dark:text-white">faster approvals and better
        pricing</strong>. Our AI Underwriter runs <strong className="font-semibold text-gray-900 dark:text-white">before</strong>{" "}
        submission and shows the true number — the true number is what goes on the package.
      </>
    ),
    say: (
      <>
        (Internal — to yourself and to ops.) “The verified number is{" "}
        <strong className="font-semibold text-white">$16K/mo</strong>, so that’s what the package
        says. If the merchant wants more, that’s the renewal ladder — not a padded submission.”
      </>
    ),
    never: (
      <>
        <u className="decoration-rose-400 decoration-2 underline-offset-2">Never round up the
        revenue, hide positions, or ‘help’ a stip to fit a box.</u> One flagged package can cost us a
        funder relationship for good.
      </>
    ),
  },
];

interface Lane {
  icon: React.ComponentType<{ className?: string }>;
  tone: "green" | "blue" | "amber";
  when: React.ReactNode;
  land: React.ReactNode;
  detail: React.ReactNode;
}

const LANES: Lane[] = [
  {
    icon: ArrowTrendingUpIcon,
    tone: "green",
    when: (
      <>Verified <strong className="font-semibold">$15–20K/mo</strong> in real deposits</>
    ),
    land: (
      <>First position <strong className="font-semibold">$8–15K</strong> → then the renewal ladder</>
    ),
    detail: (
      <>
        Fits our micro-funders. <strong className="font-semibold">Bitty Advance</strong> box:{" "}
        <strong className="font-semibold">$2K–$250K</strong>, min <strong className="font-semibold">$5K</strong>{" "}
        revenue / <strong className="font-semibold">6mo</strong> TIB / <strong className="font-semibold">500</strong>{" "}
        FICO. <strong className="font-semibold">Greenbox</strong> starts around{" "}
        <strong className="font-semibold">$7.5K</strong> monthly revenue.
      </>
    ),
  },
  {
    icon: ArrowRightCircleIcon,
    tone: "blue",
    when: (
      <>Genuinely needs <strong className="font-semibold">$100K+</strong> for a real asset</>
    ),
    land: <>Equipment financing or SBA referral path</>,
    detail: (
      <>
        The deposits will never support a $100K advance — but a{" "}
        <strong className="font-semibold">term loan against equipment</strong> or an{" "}
        <strong className="font-semibold">SBA</strong> product might. Longer timeline, bigger
        commission. Route it, don’t force it into an MCA box.
      </>
    ),
  },
  {
    icon: NoSymbolIcon,
    tone: "amber",
    when: <>Drowning in existing positions / stacked</>,
    land: <>Debt-relief (VCF) channel</>,
    detail: (
      <>
        If the statements show <strong className="font-semibold">3+ open positions</strong> eating the
        deposits, more capital makes it worse. Move them to the{" "}
        <strong className="font-semibold">debt-relief</strong> flow — that’s still a funded deal and
        the honest one.
      </>
    ),
  },
];

const LANE_TONE: Record<Lane["tone"], string> = {
  green:
    "border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-900/15",
  blue: "border-blue-200 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-900/15",
  amber: "border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-900/15",
};
const LANE_ICON_TONE: Record<Lane["tone"], string> = {
  green: "text-emerald-600 dark:text-emerald-400",
  blue: "text-blue-600 dark:text-blue-400",
  amber: "text-amber-600 dark:text-amber-400",
};

export default function StrategyPage() {
  return (
    <div className="p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-start gap-3">
        <AcademicCapIcon className="w-8 h-8 shrink-0 text-ocean-blue" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Strategy</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            The doctrine for the most common call on the floor: a live-transfer merchant showing{" "}
            <strong className="font-semibold text-gray-700 dark:text-gray-300">$15–20K/mo</strong> in
            real deposits who asks for <strong className="font-semibold text-gray-700 dark:text-gray-300">$50–100K</strong>.
            Anchor low, sell the ladder, quote off verified numbers, submit clean.
          </p>
        </div>
      </div>

      {/* The one-line spine */}
      <div className="mt-5 flex flex-wrap gap-2">
        {[
          "Anchor before statements",
          "Sell the ladder, not the number",
          "Verify before you quote",
          "Submit clean",
        ].map((chip, i) => (
          <span
            key={chip}
            className="inline-flex items-center gap-1.5 rounded-full bg-ocean-blue/10 text-ocean-blue px-3 py-1 text-xs font-semibold"
          >
            <span className="opacity-60">{i + 1}</span>
            {chip}
          </span>
        ))}
      </div>

      {/* Doctrine cards */}
      <div className="mt-6 space-y-5">
        {DOCTRINE.map((d) => {
          const Icon = d.icon;
          return (
            <section
              key={d.n}
              className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5"
            >
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ocean-blue/10 text-ocean-blue font-bold">
                  {d.n}
                </span>
                <div className="min-w-0">
                  <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                    <Icon className="w-5 h-5 text-ocean-blue shrink-0" />
                    {d.title}
                  </h2>
                </div>
              </div>

              {/* Why */}
              <div className="mt-3 pl-12">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">
                  Why
                </p>
                <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{d.why}</p>
              </div>

              {/* Say this — the script, visually distinct */}
              <div className="mt-4 pl-12">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-mint-green mb-1">
                  Say this
                </p>
                <blockquote className="rounded-lg border-l-4 border-mint-green bg-mint-green/5 dark:bg-mint-green/10 px-4 py-3 text-sm leading-relaxed text-gray-800 dark:text-gray-100">
                  {d.say}
                </blockquote>
              </div>

              {/* Never */}
              <div className="mt-4 pl-12">
                <div className="flex items-start gap-2 rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 px-3 py-2">
                  <NoSymbolIcon className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                  <p className="text-sm text-rose-800 dark:text-rose-200 leading-relaxed">
                    <span className="font-semibold">Never:</span> {d.never}
                  </p>
                </div>
              </div>
            </section>
          );
        })}
      </div>

      {/* Where these deals land */}
      <section className="mt-8">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">Where these deals land</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 mb-4">
          Every call has somewhere profitable to go. Read the verified numbers, then route.
        </p>
        <div className="grid gap-3 md:grid-cols-3">
          {LANES.map((lane, i) => {
            const Icon = lane.icon;
            return (
              <div
                key={i}
                className={`rounded-xl border p-4 flex flex-col ${LANE_TONE[lane.tone]}`}
              >
                <Icon className={`w-6 h-6 ${LANE_ICON_TONE[lane.tone]}`} />
                <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  When
                </p>
                <p className="text-sm font-medium text-gray-900 dark:text-white">{lane.when}</p>
                <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Lands at
                </p>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{lane.land}</p>
                <p className="mt-3 text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                  {lane.detail}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Compliance footer — internal, but keep the language honest */}
      <p className="mt-8 text-xs text-gray-400 dark:text-gray-500 leading-relaxed border-t border-gray-100 dark:border-gray-700 pt-4">
        Language note: an MCA is a <em>purchase of future receivables</em>, not a loan — say
        “advance,” “funding,” or “capital,” and quote a <em>factor rate</em>, never an interest rate.
        Term loans, SBA, and equipment financing are actual loans and use standard lending terms.
      </p>
    </div>
  );
}
