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
const GATEWAY = "cheogram.com";
const STUCK_MS = 120_000; // a 'sending' row we don't hold gets re-queued after this
const [username, domain] = XMPP_JID.split("@");

const log = (...a) => console.log(new Date().toISOString(), ...a);

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

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
    const oob = stanza.getChild("x", "jabber:x:oob");
    const mediaUrl = oob ? oob.getChildText("url") : null;

    // system messages from the gateway itself (no "+number@")
    if (from.split("/")[0] === GATEWAY) {
      log("gateway message:", body);
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

    const { data: rows, error } = await db
      .from(TABLE)
      .select("id, phone, body")
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
        if (!body.trim()) throw new Error("empty body");

        await xmpp.send(
          xml("message", { to: toJid(phone), type: "chat", id: row.id }, xml("body", {}, body)),
        );

        const { error: upErr } = await db
          .from(TABLE)
          .update({ status: "sent", sent_at: new Date().toISOString() })
          .eq("id", row.id);
        if (upErr) log("mark-sent FAILED (row stays 'sending'):", row.id, upErr.message);
        else log("sent ->", phone, JSON.stringify(body));
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

  await requeueOrphansAtStartup();

  setInterval(() => pump().catch((e) => log("pump error:", e.message)), Number(POLL_MS));

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
