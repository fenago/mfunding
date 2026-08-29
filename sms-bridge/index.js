/**
 * JMP.chat SMS bridge — XMPP <-> Supabase `sms_messages`.
 *
 * Runs on a DigitalOcean droplet under systemd. No public port: the site never
 * calls this process. It talks to xmpp.chat (JMP) and to Supabase, nothing else.
 *
 *   inbound  : cheogram.com stanza -> insert sms_messages {direction:'inbound', status:'received'}
 *   outbound : poll sms_messages status='queued' -> claim 'sending' -> XMPP -> 'sent' | 'failed'
 *
 * Customer linking and STOP/opt-out handling live in DB triggers on sms_messages.
 * The bridge only inserts the raw message — do not duplicate that logic here.
 *
 * ── SECOND CHANNEL: the JMP/Cheogram ACCOUNT BOT (bare JID cheogram.com) ──────
 * Alongside merchant SMS, this bridge also relays the owner's READ-ONLY account
 * commands to the JMP account bot and mirrors its replies. That traffic is the
 * BARE gateway JID `cheogram.com` (no "+number@" user part) and is kept entirely
 * separate from merchant SMS:
 *   bot inbound  : a message FROM cheogram.com -> insert jmp_bot_messages
 *                  {direction:'inbound', status:'received'}   (NOT sms_messages)
 *   bot outbound : poll jmp_bot_messages status='queued' -> XMPP chat to
 *                  cheogram.com -> 'sent' | 'failed'
 * Merchant/phone traffic (from +number@cheogram.com) is untouched by this — it
 * still flows to sms_messages exactly as before.
 *
 * ── SINGLE ACCOUNT, LINE-AWARE ───────────────────────────────────────────────
 * This process holds ONE xmpp.chat session (XMPP_JID) and therefore serves ONE
 * company number — the public.sms_lines row whose `jid` equals XMPP_JID. That id
 * is resolved once at startup into MY_LINE_ID and stamped on every inbound row;
 * outbound rows already carry line_id (sms-send stamps it). Today exactly one
 * line exists, so MY_LINE_ID is the default line and the outbound pump claims the
 * whole queue.
 *
 * ┌─ TO ADD A 2ND NUMBER: ─────────────────────────────────────────────────────┐
 * │ Do NOT teach this process to hold two XMPP sessions — xmpp.chat allows one   │
 * │ session per account, and one dead account would stall the other's queue.     │
 * │ Instead run a SECOND copy of this bridge as its own systemd service with its │
 * │ own .env (its own XMPP_JID + password). Steps are in DEPLOY.md → "Adding     │
 * │ another number": text `subaccount` to the JMP bot, insert an sms_lines row    │
 * │ (with jid = the new account), drop the new creds in a second .env, start it.  │
 * │                                                                              │
 * │ THE ONE CODE CHANGE that unlocks >1 bridge: each bridge must claim ONLY its  │
 * │ own line, or two bridges race for the same queued rows and send from the     │
 * │ wrong number. Once MY_LINE_ID is guaranteed set, add `.eq("line_id",         │
 * │ MY_LINE_ID)` to all three outbound queries below:                            │
 * │   • pump()                    — the queued select AND the atomic claim        │
 * │   • requeueStuck()            — the 'sending' select                          │
 * │   • requeueOrphansAtStartup() — the 'sending' -> 'queued' update              │
 * │ Inbound needs no change: each JMP account only ever receives its own texts.  │
 * └────────────────────────────────────────────────────────────────────────────┘
 */

import "dotenv/config";
import { client, xml } from "@xmpp/client";
import { createClient } from "@supabase/supabase-js";

const {
  XMPP_JID,
  XMPP_PASSWORD,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  POLL_MS = "2000",
} = process.env;

for (const k of ["XMPP_JID", "XMPP_PASSWORD", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!process.env[k]) {
    console.error(`FATAL: missing env ${k} (see .env.example)`);
    process.exit(1);
  }
}

const TABLE = "sms_messages";
const LINES_TABLE = "sms_lines";
const BOT_TABLE = "jmp_bot_messages"; // console channel with the JMP account bot (bare JID cheogram.com)
const GATEWAY = "cheogram.com";
const STUCK_MS = 120_000; // a 'sending' row we don't hold gets re-queued after this
const [username, domain] = XMPP_JID.split("@");

const log = (...a) => console.log(new Date().toISOString(), ...a);

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// The sms_lines row this bridge serves (jid = XMPP_JID). Resolved at startup.
// Stamped on inbound rows. NULL only if the row is missing/unreadable — inbound
// still inserts (line_id null) rather than DROP a real text; the send caps and
// customer link do not depend on it. Warned about loudly at startup.
let MY_LINE_ID = null;

/** Bind this bridge to its own sms_lines row by JID. Today that row is also the
 *  default line. Never throws: a failure leaves MY_LINE_ID null and is logged. */
async function resolveMyLine() {
  const { data, error } = await db
    .from(LINES_TABLE)
    .select("id, is_default, is_active")
    .eq("jid", XMPP_JID)
    .limit(1);
  if (error) {
    log(`WARN: could not read ${LINES_TABLE} for jid ${XMPP_JID} (${error.message}); inbound line_id will be NULL until this resolves`);
    return;
  }
  const row = data?.[0];
  if (!row) {
    log(`WARN: no ${LINES_TABLE} row has jid = ${XMPP_JID}. Add one (see DEPLOY.md "Adding another number"); inbound line_id will be NULL.`);
    return;
  }
  MY_LINE_ID = row.id;
  log(`serving ${LINES_TABLE} ${MY_LINE_ID} (jid ${XMPP_JID}${row.is_default ? ", default" : ""}${row.is_active ? "" : ", INACTIVE"})`);
}

const xmpp = client({
  service: domain, // SRV lookup -> xmpp.chat's server
  domain,
  username,
  password: XMPP_PASSWORD,
  resource: "sms-bridge",
});

// +19545551234 -> +19545551234@cheogram.com
const toJid = (phone) => `${phone}@${GATEWAY}`;
// +19545551234@cheogram.com/resource -> +19545551234
const fromJid = (jid) => jid.split("/")[0].split("@")[0];

/** Normalize to E.164 or return null. Cheogram rejects anything else. */
function toE164(input) {
  const raw = String(input ?? "").trim();
  const digits = raw.replace(/\D/g, "");
  let e164;
  if (raw.startsWith("+")) e164 = `+${digits}`;
  else if (digits.length === 10) e164 = `+1${digits}`;
  else if (digits.length === 11 && digits.startsWith("1")) e164 = `+${digits}`;
  else return null;
  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null;
}

/** Pull an inbound MMS media URL out of a merchant stanza, best-effort.
 *
 *  Cheogram delivers inbound MMS media as an XEP-0066 (jabber:x:oob) URL. Some
 *  gateway paths instead put a bare HTTPS URL in the body. We capture either, and
 *  NEVER drop the message: if the shape is unexpected (an <x> oob element with no
 *  <url> child) we log loudly and return null so the text/body still inserts.
 *  Returns the URL string, or null when there is no media. */
function extractInboundMediaUrl(stanza, body) {
  const oob = stanza.getChild("x", "jabber:x:oob");
  if (oob) {
    const url = (oob.getChildText("url") || "").trim();
    if (url) return url;
    // An OOB element with no usable <url> is a shape we didn't expect — say so
    // loudly rather than silently losing an attachment. The body still inserts.
    log("WARN: inbound jabber:x:oob with no <url> child — media may be lost:", stanza.toString());
  }
  // Fallback: a gateway that ships the media as a lone HTTPS URL in the body.
  // Only treat the body as media when it is EXACTLY a single https URL, so a
  // normal text that merely mentions a link is not misfiled as an image.
  const trimmed = (body || "").trim();
  if (/^https:\/\/\S+$/i.test(trimmed)) return trimmed;
  return null;
}

// ---------- inbound ----------

xmpp.on("error", (e) => log("xmpp error:", e.message));
xmpp.on("offline", () => log("xmpp offline (will auto-reconnect)"));
xmpp.on("online", async (addr) => {
  log("xmpp online as", addr.toString());
  await xmpp.send(xml("presence"));
});

xmpp.on("stanza", async (stanza) => {
  try {
    // auto-accept contact requests from the gateway
    if (stanza.is("presence") && stanza.attrs.type === "subscribe") {
      const from = stanza.attrs.from || "";
      if (from === GATEWAY || from.endsWith(`@${GATEWAY}`)) {
        await xmpp.send(xml("presence", { to: from, type: "subscribed" }));
        await xmpp.send(xml("presence", { to: from, type: "subscribe" }));
        log("accepted subscription from", from);
      }
      return;
    }

    if (!stanza.is("message")) return;
    if (stanza.attrs.type === "error") {
      log("message error stanza:", stanza.toString());
      return;
    }

    const from = stanza.attrs.from || "";
    const body = stanza.getChildText("body") || "";
    const mediaUrl = extractInboundMediaUrl(stanza, body);

    // ── ACCOUNT BOT reply (bare JID cheogram.com, no "+number@" user part) ──────
    // This is the JMP/Cheogram ACCOUNT BOT answering a console command (info,
    // cdrs, …), NOT a merchant text. It goes to jmp_bot_messages, never
    // sms_messages, so it can never touch the customer-link / STOP triggers or
    // the merchant inbox. Merchant traffic (from +number@cheogram.com) never
    // reaches this branch and is handled below unchanged.
    if (from.split("/")[0] === GATEWAY) {
      if (!body) {
        log("gateway non-text stanza (ignored)"); // typing indicator / receipt / presence echo
        return;
      }
      const { error } = await db.from(BOT_TABLE).insert({
        direction: "inbound",
        body,
        status: "received",
      });
      // A failed insert means a real bot reply was DROPPED — never silent.
      if (error) log("BOT DB INSERT FAILED (reply lost):", error.message);
      else log("bot reply:", JSON.stringify(body));
      return;
    }
    if (!from.endsWith(`@${GATEWAY}`) && !from.includes(`@${GATEWAY}/`)) return;
    if (!body && !mediaUrl) return; // typing indicators, receipts, etc.

    const phone = fromJid(from);
    const { error } = await db.from(TABLE).insert({
      direction: "inbound",
      phone,
      body,
      media_url: mediaUrl,
      status: "received",
      line_id: MY_LINE_ID, // which company number received it; NULL only if unresolved (still inserted, never dropped)
    });
    // A failed insert means a real text was DROPPED — never let it pass silently.
    if (error) log("DB INSERT FAILED (message lost):", phone, error.message);
    else log("inbound", phone, JSON.stringify(body), mediaUrl ? `(media ${mediaUrl})` : "");

    // delivery receipt if requested
    if (stanza.getChild("request", "urn:xmpp:receipts") && stanza.attrs.id) {
      await xmpp.send(
        xml(
          "message",
          { to: from, type: "chat" },
          xml("received", { xmlns: "urn:xmpp:receipts", id: stanza.attrs.id }),
        ),
      );
    }
  } catch (e) {
    log("stanza handler error:", e.message);
  }
});

// ---------- outbound (poll Supabase) ----------

const inflight = new Set(); // ids this process has claimed and is sending right now
const seenSending = new Map(); // id -> first time we saw it stuck in 'sending'
let pumping = false;
let pollFailures = 0;

/** Anything still 'sending' when we boot was orphaned by a crash/restart. */
async function requeueOrphansAtStartup() {
  const { data, error } = await db
    .from(TABLE)
    .update({ status: "queued" })
    .eq("status", "sending")
    .select("id");
  if (error) {
    log("startup re-queue FAILED:", error.message);
    return;
  }
  if (data?.length) log(`re-queued ${data.length} orphaned 'sending' row(s) from a previous run`);
}

/** Safety net for a row stuck in 'sending' that this process does not hold. */
async function requeueStuck() {
  const { data, error } = await db
    .from(TABLE)
    .select("id")
    .eq("status", "sending")
    .limit(50);
  if (error) {
    log("stuck-scan FAILED (could not read):", error.message);
    return;
  }
  const now = Date.now();
  const live = new Set();
  for (const row of data ?? []) {
    if (inflight.has(row.id)) continue;
    live.add(row.id);
    const first = seenSending.get(row.id);
    if (first === undefined) {
      seenSending.set(row.id, now);
      continue;
    }
    if (now - first < STUCK_MS) continue;
    const { error: upErr } = await db
      .from(TABLE)
      .update({ status: "queued" })
      .eq("id", row.id)
      .eq("status", "sending");
    if (upErr) log("re-queue stuck row FAILED:", row.id, upErr.message);
    else {
      log("re-queued stuck row", row.id);
      seenSending.delete(row.id);
      live.delete(row.id);
    }
  }
  for (const id of seenSending.keys()) if (!live.has(id)) seenSending.delete(id);
}

async function markFailed(id, message) {
  const { error } = await db
    .from(TABLE)
    .update({ status: "failed", error: message })
    .eq("id", id);
  if (error) log("mark-failed FAILED:", id, error.message);
}

async function pump() {
  if (pumping || xmpp.status !== "online") return;
  pumping = true;
  try {
    await requeueStuck();

    // line_id is read here so the pump is line-aware. Today one line exists, so
    // the whole queue belongs to this bridge and there is no line filter — see
    // the "TO ADD A 2ND NUMBER" block up top for the .eq("line_id", MY_LINE_ID)
    // this needs the moment a second bridge runs.
    const { data: rows, error } = await db
      .from(TABLE)
      .select("id, phone, body, media_url, line_id")
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(10);

    // An unreadable table is NOT an empty queue. Say so, loudly and repeatedly.
    if (error) {
      pollFailures += 1;
      log(`POLL FAILED (queue UNREADABLE, ${pollFailures} in a row):`, error.message);
      if (pollFailures === 5 || pollFailures % 60 === 0) {
        log(`ALERT: ${TABLE} has been unreadable for ${pollFailures} polls — outbound SMS is DOWN`);
      }
      return;
    }
    if (pollFailures) {
      log(`poll recovered after ${pollFailures} failed attempt(s)`);
      pollFailures = 0;
    }

    for (const row of rows ?? []) {
      // claim atomically so a second bridge (or a re-entrant pump) can't double-send
      const { data: claimed, error: claimErr } = await db
        .from(TABLE)
        .update({ status: "sending" })
        .eq("id", row.id)
        .eq("status", "queued")
        .select("id")
        .maybeSingle();
      if (claimErr) {
        log("claim FAILED:", row.id, claimErr.message);
        continue;
      }
      if (!claimed) continue; // someone else took it

      inflight.add(row.id);
      try {
        const phone = toE164(row.phone);
        if (!phone) throw new Error(`phone is not E.164: ${row.phone}`);
        const body = String(row.body ?? "");
        const mediaUrl = row.media_url ? String(row.media_url).trim() : "";
        // A row must carry SOMETHING to send. A media-only row (no body) is valid;
        // an empty row with neither is not and would send a blank stanza.
        if (!body.trim() && !mediaUrl) throw new Error("empty body and no media");

        if (mediaUrl) {
          // PICTURE MESSAGE. Cheogram turns an outbound message into an MMS when
          // it carries an XEP-0066 (jabber:x:oob) URL it can fetch. The body
          // doubles as the MMS caption; when there is no caption, send the URL as
          // the body too (the conventional OOB shape, and a graceful fallback for
          // any client that ignores the oob element).
          const caption = body.trim() || mediaUrl;
          await xmpp.send(
            xml(
              "message",
              { to: toJid(phone), type: "chat", id: row.id },
              xml("body", {}, caption),
              xml("x", { xmlns: "jabber:x:oob" }, xml("url", {}, mediaUrl)),
            ),
          );
        } else {
          // TEXT-ONLY — unchanged.
          await xmpp.send(
            xml("message", { to: toJid(phone), type: "chat", id: row.id }, xml("body", {}, body)),
          );
        }

        const { error: upErr } = await db
          .from(TABLE)
          .update({ status: "sent", sent_at: new Date().toISOString() })
          .eq("id", row.id);
        if (upErr) log("mark-sent FAILED (row stays 'sending'):", row.id, upErr.message);
        else log("sent ->", phone, mediaUrl ? `(media ${mediaUrl})` : JSON.stringify(body));
      } catch (e) {
        await markFailed(row.id, e.message);
        log("send failed ->", row.phone, e.message);
      } finally {
        inflight.delete(row.id);
      }
    }
  } finally {
    pumping = false;
  }
}

// ---------- outbound: JMP account-bot commands ----------
//
// A separate, tiny pump for the console channel. It sends queued rows from
// jmp_bot_messages (written by the jmp-command edge fn) to the BARE gateway JID
// so the JMP account bot answers; the reply comes back through the inbound
// handler above. Only READ-ONLY commands ever reach this queue — the edge fn
// enforces the allowlist, the bridge just relays whatever body it was handed.

let botPumping = false; // single-flight guard (one bridge process, one interval)

async function pumpBot() {
  if (botPumping || xmpp.status !== "online") return;
  botPumping = true;
  try {
    const { data: rows, error } = await db
      .from(BOT_TABLE)
      .select("id, body, command")
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(5);

    // An unreadable queue is NOT an empty queue — log it, don't treat as idle.
    if (error) {
      log("BOT poll FAILED (queue UNREADABLE):", error.message);
      return;
    }

    for (const row of rows ?? []) {
      const body = String(row.body ?? "").trim();
      if (!body) {
        // Nothing to send — fail it so it can't spin in the queue forever.
        await db.from(BOT_TABLE).update({ status: "failed" }).eq("id", row.id).eq("status", "queued");
        continue;
      }
      // Claim by flipping queued -> sent up front so a re-entrant pump can't
      // double-send the same command to the account bot. If the XMPP send then
      // throws, downgrade to 'failed'. Re-sending a read-only command would be
      // harmless anyway, but this keeps the log honest.
      const { data: claimed, error: claimErr } = await db
        .from(BOT_TABLE)
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", row.id)
        .eq("status", "queued")
        .select("id")
        .maybeSingle();
      if (claimErr) {
        log("BOT claim FAILED:", row.id, claimErr.message);
        continue;
      }
      if (!claimed) continue; // another pass already took it

      try {
        await xmpp.send(
          xml("message", { to: GATEWAY, type: "chat", id: row.id }, xml("body", {}, body)),
        );
        log("bot command sent ->", JSON.stringify(row.command ?? body));
      } catch (e) {
        const { error: upErr } = await db
          .from(BOT_TABLE)
          .update({ status: "failed" })
          .eq("id", row.id);
        if (upErr) log("BOT mark-failed FAILED:", row.id, upErr.message);
        log("BOT send failed ->", row.command ?? body, e.message);
      }
    }
  } finally {
    botPumping = false;
  }
}

// ---------- start / stop ----------

async function main() {
  log("starting bridge for", XMPP_JID, "-> table", TABLE);

  // Fail fast and visibly if the table is missing/unreadable, rather than
  // running as a silent no-op that looks healthy in the logs.
  const { error: probeErr } = await db.from(TABLE).select("id").limit(1);
  if (probeErr) {
    console.error(`FATAL: cannot read ${TABLE}: ${probeErr.message}`);
    console.error("Check SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY and that the table exists.");
    process.exit(1);
  }
  log(`${TABLE} reachable`);

  // Resolve which line this bridge serves before we touch the queue, so inbound
  // rows get stamped from the first message on.
  await resolveMyLine();

  await requeueOrphansAtStartup();

  // Non-fatal probe of the console channel: a missing/unreadable bot table must
  // NOT take down merchant SMS, so unlike the sms_messages probe this only warns.
  const { error: botProbeErr } = await db.from(BOT_TABLE).select("id").limit(1);
  if (botProbeErr) log(`WARN: cannot read ${BOT_TABLE} (${botProbeErr.message}); JMP console relay is OFF until it resolves`);
  else log(`${BOT_TABLE} reachable`);

  setInterval(() => pump().catch((e) => log("pump error:", e.message)), Number(POLL_MS));
  setInterval(() => pumpBot().catch((e) => log("bot pump error:", e.message)), Number(POLL_MS));

  await xmpp.start();
}

let stopping = false;
async function shutdown(sig) {
  if (stopping) return;
  stopping = true;
  log(sig);
  try {
    await xmpp.stop();
  } catch (e) {
    log("stop error:", e.message);
  }
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (e) => log("unhandled rejection:", e?.message ?? String(e)));

main().catch((e) => {
  console.error("FATAL: failed to start:", e.message);
  process.exit(1);
});
