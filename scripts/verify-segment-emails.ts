// verify-segment-emails.ts — verify a PILOT batch of a campaign segment's emails
// with Instantly, writing verdicts to lead_records via lead_record_record_verification().
//
// Spends Instantly credits, so it is capped: --limit (default 1500, hard max 1500)
// and it stops if the balance Instantly reports drops under --min-credits.
// Verification semantics are NOT re-implemented here: verifyEmail() comes from
// supabase/functions/_shared/instantly.ts (the one definition of email health).
//
// Usage (from repo root; keys come from .env, never printed):
//   set -a; source .env; set +a
//   deno run --no-check --allow-net --allow-env scripts/verify-segment-emails.ts \
//     --slug micro-bitty --limit 1500 --concurrency 8
//
// Pilot mix (micro-bitty): ~47% UCC preferred-tier, ~13% UCC standard, ~40% trigger.
// WAVV soft-nos are never in the pilot; within each stratum, rows with a company-name
// industry (industry_merge NOT NULL) come first — the UCC SIC column is scrambled.

import { verifyEmail, type VerifyResult } from "../supabase/functions/_shared/instantly.ts";

const args = new Map<string, string>();
for (let i = 0; i < Deno.args.length; i += 2) args.set(Deno.args[i].replace(/^--/, ""), Deno.args[i + 1]);
const SLUG = args.get("slug") ?? "micro-bitty";
const LIMIT = Math.min(Number(args.get("limit") ?? 1500), 1500);
const CONC = Number(args.get("concurrency") ?? 8);
const MIN_CREDITS = Number(args.get("min-credits") ?? 50);
const PROJECT = "ehibjeonqpqskhcvizow";

const IKEY = Deno.env.get("INSTANTLY_API_KEY");
const MTOK = Deno.env.get("SUPABASE_ACCESS_TOKEN");
if (!IKEY || !MTOK) throw new Error("INSTANTLY_API_KEY and SUPABASE_ACCESS_TOKEN must be in the environment");

async function sql<T = Record<string, unknown>>(query: string): Promise<T[]> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${MTOK}`, "Content-Type": "application/json", "User-Agent": "curl/8" },
      body: JSON.stringify({ query }),
    });
    const text = await res.text();
    if (res.ok) return JSON.parse(text) as T[];
    console.error(`[sql] HTTP ${res.status}: ${text.slice(0, 200)} (attempt ${attempt + 1})`);
    await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
  }
  throw new Error("management API SQL failed 4 times");
}
const lit = (v: string | null | undefined) => (v == null ? "null" : `'${v.replace(/'/g, "''")}'`);

/** A raw POST, used only to read the credit balance Instantly reports. */
async function creditProbe(email: string): Promise<{ credits: unknown; credits_used: unknown; status: number; message?: string }> {
  const res = await fetch("https://api.instantly.ai/api/v2/email-verification", {
    method: "POST",
    headers: { Authorization: `Bearer ${IKEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const d = await res.json().catch(() => ({}));
  return { credits: d.credits, credits_used: d.credits_used, status: res.status, message: d.message };
}

// ── pick the pilot ──────────────────────────────────────────────────────────
const nUccPref = Math.round(LIMIT * 0.47), nUccStd = Math.round(LIMIT * 0.13), nTrig = LIMIT - nUccPref - nUccStd;
const pick = (where: string, n: number) => `
  (select m.lead_record_id id, m.email, m.source, m.bitty_tier
     from campaign_segment_members m join lead_records lr on lr.id = m.lead_record_id
    where m.campaign_slug = ${lit(SLUG)} and m.enrolled_at is null and lr.email_status is null
      and not m.wavv_soft_no
      and lower(lr.email) = m.email and ${where}
    order by (m.industry_merge is null), md5(m.lead_record_id::text) limit ${n})`;
const rows = await sql<{ id: string; email: string; source: string; bitty_tier: string | null }>(
  `${pick("m.source = 'ucc' and m.bitty_tier = 'preferred'", nUccPref)} union all
   ${pick("m.source = 'ucc' and m.bitty_tier = 'standard'", nUccStd)} union all
   ${pick("m.source = 'trigger'", nTrig)}`,
);
console.log(`pilot picked: ${rows.length} (ucc-preferred ${rows.filter((r) => r.source === "ucc" && r.bitty_tier === "preferred").length}, ucc-standard ${rows.filter((r) => r.source === "ucc" && r.bitty_tier === "standard").length}, trigger ${rows.filter((r) => r.source === "trigger").length})`);
if (!rows.length) Deno.exit(0);

const before = await creditProbe(rows[0].email);
console.log(`credit probe BEFORE: HTTP ${before.status} credits=${before.credits} credits_used=${before.credits_used}`);
// Instantly answers HTTP 403 "No credits available" when the balance is empty. verifyEmail()
// files every 403 under rateLimited, so without this check an empty wallet would look like
// throttling and the run would spin. An empty wallet is a STOP, not a retry.
if (before.status === 403 && /no credits/i.test(before.message ?? "")) {
  console.error(`Instantly: "${before.message}" — balance is EMPTY; nothing verified, nothing spent. Top up credits first.`);
  Deno.exit(3);
}
if (typeof before.credits === "number" && before.credits < MIN_CREDITS) {
  console.error(`balance ${before.credits} < --min-credits ${MIN_CREDITS}; refusing to spend`);
  Deno.exit(2);
}

// ── verify with bounded concurrency; record in chunks ───────────────────────
const pending: { id: string; email: string; r: VerifyResult }[] = [];
const tally: Record<string, number> = {};
let rateLimitedStreak = 0, stop = false, done = 0;
const queue = [...rows];

async function flush() {
  if (!pending.length) return;
  const batch = pending.splice(0, pending.length);
  const values = batch.map((b) =>
    `(${lit(b.id)}::uuid, ${lit(b.email)}, ${lit(b.r.health)}, ${lit(b.r.raw)}, ${b.r.catchAll}, ${lit(b.r.error ?? null)})`).join(",");
  await sql(`select public.lead_record_record_verification(v.id, v.email, v.h, v.raw, v.ca, v.err)
               from (values ${values}) v(id, email, h, raw, ca, err)`);
}

async function worker() {
  while (!stop) {
    const row = queue.shift();
    if (!row) return;
    const r = await verifyEmail(IKEY!, row.email);
    if (r.rateLimited) {
      // NOT a verdict — never record it. Requeue and back off; give up after a long streak.
      rateLimitedStreak++;
      queue.push(row);
      if (rateLimitedStreak > 25) { console.error("persistent rate limiting — stopping"); stop = true; return; }
      await new Promise((res) => setTimeout(res, 15000));
      continue;
    }
    rateLimitedStreak = 0;
    const key = r.error ? "error/unreadable" : r.health;
    tally[key] = (tally[key] ?? 0) + 1;
    pending.push({ id: row.id, email: row.email, r });
    done++;
    if (pending.length >= 50) await flush();
    if (done % 100 === 0) console.log(`  ${done}/${rows.length}`, JSON.stringify(tally));
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
await flush();

const after = await creditProbe(rows[rows.length - 1].email);
console.log(`credit probe AFTER: HTTP ${after.status} credits=${after.credits} credits_used=${after.credits_used}`);
console.log("verified:", done, "tally:", JSON.stringify(tally));
