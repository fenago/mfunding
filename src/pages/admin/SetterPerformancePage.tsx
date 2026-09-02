// Setter Performance — the WAVV dial-floor scorecard.
//
// The ONLY dial-floor scorecard: it replaced the HotProspector one that used to
// live at /admin/dialer, and that page has since been deleted with the rest of
// the HP teardown (the historical hotprospector_* tables are untouched in the
// DB — this page just never reads them). Setters dial with WAVV embedded in
// VibeReach, so per-call activity comes from the WAVV Public API v3, mirrored into
// public.wavv_calls every 10 minutes by the `wavv-sync` edge function. This page
// reads the MIRROR for every aggregate and only calls the edge function for three
// things: "Sync now", a recording URL, and a transcript.
//
// MANAGERS ONLY. Closers must not see each other's stats — the route is
// admin-gated and the wavv_calls RLS policy grants select to admin/super_admin
// alone, so a closer session reads nothing even if it reaches the URL. The
// Numbers tab (the attribution control surface) is additionally gated in the UI.
//
// ── READ PATH: THE VIEWS, NOT THE TABLE ──────────────────────────────────────
// Every call this page reads comes from public.v_wavv_outbound_setter_calls, and
// the Numbers tab's worklist from public.v_wavv_outbound_caller_ids. Both are
// security_invoker, so wavv_calls RLS still governs the rows. The view already
// does three things this page must never redo by hand:
//   • filters direction = 'outbound',
//   • joins caller_id -> wavv_caller_setters -> profiles,
//   • normalizes the mapping key.
// So there is NO client-side join here and NO read of wavv_calls — a second
// implementation of the join is a second thing to drift.
//
// ── HONESTY RULES THIS PAGE OBEYS ────────────────────────────────────────────
// 1. UNREADABLE IS NOT ZERO. If the WAVV key is invalid the sync cannot pull, and
//    the page says so in a banner. It never renders an empty floor as "0 dials".
// 2. A missing metric renders as a dimmed "—", never 0. A metric with no value,
//    or no threshold to judge it against, renders GREY — never green.
// 3. ATTRIBUTION IS NEVER INVENTED. WAVV's call object carries NO per-user field
//    (agent_key / agent_name are null on every row, and team_id is one constant
//    for the whole account) — this is permanent, not a sync bug, so there is no
//    "reparse" that fixes it. The only dial-side identifier is caller_id, the
//    number we dialed FROM, so per-setter attribution is an ADMIN-MAINTAINED MAP
//    edited in the Numbers tab. A number with no setter shows under its own
//    caller_label, never as a person. A number two setters share attributes
//    wholly to whoever is assigned to it.
// 4. INBOUND IS OUT OF SCOPE HERE. On an inbound row caller_id is the MERCHANT's
//    number, so it can carry no setter attribution at all. The view excludes it
//    and this page never adds it back.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  PhoneIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  UserGroupIcon,
  ChatBubbleLeftRightIcon,
  PlayIcon,
  DocumentTextIcon,
  FunnelIcon,
  ShieldCheckIcon,
  ChartBarIcon,
  ArrowTrendingUpIcon,
  HashtagIcon,
  CheckCircleIcon,
  ArrowsRightLeftIcon,
  BoltIcon,
  BanknotesIcon,
  ClockIcon,
  ClipboardDocumentListIcon,
  ScaleIcon,
  PhoneArrowUpRightIcon,
} from "@heroicons/react/24/outline";
import {
  BarChart, Bar, ComposedChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import supabase from "@/supabase";
import { mustWrite } from "@/supabase/writes";
import { useUserProfile } from "@/context/UserProfileContext";
import { DEAL_STAGES, type DealStatus } from "@/types/deals";
import AssignmentsPanel from "@/components/admin/AssignmentsPanel";
import DialCeilingPanel, { type ProductiveSetterRow } from "@/components/admin/DialCeilingPanel";
import SetterOpsTab from "@/components/admin/setter/SetterOpsTab";
import CallAuditTab from "@/components/admin/setter/CallAuditTab";
import TextMerchantPanel from "@/components/admin/TextMerchantPanel";
import {
  BenchmarkChip, BenchmarkTile, BenchmarkLegend, IndustryComparisonCard,
  type BenchmarkValues,
} from "@/components/admin/IndustryBenchmarks";
import { INDUSTRY_BENCHMARKS, benchmarkRag, benchmarkVerdict, type BenchmarkId } from "@/data/industryBenchmarks";

// ── Types (mirror the live view contracts) ───────────────────────────────────
/** One row of public.v_wavv_outbound_setter_calls — an OUTBOUND call already
 *  resolved to its setter. `setter_id` null = the number it was dialed from has
 *  nobody assigned to it yet, which is missing attribution, not "no setter". */
interface SetterCall {
  wavv_call_id: string;
  started_at: string | null;
  answered_at: string | null;
  ended_at: string | null;
  seconds: number | null;
  outcome: string | null;
  disposition: string | null;
  human: boolean | null;
  recorded: boolean | null;
  phone: string | null;
  /** The GHL contact id. Drives the "Open →" deep link into the Revenue
   *  Playbook (/admin/playbooks?contact=…). Null on a dial WAVV never tied to a
   *  contact record — those rows render un-clickable rather than guessing. */
  contact_id: string | null;
  contact_name: string | null;
  caller_id: string | null;
  setter_id: string | null;
  setter_name: string | null;
  caller_label: string | null;
  is_attributed: boolean | null;
  note: string | null;
  summary: string | null;
}

// One unbroken string literal on purpose: the client is untyped, so supabase-js
// infers the row shape by parsing this literal. Splitting it across a `+`
// concatenation defeats that parse and the result degrades to GenericStringError.
const CALL_COLS = "wavv_call_id,started_at,answered_at,ended_at,seconds,outcome,disposition,human,recorded,phone,contact_id,contact_name,caller_id,setter_id,setter_name,caller_label,is_attributed,note,summary";

const CALLS_VIEW = "v_wavv_outbound_setter_calls";
const NUMBERS_VIEW = "v_wavv_outbound_caller_ids";

interface SyncState {
  watermark: string | null;
  last_sync_at: string | null;
  last_status: string;
  last_error: string | null;
  key_invalid: boolean;
  rows_upserted_last: number;
  truncated: boolean;
}

/** v_wavv_outbound_caller_ids — every outbound number seen on the wire, joined
 *  to its mapping state. `call_count` is all-time, not range-scoped. */
interface NumberRow {
  caller_id: string;
  call_count: number;
  first_seen: string | null;
  last_seen: string | null;
  setter_id: string | null;
  setter_name: string | null;
  setter_email: string | null;
  label: string | null;
  source: string | null;
  in_mapping_table: boolean;
  is_assigned: boolean;
}

interface DealRow {
  id: string;
  assigned_closer_id: string | null;
  appointment_at: string | null;
  application_sent_at: string | null;
  funded_at: string | null;
  amount_funded: number | null;
  status: string | null;
}

interface SetterOption {
  id: string;      // profiles.id — what wavv_caller_setters.setter_id references
  name: string;
}

// ═════════════════════════════════════════════════════════════════════════════
// SYNERGY LEAD TABS — "Live Transfers" and "Real-Time"
// ═════════════════════════════════════════════════════════════════════════════
// These two tabs measure something DIFFERENT from every other tab on this page.
// Everything else is WAVV DIAL activity (v_wavv_outbound_setter_calls). These
// are PIPELINE OUTCOMES read from public.deals: of the leads Synergy delivered,
// how far did each setter carry them?
//
//   • LIVE TRANSFER (deals.lead_source = 'live_transfer') — the vendor warm-
//     transfers the merchant while they are on the phone.
//   • REAL-TIME   (deals.lead_source = 'realtime_appt')  — an email-delivered
//     lead the setter has to call themselves.
//
// Both flags are written by the `live-transfer-intake` edge function when the
// lead lands, so nothing here re-derives or re-tags anything.
//
// THE RANGE MEANS "RECEIVED", NOT "WORKED". These tabs filter deals.created_at,
// i.e. when the lead arrived — a cohort. That is deliberately NOT the filter the
// Setters tab's loadDeals() uses (it ORs three activity timestamps to answer
// "what moved in this window"), so the two queries are kept separate rather than
// one being bent into the other's shape.
const SOURCE_DEAL_COLS = "id,lead_source,status,previous_status,assigned_closer_id,created_at,contacted_at,spoke_at,qualified_at,application_sent_at,funded_at,appointment_at,amount_funded";
/** Bounded like the WAVV aggregate pass. Hitting it is REPORTED in the UI. */
// Must not exceed the PostgREST max-rows (1,000) — a higher number here would
// be a lie: the server truncates at 1,000 regardless, and the `>= CAP` test that
// raises the "narrow the range" banner would then never fire, so the tab would
// under-report in silence. See the note on AGG_ROW_CAP.
const SOURCE_DEAL_CAP = 1000;

interface SourceDeal {
  id: string;
  lead_source: string | null;
  status: string | null;
  previous_status: string | null;
  assigned_closer_id: string | null;
  created_at: string | null;
  contacted_at: string | null;
  spoke_at: string | null;
  qualified_at: string | null;
  application_sent_at: string | null;
  funded_at: string | null;
  appointment_at: string | null;
  amount_funded: number | null;
}

// ═════════════════════════════════════════════════════════════════════════════
// PRODUCTIVE CONTACTS — the PIPELINE-side positive
// ═════════════════════════════════════════════════════════════════════════════
// THE PROBLEM THIS EXISTS TO FIX. Every dial-side number on this page is built
// out of DISPOSITIONS, so a setter who does the work and does not log it scores
// zero. That is not hypothetical: on 2026-08-28 a 7-minute live call to H&R
// Logistic Services was dispositioned "None", and the same setter then created
// the deal, qualified it and SENT THE APPLICATION. The dial side recorded a
// nothing; the pipeline recorded the best kind of day.
//
// So this reads the OTHER system of record — public.deals — and counts the
// stage stamps a setter actually put on merchants inside the range.
//
// ── FOUR RULES THIS DELIBERATELY OBEYS ──────────────────────────────────────
// 1. IT IS NEVER BLENDED INTO THE DIAL FUNNEL. Dial-side and pipeline-side are
//    two different measurements of two different things, and the GAP between
//    them is the finding — a setter with 4 positives and 12 productive contacts
//    is under-dispositioning, which is exactly what a manager must see. Adding
//    them together, or quietly substituting one for the other, would erase it.
// 2. NO lead_source FILTER. The two Synergy tabs deliberately scope to
//    live_transfer / realtime_appt; this must NOT, because the setters' main
//    book is `ucc_list` and every one of those merchants would vanish.
// 3. ATTRIBUTION IS coalesce(assigned_closer_id, created_by). A setter who
//    creates a deal off their own dial owns it even before assignment lands.
//    Neither → the deal belongs to nobody and is counted under "unattributed",
//    never folded into whoever is busiest.
// 4. IT IS A RANGE OF ACTIVITY, NOT A COHORT. Each timestamp is tested against
//    the range separately (the same shape loadDeals uses), so this answers
//    "what did this person MOVE in this window", not "what landed in it".
//
// ── WHY amount_requested AND THE CUSTOMER EMBED RIDE ALONG ──────────────────
// The Positive-dispositions list folds these same rows to show what the merchant
// ASKED FOR and what they DO a month (see positiveMoney). Both come off this one
// query rather than a per-row fetch.
//
// MONEY WALL (20260827_setter_deal_money_wall): the wall on `deals` is a ROW
// wall, not a column mask — a setter's SELECT policy returns only their own
// deals plus the unassigned pool. So amount_requested is safe to select here:
// another setter's deal is not in `data` at all, and the fold below therefore
// renders "—" for it. Ops staff read every row and see the real figure.
// customers is deliberately whole-book (qualification data a setter must see to
// qualify), so monthly_revenue embeds cleanly — but it still only surfaces for a
// deal row the caller could read.
const PRODUCTIVE_DEAL_COLS = "id,deal_number,status,previous_status,lead_source,assigned_closer_id,created_by,ghl_contact_id,contacted_at,qualified_at,application_sent_at,docs_collected_at,bank_statements_at,appointment_at,appointment_promised_at,funded_at,amount_requested,customer:customers!customer_id(business_name,monthly_revenue,phone)";
/** Same reasoning as SOURCE_DEAL_CAP — must not exceed PostgREST max-rows, or
 *  the `>= CAP` truncation test can never fire and the tab under-reports in
 *  silence. */
const PRODUCTIVE_DEAL_CAP = 1000;

interface ProductiveDeal {
  id: string;
  deal_number: string | null;
  status: string | null;
  /** Last active stage before the deal was parked (nurture / declined / dead),
   *  so a parked deal can still be read at the rung it actually reached. */
  previous_status: string | null;
  lead_source: string | null;
  assigned_closer_id: string | null;
  created_by: string | null;
  ghl_contact_id: string | null;
  contacted_at: string | null;
  qualified_at: string | null;
  application_sent_at: string | null;
  /** Stamped when documents / bank statements were collected — the "with
   *  statements" signal for the Applications funnel rung. */
  docs_collected_at: string | null;
  bank_statements_at: string | null;
  appointment_at: string | null;
  appointment_promised_at: string | null;
  funded_at: string | null;
  /** Masked to absent for a setter looking at someone else's deal — the row
   *  itself is not returned, so this is null/undefined rather than 0. */
  amount_requested: number | null;
  customer: { business_name: string | null; monthly_revenue: number | null; phone: string | null } | null;
}

/** Deal statuses that must never be the one a merchant is represented by while a
 *  live cycle exists alongside them. A duplicate killed in favour of the real
 *  deal keeps its own (usually empty) amount, and picking it would render "—"
 *  next to a merchant who very much did state a number. */
const TERMINAL_DEAL_STATUSES = ["dead", "declined"];

/** The bucket for a deal with no assigned closer AND no creator. A real bucket,
 *  not a person: work nobody owns is shown as such rather than credited to
 *  whoever happens to be busiest. */
const UNATTRIBUTED_OWNER = "__no_owner__";

/** Who a deal's pipeline work belongs to. Null = nobody — an honest bucket. */
function productiveOwner(d: ProductiveDeal): string | null {
  return d.assigned_closer_id ?? d.created_by ?? null;
}

/** An appointment counts off the real booking when there is one, and off the
 *  PROMISE otherwise (wavv-disposition-sync raises appointment_promised_at when
 *  a disposition agrees to a meeting with no time attached). The promise is a
 *  weaker fact than a booking, so it is only ever the fallback. */
function productiveAppointmentAt(d: ProductiveDeal): string | null {
  return d.appointment_at ?? d.appointment_promised_at;
}

interface ProductiveCounts {
  /** Distinct deals carrying at least one in-range stamp — the headline. */
  deals: number;
  contacted: number;
  qualified: number;
  appsSent: number;
  /** Of the in-range applications, how many ALSO reached bank statements — the
   *  hard, un-fakeable "App + statements" the funnel's Applications rung shows. */
  appsWithStatements: number;
  /** Σ amount_requested over the in-range applications (partials included) — the
   *  dollars ADDED TO THE PIPELINE by this range's applications. */
  appsAskTotal: number;
  /** Deals whose bank statements ARRIVED in range (bank_statements_at or
   *  docs_collected_at stamp) — the docs-chase payoff. */
  statementsIn: number;
  appointments: number;
  funded: number;
}

function computeProductive(deals: ProductiveDeal[], from: Date, to: Date): ProductiveCounts {
  const c: ProductiveCounts = { deals: 0, contacted: 0, qualified: 0, appsSent: 0, appsWithStatements: 0, appsAskTotal: 0, statementsIn: 0, appointments: 0, funded: 0 };
  for (const d of deals) {
    const contacted = inRange(d.contacted_at, from, to);
    const qualified = inRange(d.qualified_at, from, to);
    const appSent = inRange(d.application_sent_at, from, to);
    const stmtsIn = inRange(d.bank_statements_at, from, to) || inRange(d.docs_collected_at, from, to);
    const appt = inRange(productiveAppointmentAt(d), from, to);
    const funded = inRange(d.funded_at, from, to);
    if (stmtsIn) c.statementsIn++;
    if (!(contacted || qualified || appSent || appt || funded)) continue;
    c.deals++;
    if (contacted) c.contacted++;
    if (qualified) c.qualified++;
    // The application is attributed to the range by its application_sent_at
    // stamp; "with statements" is a property of that same applied-in-range deal
    // (of those apps, how many also got the docs in), so it is NOT range-gated
    // again on the statements stamp.
    if (appSent) {
      c.appsSent++;
      if (dealReachedStatements(d)) c.appsWithStatements++;
      c.appsAskTotal += Number(d.amount_requested ?? 0) || 0;
    }
    if (appt) c.appointments++;
    if (funded) c.funded++;
  }
  return c;
}

/** The MCA ladder in the app's OWN order — DEAL_STAGES from types/deals.ts, the
 *  same list the deal stepper renders. Index = depth. Parked statuses
 *  (nurture / declined / dead) are deliberately absent: they are not rungs, they
 *  are where a deal goes when it leaves the ladder, which is why a parked deal
 *  falls back to its `previous_status`. */
const MCA_LADDER: DealStatus[] = DEAL_STAGES.map((s) => s.key);
const LADDER_INDEX = new Map<string, number>(MCA_LADDER.map((k, i) => [k as string, i]));
const IDX = (k: DealStatus) => LADDER_INDEX.get(k)!;

/** Did this deal collect bank statements? The TRUEST signal available on the
 *  deal row this page already loads, without a second query: it reached the Bank
 *  Statements rung — a bank_statements_at (or docs_collected_at) stamp, or a
 *  current status (or, for a parked deal, its previous_status) at Bank
 *  Statements or deeper. This is the "prefer reached-bank-statements-stage"
 *  signal. A plaid_items / customer_documents / bank_analyses join would be
 *  truer for a deal whose docs arrived but whose stage never advanced, but the
 *  whole industry block folds from rows already in hand and adds no query — so
 *  the stage/stamp reading is used, and this can UNDER-count a lagging deal
 *  rather than ever over-claim one. */
function dealReachedStatements(d: ProductiveDeal): boolean {
  if (d.bank_statements_at || d.docs_collected_at) return true;
  const depth =
    LADDER_INDEX.get(d.status ?? "") ??
    LADDER_INDEX.get(d.previous_status ?? "") ??
    -1;
  return depth >= IDX("bank_statements");
}

// ── HOW "REACHED THIS STAGE" IS DERIVED ──────────────────────────────────────
// A deal does not leave a breadcrumb at every rung, so the deepest rung it ever
// held is taken as the MAX of two independent readings:
//
//   1. ITS CURRENT POSITION. status → ladder index. A deal sitting in 'funded'
//      is counted at Contacted, Qualifying and Application Sent too, because it
//      demonstrably passed through them. A deal PARKED in nurture/declined/dead
//      has no rung, so `previous_status` — the last active stage, captured on
//      the way out — is read instead. Neither → depth 0 (Received only).
//   2. ITS STAGE TIMESTAMPS. contacted_at / spoke_at / qualified_at /
//      application_sent_at / funded_at, each of which proves that rung was
//      reached even if the deal has since been dragged backwards or parked.
//
// Taking the max makes the funnel MONOTONE by construction: every deal counted
// at a stage is counted at every stage above it, so a step rate can never come
// out over 100% and a later stage can never out-count an earlier one.
function pipelineDepth(d: SourceDeal): number {
  let depth =
    LADDER_INDEX.get(d.status ?? "") ??
    LADDER_INDEX.get(d.previous_status ?? "") ??
    0;
  const mark = (iso: string | null, stage: DealStatus) => {
    if (iso) depth = Math.max(depth, IDX(stage));
  };
  mark(d.contacted_at, "contacted");
  mark(d.spoke_at, "contacted");
  mark(d.qualified_at, "qualifying");
  mark(d.application_sent_at, "application_sent");
  if (d.funded_at || d.status === "funded") depth = Math.max(depth, IDX("funded"));
  return depth;
}

interface PipeCounts {
  received: number;
  contacted: number;
  qualifying: number;
  appsSent: number;
  funded: number;
  appointments: number;
  fundedAmount: number;
  /** Still sitting at Received with nothing logged — the untouched pile. */
  untouched: number;
}

function computePipeline(deals: SourceDeal[]): PipeCounts {
  const c: PipeCounts = {
    received: 0, contacted: 0, qualifying: 0, appsSent: 0, funded: 0,
    appointments: 0, fundedAmount: 0, untouched: 0,
  };
  for (const d of deals) {
    c.received++;
    const depth = pipelineDepth(d);
    if (depth >= IDX("contacted")) c.contacted++; else c.untouched++;
    if (depth >= IDX("qualifying")) c.qualifying++;
    if (depth >= IDX("application_sent")) c.appsSent++;
    if (depth >= IDX("funded")) {
      c.funded++;
      c.fundedAmount += Number(d.amount_funded ?? 0);
    }
    if (d.appointment_at) c.appointments++;
  }
  return c;
}

/** Which lead product a tab is about, and the KPI-target key prefix its rates
 *  are judged under. The two products are held to SEPARATE thresholds on
 *  purpose: a warm transfer that only converts like a cold email is a problem,
 *  and one shared target would hide that. */
interface SourceTabDef {
  id: "live_transfers" | "realtime";
  leadSource: string;
  label: string;
  noun: string;
  targetPrefix: string;
  blurb: ReactNode;
}

const SOURCE_TABS: Record<"live_transfers" | "realtime", SourceTabDef> = {
  live_transfers: {
    id: "live_transfers",
    leadSource: "live_transfer",
    label: "Live Transfers",
    noun: "transfer",
    targetPrefix: "lt",
    blurb: (
      <>
        Synergy warm-transferred the merchant to a setter <b>while they were on the phone</b>. Marked on the
        deal as <code>lead_source = live_transfer</code> by the <code>live-transfer-intake</code> function.
      </>
    ),
  },
  realtime: {
    id: "realtime",
    leadSource: "realtime_appt",
    label: "Real-Time",
    noun: "lead",
    targetPrefix: "rt",
    blurb: (
      <>
        Synergy delivered the lead <b>by email</b> and the setter placed the call. Marked on the deal as{" "}
        <code>lead_source = realtime_appt</code> by the <code>live-transfer-intake</code> function.
      </>
    ),
  },
};

/** The pipeline funnel, as one definition — the twin of funnelStagesOf() on the
 *  dial side. `targetSuffix` is appended to the tab's prefix (lt_ / rt_) to look
 *  a threshold up in platform_settings.ph_dialer_kpi_targets. There are NO
 *  built-in defaults for these: an unset threshold renders grey, never green. */
function pipelineStagesOf(c: PipeCounts, targetPrefix: string): FunnelStage[] {
  const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : null);
  const key = (suffix: string) => `${targetPrefix}_${suffix}`;
  return [
    {
      key: "received", label: "Received", short: "Received",
      help: "Every deal of this lead source created in the range — the cohort the vendor delivered",
      count: c.received, stepLabel: "—", stepShort: "—", stepPct: null, targetKey: null,
    },
    {
      key: "contacted", label: "Contacted", short: "Contacted",
      help: "Reached at-or-past the Contacted rung: a contacted_at / spoke_at stamp, or a current (or pre-park) status of Contacted or later",
      count: c.contacted, stepLabel: "of leads received", stepShort: "of received",
      stepPct: pct(c.contacted, c.received), targetKey: key("contact_rate_pct"),
    },
    {
      key: "qualifying", label: "Qualifying", short: "Qualifying",
      help: "Reached at-or-past the Qualifying rung: a qualified_at stamp, or a current (or pre-park) status of Qualifying or later",
      count: c.qualifying, stepLabel: "of contacted", stepShort: "of contacted",
      stepPct: pct(c.qualifying, c.contacted), targetKey: key("qualify_rate_pct"),
    },
    {
      key: "application_sent", label: "Application sent", short: "App sent",
      help: "Reached at-or-past the Application Sent rung: an application_sent_at stamp, or a current (or pre-park) status of App Sent or later",
      count: c.appsSent, stepLabel: "of qualified", stepShort: "of qualified",
      stepPct: pct(c.appsSent, c.qualifying), targetKey: key("app_rate_pct"),
    },
    {
      key: "funded", label: "Funded", short: "Funded",
      help: "Funded: a funded_at stamp, or a current status of Funded",
      count: c.funded, stepLabel: "of applications", stepShort: "of apps",
      stepPct: pct(c.funded, c.appsSent), targetKey: key("fund_rate_pct"),
      // Both lead-source tabs are VENDOR-DELIVERED warm leads (a live transfer
      // or a real-time lead the merchant asked for), so the app→fund band that
      // applies here is the warm one — 20–30% — not the 8–15% cold band. A warm
      // source converting like a cold dial is exactly the finding this tab is
      // for, and holding it to the cold band would hide it.
      benchmark: { id: "app_to_fund_warm", basis: "step" },
    },
  ];
}

/** One setter's slice of a lead-source cohort. `unassigned` is a real bucket,
 *  not a person: a deal with no assigned_closer_id belongs to nobody and is
 *  never folded into whoever happens to be busiest. */
interface PipeGroup {
  key: string;
  name: string;
  unassigned: boolean;
  /** True when the name could not be read (profiles is super-admin-only), so the
   *  row is titled by id fragment rather than by an invented name. */
  nameUnknown: boolean;
  deals: SourceDeal[];
  counts: PipeCounts;
}

/** Sentinel for "no closer filter" on the two lead-source tabs. Distinct from
 *  UNASSIGNED_FILTER, which is a real bucket (deals nobody owns). */
const ALL_CLOSERS = "__all_closers__";

// The aggregate pass pulls raw rows and folds them in the browser. Bounded so a
// wide range can never try to stream the whole view; hitting the cap is
// REPORTED (see aggregateTruncated), never silently absorbed.
//
// ⚠️ PostgREST enforces the project's max-rows (1,000 here) on EVERY select, and
// it truncates SILENTLY — no error, no header the client checks. A single
// `.limit(AGG_ROW_CAP)` therefore came back with exactly 1,000 rows on a day
// that really had 1,802 calls, and because every funnel card, the by-setter
// scorecard, the charts and Talk Time all fold this one array, all of them
// under-reported at once (DIALS read a suspiciously round 1,000). So the slice
// is fetched in explicit `.range()` pages of AGG_PAGE_SIZE until a short page
// proves the range is exhausted. AGG_PAGE_SIZE must stay <= the project's
// max-rows or the paging silently short-reads again.
const AGG_ROW_CAP = 20000;
const AGG_PAGE_SIZE = 1000;
const LOG_PAGE_SIZE = 50;
const TOOLTIP_STYLE = {
  backgroundColor: "#21262D",
  border: "1px solid #30363D",
  borderRadius: "8px",
  color: "#E5E7EB",
  fontSize: "12px",
};

/** Dispositions that mean the conversation went somewhere. Exact strings as WAVV
 *  reports them — anything not on this list is neutral or negative, never
 *  fuzzy-matched into "positive".
 *
 *  LISTED IN THE OWNER'S 8/22 OUTCOME LADDER ORDER, best first. "Full App +
 *  Statements" is the TOP of that ladder — `wavv-disposition-sync` maps its tag
 *  to DOCS COLLECTED, the deepest rung any disposition reaches — and it scored
 *  ZERO here until 2026-08-28 because the rename added the value in WAVV and
 *  nobody added it to this list. Verified against the live mirror before it was
 *  hardcoded: the exact string is "Full App + Statements" (spaces around the +).
 *  The SAME vocabulary is duplicated server-side in setter_dial_ceiling /
 *  setter_dial_ceiling_daily (one `dispo` CTE each) — change both together. */
const POSITIVE_DISPOSITIONS = [
  // "Partial Application" is the 9/1 rename of "Interested" in WAVV; the old
  // string stays so historical rows keep counting. (The GHL tag is still
  // wavv-interested — tag-based stage sync is unaffected by the rename.)
  "Full App + Statements", "Full Application", "Partial Application", "Appointment Set", "Interested", "Callback",
];

/** The subset of positives that is actually an APPLICATION — the numerator for
 *  the industry "app rate per conversation" band (2–4%).
 *
 *  Deliberately NOT all positives. "Interested", "Callback" and even
 *  "Appointment Set" are wins, but none of them is an application, and counting
 *  them against a band that means applications would flatter the comparison by
 *  a multiple. "Partial Application" IS an application (a partial went out).
 *  Same string discipline as the list above — exact WAVV values. */
const APPLICATION_DISPOSITIONS = ["Full App + Statements", "Full Application", "Partial Application"];

// ── What counts as a real conversation ───────────────────────────────────────
// NOT duration, and NOT WAVV's `human` flag. Both are unreliable here and the
// mirror proves it: 5,024 rows are dispositioned "Voice Message" with outcome
// VOICEMAIL yet 136 of them carry human=true, and 1,124 of the 1,187 NO_CALLBACK
// rows (avg 8 seconds) are flagged human. In the other direction the single
// 787-second call that produced a Full Application has human=false. So a
// duration/flag test both counts voicemails and misses real talks.
//
// A DISPOSITION is different: it is set by the setter AFTER the call, and these
// six can only be chosen once a live person has been spoken to. Everything a
// machine or a dead line produces ("Voice Message", "No Answer", "Bad Number",
// "Call Blocked", "Agent Canceled", "None", NULL) is excluded by construction.
//
// HONESTY CAVEAT, stated in the UI too: this measures DISPOSITIONED talks. A
// setter who does not disposition their calls under-reports conversations.
const CONVERSATION_DISPOSITIONS = [
  "Full App + Statements", "Full Application", "Interested", "Not Interested",
  "Appointment Set", "Callback", "Do Not Contact",
];
const CONVERSATION_HELP =
  `Conversation = the setter reached a live person and dispositioned the call (${CONVERSATION_DISPOSITIONS.join(" · ")}). Voicemails are excluded. Undispositioned calls — including WAVV's literal "None" — are not counted, so under-dispositioning under-reports this.`;

// ── "None" IS NOT AN OUTCOME, AND IS NOT SILENTLY ABSORBED ───────────────────
// WAVV ships a literal "None" disposition and the 8/22 outcome-ladder rename
// stranded it: 466 ANSWERED calls carry it over 14 days, including 7-minute
// talks that produced a signed application. It is deliberately absent from BOTH
// lists above, and must stay absent:
//   • not POSITIVE — nothing is claimed, because nothing was recorded;
//   • not a CONVERSATION — the whole basis of CONVERSATION_DISPOSITIONS is that
//     a human had to CHOOSE the value after speaking to someone. Folding "None"
//     in would convert a logging gap into a performance number and destroy the
//     one honest signal on the dial side.
// DO NOT re-absorb it. These calls have a home: the DISPOSITION REVIEW tab,
// which pairs each of them with what the PIPELINE says actually happened, so a
// real talk that was never dispositioned is visible instead of scoring zero.
const UNDISPOSITIONED_VALUES = ["None", "Agent Canceled"] as const;
/** How long an answered call must run before "no disposition" is worth a
 *  manager's attention. Short answered blips are dialer noise, not talks. */
const REVIEW_MIN_SECONDS = 60;

function isUndispositioned(r: Pick<SetterCall, "disposition">): boolean {
  return !r.disposition || (UNDISPOSITIONED_VALUES as readonly string[]).includes(r.disposition);
}

/** A REAL TALK WITH NO HONEST OUTCOME: answered, nothing about it says machine,
 *  it ran long enough to be a conversation, and it was left un-dispositioned.
 *  reachedHuman() already requires the answer, so this is a strict subset of
 *  Humans — never of Dials. */
function needsDispositionReview(r: SetterCall): boolean {
  return reachedHuman(r) && (r.seconds ?? 0) >= REVIEW_MIN_SECONDS && isUndispositioned(r);
}

/** Outcomes WAVV reports for a machine or an unanswered line. NO_CALLBACK is on
 *  the list on purpose: those rows average 8 seconds and are flagged human. */
const NON_HUMAN_OUTCOMES = ["VOICEMAIL", "NO_VOICEMAIL", "NO_ANSWER", "NO_CALLBACK"] as const;
const NON_HUMAN_OUTCOME_SET = new Set<string>(NON_HUMAN_OUTCOMES);
/** Dispositions a setter picks when the line was a machine or nobody picked up. */
const NON_HUMAN_DISPOSITIONS = ["Voice Message", "No Answer"] as const;
/** WAVV stamps this note prefix when the dialer dropped a pre-recorded voicemail. */
const VOICEMAIL_NOTE_PREFIX = "Played voicemail";

/** REACHED A HUMAN = the call was answered and nothing about it says machine.
 *  Defined negatively (exclude the voicemail/no-answer tells) rather than by
 *  trusting `human`, and gated on an answer so it stays a strict subset of
 *  Connects — a rejected/disconnected/busy line reached nobody. */
function reachedHuman(r: Pick<SetterCall, "answered_at" | "outcome" | "disposition" | "note">): boolean {
  if (!r.answered_at) return false;
  if (r.outcome && NON_HUMAN_OUTCOME_SET.has(r.outcome.toUpperCase())) return false;
  if (r.disposition && (NON_HUMAN_DISPOSITIONS as readonly string[]).includes(r.disposition)) return false;
  if (r.note && /^\s*played voicemail/i.test(r.note)) return false;
  return true;
}

// ── The SERVER-SIDE twin of reachedHuman() ───────────────────────────────────
// The Call log is a paged server query, so its "reached a human" filter has to
// run in Postgres — filtering the visible page in the browser would silently
// answer a different question ("humans on page 1") than the one asked.
//
// Both strings are built from the SAME constants reachedHuman() uses, so the
// predicate and the filter cannot drift apart. Each clause is null-SAFE: in SQL
// `outcome NOT IN (...)` is NULL (→ excluded) when outcome is null, but a null
// outcome tells us nothing about a machine, so the row must survive.
//
// One knowing difference: reachedHuman() upper-cases outcome before comparing
// and these compare as stored. Every outcome WAVV has ever written is already
// upper-case, so the two agree on today's data; if a lower-case outcome ever
// lands, the filter is the one that would miss it.
const IN_LIST = (values: readonly string[]) => values.map((v) => (v.includes(" ") ? `"${v}"` : v)).join(",");

/** ANDed together (each is one `.or()`), plus answered_at NOT NULL, these select
 *  exactly the rows reachedHuman() returns true for. */
const HUMAN_OR_CLAUSES = [
  `outcome.is.null,outcome.not.in.(${IN_LIST(NON_HUMAN_OUTCOMES)})`,
  `disposition.is.null,disposition.not.in.(${IN_LIST(NON_HUMAN_DISPOSITIONS)})`,
  `note.is.null,note.not.ilike."${VOICEMAIL_NOTE_PREFIX}%"`,
];

/** The exact complement — one OR, because NOT(a AND b AND c) is (¬a OR ¬b OR ¬c).
 *  It therefore includes lines that were never answered at all, not only
 *  voicemails, which is why the UI labels it "voicemail / no human". */
const NOT_HUMAN_OR_CLAUSE = [
  "answered_at.is.null",
  `outcome.in.(${IN_LIST(NON_HUMAN_OUTCOMES)})`,
  `disposition.in.(${IN_LIST(NON_HUMAN_DISPOSITIONS)})`,
  `note.ilike."${VOICEMAIL_NOTE_PREFIX}%"`,
].join(",");

/** Every outcome WAVV has written to this mirror. Kept as a constant so the
 *  dropdown offers the full vocabulary even when the active range contains only
 *  a few of them; anything new that shows up in the data is unioned in. */
const KNOWN_OUTCOMES = [
  "VOICEMAIL", "USER_HUNG_UP", "NO_ANSWER", "NO_CALLBACK", "HUNG_UP",
  "REJECTED", "DISCONNECTED", "BUSY", "NO_VOICEMAIL", "UNKNOWN",
];

/** PostgREST parses `or=(…)` as a comma-separated list, so a raw search string
 *  containing , ( ) " \ would rewrite the filter rather than be matched by it.
 *  Wildcards are stripped too — a typed % should search for text, not glob. */
function sanitizeSearch(q: string): string {
  return q.replace(/[,()"\\%*]/g, " ").replace(/\s+/g, " ").trim();
}

function isConversation(r: Pick<SetterCall, "disposition">): boolean {
  return !!r.disposition && CONVERSATION_DISPOSITIONS.includes(r.disposition);
}

// ── The funnel, as one definition ────────────────────────────────────────────
// Dial → Connect (answered_at set) → Human (reachedHuman: answered and not a
// voicemail/no-answer tell) → Conversation (a talk disposition) → Positive
// disposition. Each stage is a strict subset of the one above it — the
// conversation dispositions only ever occur on answered, non-voicemail rows —
// so the step rates are real conditional rates, never over 100%.
//
// Pure and row-based on purpose: the team-wide funnel and every per-setter /
// per-number card run this SAME function over a different slice of the same
// loaded rows, so a grouped card can never drift from the combined one.
interface FunnelCounts {
  dials: number;
  connects: number;
  humans: number;
  conversations: number;
  positives: number;
  talkSeconds: number;
  connectedSeconds: number;
  uniqueLeads: number;
}

function computeFunnel(calls: SetterCall[]): FunnelCounts {
  let dials = 0, connects = 0, humans = 0, conversations = 0, positives = 0;
  let talkSeconds = 0, connectedSeconds = 0;
  const phones = new Set<string>();
  for (const r of calls) {
    dials++;
    const secs = r.seconds ?? 0;
    talkSeconds += secs;
    if (r.answered_at) { connects++; connectedSeconds += secs; }
    if (reachedHuman(r)) humans++;
    if (isConversation(r)) conversations++;
    if (r.disposition && POSITIVE_DISPOSITIONS.includes(r.disposition)) positives++;
    if (r.phone) phones.add(r.phone);
  }
  return { dials, connects, humans, conversations, positives, talkSeconds, connectedSeconds, uniqueLeads: phones.size };
}

interface FunnelStage {
  key: string;
  label: string;
  /** Short label for the compact grid cards, where the full sentence will not fit. */
  short: string;
  help: string;
  count: number;
  stepLabel: string;
  stepShort: string;
  stepPct: number | null;
  targetKey: string | null;
  /** An INDUSTRY band pinned to this rung, and which of the stage's two
   *  percentages it is actually comparable to:
   *    "ofTotal" — the "% of dials / % of leads" line (share of stage 0)
   *    "step"    — the conditional step rate in the chip
   *  Attached only where the denominators genuinely match. The industry
   *  cold-dial contact rate is a share of DIALS, so pinning it to the human
   *  stage's step rate (which is a share of ANSWERS) would compare two
   *  different things and call it a verdict.
   *
   *  `basis` also decides which number the rung's COLOUR sits on: a rung
   *  carrying a band is coloured by that band, on that band's denominator, and
   *  the other percentage demotes to a plain uncoloured stat. See the
   *  precedence note in StageBars. */
  benchmark?: { id: BenchmarkId; basis: "ofTotal" | "step" } | null;
  /** UNREADABLE, not zero: the count comes from a source that failed to load
   *  (the pipeline read for the Applications rung). Draws "—", never "0". */
  unreadable?: boolean;
  /** A second line under the rung's label — the Applications rung uses it for
   *  "X with statements". */
  secondaryLine?: ReactNode;
}

/** The deal-derived Applications rung, computed from `deals` (not calls) for the
 *  same scope+range as the dial funnel above it.
 *    • object → applications on file + how many also have statements
 *    • null   → the pipeline read failed (UNREADABLE — draws "—", never 0)
 *    • absent (undefined) → this scope has no setter to attribute deals to
 *                           (an unassigned NUMBER card), so the rung is omitted */
interface AppsRung {
  applications: number;
  withStatements: number;
  /** Σ amount_requested across the in-range applications — dollars added to the
   *  pipeline (partials included). */
  askTotal: number;
}

function funnelStagesOf(f: FunnelCounts, apps?: AppsRung | null): FunnelStage[] {
  const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : null);
  const stages: FunnelStage[] = [
    {
      key: "dials", label: "Dials", short: "Dials", help: "Outbound call rows in this range",
      count: f.dials, stepLabel: "—", stepShort: "—", stepPct: null, targetKey: null,
    },
    {
      key: "connects", label: "Connects", short: "Connects",
      help: "WAVV recorded an answer timestamp — INCLUDING answering machines",
      count: f.connects, stepLabel: "of dials answered", stepShort: "answered",
      stepPct: pct(f.connects, f.dials), targetKey: "answer_rate_pct",
    },
    {
      key: "human", label: "Reached a human", short: "Humans",
      help: "Answered, and nothing about the call says machine: outcome is not VOICEMAIL / NO_VOICEMAIL / NO_ANSWER / NO_CALLBACK, the setter did not disposition it 'Voice Message' or 'No Answer', and no 'Played voicemail' note. WAVV's own human flag is NOT used — it marks voicemails as human.",
      count: f.humans, stepLabel: "of answers were human", stepShort: "were human",
      stepPct: pct(f.humans, f.connects), targetKey: null,
      // Deliberately UNCOLOURED (grey). Reaching a human is a diagnostic count
      // between Connects and Conversations — there is no reliable MCA industry
      // standard for raw human-pickup, and the 3–5% "contact rate" band is a
      // real-CONVERSATION rate, not a human-answered rate, so it lives on the
      // Conversations rung below. Never a false green.
      benchmark: null,
    },
    {
      key: "conversations", label: "Conversations", short: "Conversations", help: CONVERSATION_HELP,
      count: f.conversations, stepLabel: "of humans dispositioned as a talk", stepShort: "of humans talked",
      stepPct: pct(f.conversations, f.humans), targetKey: "conversation_rate_pct",
      // The industry "3–5% of dials" cold-dial CONTACT rate is a real-conversation
      // rate (reached a live decision-maker and talked), NOT a raw human-pickup
      // rate — so the band lives here, judged against this rung's "% of dials"
      // line (conversations ÷ dials). Below 3% reads amber, honestly.
      benchmark: { id: "contact_rate", basis: "ofTotal" },
    },
    {
      key: "positives", label: "Positive dispositions", short: "Positives",
      help: POSITIVE_DISPOSITIONS.join(" · "),
      count: f.positives, stepLabel: "of conversations", stepShort: "of talks",
      stepPct: pct(f.positives, f.conversations), targetKey: "positive_rate_pct",
    },
  ];

  // ── Applications: the HARD outcome under Positives ──────────────────────────
  // Positives counts soft, fakeable dispositions (Interested, Callback…). This
  // rung counts what actually predicts funding: a real application on FILE, read
  // from `deals` — distinct deals whose application_sent_at lands in the range,
  // attributed to this scope's setter — with "App + statements" (also reached
  // bank statements) as the sub-figure. Judged apps ÷ conversations against the
  // industry 2–4% app-per-conversation band, which CARRIES the rung's colour
  // (basis:"step" → the "% of conversations" chip is the coloured number).
  // `apps === undefined` → no setter to attribute to; the rung is omitted.
  if (apps !== undefined) {
    const unreadable = apps === null;
    const applications = apps?.applications ?? 0;
    const withStatements = apps?.withStatements ?? 0;
    const askTotal = apps?.askTotal ?? 0;
    stages.push({
      key: "applications", label: "Applications", short: "Apps",
      help:
        "Distinct deals whose application_sent_at falls in this range, attributed to the assigned setter — a real application on file, NOT a typed disposition. \"with statements\" = those that also reached the Bank Statements rung (a bank_statements_at / docs_collected_at stamp, or a current/pre-park status at Bank Statements or deeper).",
      count: applications,
      stepLabel: "of conversations", stepShort: "of talks",
      stepPct: unreadable ? null : pct(applications, f.conversations),
      targetKey: null,
      benchmark: unreadable ? null : { id: "app_per_conversation", basis: "step" },
      unreadable,
      secondaryLine: unreadable ? (
        <span className="text-amber-600 dark:text-amber-400">pipeline unreadable — unknown, not zero</span>
      ) : (
        <>
          <b className="tabular-nums text-gray-600 dark:text-gray-300">{withStatements.toLocaleString()}</b> with statements
          {askTotal > 0 && (
            <>
              {" · "}
              <b className="tabular-nums text-emerald-600 dark:text-emerald-400">
                ${Math.round(askTotal).toLocaleString()}
              </b>{" "}
              added to pipeline
            </>
          )}
        </>
      ),
    });
  }

  return stages;
}

/** How the Funnel tab is sliced. Combined is the default and is the team-wide
 *  funnel exactly as it has always rendered.
 *
 *  There is deliberately NO "by number" view: a setter is assigned to a single
 *  number 1:1, so by-number would draw the identical funnel under a different
 *  heading. The by-number case that DOES carry information — a number nobody is
 *  assigned to — is folded into "By setter" as its own card, titled with the
 *  line rather than with an invented person. */
type FunnelView = "combined" | "setter";
const FUNNEL_VIEWS: { id: FunnelView; label: string }[] = [
  { id: "combined", label: "Combined" },
  { id: "setter",   label: "By setter" },
];

/** One grouped slice of the loaded rows — a setter, or an unassigned line.
 *  Never a fabricated person: an unattributed row keeps its number's identity. */
interface FunnelGroup {
  key: string;
  title: string;
  subtitle: string;
  unassigned: boolean;
  calls: SetterCall[];
}

/** Looks a KPI threshold up, and says whether it came from the stored settings
 *  blob or a built-in default. Passed down so a card never invents a target. */
type TargetLookup = (key: string) => { target: KpiTarget | null; isDefault: boolean };

const UNASSIGNED_FILTER = "__unassigned__";

/** The shortest range from which a MONTHLY per-rep funding pace may be
 *  extrapolated. The industry band is "4–8 funded a month"; scaling a single
 *  day up by thirty to meet it would manufacture a verdict out of one deal, so
 *  below this the comparison is withheld and the reason is printed. */
const PACE_MIN_DAYS = 14;

// ── Table chrome ─────────────────────────────────────────────────────────────
// One set of classes for every table on the page. DaisyUI's table-sm/table-xs
// packs cells so tightly that a number runs into the percentage beside it
// ("43056.9%"), so padding is set explicitly here instead. Numeric columns are
// right-aligned and tabular so digits line up in a column.
const TABLE_WRAP = "overflow-x-auto rounded-lg border border-base-300";
const TABLE = "table w-full";
const THEAD = "bg-base-200/60 dark:bg-gray-800/50";
const TH = "px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 whitespace-nowrap border-b border-base-300";
const TH_NUM = `${TH} text-right`;
const TD = "px-3 py-2.5 text-sm text-gray-700 dark:text-gray-200";
const TD_NUM = `${TD} text-right tabular-nums whitespace-nowrap`;
const TBODY = "divide-y divide-base-300/70";
const TR = "hover:bg-base-200/40 dark:hover:bg-gray-800/30 transition-colors";
/** The vertical rule that separates the two column GROUPS in the Setters table. */
const GROUP_EDGE = "border-l border-base-300";

// ── Date helpers ─────────────────────────────────────────────────────────────
// Ranges are chosen in the MANAGER'S LOCAL DAY (a shift is a local-clock thing),
// then converted to UTC instants for the started_at filters, because started_at
// is timestamptz. dayStart/dayEnd therefore build local midnights and let
// toISOString do the conversion.
function localDayStart(offsetDays = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  d.setHours(0, 0, 0, 0);
  return d;
}
function localDayEnd(offsetDays = 0): Date {
  const d = localDayStart(offsetDays);
  d.setDate(d.getDate() + 1);
  return d;
}
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
/** A yyyy-mm-dd from a <input type="date"> is a LOCAL calendar day, so it is
 * built as local midnight (not Date.parse, which would read it as UTC). */
function parseYmdLocal(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
}
/** True when an ISO instant falls inside the active range. Used for the deal
 *  columns, where three different timestamps are filtered from one query. */
function inRange(iso: string | null, from: Date, to: Date): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= from.getTime() && t < to.getTime();
}

type RangeKey = "today" | "yesterday" | "7d" | "30d" | "custom";
const RANGE_LABELS: Record<RangeKey, string> = {
  today: "Today", yesterday: "Yesterday", "7d": "Last 7 days", "30d": "Last 30 days", custom: "Custom",
};
/** Ranges that are ONE day wide. A trend drawn over one of these is a single
 *  dot — true, but useless — so the Trends tab widens away from them. */
const SINGLE_DAY_RANGES: RangeKey[] = ["today", "yesterday"];
/** What Trends widens TO. */
const TRENDS_RANGE: RangeKey = "7d";

/** Stamped in US Eastern, and LABELLED as Eastern in the header, because the
 *  floor runs on an Eastern clock while the managers reading this do not all
 *  sit in it. The date-range pills stay on the reader's local day (see above) —
 *  the column tooltip carries the reader's own clock so the two are never
 *  silently conflated. */
function etStamp(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}
function localTimeTitle(iso: string | null): string {
  if (!iso) return "No start time reported by WAVV";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "No start time reported by WAVV";
  return `Your local time: ${d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
}

function sinceText(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function hms(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

function prettyPhone(p: string | null): string {
  if (!p) return "—";
  const d = p.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return p;
}

function usd(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

/** How a call's dialing side should be named: the assigned setter, else the
 *  number's admin label, else the number itself. Never a guess. */
function attributionName(r: { setter_name: string | null; caller_label: string | null; caller_id: string | null }): string {
  return r.setter_name ?? r.caller_label ?? (r.caller_id ? prettyPhone(r.caller_id) : "Unknown number");
}

// ── Honest metric rendering ──────────────────────────────────────────────────
// NULL means the mirror has no value for this metric. It renders as a dimmed
// dash — never 0, which would read as real activity ("this rep made zero calls")
// when it is actually absent data.
function Metric({ value, suffix = "", digits = 0 }: { value: number | null; suffix?: string; digits?: number }) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return <span className="text-gray-300 dark:text-gray-600" title="Not reported by WAVV for these calls">—</span>;
  }
  return <span>{value.toFixed(digits)}{suffix}</span>;
}

function Text({ value }: { value: string | null }) {
  if (!value) return <span className="text-gray-300 dark:text-gray-600" title="Not reported by WAVV">—</span>;
  return <span>{value}</span>;
}

// ── RAG (red / amber / green) ────────────────────────────────────────────────
// Thresholds live in platform_settings.ph_dialer_kpi_targets so the owner can
// tune them without a deploy. BAND SEMANTICS (one rule, every metric):
//   direction 'higher' → green when value >= green, else amber when >= amber, else red
//   direction 'lower'  → green when value <= green, else amber when <= amber, else red
// Both comparisons are INCLUSIVE of the named edge.
//
// A metric with no value, or with no stored/known threshold, is GREY ("no
// target"). Green must always mean a real number was measured against a real
// threshold — never a default that happens to be lenient.
interface KpiTarget {
  label: string;
  direction: "higher" | "lower";
  green: number;
  amber: number;
  unit?: string;
}
type Rag = "green" | "amber" | "red" | "none";

// Built-in fallbacks for the funnel-stage rates, which the HotProspector-era
// settings blob never had keys for. These are marked in the UI as defaults so a
// manager can tell a tuned threshold from a guessed one.
const DEFAULT_TARGETS: Record<string, KpiTarget> = {
  answer_rate_pct:       { label: "Answer rate",       direction: "higher", green: 35, amber: 20, unit: "%" },
  human_rate_pct:        { label: "Reached a human",   direction: "higher", green: 30, amber: 15, unit: "%" },
  conversation_rate_pct: { label: "Conversation rate", direction: "higher", green: 15, amber: 7,  unit: "%" },
  positive_rate_pct:     { label: "Positive rate",     direction: "higher", green: 25, amber: 15, unit: "%" },
};

function ragOf(value: number | null, t: KpiTarget | null): Rag {
  if (t === null || value === null || !Number.isFinite(value)) return "none";
  if (t.direction === "lower") {
    if (value <= t.green) return "green";
    if (value <= t.amber) return "amber";
    return "red";
  }
  if (value >= t.green) return "green";
  if (value >= t.amber) return "amber";
  return "red";
}

const RAG_TEXT: Record<Rag, string> = {
  green: "text-emerald-600 dark:text-emerald-400",
  amber: "text-amber-600 dark:text-amber-400",
  red:   "text-red-600 dark:text-red-400",
  none:  "text-gray-400 dark:text-gray-500",
};
const RAG_CHIP: Record<Rag, string> = {
  green: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
  red:   "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30",
  none:  "bg-gray-500/10 text-gray-500 dark:text-gray-400 border-gray-500/30",
};
const RAG_BAR: Record<Rag, string> = {
  green: "bg-emerald-500", amber: "bg-amber-500", red: "bg-red-500", none: "bg-gray-400",
};

/** A percentage with its RAG colour and a tooltip naming the threshold it was
 *  judged against — so a colour is never an unexplained opinion. */
function RagPct({ value, target, digits = 1 }: { value: number | null; target: KpiTarget | null; digits?: number }) {
  const rag = ragOf(value, target);
  if (value === null || !Number.isFinite(value)) return <Metric value={null} />;
  const title = target
    ? `Target: ${target.direction === "lower" ? "≤" : "≥"}${target.green}% green, ${target.direction === "lower" ? "≤" : "≥"}${target.amber}% amber`
    : "No threshold configured for this metric — not judged";
  return <span className={`font-semibold ${RAG_TEXT[rag]}`} title={title}>{value.toFixed(digits)}%</span>;
}

// ── Per-setter aggregate shape ───────────────────────────────────────────────
interface SetterRow {
  key: string;              // profiles.id, or `caller:<digits>` for an unassigned number
  name: string;
  attributed: boolean;      // false = a number with nobody assigned to it
  numbers: string[];        // caller_ids feeding this row
  dials: number;
  connects: number;
  human: number;
  conversations: number;
  positives: number;
  talkSeconds: number;
  connectedSeconds: number;
  activeDays: number;
  uniqueLeads: number;
  // Pipeline side — only meaningful for a real setter (deals join on profiles.id)
  appointments: number | null;
  appsSent: number | null;
  funded: number | null;
  fundedAmount: number | null;
}

// ═════════════════════════════════════════════════════════════════════════════
// TALK TIME — is the floor TALKING, or just blasting voicemails?
// ═════════════════════════════════════════════════════════════════════════════
// The Setters scorecard ranks by DIALS, which is exactly the number that misleads
// here: a seat can triple everyone's dial count by hanging up on machines faster.
// This tab puts dials and real conversation time side by side.
//
// ── WHY THIS TAB IS BY LINE AND NOT BY PERSON ────────────────────────────────
// The rest of the page attributes a call to whoever the Numbers tab mapped its
// caller_id to. For COUNTING dials that map is the best available handle. For
// TALK TIME it is not good enough, because the two outbound numbers are dialed
// by MULTIPLE SEATS AT ONCE. That is measured, not suspected — three independent
// reads of wavv_calls agree:
//   • a sweep over started_at/ended_at peaks at 10 simultaneous calls on line 1
//     and 7 on line 2, where one WAVV seat power-dials about 4;
//   • 4,144 pairs of calls on one day literally overlap in time on the same line;
//   • 17 pairs of those overlaps are BOTH live human conversations — and one
//     person cannot hold two conversations at once.
// WAVV's call object carries no per-agent field at all (see the file header), so
// there is no second signal to fall back on. A per-person talk-time row would
// therefore be one person's NAME worn by the whole floor's traffic — invented,
// not measured. So every aggregate on this tab is BY LINE plus a floor total,
// and the mapped name appears only as a caveated secondary label.
//
// The one genuinely per-person signal in range is the setter's own check-in from
// time_entries, so that gets its own table and is deliberately NOT divided into
// line talk-minutes.
//
// ── WHAT COUNTS AS TALKING ───────────────────────────────────────────────────
// `seconds` on the mirror is the CONNECTED duration — ended_at minus answered_at,
// verified against the data (the two agree to the decimal), so it is 0/absent on
// a line nobody picked up. But a played voicemail is "connected" too, and on this
// floor most of the connected clock is exactly that. So TALK SECONDS = the
// seconds on calls reachedHuman() accepts, and nothing else. Seconds spent on an
// answering machine are counted separately as MACHINE TIME and shown next to it —
// not folded in, and not thrown away.
//
// NOTHING HERE IS INFERRED FROM AN EMPTY RESULT. A setter with no check-in has no
// clocked hours, which renders "—". The clock is not read at all unless the
// session can see the whole floor's entries (see loadTimeEntries).

/** One OUTBOUND LINE over the range. NOT a person — see the block above. */
interface TalkRow {
  key: string;                    // caller_id, or "unknown" for rows carrying none
  /** 1-based display index, assigned by dials descending: "Line 1", "Line 2". */
  lineNo: number;
  callerId: string | null;
  /** The admin's label for the line, else the formatted number. */
  lineLabel: string;
  /** Who the Numbers tab maps this line to. Shown ONLY as a caveated secondary
   *  label ("mapped: …"), never as the row's identity — the line is shared. */
  mappedName: string | null;
  mappedSetterId: string | null;
  dials: number;
  connects: number;
  humans: number;                 // reachedHuman()
  conversations: number;          // isConversation() — dispositioned as a talk
  /** Seconds on human-reached calls only. THE talk-time number. */
  talkSeconds: number;
  /** Seconds on answered calls that did NOT reach a human — machine time. */
  machineSeconds: number;
  activeDays: number;
  /** Distinct local (day, hour) buckets holding at least one dial. */
  activeHours: number;
  /** Longest run of minutes between two consecutive dials INSIDE one local day.
   *  null when no day in range holds two dials, so there is no gap to measure —
   *  that is unmeasurable, not a perfect zero-idle shift.
   *
   *  ON A SHARED LINE THIS IS A FLOOR SIGNAL: it says the whole line went quiet,
   *  which is a real operational fact, but it can never say WHO stopped dialing. */
  longestIdleGapMin: number | null;
  /** When the longest gap started/ended, for the tooltip. */
  idleGapFrom: string | null;
  idleGapTo: string | null;
  /** Most calls in flight at once on this line — the seat-count evidence, shown
   *  in the table so the sharing caveat carries its own proof. null when no row
   *  has both a start and an end to sweep. */
  peakConcurrent: number | null;
  /** Most LIVE CONVERSATIONS in flight at once. ≥2 is proof of multiple people:
   *  one person cannot talk to two merchants simultaneously. */
  peakConcurrentHuman: number | null;
}

/** The sentinel key for the whole-floor block on the heatmap. */
const FLOOR_KEY = "__floor__";

/** Most spans overlapping at any instant. Ends sort BEFORE starts at an equal
 *  timestamp, so a call that ends exactly as the next begins is not an overlap. */
function peakConcurrency(spans: { s: number; e: number }[]): number | null {
  if (spans.length === 0) return null;
  const ev: { t: number; d: number }[] = [];
  for (const sp of spans) { ev.push({ t: sp.s, d: 1 }); ev.push({ t: sp.e, d: -1 }); }
  ev.sort((a, b) => a.t - b.t || a.d - b.d);
  let cur = 0, mx = 0;
  for (const e of ev) { cur += e.d; if (cur > mx) mx = cur; }
  return mx;
}

/** One local day of one setter's dial clock, bucketed by local hour. */
interface TalkGridDay {
  day: string;                    // yyyy-mm-dd, local
  dials: number[];                // length 24
  talkSeconds: number[];          // length 24
}

/** public.time_entries — the worker's own check-in. `hours` is CLAIMED; clock_in
 *  / clock_out is the real span when the worker used the clock. */
interface TimeEntryRow {
  user_id: string;
  work_date: string;
  hours: number | string | null;
  clock_in: string | null;
  clock_out: string | null;
  break_minutes: number | string | null;
}

/** Minutes on the clock for one logged day, and whether that came from a real
 *  clock-in/out span or from the hours the worker typed. The distinction is
 *  surfaced, because a claimed 8 hours is a different kind of fact. */
function entryMinutes(e: TimeEntryRow): { minutes: number; fromClock: boolean } {
  if (e.clock_in && e.clock_out) {
    const span = (new Date(e.clock_out).getTime() - new Date(e.clock_in).getTime()) / 60000;
    if (Number.isFinite(span) && span > 0) {
      const brk = Number(e.break_minutes ?? 0);
      return { minutes: Math.max(0, span - (Number.isFinite(brk) ? brk : 0)), fromClock: true };
    }
  }
  const h = Number(e.hours ?? 0);
  return { minutes: Number.isFinite(h) ? h * 60 : 0, fromClock: false };
}

/** What one setter's shift looked like against the clock. Every field is
 *  nullable on purpose — a missing check-in must never render as 0% occupancy. */
interface Occupancy {
  clockedMinutes: number;
  daysLogged: number;
  /** False when at least one of those days was a typed hours claim, not a clock span. */
  allFromClock: boolean;
}

const TALK_DEF =
  "Talk time = seconds on calls that reached a LIVE PERSON. A played voicemail is a connection, not a conversation, so its seconds are counted as machine time instead — never as talking.";

type TalkMetric = "dials" | "talk";

// ── Heatmap shading ──────────────────────────────────────────────────────────
// One emerald ramp, square-rooted so a light hour is still visible next to a
// heavy one, drawn as inline rgba because the intensity is per-cell. An hour
// with zero activity gets NO fill — it reads as the empty track, so "quiet at
// 11" is visible as a hole rather than as a very faint green.
function heatFill(value: number, max: number): string | undefined {
  if (value <= 0 || max <= 0) return undefined;
  // Clamped: the whole-floor block is the SUM of the line blocks and routinely
  // runs past the per-line peak that sets the scale, so it saturates rather than
  // running off the end of the ramp into an invalid alpha.
  const a = 0.14 + 0.76 * Math.min(1, Math.sqrt(value / max));
  return `rgba(16, 185, 129, ${a.toFixed(3)})`;
}

function hourLabel(h: number): string {
  if (h === 0) return "12a";
  if (h === 12) return "12p";
  return h < 12 ? `${h}a` : `${h - 12}p`;
}

type TabId = "funnel" | "setters" | "talk_time" | "live_transfers" | "realtime" | "assignments" | "dial_ceiling" | "dispositions" | "review" | "trends" | "log" | "numbers" | "operations" | "audit";
const TABS: { id: TabId; label: string; icon: typeof PhoneIcon; adminOnly?: boolean; superOnly?: boolean }[] = [
  { id: "funnel",         label: "Funnel",         icon: FunnelIcon },
  // Right of Funnel (owner-specified): the setter's single-merchant working
  // surface — opens ONE merchant into the ops console (deep-linked from a contact
  // link, or searched by business / name / phone / email). Renders outside the
  // WAVV gate — it reads `deals`, not the dialer sync.
  { id: "operations",     label: "Operations",     icon: PhoneArrowUpRightIcon },
  { id: "setters",        label: "Setters",        icon: UserGroupIcon },
  // Sits next to Setters because it answers the follow-up question that table
  // raises: the scorecard says who DIALS most, this one says who TALKS most.
  { id: "talk_time",      label: "Talk Time",      icon: ClockIcon },
  { id: "dispositions",   label: "Dispositions",   icon: ChartBarIcon },
  // Immediately after Dispositions because it is that tab's exception list: the
  // calls that were real talks and came back with no honest outcome.
  { id: "review",         label: "Disposition Review", icon: ExclamationTriangleIcon },
  { id: "trends",         label: "Trends",         icon: ArrowTrendingUpIcon },
  { id: "log",            label: "Call log",       icon: ChatBubbleLeftRightIcon },
  // The two DEALS-based tabs sit after the WAVV tabs — they answer a different
  // question (lead-source cohorts), so they read as a separate block.
  { id: "live_transfers", label: "Live Transfers", icon: ArrowsRightLeftIcon },
  { id: "realtime",       label: "Real-Time",      icon: BoltIcon },
  // Sits right after the two lead-source tabs because it is the working end of
  // them: those two say how a COHORT converted, this one hands the setter the
  // individual merchants and the buttons to move them.
  { id: "assignments",    label: "Assignments",    icon: ClipboardDocumentListIcon },
  // Immediately right of Assignments: it answers the OTHER half of "how is this
  // setter doing". The scorecard tabs count dials; this one asks how much of the
  // shift produced them (occupancy) and how much of the "talking" is real.
  { id: "dial_ceiling",   label: "Dial Ceiling",   icon: ScaleIcon },
  { id: "numbers",        label: "Numbers",        icon: HashtagIcon, adminOnly: true },
  // End-of-day call-quality audit (transcript-classified) — OWNER ONLY. Setters
  // and admins never see this tab; the data behind it is super_admin-RLS'd too.
  { id: "audit",          label: "Call Audit",     icon: ShieldCheckIcon, superOnly: true },
];

/** The two DEALS-based tabs. They read a different table from every other tab,
 *  so they render outside the WAVV load gate and skip the WAVV banners. */
const SOURCE_TAB_IDS = ["live_transfers", "realtime"] as const;
function isSourceTab(t: TabId): t is "live_transfers" | "realtime" {
  return (SOURCE_TAB_IDS as readonly string[]).includes(t);
}

export default function SetterPerformancePage() {
  const { isAdmin, isSuperAdmin, effectiveUserId } = useUserProfile();
  const canManageNumbers = isAdmin || isSuperAdmin;

  const [tab, setTab] = useState<TabId>("funnel");
  // A setter contact link (?deal / ?contact / ?phone / legacy ?x=) or an explicit
  // ?tab=operations must land on the Operations console, not the Funnel default.
  // Runs once on mount — usePlaybookContact (inside SetterOpsTab) then parses and
  // strips those same params, so this reads them before they're gone.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (
      sp.get("tab") === "operations" ||
      sp.has("deal") ||
      sp.has("contact") ||
      sp.has("phone") ||
      sp.has("x")
    ) {
      setTab("operations");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /** Sub-toggle INSIDE the Funnel panel — not a page tab. Combined is default. */
  const [funnelView, setFunnelView] = useState<FunnelView>("combined");
  /** Scroll target for the funnel's clickable "Positive dispositions" count. */
  const positivesRef = useRef<HTMLDivElement | null>(null);
  const [positivesHighlight, setPositivesHighlight] = useState(false);
  // Opens on TODAY: this page is read as a shift monitor — "how is the floor
  // doing right now" — so the first paint must be today's dials, not a 7-day
  // blend that hides a dead morning.
  const [rangeKey, setRangeKey] = useState<RangeKey>("today");
  const [customFrom, setCustomFrom] = useState<string>(ymd(localDayStart(6)));
  const [customTo, setCustomTo] = useState<string>(ymd(localDayStart(0)));
  /** Set the moment the manager picks a range themselves. Once set, the Trends
   *  auto-widen below never fires again for the session — an explicit choice is
   *  never overridden, and never silently undone. */
  const [rangePinned, setRangePinned] = useState(false);
  /** The single-day range Trends widened away from, held so leaving Trends can
   *  put it back. Null means "we did not touch the range". */
  const [widenedFrom, setWidenedFrom] = useState<RangeKey | null>(null);

  const [aggRows, setAggRows] = useState<SetterCall[]>([]);
  const [aggregateTruncated, setAggregateTruncated] = useState(false);
  // The server's exact call count for the active range — the ground truth the
  // folded row set is checked against.
  const [rangeTotal, setRangeTotal] = useState<number | null>(null);
  const [totalRowsEver, setTotalRowsEver] = useState<number | null>(null);
  const [syncState, setSyncState] = useState<SyncState | null>(null);
  const [dealRows, setDealRows] = useState<DealRow[] | null>(null);
  const [dealsError, setDealsError] = useState<string | null>(null);
  // Productive contacts (the pipeline-side positive). null = UNREADABLE, which
  // renders as an error — never as "this setter produced nothing".
  const [productiveDeals, setProductiveDeals] = useState<ProductiveDeal[] | null>(null);
  /** In-range application pushes grouped by the AUTHOR who sent them (distinct
   *  deals + Σ ask) — the digest's apps columns. null = unreadable (falls back). */
  const [appsByAuthor, setAppsByAuthor] = useState<Map<string, { apps: number; askTotal: number }> | null>(null);
  const [productiveError, setProductiveError] = useState<string | null>(null);
  const [productiveLoading, setProductiveLoading] = useState(true);
  const [productiveTruncated, setProductiveTruncated] = useState(false);
  /** profiles.id → name, for every setter on EITHER side of the union (dials or
   *  pipeline). Resolved via staff_directory, the staff-readable source. */
  const [staffNames, setStaffNames] = useState<Record<string, string>>({});
  // Disposition Review: the pipeline state of the contacts behind the flagged
  // calls, keyed by ghl_contact_id. null = not read yet / unreadable.
  const [reviewDeals, setReviewDeals] = useState<Record<string, ProductiveDeal> | null>(null);
  const [reviewDealsError, setReviewDealsError] = useState<string | null>(null);
  const [reviewDealsLoading, setReviewDealsLoading] = useState(false);
  // Positive dispositions: the merchants behind those calls, read by contact id
  // and NOT bounded by the range (see the block above the fetch). [] = read and
  // empty; null = never read / unreadable, which renders "—" like any unknown.
  const [positiveDeals, setPositiveDeals] = useState<ProductiveDeal[] | null>(null);
  const [positiveDealsError, setPositiveDealsError] = useState<string | null>(null);
  // Synergy lead cohorts (Live Transfers / Real-Time tabs). null = UNREADABLE,
  // which renders as an error, never as an empty cohort.
  const [sourceDeals, setSourceDeals] = useState<SourceDeal[] | null>(null);
  const [sourceDealsError, setSourceDealsError] = useState<string | null>(null);
  const [sourceDealsLoading, setSourceDealsLoading] = useState(true);
  /** The cohort query hit its row cap — REPORTED, never silently absorbed. */
  const [sourceDealsTruncated, setSourceDealsTruncated] = useState(false);
  /** profiles.id → display name, for deals.assigned_closer_id. Only super admins
   *  can read public.profiles, so this map can legitimately come back empty for
   *  a closer/employee session — the UI says so instead of inventing names. */
  const [closerNames, setCloserNames] = useState<Record<string, string>>({});
  const [targets, setTargets] = useState<Record<string, KpiTarget> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Talk Time tab: which metric the activity heatmap shades by, and the shift
  // clock behind occupancy. `timeEntries` null = NOT READ (see loadTimeEntries),
  // which is a different fact from an empty array (read fine, nobody logged).
  const [talkMetric, setTalkMetric] = useState<TalkMetric>("talk");
  const [timeEntries, setTimeEntries] = useState<TimeEntryRow[] | null>(null);
  const [timeEntriesError, setTimeEntriesError] = useState<string | null>(null);
  /** profiles.id → display name for whoever logged a check-in in the range. */
  const [clockedNames, setClockedNames] = useState<Record<string, string>>({});

  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "dials", desc: true });

  // Call log (its own paged query — the aggregate slice is not reused, so the log
  // stays correct even when the aggregate pass hits its row cap).
  const [logRows, setLogRows] = useState<SetterCall[]>([]);
  const [logCount, setLogCount] = useState<number | null>(null);
  const [logPage, setLogPage] = useState(0);
  const [logLoading, setLogLoading] = useState(false);
  const [filterSetter, setFilterSetter] = useState<string>("all");
  const [filterNumber, setFilterNumber] = useState<string>("all");
  const [filterDisposition, setFilterDisposition] = useState<string>("all");
  const [filterMinSeconds, setFilterMinSeconds] = useState<string>("");
  const [filterOutcome, setFilterOutcome] = useState<string>("all");
  const [filterContact, setFilterContact] = useState<"all" | "human" | "machine">("all");
  const [filterRecording, setFilterRecording] = useState<"all" | "yes" | "no">("all");
  /** What the user is typing, and what has actually been sent. Debounced so a
   *  10-character name is one server round trip, not ten. */
  const [logSearch, setLogSearch] = useState<string>("");
  const [logSearchApplied, setLogSearchApplied] = useState<string>("");

  // Numbers tab (admin control surface for attribution).
  const [numberRows, setNumberRows] = useState<NumberRow[] | null>(null);
  const [setterOptions, setSetterOptions] = useState<SetterOption[]>([]);
  const [numbersError, setNumbersError] = useState<string | null>(null);
  const [savingNumber, setSavingNumber] = useState<string | null>(null);
  const [numberDrafts, setNumberDrafts] = useState<Record<string, { setter_id: string; label: string }>>({});
  const [numberSaved, setNumberSaved] = useState<string | null>(null);

  // Per-row on-demand media. Signed recording URLs live in component state ONLY —
  // they expire in ~72h, so persisting one would rot into a link that looks valid.
  const [media, setMedia] = useState<Record<string, {
    loadingRec?: boolean; url?: string | null; recError?: string | null;
    open?: boolean; loadingTx?: boolean; transcript?: string | null; summary?: string | null; txError?: string | null;
  }>>({});

  // ── The active range as UTC instants ──────────────────────────────────────
  const range = useMemo(() => {
    switch (rangeKey) {
      case "today":     return { from: localDayStart(0), to: localDayEnd(0) };
      case "yesterday": return { from: localDayStart(1), to: localDayEnd(1) };
      case "7d":        return { from: localDayStart(6), to: localDayEnd(0) };
      case "30d":       return { from: localDayStart(29), to: localDayEnd(0) };
      case "custom": {
        const from = parseYmdLocal(customFrom);
        const to = parseYmdLocal(customTo);
        to.setDate(to.getDate() + 1); // inclusive of the chosen end day
        return { from, to };
      }
    }
  }, [rangeKey, customFrom, customTo]);

  // ── Trends needs more than one day to BE a trend ──────────────────────────
  // Every other tab is a shift monitor ("how is the floor doing right now"), so
  // Today is the right default for them and stays. Trends is the one tab whose
  // whole job is the shape over time, and Today renders it as a single point.
  // So: opening Trends from an untouched single-day range widens to Last 7 days
  // and leaving Trends puts the old range back — Funnel/Setters still open on
  // Today. Any explicit pill click pins the range and retires this for good.
  useEffect(() => {
    if (rangePinned) return;
    if (tab === "trends") {
      if (widenedFrom === null && SINGLE_DAY_RANGES.includes(rangeKey)) {
        setWidenedFrom(rangeKey);
        setRangeKey(TRENDS_RANGE);
      }
    } else if (widenedFrom !== null) {
      setRangeKey(widenedFrom);
      setWidenedFrom(null);
    }
  }, [tab, rangeKey, rangePinned, widenedFrom]);

  /** True while the chart is showing a window the manager did not ask for. It
   *  is labelled on the card rather than applied invisibly. */
  const trendAutoWidened = widenedFrom !== null;

  const fromIso = range.from.toISOString();
  const toIso = range.to.toISOString();

  // ── Load: sync state + targets + total-ever count + the range slice ───────
  // `to` is the EXCLUSIVE next local midnight, so the bound is .lt — .lte would
  // pull the first instant of the following day into the range.
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [stateRes, targetRes, countRes, rangeCountRes] = await Promise.all([
        supabase.from("platform_settings").select("value").eq("key", "wavv_sync").maybeSingle(),
        supabase.from("platform_settings").select("value").eq("key", "ph_dialer_kpi_targets").maybeSingle(),
        supabase.from(CALLS_VIEW).select("wavv_call_id", { count: "exact", head: true }),
        // The range's TRUE dial count, aggregated server-side and never subject
        // to max-rows. This is the yardstick the paged pull below is measured
        // against, so "did we get everything" is answered by comparing two
        // numbers rather than by trusting however many rows happened to arrive.
        supabase.from(CALLS_VIEW)
          .select("wavv_call_id", { count: "exact", head: true })
          .gte("started_at", fromIso)
          .lt("started_at", toIso),
      ]);

      if (stateRes.error) throw new Error(stateRes.error.message);
      if (countRes.error) throw new Error(countRes.error.message);
      if (rangeCountRes.error) throw new Error(rangeCountRes.error.message);

      setSyncState((stateRes.data?.value ?? null) as SyncState | null);
      // A failed/absent targets read leaves targets null — every RAG then reads
      // "no target" (grey), which is the honest state, not a silent all-green.
      setTargets(targetRes.error ? null : ((targetRes.data?.value ?? null) as Record<string, KpiTarget> | null));
      setTotalRowsEver(countRes.count ?? 0);
      const rangeTotal = rangeCountRes.count ?? 0;

      // Page the slice. The server already told us how many rows there are, so
      // the exact page count is known up front and every page is fetched in ONE
      // parallel burst — a 30-day range is 13 pages, which would be 13 sequential
      // round trips otherwise, and firing them together also keeps the pages as
      // close to a single snapshot as the client can get.
      //
      // started_at alone is NOT a total order — two calls can share an instant,
      // and offset paging over a non-deterministic sort can repeat one row and
      // drop another across a page seam. wavv_call_id breaks every tie and pins
      // the order; it is unique in the view, so the de-dupe below is belt-and-
      // braces against a row landing mid-flight and shifting the offsets.
      const wanted = Math.min(rangeTotal, AGG_ROW_CAP);
      const pageCount = Math.ceil(wanted / AGG_PAGE_SIZE);
      const pageResults = await Promise.all(
        Array.from({ length: pageCount }, (_, i) => supabase.from(CALLS_VIEW)
          .select(CALL_COLS)
          .gte("started_at", fromIso)
          .lt("started_at", toIso)
          .order("started_at", { ascending: false })
          .order("wavv_call_id", { ascending: false })
          .range(i * AGG_PAGE_SIZE, Math.min((i + 1) * AGG_PAGE_SIZE, wanted) - 1)),
      );

      const seen = new Set<string>();
      const rows: SetterCall[] = [];
      for (const pageRes of pageResults) {
        // One failed page makes the whole fold wrong, so it fails the load
        // rather than quietly shrinking the funnel.
        if (pageRes.error) throw new Error(pageRes.error.message);
        for (const r of (pageRes.data ?? []) as SetterCall[]) {
          if (seen.has(r.wavv_call_id)) continue;
          seen.add(r.wavv_call_id);
          rows.push(r);
        }
      }

      setAggRows(rows);
      setRangeTotal(rangeTotal);
      // Truncated now means ONE thing: the range genuinely exceeds the ceiling
      // we chose to stop at. It is decided by the server's own count, so it can
      // no longer be fooled by — nor silently hide — a max-rows cut.
      setAggregateTruncated(rangeTotal > AGG_ROW_CAP);
    } catch (e) {
      // A failed read is UNREADABLE, not an empty floor — blank the slice and
      // show the error rather than letting stale rows imply fresh truth.
      setAggRows([]);
      setLoadError(e instanceof Error ? e.message : "Failed to load WAVV calls");
    }
    setLoading(false);
  }, [fromIso, toIso]);

  useEffect(() => { void load(); }, [load]);

  // ── Pipeline outcomes from deals (the right-hand half of the Setters tab) ──
  // Three different timestamps are in play, so one OR'd query pulls anything
  // that touched the range on ANY of them and the per-metric range test is done
  // in the fold below.
  const loadDeals = useCallback(async () => {
    setDealsError(null);
    try {
      const { data, error } = await supabase
        .from("deals")
        .select("id,assigned_closer_id,appointment_at,application_sent_at,funded_at,amount_funded,status")
        .or(
          `and(appointment_at.gte.${fromIso},appointment_at.lt.${toIso}),` +
          `and(application_sent_at.gte.${fromIso},application_sent_at.lt.${toIso}),` +
          `and(funded_at.gte.${fromIso},funded_at.lt.${toIso})`,
        )
        .limit(5000);
      if (error) throw new Error(error.message);
      setDealRows((data ?? []) as DealRow[]);
    } catch (e) {
      // null (not []) so the pipeline columns render "—", never a fabricated 0.
      setDealRows(null);
      setDealsError(e instanceof Error ? e.message : "Failed to read deals");
    }
  }, [fromIso, toIso]);

  useEffect(() => { void loadDeals(); }, [loadDeals]);

  // ── Productive contacts (see the PRODUCTIVE CONTACTS block up top) ─────────
  // A SEPARATE query from loadDeals() on purpose, even though the two overlap.
  // loadDeals feeds the Setters tab's three pipeline columns and is scoped the
  // way that table has always been scoped (assigned_closer_id only, three
  // timestamps). This one is the honest "did real work happen" read: SIX
  // timestamps, coalesce(assigned_closer_id, created_by), and NO lead_source
  // filter so the setters' `ucc_list` book is included. Bending either query
  // into the other's shape would silently change a number somebody already
  // reads, which is precisely what must not happen here.
  const loadProductiveDeals = useCallback(async () => {
    setProductiveLoading(true);
    setProductiveError(null);
    try {
      const { data, error } = await supabase
        .from("deals")
        .select(PRODUCTIVE_DEAL_COLS)
        .or(
          `and(contacted_at.gte.${fromIso},contacted_at.lt.${toIso}),` +
          `and(qualified_at.gte.${fromIso},qualified_at.lt.${toIso}),` +
          `and(application_sent_at.gte.${fromIso},application_sent_at.lt.${toIso}),` +
          `and(appointment_at.gte.${fromIso},appointment_at.lt.${toIso}),` +
          `and(appointment_promised_at.gte.${fromIso},appointment_promised_at.lt.${toIso}),` +
          `and(funded_at.gte.${fromIso},funded_at.lt.${toIso})`,
        )
        .limit(PRODUCTIVE_DEAL_CAP);
      if (error) throw new Error(error.message);
      // `as unknown as` because the generated types model a to-one embed as an
      // array; PostgREST returns the single object (same cast MoneyInPlay uses).
      const rows = (data ?? []) as unknown as ProductiveDeal[];
      setProductiveDeals(rows);
      setProductiveTruncated(rows.length >= PRODUCTIVE_DEAL_CAP);
      // ── Apps BY AUTHOR (who actually pushed the send) for the digest. The
      // pipeline rungs stay assigned-book; the "what happened" digest must credit
      // the person who did the work (Coloso 9/2: Kristine sent, Carlos was
      // assigned — the digest showed Carlos). Blocked sends excluded. ──
      try {
        const { data: pushes } = await supabase
          .from("activity_log")
          .select("entity_id, logged_by, content")
          .eq("entity_type", "deal")
          .eq("subject", "application:pushed-to-ghl")
          .not("content", "ilike", "BLOCKED%")
          .gte("created_at", fromIso)
          .lt("created_at", toIso)
          .limit(1000);
        const byAuthor = new Map<string, Set<string>>();
        for (const p of (pushes ?? []) as { entity_id: string; logged_by: string | null }[]) {
          if (!p.logged_by) continue;
          const set = byAuthor.get(p.logged_by) ?? new Set<string>();
          set.add(p.entity_id);
          byAuthor.set(p.logged_by, set);
        }
        const allDealIds = [...new Set([...byAuthor.values()].flatMap((s) => [...s]))];
        const askByDeal = new Map<string, number>();
        if (allDealIds.length > 0) {
          const { data: askRows } = await supabase
            .from("deals").select("id, amount_requested").in("id", allDealIds);
          for (const d of (askRows ?? []) as { id: string; amount_requested: number | null }[]) {
            askByDeal.set(d.id, Number(d.amount_requested ?? 0) || 0);
          }
        }
        const out = new Map<string, { apps: number; askTotal: number }>();
        for (const [author, dealSet] of byAuthor) {
          let ask = 0;
          for (const id of dealSet) ask += askByDeal.get(id) ?? 0;
          out.set(author, { apps: dealSet.size, askTotal: ask });
        }
        setAppsByAuthor(out);
      } catch {
        setAppsByAuthor(null); // unreadable ≠ zero — the digest falls back to assigned-book
      }
    } catch (e) {
      // null, not [] — unreadable is not "nobody produced anything".
      setProductiveDeals(null);
      setProductiveTruncated(false);
      setProductiveError(e instanceof Error ? e.message : "Failed to read productive contacts");
    }
    setProductiveLoading(false);
  }, [fromIso, toIso]);

  useEffect(() => { void loadProductiveDeals(); }, [loadProductiveDeals]);

  // ── Shift clock, for occupancy on the Talk Time tab ───────────────────────
  // RLS on public.time_entries is "your own row, or super admin". A plain admin
  // therefore reads NOTHING for anyone else — and PostgREST returns that as an
  // empty 200, not an error, so the query would silently answer "nobody clocked
  // in today" when the truth is "you cannot see it". The read is therefore not
  // attempted at all below super admin, and the panel says which of the two it
  // is looking at.
  //
  // work_date is a plain DATE (the worker's own calendar day), so it is bounded
  // by the range's local calendar days, not by the UTC instants the call
  // timestamps use.
  const clockFromDay = ymd(range.from);
  const clockToDay = ymd(new Date(range.to.getTime() - 1));
  const loadTimeEntries = useCallback(async () => {
    if (!isSuperAdmin) {
      setTimeEntries(null);
      setTimeEntriesError(null);
      return;
    }
    setTimeEntriesError(null);
    try {
      const { data, error } = await supabase
        .from("time_entries")
        .select("user_id,work_date,hours,clock_in,clock_out,break_minutes")
        .gte("work_date", clockFromDay)
        .lte("work_date", clockToDay);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as TimeEntryRow[];
      setTimeEntries(rows);

      // Names via staff_directory (the same source the calls view uses), so a
      // person's clocked hours are titled with the same name as everywhere else.
      // A user the directory cannot name keeps an id fragment — never a guess.
      const ids = [...new Set(rows.map((r) => r.user_id))];
      if (ids.length > 0) {
        const { data: profs } = await supabase.from("staff_directory").select("id,name").in("id", ids);
        const map: Record<string, string> = {};
        for (const p of (profs ?? []) as { id: string; name: string | null }[]) {
          if (p.name) map[p.id] = p.name;
        }
        setClockedNames(map);
      } else {
        setClockedNames({});
      }
    } catch (e) {
      // null, not [] — a failed read leaves the clock unknown, never 0 hours.
      setTimeEntries(null);
      setTimeEntriesError(e instanceof Error ? e.message : "Failed to read time entries");
    }
  }, [isSuperAdmin, clockFromDay, clockToDay]);

  useEffect(() => { void loadTimeEntries(); }, [loadTimeEntries]);

  // ── Synergy lead cohorts (Live Transfers / Real-Time tabs) ────────────────
  // ONE query covers both tabs — the two lead sources are pulled together and
  // split in memory, so switching tabs costs nothing and the two funnels are
  // guaranteed to be reading the same snapshot.
  //
  // Filtered on created_at (when the lead LANDED), because the question these
  // tabs answer is "of what the vendor delivered in this window, how much did we
  // convert" — a cohort question. Recent cohorts are therefore still maturing,
  // which the UI states rather than letting a fresh day read as a bad day.
  const loadSourceDeals = useCallback(async () => {
    setSourceDealsLoading(true);
    setSourceDealsError(null);
    try {
      const { data, error } = await supabase
        .from("deals")
        .select(SOURCE_DEAL_COLS)
        .in("lead_source", [SOURCE_TABS.live_transfers.leadSource, SOURCE_TABS.realtime.leadSource])
        .gte("created_at", fromIso)
        .lt("created_at", toIso)
        .order("created_at", { ascending: false })
        .limit(SOURCE_DEAL_CAP);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as SourceDeal[];
      setSourceDeals(rows);
      setSourceDealsTruncated(rows.length >= SOURCE_DEAL_CAP);

      // Resolve setter names via staff_directory (staff-readable, names only) —
      // NOT profiles, whose RLS hands a closer only their own row. The directory
      // coalesces display_name/first+last into `name` server-side; a null name
      // stays nameless and is rendered as such.
      const ids = [...new Set(rows.map((r) => r.assigned_closer_id).filter((v): v is string => !!v))];
      if (ids.length > 0) {
        const { data: profs } = await supabase.from("staff_directory").select("id,name").in("id", ids);
        const map: Record<string, string> = {};
        for (const p of (profs ?? []) as { id: string; name: string | null }[]) {
          if (p.name) map[p.id] = p.name;
        }
        setCloserNames(map);
      } else {
        setCloserNames({});
      }
    } catch (e) {
      setSourceDeals(null);
      setSourceDealsError(e instanceof Error ? e.message : "Failed to read Synergy lead deals");
    }
    setSourceDealsLoading(false);
  }, [fromIso, toIso]);

  useEffect(() => { void loadSourceDeals(); }, [loadSourceDeals]);

  // ── Numbers tab data (worklist view + the setter roster to assign from) ───
  // The roster is the ACTIVE CLOSERS, resolved to their profiles.id because that
  // is what wavv_caller_setters.setter_id references. A closer with no linked
  // profile cannot be assigned and is left out rather than shown as a dead option.
  const loadNumbers = useCallback(async () => {
    if (!canManageNumbers) return;
    setNumbersError(null);
    try {
      const [numRes, closerRes] = await Promise.all([
        supabase.from(NUMBERS_VIEW).select("*").order("call_count", { ascending: false }),
        supabase.from("closers").select("user_id,first_name,last_name,email,status").eq("status", "active"),
      ]);
      if (numRes.error) throw new Error(numRes.error.message);
      if (closerRes.error) throw new Error(closerRes.error.message);

      setNumberRows((numRes.data ?? []) as NumberRow[]);

      const closers = ((closerRes.data ?? []) as {
        user_id: string | null; first_name: string | null; last_name: string | null; email: string | null;
      }[]).filter((c) => !!c.user_id);

      // Prefer profiles.display_name so the name in the picker is the same name
      // the rest of the page shows (the calls view reads display_name too).
      const ids = closers.map((c) => c.user_id!);
      const nameById = new Map<string, string>();
      if (ids.length > 0) {
        // staff_directory, not profiles: a closer can't read other profiles' rows.
        const { data: profs } = await supabase.from("staff_directory").select("id,name").in("id", ids);
        for (const p of (profs ?? []) as { id: string; name: string | null }[]) {
          if (p.name) nameById.set(p.id, p.name);
        }
      }
      setSetterOptions(
        closers
          .map((c) => ({
            id: c.user_id!,
            // `||`, not `??`: an all-null name joins to "", which is falsy but
            // NOT nullish, so `??` would happily show a blank option.
            name: nameById.get(c.user_id!)
              || [c.first_name, c.last_name].filter(Boolean).join(" ")
              || c.email
              || c.user_id!.slice(0, 8),
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    } catch (e) {
      setNumberRows(null);
      setNumbersError(e instanceof Error ? e.message : "Failed to load outbound numbers");
    }
  }, [canManageNumbers]);

  useEffect(() => { void loadNumbers(); }, [loadNumbers]);

  // ── Call log query (paged, filtered, independent of the aggregate slice) ──
  // caller_id filters use BARE 10-digit strings: the mapping table's normalizing
  // trigger fires on WRITE only, so a read filter must already be normalized.
  // Every value offered by the filters comes from the view itself, so it is.
  const loadLog = useCallback(async () => {
    setLogLoading(true);
    try {
      let q = supabase.from(CALLS_VIEW)
        .select(CALL_COLS, { count: "exact" })
        .gte("started_at", fromIso)
        .lt("started_at", toIso);

      if (filterSetter !== "all") {
        if (filterSetter === UNASSIGNED_FILTER) q = q.is("setter_id", null);
        else q = q.eq("setter_id", filterSetter);
      }
      if (filterNumber !== "all") q = q.eq("caller_id", filterNumber);
      if (filterDisposition !== "all") {
        if (filterDisposition === "__none__") q = q.is("disposition", null);
        else q = q.eq("disposition", filterDisposition);
      }
      const minSec = parseInt(filterMinSeconds, 10);
      if (Number.isFinite(minSec) && minSec > 0) q = q.gte("seconds", minSec);

      if (filterOutcome !== "all") q = q.eq("outcome", filterOutcome);

      // Contact type runs in Postgres, not on the fetched page — see the
      // HUMAN_OR_CLAUSES comment. Each .or() is appended as its own `or=` param
      // and PostgREST ANDs repeated params together.
      if (filterContact === "human") {
        q = q.not("answered_at", "is", null);
        for (const clause of HUMAN_OR_CLAUSES) q = q.or(clause);
      } else if (filterContact === "machine") {
        q = q.or(NOT_HUMAN_OR_CLAUSE);
      }

      // `recorded` is nullable, so "No recording" must claim the unknowns too —
      // otherwise a null row belongs to neither option and quietly disappears.
      if (filterRecording === "yes") q = q.is("recorded", true);
      else if (filterRecording === "no") q = q.or("recorded.is.false,recorded.is.null");

      // Name OR phone. Phone is stored as bare digits, so a typed "(412) 668"
      // is reduced to digits before matching — otherwise the punctuation the
      // table displays would never match the value it is stored as.
      if (logSearchApplied.trim()) {
        const text = sanitizeSearch(logSearchApplied);
        const digits = logSearchApplied.replace(/\D/g, "");
        const parts: string[] = [];
        if (text) parts.push(`contact_name.ilike."%${text}%"`);
        if (digits) parts.push(`phone.ilike."%${digits}%"`);
        if (parts.length > 0) q = q.or(parts.join(","));
      }

      const { data, error, count } = await q
        .order("started_at", { ascending: false })
        .range(logPage * LOG_PAGE_SIZE, logPage * LOG_PAGE_SIZE + LOG_PAGE_SIZE - 1);

      if (error) throw new Error(error.message);
      setLogRows((data ?? []) as SetterCall[]);
      setLogCount(count ?? 0);
    } catch (e) {
      setLogRows([]);
      setLogCount(null);
      setLoadError((prev) => prev ?? (e instanceof Error ? e.message : "Failed to load the call log"));
    }
    setLogLoading(false);
  }, [
    fromIso, toIso, filterSetter, filterNumber, filterDisposition, filterMinSeconds,
    filterOutcome, filterContact, filterRecording, logSearchApplied, logPage,
  ]);

  useEffect(() => { void loadLog(); }, [loadLog]);
  // Any filter or range change restarts pagination — page 3 of a different
  // filter is a different question.
  useEffect(() => { setLogPage(0); }, [
    fromIso, toIso, filterSetter, filterNumber, filterDisposition, filterMinSeconds,
    filterOutcome, filterContact, filterRecording, logSearchApplied,
  ]);
  // Debounce the search box so typing does not fire a query per keystroke.
  useEffect(() => {
    const t = window.setTimeout(() => setLogSearchApplied(logSearch), 350);
    return () => window.clearTimeout(t);
  }, [logSearch]);

  // ── Sync now ──────────────────────────────────────────────────────────────
  async function syncNow() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const { data, error } = await supabase.functions.invoke("wavv-sync", { body: { action: "sync" } });
      if (error) throw new Error(error.message);
      if (data?.key_invalid) {
        setSyncMsg({ ok: false, text: data?.error || "WAVV API key invalid — update it in the Supabase vault." });
      } else if (!data?.ok) {
        setSyncMsg({ ok: false, text: data?.error || "Sync failed." });
      } else {
        const n = data.upserted ?? 0;
        setSyncMsg({
          ok: true,
          text: n === 0
            ? "Synced — WAVV reported no new calls."
            : `Synced ${n} call${n === 1 ? "" : "s"}${data.truncated ? " (more remain — run again)" : ""}.`,
        });
      }
      await load();
      await loadLog();
    } catch (e) {
      setSyncMsg({ ok: false, text: e instanceof Error ? e.message : "Sync failed" });
    }
    setSyncing(false);
  }

  // ── Assign a number to a setter (the ONLY way attribution happens) ────────
  // Writes the BASE table, not the view. updated_at / updated_by are set by the
  // table's trigger, which also normalizes caller_id — so the label box can take
  // a number typed with +1, dashes or parens and it still joins cleanly.
  async function saveNumber(row: NumberRow) {
    const draft = numberDrafts[row.caller_id] ?? {
      setter_id: row.setter_id ?? "",
      label: row.label ?? "",
    };
    setSavingNumber(row.caller_id);
    setNumbersError(null);
    setNumberSaved(null);
    try {
      await mustWrite(
        "Assign WAVV caller ID",
        supabase.from("wavv_caller_setters").upsert({
          caller_id: row.caller_id,
          setter_id: draft.setter_id || null,
          label: draft.label.trim() || null,
        }, { onConflict: "caller_id" }),
      );
      setNumberSaved(row.caller_id);
      setNumberDrafts((d) => {
        const next = { ...d };
        delete next[row.caller_id];   // re-seed from the reloaded row
        return next;
      });
      await loadNumbers();
      await load();   // every attributed metric on the page depends on this map
      await loadLog();
    } catch (e) {
      setNumbersError(e instanceof Error ? e.message : "Failed to save the assignment");
    }
    setSavingNumber(null);
  }

  // ── Team funnel ───────────────────────────────────────────────────────────
  // Same computeFunnel() the grouped cards use, run over every loaded row.
  const funnel = useMemo(() => computeFunnel(aggRows), [aggRows]);

  const targetFor = useCallback(
    (key: string): { target: KpiTarget | null; isDefault: boolean } => {
      const stored = targets?.[key];
      if (stored && typeof stored.green === "number" && typeof stored.amber === "number") {
        return { target: stored, isDefault: false };
      }
      const fallback = DEFAULT_TARGETS[key];
      return fallback ? { target: fallback, isDefault: true } : { target: null, isDefault: false };
    },
    [targets],
  );

  // ── Funnel grouping (Combined / By setter / By number) ────────────────────
  // Grouped in memory off the SAME aggRows the combined funnel uses — no extra
  // query. A row the view could not attribute (setter_id null) groups under its
  // number's label; it is NEVER promoted into a person it was not assigned to.
  const funnelGroups = useMemo((): FunnelGroup[] => {
    if (funnelView === "combined") return [];
    const acc = new Map<string, FunnelGroup>();
    for (const r of aggRows) {
      // Attributed → the person. Unattributed → the LINE, titled with its
      // number/label and badged. A number is never promoted into a person.
      const attributed = !!r.setter_id;
      const key = attributed ? `setter:${r.setter_id}` : `caller:${r.caller_id ?? "unknown"}`;
      let g = acc.get(key);
      if (!g) {
        g = attributed
          ? {
              key,
              title: r.setter_name ?? "Setter (name not reported)",
              subtitle: r.caller_id ? `Dialing from ${prettyPhone(r.caller_id)}` : "Assigned setter",
              unassigned: false,
              calls: [],
            }
          : {
              key,
              title: r.caller_label ?? (r.caller_id ? prettyPhone(r.caller_id) : "Unknown number"),
              subtitle: r.caller_id ? prettyPhone(r.caller_id) : "No caller ID on these rows",
              unassigned: true,
              calls: [],
            };
        acc.set(key, g);
      }
      // Setters are 1:1 with a number, but if the data ever says otherwise the
      // subtitle says so rather than naming whichever number landed first.
      if (attributed && r.caller_id && g.subtitle.startsWith("Dialing from")) {
        const line = `Dialing from ${prettyPhone(r.caller_id)}`;
        if (g.subtitle !== line) g.subtitle = "Dialing from multiple numbers";
      }
      g.calls.push(r);
    }
    return [...acc.values()]
      .filter((g) => g.calls.length > 0)
      .sort((a, b) => b.calls.length - a.calls.length);
  }, [aggRows, funnelView]);

  // ── Positive dispositions, call by call ───────────────────────────────────
  // Every row in range whose disposition is on POSITIVE_DISPOSITIONS — the exact
  // rows behind the funnel's bottom bar, so a manager can open the merchant
  // instead of trusting a number. Sorted by disposition (in ladder order), then
  // newest first inside each. Built from the SAME aggRows; no extra query.
  const positiveCalls = useMemo(() => {
    const rows = aggRows.filter((r) => r.disposition && POSITIVE_DISPOSITIONS.includes(r.disposition));
    return rows.sort((a, b) => {
      const da = POSITIVE_DISPOSITIONS.indexOf(a.disposition!);
      const db = POSITIVE_DISPOSITIONS.indexOf(b.disposition!);
      if (da !== db) return da - db;
      return (b.started_at ?? "").localeCompare(a.started_at ?? "");
    });
  }, [aggRows]);

  /** The GHL contact ids behind the positive calls — a bounded, deduped key that
   *  only changes when the list of positive merchants does, so the fetch below
   *  does not re-run on every render of the same list. */
  const positiveContactKey = useMemo(
    () => [...new Set(positiveCalls.map((r) => r.contact_id).filter((v): v is string => !!v))].sort().join(","),
    [positiveCalls],
  );

  // The merchants behind those calls. A TARGETED read by ghl_contact_id and
  // deliberately NOT bounded by the range: the call happened in range, the DEAL
  // was very likely stage-stamped days earlier. Reusing productiveDeals (which
  // is range-scoped) rendered "—" for exactly the merchants who converted —
  // ANDRADE'S STONE INC, positive call Aug 28, deal stamped Aug 25, $20,000 —
  // which reads as "asked for nothing" when the truth is "asked earlier".
  //
  // COST. One `.in()` on the handful of contact ids actually shown, never a
  // book-wide scan, and only while the funnel tab is open.
  const positivesTabActive = tab === "funnel";
  useEffect(() => {
    if (!positivesTabActive) return;
    const ids = positiveContactKey ? positiveContactKey.split(",") : [];
    if (ids.length === 0) { setPositiveDeals([]); setPositiveDealsError(null); return; }
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("deals")
        .select(PRODUCTIVE_DEAL_COLS)
        .in("ghl_contact_id", ids);
      if (cancelled) return;
      // null, not [] — "we could not read the pipeline" must render as unknown
      // ("—"), never as "this merchant asked for nothing". And it SAYS so, rather
      // than degrading into a table full of quiet dashes.
      setPositiveDeals(error ? null : ((data ?? []) as unknown as ProductiveDeal[]));
      setPositiveDealsError(error ? error.message : null);
    })();
    return () => { cancelled = true; };
  }, [positivesTabActive, positiveContactKey]);

  // ── What each positive-disposition merchant asked for, and what they do ────
  // Folded out of the targeted read above, with the page's range-scoped
  // productiveDeals behind it as a second source — so a dial WAVV never tied to
  // a contact record can still resolve on phone.
  //
  // MATCHING. Primary key is the call's GHL contact_id → deals.ghl_contact_id,
  // the same tie the Disposition Review tab uses. Phone (last 10 digits, off the
  // embedded customer) is the fallback for a deal that never got a contact id.
  // A merchant with several deals resolves to the LIVE one: terminal rows (dead,
  // declined) lose to any non-terminal row, and among equals the most ADVANCED
  // wins (app sent > qualified > contacted, latest stamp). Andrade has two deals
  // on one contact id — dead MF-2026-0256 (amount null) and live MF-2026-0255
  // ($20,000) — and this picks the live one.
  //
  // MONEY WALL. amount_requested arrives null-or-absent for any deal the caller
  // could not read (see PRODUCTIVE_DEAL_COLS) — a setter gets no row at all for
  // another setter's merchant, which lands as "—". Never 0, never a leak. The
  // targeted query above changes nothing about that: it is the same RLS-bound
  // `deals` SELECT, just keyed on contact id instead of on a date window.
  const positiveMerchant = useMemo(() => {
    const byContact = new Map<string, ProductiveDeal>();
    const byPhone = new Map<string, ProductiveDeal>();
    const terminal = (d: ProductiveDeal) => TERMINAL_DEAL_STATUSES.includes(d.status ?? "");
    /** How far down the pipeline a deal is, for picking between two of them. */
    const rank = (d: ProductiveDeal) =>
      d.application_sent_at ?? d.qualified_at ?? d.contacted_at ?? "";
    const better = (next: ProductiveDeal, prev: ProductiveDeal | undefined) => {
      if (!prev) return true;
      // Live always beats dead, however far along the dead one got.
      if (terminal(next) !== terminal(prev)) return !terminal(next);
      return rank(next) > rank(prev);
    };

    // Targeted rows first, then the range-scoped ones — `better` decides, so the
    // order only matters as a tie-break and both sources get a fair look.
    for (const d of [...(positiveDeals ?? []), ...(productiveDeals ?? [])]) {
      if (d.ghl_contact_id && better(d, byContact.get(d.ghl_contact_id))) {
        byContact.set(d.ghl_contact_id, d);
      }
      const digits = (d.customer?.phone ?? "").replace(/\D/g, "").slice(-10);
      if (digits.length === 10 && better(d, byPhone.get(digits))) byPhone.set(digits, d);
    }

    return (r: { contact_id: string | null; phone: string | null }) => {
      const digits = (r.phone ?? "").replace(/\D/g, "").slice(-10);
      const deal =
        (r.contact_id ? byContact.get(r.contact_id) : undefined) ??
        (digits.length === 10 ? byPhone.get(digits) : undefined);
      return {
        businessName: deal?.customer?.business_name?.trim() || null,
        amountRequested: deal?.amount_requested ?? null,
        monthlyRevenue: deal?.customer?.monthly_revenue ?? null,
      };
    };
  }, [positiveDeals, productiveDeals]);

  const positiveCounts = useMemo(() => {
    const counts = new Map<string, number>(POSITIVE_DISPOSITIONS.map((d) => [d, 0]));
    for (const r of positiveCalls) counts.set(r.disposition!, (counts.get(r.disposition!) ?? 0) + 1);
    return POSITIVE_DISPOSITIONS.map((d) => ({ disposition: d, count: counts.get(d) ?? 0 }));
  }, [positiveCalls]);

  /** The funnel's positive bar is a jump link into the list of those exact calls. */
  const jumpToPositives = useCallback(() => {
    positivesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setPositivesHighlight(true);
    window.setTimeout(() => setPositivesHighlight(false), 1600);
  }, []);

  // ── Per-setter aggregates ─────────────────────────────────────────────────
  // Grouped on the view's own setter_id. A row the view could not attribute
  // (setter_id null) groups under its caller_label — a number is never promoted
  // into a person it was not assigned to.
  const setterRows = useMemo((): SetterRow[] => {
    interface Acc extends Omit<SetterRow, "uniqueLeads" | "activeDays" | "appointments" | "appsSent" | "funded" | "fundedAmount"> {
      phones: Set<string>; days: Set<string>; numberSet: Set<string>;
    }
    const acc = new Map<string, Acc>();
    for (const r of aggRows) {
      const attributed = !!r.setter_id;
      const key = attributed ? r.setter_id! : `caller:${r.caller_id ?? "unknown"}`;
      let row = acc.get(key);
      if (!row) {
        row = {
          key, name: attributionName(r), attributed, numbers: [],
          dials: 0, connects: 0, human: 0, conversations: 0, positives: 0,
          talkSeconds: 0, connectedSeconds: 0,
          phones: new Set<string>(), days: new Set<string>(), numberSet: new Set<string>(),
        };
        acc.set(key, row);
      }
      if (r.caller_id) row.numberSet.add(r.caller_id);
      row.dials++;
      const secs = r.seconds ?? 0;
      row.talkSeconds += secs;
      if (r.answered_at) { row.connects++; row.connectedSeconds += secs; }
      if (reachedHuman(r)) row.human++;
      if (isConversation(r)) row.conversations++;
      if (r.disposition && POSITIVE_DISPOSITIONS.includes(r.disposition)) row.positives++;
      if (r.phone) row.phones.add(r.phone);
      if (r.started_at) row.days.add(ymd(new Date(r.started_at)));
    }

    // Pipeline half. Only a mapped setter has a profiles.id to join deals on;
    // an unassigned number gets null (renders "—"), never 0.
    const byCloser = new Map<string, { appts: number; apps: number; funded: number; amount: number }>();
    if (dealRows) {
      for (const d of dealRows) {
        if (!d.assigned_closer_id) continue;
        const b = byCloser.get(d.assigned_closer_id) ?? { appts: 0, apps: 0, funded: 0, amount: 0 };
        if (inRange(d.appointment_at, range.from, range.to)) b.appts++;
        if (inRange(d.application_sent_at, range.from, range.to)) b.apps++;
        if (inRange(d.funded_at, range.from, range.to) && d.status === "funded") {
          b.funded++;
          b.amount += d.amount_funded ?? 0;
        }
        byCloser.set(d.assigned_closer_id, b);
      }
    }

    return [...acc.values()].map(({ phones, days, numberSet, ...row }) => {
      const deal = row.attributed && dealRows ? (byCloser.get(row.key) ?? { appts: 0, apps: 0, funded: 0, amount: 0 }) : null;
      return {
        ...row,
        numbers: [...numberSet],
        uniqueLeads: phones.size,
        activeDays: days.size,
        appointments: deal ? deal.appts : null,
        appsSent: deal ? deal.apps : null,
        funded: deal ? deal.funded : null,
        fundedAmount: deal ? deal.amount : null,
      };
    });
  }, [aggRows, dealRows, range]);

  const sortedSetterRows = useMemo(() => {
    const val = (r: SetterRow, k: SortKey): number | string => {
      switch (k) {
        case "name":          return r.name.toLowerCase();
        case "dials":         return r.dials;
        case "dialsPerDay":   return r.activeDays > 0 ? r.dials / r.activeDays : -1;
        case "connects":      return r.connects;
        case "human":         return r.human;
        case "conversations": return r.conversations;
        case "positives":     return r.positives;
        case "talk":          return r.talkSeconds;
        case "appointments":  return r.appointments ?? -1;
        case "appsSent":      return r.appsSent ?? -1;
        case "funded":        return r.funded ?? -1;
      }
    };
    return [...setterRows].sort((a, b) => {
      const av = val(a, sort.key), bv = val(b, sort.key);
      const cmp = typeof av === "string" && typeof bv === "string"
        ? av.localeCompare(bv)
        : Number(av) - Number(bv);
      return sort.desc ? -cmp : cmp;
    });
  }, [setterRows, sort]);

  const anyAttributed = setterRows.some((r) => r.attributed);

  // ── PRODUCTIVE CONTACTS: the per-setter union ─────────────────────────────
  // Rows come from the UNION of (setters with dials in range) and (setters with
  // pipeline movement in range). The union is the point: keying off the dial
  // side alone would drop a setter who moved merchants without a mapped line,
  // and keying off deals alone would drop the dial-side context that makes the
  // logging gap visible. A deal nobody owns lands in its own "unattributed"
  // row — never folded into whoever happens to be busiest.
  const productiveByOwner = useMemo(() => {
    if (!productiveDeals) return null;
    const byOwner = new Map<string, ProductiveDeal[]>();
    for (const d of productiveDeals) {
      const key = productiveOwner(d) ?? UNATTRIBUTED_OWNER;
      const list = byOwner.get(key);
      if (list) list.push(d);
      else byOwner.set(key, [d]);
    }
    return byOwner;
  }, [productiveDeals]);

  /** Every profiles.id that needs a display name, from EITHER side. */
  const namedSetterIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of setterRows) if (r.attributed) ids.add(r.key);
    for (const key of productiveByOwner?.keys() ?? []) if (key !== UNATTRIBUTED_OWNER) ids.add(key);
    return [...ids].sort();
  }, [setterRows, productiveByOwner]);

  // staff_directory is the staff-readable name source (profiles RLS hands a
  // closer only their own row). An id it cannot name keeps an id fragment and is
  // FLAGGED as unnamed — never given a guessed name.
  const namedSetterKey = namedSetterIds.join(",");
  useEffect(() => {
    const ids = namedSetterKey ? namedSetterKey.split(",") : [];
    if (ids.length === 0) { setStaffNames({}); return; }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.from("staff_directory").select("id,name").in("id", ids);
      if (cancelled) return;
      const map: Record<string, string> = {};
      for (const p of (data ?? []) as { id: string; name: string | null }[]) {
        if (p.name) map[p.id] = p.name;
      }
      setStaffNames(map);
    })();
    return () => { cancelled = true; };
  }, [namedSetterKey]);

  const productiveRows = useMemo((): ProductiveSetterRow[] | null => {
    if (!productiveByOwner) return null;
    /** Dial-side context, by profiles.id. Only ATTRIBUTED rows have one. */
    const dialBySetter = new Map(setterRows.filter((r) => r.attributed).map((r) => [r.key, r]));
    const keys = new Set<string>([...dialBySetter.keys(), ...productiveByOwner.keys()]);
    const rows: ProductiveSetterRow[] = [];
    for (const key of keys) {
      const dial = dialBySetter.get(key) ?? null;
      const counts = computeProductive(productiveByOwner.get(key) ?? [], range.from, range.to);
      // A setter with neither dials nor pipeline movement is not a row.
      if (!dial && counts.deals === 0) continue;
      const unattributed = key === UNATTRIBUTED_OWNER;
      const named = staffNames[key];
      rows.push({
        setterId: key,
        name: unattributed
          ? "Unassigned (no owner on the deal)"
          : named ?? dial?.name ?? `Setter ${key.slice(0, 8)}`,
        nameUnknown: !unattributed && !named && !dial?.name,
        dials: dial ? dial.dials : null,
        positivesLogged: dial ? dial.positives : null,
        deals: counts.deals,
        contacted: counts.contacted,
        qualified: counts.qualified,
        appsSent: counts.appsSent,
        appointments: counts.appointments,
        funded: counts.funded,
      });
    }
    return rows.sort((a, b) => b.deals - a.deals || (b.dials ?? -1) - (a.dials ?? -1));
  }, [productiveByOwner, setterRows, staffNames, range]);

  /** The floor's productive total — the pipeline twin of `funnel`, kept beside
   *  it on the Funnel tab and never summed into it. */
  const productiveTotals = useMemo(
    () => (productiveDeals ? computeProductive(productiveDeals, range.from, range.to) : null),
    [productiveDeals, range],
  );

  /** The Applications rung for the COMBINED (team-wide) dial funnel — applications
   *  on file and how many also have statements, over the whole floor. null when
   *  the pipeline read failed (drawn "—", never 0). */
  const appsRungCombined = useMemo(
    (): AppsRung | null =>
      productiveTotals
        ? { applications: productiveTotals.appsSent, withStatements: productiveTotals.appsWithStatements, askTotal: productiveTotals.appsAskTotal }
        : null,
    [productiveTotals],
  );

  /** The Applications rung PER setter (profiles.id → counts), for the by-setter
   *  funnel cards. null = pipeline unreadable; a missing key = that setter has no
   *  applications in range (0/0). Keyed the same way productiveByOwner is, so a
   *  card scoped to `setter:<id>` reads its own book. */
  const appsBySetter = useMemo((): Map<string, AppsRung> | null => {
    if (!productiveByOwner) return null;
    const m = new Map<string, AppsRung>();
    for (const [key, deals] of productiveByOwner) {
      const c = computeProductive(deals, range.from, range.to);
      m.set(key, { applications: c.appsSent, withStatements: c.appsWithStatements, askTotal: c.appsAskTotal });
    }
    return m;
  }, [productiveByOwner, range]);

  /** "What happened" digest — one row per SETTER for the selected range: their
   *  dial work (from the WAVV rows) joined with their pipeline work (from deals).
   *  People only — unattributed lines stay in the by-setter funnel cards. */
  const setterDigest = useMemo(() => {
    const byId = new Map<string, { name: string; calls: SetterCall[] }>();
    for (const r of aggRows) {
      if (!r.setter_id) continue;
      const g = byId.get(r.setter_id) ?? { name: r.setter_name ?? "", calls: [] };
      if (!g.name && r.setter_name) g.name = r.setter_name;
      g.calls.push(r);
      byId.set(r.setter_id, g);
    }
    // Setters with pipeline work but zero dials in range still get a row.
    for (const key of productiveByOwner?.keys() ?? []) {
      if (key !== UNATTRIBUTED_OWNER && !byId.has(key)) byId.set(key, { name: "", calls: [] });
    }
    // Anyone who AUTHORED an app-send in range gets a row too (e.g. the processor
    // sending on someone else's book with zero dials of her own).
    for (const key of appsByAuthor?.keys() ?? []) {
      if (!byId.has(key)) byId.set(key, { name: "", calls: [] });
    }
    const rows = [...byId.entries()].map(([id, g]) => {
      const f = computeFunnel(g.calls);
      const p = computeProductive(productiveByOwner?.get(id) ?? [], range.from, range.to);
      // Apps are credited to the person who SENT them (author), not the assigned
      // book — "what happened" means who did it. Falls back to assigned-book
      // counts only if the author read failed.
      const authored = appsByAuthor?.get(id);
      const apps = appsByAuthor !== null ? (authored?.apps ?? 0) : p.appsSent;
      const askTotal = appsByAuthor !== null ? (authored?.askTotal ?? 0) : p.appsAskTotal;
      return {
        id,
        name: g.name || staffNames[id] || `Setter ${id.slice(0, 6)}…`,
        dials: f.dials, conversations: f.conversations, positives: f.positives,
        appointments: p.appointments, apps, askTotal,
        statementsIn: p.statementsIn,
      };
    });
    rows.sort((a, b) => b.dials - a.dials || b.apps - a.apps);
    return rows;
  }, [aggRows, productiveByOwner, appsByAuthor, staffNames, range]);

  /** Calls dispositioned as an actual APPLICATION — the numerator for the
   *  industry app-per-conversation band, and shown next to it so the rate never
   *  appears without the count behind it. */
  const applicationDispositions = useMemo(
    () => aggRows.reduce((n, r) => n + (r.disposition && APPLICATION_DISPOSITIONS.includes(r.disposition) ? 1 : 0), 0),
    [aggRows],
  );

  /** How many days the active range covers, as a float. */
  const rangeDays = useMemo(
    () => Math.max((range.to.getTime() - range.from.getTime()) / 86_400_000, 0),
    [range],
  );

  /** Funded advances per rep per 30 days — the shop's side of the "4–8 a month"
   *  band. NULL on a short range ON PURPOSE: multiplying one day of funding by
   *  thirty is not a monthly pace, it is a guess wearing a decimal point. The
   *  page opens on TODAY, so this is null far more often than not, and the UI
   *  says why instead of drawing a number nobody should act on. */
  const repMonthlyPace = useMemo(() => {
    if (!productiveRows || rangeDays < PACE_MIN_DAYS) return null;
    const reps = productiveRows.filter((r) => r.setterId !== UNATTRIBUTED_OWNER);
    if (reps.length === 0) return null;
    const funded = reps.reduce((n, r) => n + r.funded, 0);
    return funded / reps.length / (rangeDays / 30.4);
  }, [productiveRows, rangeDays]);

  /** WHY there is no pace, when there is none. An absence with a reason beats a
   *  blank cell: "too short a range" and "the pipeline read failed" need
   *  completely different responses from the reader. */
  const paceUnavailableReason = useMemo((): string | null => {
    if (repMonthlyPace !== null) return null;
    if (!productiveRows) return "The pipeline side is unreadable this load — unknown, not zero.";
    if (rangeDays < PACE_MIN_DAYS) {
      const d = Math.round(rangeDays);
      return `This range covers ${rangeDays < 1 ? "under a day" : `${d} day${d === 1 ? "" : "s"}`} — too short to read a monthly pace from. Widen it to 30 days to compare against the band.`;
    }
    return "No readable per-rep funding in this range, so there is nothing to compare — unknown, not zero.";
  }, [repMonthlyPace, productiveRows, rangeDays]);

  // ── INDUSTRY COMPARISON: the shop's side of the benchmarks ────────────────
  // DISPLAY ONLY. Every value below is folded from rows the page has ALREADY
  // loaded — no extra query, no book-wide scan. A value the loaded rows cannot
  // support is `null`, which the chip draws grey and labels "no comparable
  // number", never 0 and never a silently-substituted near-miss.
  //
  // The denominators are the whole point of this block, so each one is named:
  //   • contact rate      = CONVERSATIONS ÷ DIALS  (the industry 3–5% band is a
  //                         real-conversation rate per dial — reached a live
  //                         decision-maker and talked — NOT raw human pickups,
  //                         same basis the Conversations funnel rung is judged on)
  //   • app / conversation= application dispositions ÷ conversations
  //   • app → fund        = pipeline funded ÷ pipeline apps sent, both counted
  //                         IN RANGE, which is a cohort mismatch stated in the
  //                         UI: the deals funded this week are usually not the
  //                         deals that applied this week.
  //   • average advance   = amount_funded summed ÷ funded deals, from the SAME
  //                         dealRows fold the Setters tab already uses.
  const industryValues = useMemo((): BenchmarkValues => {
    const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : null);

    // Average advance. dealRows null = UNREADABLE, which must stay null rather
    // than collapsing to "$0 average".
    let avgAdvance: number | null = null;
    if (dealRows) {
      let amount = 0, count = 0;
      for (const d of dealRows) {
        if (d.status !== "funded" || !inRange(d.funded_at, range.from, range.to)) continue;
        count++;
        amount += d.amount_funded ?? 0;
      }
      avgAdvance = count > 0 ? amount / count : null;
    }

    return {
      contact_rate: pct(funnel.conversations, funnel.dials),
      app_per_conversation: pct(applicationDispositions, funnel.conversations),
      app_to_fund_cold: productiveTotals ? pct(productiveTotals.funded, productiveTotals.appsSent) : null,
      avg_advance: avgAdvance,
      deals_per_rep_month: repMonthlyPace,
    };
  }, [applicationDispositions, funnel, dealRows, productiveTotals, range, repMonthlyPace]);

  // ── DISPOSITION REVIEW: real talks with no honest outcome ─────────────────
  // Built from the SAME aggRows every other WAVV tab folds — no extra call
  // query — so this list cannot drift from the funnel it is the exception list
  // for. Newest first: a manager works today's misses, not last week's.
  const reviewCalls = useMemo(
    () => aggRows.filter(needsDispositionReview).sort((a, b) => (b.started_at ?? "").localeCompare(a.started_at ?? "")),
    [aggRows],
  );

  const reviewContactKey = useMemo(
    () => [...new Set(reviewCalls.map((r) => r.contact_id).filter((v): v is string => !!v))].sort().join(","),
    [reviewCalls],
  );

  // The pipeline state of those contacts. A TARGETED read by ghl_contact_id, not
  // a reuse of productiveDeals: a flagged call's merchant may well have a deal
  // whose stamps all fall OUTSIDE the range, and that deal is exactly what the
  // manager needs to see ("7-minute talk, app sent, dispositioned None").
  // Only fetched while the tab is open — it is the one query on this page that
  // nothing else needs.
  const reviewTabActive = tab === "review";
  useEffect(() => {
    if (!reviewTabActive) return;
    const ids = reviewContactKey ? reviewContactKey.split(",") : [];
    if (ids.length === 0) { setReviewDeals({}); setReviewDealsError(null); return; }
    let cancelled = false;
    setReviewDealsLoading(true);
    setReviewDealsError(null);
    void (async () => {
      const { data, error } = await supabase
        .from("deals")
        .select(PRODUCTIVE_DEAL_COLS)
        .in("ghl_contact_id", ids)
        .order("created_at", { ascending: false });
      if (cancelled) return;
      if (error) {
        // null, not {} — "we could not read the pipeline" must never render as
        // "this merchant has no deal", which is the opposite conclusion.
        setReviewDeals(null);
        setReviewDealsError(error.message);
      } else {
        const map: Record<string, ProductiveDeal> = {};
        for (const d of (data ?? []) as unknown as ProductiveDeal[]) {
          // Newest deal per contact wins (ordered above); a merchant with two
          // deals is shown by their current one, not by an old closed cycle.
          if (d.ghl_contact_id && !map[d.ghl_contact_id]) map[d.ghl_contact_id] = d;
        }
        setReviewDeals(map);
      }
      setReviewDealsLoading(false);
    })();
    return () => { cancelled = true; };
  }, [reviewTabActive, reviewContactKey]);

  // ── Talk time: the per-LINE clock, and the hour-of-day grid ───────────────
  // Grouped on caller_id — the LINE — because the lines are shared by several
  // seats at once and a per-person split would be fabricated (see the block
  // above TalkRow). One pass off the SAME aggRows the rest of the page uses
  // builds the line totals, the floor total, and the heatmap buckets.
  //
  // DAYS AND HOURS ARE LOCAL, matching the range pills and the Trends chart —
  // the reader's own clock. The call-level timestamps elsewhere on the page are
  // stamped Eastern and labelled as such; the heatmap says which clock it is on
  // in its own caption rather than leaving the two to be conflated.
  const talk = useMemo(() => {
    interface Acc extends Omit<TalkRow, "lineNo" | "activeDays" | "activeHours" | "longestIdleGapMin" | "idleGapFrom" | "idleGapTo" | "peakConcurrent" | "peakConcurrentHuman"> {
      /** day -> hour -> counts, and the ordered dial starts used for idle gaps. */
      days: Map<string, TalkGridDay>;
      starts: Map<string, number[]>;
      /** Every call's [start,end] span, for the concurrency sweep. */
      spans: { s: number; e: number }[];
      humanSpans: { s: number; e: number }[];
    }
    const acc = new Map<string, Acc>();
    // The whole floor, accumulated alongside so the heatmap can draw it as its
    // own block without a second pass.
    const floorDays = new Map<string, TalkGridDay>();
    const allDays = new Set<string>();
    let minHour = 23;
    let maxHour = 0;

    const touchDay = (map: Map<string, TalkGridDay>, day: string) => {
      let g = map.get(day);
      if (!g) {
        g = { day, dials: new Array<number>(24).fill(0), talkSeconds: new Array<number>(24).fill(0) };
        map.set(day, g);
      }
      return g;
    };

    for (const r of aggRows) {
      const key = r.caller_id ?? "unknown";
      let row = acc.get(key);
      if (!row) {
        row = {
          key,
          callerId: r.caller_id,
          lineLabel: r.caller_label ?? (r.caller_id ? prettyPhone(r.caller_id) : "Unknown number"),
          mappedName: r.setter_name,
          mappedSetterId: r.setter_id,
          dials: 0, connects: 0, humans: 0, conversations: 0,
          talkSeconds: 0, machineSeconds: 0,
          days: new Map(), starts: new Map(), spans: [], humanSpans: [],
        };
        acc.set(key, row);
      }
      row.dials++;

      const secs = r.seconds ?? 0;
      const human = reachedHuman(r);
      if (human) row.humans++;
      if (isConversation(r)) row.conversations++;
      if (r.answered_at) {
        row.connects++;
        // Answered seconds split two ways and never double-counted: a human
        // talk, or time spent on a machine.
        if (human) row.talkSeconds += secs;
        else row.machineSeconds += secs;
      }

      if (!r.started_at) continue;
      const started = new Date(r.started_at);
      const t = started.getTime();
      if (!Number.isFinite(t)) continue;

      // Concurrency evidence needs both ends of the call; rows missing one are
      // simply not swept rather than given an invented duration.
      if (r.ended_at) {
        const e = new Date(r.ended_at).getTime();
        if (Number.isFinite(e) && e > t) {
          row.spans.push({ s: t, e });
          if (human) row.humanSpans.push({ s: t, e });
        }
      }

      const day = ymd(started);
      const hour = started.getHours();
      allDays.add(day);
      if (hour < minHour) minHour = hour;
      if (hour > maxHour) maxHour = hour;

      const grid = touchDay(row.days, day);
      grid.dials[hour]++;
      if (human) grid.talkSeconds[hour] += secs;

      const floor = touchDay(floorDays, day);
      floor.dials[hour]++;
      if (human) floor.talkSeconds[hour] += secs;

      const list = row.starts.get(day);
      if (list) list.push(t); else row.starts.set(day, [t]);
    }

    const rows: TalkRow[] = [...acc.values()]
      .map(({ days, starts, spans, humanSpans, ...row }) => {
        // Longest silence between two consecutive dials, measured WITHIN a day so
        // an overnight break never reads as a 16-hour idle stretch. A day holding
        // a single dial contributes no gap at all.
        let gap: number | null = null;
        let gapFrom: string | null = null;
        let gapTo: string | null = null;
        for (const list of starts.values()) {
          if (list.length < 2) continue;
          list.sort((a, b) => a - b);
          for (let i = 1; i < list.length; i++) {
            const mins = (list[i] - list[i - 1]) / 60000;
            if (gap === null || mins > gap) {
              gap = mins;
              gapFrom = new Date(list[i - 1]).toISOString();
              gapTo = new Date(list[i]).toISOString();
            }
          }
        }
        let activeHours = 0;
        for (const g of days.values()) activeHours += g.dials.reduce((n, v) => n + (v > 0 ? 1 : 0), 0);
        return {
          ...row,
          lineNo: 0,   // assigned after the sort below, so it reads 1,2,3 down the table
          activeDays: days.size,
          activeHours,
          longestIdleGapMin: gap,
          idleGapFrom: gapFrom,
          idleGapTo: gapTo,
          peakConcurrent: peakConcurrency(spans),
          peakConcurrentHuman: peakConcurrency(humanSpans),
        };
      })
      .sort((a, b) => b.dials - a.dials)
      .map((r, i) => ({ ...r, lineNo: i + 1 }));

    // The heatmap's own lookup, keyed the same way, so a row and its grid can
    // never fall out of step. The floor gets its own entry under FLOOR_KEY.
    const grids = new Map<string, TalkGridDay[]>();
    for (const [key, a] of acc) {
      grids.set(key, [...a.days.values()].sort((x, y) => x.day.localeCompare(y.day)));
    }
    grids.set(FLOOR_KEY, [...floorDays.values()].sort((x, y) => x.day.localeCompare(y.day)));

    const dayList = [...allDays].sort();
    // Columns are trimmed to the hours the floor actually worked (padded by one
    // on each side) — a full 24-wide grid squeezes the working hours into an
    // unreadable strip. The caption states the window that is drawn.
    const hours: number[] = [];
    if (dayList.length > 0 && minHour <= maxHour) {
      for (let h = Math.max(0, minHour - 1); h <= Math.min(23, maxHour + 1); h++) hours.push(h);
    }
    return { rows, grids, days: dayList, hours };
  }, [aggRows]);

  /** profiles.id → clocked shift for the range. A setter absent from this map
   *  logged no check-in; a NULL map means the clock could not be read at all. */
  const clockedByUser = useMemo((): Map<string, Occupancy> | null => {
    if (timeEntries === null) return null;
    const acc = new Map<string, Occupancy>();
    for (const e of timeEntries) {
      const { minutes, fromClock } = entryMinutes(e);
      if (minutes <= 0) continue;
      const cur = acc.get(e.user_id) ?? { clockedMinutes: 0, daysLogged: 0, allFromClock: true };
      cur.clockedMinutes += minutes;
      cur.daysLogged++;
      cur.allFromClock = cur.allFromClock && fromClock;
      acc.set(e.user_id, cur);
    }
    return acc;
  }, [timeEntries]);

  /** Floor totals — summed from the same line rows the table renders, not
   *  recomputed from aggRows, so the footer always equals its own columns. */
  const talkFloor = useMemo(() => {
    const t = {
      dials: 0, connects: 0, humans: 0, conversations: 0,
      talkSeconds: 0, machineSeconds: 0, activeDays: 0, activeHours: 0,
    };
    const days = new Set<string>();
    for (const r of talk.rows) {
      t.dials += r.dials; t.connects += r.connects; t.humans += r.humans;
      t.conversations += r.conversations; t.talkSeconds += r.talkSeconds; t.machineSeconds += r.machineSeconds;
    }
    // Active days/hours are floor-wide unions, not sums — two lines dialing in
    // the same hour is ONE hour the floor was working, not two.
    for (const g of talk.grids.get(FLOOR_KEY) ?? []) {
      days.add(g.day);
      t.activeHours += g.dials.reduce((n, v) => n + (v > 0 ? 1 : 0), 0);
    }
    t.activeDays = days.size;
    return t;
  }, [talk.rows, talk.grids]);

  /** The people the dialing lines are mapped to. Used ONLY as the denominator
   *  set for floor occupancy and to caption the clocked-hours table — never to
   *  split talk minutes between them. */
  const dialingSetterIds = useMemo(
    () => new Set(talk.rows.map((r) => r.mappedSetterId).filter((v): v is string => !!v)),
    [talk.rows],
  );

  /** Floor occupancy: every talk minute over every clocked minute of the people
   *  mapped to a dialing line. Honest at this level and only at this level,
   *  because the numerator cannot be split by person. `clockedMinutes` null =
   *  the clock was unreadable; `excludedClockedUsers` are clocked staff who are
   *  not on a dialing line and are therefore left out of the denominator. */
  const floorOccupancy = useMemo(() => {
    if (clockedByUser === null) return null;
    let clockedMinutes = 0;
    let people = 0;
    let allFromClock = true;
    let excludedClockedUsers = 0;
    for (const [userId, occ] of clockedByUser) {
      if (!dialingSetterIds.has(userId)) { excludedClockedUsers++; continue; }
      clockedMinutes += occ.clockedMinutes;
      people++;
      allFromClock = allFromClock && occ.allFromClock;
    }
    return { clockedMinutes, people, allFromClock, excludedClockedUsers };
  }, [clockedByUser, dialingSetterIds]);

  // ── Synergy cohorts, split by product and grouped by setter ───────────────
  // Both tabs are folded here off the SAME loaded rows, so the two funnels can
  // never be reading different snapshots of the table.
  const sourceCohorts = useMemo(() => {
    const build = (leadSource: string) => {
      if (sourceDeals === null) return null;
      const deals = sourceDeals.filter((d) => d.lead_source === leadSource);
      const acc = new Map<string, SourceDeal[]>();
      for (const d of deals) {
        const key = d.assigned_closer_id ?? UNASSIGNED_FILTER;
        const bucket = acc.get(key);
        if (bucket) bucket.push(d);
        else acc.set(key, [d]);
      }
      const groups: PipeGroup[] = [...acc.entries()].map(([key, rows]) => {
        const unassigned = key === UNASSIGNED_FILTER;
        const name = unassigned ? null : (closerNames[key] ?? null);
        return {
          key,
          name: unassigned ? "Unassigned" : (name ?? `Setter · ${key.slice(0, 8)}`),
          unassigned,
          nameUnknown: !unassigned && name === null,
          deals: rows,
          counts: computePipeline(rows),
        };
      });
      // Unassigned sinks to the bottom; everyone else by cohort size.
      groups.sort((a, b) => {
        if (a.unassigned !== b.unassigned) return a.unassigned ? 1 : -1;
        return b.counts.received - a.counts.received;
      });
      return { deals, counts: computePipeline(deals), groups };
    };
    return {
      live_transfers: build(SOURCE_TABS.live_transfers.leadSource),
      realtime: build(SOURCE_TABS.realtime.leadSource),
    };
  }, [sourceDeals, closerNames]);

  // ── Daily trend ───────────────────────────────────────────────────────────
  const trend = useMemo(() => {
    const byDay = new Map<string, { day: string; dials: number; connects: number; human: number; conversations: number; appointments: number }>();
    const touch = (day: string) => {
      let b = byDay.get(day);
      if (!b) { b = { day, dials: 0, connects: 0, human: 0, conversations: 0, appointments: 0 }; byDay.set(day, b); }
      return b;
    };
    for (const r of aggRows) {
      if (!r.started_at) continue;
      const b = touch(ymd(new Date(r.started_at))); // local day, matching the picker
      b.dials++;
      if (r.answered_at) b.connects++;
      // Same voicemail-aware definitions the funnel and scorecard use.
      if (reachedHuman(r)) b.human++;
      if (isConversation(r)) b.conversations++;
    }
    for (const d of dealRows ?? []) {
      if (inRange(d.appointment_at, range.from, range.to) && d.appointment_at) {
        touch(ymd(new Date(d.appointment_at))).appointments++;
      }
    }
    return [...byDay.values()]
      .sort((a, b) => a.day.localeCompare(b.day))
      .map((d) => ({ ...d, label: d.day.slice(5) }));
  }, [aggRows, dealRows, range]);

  // ── Breakdowns ────────────────────────────────────────────────────────────
  const breakdown = useCallback((field: "disposition" | "outcome") => {
    const counts = new Map<string, number>();
    for (const r of aggRows) {
      const k = r[field] ?? "(none)";
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const total = aggRows.length;
    return [...counts.entries()]
      .map(([label, count]) => ({
        label, count,
        pct: total > 0 ? (count / total) * 100 : 0,
        positive: field === "disposition" && POSITIVE_DISPOSITIONS.includes(label),
      }))
      .sort((a, b) => b.count - a.count);
  }, [aggRows]);

  const dispositionBreakdown = useMemo(() => breakdown("disposition"), [breakdown]);
  const outcomeBreakdown = useMemo(() => breakdown("outcome"), [breakdown]);

  // Filter options come from the range slice, so they only ever offer values
  // that actually occur in the data being looked at.
  const numberOptions = useMemo(() => {
    const opts = new Map<string, string>();
    for (const r of aggRows) {
      if (!r.caller_id) continue;
      const who = r.setter_name ?? r.caller_label;
      opts.set(r.caller_id, `${prettyPhone(r.caller_id)}${who ? ` — ${who}` : ""}`);
    }
    return [...opts.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [aggRows]);

  const setterFilterOptions = useMemo(() => {
    const opts = new Map<string, string>();
    let anyUnassigned = false;
    for (const r of aggRows) {
      if (r.setter_id) opts.set(r.setter_id, r.setter_name ?? "Assigned setter");
      else anyUnassigned = true;
    }
    const list = [...opts.entries()].sort((a, b) => a[1].localeCompare(b[1]));
    if (anyUnassigned) list.push([UNASSIGNED_FILTER, "Unassigned numbers"]);
    return list;
  }, [aggRows]);

  const dispositionOptions = useMemo(
    () => dispositionBreakdown.map((d) => (d.label === "(none)" ? ["__none__", "(none)"] as const : [d.label, d.label] as const)),
    [dispositionBreakdown],
  );

  /** The known WAVV vocabulary, plus anything new the mirror has started
   *  reporting — so a value that exists in the data is never unfilterable. */
  const outcomeOptions = useMemo(() => {
    const seen = new Set(KNOWN_OUTCOMES);
    for (const r of aggRows) if (r.outcome) seen.add(r.outcome);
    return [...seen].sort();
  }, [aggRows]);

  const logFilterCount =
    (filterSetter !== "all" ? 1 : 0) +
    (filterNumber !== "all" ? 1 : 0) +
    (filterDisposition !== "all" ? 1 : 0) +
    (filterOutcome !== "all" ? 1 : 0) +
    (filterContact !== "all" ? 1 : 0) +
    (filterRecording !== "all" ? 1 : 0) +
    (filterMinSeconds.trim() ? 1 : 0) +
    (logSearch.trim() ? 1 : 0);

  const clearLogFilters = useCallback(() => {
    setFilterSetter("all");
    setFilterNumber("all");
    setFilterDisposition("all");
    setFilterOutcome("all");
    setFilterContact("all");
    setFilterRecording("all");
    setFilterMinSeconds("");
    setLogSearch("");
    setLogSearchApplied("");
  }, []);

  // ── On-demand recording / transcript ──────────────────────────────────────
  async function fetchRecording(callId: string) {
    setMedia((m) => ({ ...m, [callId]: { ...m[callId], loadingRec: true, recError: null } }));
    try {
      const { data, error } = await supabase.functions.invoke("wavv-sync", {
        body: { action: "recording", call_id: callId },
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) {
        setMedia((m) => ({ ...m, [callId]: { ...m[callId], loadingRec: false, url: null, recError: data?.error || "No recording available." } }));
        return;
      }
      setMedia((m) => ({ ...m, [callId]: { ...m[callId], loadingRec: false, url: data.url ?? null, recError: data.url ? null : "WAVV returned no recording URL." } }));
    } catch (e) {
      setMedia((m) => ({ ...m, [callId]: { ...m[callId], loadingRec: false, recError: e instanceof Error ? e.message : "Failed to load the recording" } }));
    }
  }

  async function toggleTranscript(callId: string) {
    const cur = media[callId];
    if (cur?.open) { setMedia((m) => ({ ...m, [callId]: { ...m[callId], open: false } })); return; }
    setMedia((m) => ({ ...m, [callId]: { ...m[callId], open: true, loadingTx: true, txError: null } }));
    try {
      const { data, error } = await supabase.functions.invoke("wavv-sync", {
        body: { action: "transcript", call_id: callId },
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) {
        setMedia((m) => ({ ...m, [callId]: { ...m[callId], loadingTx: false, txError: data?.error || "No transcript available yet." } }));
        return;
      }
      setMedia((m) => ({ ...m, [callId]: { ...m[callId], loadingTx: false, transcript: data.transcript ?? null, summary: data.summary ?? null } }));
    } catch (e) {
      setMedia((m) => ({ ...m, [callId]: { ...m[callId], loadingTx: false, txError: e instanceof Error ? e.message : "Failed to load the transcript" } }));
    }
  }

  // ── Derived banner conditions ─────────────────────────────────────────────
  const keyInvalid = syncState?.key_invalid === true || syncState?.last_status === "key_invalid";
  const neverSynced = (totalRowsEver ?? 0) === 0;
  const emptyRange = !neverSynced && aggRows.length === 0 && !loading;
  const logPages = logCount === null ? 0 : Math.ceil(logCount / LOG_PAGE_SIZE);
  const visibleTabs = TABS.filter((t) => (!t.adminOnly || canManageNumbers) && (!t.superOnly || isSuperAdmin));
  /** The Synergy tabs read `deals`, not WAVV — so every WAVV banner below is
   *  suppressed on them. A stale dialer sync says nothing about a lead cohort,
   *  and showing it there would be a warning about the wrong data source. */
  const sourceTabActive = isSourceTab(tab);
  /** Assignments also reads `deals`, so it too renders outside the WAVV gate and
   *  suppresses the dialer banners. */
  const dealsTabActive = sourceTabActive || tab === "assignments";
  /** Dial Ceiling is WAVV data, but it is aggregated SERVER-SIDE by its own RPCs
   *  rather than folded from this page's paged pull. So the sync-health banners
   *  (invalid key, never synced, missing attribution) still apply to it — a stale
   *  mirror makes its numbers stale too — while the two banners about THIS page's
   *  fold (its load error, its 20k row ceiling) do not, and showing them there
   *  would be a warning about numbers that tab never reads. */
  const ceilingTabActive = tab === "dial_ceiling";
  /** Managers see everyone's book behind a picker; a closer sees only their own.
   *  A UI scope, not a permission — RLS is what actually governs the rows. */
  const canSeeAllAssignments = isAdmin || isSuperAdmin;

  function sortBy(key: SortKey) {
    setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== "name" }));
  }

  return (
    <div className="p-4 sm:p-6 space-y-5">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <PhoneIcon className="w-6 h-6 text-mint-green" /> Setter Performance
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1 max-w-3xl text-sm">
            Outbound dial-floor activity from the <span className="font-medium">WAVV dialer</span> (embedded in
            VibeReach), mirrored here every 10 minutes, joined to pipeline outcomes from{" "}
            <span className="font-medium">Deals</span>.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {syncMsg && (
            <span className={`text-sm ${syncMsg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
              {syncMsg.text}
            </span>
          )}
          <div className="text-right">
            <button className="btn btn-sm btn-primary gap-2" onClick={syncNow} disabled={syncing}>
              <ArrowPathIcon className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Syncing…" : "Sync now"}
            </button>
            <div className="text-xs text-gray-400 mt-1">
              Last sync {sinceText(syncState?.last_sync_at ?? null)}
            </div>
          </div>
        </div>
      </div>

      {/* ── Range picker (applies to EVERY tab) ── */}
      {/* One segmented control, not five loose buttons: a single bordered track,
          evenly sized segments, the active one filled in the brand mint. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div
          role="group"
          aria-label="Date range"
          className="inline-flex items-center gap-1 rounded-lg border border-base-300 bg-base-200/60 dark:bg-gray-800/50 p-1"
        >
          {(Object.keys(RANGE_LABELS) as RangeKey[]).map((k) => {
            const active = rangeKey === k;
            return (
              <button
                key={k}
                type="button"
                aria-pressed={active}
                onClick={() => { setRangePinned(true); setWidenedFrom(null); setRangeKey(k); }}
                className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                  active
                    ? "bg-mint-green text-gray-900 shadow-sm"
                    : "text-gray-600 dark:text-gray-300 hover:bg-base-100 dark:hover:bg-gray-700/60"
                }`}
              >
                {RANGE_LABELS[k]}
              </button>
            );
          })}
        </div>

        {rangeKey === "custom" && (
          <div className="flex items-center gap-2">
            <input type="date" className="input input-sm input-bordered" value={customFrom}
              onChange={(e) => { setRangePinned(true); setCustomFrom(e.target.value); }} />
            <span className="text-xs text-gray-400">to</span>
            <input type="date" className="input input-sm input-bordered" value={customTo}
              onChange={(e) => { setRangePinned(true); setCustomTo(e.target.value); }} />
          </div>
        )}

        <span className="text-xs text-gray-400">
          {range.from.toLocaleDateString()} – {new Date(range.to.getTime() - 1).toLocaleDateString()} (your local days)
        </span>
      </div>

      {/* ── Banners (WAVV-side only — see dealsTabActive) ── */}
      {!dealsTabActive && keyInvalid && (
        <div className="alert alert-error">
          <ExclamationTriangleIcon className="w-5 h-5 shrink-0" />
          <div>
            <div className="font-semibold">WAVV API key invalid — the sync cannot pull calls.</div>
            <div className="text-sm opacity-90">
              Update <code>WAVV_API_KEY</code> in the Supabase vault. Until then this page can only show calls
              that were already mirrored; anything below may be stale or incomplete — it is not a report that
              the floor was quiet.
              {syncState?.last_error ? <div className="mt-1 opacity-80">{syncState.last_error}</div> : null}
            </div>
          </div>
        </div>
      )}

      {!dealsTabActive && !ceilingTabActive && loadError && (
        <div className="alert alert-error">
          <ExclamationTriangleIcon className="w-5 h-5" />
          <span>Could not read setter performance: {loadError}</span>
        </div>
      )}

      {!dealsTabActive && !loading && neverSynced && !loadError && (
        <div className="alert">
          <InformationCircleIcon className="w-5 h-5" />
          <span>
            Waiting for first sync — no outbound WAVV calls have been mirrored yet.
            {keyInvalid ? " Fix the API key above, then press Sync now." : " Press Sync now, or wait for the 10-minute cron."}
          </span>
        </div>
      )}

      {!dealsTabActive && !ceilingTabActive && aggregateTruncated && (
        <div className="alert alert-warning">
          <ExclamationTriangleIcon className="w-5 h-5" />
          <span>
            This range holds <strong>{(rangeTotal ?? 0).toLocaleString()}</strong> calls — more than the{" "}
            {AGG_ROW_CAP.toLocaleString()}-call ceiling, so the funnel, scorecard, charts and breakdowns
            cover only the {aggRows.length.toLocaleString()} most recent calls in it. Narrow the range for
            exact totals. (The call log is queried separately and stays exact.)
          </span>
        </div>
      )}

      {/* ── Attribution notice — permanent, not a bug to be fixed by a reparse ── */}
      {!dealsTabActive && !loading && aggRows.length > 0 && !anyAttributed && (
        <div className="alert alert-info">
          <InformationCircleIcon className="w-5 h-5 shrink-0" />
          <div className="text-sm">
            <div className="font-semibold">No outbound number is assigned to a setter yet.</div>
            WAVV's call records carry no per-agent field, so dials are attributed by the number they were
            placed FROM. Until a number is assigned{canManageNumbers ? <> in the <b>Numbers</b> tab</> : " by an admin"},
            each one shows as its own row — that is missing attribution, not one person doing all the dialing.
          </div>
        </div>
      )}

      {/* ── Tabs ── */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="flex gap-1 -mb-px overflow-x-auto">
          {visibleTabs.map((t) => {
            const Icon = t.icon;
            const isActive = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                  isActive
                    ? "border-mint-green text-mint-green"
                    : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600"
                }`}
              >
                <Icon className="w-4 h-4" />
                {t.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* ═══════════ SYNERGY LEAD TABS (deals, not WAVV) ═══════════ */}
      {/* Rendered BEFORE the WAVV loading gate on purpose: these read `deals`,
          so a slow or broken dialer sync must not blank them. */}
      {/* isSourceTab() is called inline (not via sourceTabActive) so TypeScript
          narrows `tab` for the lookups below — no casts. */}
      {tab === "audit" && <CallAuditTab />}
      {tab === "operations" ? (
        /* Operations — the setter's single-merchant console. It resolves ONE
           merchant (deep link or manual phone) via usePlaybookContact and reads
           `deals`, so it renders here OUTSIDE the WAVV loading gate: a slow or
           broken dialer sync must not blank the working screen, and the WAVV
           sync banners say nothing about it. It ignores the date range entirely. */
        <SetterOpsTab />
      ) : tab === "assignments" ? (
        /* Assignments — the per-setter WORKLIST, not a report. Reads `deals`, so
           it renders here alongside the lead-source tabs rather than behind the
           WAVV gate, and it deliberately ignores the date range above: a book is
           not a window. Scope is enforced inside the panel (a closer sees only
           their own assigned_closer_id) on top of the deals RLS. */
        <AssignmentsPanel viewerId={effectiveUserId} canSeeAll={canSeeAllAssignments} />
      ) : tab === "dial_ceiling" ? (
        /* Dial Ceiling — per-setter OCCUPANCY and the honest-conversation read.
           It calls its own server-side RPCs, so it renders outside the WAVV
           loading gate: the page's paged fold is neither its input nor its
           limit, and waiting on that fold would only delay it. The RANGE is
           shared — the same picker every other tab honours. */
        <DialCeilingPanel
          fromIso={fromIso}
          toIso={toIso}
          rangeLabel={RANGE_LABELS[rangeKey]}
          targetFor={targetFor}
          // The pipeline half. Computed ON THIS PAGE and handed down so the
          // Funnel tab and this tab read the same rows; the panel re-derives
          // nothing. It renders as its OWN card below the dial-side sections
          // and is never summed into them.
          productive={productiveRows}
          productiveError={productiveError}
          productiveLoading={productiveLoading}
          productiveTruncated={productiveTruncated}
          // Same rule as `productive`: the industry read is computed ONCE on
          // this page and handed down, so the Funnel tab and this tab can never
          // print two different per-rep paces.
          repMonthlyPace={repMonthlyPace}
          paceUnavailableReason={paceUnavailableReason}
        />
      ) : isSourceTab(tab) ? (
        <SourceFunnelPanel
          // Keyed by tab so the closer filter resets when you switch products —
          // a closer who works transfers may have no real-time leads at all.
          key={tab}
          def={SOURCE_TABS[tab]}
          cohort={sourceCohorts[tab]}
          loading={sourceDealsLoading}
          error={sourceDealsError}
          truncated={sourceDealsTruncated}
          targetFor={targetFor}
          rangeLabel={RANGE_LABELS[rangeKey]}
          anyNameUnknown={sourceCohorts[tab]?.groups.some((g) => g.nameUnknown) ?? false}
        />
      ) : loading ? (
        <div className="flex items-center gap-2 text-gray-400 text-sm">
          <span className="loading loading-spinner loading-sm" /> Loading WAVV calls…
        </div>
      ) : (
        <>
          {/* ═══════════════ FUNNEL ═══════════════ */}
          {tab === "funnel" && (
            /* The productive-contacts card sits OUTSIDE the emptyRange branch:
               it reads `deals`, not WAVV, so a range with no mirrored dials can
               still hold real pipeline work — and "no dials" must never blank
               the one panel that would prove it. */
            <div className="space-y-5">
            {emptyRange ? <EmptyRange total={totalRowsEver} /> : (
              <>
                {/* Floor totals */}
                <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
                  {[
                    { label: "Dials", value: funnel.dials, fmt: (v: number) => v.toLocaleString(), help: "Outbound call rows in this range" },
                    { label: "Connects", value: funnel.connects, fmt: (v: number) => v.toLocaleString(), help: "WAVV recorded an answer — includes answering machines" },
                    { label: "Humans", value: funnel.humans, fmt: (v: number) => v.toLocaleString(), help: "Answered and not a voicemail/no-answer — WAVV's own human flag is not used" },
                    { label: "Conversations", value: funnel.conversations, fmt: (v: number) => v.toLocaleString(), help: CONVERSATION_HELP },
                    { label: "Talk time", value: funnel.talkSeconds, fmt: hms, help: "Total seconds across every dial in range" },
                    { label: "Unique leads", value: funnel.uniqueLeads, fmt: (v: number) => v.toLocaleString(), help: "Distinct merchant phone numbers dialed" },
                  ].map((kpi) => (
                    <div key={kpi.label} className="card bg-base-100 border border-base-300 shadow-sm" title={kpi.help}>
                      <div className="card-body p-4">
                        <div className="text-xs uppercase tracking-wide text-gray-400">{kpi.label}</div>
                        <div className="text-xl font-semibold text-gray-900 dark:text-white">
                          {kpi.value === null ? <Metric value={null} /> : kpi.fmt(kpi.value)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* ── "What happened" — one row per setter for this range: dials →
                    conversations → positives, plus the pipeline outcomes (appts,
                    apps + $ added, statements in). The daily read-at-a-glance. */}
                {setterDigest.length > 0 && (
                  <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
                    <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-2">
                      What happened — by setter
                    </h3>
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="text-[10px] uppercase tracking-wide text-gray-400">
                            <th className="px-3 py-1.5 text-left">Setter</th>
                            <th className="px-3 py-1.5 text-right">Dials</th>
                            <th className="px-3 py-1.5 text-right">Conversations</th>
                            <th className="px-3 py-1.5 text-right">Positives</th>
                            <th className="px-3 py-1.5 text-right">Appts</th>
                            <th className="px-3 py-1.5 text-right" title="Credited to the person who SENT the application (not the assigned book)">Apps sent</th>
                            <th className="px-3 py-1.5 text-right">$ added</th>
                            <th className="px-3 py-1.5 text-right" title="Deals whose bank statements arrived in this range (assigned to this setter)">Stmts in</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                          {setterDigest.map((r) => (
                            <tr key={r.id}>
                              <td className="px-3 py-1.5 font-semibold text-gray-900 dark:text-white">{r.name}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{r.dials.toLocaleString()}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{r.conversations.toLocaleString()}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{r.positives.toLocaleString()}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{r.appointments.toLocaleString()}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{r.apps.toLocaleString()}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">
                                {r.askTotal > 0 ? `$${Math.round(r.askTotal).toLocaleString()}` : "—"}
                              </td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{r.statementsIn.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Grouping sub-toggle — a control INSIDE this panel, not a page tab. */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs uppercase tracking-wide text-gray-400">Group the funnel by</span>
                    <div role="tablist" aria-label="Funnel grouping" className="inline-flex rounded-lg border border-base-300 bg-base-200/60 dark:bg-gray-800/50 p-0.5">
                      {FUNNEL_VIEWS.map((v) => (
                        <button
                          key={v.id}
                          role="tab"
                          aria-selected={funnelView === v.id}
                          onClick={() => setFunnelView(v.id)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                            funnelView === v.id
                              ? "bg-base-100 dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm"
                              : "text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                          }`}
                        >
                          {v.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* Combined keeps its legend inside the card header, as it always has. */}
                  {funnelView !== "combined" && <RagLegend />}
                </div>

                {/* ── Combined: the team-wide funnel, unchanged ── */}
                {funnelView === "combined" && (
                  <FunnelCard
                    calls={aggRows}
                    title="Dial funnel (outbound)"
                    icon
                    targetFor={targetFor}
                    headerRight={<RagLegend />}
                    onPositivesClick={jumpToPositives}
                    appsForScope={appsRungCombined}
                  >
                    <div className="rounded-md border border-base-300 bg-base-200/50 dark:bg-gray-800/40 px-3 py-2 text-xs text-gray-500 dark:text-gray-400 space-y-1">
                      <div>
                        <span className="font-semibold text-gray-700 dark:text-gray-200">Conversation</span> = the setter
                        reached a live person and dispositioned the call — Interested, Not Interested, Appointment Set,
                        Callback, Full Application or Do Not Contact. <b>Voicemails are excluded.</b> Neither call
                        length nor WAVV's <code>human</code> flag is used: voicemails run long and get flagged human,
                        and real talks sometimes do not.
                      </div>
                      <div className="opacity-90">
                        These counts come from setter dispositions, so a setter who does not disposition their calls
                        under-reports conversations.
                      </div>
                    </div>

                    <p className="text-xs text-gray-400">
                      Thresholds come from <code>platform_settings.ph_dialer_kpi_targets</code>. A rate marked
                      with <span className="font-semibold">·</span> has no stored threshold and is judged against a
                      built-in default. A rate with no threshold at all renders grey — never green.
                      {targets === null && <span className="text-amber-600 dark:text-amber-400"> Targets could not be read this load, so stored thresholds are not in play.</span>}
                    </p>
                  </FunnelCard>
                )}

                {/* ── By setter: one compact funnel per setter (unassigned lines
                       keep their own card, titled with the line) ── */}
                {funnelView === "setter" && (
                  funnelGroups.length === 0 ? (
                    <div className="alert">
                      <InformationCircleIcon className="w-5 h-5" />
                      <span>No calls in this range can be grouped by setter.</span>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
                        {funnelGroups.map((g) => {
                          // Deals attribute to a SETTER, not to a phone line — so an
                          // unassigned NUMBER card gets no Applications rung
                          // (undefined → omitted). A real setter reads its own book
                          // from appsBySetter; null there means the pipeline read
                          // failed and the rung draws "—".
                          const setterId = g.key.startsWith("setter:") ? g.key.slice("setter:".length) : null;
                          const appsForScope: AppsRung | null | undefined = setterId
                            ? (appsBySetter === null ? null : (appsBySetter.get(setterId) ?? { applications: 0, withStatements: 0, askTotal: 0 }))
                            : undefined;
                          return (
                            <FunnelCard
                              key={g.key}
                              calls={g.calls}
                              title={g.title}
                              subtitle={g.subtitle}
                              badge={g.unassigned ? "unassigned" : undefined}
                              targetFor={targetFor}
                              compact
                              appsForScope={appsForScope}
                            />
                          );
                        })}
                      </div>
                      <p className="text-xs text-gray-400">
                        {funnelGroups.length.toLocaleString()} card{funnelGroups.length === 1 ? "" : "s"} with dials in this
                        range, sorted by dials. Each runs the same funnel definition and the same thresholds as the combined
                        view. A card marked <span className="text-amber-600 dark:text-amber-400 font-medium">unassigned</span>{" "}
                        is a NUMBER nobody is mapped to — assign it on the Numbers tab and its dials move to that person.
                      </p>
                    </>
                  )
                )}

                {/* ── HOW THE FUNNEL COMPARES TO THE INDUSTRY ──────────────
                    The funnel above is measured; these are the outside bands
                    it can be read against. They are a SECOND OPINION, not a
                    target: nothing here recolours a KPI, and the palette is
                    deliberately narrower (green/amber/grey, never red) so a
                    rule of thumb is never mistaken for the owner's threshold.
                    Every tile is folded from rows already loaded — no query
                    was added to draw this. */}
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                      <ScaleIcon className="w-5 h-5 text-mint-green" /> This funnel vs the industry
                    </h2>
                    <BenchmarkLegend />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                    <BenchmarkTile
                      id="contact_rate"
                      value={industryValues.contact_rate ?? null}
                      label="Contact rate (cold dial)"
                      basis={`${funnel.conversations.toLocaleString()} conversations ÷ ${funnel.dials.toLocaleString()} dials · per dial — real conversations reaching a decision-maker, not raw pickups.`}
                    />
                    <BenchmarkTile
                      id="app_per_conversation"
                      value={industryValues.app_per_conversation ?? null}
                      label="Applications per conversation"
                      basis={`${applicationDispositions.toLocaleString()} call${applicationDispositions === 1 ? "" : "s"} dispositioned ${APPLICATION_DISPOSITIONS.join(" / ")} ÷ ${funnel.conversations.toLocaleString()} conversations.`}
                      caveat={
                        applicationDispositions === 0 && funnel.conversations > 0
                          ? "No application disposition in range — an app taken and logged as something else scores zero here."
                          : undefined
                      }
                    />
                    <BenchmarkTile
                      id="app_to_fund_cold"
                      value={industryValues.app_to_fund_cold ?? null}
                      label="Application → funded"
                      basis={
                        productiveTotals
                          ? `${productiveTotals.funded.toLocaleString()} funded ÷ ${productiveTotals.appsSent.toLocaleString()} applications sent, both stamped in this range.`
                          : "Pipeline read unavailable this load."
                      }
                      caveat="Different deals: what funded this range mostly applied earlier. Read it over a long range, never over a day."
                    />
                    <BenchmarkTile
                      id="avg_advance"
                      value={industryValues.avg_advance ?? null}
                      label="Average advance"
                      basis="Sum of amount_funded ÷ deals funded in this range."
                      caveat={dealsError ? "Deals unreadable this load — unknown, not $0." : undefined}
                    />
                  </div>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">
                    <b>The industry's #1 leak is the same as this shop's:</b>{" "}
                    {INDUSTRY_BENCHMARKS.statements_leakage.band.toLowerCase()} — merchants who apply and then
                    never send bank statements. That loss lands between the two middle tiles, and the deals
                    sitting in it are worked from <b>Doc Review</b> and the Revenue Playbook, not from here.
                  </p>
                </div>

                {/* ── Positive dispositions, call by call ── */}
                <div
                  ref={positivesRef}
                  className={`card bg-base-100 border shadow-sm scroll-mt-4 transition-colors ${
                    positivesHighlight ? "border-mint-green" : "border-base-300"
                  }`}
                >
                  <div className="card-body p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                        <CheckCircleIcon className="w-5 h-5 text-mint-green" /> Positive dispositions
                      </h2>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {positiveCounts.map((p) => (
                          <span
                            key={p.disposition}
                            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs ${
                              p.count > 0 ? RAG_CHIP.green : RAG_CHIP.none
                            }`}
                          >
                            {p.disposition}
                            <b className="tabular-nums">{p.count.toLocaleString()}</b>
                          </span>
                        ))}
                      </div>
                    </div>

                    {positiveCalls.length === 0 ? (
                      <div className="rounded-md border border-base-300 bg-base-200/50 dark:bg-gray-800/40 px-3 py-3 text-sm text-gray-500 dark:text-gray-400">
                        <b className="text-gray-700 dark:text-gray-200">No positive dispositions in this range.</b> Every
                        dial was dispositioned something else, or left undispositioned — an undispositioned call never
                        counts here, so this can read empty on a day that had real interest.
                      </div>
                    ) : (
                      <>
                        {positiveDealsError && (
                          <div className="alert alert-warning text-sm">
                            <ExclamationTriangleIcon className="w-5 h-5 shrink-0" />
                            <span>
                              <b>Merchant columns unreadable this load</b> ({positiveDealsError}) — Business,
                              Amount requested and Monthly revenue show “—”, which means <b>unknown</b>, never
                              "this merchant asked for nothing".
                            </span>
                          </div>
                        )}
                        <div className={TABLE_WRAP}>
                          <table className={TABLE}>
                            <thead className={THEAD}>
                              <tr>
                                <th className={TH}>Time (ET)</th>
                                <th className={TH}>Setter</th>
                                <th className={TH}>Merchant</th>
                                <th className={TH}>Business</th>
                                <th className={TH}>Phone</th>
                                <th className={TH}>Amount requested</th>
                                <th className={TH}>Monthly revenue</th>
                                <th className={TH}>Disposition</th>
                                <th className={TH} />
                              </tr>
                            </thead>
                            <tbody className={TBODY}>
                              {positiveCalls.map((r) => {
                                const money = positiveMerchant(r);
                                return (
                                <tr key={r.wavv_call_id} className={TR}>
                                  <td className={`${TD} whitespace-nowrap`} title={localTimeTitle(r.started_at)}>
                                    {etStamp(r.started_at)}
                                  </td>
                                  <td className={TD}>
                                    <div className="flex items-center gap-2">
                                      <span className="truncate">{attributionName(r)}</span>
                                      {!r.setter_id && (
                                        <span className="shrink-0 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400">
                                          unassigned
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className={TD}><Text value={r.contact_name} /></td>
                                  <td className={TD}>
                                    {money.businessName ? (
                                      <span className="text-gray-900 dark:text-white">{money.businessName}</span>
                                    ) : (
                                      <span
                                        className="text-gray-300 dark:text-gray-600"
                                        title="No business name on a deal we can read for this merchant"
                                      >
                                        —
                                      </span>
                                    )}
                                  </td>
                                  <td className={`${TD} tabular-nums whitespace-nowrap`}>{prettyPhone(r.phone)}</td>
                                  <td className={`${TD} tabular-nums whitespace-nowrap`}>
                                    {money.amountRequested != null ? (
                                      <b className="text-gray-900 dark:text-white">{usd(money.amountRequested)}</b>
                                    ) : (
                                      <span
                                        className="text-gray-300 dark:text-gray-600"
                                        title="No amount on a deal we can read for this merchant"
                                      >
                                        —
                                      </span>
                                    )}
                                  </td>
                                  <td className={`${TD} tabular-nums whitespace-nowrap`}>
                                    {money.monthlyRevenue != null ? (
                                      <span className="text-gray-700 dark:text-gray-200">
                                        {usd(money.monthlyRevenue)}<span className="text-gray-400">/mo</span>
                                      </span>
                                    ) : (
                                      <span
                                        className="text-gray-300 dark:text-gray-600"
                                        title="No stated monthly revenue on a deal we can read for this merchant"
                                      >
                                        —
                                      </span>
                                    )}
                                  </td>
                                  <td className={TD}>
                                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${RAG_CHIP.green}`}>
                                      {r.disposition}
                                    </span>
                                  </td>
                                  <td className={`${TD} text-right whitespace-nowrap`}>
                                    <div className="inline-flex items-center gap-3">
                                      {/* Text the merchant on the company line without
                                          leaving the scorecard — same JMP send path
                                          (sms-send) as the playbook. Only shown when
                                          WAVV carried a number to text. */}
                                      {r.phone && (
                                        <TextMerchantPanel
                                          merchantPhone={r.phone}
                                          merchantFirstName={(r.contact_name ?? "").trim().split(/\s+/)[0] || undefined}
                                          businessName={money.businessName}
                                          buttonLabel="Text"
                                          buttonClassName="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-300 hover:underline underline-offset-2 font-medium"
                                          presentation="modal"
                                        />
                                      )}
                                      {r.contact_id ? (
                                        <Link
                                          to={`/admin/playbooks?contact=${encodeURIComponent(r.contact_id)}`}
                                          className="text-mint-green hover:underline underline-offset-2 font-medium"
                                          title="Open this merchant in the Revenue Playbook"
                                        >
                                          Open →
                                        </Link>
                                      ) : !r.phone ? (
                                        <span className="text-gray-300 dark:text-gray-600" title="WAVV did not tie this dial to a contact record, so there is nothing to open">
                                          —
                                        </span>
                                      ) : null}
                                    </div>
                                  </td>
                                </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        <p className="text-xs text-gray-400">
                          {positiveCalls.length.toLocaleString()} call{positiveCalls.length === 1 ? "" : "s"} in this range
                          carried a positive disposition, newest first inside each type. <b>Open →</b> takes you straight
                          into that merchant's Revenue Playbook. Times are US Eastern; hover a time for your own clock.
                        </p>
                        <p className="text-xs text-gray-400">
                          <b className="text-gray-500 dark:text-gray-300">Business</b>,{" "}
                          <b className="text-gray-500 dark:text-gray-300">Amount requested</b> and{" "}
                          <b className="text-gray-500 dark:text-gray-300">Monthly revenue</b> are read off the merchant's
                          live deal, matched on the dialed contact — <b>whenever that deal was worked</b>, not only inside
                          this range, and a dead duplicate never wins over the live cycle. A <b>—</b> means no deal we can
                          read carries the figure — the field was never filled, or the deal belongs to another setter
                          (setters see the money only on their own book). It never means zero.
                        </p>
                      </>
                    )}
                  </div>
                </div>

                {/* The insight — the thing a manager should act on */}
                {funnelView === "combined" && funnel.dials > 0 && (
                  <div className="card bg-base-100 border border-base-300 shadow-sm">
                    <div className="card-body p-4">
                      <h2 className="font-semibold text-gray-900 dark:text-white">Where the floor is losing the day</h2>
                      <ul className="mt-2 space-y-2 text-sm text-gray-600 dark:text-gray-300">
                        <li>
                          <span className="font-semibold text-gray-900 dark:text-white">Answers are not contacts.</span>{" "}
                          {funnel.connects.toLocaleString()} of {funnel.dials.toLocaleString()} dials registered an answer
                          ({funnel.dials > 0 ? ((funnel.connects / funnel.dials) * 100).toFixed(0) : "—"}%), but only{" "}
                          <b className="text-gray-900 dark:text-white">{funnel.connects > 0 ? ((funnel.humans / funnel.connects) * 100).toFixed(0) : "—"}%</b>{" "}
                          of those reached a <b>human</b> — the rest are answering machines. Judge the floor on humans, not connects.
                        </li>
                        <li>
                          <span className="font-semibold text-gray-900 dark:text-white">The tail is thin.</span>{" "}
                          <b className="text-gray-900 dark:text-white">{funnel.conversations.toLocaleString()}</b> calls were
                          dispositioned as a real conversation, and <b className="text-gray-900 dark:text-white">{funnel.positives.toLocaleString()}</b>{" "}
                          calls carried a positive disposition ({POSITIVE_DISPOSITIONS.join(", ")}) — that is{" "}
                          <b className="text-gray-900 dark:text-white">
                            {funnel.dials > 0 ? ((funnel.positives / funnel.dials) * 100).toFixed(2) : "—"}%
                          </b>{" "}
                          of all dials.
                        </li>
                        <li>
                          <span className="font-semibold text-gray-900 dark:text-white">Dials per conversation:</span>{" "}
                          <b className="text-gray-900 dark:text-white">
                            {funnel.conversations > 0 ? Math.round(funnel.dials / funnel.conversations).toLocaleString() : "—"}
                          </b>
                          {funnel.conversations > 0 && " dials buy one real conversation at the current list and script quality."}
                        </li>
                      </ul>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ── PRODUCTIVE CONTACTS — the pipeline-side positive ──────────
                Placed directly under the dial funnel and deliberately NOT
                merged into it. The dial funnel counts dispositions; this counts
                stage stamps on real merchants. The GAP between them is the
                finding, so the two are shown side by side and never summed. */}
            <div className="card bg-base-100 border border-base-300 shadow-sm">
              <div className="card-body p-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                      <ClipboardDocumentListIcon className="w-5 h-5 text-mint-green" />
                      Productive contacts (pipeline)
                    </h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-3xl">
                      Read from <code>deals</code>, not from dispositions. A setter who holds a real
                      conversation and never dispositions it scores <b>zero</b> in the funnel above and still
                      shows here, because the merchant moved. Owned by <code>assigned_closer_id</code> falling
                      back to <code>created_by</code>, with <b>no lead-source filter</b> — the setters' main
                      book is <code>ucc_list</code> and filtering would erase it.
                    </p>
                  </div>
                  {productiveTotals && (
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        { label: "contacts", n: productiveTotals.deals },
                        { label: "contacted", n: productiveTotals.contacted },
                        { label: "qualified", n: productiveTotals.qualified },
                        { label: "app sent", n: productiveTotals.appsSent },
                        { label: "appts", n: productiveTotals.appointments },
                        { label: "funded", n: productiveTotals.funded },
                      ].map((k) => (
                        <span
                          key={k.label}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs ${
                            k.n > 0 ? RAG_CHIP.green : RAG_CHIP.none
                          }`}
                        >
                          {k.label}
                          <b className="tabular-nums">{k.n.toLocaleString()}</b>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {productiveError ? (
                  <div className="alert alert-error text-sm">
                    <ExclamationTriangleIcon className="w-5 h-5 shrink-0" />
                    <span>
                      <b>Productive contacts unreadable</b> — this is not "nobody produced anything".{" "}
                      {productiveError}
                    </span>
                  </div>
                ) : productiveLoading && !productiveRows ? (
                  <div className="flex items-center gap-2 text-gray-400 text-sm py-3">
                    <span className="loading loading-spinner loading-sm" /> Loading productive contacts…
                  </div>
                ) : !productiveRows || productiveRows.length === 0 ? (
                  <div className="rounded-md border border-base-300 bg-base-200/50 dark:bg-gray-800/40 px-3 py-3 text-sm text-gray-500 dark:text-gray-400">
                    <b className="text-gray-700 dark:text-gray-200">
                      No deal carried a stage stamp in this range.
                    </b>{" "}
                    The read succeeded — this is a genuinely quiet window on the pipeline side, not a failed
                    query.
                  </div>
                ) : (
                  <>
                    <div className={TABLE_WRAP}>
                      <table className={TABLE}>
                        <thead className={THEAD}>
                          <tr>
                            <th className={TH}>Setter</th>
                            <th className={TH_NUM} title="Dials in range on the WAVV side — context, never added to the pipeline columns">
                              Dials
                            </th>
                            <th className={TH_NUM} title="Positive dispositions the setter LOGGED — the dial-side score">
                              Positives logged
                            </th>
                            <th className={`${TH_NUM} ${GROUP_EDGE}`} title="Distinct deals with at least one stage stamp in this range">
                              Productive contacts
                            </th>
                            <th className={TH_NUM}>Contacted</th>
                            <th className={TH_NUM}>Qualified</th>
                            <th className={TH_NUM}>App sent</th>
                            <th className={TH_NUM} title="A booked appointment, or a promised one where no time is on the calendar yet">
                              Appts
                            </th>
                            <th className={TH_NUM}>Funded</th>
                          </tr>
                        </thead>
                        <tbody className={TBODY}>
                          {productiveRows.map((r) => (
                            <tr key={r.setterId} className={TR}>
                              <td className={`${TD} font-medium text-gray-900 dark:text-white`}>
                                {r.name}
                                {r.nameUnknown && (
                                  <div className="text-[10px] text-amber-600 dark:text-amber-400">
                                    name not readable — shown by id
                                  </div>
                                )}
                                {r.dials === null && (
                                  <div className="text-[10px] text-gray-400">no dials in this range</div>
                                )}
                              </td>
                              <td className={`${TD_NUM} text-gray-500 dark:text-gray-400`}>
                                {r.dials === null ? <Metric value={null} /> : r.dials.toLocaleString()}
                              </td>
                              <td className={`${TD_NUM} text-gray-500 dark:text-gray-400`}>
                                {r.positivesLogged === null ? <Metric value={null} /> : r.positivesLogged.toLocaleString()}
                              </td>
                              <td className={`${TD_NUM} ${GROUP_EDGE} font-semibold text-base`}>
                                {r.deals.toLocaleString()}
                              </td>
                              <td className={TD_NUM}>{r.contacted.toLocaleString()}</td>
                              <td className={TD_NUM}>{r.qualified.toLocaleString()}</td>
                              <td className={`${TD_NUM} font-semibold`}>{r.appsSent.toLocaleString()}</td>
                              <td className={TD_NUM}>{r.appointments.toLocaleString()}</td>
                              <td className={TD_NUM}>{r.funded.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-xs text-gray-400">
                      Rows are the <b>union</b> of setters with dials and setters with pipeline movement, so a
                      setter with zero dials in range still appears. <b>Dials</b> and <b>positives logged</b>{" "}
                      read “—” for a setter with no dial rows — unknown, not zero.{" "}
                      <b>Read the gap</b>: far more productive contacts than positives logged means the talks
                      are happening and not being dispositioned. The un-dispositioned calls behind that gap are
                      listed on the <b>Disposition Review</b> tab.
                      {productiveTruncated && (
                        <span className="text-amber-600 dark:text-amber-400">
                          {" "}This range hit the {PRODUCTIVE_DEAL_CAP.toLocaleString()}-deal read cap, so these
                          counts are a floor, not a total — narrow the range.
                        </span>
                      )}
                    </p>
                  </>
                )}

                {/* Rep economics, against the industry band. Per-rep MONTHLY
                    pace cannot be honestly extrapolated from a short window, so
                    on a short range the band is shown alone and the reason is
                    printed rather than a scaled-up guess. */}
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400 border-t border-base-300 pt-2">
                  <span className="font-semibold text-gray-600 dark:text-gray-300">Rep economics:</span>
                  <BenchmarkChip id="deals_per_rep_month" value={industryValues.deals_per_rep_month ?? null} />
                  {repMonthlyPace === null ? (
                    <span>{paceUnavailableReason}</span>
                  ) : (
                    <span>
                      This floor is funding{" "}
                      <b className="text-gray-700 dark:text-gray-200">{repMonthlyPace.toFixed(1)}</b> advances per rep
                      per 30 days, across{" "}
                      {(productiveRows ?? []).filter((r) => r.setterId !== UNATTRIBUTED_OWNER).length} rep
                      {(productiveRows ?? []).filter((r) => r.setterId !== UNATTRIBUTED_OWNER).length === 1 ? "" : "s"}{" "}
                      with work in range, scaled from {Math.round(rangeDays)} days.
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* The full nine, folded away. Reference content collapses; the
                measured work above stays open. */}
            <IndustryComparisonCard
              values={industryValues}
              rangeLabel={RANGE_LABELS[rangeKey]}
              basis={{
                contact_rate: `${funnel.conversations.toLocaleString()} conversations ÷ ${funnel.dials.toLocaleString()} dials · per dial — real conversations reaching a decision-maker, not raw pickups`,
                app_per_conversation: `${applicationDispositions.toLocaleString()} app dispositions ÷ ${funnel.conversations.toLocaleString()} conversations`,
                app_to_fund_cold: productiveTotals
                  ? `${productiveTotals.funded.toLocaleString()} funded ÷ ${productiveTotals.appsSent.toLocaleString()} apps sent (in-range stamps, different deals)`
                  : "pipeline unreadable",
                avg_advance: "sum of amount_funded ÷ deals funded in range",
                deals_per_rep_month: `funded per rep, scaled from ${Math.round(rangeDays)} days`,
              }}
            />
            </div>
          )}

          {/* ═══════════════ SETTERS ═══════════════ */}
          {tab === "setters" && (
            emptyRange ? <EmptyRange total={totalRowsEver} /> : (
              <div className="space-y-4">
                <div className="card bg-base-100 border border-base-300 shadow-sm">
                  <div className="card-body p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                        <UserGroupIcon className="w-5 h-5 text-mint-green" /> Per-setter scorecard
                      </h2>
                      <RagLegend />
                    </div>
                    {/* The two industry bands the PIPELINE half of this table
                        can be read against. Both hang off the Funded column —
                        the dialing half has no per-dial industry counterpart
                        here, because Answer% and Human% are per-answer rates
                        and the industry contact band is per dial (it is shown
                        against the right denominator on the Funnel tab). */}
                    <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs text-gray-400">
                      <span className="font-semibold text-gray-600 dark:text-gray-300">Funded column vs industry:</span>
                      <BenchmarkChip id="avg_advance" value={industryValues.avg_advance ?? null} />
                      <BenchmarkChip id="deals_per_rep_month" value={industryValues.deals_per_rep_month ?? null} />
                      <span>
                        {industryValues.avg_advance
                          ? <>Average advance this range is <b className="text-gray-600 dark:text-gray-300">{usd(Math.round(industryValues.avg_advance))}</b>.</>
                          : <>No funded advance in this range to average — unknown, not $0.</>}
                        {repMonthlyPace === null && rangeDays < PACE_MIN_DAYS && " Per-rep monthly pace needs a 14-day range or longer."}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      Left half = dialing, attributed by the number dialed FROM. Right half = pipeline, from
                      Deals assigned to that person in this range. An unassigned number has no person to join
                      deals on, so its pipeline cells read “—”.
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      <span className="font-semibold text-gray-600 dark:text-gray-300">Convos</span> = the setter reached a
                      live person and dispositioned the call (voicemails excluded); it is not a call-length test.
                      Undispositioned calls are not counted.
                    </p>
                    {dealsError && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                        Pipeline columns unreadable this load ({dealsError}) — they show “—”, which is unknown, not zero.
                      </p>
                    )}

                    <div className={`${TABLE_WRAP} mt-3`}>
                      <table className={TABLE}>
                        <thead className={THEAD}>
                          <tr>
                            <th className={`${TH} border-b-0`} />
                            <th colSpan={8} className={`${TH} text-center border-b-0`}>Dialing (WAVV)</th>
                            <th colSpan={3} className={`${TH} ${GROUP_EDGE} text-center border-b-0`}>Pipeline (Deals)</th>
                          </tr>
                          <tr>
                            {SETTER_COLUMNS.map((c) => (
                              <th
                                key={c.key ?? c.label}
                                className={`${c.align === "text-right" ? TH_NUM : TH} ${c.groupStart ? GROUP_EDGE : ""} ${c.key ? "cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200" : ""}`}
                                onClick={() => c.key && sortBy(c.key)}
                                title={c.help}
                              >
                                {c.label}
                                {c.key && sort.key === c.key && <span className="ml-1 text-mint-green">{sort.desc ? "▼" : "▲"}</span>}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className={TBODY}>
                          {sortedSetterRows.map((r) => {
                            const dialsPerDay = r.activeDays > 0 ? r.dials / r.activeDays : null;
                            const answerRate = r.dials > 0 ? (r.connects / r.dials) * 100 : null;
                            const humanRate = r.connects > 0 ? (r.human / r.connects) * 100 : null;
                            const dpd = targetFor("dials_per_day");
                            const dpdRag = ragOf(dialsPerDay, dpd.target);
                            return (
                              <tr key={r.key} className={TR}>
                                <td className={`${TD} font-medium text-gray-900 dark:text-white min-w-[13rem]`}>
                                  <div className="flex items-center gap-2">
                                    {r.name}
                                    {!r.attributed && (
                                      <span className="badge badge-xs badge-ghost" title="This number has no setter assigned — assign it in the Numbers tab">
                                        unassigned
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-xs text-gray-400 mt-0.5">{r.numbers.map(prettyPhone).join(" · ") || "—"}</div>
                                </td>
                                <td className={TD_NUM}>{r.dials.toLocaleString()}</td>
                                <td className={TD_NUM}>
                                  <span className={`font-semibold ${RAG_TEXT[dpdRag]}`} title={dpd.target ? `Target ≥${dpd.target.green}/day green, ≥${dpd.target.amber} amber · over ${r.activeDays} day${r.activeDays === 1 ? "" : "s"} with activity` : "No threshold configured"}>
                                    <Metric value={dialsPerDay} />
                                  </span>
                                </td>
                                <td className={TD_NUM}>{r.connects.toLocaleString()}</td>
                                <td className={TD_NUM}><RagPct value={answerRate} target={targetFor("answer_rate_pct").target} /></td>
                                <td className={TD_NUM}>{r.human.toLocaleString()}</td>
                                <td className={TD_NUM}><RagPct value={humanRate} target={targetFor("human_rate_pct").target} /></td>
                                <td className={TD_NUM}>
                                  <span title={`${hms(r.talkSeconds)} total talk time across all dials`}>{r.conversations.toLocaleString()}</span>
                                </td>
                                <td className={TD_NUM}>{r.positives.toLocaleString()}</td>
                                <td className={`${TD_NUM} ${GROUP_EDGE}`}>{r.appointments === null ? <Metric value={null} /> : r.appointments.toLocaleString()}</td>
                                <td className={TD_NUM}>{r.appsSent === null ? <Metric value={null} /> : r.appsSent.toLocaleString()}</td>
                                <td className={TD_NUM}>
                                  {r.funded === null ? <Metric value={null} /> : (
                                    <span title={r.fundedAmount ? `${usd(r.fundedAmount)} funded` : undefined}>
                                      {r.funded.toLocaleString()}
                                      {r.fundedAmount ? <span className="text-xs text-gray-400 ml-1.5">{usd(r.fundedAmount)}</span> : null}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                          {sortedSetterRows.length === 0 && (
                            <tr><td colSpan={12} className="text-center text-sm text-gray-400 py-8">No outbound calls in this range.</td></tr>
                          )}
                        </tbody>
                        <tfoot>
                          <tr className="font-semibold bg-base-200/60 dark:bg-gray-800/50 border-t-2 border-base-300">
                            <td className={`${TD} text-gray-900 dark:text-white`}>Team</td>
                            <td className={TD_NUM}>{funnel.dials.toLocaleString()}</td>
                            <td className={TD_NUM}><Metric value={null} /></td>
                            <td className={TD_NUM}>{funnel.connects.toLocaleString()}</td>
                            <td className={TD_NUM}><RagPct value={funnel.dials > 0 ? (funnel.connects / funnel.dials) * 100 : null} target={targetFor("answer_rate_pct").target} /></td>
                            <td className={TD_NUM}>{funnel.humans.toLocaleString()}</td>
                            <td className={TD_NUM}><RagPct value={funnel.connects > 0 ? (funnel.humans / funnel.connects) * 100 : null} target={targetFor("human_rate_pct").target} /></td>
                            <td className={TD_NUM}>{funnel.conversations.toLocaleString()}</td>
                            <td className={TD_NUM}>{funnel.positives.toLocaleString()}</td>
                            <td className={`${TD_NUM} ${GROUP_EDGE}`}>{sumOrDash(sortedSetterRows.map((r) => r.appointments))}</td>
                            <td className={TD_NUM}>{sumOrDash(sortedSetterRows.map((r) => r.appsSent))}</td>
                            <td className={TD_NUM}>{sumOrDash(sortedSetterRows.map((r) => r.funded))}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            )
          )}

          {/* ═══════════════ TALK TIME ═══════════════ */}
          {tab === "talk_time" && (
            emptyRange ? <EmptyRange total={totalRowsEver} /> : (
              <div className="space-y-4">
                {/* ── The caveat that governs everything below it ── */}
                <div className="alert alert-warning items-start">
                  <ExclamationTriangleIcon className="w-5 h-5 shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <div className="font-semibold">
                      These are LINES, not people. WAVV cannot tie a call to an individual setter.
                    </div>
                    <div className="opacity-90 mt-1">
                      WAVV's call records carry <b>no per-agent field at all</b> — the only dial-side identifier is the
                      number dialed FROM. That alone makes a per-person talk-time row one person's{" "}
                      <b>name worn by the whole line's traffic</b>.
                      {/* The strength of the second claim is set by what THIS range
                          actually proves, so the banner never over-claims on a
                          quiet window. */}
                      {(() => {
                        const proven = talk.rows.filter((r) => (r.peakConcurrentHuman ?? 0) >= 2);
                        const heavy = talk.rows.filter((r) => (r.peakConcurrent ?? 0) >= 5);
                        if (proven.length > 0) {
                          return (
                            <> And in this range these lines are <b>provably shared</b>: {proven.map((r) => `line ${r.lineNo}`).join(", ")}{" "}
                            carried two live conversations at the same moment, which one person cannot do.</>
                          );
                        }
                        if (heavy.length > 0) {
                          return (
                            <> In this range {heavy.map((r) => `line ${r.lineNo}`).join(", ")} peaked at{" "}
                            {heavy.map((r) => r.peakConcurrent).join(" / ")} simultaneous calls, well past the ~4 one
                            WAVV seat power-dials — consistent with several seats sharing the number.</>
                          );
                        }
                        return (
                          <> This range does not itself show overlapping calls, so it neither proves nor disproves
                          sharing here — but the missing per-agent field is structural and applies regardless.</>
                        );
                      })()}{" "}
                      Per-line and floor-wide talk time below are real and measured. True per-setter talk time needs{" "}
                      <b>one WAVV number per setter</b>.
                    </div>
                    {/* The caveat carries its own proof, computed from the loaded
                        rows — not an assertion the reader has to take on trust. */}
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      {talk.rows.map((r) => (
                        <span
                          key={r.key}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs ${
                            (r.peakConcurrentHuman ?? 0) >= 2 ? RAG_CHIP.red : RAG_CHIP.none
                          }`}
                          title={
                            r.peakConcurrent === null
                              ? "No call on this line carries both a start and an end time, so concurrency cannot be swept"
                              : `Peak simultaneous calls on this line. One WAVV seat power-dials about 4 lines, so a peak well above that is more than one person.${
                                  (r.peakConcurrentHuman ?? 0) >= 2
                                    ? ` And ${r.peakConcurrentHuman} LIVE CONVERSATIONS overlapped here — one person cannot talk to two merchants at once.`
                                    : ""
                                }`}
                        >
                          Line {r.lineNo}: <b className="tabular-nums">{r.peakConcurrent === null ? "—" : `${r.peakConcurrent} calls at once`}</b>
                          {(r.peakConcurrentHuman ?? 0) >= 2 && (
                            <b className="tabular-nums">· {r.peakConcurrentHuman} live talks at once</b>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* ── Dials vs talk, by line ── */}
                <div className="card bg-base-100 border border-base-300 shadow-sm">
                  <div className="card-body p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                        <ClockIcon className="w-5 h-5 text-mint-green" /> Dials vs talk time, by line
                      </h2>
                      <RagLegend />
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      <span className="font-semibold text-gray-600 dark:text-gray-300">Talk min</span> counts only the
                      seconds on calls that reached a <b>live person</b>. A played voicemail is a connection, not a
                      conversation, so its seconds land in <span className="font-semibold text-amber-600 dark:text-amber-400">machine time</span>{" "}
                      instead. Read the two leftmost number columns together: a big dial count next to a small talk
                      number means that line is blasting voicemail — <b>a fact about the line's traffic</b>, not about
                      any one person on it.
                    </p>

                    <div className={`${TABLE_WRAP} mt-3`}>
                      <table className={TABLE}>
                        <thead className={THEAD}>
                          <tr>
                            <th className={`${TH} border-b-0`} />
                            <th colSpan={4} className={`${TH} text-center border-b-0`}>Dials vs talk</th>
                            <th colSpan={4} className={`${TH} ${GROUP_EDGE} text-center border-b-0`}>Who the line reached</th>
                            <th colSpan={3} className={`${TH} ${GROUP_EDGE} text-center border-b-0`}>Rhythm</th>
                          </tr>
                          <tr>
                            <th className={TH}>Line</th>
                            <th className={TH_NUM} title="Outbound call rows on this line in this range">Dials</th>
                            <th className={TH_NUM} title={TALK_DEF}>Talk min</th>
                            <th className={TH_NUM} title="Talk minutes divided by the days this line dialed — this is the column judged against the talk_min target, so a multi-day range is not compared to a one-day threshold. It is a LINE target, and the line carries several seats.">Talk / day</th>
                            <th className={TH_NUM} title="Talk minutes earned per 100 dials. The blunt efficiency read: how much conversation each hundred dials on this line actually bought.">Talk / 100 dials</th>
                            <th className={`${TH_NUM} ${GROUP_EDGE}`} title="WAVV recorded an answer — INCLUDING answering machines">Connects</th>
                            <th className={TH_NUM} title="Answered and nothing about the call says machine. WAVV's own human flag is not used.">Humans</th>
                            <th className={TH_NUM} title={CONVERSATION_HELP}>Convos</th>
                            <th className={TH_NUM} title="Talk minutes divided by human-reached calls — the average length of a real conversation on this line. Divided by humans, NOT by dispositioned convos, because the seconds in the numerator are exactly the human-reached seconds.">Avg / human</th>
                            <th className={`${TH_NUM} ${GROUP_EDGE}`} title="Talk minutes divided by the number of clock-hours in which this line placed at least one dial">Talk / active hr</th>
                            <th className={TH_NUM} title="Longest stretch between two consecutive dials on this line inside a single day. On a shared line this says THE LINE went quiet — it can never say who stopped dialing.">Longest idle</th>
                            <th className={TH_NUM} title="Most calls in flight at once on this line. One WAVV seat power-dials about 4 lines, so a materially higher peak is several people sharing the number.">Peak at once</th>
                          </tr>
                        </thead>
                        <tbody className={TBODY}>
                          {talk.rows.map((r) => {
                            const talkMin = r.talkSeconds / 60;
                            const machineMin = r.machineSeconds / 60;
                            const answeredMin = talkMin + machineMin;
                            const talkPerDay = r.activeDays > 0 ? talkMin / r.activeDays : null;
                            const talkPer100 = r.dials > 0 ? (talkMin / r.dials) * 100 : null;
                            const avgHuman = r.humans > 0 ? r.talkSeconds / r.humans : null;
                            const talkPerHour = r.activeHours > 0 ? talkMin / r.activeHours : null;
                            const humanShare = answeredMin > 0 ? (talkMin / answeredMin) * 100 : null;
                            const tm = targetFor("talk_min");
                            const ig = targetFor("idle_gap_min");
                            return (
                              <tr key={r.key} className={TR}>
                                <td className={`${TD} font-medium text-gray-900 dark:text-white min-w-[14rem]`}>
                                  <div className="flex items-center gap-2">
                                    <span>Line {r.lineNo}</span>
                                    <span className="text-xs font-normal text-gray-500 dark:text-gray-400 tabular-nums">
                                      {r.callerId ? prettyPhone(r.callerId) : "no caller ID"}
                                    </span>
                                  </div>
                                  {/* The mapping is a LABEL for the line, never the row's identity. */}
                                  <div className="text-[11px] text-gray-400 mt-0.5">
                                    {r.mappedName ? (
                                      <span title="Who the Numbers tab maps this line to. The line is shared by several seats, so this names the line's owner-of-record — NOT the person who made these calls.">
                                        mapped: {r.mappedName} <span className="opacity-70">· shared line</span>
                                      </span>
                                    ) : (
                                      <span className="text-amber-600 dark:text-amber-400" title="No setter is mapped to this number in the Numbers tab">
                                        no setter mapped
                                      </span>
                                    )}
                                  </div>
                                  {/* The talk-vs-machine split of the answered clock, as one bar. */}
                                  <div
                                    className="mt-1.5 h-1.5 w-full max-w-[11rem] rounded bg-base-200 dark:bg-gray-700/40 overflow-hidden flex"
                                    title={
                                      answeredMin > 0
                                        ? `${hms(r.talkSeconds)} with a live person · ${hms(r.machineSeconds)} on machines / unanswered pickups`
                                        : "Nothing was answered on this line in range"
                                    }
                                  >
                                    {answeredMin > 0 && (
                                      <>
                                        <div className="h-full bg-emerald-500" style={{ width: `${(talkMin / answeredMin) * 100}%` }} />
                                        <div className="h-full bg-amber-500/70" style={{ width: `${(machineMin / answeredMin) * 100}%` }} />
                                      </>
                                    )}
                                  </div>
                                  <div className="text-[11px] text-gray-400 mt-0.5">
                                    {humanShare === null
                                      ? <span title="No answered calls, so there is no connected clock to split">—</span>
                                      : <><b className="text-emerald-600 dark:text-emerald-400">{humanShare.toFixed(0)}%</b> of connected time was a person</>}
                                  </div>
                                </td>
                                <td className={TD_NUM}>{r.dials.toLocaleString()}</td>
                                <td className={TD_NUM}>
                                  <span className="font-semibold text-gray-900 dark:text-white" title={`${hms(r.talkSeconds)} with a live person`}>
                                    {talkMin.toFixed(1)}
                                  </span>
                                </td>
                                <td className={TD_NUM}>
                                  <span
                                    className={`font-semibold ${RAG_TEXT[ragOf(talkPerDay, tm.target)]}`}
                                    title={tm.target
                                      ? `Target ≥${tm.target.green} min/day green, ≥${tm.target.amber} amber · over ${r.activeDays} day${r.activeDays === 1 ? "" : "s"} this line dialed`
                                      : "No talk_min threshold configured — not judged"}
                                  >
                                    <Metric value={talkPerDay} digits={1} />
                                  </span>
                                </td>
                                <td className={TD_NUM}><Metric value={talkPer100} digits={1} /></td>
                                <td className={`${TD_NUM} ${GROUP_EDGE}`}>{r.connects.toLocaleString()}</td>
                                <td className={TD_NUM}>{r.humans.toLocaleString()}</td>
                                <td className={TD_NUM}>{r.conversations.toLocaleString()}</td>
                                <td className={TD_NUM}>
                                  {avgHuman === null
                                    ? <Metric value={null} />
                                    : <span title={`${r.humans.toLocaleString()} human-reached calls`}>{hms(avgHuman)}</span>}
                                </td>
                                <td className={`${TD_NUM} ${GROUP_EDGE}`}>
                                  <span title={r.activeHours > 0 ? `${r.activeHours} clock-hour${r.activeHours === 1 ? "" : "s"} in which this line placed at least one dial` : "No hour in range holds a dial on this line"}>
                                    <Metric value={talkPerHour} digits={1} />
                                  </span>
                                </td>
                                <td className={TD_NUM}>
                                  {r.longestIdleGapMin === null ? (
                                    <span className="text-gray-300 dark:text-gray-600" title="No day in this range holds two dials on this line, so there is no gap to measure — this is unmeasurable, not a gapless shift">—</span>
                                  ) : (
                                    <span
                                      className={`font-semibold ${RAG_TEXT[ragOf(r.longestIdleGapMin, ig.target)]}`}
                                      title={`${etStamp(r.idleGapFrom)} → ${etStamp(r.idleGapTo)} (ET) — the whole LINE was silent${ig.target ? ` · target ≤${ig.target.green}m green, ≤${ig.target.amber}m amber` : " · no idle_gap_min threshold configured"}`}
                                    >
                                      {Math.round(r.longestIdleGapMin).toLocaleString()}m
                                    </span>
                                  )}
                                </td>
                                <td className={TD_NUM}>
                                  {r.peakConcurrent === null ? (
                                    <span className="text-gray-300 dark:text-gray-600" title="No call on this line carries both a start and an end, so concurrency cannot be swept">—</span>
                                  ) : (
                                    <span
                                      className={(r.peakConcurrentHuman ?? 0) >= 2 ? "font-semibold text-red-600 dark:text-red-400" : ""}
                                      title={`${r.peakConcurrent} calls in flight simultaneously${
                                        (r.peakConcurrentHuman ?? 0) >= 2
                                          ? ` — and ${r.peakConcurrentHuman} of those overlaps were BOTH live conversations, which one person cannot do`
                                          : ""}`}
                                    >
                                      {r.peakConcurrent.toLocaleString()}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                          {talk.rows.length === 0 && (
                            <tr><td colSpan={12} className="text-center text-sm text-gray-400 py-8">No outbound calls in this range.</td></tr>
                          )}
                        </tbody>
                        <tfoot>
                          <tr className="font-semibold bg-base-200/60 dark:bg-gray-800/50 border-t-2 border-base-300">
                            <td className={`${TD} text-gray-900 dark:text-white`}>
                              Whole floor
                              <div className="text-[11px] font-normal text-gray-400 mt-0.5">
                                every line combined — the level this data is honest at
                              </div>
                            </td>
                            <td className={TD_NUM}>{talkFloor.dials.toLocaleString()}</td>
                            <td className={TD_NUM} title={`${hms(talkFloor.talkSeconds)} with a live person · ${hms(talkFloor.machineSeconds)} on machines`}>
                              {(talkFloor.talkSeconds / 60).toFixed(1)}
                            </td>
                            <td className={TD_NUM}>
                              <Metric value={talkFloor.activeDays > 0 ? talkFloor.talkSeconds / 60 / talkFloor.activeDays : null} digits={1} />
                            </td>
                            <td className={TD_NUM}>
                              <Metric value={talkFloor.dials > 0 ? (talkFloor.talkSeconds / 60 / talkFloor.dials) * 100 : null} digits={1} />
                            </td>
                            <td className={`${TD_NUM} ${GROUP_EDGE}`}>{talkFloor.connects.toLocaleString()}</td>
                            <td className={TD_NUM}>{talkFloor.humans.toLocaleString()}</td>
                            <td className={TD_NUM}>{talkFloor.conversations.toLocaleString()}</td>
                            <td className={TD_NUM}>
                              {talkFloor.humans > 0 ? hms(talkFloor.talkSeconds / talkFloor.humans) : <Metric value={null} />}
                            </td>
                            <td className={`${TD_NUM} ${GROUP_EDGE}`} title={`${talkFloor.activeHours} clock-hour${talkFloor.activeHours === 1 ? "" : "s"} in which the floor placed at least one dial (a union across lines, not a sum)`}>
                              <Metric value={talkFloor.activeHours > 0 ? talkFloor.talkSeconds / 60 / talkFloor.activeHours : null} digits={1} />
                            </td>
                            {/* Idle gap and peak concurrency are per-line facts;
                                a floor-wide number would mean something else
                                entirely, so neither is summed here. */}
                            <td className={TD_NUM}><Metric value={null} /></td>
                            <td className={TD_NUM}><Metric value={null} /></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>

                    <p className="text-xs text-gray-400 mt-2">
                      Sorted by dials, highest first. Talk seconds come from WAVV's per-call duration, which is the
                      answered-to-hung-up span — so an unanswered dial contributes nothing, and a voicemail's seconds
                      are excluded from talk by the same human test the Funnel uses.
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      Only two columns are graded: <b>Talk / day</b> against <code>talk_min</code> and{" "}
                      <b>Longest idle</b> against <code>idle_gap_min</code>, both from{" "}
                      <code>platform_settings.ph_dialer_kpi_targets</code>. Those thresholds are the ones the owner
                      set, not ones derived from what the floor currently does — a column of red means the floor is
                      under the stated target, which is a finding, not a fault in the report. Note both are being
                      applied to a <b>line</b> carrying several seats, so they read as line targets here.
                      {targets === null && <span className="text-amber-600 dark:text-amber-400"> Targets could not be read this load, so both graded columns render grey.</span>}
                    </p>
                  </div>
                </div>

                {/* ── When is the floor on the phone ── */}
                <ActivityHeatmap
                  rows={talk.rows}
                  grids={talk.grids}
                  days={talk.days}
                  hours={talk.hours}
                  metric={talkMetric}
                  onMetric={setTalkMetric}
                  floor={talkFloor}
                />

                {/* ── The one genuinely per-person signal ── */}
                <div className="card bg-base-100 border border-base-300 shadow-sm">
                  <div className="card-body p-4">
                    <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                      <UserGroupIcon className="w-5 h-5 text-mint-green" /> Clocked hours, per setter
                    </h2>
                    <p className="text-xs text-gray-400 mt-1">
                      From each person's own check-in in <b>Time &amp; Pay</b> — the only per-individual signal on this
                      tab, because the worker submits it themselves. It is deliberately <b>not</b> divided into talk
                      minutes: those minutes belong to a shared line and cannot be split between the people on it.
                    </p>

                    {clockedByUser === null ? (
                      <div className="alert alert-info mt-3">
                        <InformationCircleIcon className="w-5 h-5 shrink-0" />
                        <div className="text-sm">
                          <div className="font-semibold">The shift clock is not readable in this session.</div>
                          {timeEntriesError
                            ? <>The time-entry read failed: {timeEntriesError}. The line talk-time above is unaffected.</>
                            : <>
                                <code>time_entries</code> is readable only by the person who logged it and by a
                                super admin, so this session cannot see the floor's check-ins. That is missing
                                visibility, <b>not</b> zero hours — the hours are withheld rather than guessed.
                              </>}
                        </div>
                      </div>
                    ) : clockedByUser.size === 0 ? (
                      <div className="rounded-md border border-base-300 bg-base-200/50 dark:bg-gray-800/40 px-3 py-3 text-sm text-gray-500 dark:text-gray-400 mt-3">
                        <b className="text-gray-700 dark:text-gray-200">No check-in was logged by anyone in this range.</b>{" "}
                        The clock read cleanly and came back empty — nobody submitted hours for these days.
                      </div>
                    ) : (
                      <div className={`${TABLE_WRAP} mt-3`}>
                        <table className={TABLE}>
                          <thead className={THEAD}>
                            <tr>
                              <th className={TH}>Setter</th>
                              <th className={TH_NUM} title="Days in this range with a submitted check-in">Days logged</th>
                              <th className={TH_NUM} title="Clock-out minus clock-in, less breaks, summed over the days logged">Clocked hours</th>
                              <th className={TH_NUM} title="Clocked hours divided by days logged">Avg / day</th>
                              <th className={TH}>On a dialing line?</th>
                            </tr>
                          </thead>
                          <tbody className={TBODY}>
                            {[...clockedByUser.entries()]
                              .sort((a, b) => b[1].clockedMinutes - a[1].clockedMinutes)
                              .map(([userId, occ]) => (
                                <tr key={userId} className={TR}>
                                  <td className={`${TD} font-medium text-gray-900 dark:text-white`}>
                                    {clockedNames[userId] ?? (
                                      <span title="staff_directory could not name this user id — shown as an id fragment rather than an invented name">
                                        Staff · {userId.slice(0, 8)}
                                      </span>
                                    )}
                                    {!occ.allFromClock && (
                                      <div className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5" title="At least one of these days was entered as typed hours rather than a clock-in/clock-out span">
                                        includes claimed hours
                                      </div>
                                    )}
                                  </td>
                                  <td className={TD_NUM}>{occ.daysLogged.toLocaleString()}</td>
                                  <td className={`${TD_NUM} font-semibold text-gray-900 dark:text-white`}>{(occ.clockedMinutes / 60).toFixed(1)}h</td>
                                  <td className={TD_NUM}>{(occ.clockedMinutes / 60 / occ.daysLogged).toFixed(1)}h</td>
                                  <td className={TD}>
                                    {dialingSetterIds.has(userId) ? (
                                      <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
                                        yes — counted in floor occupancy
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs bg-gray-500/10 text-gray-500 dark:text-gray-400 border-gray-500/30" title="This person is not mapped to any number that dialed in this range, so their hours are left out of the floor occupancy denominator">
                                        not mapped to a dialing line
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* ── Floor occupancy — the only level the ratio is honest at ── */}
                    {floorOccupancy !== null && floorOccupancy.people > 0 && (
                      <div className="rounded-md border border-base-300 bg-base-200/50 dark:bg-gray-800/40 px-3 py-3 mt-3">
                        <div className="text-xs uppercase tracking-wide text-gray-400">Floor occupancy</div>
                        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 mt-1.5">
                          {(() => {
                            const talkMin = talkFloor.talkSeconds / 60;
                            const lineMin = (talkFloor.talkSeconds + talkFloor.machineSeconds) / 60;
                            const clocked = floorOccupancy.clockedMinutes;
                            return (
                              <>
                                <div>
                                  <div className="text-xl font-semibold text-gray-900 dark:text-white">
                                    <Metric value={clocked > 0 ? (talkMin / clocked) * 100 : null} digits={1} suffix="%" />
                                  </div>
                                  <div className="text-xs text-gray-400">of the clocked floor was talking to a person</div>
                                </div>
                                <div>
                                  <div className="text-xl font-semibold text-gray-900 dark:text-white">
                                    <Metric value={clocked > 0 ? (lineMin / clocked) * 100 : null} digits={1} suffix="%" />
                                  </div>
                                  <div className="text-xs text-gray-400">was connected to anything, machines included</div>
                                </div>
                                <div>
                                  <div className="text-xl font-semibold text-gray-900 dark:text-white tabular-nums">
                                    {(clocked / 60).toFixed(1)}h
                                  </div>
                                  <div className="text-xs text-gray-400">
                                    clocked across {floorOccupancy.people} setter{floorOccupancy.people === 1 ? "" : "s"} on a dialing line
                                  </div>
                                </div>
                              </>
                            );
                          })()}
                        </div>
                        <p className="text-xs text-gray-400 mt-2">
                          <b>Floor-wide only.</b> Every talk minute from every line over every clocked minute of the{" "}
                          {floorOccupancy.people} setter{floorOccupancy.people === 1 ? "" : "s"} mapped to a dialing
                          line. It cannot be split per person, because the numerator cannot be.
                          {floorOccupancy.excludedClockedUsers > 0 && (
                            <> {floorOccupancy.excludedClockedUsers} other clocked staff{" "}
                            {floorOccupancy.excludedClockedUsers === 1 ? "is" : "are"} excluded from the denominator —
                            they are not mapped to a number that dialed in this range.</>
                          )}
                        </p>
                        <p className="text-xs text-gray-400 mt-1">
                          Cold dialing is mostly dialing: a single-digit talking share is normal and is not by itself a
                          slacking signal. The pair worth reading is a <b>low talking share next to a high connected
                          share</b> — the shift went into answering machines.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          )}

          {/* ═══════════════ DISPOSITIONS ═══════════════ */}
          {tab === "dispositions" && (
            emptyRange ? <EmptyRange total={totalRowsEver} /> : (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {[
                  { title: "Dispositions (setter-selected)", rows: dispositionBreakdown, fill: "#007EA7", note: "What the setter marked after the call. Highlighted rows are the positive set." },
                  { title: "Outcomes (dialer-reported)", rows: outcomeBreakdown, fill: "#8B5CF6", note: "What WAVV's telephony layer observed. Independent of what the setter marked." },
                ].map((panel) => (
                  <div key={panel.title} className="card bg-base-100 border border-base-300 shadow-sm">
                    <div className="card-body p-4">
                      <h2 className="font-semibold text-gray-900 dark:text-white">{panel.title}</h2>
                      <p className="text-xs text-gray-400">{panel.note} Across {funnel.dials.toLocaleString()} outbound calls in range.</p>
                      {panel.rows.length === 0 ? (
                        <p className="text-sm text-gray-400 py-4">Nothing reported in this range.</p>
                      ) : (
                        <>
                          <div className={`${TABLE_WRAP} mt-2`}>
                            <table className={TABLE}>
                              <thead className={THEAD}>
                                <tr>
                                  <th className={TH}>Value</th>
                                  <th className={TH_NUM}>Calls</th>
                                  <th className={TH_NUM}>%</th>
                                  <th className={`${TH} w-1/3`}>Share</th>
                                </tr>
                              </thead>
                              <tbody className={TBODY}>
                                {panel.rows.map((d) => (
                                  <tr key={d.label} className={TR}>
                                    <td className={`${TD} whitespace-nowrap`}>
                                      {d.label === "(none)"
                                        ? <span className="text-gray-300 dark:text-gray-600 italic" title="No disposition was recorded on these calls">(none)</span>
                                        : d.label}
                                      {d.positive && (
                                        <span className="ml-2 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
                                          <CheckCircleIcon className="w-3 h-3" /> positive
                                        </span>
                                      )}
                                    </td>
                                    <td className={TD_NUM}>{d.count.toLocaleString()}</td>
                                    <td className={TD_NUM}>{d.pct.toFixed(1)}%</td>
                                    <td className={`${TD} min-w-[8rem]`}>
                                      <div className="h-2 w-full rounded bg-base-200 dark:bg-gray-700/40 overflow-hidden">
                                        <div className={`h-full ${d.positive ? "bg-emerald-500" : "bg-sky-600"}`} style={{ width: `${Math.min(100, d.pct)}%` }} />
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <ResponsiveContainer width="100%" height={Math.max(160, panel.rows.length * 30)}>
                            <BarChart data={panel.rows} layout="vertical" margin={{ top: 4, right: 40, left: 8, bottom: 4 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.2} horizontal={false} />
                              <XAxis type="number" tick={{ fontSize: 11, fill: "#9CA3AF" }} allowDecimals={false} />
                              <YAxis type="category" dataKey="label" width={130} tick={{ fontSize: 11, fill: "#9CA3AF" }} />
                              <Tooltip
                                contentStyle={TOOLTIP_STYLE}
                                formatter={(v, _n, item) => {
                                  const pct = (item as { payload?: { pct?: number } })?.payload?.pct ?? 0;
                                  return [`${(Number(v) || 0).toLocaleString()} (${pct.toFixed(1)}%)`, "Calls"];
                                }}
                              />
                              <Bar dataKey="count" fill={panel.fill} radius={[0, 4, 4, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {/* ═══════════════ DISPOSITION REVIEW ═══════════════ */}
          {/* The exception list for the Dispositions tab: calls that WERE real
              talks and came back with no honest outcome, each shown next to what
              the PIPELINE says happened to that merchant. This is the tab that
              makes "7-minute talk → deal created → application sent →
              dispositioned None" visible instead of scoring it a zero.

              The filter is deliberately narrow, so this stays a worklist and not
              a second call log: answered, reachedHuman() (nothing about the call
              says machine), at least REVIEW_MIN_SECONDS of connected time, and a
              disposition that is null / "None" / "Agent Canceled". */}
          {tab === "review" && (
            <div className="space-y-4">
              <div className="card bg-base-100 border border-base-300 shadow-sm">
                <div className="card-body p-4 space-y-2">
                  <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                    <ExclamationTriangleIcon className="w-5 h-5 text-amber-500" />
                    Real talks with no honest outcome
                  </h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400 max-w-3xl">
                    Every call below was <b>answered</b>, shows none of the machine tells, ran at least{" "}
                    <b>{REVIEW_MIN_SECONDS} seconds</b>, and was left un-dispositioned — WAVV's literal{" "}
                    <code>None</code>, <code>Agent Canceled</code>, or nothing at all. Those calls score{" "}
                    <b>zero</b> everywhere else on this page. Next to each one is what the{" "}
                    <b>pipeline</b> says about that merchant, so a talk that produced an application is
                    visible even though the dial record claims nothing happened.
                  </p>
                  <div className="rounded-md border border-base-300 bg-base-200/50 dark:bg-gray-800/40 px-3 py-2 text-xs text-gray-600 dark:text-gray-300">
                    <b>This is a coaching queue, not a metric.</b> A row here is a question — "what actually
                    happened on this call?" — and the answer is the recording, on the Call log tab. Nothing on
                    this tab is counted as a positive or a conversation anywhere else: an un-dispositioned
                    call stays un-dispositioned until a human says otherwise.
                  </div>
                </div>
              </div>

              {emptyRange ? (
                <EmptyRange total={totalRowsEver} />
              ) : reviewCalls.length === 0 ? (
                <div className="card bg-base-100 border border-base-300 shadow-sm">
                  <div className="card-body p-8 text-center">
                    <CheckCircleIcon className="w-10 h-10 mx-auto text-emerald-500/70" />
                    <p className="mt-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
                      Nothing to review in this range.
                    </p>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 max-w-lg mx-auto">
                      Every answered call over {REVIEW_MIN_SECONDS} seconds that reached a human carries a real
                      disposition. That is the good outcome — the floor is logging what it hears.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="card bg-base-100 border border-base-300 shadow-sm">
                  <div className="card-body p-4 space-y-3">
                    {reviewDealsError && (
                      <div className="alert alert-warning text-sm">
                        <ExclamationTriangleIcon className="w-5 h-5 shrink-0" />
                        <span>
                          <b>Pipeline column unreadable this load</b> ({reviewDealsError}) — it shows “—”,
                          which means <b>unknown</b>, never "this merchant has no deal".
                        </span>
                      </div>
                    )}
                    <div className={TABLE_WRAP}>
                      <table className={TABLE}>
                        <thead className={THEAD}>
                          <tr>
                            <th className={TH}>Time (ET)</th>
                            <th className={TH}>Setter</th>
                            <th className={TH}>Merchant</th>
                            <th className={TH_NUM}>Talk</th>
                            <th className={TH}>Dispositioned</th>
                            <th className={TH}>What the pipeline says</th>
                            <th className={TH} />
                          </tr>
                        </thead>
                        <tbody className={TBODY}>
                          {reviewCalls.map((r) => {
                            // UNREADABLE vs ABSENT, kept apart: null map = the
                            // read failed; a missing key = read fine, no deal.
                            const deal = reviewDeals === null
                              ? undefined
                              : (r.contact_id ? reviewDeals[r.contact_id] : undefined);
                            const unreadable = reviewDeals === null || (reviewDealsLoading && !reviewDeals);
                            const stage = deal?.status
                              ? (DEAL_STAGES.find((s) => s.key === deal.status)?.label ?? deal.status)
                              : null;
                            return (
                              <tr key={r.wavv_call_id} className={TR}>
                                <td className={`${TD} whitespace-nowrap`} title={localTimeTitle(r.started_at)}>
                                  {etStamp(r.started_at)}
                                </td>
                                <td className={TD}>
                                  <div className="flex items-center gap-2">
                                    <span className="truncate">{attributionName(r)}</span>
                                    {!r.setter_id && (
                                      <span className="shrink-0 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400">
                                        unassigned
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className={TD}>
                                  <Text value={r.contact_name} />
                                  <div className="text-xs text-gray-400 tabular-nums">{prettyPhone(r.phone)}</div>
                                </td>
                                <td className={`${TD_NUM} font-semibold`} title={`${r.seconds ?? 0} connected seconds`}>
                                  {hms(r.seconds ?? 0)}
                                </td>
                                <td className={TD}>
                                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${RAG_CHIP.amber}`}>
                                    {r.disposition ?? "not set"}
                                  </span>
                                </td>
                                <td className={TD}>
                                  {unreadable ? (
                                    <Metric value={null} />
                                  ) : !r.contact_id ? (
                                    <span className="text-gray-300 dark:text-gray-600" title="WAVV did not tie this dial to a contact, so there is nothing to look the pipeline up by">
                                      —
                                    </span>
                                  ) : !deal ? (
                                    <span className="text-gray-500 dark:text-gray-400 text-xs">
                                      no deal for this contact
                                    </span>
                                  ) : (
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <span className="inline-flex items-center rounded-full border border-base-300 bg-base-200/60 dark:bg-gray-800/50 px-2 py-0.5 text-xs">
                                        {stage ?? "stage unknown"}
                                      </span>
                                      {deal.application_sent_at && (
                                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${RAG_CHIP.green}`}>
                                          app sent {etStamp(deal.application_sent_at)}
                                        </span>
                                      )}
                                      {productiveAppointmentAt(deal) && (
                                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${RAG_CHIP.green}`}>
                                          {deal.appointment_at ? "appt booked" : "appt promised"}
                                        </span>
                                      )}
                                      {deal.funded_at && (
                                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${RAG_CHIP.green}`}>
                                          funded
                                        </span>
                                      )}
                                      {deal.deal_number && (
                                        <span className="text-xs text-gray-400">{deal.deal_number}</span>
                                      )}
                                    </div>
                                  )}
                                </td>
                                <td className={`${TD} text-right whitespace-nowrap`}>
                                  {r.contact_id ? (
                                    <Link
                                      to={`/admin/playbooks?contact=${encodeURIComponent(r.contact_id)}`}
                                      className="text-mint-green hover:underline underline-offset-2 font-medium"
                                      title="Open this merchant in the Revenue Playbook"
                                    >
                                      Open →
                                    </Link>
                                  ) : (
                                    <span className="text-gray-300 dark:text-gray-600">—</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-xs text-gray-400">
                      {reviewCalls.length.toLocaleString()} call{reviewCalls.length === 1 ? "" : "s"} in this
                      range were real talks with no outcome recorded, newest first. A row with a{" "}
                      <b>green pipeline chip</b> is the case that matters most: the work demonstrably happened
                      and the dial record says it did not. Times are US Eastern; hover for your own clock.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ═══════════════ TRENDS ═══════════════ */}
          {tab === "trends" && (
            emptyRange ? <EmptyRange total={totalRowsEver} /> : (
              <div className="card bg-base-100 border border-base-300 shadow-sm">
                <div className="card-body p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold text-gray-900 dark:text-white">Daily activity</h2>
                    <span className="badge badge-sm bg-base-200 dark:bg-gray-700 border-0 text-gray-600 dark:text-gray-300">
                      {trend.length} {trend.length === 1 ? "day" : "days"} plotted
                    </span>
                    {trendAutoWidened && (
                      <span
                        className="badge badge-sm bg-mint-green/20 border border-mint-green/40 text-gray-700 dark:text-mint-green"
                        title={`A one-day range draws one point, so Trends opened on ${RANGE_LABELS[TRENDS_RANGE]}. Pick any range pill to override — your choice sticks.`}
                      >
                        auto-widened to {RANGE_LABELS[TRENDS_RANGE]}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400">
                    Dials, connects, human contacts and conversations from WAVV (outbound); appointments from Deals by
                    <code className="mx-1">appointment_at</code>. Days with no calls simply do not appear —
                    the axis is the days that had activity, not a zero-filled calendar. Humans exclude voicemails,
                    and a conversation is a call the setter dispositioned as a real talk.
                    {trendAutoWidened && " Trends opens on a multi-day window because one day is a single point; pick any range pill to override."}
                  </p>
                  {trend.length === 0 ? (
                    <p className="text-sm text-gray-400 py-6">No activity in this range.</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={320}>
                      <ComposedChart data={trend} margin={{ top: 12, right: 20, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.2} />
                        <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#9CA3AF" }} />
                        <YAxis yAxisId="left" tick={{ fontSize: 11, fill: "#9CA3AF" }} allowDecimals={false} />
                        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: "#9CA3AF" }} allowDecimals={false} />
                        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v, n) => [(Number(v) || 0).toLocaleString(), String(n)]} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Bar yAxisId="right" dataKey="appointments" name="Appointments" fill="#F59E0B" radius={[4, 4, 0, 0]} barSize={18} />
                        <Line yAxisId="left" type="monotone" dataKey="dials" name="Dials" stroke="#007EA7" strokeWidth={2} dot={false} />
                        <Line yAxisId="left" type="monotone" dataKey="connects" name="Connects" stroke="#8B5CF6" strokeWidth={2} dot={false} />
                        <Line yAxisId="left" type="monotone" dataKey="human" name="Humans" stroke="#00C49A" strokeWidth={2} dot={false} />
                        <Line yAxisId="right" type="monotone" dataKey="conversations" name="Conversations" stroke="#EC4899" strokeWidth={2} dot={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            )
          )}

          {/* ═══════════════ CALL LOG ═══════════════ */}
          {tab === "log" && (
            <div className="card bg-base-100 border border-base-300 shadow-sm">
              <div className="card-body p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                    <ChatBubbleLeftRightIcon className="w-5 h-5 text-mint-green" /> Call log
                    {logCount !== null && <span className="text-sm font-normal text-gray-400">({logCount.toLocaleString()})</span>}
                  </h2>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="search" placeholder="Search name or phone"
                      className="input input-xs input-bordered w-48"
                      value={logSearch}
                      onChange={(e) => setLogSearch(e.target.value)}
                      title="Matches the merchant's contact name or phone number across the whole range, not just this page"
                    />
                    <select className="select select-xs select-bordered" value={filterSetter} onChange={(e) => setFilterSetter(e.target.value)}>
                      <option value="all">All setters</option>
                      {setterFilterOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                    </select>
                    <select className="select select-xs select-bordered" value={filterNumber} onChange={(e) => setFilterNumber(e.target.value)}>
                      <option value="all">All numbers</option>
                      {numberOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                    </select>
                    <select className="select select-xs select-bordered" value={filterDisposition} onChange={(e) => setFilterDisposition(e.target.value)}>
                      <option value="all">All dispositions</option>
                      {dispositionOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                    <select className="select select-xs select-bordered" value={filterOutcome} onChange={(e) => setFilterOutcome(e.target.value)} title="What WAVV reported for the line itself">
                      <option value="all">All outcomes</option>
                      {outcomeOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                    <select
                      className="select select-xs select-bordered"
                      value={filterContact}
                      onChange={(e) => setFilterContact(e.target.value as "all" | "human" | "machine")}
                      title="Reached a human = answered, and nothing about the call says machine. Voicemail / no human is the exact complement, so it also holds lines that were never answered."
                    >
                      <option value="all">Any contact type</option>
                      <option value="human">Reached a human</option>
                      <option value="machine">Voicemail / no human</option>
                    </select>
                    <select
                      className="select select-xs select-bordered"
                      value={filterRecording}
                      onChange={(e) => setFilterRecording(e.target.value as "all" | "yes" | "no")}
                    >
                      <option value="all">Any recording</option>
                      <option value="yes">Has recording</option>
                      <option value="no">No recording</option>
                    </select>
                    <input
                      type="number" min={0} placeholder="Min secs"
                      className="input input-xs input-bordered w-24"
                      value={filterMinSeconds}
                      onChange={(e) => setFilterMinSeconds(e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn btn-xs btn-ghost"
                      disabled={logFilterCount === 0}
                      onClick={clearLogFilters}
                    >
                      Clear{logFilterCount > 0 ? ` (${logFilterCount})` : ""}
                    </button>
                  </div>
                </div>
                <p className="text-xs text-gray-400">
                  Outbound calls only — an inbound call's caller ID is the merchant, so it carries no setter attribution.
                  Every filter runs in the database across the <b>whole date range</b>, not just the page on screen, and
                  they all apply together.
                </p>

                {logLoading ? (
                  <div className="flex items-center gap-2 text-gray-400 text-sm py-4">
                    <span className="loading loading-spinner loading-sm" /> Loading calls…
                  </div>
                ) : logRows.length === 0 ? (
                  <p className="text-sm text-gray-400 py-4">
                    {neverSynced ? "Waiting for first sync — no outbound WAVV calls have been mirrored yet." : "No calls match these filters."}
                  </p>
                ) : (
                  <div className={`${TABLE_WRAP} mt-3`}>
                    <table className={TABLE}>
                      <thead className={THEAD}>
                        <tr>
                          <th className={TH}>Time</th>
                          <th className={TH}>Attributed to</th>
                          <th className={TH}>Contact</th>
                          <th className={TH_NUM}>Duration</th>
                          <th className={TH}>Outcome</th>
                          <th className={TH}>Disposition</th>
                          <th className={TH} title="Whether this call reached a live person, by the same voicemail-aware test the scorecard uses">Live person</th>
                          <th className={TH}>Note</th>
                          <th className={TH}>Recording</th>
                          <th className={TH}>Transcript</th>
                        </tr>
                      </thead>
                      <tbody className={TBODY}>
                        {logRows.map((r) => {
                          const m = media[r.wavv_call_id] ?? {};
                          // A transcript can only exist where a recording exists. Offering the
                          // control on an unrecorded row produces a guaranteed "no transcript",
                          // which reads as broken — so those rows show a dash instead.
                          const hasRecording = r.recorded === true;
                          const live = reachedHuman(r);
                          return (
                            <tr key={r.wavv_call_id} className={`${TR} align-top`}>
                              <td className={`${TD} whitespace-nowrap`}>
                                {r.started_at ? new Date(r.started_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : <Metric value={null} />}
                              </td>
                              <td className={`${TD} min-w-[11rem]`}>
                                {r.setter_name ? (
                                  <span className="font-medium text-gray-900 dark:text-white">{r.setter_name}</span>
                                ) : (
                                  <span className="text-gray-400 italic" title="This outbound number has no setter assigned — assign it in the Numbers tab">
                                    {r.caller_label ?? prettyPhone(r.caller_id)}
                                  </span>
                                )}
                                <div className="text-xs text-gray-400 mt-0.5">{prettyPhone(r.caller_id)}</div>
                              </td>
                              <td className={`${TD} min-w-[10rem]`}>
                                <Text value={r.contact_name} />
                                <div className="text-xs text-gray-400 mt-0.5">{prettyPhone(r.phone)}</div>
                              </td>
                              <td className={TD_NUM}>{r.seconds === null ? <Metric value={null} /> : hms(r.seconds)}</td>
                              <td className={`${TD} whitespace-nowrap`}><Text value={r.outcome} /></td>
                              <td className={`${TD} whitespace-nowrap`}>
                                {r.disposition && POSITIVE_DISPOSITIONS.includes(r.disposition)
                                  ? <span className="font-semibold text-emerald-600 dark:text-emerald-400">{r.disposition}</span>
                                  : <Text value={r.disposition} />}
                              </td>
                              <td className={`${TD} whitespace-nowrap`}>
                                <span
                                  className={`badge badge-sm ${live ? "badge-success" : "badge-ghost"}`}
                                  title={live ? "Answered, and no voicemail/no-answer tell on the call" : "Voicemail, no answer, or never answered"}
                                >
                                  {live ? "live" : "machine"}
                                </span>
                              </td>
                              <td className={`${TD} max-w-[14rem]`}>
                                {r.note
                                  ? <span className="text-xs whitespace-pre-wrap break-words">{r.note}</span>
                                  : <span className="text-gray-300 dark:text-gray-600" title="No note left on this call">—</span>}
                              </td>
                              <td className={`${TD} min-w-[13rem]`}>
                                {!hasRecording ? (
                                  <span className="text-gray-300 dark:text-gray-600 text-xs" title={r.recorded === null ? "WAVV did not report whether this call was recorded" : "This call was not recorded"}>
                                    no recording
                                  </span>
                                ) : m.url ? (
                                  <audio controls preload="none" src={m.url} className="w-52 h-8" />
                                ) : (
                                  <div className="space-y-1">
                                    <button className="btn btn-xs btn-ghost gap-1" onClick={() => fetchRecording(r.wavv_call_id)} disabled={m.loadingRec}>
                                      <PlayIcon className="w-3 h-3" />{m.loadingRec ? "Loading…" : "Play"}
                                    </button>
                                    {m.recError && <div className="text-xs text-red-500 max-w-[13rem]">{m.recError}</div>}
                                  </div>
                                )}
                              </td>
                              <td className={`${TD} min-w-[16rem]`}>
                                {!hasRecording ? (
                                  <span
                                    className="text-gray-300 dark:text-gray-600"
                                    title="This call was not recorded, so there is nothing to transcribe — WAVV only transcribes recorded calls"
                                  >
                                    —
                                  </span>
                                ) : (
                                  <>
                                    <button className="btn btn-xs btn-ghost gap-1" onClick={() => toggleTranscript(r.wavv_call_id)}>
                                      <DocumentTextIcon className="w-3 h-3" />{m.open ? "Hide" : "Transcript"}
                                    </button>
                                    {m.open && (
                                      <div className="mt-1.5 text-xs max-w-md">
                                        {m.loadingTx ? (
                                          <span className="text-gray-400">Loading…</span>
                                        ) : m.txError ? (
                                          <span className="text-amber-600 dark:text-amber-400">{m.txError}</span>
                                        ) : (
                                          <>
                                            {(m.summary ?? r.summary) && (
                                              <div className="mb-1.5 p-2 rounded bg-base-200">
                                                <span className="font-semibold">Summary: </span>{m.summary ?? r.summary}
                                              </div>
                                            )}
                                            {m.transcript
                                              ? <div className="whitespace-pre-wrap p-2 rounded bg-base-200 max-h-48 overflow-y-auto leading-relaxed">{m.transcript}</div>
                                              : <span className="text-gray-400">Recorded, but WAVV has not published a transcript for this call yet — they appear a few minutes after the call ends. Try again shortly.</span>}
                                          </>
                                        )}
                                      </div>
                                    )}
                                  </>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {logPages > 1 && (
                  <div className="flex items-center justify-between pt-2">
                    <span className="text-xs text-gray-400">Page {logPage + 1} of {logPages}</span>
                    <div className="join">
                      <button className="btn btn-xs join-item" disabled={logPage === 0} onClick={() => setLogPage((p) => Math.max(0, p - 1))}>Prev</button>
                      <button className="btn btn-xs join-item" disabled={logPage + 1 >= logPages} onClick={() => setLogPage((p) => p + 1)}>Next</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ═══════════════ NUMBERS (admin only) ═══════════════ */}
          {tab === "numbers" && canManageNumbers && (
            <div className="card bg-base-100 border border-base-300 shadow-sm">
              <div className="card-body p-4">
                <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                  <HashtagIcon className="w-5 h-5 text-mint-green" /> Outbound numbers → setters
                </h2>
                <div className="alert alert-info mt-2">
                  <InformationCircleIcon className="w-5 h-5 shrink-0" />
                  <div className="text-sm space-y-1">
                    <div>
                      <b>This is the only place per-setter attribution comes from.</b> WAVV's API exposes no
                      per-agent field on a call, so a dial is credited to whoever is assigned to the number it
                      was placed FROM. Assign a number here and every tab on this page re-attributes at once.
                    </div>
                    <div>
                      <b>Shared-number caveat:</b> if two setters dial from the same number, <u>all</u> of that
                      number's dials credit to the single assigned setter. To split credit, give each setter
                      their own outbound number in WAVV.
                    </div>
                    <div className="opacity-80">
                      Numbers seen on the wire but never added are listed too — assigning one adds it. Call
                      counts here are <b>all-time</b>, not limited to the date range above. The picker lists
                      active closers.
                    </div>
                  </div>
                </div>

                {numbersError && (
                  <div className="alert alert-error mt-3">
                    <ExclamationTriangleIcon className="w-5 h-5" />
                    <span>{numbersError}</span>
                  </div>
                )}

                {numberRows === null ? (
                  <p className="text-sm text-gray-400 py-4">
                    {numbersError ? "Outbound numbers could not be read — this is unknown, not an empty list." : "Loading numbers…"}
                  </p>
                ) : numberRows.length === 0 ? (
                  <p className="text-sm text-gray-400 py-4">No outbound numbers have been seen in wavv_calls yet.</p>
                ) : (
                  <div className={`${TABLE_WRAP} mt-3`}>
                    <table className={TABLE}>
                      <thead className={THEAD}>
                        <tr>
                          <th className={TH}>Number</th>
                          <th className={TH_NUM}>Calls (all time)</th>
                          <th className={TH}>Last used</th>
                          <th className={TH}>Label</th>
                          <th className={TH}>Assigned setter</th>
                          <th className={TH}>State</th>
                          <th className={TH} />
                        </tr>
                      </thead>
                      <tbody className={TBODY}>
                        {numberRows.map((n) => {
                          const draft = numberDrafts[n.caller_id] ?? { setter_id: n.setter_id ?? "", label: n.label ?? "" };
                          const dirty = draft.setter_id !== (n.setter_id ?? "") || draft.label !== (n.label ?? "");
                          return (
                            <tr key={n.caller_id} className={`${TR} align-top`}>
                              <td className={`${TD} font-medium text-gray-900 dark:text-white whitespace-nowrap`}>
                                {prettyPhone(n.caller_id)}
                                <div className="text-xs text-gray-400 mt-0.5">{n.caller_id}</div>
                              </td>
                              <td className={TD_NUM}>{n.call_count.toLocaleString()}</td>
                              <td className={`${TD} whitespace-nowrap`}>
                                {n.last_seen ? new Date(n.last_seen).toLocaleDateString() : <Metric value={null} />}
                              </td>
                              <td className={TD}>
                                <input
                                  type="text"
                                  className="input input-xs input-bordered w-44"
                                  placeholder="e.g. WAVV outbound line 1"
                                  value={draft.label}
                                  onChange={(e) => setNumberDrafts((d) => ({ ...d, [n.caller_id]: { ...draft, label: e.target.value } }))}
                                />
                              </td>
                              <td className={TD}>
                                <select
                                  className="select select-xs select-bordered w-52"
                                  value={draft.setter_id}
                                  onChange={(e) => setNumberDrafts((d) => ({ ...d, [n.caller_id]: { ...draft, setter_id: e.target.value } }))}
                                >
                                  <option value="">— Unassigned —</option>
                                  {setterOptions.map((s) => (
                                    <option key={s.id} value={s.id}>{s.name}</option>
                                  ))}
                                  {/* A setter assigned earlier who has since left the active roster must
                                      still render, or the picker would silently show "Unassigned". */}
                                  {n.setter_id && !setterOptions.some((s) => s.id === n.setter_id) && (
                                    <option value={n.setter_id}>{n.setter_name ?? "Assigned (inactive closer)"}</option>
                                  )}
                                </select>
                              </td>
                              <td className={`${TD} whitespace-nowrap`}>
                                {n.is_assigned ? (
                                  <span className="badge badge-sm badge-success">assigned</span>
                                ) : n.in_mapping_table ? (
                                  <span className="badge badge-sm badge-warning">unassigned</span>
                                ) : (
                                  <span className="badge badge-sm badge-ghost" title="Seen on the wire but never added to the mapping table — saving adds it">new</span>
                                )}
                              </td>
                              <td className={`${TD} whitespace-nowrap`}>
                                <button
                                  className="btn btn-xs btn-primary"
                                  disabled={!dirty || savingNumber === n.caller_id}
                                  onClick={() => saveNumber(n)}
                                >
                                  {savingNumber === n.caller_id ? "Saving…" : "Save"}
                                </button>
                                {numberSaved === n.caller_id && !dirty && (
                                  <span className="ml-2 text-xs text-emerald-600 dark:text-emerald-400">Saved</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Small shared pieces ──────────────────────────────────────────────────────
type SortKey =
  | "name" | "dials" | "dialsPerDay" | "connects" | "human" | "conversations"
  | "positives" | "talk" | "appointments" | "appsSent" | "funded";

/** `groupStart` marks the first PIPELINE column, which carries the vertical rule
 *  separating it from the dialing group. */
const SETTER_COLUMNS: { key: SortKey | null; label: string; align: string; help?: string; groupStart?: boolean }[] = [
  { key: "name",          label: "Setter / number", align: "text-left" },
  { key: "dials",         label: "Dials",     align: "text-right", help: "Outbound calls placed from this setter's number(s)" },
  { key: "dialsPerDay",   label: "Dials/day", align: "text-right", help: "Dials ÷ days in this range on which this setter actually dialed" },
  { key: "connects",      label: "Connects",  align: "text-right", help: "Calls with an answer timestamp — includes answering machines" },
  { key: null,            label: "Answer %",  align: "text-right", help: "Connects ÷ dials" },
  { key: "human",         label: "Humans",    align: "text-right", help: "Answered and not a voicemail/no-answer. WAVV's human flag is NOT used — it marks voicemails as human." },
  { key: null,            label: "Human %",   align: "text-right", help: "Humans ÷ connects" },
  { key: "conversations", label: "Convos",    align: "text-right", help: CONVERSATION_HELP },
  { key: "positives",     label: "Positive",  align: "text-right", help: "Interested · Appointment Set · Full Application · Callback" },
  { key: "appointments",  label: "Appts",     align: "text-right", help: "Deals with an appointment booked in this range", groupStart: true },
  { key: "appsSent",      label: "Apps sent", align: "text-right", help: "Deals whose application was sent in this range" },
  { key: "funded",        label: "Funded",    align: "text-right", help: "Deals funded in this range" },
];

/** Sum a column of possibly-null values. If ANY value is unknown the total is
 *  unknown — a partial sum presented as a total is a lie. */
function sumOrDash(values: (number | null)[]) {
  const known = values.filter((v): v is number => v !== null);
  if (known.length === 0) return <Metric value={null} />;
  return <span>{known.reduce((a, b) => a + b, 0).toLocaleString()}</span>;
}

// ── FunnelCard ───────────────────────────────────────────────────────────────
// The whole funnel body — stage bars, counts, % of dials, step-conversion RAG
// chips — over WHATEVER set of calls it is handed. The Combined view passes
// every loaded row; the By-setter / By-number views pass one group's rows. One
// renderer means a grouped card and the team card can never disagree.
//
// `compact` is the grid variant: same numbers, same RAG rule, tighter layout so
// several funnels sit side by side for comparison.
function FunnelCard({
  calls, title, subtitle, badge, targetFor, compact = false, icon = false, headerRight, onPositivesClick, appsForScope, children,
}: {
  calls: SetterCall[];
  title: string;
  subtitle?: string;
  badge?: string;
  targetFor: TargetLookup;
  compact?: boolean;
  icon?: boolean;
  headerRight?: ReactNode;
  /** When set, the bottom "Positive dispositions" count becomes a jump link to
   *  the list of those exact calls. */
  onPositivesClick?: () => void;
  /** Deal-derived Applications rung for THIS card's scope+range. See AppsRung:
   *  object → draw it, null → draw it unreadable, undefined → omit the rung. */
  appsForScope?: AppsRung | null;
  children?: ReactNode;
}) {
  const funnel = useMemo(() => computeFunnel(calls), [calls]);
  const stages = useMemo(() => funnelStagesOf(funnel, appsForScope), [funnel, appsForScope]);

  // Honest empty: a group with no dials has nothing to draw, so it draws
  // nothing rather than a card of zeros and dashes.
  if (funnel.dials === 0) return null;

  return (
    <div className="card bg-base-100 border border-base-300 shadow-sm">
      <div className={`card-body ${compact ? "p-3.5 space-y-3" : "p-4 space-y-4"}`}>
        <div className={`flex flex-wrap justify-between gap-x-3 ${subtitle ? "items-start gap-y-1" : "items-center gap-y-3"}`}>
          <div className="min-w-0">
            <h2 className={`font-semibold text-gray-900 dark:text-white flex items-center gap-2 ${compact ? "text-sm" : ""}`}>
              {icon && <FunnelIcon className="w-5 h-5 text-mint-green shrink-0" />}
              <span className="truncate" title={title}>{title}</span>
              {badge && (
                <span className="shrink-0 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400">
                  {badge}
                </span>
              )}
            </h2>
            {subtitle && (
              <div className="text-xs text-gray-400 truncate" title={subtitle}>{subtitle}</div>
            )}
          </div>
          {headerRight ?? (compact && (
            <div className="text-right shrink-0">
              <div className="text-base font-semibold text-gray-900 dark:text-white tabular-nums leading-tight">
                {funnel.dials.toLocaleString()}
              </div>
              <div className="text-[10px] uppercase tracking-wide text-gray-400">dials</div>
            </div>
          ))}
        </div>

        <StageBars
          stages={stages}
          targetFor={targetFor}
          compact={compact}
          ofLabel="of dials"
          jumpKey="positives"
          onJump={onPositivesClick}
        />

        {children}
      </div>
    </div>
  );
}

// ── StageBars ────────────────────────────────────────────────────────────────
// The bar/count/step-chip stack, shared by the WAVV dial funnel (FunnelCard) and
// the Synergy pipeline funnel (SourceFunnelPanel). Stage 0 is the denominator
// for every bar's width and for the "% of <ofLabel>" line, so the two funnels
// draw identically even though they count entirely different things.
function StageBars({
  stages, targetFor, compact = false, ofLabel, jumpKey, onJump,
}: {
  stages: FunnelStage[];
  targetFor: TargetLookup;
  compact?: boolean;
  /** Names the denominator: "of dials" on the dial funnel, "of leads" on the
   *  pipeline one. Never guessed from the data. */
  ofLabel: string;
  /** Stage whose count becomes a drill-down link, when onJump is supplied. */
  jumpKey?: string;
  onJump?: () => void;
}) {
  const total = stages[0]?.count ?? 0;
  return (
        <div className={compact ? "space-y-2.5" : "space-y-3"}>
          {stages.map((s, i) => {
            const { target, isDefault } = s.targetKey ? targetFor(s.targetKey) : { target: null, isDefault: false };
            const widthPct = total > 0 ? Math.max((s.count / total) * 100, s.count > 0 ? 1.5 : 0) : 0;
            const sharePct = total > 0 ? (s.count / total) * 100 : null;
            const ofDials = sharePct === null ? "—" : `${sharePct.toFixed(1)}% ${ofLabel}`;
            // The industry chip goes next to whichever percentage it is
            // actually comparable to — see FunnelStage.benchmark.
            const bm = s.benchmark ? INDUSTRY_BENCHMARKS[s.benchmark.id] : null;
            const bmValue = s.benchmark ? (s.benchmark.basis === "step" ? s.stepPct : sharePct) : null;
            const bmRag = bm ? benchmarkRag(bmValue, bm) : "none";
            const bmChip = s.benchmark ? (
              <BenchmarkChip id={s.benchmark.id} value={bmValue} compact={compact} />
            ) : null;

            // ── PRECEDENCE: a rung that SHOWS an industry band is COLOURED by
            // that band, judged on the band's OWN denominator.
            //
            // This rung used to be coloured by ragOf(stepPct, target) no matter
            // what the chip beside it was comparing. On "Reached a human" that
            // meant the line read "13.0% of dials", the chip read "industry
            // 3–5% of dials", and the pill went amber — because it was quietly
            // grading 15.5% of ANSWERS against a built-in 30/15 default. Three
            // numbers, one colour, and the colour belonged to none of the two
            // things on screen. Now the metric shown, the band, and the colour
            // are one comparison. Rungs with NO band keep the KPI-target
            // behaviour untouched.
            //
            // Amber, never red: an industry rule of thumb has not earned red —
            // see the palette note in industryBenchmarks.ts.
            const judgedByBenchmark = bmRag !== "none";
            const rag: Rag = judgedByBenchmark
              ? (bmRag === "green" ? "green" : "amber")
              : ragOf(s.stepPct, target);
            /** True when the band's denominator is the "% of <ofLabel>" line, so
             *  THAT is the number wearing the colour and the step rate demotes to
             *  a plain, uncoloured secondary stat. */
            const judgedShare = judgedByBenchmark && s.benchmark?.basis === "ofTotal";
            const judgedTitle = bm
              ? `Judged against the industry band — ${bm.band}: ${benchmarkVerdict(bmRag, bm)}`
              : undefined;

            const stepPctText = s.stepPct !== null && Number.isFinite(s.stepPct)
              ? `${s.stepPct.toFixed(compact ? 0 : 1)}%`
              : null;

            // The step rate: a plain secondary stat when the band judges the
            // share instead, otherwise the rung's coloured pill.
            const stepNode = judgedShare ? (
              <span
                className={`inline-flex items-center gap-1 ${compact ? "text-[10px]" : "text-xs"} text-gray-500 dark:text-gray-400`}
                title="Secondary stat — a different denominator from the industry band on this rung, so it does not colour it"
              >
                {stepPctText === null
                  ? <Metric value={null} />
                  : <span className="font-semibold tabular-nums">{stepPctText}</span>}
                <span className="opacity-70">{compact ? s.stepShort : s.stepLabel}</span>
              </span>
            ) : (
              <span
                className={`inline-flex items-center gap-1 rounded-full border ${compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs"} ${RAG_CHIP[rag]}`}
                title={judgedTitle}
              >
                {judgedByBenchmark
                  ? (stepPctText === null
                      ? <Metric value={null} />
                      : <span className={`font-semibold tabular-nums ${RAG_TEXT[rag]}`}>{stepPctText}</span>)
                  : <RagPct value={s.stepPct} target={target} digits={compact ? 0 : 1} />}
                <span className="opacity-70">{compact ? s.stepShort : s.stepLabel}</span>
                {isDefault && !judgedByBenchmark && (
                  <span title="Judged against a built-in default — no threshold stored in ph_dialer_kpi_targets">·</span>
                )}
              </span>
            );

            // The "% of dials" line: a coloured pill when the band judges it,
            // otherwise the plain grey line it has always been.
            const shareNode = judgedShare ? (
              <span
                className={`inline-flex items-center gap-1 shrink-0 rounded-full border ${compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs"} ${RAG_CHIP[rag]}`}
                title={judgedTitle}
              >
                <span className="font-semibold tabular-nums">{sharePct === null ? "—" : `${sharePct.toFixed(1)}%`}</span>
                <span className="opacity-70">{ofLabel}</span>
              </span>
            ) : (
              <span className={compact ? "truncate" : undefined}>{ofDials}</span>
            );
            const bar = (
              <div className={`${compact ? "h-4" : "h-7"} w-full rounded bg-base-200 dark:bg-gray-700/40 overflow-hidden`}>
                <div
                  className={`h-full ${i === 0 ? "bg-sky-500" : RAG_BAR[rag]} transition-all`}
                  style={{ width: `${widthPct}%` }}
                />
              </div>
            );

            // Where the caller supplied a drill-down for this stage, its count
            // renders as a link instead of plain text.
            const jumpable = !!jumpKey && s.key === jumpKey && !!onJump && s.count > 0;
            const countBase = `${compact ? "text-sm shrink-0" : "text-base"} font-semibold tabular-nums`;
            // UNREADABLE draws "—", never "0" — an unloaded source must not read
            // as an empty result (see readers-must-distinguish-unreadable).
            const countText = s.unreadable ? "—" : s.count.toLocaleString();
            const countNode = jumpable ? (
              <button
                type="button"
                onClick={onJump}
                title="Jump to every positive-disposition call in this range"
                className={`${countBase} text-mint-green hover:underline underline-offset-2`}
              >
                {countText} <span aria-hidden="true">↓</span>
              </button>
            ) : (
              <span className={`${countBase} text-gray-900 dark:text-white`}>{countText}</span>
            );

            if (compact) {
              return (
                <div key={s.key} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate" title={s.help}>
                      {s.short}
                    </span>
                    {countNode}
                  </div>
                  {bar}
                  <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                    {/* min-w-0 + an inner truncate: the chip must never be the
                        thing the ellipsis eats. */}
                    <span className="inline-flex items-center gap-1 min-w-0 text-[10px] text-gray-400">
                      {shareNode}
                      {s.benchmark?.basis === "ofTotal" && bmChip}
                    </span>
                    {i === 0 ? (
                      <span className="text-[10px] text-gray-400 shrink-0">start</span>
                    ) : (
                      <span className="shrink-0 inline-flex items-center gap-1">
                        {stepNode}
                        {s.benchmark?.basis === "step" && bmChip}
                      </span>
                    )}
                  </div>
                  {s.secondaryLine && (
                    <div className="text-[10px] text-gray-400">{s.secondaryLine}</div>
                  )}
                </div>
              );
            }

            return (
              <div key={s.key} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                <div className="w-full sm:w-52 shrink-0">
                  <div className="text-sm font-medium text-gray-900 dark:text-white" title={s.help}>{s.label}</div>
                  <div className="text-xs text-gray-400 flex flex-wrap items-center gap-1.5">
                    {shareNode}
                    {s.benchmark?.basis === "ofTotal" && bmChip}
                  </div>
                  {s.secondaryLine && (
                    <div className="text-[11px] text-gray-400 mt-0.5">{s.secondaryLine}</div>
                  )}
                </div>
                <div className="flex-1 min-w-0">{bar}</div>
                <div className="w-full sm:w-56 shrink-0 flex flex-wrap items-center justify-between sm:justify-end gap-x-3 gap-y-1">
                  {countNode}
                  {i === 0 ? (
                    <span className="text-xs text-gray-400">start</span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5">
                      {stepNode}
                      {s.benchmark?.basis === "step" && bmChip}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
  );
}

function RagLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
      <span className="font-semibold text-gray-600 dark:text-gray-300">What the colors mean:</span>
      <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> <b className="text-emerald-600 dark:text-emerald-400">Green</b> = at or above target</span>
      <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500" /> <b className="text-amber-600 dark:text-amber-400">Yellow</b> = below target — needs attention</span>
      <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-500" /> <b className="text-red-600 dark:text-red-400">Red</b> = well off target</span>
      <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-gray-400" /> <b>Grey</b> = no target set / no data</span>
    </div>
  );
}

// ── ActivityHeatmap ──────────────────────────────────────────────────────────
// "On the phone 9–11, quiet 11–1", drawn rather than argued. The WHOLE FLOOR
// first, then one block per LINE — never per person, because the lines are
// shared (see the block above TalkRow). Rows = local calendar day, columns =
// local hour, shaded by dials or by talk minutes.
//
// A CSS grid, not Recharts: this is a categorical day × hour matrix, and every
// Recharts shape that could draw it (scatter with sized points, stacked bars)
// would have to fake the cell geometry. The page's chart styling is matched by
// hand instead — same borders, same muted axis grey, same tabular numerals.
//
// SHADED AGAINST ONE SCALE. The busiest cell anywhere on the grid sets the
// darkest green for EVERY block, so two lines are directly comparable; per-block
// normalisation would paint a quiet line as busy as a loud one. The floor block
// is excluded from setting that scale — it is the sum of the others and would
// wash every line out. An hour with no activity gets no fill at all, so a gap in
// the day reads as a hole.
function ActivityHeatmap({
  rows, grids, days, hours, metric, onMetric, floor,
}: {
  rows: TalkRow[];
  grids: Map<string, TalkGridDay[]>;
  days: string[];
  hours: number[];
  metric: TalkMetric;
  onMetric: (m: TalkMetric) => void;
  floor: { dials: number; talkSeconds: number };
}) {
  // Per-day rows get unreadable past a week or so, so a long range opens
  // collapsed into one aggregate day — overridable, never silently imposed.
  const [scopeOverride, setScopeOverride] = useState<"day" | "combined" | null>(null);
  const scope = scopeOverride ?? (days.length > 7 ? "combined" : "day");

  const valueOf = useCallback(
    (g: TalkGridDay, h: number) => (metric === "dials" ? g.dials[h] : g.talkSeconds[h] / 60),
    [metric],
  );

  /** Each drawable block, plus the single darkest per-LINE value on the grid. */
  const { blocks, max } = useMemo(() => {
    let peak = 0;
    const build = (key: string) => {
      const dayGrids = grids.get(key) ?? [];
      if (scope === "combined") {
        const totals = new Array<number>(24).fill(0);
        for (const g of dayGrids) for (let h = 0; h < 24; h++) totals[h] += valueOf(g, h);
        return [{
          label: `${dayGrids.length} day${dayGrids.length === 1 ? "" : "s"}`,
          title: dayGrids.length > 0 ? `${dayGrids[0].day} → ${dayGrids[dayGrids.length - 1].day}` : "No dialing days",
          values: totals,
        }];
      }
      // Every day in the RANGE gets a row, including days this line did not
      // dial — an absent row would hide a dead day entirely.
      const byDay = new Map(dayGrids.map((g) => [g.day, g]));
      return days.map((day) => {
        const g = byDay.get(day);
        const values = new Array<number>(24).fill(0);
        if (g) for (let h = 0; h < 24; h++) values[h] = valueOf(g, h);
        const d = parseYmdLocal(day);
        return {
          label: d.toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" }),
          title: g ? day : `${day} — no dials`,
          values,
        };
      });
    };

    const lineBlocks = rows.map((r) => {
      const cells = build(r.key);
      // Only the LINE blocks set the shading scale — the floor block is their
      // sum and would flatten every line to near-white against it.
      for (const c of cells) for (const h of hours) if (c.values[h] > peak) peak = c.values[h];
      return {
        key: r.key,
        title: `Line ${r.lineNo} · ${r.callerId ? prettyPhone(r.callerId) : "no caller ID"}`,
        subtitle: r.mappedName ? `mapped: ${r.mappedName} · shared line` : "no setter mapped",
        isFloor: false,
        dials: r.dials,
        talkSeconds: r.talkSeconds,
        cells,
      };
    });

    // The floor first: the question "is the room on the phone right now" is the
    // one this grid can answer without any attribution at all.
    const blocks = [
      {
        key: FLOOR_KEY,
        title: "Whole floor",
        subtitle: "every line combined — no attribution needed to read this",
        isFloor: true,
        dials: floor.dials,
        talkSeconds: floor.talkSeconds,
        cells: build(FLOOR_KEY),
      },
      ...lineBlocks,
    ];
    return { blocks, max: peak };
  }, [rows, grids, days, hours, scope, valueOf, floor]);

  const unit = metric === "dials" ? "dials" : "talk min";
  const fmt = (v: number) => (metric === "dials" ? v.toLocaleString() : v.toFixed(1));
  const gridCols = { gridTemplateColumns: `5.5rem repeat(${hours.length}, minmax(0, 1fr))` };

  return (
    <div className="card bg-base-100 border border-base-300 shadow-sm">
      <div className="card-body p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <ClockIcon className="w-5 h-5 text-mint-green" /> When the floor is on the phone
            </h2>
            <p className="text-xs text-gray-400 mt-1">
              Hour of day on <b>your local clock</b> — the same clock the date-range pills use. (Call timestamps
              elsewhere on this page are stamped Eastern, so the two are labelled rather than blended.)
            </p>
            <p className="text-xs text-gray-400 mt-1">
              The floor block needs no attribution to be true. Each <b>line</b> block below it is a shared number,
              so a quiet stretch there means <b>that line</b> went quiet — not that a named person stopped dialing.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div role="tablist" aria-label="Heatmap metric" className="inline-flex rounded-lg border border-base-300 bg-base-200/60 dark:bg-gray-800/50 p-0.5">
              {([["talk", "Talk minutes"], ["dials", "Dials"]] as const).map(([id, label]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={metric === id}
                  onClick={() => onMetric(id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    metric === id
                      ? "bg-base-100 dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm"
                      : "text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {days.length > 1 && (
              <div role="tablist" aria-label="Heatmap rows" className="inline-flex rounded-lg border border-base-300 bg-base-200/60 dark:bg-gray-800/50 p-0.5">
                {([["day", "By day"], ["combined", "All days"]] as const).map(([id, label]) => (
                  <button
                    key={id}
                    role="tab"
                    aria-selected={scope === id}
                    onClick={() => setScopeOverride(id)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      scope === id
                        ? "bg-base-100 dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm"
                        : "text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {hours.length === 0 || blocks.length === 0 ? (
          <div className="rounded-md border border-base-300 bg-base-200/50 dark:bg-gray-800/40 px-3 py-3 text-sm text-gray-500 dark:text-gray-400 mt-3">
            No dial carries a start time in this range, so there is no hour-of-day picture to draw.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto mt-3">
              <div className="min-w-[38rem] space-y-4">
                {blocks.map((block) => (
                  <div key={block.key} className={block.isFloor ? "pb-3 border-b border-base-300" : undefined}>
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 mb-1.5">
                      <span className="text-sm font-medium text-gray-900 dark:text-white">{block.title}</span>
                      <span className="text-[11px] text-gray-400">{block.subtitle}</span>
                      <span className="text-xs text-gray-400">
                        · {block.dials.toLocaleString()} dials · {(block.talkSeconds / 60).toFixed(1)} talk min
                      </span>
                    </div>

                    {/* Hour ruler */}
                    <div className="grid gap-px" style={gridCols}>
                      <div />
                      {hours.map((h) => (
                        <div key={h} className="text-[10px] text-gray-400 text-center tabular-nums pb-0.5">
                          {hourLabel(h)}
                        </div>
                      ))}
                    </div>

                    {block.cells.map((c) => (
                      <div key={c.label} className="grid gap-px items-center" style={gridCols}>
                        <div className="text-[11px] text-gray-500 dark:text-gray-400 pr-2 truncate" title={c.title}>
                          {c.label}
                        </div>
                        {hours.map((h) => {
                          const v = c.values[h];
                          return (
                            <div
                              key={h}
                              className="h-6 rounded-sm border border-base-300/60 bg-base-200/40 dark:bg-gray-800/40"
                              style={{ backgroundColor: heatFill(v, max) }}
                              title={`${c.title} · ${hourLabel(h)} — ${v > 0 ? `${fmt(v)} ${unit}` : `no ${unit}`}`}
                            />
                          );
                        })}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            {/* Scale */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400 mt-3">
              <span className="font-semibold text-gray-600 dark:text-gray-300">Shading:</span>
              <span>none</span>
              <span className="flex items-center gap-px">
                {[0.2, 0.4, 0.6, 0.8, 1].map((f) => (
                  <span key={f} className="w-5 h-3 rounded-sm border border-base-300/60" style={{ backgroundColor: heatFill(f * max, max) }} />
                ))}
              </span>
              <span className="tabular-nums">{fmt(max)} {unit} — the busiest hour on any single LINE</span>
              <span className="opacity-80">· one scale across every block, so the lines compare like for like. The whole-floor block is their sum, so its heavy hours saturate.</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function EmptyRange({ total }: { total: number | null }) {
  return (
    <div className="alert">
      <InformationCircleIcon className="w-5 h-5" />
      <span>
        No outbound calls in this range. {total === null ? "The all-time count is unreadable." : `${total.toLocaleString()} outbound call${total === 1 ? "" : "s"} are mirrored across all time.`}
      </span>
    </div>
  );
}

// ── SourceFunnelPanel ────────────────────────────────────────────────────────
// The whole Live Transfers / Real-Time tab: summary tiles, the team pipeline
// funnel, and the per-setter breakdown. One component serves both products —
// they differ only by lead_source and by KPI-target prefix, so a difference
// between the two tabs can only ever be a difference in the DATA.
function SourceFunnelPanel({
  def, cohort, loading, error, truncated, targetFor, rangeLabel, anyNameUnknown,
}: {
  def: SourceTabDef;
  /** null = the deals read FAILED. Not "no leads" — the difference is the whole
   *  point, and the two render completely differently. */
  cohort: { deals: SourceDeal[]; counts: PipeCounts; groups: PipeGroup[] } | null;
  loading: boolean;
  error: string | null;
  truncated: boolean;
  targetFor: TargetLookup;
  rangeLabel: string;
  anyNameUnknown: boolean;
}) {
  // Closer filter. Purely a view over the already-loaded cohort — no new query,
  // and it never changes what was READ, only what is shown.
  const [closerKey, setCloserKey] = useState<string>(ALL_CLOSERS);

  /** The cohort narrowed to the picked closer. A closer's own group already
   *  carries its deals and counts, so the filtered view is that one group —
   *  the team funnel and the tiles can never disagree with the row. */
  const view = useMemo(() => {
    if (!cohort) return null;
    if (closerKey === ALL_CLOSERS) return cohort;
    const g = cohort.groups.find((x) => x.key === closerKey);
    if (!g) return { deals: [], counts: computePipeline([]), groups: [] };
    return { deals: g.deals, counts: g.counts, groups: [g] };
  }, [cohort, closerKey]);

  const stages = useMemo(
    () => (view ? pipelineStagesOf(view.counts, def.targetPrefix) : []),
    [view, def.targetPrefix],
  );

  const filtered = closerKey !== ALL_CLOSERS;
  const filteredName = filtered ? (view?.groups[0]?.name ?? "this closer") : null;

  const header = (
    <div className="card bg-base-100 border border-base-300 shadow-sm">
      <div className="card-body p-4 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            {def.id === "live_transfers"
              ? <ArrowsRightLeftIcon className="w-5 h-5 text-mint-green" />
              : <BoltIcon className="w-5 h-5 text-mint-green" />}
            {def.label} — pipeline outcomes
          </h2>
          {cohort && cohort.groups.length > 0 && (
            <label className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <span className="font-semibold text-gray-600 dark:text-gray-300">Closer:</span>
              <select
                className="select select-xs select-bordered"
                value={closerKey}
                onChange={(e) => setCloserKey(e.target.value)}
                title="Narrows every number on this tab to one closer's deals. Applies on top of the date range."
              >
                <option value={ALL_CLOSERS}>All closers</option>
                {cohort.groups.map((g) => (
                  <option key={g.key} value={g.key}>
                    {g.name} ({g.counts.received.toLocaleString()})
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400">{def.blurb}</p>
        <div className="rounded-md border border-base-300 bg-base-200/50 dark:bg-gray-800/40 px-3 py-2 text-xs text-gray-500 dark:text-gray-400 space-y-1">
          <div>
            <b className="text-gray-700 dark:text-gray-200">These are pipeline outcomes from Deals, not WAVV dial counts.</b>{" "}
            Nothing on this tab is a dial, a connect or a disposition — every number is a deal position.
          </div>
          <div>
            <b className="text-gray-700 dark:text-gray-200">The range is when the lead was RECEIVED</b> (
            <code>deals.created_at</code>), so this is a cohort: <b>{rangeLabel}</b>'s leads followed to wherever they
            have got to <i>as of now</i>. A cohort that only just landed has not had time to convert — read a short
            range as early, not as bad.
          </div>
          <div>
            <b className="text-gray-700 dark:text-gray-200">How a stage is counted:</b> a lead counts at a stage if it
            carries that stage's timestamp <i>or</i> its current status is at-or-past that stage on the MCA ladder — so
            a funded deal counts at Contacted, Qualifying and Application Sent too. A lead parked in
            Nurture / Declined / Dead is read at the last active stage it held before it was parked. The deepest of
            those readings wins, which is why a later stage can never out-count an earlier one.
          </div>
          {filtered && (
            <div className="text-emerald-700 dark:text-emerald-400">
              <b>Filtered to {filteredName}.</b> Every tile, funnel step and row below counts only their {def.noun}s —
              clear the filter to read the whole floor.
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (error) {
    return (
      <div className="space-y-4">
        {header}
        <div className="alert alert-error">
          <ExclamationTriangleIcon className="w-5 h-5 shrink-0" />
          <div>
            <div className="font-semibold">Could not read {def.label.toLowerCase()} from Deals.</div>
            <div className="text-sm opacity-90">
              {error} — this is <b>unreadable</b>, not an empty cohort. Nothing below is being shown as zero.
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (loading || cohort === null || view === null) {
    return (
      <div className="space-y-4">
        {header}
        <div className="flex items-center gap-2 text-gray-400 text-sm">
          <span className="loading loading-spinner loading-sm" /> Loading {def.label.toLowerCase()}…
        </div>
      </div>
    );
  }

  const c = view.counts;

  if (c.received === 0) {
    return (
      <div className="space-y-4">
        {header}
        <div className="alert">
          <InformationCircleIcon className="w-5 h-5" />
          {filtered ? (
            // The cohort itself is not empty — the CLOSER FILTER emptied it. Said
            // plainly so nobody reads a filtered view as a dead range.
            <span>
              This range has <b>{cohort.counts.received.toLocaleString()}</b> {def.noun}s, but none of them belong to
              the closer you picked.{" "}
              <button type="button" className="link link-hover font-semibold" onClick={() => setCloserKey(ALL_CLOSERS)}>
                Show all closers
              </button>
            </span>
          ) : (
            <span>
              No {def.noun}s were received in this range. The range filters when the lead <b>landed</b>, so widen it
              to see {def.noun}s delivered earlier — work done today on an older {def.noun} shows up in that
              {def.noun}'s own cohort, not this one.
            </span>
          )}
        </div>
      </div>
    );
  }

  /** Average advance for THIS cohort — the industry band's own denominator
   *  (dollars funded ÷ deals funded), not dollars per lead. Null when nothing
   *  in the cohort funded, which is "nothing to average", never $0. */
  const cohortAvgAdvance = c.funded > 0 ? c.fundedAmount / c.funded : null;

  const tiles: { label: string; value: string; help: string; sub?: ReactNode }[] = [
    { label: "Received", value: c.received.toLocaleString(), help: `${def.noun}s delivered in this range` },
    { label: "Contacted", value: c.contacted.toLocaleString(), help: "Reached at-or-past the Contacted rung" },
    { label: "Appointments", value: c.appointments.toLocaleString(), help: "Leads in this cohort with a booked appointment (deals.appointment_at). A callback is not an appointment and is not counted." },
    { label: "Apps sent", value: c.appsSent.toLocaleString(), help: "Reached at-or-past Application Sent" },
    { label: "Funded", value: c.funded.toLocaleString(), help: "Funded deals from this cohort" },
    {
      label: "Funded $",
      value: c.fundedAmount > 0 ? usd(c.fundedAmount) : "$0",
      help: "Sum of amount_funded across this cohort's funded deals",
      sub: (
        <span className="flex flex-wrap items-center gap-1.5">
          <BenchmarkChip id="avg_advance" value={cohortAvgAdvance} compact />
          <span className="text-[11px] text-gray-500 dark:text-gray-400">
            {cohortAvgAdvance === null ? "no funded deal to average" : `avg ${usd(Math.round(cohortAvgAdvance))}`}
          </span>
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      {header}

      {truncated && (
        <div className="alert alert-warning">
          <ExclamationTriangleIcon className="w-5 h-5" />
          <span>
            This range exceeds {SOURCE_DEAL_CAP.toLocaleString()} Synergy leads — everything below covers only the{" "}
            {SOURCE_DEAL_CAP.toLocaleString()} most recent. Narrow the range for exact totals.
          </span>
        </div>
      )}

      {/* Summary tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        {tiles.map((t) => (
          <div key={t.label} className="card bg-base-100 border border-base-300 shadow-sm" title={t.help}>
            <div className="card-body p-4">
              <div className="text-xs uppercase tracking-wide text-gray-400 flex items-center gap-1">
                {t.label === "Funded $" && <BanknotesIcon className="w-3.5 h-3.5" />}
                {t.label}
              </div>
              <div className="text-xl font-semibold text-gray-900 dark:text-white tabular-nums">{t.value}</div>
              {t.sub}
            </div>
          </div>
        ))}
      </div>

      {/* Team funnel */}
      <div className="card bg-base-100 border border-base-300 shadow-sm">
        <div className="card-body p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <FunnelIcon className="w-5 h-5 text-mint-green" />{" "}
              {filtered ? `Pipeline funnel — ${filteredName}` : "Combined pipeline funnel (team)"}
            </h2>
            <RagLegend />
          </div>

          <StageBars stages={stages} targetFor={targetFor} ofLabel={`of ${def.noun}s`} />

          <p className="text-xs text-gray-400">
            Step rates are judged against{" "}
            <code>{def.targetPrefix}_contact_rate_pct</code>, <code>{def.targetPrefix}_qualify_rate_pct</code>,{" "}
            <code>{def.targetPrefix}_app_rate_pct</code> and <code>{def.targetPrefix}_fund_rate_pct</code> in{" "}
            <code>platform_settings.ph_dialer_kpi_targets</code>. None of them has a built-in default, so until the
            owner stores a threshold every rate renders <b>grey — no target</b>, never green.{" "}
            {def.id === "live_transfers"
              ? "Live transfers are held to their own thresholds: a warm transfer that converts like a cold call is the problem worth seeing."
              : "Real-time leads are held to their own thresholds — they arrive by email, so they should not be measured against a warm transfer."}
          </p>

          {/* The industry band on the last rung. These leads are VENDOR-WARM,
              so the 20–30% warm band applies here — not the 8–15% cold band
              the outbound floor is read against on the Funnel tab. */}
          <div className="flex flex-wrap items-center gap-2 border-t border-base-300 pt-2">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Application → funded:</span>
            <BenchmarkChip
              id="app_to_fund_warm"
              value={c.appsSent > 0 ? (c.funded / c.appsSent) * 100 : null}
            />
            <span className="text-[11px] text-gray-500 dark:text-gray-400">
              {c.appsSent === 0
                ? "No application sent in this cohort yet, so there is nothing to divide by — not a 0% conversion."
                : <>Warm band, because these {def.noun}s were <b>delivered</b> rather than cold-dialed. Cold-originated applications are held to the lower 8–15% band on the Funnel tab.</>}
            </span>
          </div>
          <BenchmarkLegend />
        </div>
      </div>

      {/* Per-setter breakdown */}
      <div className="card bg-base-100 border border-base-300 shadow-sm">
        <div className="card-body p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <UserGroupIcon className="w-5 h-5 text-mint-green" /> Per-setter breakdown
            </h2>
            <span className="text-xs text-gray-400">
              {filtered
                ? `1 of ${cohort.groups.length.toLocaleString()} bucket${cohort.groups.length === 1 ? "" : "s"} · filtered to ${filteredName}`
                : `${cohort.groups.length.toLocaleString()} bucket${cohort.groups.length === 1 ? "" : "s"} · sorted by ${def.noun}s received`}
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            Grouped on <code>deals.assigned_closer_id</code>. A {def.noun} nobody owns lands in{" "}
            <b>Unassigned</b> — a real bucket, never folded into whoever is busiest.
          </p>
          {anyNameUnknown && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
              Some setter names could not be read with your access (staff names live in <code>profiles</code>, which
              only super admins may read), so those rows are titled by id. The counts are unaffected.
            </p>
          )}

          <div className={`${TABLE_WRAP} mt-3`}>
            <table className={TABLE}>
              <thead className={THEAD}>
                <tr>
                  <th className={TH}>Setter</th>
                  <th className={TH_NUM} title={`${def.noun}s delivered to this setter in this range`}>Received</th>
                  <th className={TH_NUM}>Contacted</th>
                  <th className={TH_NUM} title="Contacted ÷ received">Contact %</th>
                  <th className={TH_NUM}>Qualifying</th>
                  <th className={TH_NUM} title="Qualifying ÷ contacted">Qual %</th>
                  <th className={TH_NUM}>App sent</th>
                  <th className={TH_NUM} title="App sent ÷ qualifying">App %</th>
                  <th className={`${TH_NUM} ${GROUP_EDGE}`} title="Deals in this cohort with a booked appointment">Appts</th>
                  <th className={TH_NUM}>Funded</th>
                  <th className={TH_NUM}>Funded $</th>
                </tr>
              </thead>
              <tbody className={TBODY}>
                {view.groups.map((g) => (
                  <PipeRow key={g.key} name={g.name} unassigned={g.unassigned} counts={g.counts} def={def} targetFor={targetFor} />
                ))}
              </tbody>
              {/* One row and a Team footer of the same numbers reads as two
                  findings, so the footer only appears unfiltered. */}
              {!filtered && (
                <tfoot>
                  <tr className="font-semibold bg-base-200/60 dark:bg-gray-800/50 border-t-2 border-base-300">
                    <PipeCells name="Team" counts={c} def={def} targetFor={targetFor} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </div>

      {/* The thing to act on */}
      <div className="card bg-base-100 border border-base-300 shadow-sm">
        <div className="card-body p-4">
          <h2 className="font-semibold text-gray-900 dark:text-white">What this cohort is telling you</h2>
          <ul className="mt-2 space-y-2 text-sm text-gray-600 dark:text-gray-300">
            <li>
              <span className="font-semibold text-gray-900 dark:text-white">Untouched:</span>{" "}
              <b className={c.untouched > 0 ? "text-amber-600 dark:text-amber-400" : "text-gray-900 dark:text-white"}>
                {c.untouched.toLocaleString()}
              </b>{" "}
              of {c.received.toLocaleString()} {def.noun}s have <b>no contact logged at all</b> — no contacted/spoke
              stamp and still sitting at New.{" "}
              {def.id === "live_transfers"
                ? "On a live transfer that is money already spent on a merchant who was handed to us on the phone."
                : "On a real-time lead that is a delivered lead nobody called."}
            </li>
            <li>
              <span className="font-semibold text-gray-900 dark:text-white">Received → application:</span>{" "}
              <b className="text-gray-900 dark:text-white">
                {c.received > 0 ? ((c.appsSent / c.received) * 100).toFixed(1) : "—"}%
              </b>{" "}
              of this cohort got an application out ({c.appsSent.toLocaleString()} of {c.received.toLocaleString()}).
            </li>
            <li>
              <span className="font-semibold text-gray-900 dark:text-white">Funded:</span>{" "}
              <b className="text-gray-900 dark:text-white">{c.funded.toLocaleString()}</b>
              {c.fundedAmount > 0 && <> for <b className="text-gray-900 dark:text-white">{usd(c.fundedAmount)}</b></>}.
              {c.funded === 0 && " Nothing from this cohort has funded yet — on a fresh range that is expected, since funding lags the lead by days."}
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

/** One body row of the per-setter table. */
function PipeRow({
  name, unassigned, counts, def, targetFor,
}: {
  name: string; unassigned: boolean; counts: PipeCounts; def: SourceTabDef; targetFor: TargetLookup;
}) {
  return (
    <tr className={TR}>
      <PipeCells name={name} unassigned={unassigned} counts={counts} def={def} targetFor={targetFor} />
    </tr>
  );
}

/** The cells, shared by every setter row and the Team footer so the two can
 *  never format or judge a number differently. */
function PipeCells({
  name, unassigned = false, counts, def, targetFor,
}: {
  name: string; unassigned?: boolean; counts: PipeCounts; def: SourceTabDef; targetFor: TargetLookup;
}) {
  const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : null);
  const t = (suffix: string) => targetFor(`${def.targetPrefix}_${suffix}`).target;
  return (
    <>
      <td className={`${TD} font-medium text-gray-900 dark:text-white min-w-[11rem]`}>
        <div className="flex items-center gap-2">
          <span className="truncate" title={name}>{name}</span>
          {unassigned && (
            <span
              className="shrink-0 badge badge-xs badge-ghost"
              title={`No closer is assigned to these ${def.noun}s — assign them on the deal`}
            >
              no owner
            </span>
          )}
        </div>
      </td>
      <td className={TD_NUM}>{counts.received.toLocaleString()}</td>
      <td className={TD_NUM}>{counts.contacted.toLocaleString()}</td>
      <td className={TD_NUM}><RagPct value={pct(counts.contacted, counts.received)} target={t("contact_rate_pct")} /></td>
      <td className={TD_NUM}>{counts.qualifying.toLocaleString()}</td>
      <td className={TD_NUM}><RagPct value={pct(counts.qualifying, counts.contacted)} target={t("qualify_rate_pct")} /></td>
      <td className={TD_NUM}>{counts.appsSent.toLocaleString()}</td>
      <td className={TD_NUM}><RagPct value={pct(counts.appsSent, counts.qualifying)} target={t("app_rate_pct")} /></td>
      <td className={`${TD_NUM} ${GROUP_EDGE}`}>{counts.appointments.toLocaleString()}</td>
      <td className={TD_NUM}>{counts.funded.toLocaleString()}</td>
      <td className={TD_NUM}>{counts.fundedAmount > 0 ? usd(counts.fundedAmount) : <span className="text-gray-300 dark:text-gray-600">$0</span>}</td>
    </>
  );
}
