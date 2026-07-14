import { useCallback, useEffect, useMemo, useState } from "react";
import { BoltIcon, ArrowPathIcon, ChevronDownIcon, PhoneIcon, MagnifyingGlassIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { getOpenDealsForQueue, logContactAttempt, type ContactOutcome, type QueueDeal } from "../../services/dealService";
import { useUserProfile } from "../../context/UserProfileContext";
import supabase from "../../supabase";
import { dateTimeET, etDateTimeLocalToUtcIso, statedTimeInET, timeET, tomorrowAtEtIso } from "../../utils/time";
import LeadGradeChip from "./LeadGradeChip";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

interface Urgency {
  rank: number;
  badge: string;
  why: string;
  /** ISO timestamp that drives the card's age + the intra-rank sort. */
  since: string;
  tone: string;
  /** When set, the card corner shows a LIVE speed-to-lead countdown to this ISO
   * timestamp ("⏱ 4:32 left"), flipping to "SLA MISSED — call anyway" past it. */
  countdownDue?: string;
  /** The merchant's OWN stated best time to reach them ("4:00PM CST").
   *
   * On a real-time lead this directly contradicts the 5-minute clock, and the
   * contradiction is real, not a bug: the vendor promises speed-to-lead, but the
   * merchant told us when they can actually talk. Cold-calling someone at 9am who
   * said "reach me at 4pm" burns the lead to satisfy a stopwatch.
   *
   * So the 5-minute window is for an EMAIL, and the phone call goes at THIS time.
   * The card has to show both or the closer can only obey one of them. */
  callWindow?: string;
  /** Force the lane instead of deriving it from rank. Needed where rank and lane
   *  genuinely disagree: a SNOOZED callback is low-urgency (so, a low rank) but it is
   *  emphatically not "new work" — nobody should make first contact with it, it's a
   *  promise already made. Deriving lane from rank alone can't express that. */
  lane?: Lane;
}

/**
 * The merchant's answer to "What is the best time to reach you?", straight from the
 * vendor's email (the intake parks the raw answers in deals.lead_qual). Free text and
 * inconsistent by nature — "4:00PM CST", "10am PST" — so it is displayed, never
 * parsed into a timestamp. A human reads it and dials accordingly.
 */
function bestTimeToCall(deal: QueueDeal): string | undefined {
  const q = (deal as unknown as { lead_qual?: Record<string, unknown> | null }).lead_qual;
  const raw = q && typeof q === "object" ? q["best_time"] : null;
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s || /^(n\/?a|none|any|anytime)$/i.test(s)) return undefined;
  return s;
}

/**
 * The two lanes of My Day. `followup` = a deal already in motion that needs
 * chasing (stips, replies, offers, silent funders). `new` = first-touch work
 * (real-time leads on the clock, warm/new leads never contacted).
 */
type Lane = "followup" | "new";

// mm:ss countdown from a millisecond delta.
function countdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const WARM = new Set(["warm", "warmer"]);
const HOT = new Set(["hot", "hottest"]);

// Stages where the stips are still OUTSTANDING — i.e. a "statements promised by"
// date still means something. Once a deal is submitted (or past it), the promise
// is moot and the signal switches itself off.
const STIPS_PENDING = new Set(["qualifying", "application_sent", "docs_collected", "bank_statements", "positions_analysis"]);

// Whole days between the merchant's promised date (a YYYY-MM-DD `date` column,
// so it carries no timezone) and today. Positive = the promise is PAST due.
function daysPastPromise(promised: string, now: number): number | null {
  const [y, m, d] = promised.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  const due = new Date(y, m - 1, d).setHours(0, 0, 0, 0);
  const today = new Date(now).setHours(0, 0, 0, 0);
  return Math.round((today - due) / DAY);
}

// Ranking rules — the order here IS the priority (0 = most urgent). A deal that
// matches none of these never enters the queue.
function classify(deal: QueueDeal, now: number): Urgency | null {
  const subs = deal.submissions ?? [];
  const responded = subs.filter((s) => s.response_at);
  const anyResponded = responded.length > 0;

  // 0 — a HOT Synergy lead. Top of the board.
  //
  // The two products are NOT the same job, and telling a closer the wrong one wastes
  // the lead:
  //
  //   LIVE TRANSFER — the vendor is warm-handing the merchant to you ON THE PHONE.
  //                   They are already on the line. There is nothing to "call back"
  //                   and no clock; the call IS the event. Pick up.
  //   REAL-TIME     — email only. Nobody is on the phone. You have 5 minutes to call
  //                   them, and the countdown is real.
  //
  // We can finally tell them apart: Synergy sends real-time leads from a distinctly
  // named account ("… (Real Time)" / "(RT)"), which the intake reads off the From
  // name, the subject, or the body's "Select the Company or Agent" field. So a live
  // transfer now arrives with first_call_due_at = NULL, on purpose — which is exactly
  // why this branch must NOT require a due date to fire.
  const isLiveTransfer = deal.lead_source === "live_transfer";
  const isRealtime = deal.lead_source === "realtime_appt";

  // ── A SCHEDULED CALLBACK OUTRANKS EVERYTHING, but only once it's DUE. ──
  //
  // "Call me at 4pm" is the most common real-time outcome, and the app used to have no
  // answer for it: the lead sat in the queue screaming CALL NOW all day, which teaches
  // a team to ignore red badges — the exact opposite of what a speed-to-lead queue is
  // for. Now it goes quiet until the merchant's time, then comes back at the very top.
  const cbMs = deal.callback_at ? Date.parse(deal.callback_at) - now : null;
  if (cbMs !== null) {
    // "📅 on calendar": the GHL appointment reflects THIS exact instant. A stale
    // tick after a reschedule would be a lie, so it compares values, not existence
    // (callback_synced_at stores the synced instant — see the migration comment).
    const onCalendar = !!deal.callback_ghl_event_id && !!deal.callback_synced_at &&
      Date.parse(deal.callback_synced_at) === Date.parse(deal.callback_at!);
    if (cbMs > 0) {
      // SNOOZED. Deliberately calm and deliberately still visible — a promise we made
      // to a merchant should never vanish from the board entirely.
      return {
        rank: 6.8,
        badge: `🕐 Callback at ${timeET(deal.callback_at!)}${onCalendar ? " · 📅 on calendar" : ""}`,
        why: `They asked you to call at ${timeET(deal.callback_at!)}. It'll jump to the top of My Day when it's due — nothing to do until then.`,
        since: deal.created_at,
        tone: "amber",
        lane: "followup",
      };
    }
    return {
      rank: 0,
      badge: "☎️ CALLBACK DUE — CALL THEM NOW",
      why: `You promised to call at ${timeET(deal.callback_at!)} — that time has come. This is the call they agreed to take.`,
      since: deal.callback_at!,
      tone: "red",
      callWindow: bestTimeToCall(deal),
    };
  }

  // ── TRIED, NOBODY ANSWERED. ──
  //
  // We responded IN TIME — a merchant not picking up does not make us slow — so this
  // must NOT keep shouting "SLA MISSED". It says what's true: you tried N times, try
  // again. Speed-to-lead is already banked in first_attempt_at.
  if (deal.status === "new" && deal.first_attempt_at && !deal.contacted_at) {
    const tries = deal.contact_attempts ?? 1;
    return {
      rank: 3.2,
      badge: `📵 No answer · tried ${tries}×`,
      why: `You reached out${deal.first_call_due_at && Date.parse(deal.first_attempt_at) <= Date.parse(deal.first_call_due_at) ? " inside the SLA" : ""} and nobody picked up. Try again, or set a callback time.`,
      since: deal.last_attempt_at ?? deal.first_attempt_at,
      tone: "amber",
      callWindow: bestTimeToCall(deal),
      lane: "new",
    };
  }

  if (deal.status === "new" && HOT.has(deal.temperature ?? "") && (deal.first_call_due_at || isLiveTransfer)) {
    if (isLiveTransfer) {
      return {
        rank: 0,
        badge: "🔴 LIVE TRANSFER — THEY'RE ON THE LINE",
        why: "The vendor is transferring this merchant to you right now. Take the call — there is no callback window, this is the conversation.",
        since: deal.created_at,
        tone: "red",
        // No countdown, deliberately. Nothing is expiring; they are on the phone.
        // Their stated time still shows: if the handoff drops or they don't pick up,
        // that's when to try them back.
        callWindow: bestTimeToCall(deal),
      };
    }
    // REAL-TIME. Two instructions, and they are NOT the same instruction:
    //
    //   1. EMAIL them inside 5 minutes. Speed-to-lead is what we're paying Synergy
    //      for, and an email can go out at any hour without ambushing anyone.
    //   2. CALL them at the time THEY gave us. Every one of these leads answers
    //      "best time to reach you" — 4:00PM CST, 10am PST. Dialing a merchant at
    //      9am who asked for 4pm burns the lead to satisfy a stopwatch.
    //
    // The clock is therefore an EMAIL clock, and it says so. Previously it read
    // "CALL NOW", which put the closer in direct conflict with the merchant's own
    // stated availability and gave them no way to satisfy both.
    const dueMs = deal.first_call_due_at ? Date.parse(deal.first_call_due_at) - now : 0;
    const bestTime = bestTimeToCall(deal);
    return {
      rank: 0,
      badge: dueMs > 0 ? `⏱ REAL-TIME · EMAIL NOW · ${countdown(dueMs)}` : "⏱ REAL-TIME · EMAIL OVERDUE",
      why: dueMs > 0
        ? `Nobody is on the phone. Send them an email inside the 5-minute window${bestTime ? `, then call at ${bestTime} — the time they asked for` : " — then call them"}.`
        : `Past the 5-minute email window — send it now${bestTime ? `, and call at ${bestTime} (their stated time)` : ""}.`,
      since: deal.created_at,
      tone: "red",
      countdownDue: isRealtime ? deal.first_call_due_at ?? undefined : undefined,
      callWindow: bestTime,
    };
  }

  // 1 — a funder replied, but the deal is still parked in Submitted.
  if (deal.status === "submitted_to_funder" && anyResponded) {
    const since = responded.map((s) => s.response_at as string).sort()[0];
    return { rank: 1, badge: "💬 Funder replied", why: "A funder responded — pull the offer in.", since, tone: "emerald" };
  }
  // 2 — the merchant wrote back within the last 3 days: read + act.
  if (deal.merchant_reply_at && now - Date.parse(deal.merchant_reply_at) < 3 * DAY) {
    return { rank: 2, badge: "💬 Merchant replied", why: deal.merchant_reply_summary || "The merchant wrote back — read + act.", since: deal.merchant_reply_at, tone: "emerald" };
  }
  // 3 — offer received, sitting >24h without being presented.
  if (deal.status === "offer_received" && deal.offer_received_at && now - Date.parse(deal.offer_received_at) > DAY) {
    return { rank: 3, badge: "📄 Present offers", why: "Offer in hand 24h+ — get it in front of them.", since: deal.offer_received_at, tone: "amber" };
  }
  // 3.5 / 4.5 / 6.9 — the merchant COMMITTED to a date for their bank statements
  // (captured in the playbook's docs step) and the stips still aren't in. A broken
  // promise is the loudest chase signal we have, so it outranks a generic "docs
  // stale" card; a promise that's due today (or still ahead) rides softer.
  if (deal.stips_promised_by && STIPS_PENDING.has(deal.status)) {
    const late = daysPastPromise(deal.stips_promised_by, now);
    if (late !== null) {
      const since = new Date(deal.stips_promised_by.slice(0, 10) + "T12:00:00").toISOString();
      if (late > 0) {
        return {
          rank: 3.5,
          badge: `📎 Promised statements ${late} day${late === 1 ? "" : "s"} ago`,
          why: "They committed to a date and it passed — call and hold them to it.",
          since,
          tone: "red",
        };
      }
      if (late === 0) {
        return { rank: 4.5, badge: "📎 Statements promised TODAY", why: "They said today — check in before the day gets away.", since, tone: "amber" };
      }
      return {
        rank: 6.9,
        badge: `📎 Statements due in ${-late} day${late === -1 ? "" : "s"}`,
        why: "They committed to a date — nothing to chase yet, just keep it warm.",
        since: deal.updated_at ?? deal.created_at ?? since,
        tone: "blue",
      };
    }
  }

  // 3 — a docs stage stalled 3+ days.
  const staleCol: Record<string, keyof QueueDeal> = {
    application_sent: "application_sent_at",
    docs_collected: "docs_collected_at",
    bank_statements: "bank_statements_at",
  };
  if (deal.status in staleCol) {
    const ts = deal[staleCol[deal.status]] as string | null;
    if (ts && now - Date.parse(ts) > 3 * DAY) {
      return { rank: 4, badge: "⏰ Docs stale", why: "No movement in 3+ days — chase the stips.", since: ts, tone: "red" };
    }
  }
  // 4 — submitted 48h+ ago and no funder has responded yet.
  if (deal.status === "submitted_to_funder" && deal.submitted_at && !anyResponded && now - Date.parse(deal.submitted_at) > 2 * DAY) {
    return { rank: 5, badge: "📤 Nudge funders", why: "Submitted 48h+ ago, still silent — nudge them.", since: deal.submitted_at, tone: "blue" };
  }
  // 5 — a new lead. It surfaces IMMEDIATELY: a just-created lead is the very
  // definition of "needs first contact", so it must never be invisible while it
  // ages (that hid brand-new leads from the closer AND admins for up to an hour).
  // Temperature only sets the badge/urgency. (Hot leads are caught by rank 0.)
  if (deal.status === "new" && deal.created_at) {
    const warm = WARM.has(deal.temperature ?? "");
    return warm
      ? { rank: 5.5, badge: "🌤️ Warm lead — call now", why: "Purchased/qualified lead — these decay fast, call now.", since: deal.created_at, tone: "amber" }
      : { rank: 6, badge: "🆕 New lead — make first contact", why: "Newly created lead — make first contact.", since: deal.created_at, tone: "gray" };
  }
  // 6 — CATCH-ALL: any OTHER open deal (terminal statuses are already filtered
  // out upstream in getOpenDealsForQueue) is still being actively worked, so it
  // must NEVER silently drop off My Day mid-funnel — that's the bug where a lead
  // moved to "contacted" (or qualifying, docs, etc.) disappeared from the queue.
  // Give each stage a nudge; anything unmapped still shows as low-priority
  // "in progress" so nothing open is ever invisible.
  const since = deal.updated_at ?? deal.created_at ?? null;
  switch (deal.status) {
    case "contacted":
      return { rank: 7, badge: "☎️ Qualify this lead", why: "You've made contact — run the 3 qualifiers and move them forward.", since, tone: "blue" };
    case "qualifying":
      return { rank: 7, badge: "📋 Send the application", why: "Qualified — get the app + upload link out while they're warm.", since, tone: "blue" };
    case "application_sent":
      return { rank: 7, badge: "✍️ Chase the signed app", why: "Application sent — nudge them to sign so you can package it.", since, tone: "blue" };
    case "docs_collected":
    case "bank_statements":
      return { rank: 7, badge: "📎 Collect the stips", why: "Docs started — get the rest (bank statements/ID) and submit.", since, tone: "blue" };
    case "offer_presented":
      return { rank: 7, badge: "🤝 Close the offer", why: "Offer's in front of them — close it.", since, tone: "amber" };
    case "offer_accepted":
      return { rank: 7, badge: "📝 Push to funding", why: "Accepted — drive it to funded.", since, tone: "amber" };
    default:
      return { rank: 8, badge: "🔧 In progress", why: "Open deal — keep it moving.", since, tone: "gray" };
  }
}

// ── LANE CLASSIFICATION ─────────────────────────────────────────────────────
// The single place that decides which lane an item lands in. It reads ONLY the
// rank produced by classify() above, so the lanes can never drift from the
// ranking: add a rank there, add it here, done. Anything unmapped falls into
// "followup" (an open deal we're already working is the safe default — a new
// lead is always rank 0 / 5.5 / 6 and explicitly listed).
//
//   rank 0   🔴 CALL NOW / LIVE TRANSFER / REAL-TIME  → new       (first touch, on the clock)
//   rank 0   ☎️ Callback DUE — they asked for now     → new       (a promise coming due)
//   rank 1   💬 Funder replied                        → followup
//   rank 2   💬 Merchant replied                      → followup
//   rank 3   📄 Present offers                        → followup
//   rank 3.2 📵 No answer — tried N×                  → new       (SLA banked; try again)
//   rank 3.5 📎 Promised statements N days ago        → followup  (broken commitment — loudest chase)
//   rank 4   ⏰ Docs stale                            → followup  (chase the stips)
//   rank 4.5 📎 Statements promised TODAY             → followup
//   rank 5   📤 Nudge funders                         → followup
//   rank 5.5 🌤️ Warm lead — call now                 → new       (never contacted)
//   rank 6   🆕 New lead — make first contact         → new       (never contacted)
//   rank 6.8 🕐 Callback SNOOZED until their time     → followup  (lane forced: not new work)
//   rank 6.9 📎 Statements due in N days              → followup  (scheduled, soft)
//   rank 7   ☎️/📋/✍️/📎/🤝/📝 active-stage nudges     → followup  (incl. "Collect the stips")
//   rank 8   🔧 In progress                           → followup
const NEW_WORK_RANKS = new Set([0, 5.5, 6]);

function laneOf(u: Urgency): Lane {
  return u.lane ?? (NEW_WORK_RANKS.has(u.rank) ? "new" : "followup");
}

const toneChip: Record<string, string> = {
  emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  red: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  gray: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
};

function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/**
 * Does this deal match what the user typed?
 *
 * Searches EVERYTHING a human might half-remember about a merchant, because that is the
 * actual use case: "I'm looking for someone named Nguyen or something like that". They
 * won't recall whether Nguyen was the contact or the business, and they certainly won't
 * recall the deal number — so every field is fair game: contact name, business name, deal
 * number, phone, email.
 *
 * Punctuation- and space-insensitive, so "KL Breen" finds "K.L. Breen Builders Inc" and
 * "5618560232" finds "+1 (561) 856-0232". Multi-word queries must match ALL words but in
 * ANY field ("nguyen auto" finds Nguyen at Auto Repair), which is what makes a half-
 * remembered search actually land.
 */
function matchesQuery(d: QueueDeal, q: string): boolean {
  if (!q.trim()) return true;
  const c = d.customer;
  const hay = [
    c?.first_name, c?.last_name, c?.business_name, c?.email, c?.phone,
    d.deal_number, d.status, d.lead_source,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    // Strip punctuation so "K.L." matches "kl" and "(561) 856-0232" matches "5618560232".
    .replace(/[^a-z0-9@]+/g, " ");
  const flat = hay.replace(/\s+/g, "");

  return q
    .toLowerCase()
    .replace(/[^a-z0-9@\s]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => hay.includes(word) || flat.includes(word.replace(/\s+/g, "")));
}

function nameOf(d: QueueDeal): string {
  return (
    d.customer?.business_name ||
    [d.customer?.first_name, d.customer?.last_name].filter(Boolean).join(" ") ||
    d.deal_number ||
    "Lead"
  );
}

// Compact deal size for the card ("$25K ask"). Omitted entirely when there's no
// requested amount on the row.
function amountOf(d: QueueDeal): string | null {
  const a = d.amount_requested;
  if (!a || a <= 0) return null;
  return a >= 1000 ? `$${Math.round(a / 1000)}K ask` : `$${a} ask`;
}

// How long an item may sit at its `since` timestamp before it's "overdue". Keyed
// off the classification rank so we don't re-derive the situation: funder/merchant
// replies go stale fast (4h), a new/warm lead must be worked within the hour, and
// the active-stage nudges (rank 7) get a full business day. Ranks with their own
// clock (rank 0's countdown) or that are already time-gated in classify() (offers,
// stale docs, silent funders) return null — no separate overdue flag.
function slaMs(rank: number): number | null {
  if (rank === 1 || rank === 2) return 4 * HOUR;
  if (rank === 5.5 || rank === 6) return HOUR;
  if (rank === 7) return DAY;
  return null;
}

// Color-code each card by HOW the lead arrived, so the queue reads at a glance:
// live transfers pop red (they're the time-critical ones), web-form leads blue,
// etc. Left edge carries the color; a tiny chip names the source.
const SOURCE_STYLE: Record<string, { edge: string; chip: string; label: string }> = {
  // The two Synergy products must never look alike — one means "pick up the phone,
  // they're already there", the other means "you have 5 minutes to dial". Same color
  // for both is how a closer treats a warm handoff like a callback, and loses it.
  live_transfer: { edge: "border-l-red-500", chip: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300", label: "📞 Live transfer — on the line" },
  realtime_appt: { edge: "border-l-fuchsia-500", chip: "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/40 dark:text-fuchsia-300", label: "⏱ Real-time — email in 5 min" },
  website: { edge: "border-l-blue-500", chip: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300", label: "Web form" },
  website_apply: { edge: "border-l-blue-500", chip: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300", label: "Web form" },
  web_purchased: { edge: "border-l-amber-500", chip: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300", label: "Web lead" },
  aged_transfer: { edge: "border-l-orange-500", chip: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300", label: "Aged" },
  cold_email: { edge: "border-l-purple-500", chip: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300", label: "Cold email" },
  cold_email_landing: { edge: "border-l-purple-500", chip: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300", label: "Cold email" },
  renewal: { edge: "border-l-emerald-500", chip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300", label: "Renewal" },
  referral: { edge: "border-l-teal-500", chip: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300", label: "Referral" },
};
const SOURCE_FALLBACK = { edge: "border-l-gray-300 dark:border-l-gray-600", chip: "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300", label: "Other" };
const sourceStyle = (d: QueueDeal) => SOURCE_STYLE[d.lead_source ?? ""] ?? SOURCE_FALLBACK;

type QueueItem = { deal: QueueDeal; u: Urgency };

/** One work card. Unchanged from the single-list version — same tones, same SLA
 * countdown, same overdue flag, same onPick. Lifted out so both lanes render it. */
function QueueCard({
  deal, u, now, onPick, onTouched,
}: QueueItem & { now: number; onPick: (d: QueueDeal) => void; onTouched: () => void }) {
  const src = sourceStyle(deal);
  const amount = amountOf(deal);
  const sla = slaMs(u.rank);
  const overdue = sla !== null && now - Date.parse(u.since) > sla;
  const [busy, setBusy] = useState<string | null>(null);
  const [askCallback, setAskCallback] = useState(false);

  // The outcome buttons belong on any lead we haven't actually SPOKEN to yet — which
  // includes one we've dialled three times and nobody answered.
  const needsOutcome = deal.status === "new" && !deal.contacted_at;

  const log = async (outcome: ContactOutcome, callbackAt?: string) => {
    setBusy(outcome);
    try {
      await logContactAttempt(deal.id, { outcome, channel: "call", callbackAt });
      setAskCallback(false);
      onTouched();
    } finally {
      setBusy(null);
    }
  };

  return (
    // A div, not a button: the card now carries its own action buttons, and a button
    // inside a button is invalid and swallows the inner click.
    <div
      role="button"
      tabIndex={0}
      onClick={() => onPick(deal)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onPick(deal); }}
      title={`Load ${nameOf(deal)} into the playbook`}
      className={`group shrink-0 w-72 text-left rounded-lg border border-gray-200 dark:border-gray-700 border-l-4 ${src.edge} bg-gray-50 dark:bg-gray-900 hover:border-ocean-blue hover:shadow-md hover:-translate-y-0.5 transition p-3 cursor-pointer`}
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${toneChip[u.tone]}`}>{u.badge}</span>
        {u.countdownDue ? (
          (Date.parse(u.countdownDue) - now) > 0 ? (
            <span className="text-[11px] font-bold text-red-600 dark:text-red-400 shrink-0 tabular-nums">
              ⏱ {countdown(Date.parse(u.countdownDue) - now)} left
            </span>
          ) : (
            <span className="text-[11px] font-bold text-red-600 dark:text-red-400 shrink-0">SLA MISSED — send it anyway</span>
          )
        ) : overdue ? (
          <span className="text-[11px] font-bold text-red-600 dark:text-red-400 shrink-0">overdue</span>
        ) : (
          <span className="text-[11px] text-gray-400 shrink-0">{ago(u.since, now)}</span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{nameOf(deal)}</p>
        {amount && <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 shrink-0">{amount}</span>}
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-3 mt-0.5">{u.why}</p>

      {/* The merchant's OWN words on when to phone them. Loud on purpose: it is the
          one instruction on this card that came from the person we're about to call,
          and it is the thing a 5-minute stopwatch will otherwise steamroll. */}
      {u.callWindow && (
        <p className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded px-1.5 py-1">
          <PhoneIcon className="w-3 h-3 shrink-0" />
          {/* Their words first, then what it means on OUR clock. A closer on Eastern
              reading "4:00PM CST" has to convert in their head mid-call, and will get
              it wrong often enough to lose a call. If it can't be parsed with
              confidence, only the raw text shows — a wrong conversion is far worse
              than none. */}
          <span className="truncate">
            Call at <b>{u.callWindow}</b>
            {statedTimeInET(u.callWindow) && (
              <span className="font-bold"> = {statedTimeInET(u.callWindow)}</span>
            )}
          </span>
        </p>
      )}

      {/* WHAT HAPPENED? — the thing the app had no way to hear.
          A closer dials a real-time lead and one of three things is true. Until now the
          app modelled none of them, so the red SLA badge sat there forever no matter
          what the closer did, and "call me at 4pm" merchants screamed CALL NOW all day
          — which is exactly how a team learns to ignore red badges. */}
      {needsOutcome && (
        <div className="mt-2" onClick={(e) => e.stopPropagation()}>
          {askCallback ? (
            <CallbackPicker
              bestTime={u.callWindow}
              busy={busy === "callback"}
              onCancel={() => setAskCallback(false)}
              onPick={(iso) => log("callback", iso)}
            />
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => log("reached")}
                disabled={!!busy}
                title="You spoke to the merchant"
                className="flex-1 px-2 py-1 rounded-md text-[11px] font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white transition-colors"
              >
                {busy === "reached" ? "…" : "✅ Reached"}
              </button>
              <button
                type="button"
                onClick={() => log("attempted")}
                disabled={!!busy}
                title="You tried — nobody picked up. You were still on time."
                className="flex-1 px-2 py-1 rounded-md text-[11px] font-semibold border border-gray-400 dark:border-gray-500 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-60 transition-colors"
              >
                {busy === "attempted" ? "…" : "📵 No answer"}
              </button>
              <button
                type="button"
                onClick={() => setAskCallback(true)}
                disabled={!!busy}
                title="They asked you to call at a specific time — snooze until then"
                className="flex-1 px-2 py-1 rounded-md text-[11px] font-semibold border border-amber-500 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/30 disabled:opacity-60 transition-colors"
              >
                🕐 Call back
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 mt-1.5">
        <span className="flex items-center gap-1.5 min-w-0">
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 ${src.chip}`}>{src.label}</span>
          <LeadGradeChip grade={deal.lead_grade} expectedValue={deal.expected_value} reasons={deal.score_reasons} />
        </span>
        <span className="text-[11px] font-medium text-ocean-blue opacity-0 group-hover:opacity-100 transition-opacity shrink-0">Open →</span>
      </div>
    </div>
  );
}

/**
 * "Call me at 4pm" → snooze this deal until 4pm.
 *
 * A closer is on the phone when they use this, so it has to be one tap. The presets do
 * the work; the datetime field is the escape hatch for anything they don't cover.
 *
 * We deliberately do NOT try to parse the merchant's free-text best_time ("4:00PM CST",
 * "10am PST") into a timestamp. It's inconsistent, timezone-laden, and a mis-parse would
 * silently bury a hot lead until the wrong hour. It's shown as a reminder, and a human
 * picks the actual time.
 */
function CallbackPicker({
  bestTime, busy, onPick, onCancel,
}: {
  bestTime?: string;
  busy: boolean;
  onPick: (iso: string) => void;
  onCancel: () => void;
}) {
  const [custom, setCustom] = useState("");
  // ── EVERY time here is EASTERN. ──
  // The app renders exclusively in ET (installEasternTime), but writes used to be
  // browser-local: "Tomorrow 9am" from a Phoenix laptop booked 9am ARIZONA (noon ET),
  // and a custom "4:00 PM" booked 4pm browser time — then the card rendered the ET
  // translation and nothing looked wrong until the call was hours late. The relative
  // presets (1h/3h) are timezone-free; everything wall-clock goes through the ET
  // helpers and is labelled ET so the closer knows whose clock they're reading.
  const customIso = custom ? etDateTimeLocalToUtcIso(custom) : null;

  const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

  const PRESETS: { label: string; iso: () => string }[] = [
    { label: "1h", iso: () => inMinutes(60) },
    { label: "3h", iso: () => inMinutes(180) },
    { label: "Tomorrow 9am ET", iso: () => tomorrowAtEtIso(9) },
  ];

  return (
    <div className="rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 p-2">
      <p className="text-[10px] font-semibold text-amber-800 dark:text-amber-300 mb-1.5">
        {bestTime ? (
          <>
            They said <b>{bestTime}</b>
            {statedTimeInET(bestTime) && <> = <b>{statedTimeInET(bestTime)}</b></>} — when will you call?
          </>
        ) : (
          "When will you call them back?"
        )}
      </p>
      <div className="flex flex-wrap gap-1 mb-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            disabled={busy}
            onClick={() => onPick(p.iso())}
            className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white"
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <input
          type="datetime-local"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          title="Eastern time — the whole app runs on ET"
          className="flex-1 min-w-0 rounded border border-amber-300 dark:border-amber-700 bg-white dark:bg-gray-800 px-1 py-0.5 text-[10px] text-gray-900 dark:text-white"
        />
        <span className="text-[10px] font-bold text-amber-700 dark:text-amber-300 shrink-0" title="This time is Eastern, not your laptop's timezone">
          ET
        </span>
        <button
          type="button"
          disabled={busy || !customIso}
          onClick={() => customIso && onPick(customIso)}
          className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white"
        >
          Set
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-1 py-0.5 text-[10px] text-amber-700 dark:text-amber-300 hover:underline"
        >
          ✕
        </button>
      </div>
      {/* Echo the exact instant back before it's committed — the cheap insurance
          against every remaining way to misread a datetime field. */}
      {customIso && (
        <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-300">
          Will call back at <b>{dateTimeET(customIso)}</b>
        </p>
      )}
    </div>
  );
}

/** One lane: a labelled header with a count badge, then the lane's cards in rank
 * order (or its own empty state). */
function LaneSection({
  title, hint, icon, countTone, items, empty, now, onPick, onTouched,
}: {
  title: string;
  hint: string;
  icon: string;
  countTone: string;
  items: QueueItem[];
  empty: string;
  now: number;
  onPick: (d: QueueDeal) => void;
  /** Refetch after a closer logs a first touch, so the card leaves the lane at once. */
  onTouched: () => void;
}) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm">{icon}</span>
        <h3 className="text-xs font-bold uppercase tracking-wide text-gray-700 dark:text-gray-200">{title}</h3>
        <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full ${countTone}`}>{items.length}</span>
        <span className="hidden sm:inline text-[11px] text-gray-400">— {hint}</span>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-gray-500 italic pb-1">{empty}</p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
          {items.map((it) => (
            <QueueCard key={it.deal.id} deal={it.deal} u={it.u} now={now} onPick={onPick} onTouched={onTouched} />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * "My Day" — the ranked work queue at the top of the Revenue Playbook, split into
 * TWO lanes: follow-up / chasing stips (deals already in motion) and new work
 * (first touch). Clicking a card loads that deal into the workspace (via onPick,
 * which also switches to the matching playbook tab). Auto-refreshes on a poll.
 */
export default function MyDayQueue({ onPick }: { onPick: (d: QueueDeal) => void }) {
  const { effectiveUserId, isAdmin, isSuperAdmin } = useUserProfile();
  // Admins/super-admins can flip Mine/All; a pure closer (no admin role) is
  // always scoped to their own book + unassigned. Default All for super_admin,
  // Mine for everyone else.
  const canToggle = isAdmin;
  const [scope, setScope] = useState<"mine" | "all">(isSuperAdmin ? "all" : "mine");
  const [query, setQuery] = useState("");
  const [deals, setDeals] = useState<QueueDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  // My Day is an accordion but DEFAULT EXPANDED.
  const [collapsed, setCollapsed] = useState(false);

  const load = useCallback(() => {
    getOpenDealsForQueue()
      .then((d) => setDeals(d))
      .catch(() => setDeals([]))
      .finally(() => {
        setLoading(false);
        setNow(Date.now());
      });
  }, []);

  useEffect(() => {
    load();
    // Near-real-time: a fast poll, a refetch when the tab regains focus, and a
    // live subscription to deal changes — so a lead created by anyone (e.g. a
    // closer) pops into the queue without a manual refresh.
    const poll = setInterval(load, 15_000);
    const onFocus = () => { if (!document.hidden) load(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    const channel = supabase
      .channel("myday-deals")
      .on("postgres_changes", { event: "*", schema: "public", table: "deals" }, () => load())
      .subscribe();
    return () => {
      clearInterval(poll);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      supabase.removeChannel(channel);
    };
  }, [load]);

  // Tick `now` every second so the hot-lead speed-to-lead countdown counts down
  // live (the 60s data reload is too coarse for a ticking clock).
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, []);

  const mineScope = (d: QueueDeal) => !d.assigned_closer_id || d.assigned_closer_id === effectiveUserId;

  const items = useMemo(() => {
    const scoped = deals.filter((d) => {
      if (!canToggle) return mineScope(d);
      return scope === "all" ? true : mineScope(d);
    });
    const searching = query.trim() !== "";
    return scoped
      .filter((d) => matchesQuery(d, query))
      .map((d) => {
        const u = classify(d, now);
        // While SEARCHING, a deal the ranking rules ignore must still be findable. My Day
        // only surfaces deals that need action, so a merchant who is simply parked (nothing
        // due, nothing overdue) classifies to null and would vanish — and "I searched for
        // Nguyen and got nothing" is a far worse outcome than one extra card. So a match
        // that has no urgency of its own gets a neutral one, and says exactly that.
        if (u || !searching) return { deal: d, u };
        return {
          deal: d,
          u: {
            rank: 99,
            badge: "🔍 Match",
            why: "Found by search — nothing is due on this deal right now.",
            since: d.created_at,
            tone: "gray",
            lane: "followup" as Lane,
          } satisfies Urgency,
        };
      })
      .filter((x): x is QueueItem => x.u !== null)
      .sort((a, b) =>
        a.u.rank - b.u.rank ||
        // Quality tiebreak ONLY (plan §1): among equally urgent cards, the deal worth
        // more money goes first. Urgency ranks and lanes are untouched.
        ((b.deal.expected_value ?? -1) - (a.deal.expected_value ?? -1)) ||
        Date.parse(a.u.since) - Date.parse(b.u.since));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deals, scope, canToggle, effectiveUserId, now, query]);

  // Two lanes off the ONE classification. Rank ordering is preserved inside each
  // lane (items is already sorted; filter keeps that order).
  const followUps = useMemo(() => items.filter((i) => laneOf(i.u) === "followup"), [items]);
  const newWork = useMemo(() => items.filter((i) => laneOf(i.u) === "new"), [items]);

  // Follow-up leads (the lane the owner cares most about) — EXCEPT when there's a
  // 🔴 CALL NOW on the clock, which must never sit below a header. Then new work
  // goes first so the most urgent card on the board is visible without scrolling.
  const callNowFirst = newWork.some((i) => i.u.rank === 0);
  const laneOrder: Lane[] = callNowFirst ? ["new", "followup"] : ["followup", "new"];

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <button type="button" onClick={() => setCollapsed((c) => !c)} className="flex items-center gap-2 text-left">
          <ChevronDownIcon className={`w-4 h-4 text-gray-400 transition-transform ${collapsed ? "-rotate-90" : ""}`} />
          <BoltIcon className="w-5 h-5 text-amber-500" />
          <h2 className="text-base font-bold text-gray-900 dark:text-white">My Day</h2>
          {!loading && items.length > 0 && (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              {items.length}
            </span>
          )}
          <span className="hidden sm:inline text-xs text-gray-400">— what needs you next, most urgent first</span>
          {!loading && items.length > 0 && (
            <span className="hidden md:inline-flex items-center gap-1.5 text-[11px]">
              <span className="font-semibold px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">
                {followUps.length} to chase
              </span>
              <span className="font-semibold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                {newWork.length} new
              </span>
            </span>
          )}
        </button>
        <div className="flex items-center gap-2">
          {/* Search. Sits in the header because "find me that Nguyen guy" is a thing a
              closer does mid-call, and hunting through 14 cards by eye is not a plan. */}
          <div className="relative">
            <MagnifyingGlassIcon className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, business, phone…"
              className="w-44 sm:w-56 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 pl-8 pr-7 py-1 text-xs text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-ocean-blue"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                title="Clear search"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <XMarkIcon className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {canToggle && (
            <div className="inline-flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden text-xs">
              {(["mine", "all"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setScope(s)}
                  className={`px-2.5 py-1 ${scope === s ? "bg-ocean-blue text-white" : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"}`}
                >
                  {s === "mine" ? "Mine" : "All"}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={load}
            title="Refresh the queue"
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <ArrowPathIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      {!collapsed && (loading ? (
        <p className="text-sm text-gray-400 py-2">Loading your queue…</p>
      ) : items.length === 0 ? (
        query.trim() ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 py-2">
            No open deal matches <b>“{query}”</b>
            {scope === "mine" && canToggle && <> in your book — try <b>All</b>.</>}
            {!(scope === "mine" && canToggle) && <> . They may be funded, declined, or not in the pipeline.</>}
          </p>
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400 py-2">Queue clear — work the funnel below 🎉</p>
        )
      ) : (
        <div className="space-y-4">
          {laneOrder.map((lane) =>
            lane === "followup" ? (
              <LaneSection
                key="followup"
                icon="📎"
                title="Follow-up · chasing stips"
                hint="deals already in motion — chase the docs, the replies, the offers"
                countTone="bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300"
                items={followUps}
                empty="Nothing to chase right now."
                now={now}
                onPick={onPick}
                onTouched={load}
              />
            ) : (
              <LaneSection
                key="new"
                icon="🆕"
                title="New work · first touch"
                hint="brand-new + real-time leads — make first contact"
                countTone="bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                items={newWork}
                empty="No new leads waiting."
                now={now}
                onPick={onPick}
                onTouched={load}
              />
            )
          )}
        </div>
      ))}
    </div>
  );
}
