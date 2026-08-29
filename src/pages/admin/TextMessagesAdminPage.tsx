// Text Message Administration — the ops view behind the SMS line (super-admin).
//
// The inbox at /admin/text-messages is where the work happens. THIS page answers
// the only question that matters when texting stops working: is the bridge up?
// The line is a JMP.chat number bridged over XMPP by a droplet — when that
// droplet dies there is no error anywhere, just silence. So the health block
// reads two signals that go stale on their own:
//   · last INBOUND  — nothing arriving for a day on a line that normally hears
//                     from merchants means the receive path is dead.
//   · stuck OUTBOUND — anything sitting in queued/sending for minutes means the
//                     send path is dead. `sent` rows never get stuck.
//
// UNREADABLE ≠ HEALTHY: every read that fails renders as an explicit "couldn't
// read" state, never as a zero or a green tick.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Cog6ToothIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  QuestionMarkCircleIcon,
  ArrowTopRightOnSquareIcon,
  NoSymbolIcon,
  ChatBubbleLeftRightIcon,
} from "@heroicons/react/24/outline";
import supabase from "@/supabase";
import {
  isOptOut,
  prettyPhone,
  JMP_ACCOUNT,
  STATUS_CHIP,
  STATUS_LABEL,
  type SmsDirection,
  type SmsMessage,
  type SmsStatus,
} from "@/lib/sms";

const SELECT =
  "id,direction,phone,body,media_url,status,error,customer_id,created_by,created_at,sent_at";

const ALL_STATUSES: SmsStatus[] = ["received", "queued", "sending", "sent", "failed"];
/** Outbound sitting this long without leaving is a stuck queue, not slowness. */
const STUCK_MINUTES = 5;
/** No inbound for this long on a live consumer line is worth flagging. */
const QUIET_HOURS = 24;
const PAGE = 100;

/** A number we tried to read. `value: undefined` means the read FAILED — which
 *  must never render as 0. */
interface Reading<T> {
  value: T | undefined;
  error: string | null;
}

interface Health {
  counts: Record<SmsStatus, Reading<number>>;
  lastInbound: Reading<string | null>;
  lastOutbound: Reading<string | null>;
  oldestPending: Reading<string | null>;
}

export default function TextMessagesAdminPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);

  // ── Log filters ──
  const [fStatus, setFStatus] = useState<"" | SmsStatus>("");
  const [fDirection, setFDirection] = useState<"" | SmsDirection>("");
  const [fPhone, setFPhone] = useState("");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const [rows, setRows] = useState<SmsMessage[]>([]);
  const [logError, setLogError] = useState<string | null>(null);
  const [logLoading, setLogLoading] = useState(true);
  const [limit, setLimit] = useState(PAGE);

  // ── Opt-out audit ──
  const [optOuts, setOptOuts] = useState<SmsMessage[]>([]);
  const [dncFlags, setDncFlags] = useState<Record<string, boolean>>({});
  const [optOutError, setOptOutError] = useState<string | null>(null);
  const [optOutLoading, setOptOutLoading] = useState(true);

  // ── Health ────────────────────────────────────────────────────────────────
  const loadHealth = useCallback(async () => {
    setHealthLoading(true);
    const counts = {} as Record<SmsStatus, Reading<number>>;
    await Promise.all(
      ALL_STATUSES.map(async (s) => {
        const { count, error } = await supabase
          .from("sms_messages")
          .select("id", { count: "exact", head: true })
          .eq("status", s);
        counts[s] = { value: error ? undefined : (count ?? 0), error: error?.message ?? null };
      }),
    );

    const newest = async (direction: SmsDirection): Promise<Reading<string | null>> => {
      const { data, error } = await supabase
        .from("sms_messages")
        .select("created_at")
        .eq("direction", direction)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) return { value: undefined, error: error.message };
      return { value: data?.[0]?.created_at ?? null, error: null };
    };

    const oldestPending = await (async (): Promise<Reading<string | null>> => {
      const { data, error } = await supabase
        .from("sms_messages")
        .select("created_at")
        .in("status", ["queued", "sending"])
        .order("created_at", { ascending: true })
        .limit(1);
      if (error) return { value: undefined, error: error.message };
      return { value: data?.[0]?.created_at ?? null, error: null };
    })();

    const [lastInbound, lastOutbound] = await Promise.all([newest("inbound"), newest("outbound")]);
    setHealth({ counts, lastInbound, lastOutbound, oldestPending });
    setHealthLoading(false);
  }, []);

  // ── Log ───────────────────────────────────────────────────────────────────
  const loadLog = useCallback(async () => {
    setLogLoading(true);
    let q = supabase.from("sms_messages").select(SELECT).order("created_at", { ascending: false });
    if (fStatus) q = q.eq("status", fStatus);
    if (fDirection) q = q.eq("direction", fDirection);
    if (fPhone.trim()) {
      const digits = fPhone.replace(/\D/g, "");
      q = q.ilike("phone", `%${digits || fPhone.trim()}%`);
    }
    if (fFrom) q = q.gte("created_at", new Date(`${fFrom}T00:00:00`).toISOString());
    if (fTo) q = q.lte("created_at", new Date(`${fTo}T23:59:59`).toISOString());
    const { data, error } = await q.limit(limit);
    if (error) {
      setLogError(error.message);
      setLogLoading(false);
      return;
    }
    setLogError(null);
    setRows((data ?? []) as SmsMessage[]);
    setLogLoading(false);
  }, [fStatus, fDirection, fPhone, fFrom, fTo, limit]);

  // ── Opt-outs ──────────────────────────────────────────────────────────────
  const loadOptOuts = useCallback(async () => {
    setOptOutLoading(true);
    // STOP can't be matched reliably in SQL (it's a leading keyword in free
    // text), so pull recent inbound and classify here.
    const { data, error } = await supabase
      .from("sms_messages")
      .select(SELECT)
      .eq("direction", "inbound")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      setOptOutError(error.message);
      setOptOutLoading(false);
      return;
    }
    setOptOutError(null);
    const stops = ((data ?? []) as SmsMessage[]).filter((m) => isOptOut(m.body));
    setOptOuts(stops);
    // Did each STOP actually land as a do_not_contact flip? That's the audit.
    const ids = [...new Set(stops.map((m) => m.customer_id).filter(Boolean))] as string[];
    if (ids.length) {
      const { data: cust } = await supabase
        .from("customers")
        .select("id,do_not_contact")
        .in("id", ids);
      const flags: Record<string, boolean> = {};
      for (const c of cust ?? []) flags[c.id as string] = !!c.do_not_contact;
      setDncFlags(flags);
    } else {
      setDncFlags({});
    }
    setOptOutLoading(false);
  }, []);

  const reloadAll = useCallback(() => {
    void loadHealth();
    void loadLog();
    void loadOptOuts();
  }, [loadHealth, loadLog, loadOptOuts]);

  useEffect(() => {
    void loadHealth();
    void loadOptOuts();
  }, [loadHealth, loadOptOuts]);
  useEffect(() => {
    void loadLog();
  }, [loadLog]);

  // ── Verdicts ──────────────────────────────────────────────────────────────
  const inboundVerdict = useMemo(() => verdictInbound(health), [health]);
  const outboundVerdict = useMemo(() => verdictOutbound(health), [health]);

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Cog6ToothIcon className="w-6 h-6 text-mint-green" /> Text Message Administration
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Bridge health, the full message log, and the opt-out audit for the company SMS line.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/admin/text-messages"
            className="inline-flex items-center gap-2 text-sm text-ocean-blue hover:underline"
          >
            <ChatBubbleLeftRightIcon className="w-4 h-4" /> Open the inbox
          </Link>
          <button
            onClick={reloadAll}
            className="inline-flex items-center gap-2 text-sm text-ocean-blue hover:underline"
          >
            <ArrowPathIcon className="w-4 h-4" /> Refresh
          </button>
        </div>
      </div>

      {/* ── Bridge health ── */}
      <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <h2 className="font-bold text-gray-900 dark:text-white mb-1">Bridge health</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          The XMPP bridge fails silently. These two verdicts are the alarm: no inbound for a day
          means the receive path is dead; outbound stuck in <code>queued</code>/<code>sending</code>{" "}
          means the send path is dead.
        </p>

        {healthLoading && !health ? (
          <p className="text-sm text-gray-400">Checking the bridge…</p>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
              <VerdictCard title="Receiving (inbound)" v={inboundVerdict} />
              <VerdictCard title="Sending (outbound)" v={outboundVerdict} />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {ALL_STATUSES.map((s) => (
                <div
                  key={s}
                  className="rounded-lg border border-gray-100 dark:border-gray-700 p-3 text-center"
                >
                  <span
                    className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS_CHIP[s]}`}
                  >
                    {STATUS_LABEL[s]}
                  </span>
                  <div
                    className={`mt-1.5 text-2xl font-bold ${
                      health?.counts[s]?.value === undefined
                        ? "text-gray-400"
                        : s === "failed" && (health?.counts[s]?.value ?? 0) > 0
                          ? "text-red-600 dark:text-red-400"
                          : "text-gray-900 dark:text-white"
                    }`}
                    title={health?.counts[s]?.error ?? undefined}
                  >
                    {health?.counts[s]?.value === undefined ? "—" : health.counts[s].value}
                  </div>
                  {health?.counts[s]?.error && (
                    <p className="text-[10px] text-red-500 mt-0.5">couldn't read</p>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* ── JMP account reference ── */}
      <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <h2 className="font-bold text-gray-900 dark:text-white mb-3">JMP account</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
          <RefItem label="Number" value={JMP_ACCOUNT.number} />
          <RefItem label="JID" value={JMP_ACCOUNT.jid} />
          <RefItem label="Gateway" value={JMP_ACCOUNT.gateway} />
          <div>
            <dt className="text-xs text-gray-400 uppercase tracking-wide">Status page</dt>
            <dd className="mt-0.5">
              <a
                href={JMP_ACCOUNT.statusUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-mono text-ocean-blue hover:underline"
              >
                status.jmp.chat <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" />
              </a>
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
          <strong>Compliance — this is a consumer line.</strong> Conversational and support texting
          only: replies to merchants we're already working with. <u>No bulk sending.</u> Blasting
          this number gets it carrier-filtered within hours and puts us back on an A2P registration
          we don't have. Bulk outreach stays on the registered channels.
        </p>
      </section>

      {/* ── Opt-out audit ── */}
      <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="p-4 border-b border-gray-100 dark:border-gray-700">
          <h2 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <NoSymbolIcon className="w-5 h-5 text-red-500" /> Opt-out audit
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Inbound STOP/UNSUBSCRIBE keywords in the last 500 received messages, and whether the
            linked merchant actually got flipped to <code>do_not_contact</code>. A STOP with no flip
            is a compliance hole — fix it on the customer record.
          </p>
        </div>
        {optOutError ? (
          <ReadFailed message={optOutError} what="opt-outs" />
        ) : optOutLoading ? (
          <p className="text-sm text-gray-400 p-6">Scanning inbound messages…</p>
        ) : optOuts.length === 0 ? (
          <div className="p-6 flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
            <CheckCircleIcon className="w-5 h-5" /> No opt-out keywords in recent inbound messages.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-100 dark:border-gray-700">
                  <th className="py-3 px-4">When</th>
                  <th className="py-3 px-4">From</th>
                  <th className="py-3 px-4">Message</th>
                  <th className="py-3 px-4">Merchant flagged?</th>
                </tr>
              </thead>
              <tbody>
                {optOuts.map((m) => {
                  const flagged = m.customer_id ? dncFlags[m.customer_id] : undefined;
                  return (
                    <tr key={m.id} className="border-b border-gray-50 dark:border-gray-800">
                      <td className="py-2.5 px-4 text-xs text-gray-400 whitespace-nowrap">
                        {new Date(m.created_at).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-xs">{prettyPhone(m.phone)}</td>
                      <td className="py-2.5 px-4 text-xs text-gray-600 dark:text-gray-300">
                        {m.body}
                      </td>
                      <td className="py-2.5 px-4 text-xs">
                        {!m.customer_id ? (
                          <span className="text-gray-400">
                            not linked to a customer — can't be flagged
                          </span>
                        ) : flagged ? (
                          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold">
                            <CheckCircleIcon className="w-4 h-4" /> do_not_contact ✓
                          </span>
                        ) : (
                          <Link
                            to={`/admin/customers/${m.customer_id}`}
                            className="inline-flex items-center gap-1 text-red-600 dark:text-red-400 font-semibold hover:underline"
                          >
                            <ExclamationTriangleIcon className="w-4 h-4" /> NOT flagged — open
                            record
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Full log ── */}
      <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="p-4 border-b border-gray-100 dark:border-gray-700">
          <h2 className="font-bold text-gray-900 dark:text-white">Message log</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <select
              value={fStatus}
              onChange={(e) => {
                setLimit(PAGE);
                setFStatus(e.target.value as "" | SmsStatus);
              }}
              className="text-sm px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            >
              <option value="">All statuses</option>
              {ALL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              value={fDirection}
              onChange={(e) => {
                setLimit(PAGE);
                setFDirection(e.target.value as "" | SmsDirection);
              }}
              className="text-sm px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            >
              <option value="">Both directions</option>
              <option value="inbound">Inbound</option>
              <option value="outbound">Outbound</option>
            </select>
            <input
              value={fPhone}
              onChange={(e) => {
                setLimit(PAGE);
                setFPhone(e.target.value);
              }}
              placeholder="Phone contains…"
              className="text-sm px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            />
            <input
              type="date"
              value={fFrom}
              onChange={(e) => {
                setLimit(PAGE);
                setFFrom(e.target.value);
              }}
              className="text-sm px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            />
            <input
              type="date"
              value={fTo}
              onChange={(e) => {
                setLimit(PAGE);
                setFTo(e.target.value);
              }}
              className="text-sm px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            />
            {(fStatus || fDirection || fPhone || fFrom || fTo) && (
              <button
                onClick={() => {
                  setFStatus("");
                  setFDirection("");
                  setFPhone("");
                  setFFrom("");
                  setFTo("");
                  setLimit(PAGE);
                }}
                className="text-sm text-ocean-blue hover:underline"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {logError ? (
          <ReadFailed message={logError} what="the message log" />
        ) : logLoading && rows.length === 0 ? (
          <p className="text-sm text-gray-400 p-6">Loading messages…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-gray-400 p-6">No messages match these filters.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-400 border-b border-gray-100 dark:border-gray-700">
                    <th className="py-3 px-4">When</th>
                    <th className="py-3 px-4">Dir</th>
                    <th className="py-3 px-4">Phone</th>
                    <th className="py-3 px-4">Message</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Sent at</th>
                    <th className="py-3 px-4">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((m) => (
                    <tr key={m.id} className="border-b border-gray-50 dark:border-gray-800 align-top">
                      <td className="py-2.5 px-4 text-xs text-gray-400 whitespace-nowrap">
                        {new Date(m.created_at).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-4 text-xs">
                        {m.direction === "inbound" ? "← in" : "→ out"}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-xs whitespace-nowrap">
                        {prettyPhone(m.phone)}
                      </td>
                      <td className="py-2.5 px-4 text-xs text-gray-600 dark:text-gray-300 max-w-md">
                        <span className="line-clamp-3 whitespace-pre-wrap">{m.body}</span>
                        {m.media_url && (
                          <a
                            href={m.media_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-ocean-blue hover:underline"
                          >
                            attachment
                          </a>
                        )}
                      </td>
                      <td className="py-2.5 px-4">
                        <span
                          className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS_CHIP[m.status]}`}
                        >
                          {STATUS_LABEL[m.status]}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-xs text-gray-400 whitespace-nowrap">
                        {m.sent_at ? new Date(m.sent_at).toLocaleString() : "—"}
                      </td>
                      <td className="py-2.5 px-4 text-xs text-red-600 dark:text-red-400 max-w-xs">
                        {m.error || ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length >= limit && (
              <div className="p-4 border-t border-gray-100 dark:border-gray-700 text-center">
                <button
                  onClick={() => setLimit((l) => l + PAGE)}
                  disabled={logLoading}
                  className="text-sm font-semibold px-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white hover:opacity-90 disabled:opacity-50"
                >
                  {logLoading ? "Loading…" : `Load ${PAGE} more`}
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

// ── Verdict plumbing ────────────────────────────────────────────────────────

type Tone = "ok" | "warn" | "bad" | "unknown";
interface Verdict {
  tone: Tone;
  headline: string;
  detail: string;
}

function hoursSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

function verdictInbound(h: Health | null): Verdict {
  if (!h) return { tone: "unknown", headline: "Not checked yet", detail: "" };
  if (h.lastInbound.error)
    return {
      tone: "unknown",
      headline: "Couldn't read the inbound log",
      detail: `This is NOT a healthy verdict — the check itself failed. ${h.lastInbound.error}`,
    };
  const last = h.lastInbound.value;
  if (!last)
    return {
      tone: "unknown",
      headline: "No inbound message has ever been recorded",
      detail:
        "Either nobody has texted the line yet, or the bridge has never successfully delivered a message inbound. Send a test text to the number.",
    };
  const hrs = hoursSince(last);
  const when = new Date(last).toLocaleString();
  if (hrs > QUIET_HOURS)
    return {
      tone: "warn",
      headline: `No inbound for ${Math.floor(hrs)}h`,
      detail: `Last received message was ${when}. On a live line that usually means the droplet bridge is down — check ${JMP_ACCOUNT.statusUrl} and the bridge process.`,
    };
  return { tone: "ok", headline: `Last inbound ${Math.round(hrs * 60)} min ago`, detail: when };
}

function verdictOutbound(h: Health | null): Verdict {
  if (!h) return { tone: "unknown", headline: "Not checked yet", detail: "" };
  if (h.oldestPending.error || h.lastOutbound.error)
    return {
      tone: "unknown",
      headline: "Couldn't read the outbound queue",
      detail: `This is NOT a healthy verdict — the check itself failed. ${h.oldestPending.error ?? h.lastOutbound.error}`,
    };
  const pending = h.oldestPending.value;
  if (pending) {
    const mins = (Date.now() - new Date(pending).getTime()) / 60_000;
    if (mins > STUCK_MINUTES)
      return {
        tone: "bad",
        headline: `Queue stuck — oldest unsent message is ${Math.floor(mins)} min old`,
        detail:
          "Messages are being accepted but never leaving. The send side of the bridge is down; nothing queued has reached a merchant.",
      };
    return {
      tone: "ok",
      headline: "Sending normally",
      detail: `${Math.round(mins)} min in the queue — within the normal window.`,
    };
  }
  const last = h.lastOutbound.value;
  if (!last)
    return {
      tone: "unknown",
      headline: "Nothing has ever been sent from this line",
      detail: "No outbound message on record yet.",
    };
  const failed = h.counts.failed.value ?? 0;
  return {
    tone: failed > 0 ? "warn" : "ok",
    headline: failed > 0 ? `Queue clear, but ${failed} message(s) have failed` : "Queue clear",
    detail: `Last outbound ${new Date(last).toLocaleString()}.${failed > 0 ? " Filter the log by status = failed to see why." : ""}`,
  };
}

const TONE_STYLE: Record<Tone, { box: string; icon: typeof CheckCircleIcon; color: string }> = {
  ok: {
    box: "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20",
    icon: CheckCircleIcon,
    color: "text-emerald-600 dark:text-emerald-400",
  },
  warn: {
    box: "border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20",
    icon: ExclamationTriangleIcon,
    color: "text-amber-600 dark:text-amber-400",
  },
  bad: {
    box: "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20",
    icon: ExclamationTriangleIcon,
    color: "text-red-600 dark:text-red-400",
  },
  unknown: {
    box: "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40",
    icon: QuestionMarkCircleIcon,
    color: "text-gray-500 dark:text-gray-400",
  },
};

function VerdictCard({ title, v }: { title: string; v: Verdict }) {
  const s = TONE_STYLE[v.tone];
  const Icon = s.icon;
  return (
    <div className={`rounded-lg border p-3 ${s.box}`}>
      <p className="text-xs uppercase tracking-wide text-gray-400 mb-1">{title}</p>
      <p className={`flex items-start gap-2 font-semibold text-sm ${s.color}`}>
        <Icon className="w-5 h-5 shrink-0" /> {v.headline}
      </p>
      {v.detail && <p className="mt-1 text-xs text-gray-600 dark:text-gray-400 pl-7">{v.detail}</p>}
    </div>
  );
}

function RefItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-gray-400 uppercase tracking-wide">{label}</dt>
      <dd className="mt-0.5 font-mono text-gray-900 dark:text-white">{value}</dd>
    </div>
  );
}

function ReadFailed({ message, what }: { message: string; what: string }) {
  return (
    <div className="p-6 flex items-start gap-2 text-sm text-red-700 dark:text-red-300">
      <ExclamationTriangleIcon className="w-5 h-5 shrink-0" />
      <div>
        <strong>Couldn't read {what}.</strong> This is a failed read, not an empty result.
        <span className="block text-xs mt-0.5 opacity-80">{message}</span>
      </div>
    </div>
  );
}
