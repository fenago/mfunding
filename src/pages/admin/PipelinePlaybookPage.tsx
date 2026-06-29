import { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MapIcon,
  PlayIcon,
  PauseIcon,
  ArrowPathIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  UserIcon,
  ArrowRightCircleIcon,
  SparklesIcon,
  ExclamationTriangleIcon,
  ArrowUturnLeftIcon,
  TrophyIcon,
  ArrowsRightLeftIcon,
} from '@heroicons/react/24/outline';
import PipelineFlow from '../../components/shared/PipelineFlow';
import { PIPELINES, type PipelineDef } from '../../data/pipelines';

/* ------------------------------------------------------------------ */
/* Owner taxonomy — who advances the deal at each stage               */
/* ------------------------------------------------------------------ */
type OwnerKind = 'closer' | 'va' | 'ops' | 'automation' | 'merchant';

const OWNER_META: Record<OwnerKind, { label: string; color: string; bg: string; border: string }> = {
  closer: { label: 'Closer', color: '#9333EA', bg: 'rgba(147,51,234,0.10)', border: 'rgba(147,51,234,0.30)' },
  va: { label: 'VA', color: '#007EA7', bg: 'rgba(0,126,167,0.10)', border: 'rgba(0,126,167,0.30)' },
  ops: { label: 'Ops', color: '#0A2342', bg: 'rgba(10,35,66,0.08)', border: 'rgba(10,35,66,0.25)' },
  automation: { label: 'Automation', color: '#00A896', bg: 'rgba(0,168,150,0.12)', border: 'rgba(0,168,150,0.30)' },
  merchant: { label: 'Merchant', color: '#F59E0B', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.30)' },
};

interface StageDetail {
  whatHappens: string;
  owners: OwnerKind[];
  sla: string;
  advances: string;
  /** Optional emphasized callout shown inside the detail card. */
  callout?: { tone: 'leak' | 'branch' | 'win' | 'recover'; text: string };
  /** GHL workflow that drives this stage (from the build guide). */
  automation?: string;
}

/* ------------------------------------------------------------------ */
/* MCA — 13 stages (keyed to data/pipelines.ts MCA_PIPELINE)          */
/* ------------------------------------------------------------------ */
const MCA_DETAILS: Record<string, StageDetail> = {
  new: {
    whatHappens:
      'Lead enters from a web form, live transfer, or calculator capture. Speed-to-Lead fires instantly: auto-response email (SMS optional), round-robin assignment to the closer pool, and a "call in 5 minutes" task. Missed-call text-back is armed.',
    owners: ['automation', 'closer'],
    sla: 'First touch < 60 sec (transfers) / < 5 min (web). Call task due in 5 minutes.',
    advances: 'Contact replies or an inbound/answered call is logged → moves to Contacted.',
    automation: 'MCA 01 — Speed to Lead',
    callout: { tone: 'branch', text: 'No reply in 2h → tag "no-answer" hands off to the 7-day No-Answer Nurture (Sequence B).' },
  },
  contacted: {
    whatHappens:
      'First live conversation. The closer logs the call, confirms the merchant is the owner, and books the qualification call. The deal is now actively worked by a named human.',
    owners: ['closer'],
    sla: 'Same day as first contact; book qualification immediately.',
    advances: 'Qualification conversation begins → moves to Qualifying.',
    automation: 'MCA 02 — No Answer Nurture (if they went dark)',
    callout: { tone: 'recover', text: 'Goes dark here → breakup sequence → Nurture / Re-engage (recoverable, not dead).' },
  },
  qualifying: {
    whatHappens:
      'BANT-F qualification via a 60-second form: monthly revenue, time in business, funding amount, industry, and # of current advances. Answers map to custom fields. Disqualify below thresholds (<6 mo in business / <$15k/mo revenue / prohibited industry).',
    owners: ['closer', 'automation'],
    sla: 'Qualify on the first call where possible.',
    advances: 'Qualified merchant → moves to Application Sent.',
    automation: 'MCA 03 — Qualifying',
    callout: {
      tone: 'branch',
      text: 'Stacked / distressed (≥2 active MCA positions) → tag "route-to-vcf" sends the deal to the VCF pipeline. "Not right now" → tag "soft-no" → 90-day nurture (Sequence C).',
    },
  },
  application_sent: {
    whatHappens:
      'Closer sends the application link plus the state- and product-specific compliance disclosure. The merchant completes the ~3-minute application; the signed disclosure sets "Disclosure Acknowledged" = true. Reminders at +4h and Day 1.',
    owners: ['closer', 'merchant', 'automation'],
    sla: 'Time-to-submit target < 24 hours.',
    advances: 'Application submitted → moves to Docs Collected.',
    automation: 'MCA 04 — Application + Disclosure',
    callout: { tone: 'recover', text: 'Not completed by Day 3 → Nurture / Re-engage (lost_reason docs_not_provided), still recoverable.' },
  },
  docs_collected: {
    whatHappens:
      'Collect the non-bank stips: signed application, owner\'s photo ID, a voided check, and the credit authorization — all via a secure upload link. A checklist email lists the four items. The VA chases anything missing.',
    owners: ['va', 'merchant', 'automation'],
    sla: 'Reminders Day 0, +4h, Day 1, Day 2.',
    advances: 'All four non-bank stips received → moves to Bank Statements.',
    automation: 'MCA 05 — Docs Collection',
  },
  bank_statements: {
    whatHappens:
      'Collect the 3 most recent business bank statements (or a Plaid bank connection — Plaid is optional, manual upload is the default). This is the single biggest drop-off point, so the 14-day chase (Sequence A) is the highest-priority automation in the system.',
    owners: ['va', 'closer', 'automation', 'merchant'],
    sla: '14-day cadence — Day 0 (x2), Day 1 call+SMS, Day 2, Day 4 call+VM, Day 7 urgency, Day 10 email, Day 14 breakup. Stop the instant statements arrive.',
    advances: 'Statements (or Plaid data) received → moves to Submitted to Funders.',
    automation: 'MCA 06 — Bank Statements (Seq A) ⭐',
    callout: {
      tone: 'leak',
      text: '#1 FUNNEL LEAK. ~50–60% of apps survive this stage. Plaid = 60 seconds vs. days for manual. Day 14 no statements → Nurture / Re-engage (lost_reason docs_not_provided).',
    },
  },
  submitted_to_funder: {
    whatHappens:
      'The deal package (signed app + 3 months statements + stips) is sent to 3–5 funders in parallel. This is driven by the submit-to-funders edge function, not a GHL workflow — it emails each selected funder via GHL and starts a 5-day SLA timer.',
    owners: ['ops', 'automation'],
    sla: '5-day SLA timer; per-funder follow-up at ~4h, Day 1 (+ call underwriter), Day 2.',
    advances: 'ANY funder returns an offer → moves to Offer Received.',
    automation: 'MCA 07 — Submission Orchestrator (submit-to-funders fn)',
    callout: {
      tone: 'branch',
      text: 'ALL funders decline → tag "all-declined" → resubmit to tier-2 / specialty set → route to VCF if stacked → else Nurture / Re-engage.',
    },
  },
  offer_received: {
    whatHappens:
      'Funders respond with terms. Ops/closer collect EVERY offer so they can be compared side-by-side (amount, factor rate, term, daily/weekly payment). Always assemble 2+ options.',
    owners: ['closer', 'ops'],
    sla: 'Assemble the comparison same day the first offer lands.',
    advances: 'Offers ready to show → moves to Offer Presented.',
    automation: 'MCA 08 — Offer Received',
  },
  offer_presented: {
    whatHappens:
      'Closer presents the best 2+ offers via a branded offer link and walks the merchant through the trade-offs. Same-day follow-up task; a 24h nudge if no decision ("I can usually tweak the terms").',
    owners: ['closer'],
    sla: 'Present same day; 24h nudge if undecided. Target 70–80% acceptance.',
    advances: 'Merchant accepts → moves to Offer Accepted.',
    automation: 'MCA 09 — Offer Presented',
    callout: {
      tone: 'branch',
      text: 'Merchant declines → tag "offer-declined" → 45-day rework (Sequence D): objection call → resubmit for better terms → alternatives → breakup → Day-45 re-engage → Nurture (lost_reason merchant_declined).',
    },
  },
  offer_accepted: {
    whatHappens:
      'Merchant chose an offer. The funder agreement is sent for e-signature (native GHL Documents & Contracts). Reminders at +4h, Day 1, Day 2 if unsigned. Ops coordinates funding with the funder.',
    owners: ['closer', 'ops', 'merchant'],
    sla: 'E-sign reminders +4h / Day 1 / Day 2.',
    advances: 'Contract signed AND funder confirms funding → moves to Funded.',
    automation: 'MCA 10 — Offer Accepted',
    callout: {
      tone: 'recover',
      text: 'Funder rescinds / unsigned after Day 3 / final-underwriting decline → tag "funding-failed" → resubmit, or Nurture (lost_reason funding_fell_through).',
    },
  },
  funded: {
    whatHappens:
      'Money is deposited. Opportunity STATUS is set to Won. Day-1 congrats + Google review request + $100-per-funded-referral ask; Day-7 check-in. Commission auto-calculates; renewal reminders are armed off Paydown %.',
    owners: ['automation', 'ops'],
    sla: 'Commission paid within 5 business days after the funder pays Momentum.',
    advances: 'Paydown reaches the first milestone (40%) → moves to Renewal Eligible.',
    automation: 'MCA 11 — Funded → Renewal',
    callout: { tone: 'win', text: 'FUNDED = opportunity status WON. This is the goal state — but it also seeds the renewal pipeline.' },
  },
  renewal_eligible: {
    whatHappens:
      'Paydown-driven renewal triggers fire as our app pushes the Paydown % value: 40% "may qualify for more," 60% call + renewal offer, 75% "best time to renew," 100% direct call. ~45% of merchants take a renewal.',
    owners: ['automation', 'closer'],
    sla: 'Triggers at 40 / 60 / 75 / 100% paydown.',
    advances: 'A renewal application re-enters the pipeline at Application Sent as a NEW deal (tag "renewal").',
    automation: 'MCA 12 — Renewal Triggers',
  },
  nurture: {
    whatHappens:
      'The catch-all for recoverable losses — funder-declined, merchant-declined, or went dark. Kept OPEN. Worked monthly by Sequence F (Mass Reactivation), rotating 3 templates. Excludes anyone with Do Not Contact / DND.',
    owners: ['automation'],
    sla: 'Monthly reactivation blast (1st of month). ~3–5% re-engage.',
    advances: 'Reply YES → moves back to New Lead as a fresh deal.',
    automation: 'MCA 13 — Mass Reactivation',
    callout: {
      tone: 'recover',
      text: 'RECOVERABLE, not dead — the biggest non-funded bucket and a $0-cost volume asset. After ~3 cycles with zero engagement → tag "archived" / status Lost (off the board).',
    },
  },
};

/* ------------------------------------------------------------------ */
/* VCF — 8 stages (keyed to data/pipelines.ts VCF_PIPELINE)           */
/* ------------------------------------------------------------------ */
const VCF_DETAILS: Record<string, StageDetail> = {
  new_distressed: {
    whatHappens:
      'A distressed merchant (often routed from MCA when stacked) enters the debt-relief pipeline. Empathetic intake email (relief tone, no cross-sell, no guarantees) and an urgent specialist call task. This is the moment to build trust.',
    owners: ['automation', 'closer'],
    sla: 'Urgent — same-day specialist call.',
    advances: 'Merchant engages → moves to Hardship Consultation.',
    automation: 'VCF 01 — New Lead (Distressed)',
    callout: { tone: 'recover', text: 'Often the destination of an MCA "route-to-vcf" / "all-declined + stacked" branch.' },
  },
  hardship_consult: {
    whatHappens:
      'Empathetic consultation: understand the hardship, and gather the shape of the problem — number of positions, balances, and daily/weekly debits. A "what to expect" email sets honest expectations.',
    owners: ['closer'],
    sla: 'Booked from intake; consult held promptly.',
    advances: 'Hardship understood → moves to Positions & Balances Analysis.',
    automation: 'VCF 02 — Hardship Consultation',
  },
  positions_analysis: {
    whatHappens:
      'Collect ALL current MCA agreements and bank statements showing the debits, via the VCF upload form. Ops tallies every active position, total balance, and total daily/weekly debit to size the relief.',
    owners: ['va', 'ops', 'merchant', 'automation'],
    sla: 'Reminders until all agreements + statements are in.',
    advances: 'All positions documented → moves to Strategy / Proposal.',
    automation: 'VCF 03 — Positions & Balances Analysis',
    callout: { tone: 'leak', text: 'VCF equivalent of the bank-statement leak — relief can\'t be sized until every agreement is collected. Chase it.' },
  },
  strategy_proposal: {
    whatHappens:
      'Build the relief plan — consolidate / refinance / renegotiate the positions into a single lower payment. A "plan ready" review email invites the merchant to walk through it. No savings or approval guarantees.',
    owners: ['ops', 'closer'],
    sla: 'Proposal built once positions are tallied.',
    advances: 'Merchant agrees to proceed → moves to Agreement Sent.',
    automation: 'VCF 04 — Strategy & Proposal',
  },
  agreement_sent: {
    whatHappens:
      'The engagement agreement is sent for e-signature via native GHL Documents & Contracts. A review-and-sign email guides the merchant.',
    owners: ['closer', 'merchant', 'automation'],
    sla: 'Reminders until signed.',
    advances: 'Engagement signed → moves to Submitted to VCF.',
    automation: 'VCF 05 — Agreement Sent',
  },
  submitted_to_vcf: {
    whatHappens:
      'The package is emailed to Value Capital Funding (partnerprogram@valuecapitalfunding.com). The merchant gets a "file submitted, here\'s what\'s next" reassurance email while VCF underwrites the restructure.',
    owners: ['ops', 'automation'],
    sla: 'Same per-funder follow-up discipline as MCA submissions.',
    advances: 'VCF approves and executes the restructure → moves to Restructure Executed.',
    automation: 'VCF 06 — Submitted to VCF',
  },
  restructure_executed: {
    whatHappens:
      'Positions are consolidated and the merchant\'s payments are restructured. Congrats + Google review + referral-ask email. The crisis is resolved.',
    owners: ['ops', 'automation'],
    sla: 'Confirmation on execution.',
    advances: 'Restructure live → moves to Servicing / Monitoring.',
    automation: 'VCF 07 — Restructure Executed',
    callout: { tone: 'win', text: 'The VCF win state — the merchant\'s daily payments are lowered and consolidated.' },
  },
  servicing: {
    whatHappens:
      'Ongoing support and early-warning monitoring. Check-in emails keep the relationship warm and catch trouble before it recurs — and keep the door open for future funding once the merchant is healthy.',
    owners: ['ops', 'automation'],
    sla: 'Ongoing / scheduled check-ins.',
    advances: 'Terminal servicing state — the relationship is retained for future opportunities.',
    automation: 'VCF 08 — Servicing & Monitoring',
  },
};

/* ------------------------------------------------------------------ */
/* MCA entry differs by lead source — web form vs. live transfer.      */
/* Only the first two stages (New, Contacted) change; the rest of the  */
/* MCA pipeline is identical.                                          */
/* ------------------------------------------------------------------ */
const MCA_WEB_ENTRY: Record<string, StageDetail> = {
  new: {
    whatHappens:
      'A merchant submits the application/quote form on the website. Speed-to-Lead fires instantly: auto-response email (SMS optional), round-robin assignment to the closer pool, and a "call in 5 minutes" task. Missed-call text-back is armed.',
    owners: ['automation', 'closer'],
    sla: 'First touch < 5 minutes. Every minute of delay costs ~10% contact rate on web leads.',
    advances: 'Closer reaches the merchant (call answered or reply) → moves to Contacted.',
    automation: 'MCA 01 — Speed to Lead (Web)',
    callout: { tone: 'branch', text: 'No reply in 2h → tag "no-answer" → 7-day No-Answer Nurture (Sequence B).' },
  },
  contacted: {
    whatHappens:
      'First live conversation — an OUTBOUND call from the closer. Confirm the merchant owns the business, set expectations ("I\'m not here to sell you anything, just to understand your situation"), and begin/book the qualification call.',
    owners: ['closer'],
    sla: 'Same day as the form submit; book qualification immediately.',
    advances: 'Qualification conversation begins → moves to Qualifying.',
    automation: 'MCA 02 — No Answer Nurture (if they went dark)',
    callout: { tone: 'recover', text: 'Goes dark here → breakup sequence → Nurture / Re-engage (recoverable, not dead).' },
  },
};

const MCA_TRANSFER_ENTRY: Record<string, StageDetail> = {
  new: {
    whatHappens:
      'A pre-qualified LIVE call is transferred to the closer from a lead vendor (Lead Tycoons $55–85, Synergy, Exclusive, MCA Leads Pro $75–100, Master MCA). The merchant is already on the phone expecting you — you have ~60 seconds to make an impression.',
    owners: ['closer'],
    sla: 'First touch < 60 seconds — you are on the call. Pick up energized; treat it like you called them.',
    advances: 'The live conversation begins → moves to Contacted (same call).',
    automation: 'Live transfer (vendor) — log the deal immediately',
    callout: { tone: 'branch', text: 'You pay $50–$100 per transfer — speed + a tight script protect that spend. Disqualifiers (<6 mo, <$15K/mo, prohibited industry) → exit politely, tag "soft-no".' },
  },
  contacted: {
    whatHappens:
      'Happens LIVE on the same transferred call. Run the 60-second script: confirm they own [Business Name], ask the 3 quick qualifiers (time in business, monthly revenue, use of funds), then text the application link BEFORE hanging up and confirm their cell out loud. Log the deal as Contacted with lead_source = live_transfer and the vendor name.',
    owners: ['closer'],
    sla: 'All on the transfer call. App link texted within 60 seconds of the call.',
    advances: 'App link sent + qualifiers captured → moves to Qualifying.',
    automation: 'MCA 02 — No Answer Nurture (if no app in 2h)',
    callout: { tone: 'recover', text: 'No app started by +2h → 7-day No-Answer Nurture (Sequence B). Goes dark → breakup → Nurture.' },
  },
};

type TabId = 'mca_web' | 'mca_transfer' | 'vcf';

const PIPELINE_FOR: Record<TabId, 'mca' | 'vcf'> = {
  mca_web: 'mca',
  mca_transfer: 'mca',
  vcf: 'vcf',
};

const DETAILS: Record<TabId, Record<string, StageDetail>> = {
  mca_web: { ...MCA_DETAILS, ...MCA_WEB_ENTRY },
  mca_transfer: { ...MCA_DETAILS, ...MCA_TRANSFER_ENTRY },
  vcf: VCF_DETAILS,
};

/* ------------------------------------------------------------------ */
/* Small presentational helpers                                       */
/* ------------------------------------------------------------------ */
function OwnerPill({ kind }: { kind: OwnerKind }) {
  const m = OWNER_META[kind];
  return (
    <span
      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold"
      style={{ color: m.color, backgroundColor: m.bg, border: `1px solid ${m.border}` }}
    >
      {m.label}
    </span>
  );
}

const CALLOUT_META = {
  leak: { icon: ExclamationTriangleIcon, color: '#EF4444', bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-800', label: '#1 Funnel Leak' },
  branch: { icon: ArrowsRightLeftIcon, color: '#F59E0B', bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-800', label: 'Routing Branch' },
  win: { icon: TrophyIcon, color: '#16A34A', bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-800', label: 'Win State' },
  recover: { icon: ArrowUturnLeftIcon, color: '#007EA7', bg: 'bg-sky-50', border: 'border-sky-200', text: 'text-sky-800', label: 'Recoverable' },
} as const;

function Callout({ tone, text }: { tone: keyof typeof CALLOUT_META; text: string }) {
  const m = CALLOUT_META[tone];
  const Icon = m.icon;
  return (
    <div className={`${m.bg} ${m.border} border rounded-xl p-4 flex items-start gap-3`}>
      <Icon className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: m.color }} />
      <div className={`text-sm ${m.text}`}>
        <span className="font-bold uppercase tracking-wide text-[11px] mr-1.5">{m.label}:</span>
        {text}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                               */
/* ------------------------------------------------------------------ */
export default function PipelinePlaybookPage() {
  const [tab, setTab] = useState<TabId>('mca_web');
  const [stageIndex, setStageIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const def: PipelineDef = PIPELINES[PIPELINE_FOR[tab]];
  const stages = def.stages;
  const stage = stages[stageIndex];
  const detail = DETAILS[tab][stage.key];

  // Reset selection when switching pipelines
  useEffect(() => {
    setStageIndex(0);
    setPlaying(false);
  }, [tab]);

  // Auto-play progression through the stages
  useEffect(() => {
    if (!playing) {
      if (timer.current) clearInterval(timer.current);
      return;
    }
    timer.current = setInterval(() => {
      setStageIndex((i) => {
        if (i >= stages.length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, 2600);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing, stages.length]);

  const progressPct = useMemo(
    () => Math.round(((stageIndex + 1) / stages.length) * 100),
    [stageIndex, stages.length],
  );

  const go = (i: number) => {
    setPlaying(false);
    setStageIndex(Math.max(0, Math.min(stages.length - 1, i)));
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-8 py-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
          <MapIcon className="w-7 h-7 text-mint-green" />
          Pipeline Playbook
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          How a deal flows, stage by stage — what happens, who owns it, the SLA, and what advances it. Onboarding for closers, VAs &amp; ops.
        </p>
      </div>

      <div className="p-8 space-y-8">
        {/* Pipeline toggle */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-xl bg-gray-100 dark:bg-gray-800 p-1 border border-gray-200 dark:border-gray-700">
            {([
              { id: 'mca_web', label: 'MCA · Web Form', sub: '13 stages · inbound form' },
              { id: 'mca_transfer', label: 'MCA · Live Transfer', sub: '13 stages · live phone' },
              { id: 'vcf', label: 'VCF Pipeline', sub: '8 stages · debt relief' },
            ] as const).map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`relative px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                  tab === t.id ? 'text-white' : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                {tab === t.id && (
                  <motion.span
                    layoutId="pipelineTab"
                    className="absolute inset-0 rounded-lg bg-gradient-to-r from-ocean-blue to-teal"
                    transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                  />
                )}
                <span className="relative flex flex-col items-start leading-tight">
                  <span>{t.label}</span>
                  <span className={`text-[10px] font-normal ${tab === t.id ? 'text-white/80' : 'text-gray-400'}`}>{t.sub}</span>
                </span>
              </button>
            ))}
          </div>

          {/* Owner legend */}
          <div className="flex flex-wrap items-center gap-2 ml-auto">
            <span className="text-xs text-gray-400 mr-1">Owners:</span>
            {(Object.keys(OWNER_META) as OwnerKind[]).map((k) => (
              <OwnerPill key={k} kind={k} />
            ))}
          </div>
        </div>

        {/* Animated flow overview */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-midnight-blue flex items-center gap-2">
              <SparklesIcon className="w-5 h-5 text-mint-green" /> {def.name}
            </h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => go(stageIndex - 1)}
                disabled={stageIndex === 0}
                className="p-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                title="Previous stage"
              >
                <ChevronLeftIcon className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPlaying((p) => !p)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-mint-green text-midnight-blue text-sm font-semibold hover:brightness-95"
                title={playing ? 'Pause walkthrough' : 'Play walkthrough'}
              >
                {playing ? <PauseIcon className="w-4 h-4" /> : <PlayIcon className="w-4 h-4" />}
                {playing ? 'Pause' : 'Walkthrough'}
              </button>
              <button
                onClick={() => go(0)}
                className="p-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
                title="Restart"
              >
                <ArrowPathIcon className="w-4 h-4" />
              </button>
              <button
                onClick={() => go(stageIndex + 1)}
                disabled={stageIndex === stages.length - 1}
                className="p-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                title="Next stage"
              >
                <ChevronRightIcon className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Reuse the shared animated PipelineFlow; clicking a node selects it */}
          <PipelineFlow pipeline={def} currentKey={stage.key} onStageClick={(key) => go(stages.findIndex((s) => s.key === key))} />

          {/* Progress bar */}
          <div className="mt-4">
            <div className="flex justify-between text-xs text-gray-400 mb-1">
              <span>
                Stage {stageIndex + 1} of {stages.length}
              </span>
              <span>{progressPct}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-ocean-blue to-mint-green"
                animate={{ width: `${progressPct}%` }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
              />
            </div>
          </div>
        </div>

        {/* Stage detail card */}
        <AnimatePresence mode="wait">
          <motion.div
            key={`${tab}-${stage.key}`}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.3 }}
            className="grid lg:grid-cols-3 gap-6"
          >
            {/* Left: narrative */}
            <div className="lg:col-span-2 bg-white rounded-2xl p-6 shadow-sm border border-gray-100 space-y-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-ocean-blue text-white text-xs font-bold">
                      {stageIndex + 1}
                    </span>
                    <h3 className="text-xl font-bold text-midnight-blue">{stage.label}</h3>
                  </div>
                  <p className="text-sm text-gray-400 italic">Merchant sees: “{stage.blurb}”</p>
                </div>
                {detail.automation && (
                  <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal/10 text-teal text-xs font-semibold border border-teal/20">
                    <SparklesIcon className="w-3.5 h-3.5" /> {detail.automation}
                  </span>
                )}
              </div>

              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-1.5">What happens</p>
                <p className="text-gray-700 leading-relaxed">{detail.whatHappens}</p>
              </div>

              {detail.callout && <Callout tone={detail.callout.tone} text={detail.callout.text} />}
            </div>

            {/* Right: facts */}
            <div className="space-y-4">
              <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                <p className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-2 flex items-center gap-1.5">
                  <UserIcon className="w-4 h-4" /> Who owns it
                </p>
                <div className="flex flex-wrap gap-2">
                  {detail.owners.map((o) => (
                    <OwnerPill key={o} kind={o} />
                  ))}
                </div>
              </div>

              <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                <p className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-2 flex items-center gap-1.5">
                  <ClockIcon className="w-4 h-4" /> SLA / Timing
                </p>
                <p className="text-sm text-gray-700 leading-relaxed">{detail.sla}</p>
              </div>

              <div className="bg-gradient-to-br from-mint-green/10 to-teal/10 rounded-2xl p-5 border border-mint-green/30">
                <p className="text-xs font-bold uppercase tracking-wide text-teal mb-2 flex items-center gap-1.5">
                  <ArrowRightCircleIcon className="w-4 h-4" /> Advances when…
                </p>
                <p className="text-sm text-gray-700 leading-relaxed">{detail.advances}</p>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Stage chips — quick jump */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-3">Jump to a stage</p>
          <div className="flex flex-wrap gap-2">
            {stages.map((s, i) => (
              <button
                key={s.key}
                onClick={() => go(i)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  i === stageIndex
                    ? 'bg-ocean-blue text-white border-ocean-blue'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-ocean-blue hover:text-ocean-blue'
                }`}
              >
                <span className="opacity-60 mr-1">{i + 1}</span>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Always-on key callouts */}
        <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
          <Callout tone="leak" text="Bank Statements is the #1 funnel leak — only ~50–60% of apps survive it. The 14-day chase (Sequence A) is the highest-priority automation. Plaid takes 60 sec vs. days for manual." />
          <Callout tone="branch" text="No deal dead-ends: all-funders-declined → tier-2 resubmit → VCF if stacked. Merchant-declined → 45-day Sequence D rework. Stacked at qualification → route straight to VCF." />
          <Callout tone="win" text="Funded = opportunity status WON. It's the goal — and it seeds the renewal pipeline (~45% renew) off Paydown % triggers at 40/60/75/100%." />
          <Callout tone="recover" text="Nurture / Re-engage = recoverable, not dead. Kept OPEN, worked monthly by Sequence F. Only opt-out / prohibited / exhausted deals become status Lost and leave the board." />
        </div>
      </div>
    </div>
  );
}
