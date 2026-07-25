import supabase from "@/supabase";
import type { Campaign } from "@/services/campaignService";

// ─────────────────────────────────────────────────────────────────────────────
// Email Quality Report — an ON-DEMAND, copy-and-paste report the owner sends to a
// lead vendor about the deliverability of the addresses they delivered. It reads
// LIVE data (no snapshot): for a chosen vendor's campaigns, over a chosen lead-date
// window, it counts the distinct campaign-attributed merchants and buckets them by
// the mailbox-level verdict already stored on customers.email_status.
//
// Ground truth & honesty rules baked in here:
//   • Distinct PER CAMPAIGN (a merchant with deals in two campaigns counts in each).
//   • The window is on customers.created_at (the lead date), matched to the DB the
//     same way the audit does: [from 00:00, to+1 day 00:00) in the DB session TZ.
//   • Buckets sum to the segment total — the pending/unknown bucket is NEVER folded
//     into good or bad. No email on file → pending (deliverability unproven).
//   • Hard-bad = invalid + bounced (undeliverable/disposable are counted as invalid,
//     never hidden in pending).
// This module is pure data + string building; the panel component renders it.
// ─────────────────────────────────────────────────────────────────────────────

export type EmailBucket = "verified" | "invalid" | "bounced" | "catch_all" | "pending";

export const BUCKET_ORDER: EmailBucket[] = ["verified", "invalid", "bounced", "catch_all", "pending"];

export const BUCKET_LABEL: Record<EmailBucket, string> = {
  verified: "Verified",
  invalid: "Invalid",
  bounced: "Bounced",
  catch_all: "Catch-all",
  pending: "Unverified / no verdict yet",
};

// Hard-bad = the addresses we know will not deliver.
const HARD_BAD: EmailBucket[] = ["invalid", "bounced"];

// A vendor segment reads "healthy" at or below this hard-bad rate, "needs attention"
// above it. Chosen so 6.9% reads healthy and 14.4% reads as needing attention.
export const ATTENTION_THRESHOLD_PCT = 8;

export interface HardBadRecord {
  receivedDate: string;   // formatted lead date (ET)
  receivedAt: string;     // raw ISO for sorting
  businessName: string;
  contactName: string;
  email: string;
  status: EmailBucket;
}

export interface ReportSegment {
  campaignId: string;
  code: string | null;
  name: string;
  channel: string;
  total: number;
  counts: Record<EmailBucket, number>;
  hardBad: number;
  hardBadPct: number | null;    // hardBad / total
  pending: number;
  verdict: "good" | "attention";
  evidence: HardBadRecord[];    // every invalid/bounced record, oldest first
}

export interface EmailQualityReportParams {
  vendor: string;                                                  // scope label (campaigns.partner)
  campaigns: Pick<Campaign, "id" | "code" | "name" | "channel">[]; // the segments to report
  from: string;                                                    // 'YYYY-MM-DD' inclusive
  to: string;                                                      // 'YYYY-MM-DD' inclusive
  addresseeFirstName?: string;                                     // optional salutation ("" → none)
}

export interface EmailQualityReport {
  vendor: string;
  from: string;
  to: string;
  rangeLabel: string;
  addresseeFirstName: string;
  generatedAt: string;          // ISO
  segments: ReportSegment[];
  totals: { total: number; verified: number; hardBad: number; pending: number; hardBadPct: number | null };
  html: string;                 // rich fragment (inline-styled — survives a Gmail paste)
  text: string;                 // plain-text fallback
}

// ── Small helpers ────────────────────────────────────────────────────────────
const CHUNK = 300;
function chunk<T>(xs: T[], n = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}
const pct = (n: number, d: number): number | null => (d > 0 ? (n / d) * 100 : null);
const pctStr = (v: number | null) => (v == null ? "—" : `${v.toFixed(v < 10 ? 1 : 0)}%`);

function addDaysISO(iso: string, days: number): string {
  const dt = new Date(`${iso}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
function monthDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
function yearOf(iso: string): string {
  return iso.split("-")[0];
}
export function rangeLabelOf(from: string, to: string): string {
  if (yearOf(from) === yearOf(to)) return `${monthDay(from)} – ${monthDay(to)}, ${yearOf(to)}`;
  return `${monthDay(from)}, ${yearOf(from)} – ${monthDay(to)}, ${yearOf(to)}`;
}
// Lead date, ET — the "received date" a vendor recognizes.
function etDate(isoTs: string): string {
  return new Date(isoTs).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
}

interface CustomerRow {
  id: string;
  email: string | null;
  email_status: string | null;
  business_name: string | null;
  first_name: string | null;
  last_name: string | null;
  created_at: string;
}

function bucketOf(status: string | null): EmailBucket {
  switch ((status ?? "").toLowerCase()) {
    case "verified": return "verified";
    case "invalid":
    case "undeliverable":
    case "disposable": return "invalid"; // hard-bad family — never hidden in pending
    case "bounced": return "bounced";
    case "catch_all": return "catch_all";
    default: return "pending"; // null / unknown / risky / no email on file
  }
}

// ── The generator ────────────────────────────────────────────────────────────
export async function generateEmailQualityReport(params: EmailQualityReportParams): Promise<EmailQualityReport> {
  const { vendor, campaigns, from, to } = params;
  const addresseeFirstName = (params.addresseeFirstName ?? "").trim();
  const toExclusive = addDaysISO(to, 1); // [from, to+1day) — matches the audit's window

  const ids = campaigns.map((c) => c.id);

  // 1) campaign → distinct customer ids (from attributed deals).
  const custByCampaign = new Map<string, Set<string>>(ids.map((id) => [id, new Set<string>()]));
  const allCustIds = new Set<string>();
  if (ids.length > 0) {
    const { data, error } = await supabase
      .from("deals")
      .select("campaign_id, customer_id")
      .in("campaign_id", ids)
      .not("customer_id", "is", null);
    if (error) throw error;
    for (const r of (data ?? []) as { campaign_id: string; customer_id: string }[]) {
      custByCampaign.get(r.campaign_id)?.add(r.customer_id);
      allCustIds.add(r.customer_id);
    }
  }

  // 2) Those customers, restricted to the lead-date window. Chunked .in for safety.
  const custMap = new Map<string, CustomerRow>();
  for (const part of chunk([...allCustIds])) {
    if (part.length === 0) continue;
    const { data, error } = await supabase
      .from("customers")
      .select("id, email, email_status, business_name, first_name, last_name, created_at")
      .in("id", part)
      .gte("created_at", from)
      .lt("created_at", toExclusive);
    if (error) throw error;
    for (const r of (data ?? []) as CustomerRow[]) custMap.set(r.id, r);
  }

  // 3) Fold each segment.
  const segments: ReportSegment[] = campaigns.map((c) => {
    const counts: Record<EmailBucket, number> = { verified: 0, invalid: 0, bounced: 0, catch_all: 0, pending: 0 };
    const evidence: HardBadRecord[] = [];
    for (const custId of custByCampaign.get(c.id) ?? []) {
      const cust = custMap.get(custId);
      if (!cust) continue; // outside the lead-date window
      const b = bucketOf(cust.email_status);
      counts[b] += 1;
      if (HARD_BAD.includes(b)) {
        evidence.push({
          receivedDate: etDate(cust.created_at),
          receivedAt: cust.created_at,
          businessName: cust.business_name?.trim() || "—",
          contactName: [cust.first_name, cust.last_name].filter(Boolean).join(" ").trim() || "—",
          email: cust.email?.trim() || "—",
          status: b,
        });
      }
    }
    evidence.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
    const total = BUCKET_ORDER.reduce((s, k) => s + counts[k], 0);
    const hardBad = HARD_BAD.reduce((s, k) => s + counts[k], 0);
    const hardBadPct = pct(hardBad, total);
    return {
      campaignId: c.id, code: c.code, name: c.name, channel: c.channel,
      total, counts, hardBad, hardBadPct, pending: counts.pending,
      verdict: hardBadPct != null && hardBadPct > ATTENTION_THRESHOLD_PCT ? "attention" : "good",
      evidence,
    };
  });

  const totals = segments.reduce(
    (acc, s) => {
      acc.total += s.total; acc.verified += s.counts.verified; acc.hardBad += s.hardBad; acc.pending += s.pending;
      return acc;
    },
    { total: 0, verified: 0, hardBad: 0, pending: 0, hardBadPct: null as number | null },
  );
  totals.hardBadPct = pct(totals.hardBad, totals.total);

  const rangeLabel = rangeLabelOf(from, to);
  const generatedAt = new Date().toISOString();
  const report: Omit<EmailQualityReport, "html" | "text"> = {
    vendor, from, to, rangeLabel, addresseeFirstName, generatedAt, segments, totals,
  };
  return { ...report, html: buildHtml(report), text: buildText(report) };
}

// ── Rich HTML (inline styles only, so a Gmail paste keeps the tables) ────────
const FONT = "font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;";
const C = {
  ink: "#111827", sub: "#6b7280", line: "#e5e7eb",
  good: "#047857", bad: "#b91c1c", warn: "#b45309", head: "#374151",
};
const seg = (v: string) => `${FONT}${v}`;

function verdictWord(s: ReportSegment): string {
  if (s.total === 0) return "no leads in range";
  return s.verdict === "good" ? "healthy" : "needs attention";
}
function verdictColor(s: ReportSegment): string {
  if (s.total === 0) return C.sub;
  return s.verdict === "good" ? C.good : C.bad;
}
function bucketColor(b: EmailBucket): string {
  if (b === "verified") return C.good;
  if (b === "invalid" || b === "bounced") return C.bad;
  if (b === "catch_all") return C.warn;
  return C.sub;
}
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function segmentTitle(s: ReportSegment): string {
  return s.code ? `${s.name} (${s.code})` : s.name;
}

function buildHtml(r: Omit<EmailQualityReport, "html" | "text">): string {
  const parts: string[] = [];
  parts.push(`<div style="${seg(`color:${C.ink};font-size:14px;line-height:1.5;max-width:680px;`)}">`);

  if (r.addresseeFirstName) parts.push(`<p style="margin:0 0 14px;">${esc(r.addresseeFirstName)},</p>`);

  parts.push(
    `<h2 style="${seg(`font-size:18px;margin:0 0 6px;color:${C.ink};`)}">Email deliverability report — ${esc(r.vendor)}</h2>`,
  );
  parts.push(`<p style="margin:0 0 16px;color:${C.sub};font-size:13px;">Lead dates ${esc(r.rangeLabel)}</p>`);

  // Methodology + why it matters
  parts.push(
    `<p style="margin:0 0 12px;">Every address you delivered was checked at the mailbox level via Instantly.ai's SMTP handshake — a verification only, <b>no email is ever sent</b> to the merchant. The verdicts below are those results, grouped by the campaign the lead came in on.</p>`,
  );
  parts.push(
    `<p style="margin:0 0 16px;">This matters because email is how we deliver the application and the e-sign documents. An <b>invalid</b> or <b>bounced</b> address means the merchant never receives the paperwork, so the lead cannot fund no matter how good the phone conversation was.</p>`,
  );

  for (const s of r.segments) {
    parts.push(`<div style="margin:0 0 22px;border-top:2px solid ${C.line};padding-top:14px;">`);
    parts.push(
      `<h3 style="${seg(`font-size:15px;margin:0 0 4px;color:${C.ink};`)}">${esc(segmentTitle(s))}</h3>`,
    );
    if (s.total === 0) {
      parts.push(`<p style="margin:0;color:${C.sub};">No leads delivered on this campaign in this window.</p></div>`);
      continue;
    }
    parts.push(
      `<p style="margin:0 0 10px;">${s.total} leads · hard-bad rate <b style="color:${verdictColor(s)};">${pctStr(s.hardBadPct)}</b> ` +
        `(${s.hardBad} invalid or bounced) — <b style="color:${verdictColor(s)};">${verdictWord(s)}</b>.</p>`,
    );

    // Bucket table
    parts.push(
      `<table cellpadding="0" cellspacing="0" style="${seg("border-collapse:collapse;font-size:13px;margin:0 0 10px;")}">`,
    );
    for (const b of BUCKET_ORDER) {
      const n = s.counts[b];
      parts.push(
        `<tr>` +
          `<td style="padding:3px 16px 3px 0;color:${bucketColor(b)};">${esc(BUCKET_LABEL[b])}</td>` +
          `<td style="padding:3px 12px 3px 0;text-align:right;font-weight:bold;">${n}</td>` +
          `<td style="padding:3px 0;text-align:right;color:${C.sub};">${pctStr(pct(n, s.total))}</td>` +
        `</tr>`,
      );
    }
    parts.push(`</table>`);

    // Evidence
    if (s.evidence.length > 0) {
      parts.push(
        `<p style="margin:0 0 6px;font-weight:bold;color:${C.head};font-size:13px;">The ${s.evidence.length} record${s.evidence.length === 1 ? "" : "s"} to credit or replace:</p>`,
      );
      parts.push(
        `<table cellpadding="0" cellspacing="0" style="${seg(`border-collapse:collapse;font-size:12px;border:1px solid ${C.line};`)}">`,
      );
      parts.push(
        `<tr style="background:#f9fafb;">` +
          `<th style="text-align:left;padding:6px 10px;border-bottom:1px solid ${C.line};color:${C.head};">Received</th>` +
          `<th style="text-align:left;padding:6px 10px;border-bottom:1px solid ${C.line};color:${C.head};">Business</th>` +
          `<th style="text-align:left;padding:6px 10px;border-bottom:1px solid ${C.line};color:${C.head};">Contact</th>` +
          `<th style="text-align:left;padding:6px 10px;border-bottom:1px solid ${C.line};color:${C.head};">Email</th>` +
          `<th style="text-align:left;padding:6px 10px;border-bottom:1px solid ${C.line};color:${C.head};">Status</th>` +
        `</tr>`,
      );
      for (const e of s.evidence) {
        parts.push(
          `<tr>` +
            `<td style="padding:6px 10px;border-bottom:1px solid ${C.line};white-space:nowrap;">${esc(e.receivedDate)}</td>` +
            `<td style="padding:6px 10px;border-bottom:1px solid ${C.line};">${esc(e.businessName)}</td>` +
            `<td style="padding:6px 10px;border-bottom:1px solid ${C.line};">${esc(e.contactName)}</td>` +
            `<td style="padding:6px 10px;border-bottom:1px solid ${C.line};">${esc(e.email)}</td>` +
            `<td style="padding:6px 10px;border-bottom:1px solid ${C.line};color:${C.bad};text-transform:capitalize;">${esc(e.status)}</td>` +
          `</tr>`,
        );
      }
      parts.push(`</table>`);
    }
    parts.push(`</div>`);
  }

  // What we're asking
  parts.push(`<div style="margin:0 0 18px;">`);
  parts.push(`<p style="margin:0 0 6px;font-weight:bold;color:${C.ink};">What we're asking:</p>`);
  parts.push(`<ul style="margin:0;padding-left:20px;">`);
  parts.push(`<li style="margin:0 0 4px;">Credit or replace the invalid and bounced records listed above.</li>`);
  parts.push(`<li style="margin:0 0 4px;">Have the agent verify the email on the call by reading it back to the merchant, character by character.</li>`);
  parts.push(`<li style="margin:0 0 4px;">Let's make this a regular cadence so we can keep the address quality high together.</li>`);
  parts.push(`</ul></div>`);

  // Honest footer
  const pendingLines = r.segments
    .filter((s) => s.pending > 0)
    .map((s) => `${esc(segmentTitle(s))}: ${s.pending} not yet verified`)
    .join("; ");
  parts.push(
    `<p style="margin:0;color:${C.sub};font-size:11px;border-top:1px solid ${C.line};padding-top:10px;">` +
      `Generated ${esc(new Date(r.generatedAt).toLocaleString("en-US", { timeZone: "America/New_York" }))} ET · ` +
      `lead dates ${esc(monthDay(r.from))} ${esc(yearOf(r.from))} through ${esc(monthDay(r.to))} ${esc(yearOf(r.to))} inclusive.` +
      (pendingLines ? ` Not counted as good or bad — ${pendingLines}.` : "") +
    `</p>`,
  );

  parts.push(`</div>`);
  return parts.join("");
}

// ── Plain-text fallback ──────────────────────────────────────────────────────
function buildText(r: Omit<EmailQualityReport, "html" | "text">): string {
  const L: string[] = [];
  if (r.addresseeFirstName) { L.push(`${r.addresseeFirstName},`); L.push(""); }
  L.push(`EMAIL DELIVERABILITY REPORT — ${r.vendor}`);
  L.push(`Lead dates ${r.rangeLabel}`);
  L.push("");
  L.push("Every address you delivered was checked at the mailbox level via Instantly.ai's SMTP handshake (verification only — no email is ever sent to the merchant), grouped by the campaign the lead came in on.");
  L.push("");
  L.push("Why it matters: email is how we deliver the application and the e-sign documents. An invalid or bounced address means the merchant never receives the paperwork, so the lead cannot fund.");
  L.push("");

  for (const s of r.segments) {
    L.push(`── ${segmentTitle(s)} ──`);
    if (s.total === 0) { L.push("No leads delivered on this campaign in this window."); L.push(""); continue; }
    L.push(`${s.total} leads · hard-bad rate ${pctStr(s.hardBadPct)} (${s.hardBad} invalid or bounced) — ${verdictWord(s)}.`);
    for (const b of BUCKET_ORDER) {
      L.push(`  ${BUCKET_LABEL[b].padEnd(28)} ${String(s.counts[b]).padStart(4)}  ${pctStr(pct(s.counts[b], s.total))}`);
    }
    if (s.evidence.length > 0) {
      L.push("");
      L.push(`  Records to credit or replace (${s.evidence.length}):`);
      for (const e of s.evidence) {
        L.push(`    ${e.receivedDate}  ${e.businessName} — ${e.contactName} — ${e.email} — ${e.status}`);
      }
    }
    L.push("");
  }

  L.push("What we're asking:");
  L.push("  - Credit or replace the invalid and bounced records listed above.");
  L.push("  - Have the agent verify the email on the call by reading it back to the merchant, character by character.");
  L.push("  - Let's make this a regular cadence so we can keep the address quality high together.");
  L.push("");

  const pendingLines = r.segments.filter((s) => s.pending > 0).map((s) => `${segmentTitle(s)}: ${s.pending} not yet verified`).join("; ");
  L.push(
    `Generated ${new Date(r.generatedAt).toLocaleString("en-US", { timeZone: "America/New_York" })} ET · ` +
    `lead dates ${monthDay(r.from)} ${yearOf(r.from)} through ${monthDay(r.to)} ${yearOf(r.to)} inclusive.` +
    (pendingLines ? ` Not counted as good or bad — ${pendingLines}.` : ""),
  );
  return L.join("\n");
}
