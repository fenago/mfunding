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
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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
  ShieldCheckIcon,
  PhoneArrowUpRightIcon,
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
import {
  ALL_STATUSES,
  loadSmsHealth,
  verdictInbound,
  verdictOutbound,
  type Health,
  type Tone,
  type Verdict,
} from "@/lib/smsHealth";

const SELECT =
  "id,direction,phone,body,media_url,status,error,customer_id,created_by,created_at,sent_at";

const PAGE = 100;

/** The Cheogram bot command menu the owner uses to manage / pay / add numbers.
 *  `subaccount` (add a new number) is the one that matters for this runbook. */
const BOT_COMMANDS: { cmd: string; desc: string; highlight?: boolean }[] = [
  { cmd: "info", desc: "Show account info" },
  { cmd: "cdrs", desc: "Call logs" },
  { cmd: "transactions", desc: "Show transactions" },
  { cmd: "configure calls", desc: "Call routing settings" },
  { cmd: "ogm", desc: "Record voicemail greeting" },
  { cmd: "credit cards", desc: "Card settings" },
  { cmd: "top up", desc: "Buy credit by card" },
  { cmd: "alt top up", desc: "Bitcoin / Mail / Interac" },
  { cmd: "plan settings", desc: "Manage plan / overage" },
  { cmd: "referral codes", desc: "Referral codes" },
  { cmd: "sims", desc: "(e)SIM details" },
  {
    cmd: "subaccount",
    desc: "Create a new phone number linked to this balance",
    highlight: true,
  },
  { cmd: "reset sip account", desc: "Reset SIP account" },
  { cmd: "lnp", desc: "Port in a number" },
  { cmd: "set-port-out-pin", desc: "Set port-out PIN" },
  { cmd: "change jabber id", desc: "Change Jabber ID" },
  { cmd: "register", desc: "Register" },
];

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

  // ── Re-enable a number (admin override to lift a suppression) ──
  const [unsupPhone, setUnsupPhone] = useState("");
  const [unsupBusy, setUnsupBusy] = useState(false);
  const [unsupMsg, setUnsupMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // ── Health ────────────────────────────────────────────────────────────────
  const loadHealth = useCallback(async () => {
    setHealthLoading(true);
    // Verdict logic + thresholds live in @/lib/smsHealth so this page and the
    // System Health page render the same answer from the same reads.
    setHealth(await loadSmsHealth(supabase));
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

  // Super-admin override: lift a suppression so the number can be texted again.
  // Calls the SECURITY DEFINER RPC (which itself enforces super_admin), then
  // refreshes the audit so the change is visible immediately.
  const unsuppress = useCallback(async () => {
    const phone = unsupPhone.trim();
    if (!phone) return;
    setUnsupBusy(true);
    setUnsupMsg(null);
    const { data, error } = await supabase.rpc("sms_admin_unsuppress", { p_phone: phone });
    setUnsupBusy(false);
    if (error) {
      setUnsupMsg({ ok: false, text: error.message });
      return;
    }
    const d = (data ?? {}) as { phone: string; optout_deleted: number; customers_cleared: number };
    setUnsupMsg({
      ok: true,
      text: `${prettyPhone(d.phone)} can be texted again — removed ${d.optout_deleted} suppression row(s) and cleared do_not_contact on ${d.customers_cleared} customer(s).`,
    });
    setUnsupPhone("");
    void loadOptOuts();
  }, [unsupPhone, loadOptOuts]);

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

      {/* ── TCPA guardrails (what the system actually enforces) ── */}
      <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <h2 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <ShieldCheckIcon className="w-5 h-5 text-mint-green" /> TCPA guardrails
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 mb-4">
          Every control the send path <strong>actually enforces</strong> — read from the{" "}
          <code>sms-send</code> edge function and the SMS migrations, not a wish-list. The theme
          throughout: <strong>an unreadable check refuses</strong>, it never passes.
        </p>

        <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
          <Guard label="Inbound opt-out → auto-suppress">
            An inbound <strong>STOP / STOPALL / UNSUBSCRIBE / CANCEL / QUIT / END / OPTOUT</strong>{" "}
            (whole message), a leading <strong>STOP/UNSUBSCRIBE/OPTOUT/REMOVE</strong>, or a phrase
            like “remove me”, “take me off”, “do not text”, “stop texting” trips a DB trigger that
            writes <code>sms_opt_outs</code> for the number{" "}
            <strong>whether or not it matches a customer</strong>, and additionally flips{" "}
            <code>customers.do_not_contact</code> + logs to <code>activity_log</code> when it does.
            The trigger <strong>does not swallow errors</strong> — a failed opt-out fails the insert
            so the bridge retries.{" "}
            <span className="text-gray-500 dark:text-gray-400">
              (Word-boundary matching on purpose: “Stopped by your office” and “End of month…” do{" "}
              <strong>not</strong> misfire.)
            </span>
          </Guard>

          <Guard label="Send-time suppression gate — checks BOTH lists, fails closed">
            Every send calls <code>sms_suppression_check()</code>, which consults{" "}
            <strong>both</strong> <code>sms_opt_outs</code> (phone-level, the only record for the
            purchased/UCC book) <strong>and</strong> <code>customers.do_not_contact</code>{" "}
            (person-level) across the <strong>primary phone AND every additional_phones entry</strong>
            , all in canonical E.164. An unparseable number <strong>raises</strong> rather than
            reporting “clear”; any read error <strong>refuses the send</strong>. GHL contact DND is
            also read per send and refuses on an unreadable answer (a genuinely deleted contact is
            the only “no record, proceed” case).
          </Guard>

          <Guard label="Rate caps — five scopes, each fails closed">
            <span className="flex flex-wrap gap-1.5 mt-1">
              <Cap>this number: 4 / 5 min</Cap>
              <Cap>you: 8 / min</Cap>
              <Cap>you: 60 / hour</Cap>
              <Cap>the line: 30 / hour</Cap>
              <Cap>the line: 200 / day</Cap>
            </span>
            <span className="block mt-1.5">
              Counted by rows over <code>created_at</code>; an <strong>uncountable</strong> cap is
              treated as over-limit and refuses. A row-immutability trigger freezes{" "}
              <code>created_at/direction/phone/body/created_by</code> so the caps can't be silently
              defeated by rewriting history.
            </span>
          </Guard>

          <Guard label="One message per call · no bulk">
            The function accepts <strong>a single message</strong> — there is deliberately no array
            form and no loop. It is a consumer line; a blast gets it carrier-filtered.
          </Guard>

          <Guard label="MCA compliance + valid destination">
            A body containing the word <strong>“loan”</strong> is refused (an MCA is a purchase of
            future receivables). Destinations must be a valid <strong>NANP E.164</strong> number;
            structurally impossible / non-US-Canada numbers are rejected before anything is queued.
          </Guard>

          <Guard label="Auth — a real staff session only">
            <code>verify_jwt</code> plus an in-code role check (
            <code>closer / employee / admin / super_admin</code>). A <code>service_role</code> bearer
            is <strong>rejected</strong> — nothing automated can text a merchant from this line.
          </Guard>

          <Guard label="The ONLY automatic unlock: an inbound START">
            SMS suppression lifts on its own <strong>only</strong> when the merchant texts an exact{" "}
            <strong>START / UNSTOP / YES</strong>. That clears <code>do_not_contact</code>{" "}
            <strong>only if</strong> the reason was our own SMS STOP — a manual DND, merge, or
            litigation flag stays put. Opt-in matching is exact on purpose; a loose match would
            resurrect someone who asked us to stop.
          </Guard>

          <Guard label="The ONLY manual unlock: the super-admin override below">
            The <strong>“Re-enable texting”</strong> control on this page is the sole manual path. It
            is <strong>super-admin only</strong> (enforced inside the RPC), clears{" "}
            <strong>both</strong> stores the gate checks, and is <strong>written to the audit
            trail</strong> in <code>activity_log</code>.
          </Guard>
        </div>
      </section>

      {/* ── Adding another phone number (runbook) ── */}
      <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <h2 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <PhoneArrowUpRightIcon className="w-5 h-5 text-ocean-blue" /> Adding another phone number
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 mb-4">
          The line runs on <strong>JMP.chat</strong> (the SMS service) managed through{" "}
          <strong>Cheogram</strong> (the XMPP client / gateway bot). Numbers are added by texting the
          Cheogram bot, then registered here as a new <code>sms_lines</code> row.
        </p>

        <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm mb-4">
          <RefItem label="Account JID" value={JMP_ACCOUNT.jid} />
          <RefItem label="Current number" value={JMP_ACCOUNT.number} />
          <RefItem label="Client / gateway" value="Cheogram" />
          <div>
            <dt className="text-xs text-gray-400 uppercase tracking-wide">Support</dt>
            <dd className="mt-0.5 font-mono text-gray-900 dark:text-white break-all">
              xmpp:+14169938000@cheogram.com
            </dd>
          </div>
        </dl>

        <p className="text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 mb-4">
          <strong>Credentials are not shown here.</strong> The JMP/XMPP login and bridge secrets live
          in the droplet’s <code>.env</code> and the Supabase vault — read them there, never paste
          them into a page or a message.
        </p>

        <div className="mb-4">
          <h3 className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-2">
            Cheogram bot commands (text these to the bot to manage the account)
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
            {BOT_COMMANDS.map((c) => (
              <div key={c.cmd} className="flex gap-2">
                <code
                  className={`shrink-0 px-1.5 py-0.5 rounded text-[12px] ${
                    c.highlight
                      ? "bg-mint-green/20 text-emerald-700 dark:text-emerald-300 font-bold"
                      : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200"
                  }`}
                >
                  {c.cmd}
                </code>
                <span
                  className={
                    c.highlight
                      ? "text-gray-900 dark:text-white font-semibold"
                      : "text-gray-600 dark:text-gray-300"
                  }
                >
                  {c.desc}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-2">
            End-to-end: add a number
          </h3>
          <ol className="list-decimal list-inside space-y-1.5 text-sm text-gray-700 dark:text-gray-300">
            <li>
              Text <code>subaccount</code> to the JMP bot to{" "}
              <strong>create a new number linked to this balance</strong>, and provision it.
            </li>
            <li>
              A super-admin adds an <code>sms_lines</code> row — <strong>label + phone + jid</strong>{" "}
              (and mark <code>is_default</code> if it should be the primary send-from).
            </li>
            <li>
              Put the new number’s credentials on the droplet’s <code>.env</code>.
            </li>
            <li>
              <strong>Restart the bridge</strong> so it holds the new XMPP session.
            </li>
            <li>
              It then appears as a <strong>selectable line</strong> in the inbox compose row —
              no code change.
            </li>
          </ol>
          <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
            Status page:{" "}
            <a
              href={JMP_ACCOUNT.statusUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-mono text-ocean-blue hover:underline"
            >
              status.jmp.chat <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" />
            </a>
          </p>
        </div>
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

        {/* Super-admin override — re-enable texting for a number */}
        <div className="p-4 border-b border-gray-100 dark:border-gray-700 bg-amber-50/60 dark:bg-amber-900/10">
          <label className="block text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400 mb-1">
            Super-admin override — re-enable texting
          </label>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 max-w-2xl">
            Lifts the suppression and clears <code>do_not_contact</code> for a number. Use only when
            the merchant re-consents or to undo a false STOP — this overrides a TCPA opt-out, so it's
            super-admin only and written to the audit trail.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={unsupPhone}
              onChange={(e) => setUnsupPhone(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void unsuppress();
              }}
              placeholder="(305) 555-1234"
              className="input-field w-56 font-mono text-sm"
            />
            <button
              onClick={() => void unsuppress()}
              disabled={unsupBusy || !unsupPhone.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-mint-green text-white text-sm font-semibold disabled:opacity-50"
            >
              <CheckCircleIcon className="w-4 h-4" /> {unsupBusy ? "Re-enabling…" : "Re-enable"}
            </button>
          </div>
          {unsupMsg && (
            <p
              className={`text-xs mt-2 ${
                unsupMsg.ok
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-600 dark:text-red-400"
              }`}
            >
              {unsupMsg.text}
            </p>
          )}
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

// ── Verdict styling (verdict logic itself lives in @/lib/smsHealth) ──────────

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

function Guard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-100 dark:border-gray-700 p-3">
      <p className="flex items-start gap-2 font-semibold text-gray-900 dark:text-white">
        <CheckCircleIcon className="w-4 h-4 shrink-0 mt-0.5 text-mint-green" /> {label}
      </p>
      <div className="mt-1 pl-6 text-sm text-gray-600 dark:text-gray-300">{children}</div>
    </div>
  );
}

function Cap({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200">
      {children}
    </span>
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
