import { useEffect, useState, type ReactNode } from "react";
import supabase from "@/supabase";
import {
  EnvelopeIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  ChevronDownIcon,
} from "@heroicons/react/24/outline";

// ── Live Instantly data ──────────────────────────────────────────────────────
interface InstantlyAccount {
  email?: string;
  status?: number | string;
  warmup_status?: number | string;
  warmup_score?: number;
  stat_warmup_score?: number;
  daily_limit?: number;
  setup_pending?: boolean;
  [k: string]: unknown;
}
interface InstantlyCampaign {
  id?: string;
  name?: string;
  status?: number | string;
  [k: string]: unknown;
}
interface Overview {
  key_present?: boolean;
  accounts: InstantlyAccount[];
  campaigns: InstantlyCampaign[];
  errors?: { accounts: string | null; campaigns: string | null };
}

const ACCOUNT_STATUS: Record<string, string> = { "1": "Active", "2": "Paused", "-1": "Error", "-2": "Suspended", "0": "Setup pending" };
const WARMUP_STATUS: Record<string, string> = { "0": "Paused", "1": "Active", "-1": "Error" };
const CAMPAIGN_STATUS: Record<string, string> = { "0": "Draft", "1": "Active", "2": "Paused", "3": "Completed", "4": "Running (subseq.)" };

function label(map: Record<string, string>, v: unknown): string {
  if (v === undefined || v === null) return "—";
  return map[String(v)] ?? String(v);
}

// Step-by-step runbook for standing up a new sending domain (from our Instantly playbook).
const STEPS: { title: string; body: ReactNode }[] = [
  {
    title: "Pick the sending domain (never our main domain)",
    body: (
      <>
        <p>Use a <b>throwaway secondary domain</b> for cold email — e.g. <code>getmfunding.com</code>, <code>trymfunding.com</code>, <code>mfunding-team.com</code>. <b>Never send from mfunding.net</b> — if a sending domain lands in spam, our real domain's reputation must stay clean.</p>
        <p>Keep names close to the brand but clearly secondary. One new domain = up to 5 mailboxes.</p>
      </>
    ),
  },
  {
    title: "Buy it — DFY (fast) or own it (recommended)",
    body: (
      <>
        <p><b>Option A — Own it (recommended):</b> register the domain at Cloudflare/Namecheap (~$12/yr) + buy <b>Google Workspace</b> direct (~$7/mailbox/mo), <i>or</i> use a pre-warmed provider (Zapmail / InboxKit, ~$3/inbox, real Google inboxes). Then in Instantly use <b>Connect existing accounts → Google</b>. You own everything and keep it if we ever leave Instantly.</p>
        <p><b>Option B — DFY in Instantly:</b> Instantly buys the domain + Google mailboxes for you (~$5–8/mailbox + ~$15/domain). Zero setup, but the domain is <b>rented — you don't own it</b> and can't take it with you. Fine for speed; not for anything you'd reuse.</p>
      </>
    ),
  },
  {
    title: "Set the Forwarding Domain → mfunding.net",
    body: (
      <p>In the setup screen, set <b>Forwarding Domain</b> to our real live site (<code>mfunding.net</code>), <b>not</b> the sending domain. This redirects anyone who visits the sending domain to the real site, so it resolves somewhere legitimate instead of a dead page (a trust/deliverability signal).</p>
    ),
  },
  {
    title: "Create the mailboxes (one persona per domain)",
    body: (
      <>
        <p>Max <b>5 mailboxes per domain</b>, all under <b>one consistent, backable persona</b> (a real name with a real LinkedIn + photo). Delete any placeholder rows (e.g. "Immanuel Kant") first.</p>
        <p>For each mailbox: type <b>Sender First + Last</b> up top → enter the <b>email prefix only</b> in the Email field → pick the specific domain (not "All Domains") → click <b>Add</b>. Use human prefixes: <code>ernesto</code>, <code>ernesto.lee</code>, <code>elee</code>, <code>ernestolee</code>, <code>e.lee</code>. Avoid role names (<code>info@</code>, <code>sales@</code>, <code>funding@</code>).</p>
      </>
    ),
  },
  {
    title: "Wait for provisioning (Setup Pending → Connected)",
    body: (
      <p>New mailboxes show <b>Setup Pending</b> while Instantly configures DNS (SPF/DKIM/DMARC). This takes a few hours up to ~72h. You <b>can't warm up or send</b> until they flip to Connected — nothing you do speeds it up.</p>
    ),
  },
  {
    title: "Set each mailbox's sender profile",
    body: (
      <p>Once Instantly gives you the account passwords (billing/accounts area), log into each Gmail and set the <b>display name</b> (the persona) + a <b>real photo</b>. Don't change the mailbox password — Instantly needs it to stay connected. Consistent name + photo is part of what warmup signals to Google.</p>
    ),
  },
  {
    title: "Enable warmup",
    body: (
      <>
        <p>Select all mailboxes → turn on <b>warmup</b> (flame icon / bulk action). Conservative settings for fresh Google inboxes:</p>
        <ul className="list-disc pl-5 space-y-0.5">
          <li>Start <b>2–4 warmup emails/day</b>, ramp gradually to ~20–30/day.</li>
          <li>Reply rate <b>~20–30%</b>.</li>
          <li>Keep warmup <b>ON permanently</b> — even after going live, keep a slice of daily volume as warmup.</li>
        </ul>
      </>
    ),
  },
  {
    title: "Warm for 4–6 weeks (do not send cold email yet)",
    body: (
      <p>This is the discipline that makes or breaks it: <b>warm a minimum of 4 weeks, 6 is better</b>, before sending any cold email. Rushing warmup is the #1 cause of new domains landing in spam, and a burned fresh domain is hard to recover. <b>Health score climbing into the 90s = green light.</b></p>
    ),
  },
  {
    title: "Prep during warmup, then go live & scale",
    body: (
      <>
        <p>Use the warmup weeks to <b>build + verify the lead list</b> (clean, verified emails only — a dirty list with bounces undoes warmup) and <b>write the sequence</b> (intro + 2–3 follow-ups) + signatures.</p>
        <p>Launch at <b>~30–50 cold emails/inbox/day</b> (the permanent safe ceiling). Replies land in Instantly's <b>Unibox</b> → assign each to whoever closes it. <b>Scale by adding new domains</b> (5 inboxes each, ideally a new closer's persona) — never by cranking a single inbox past its ceiling.</p>
      </>
    ),
  },
];

export default function EmailPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showStrategy, setShowStrategy] = useState(true);
  const [openSteps, setOpenSteps] = useState<Set<number>>(new Set([0]));
  const toggleStep = (i: number) =>
    setOpenSteps((prev) => {
      const n = new Set(prev);
      n.has(i) ? n.delete(i) : n.add(i);
      return n;
    });

  async function load() {
    setLoading(true);
    setError(null);
    const { data: res, error: err } = await supabase.functions.invoke("instantly", { body: { action: "overview" } });
    if (err) {
      setError(err.message || "Failed to reach Instantly");
    } else if (res?.error) {
      setError(res.error);
    } else {
      setData(res as Overview);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const accounts = data?.accounts ?? [];
  const campaigns = data?.campaigns ?? [];
  const warmScore = (a: InstantlyAccount) => a.stat_warmup_score ?? a.warmup_score;

  return (
    <div className="max-w-[1200px] mx-auto px-4 py-8">
      <div className="flex items-start gap-3 mb-2">
        <EnvelopeIcon className="w-8 h-8 text-mint-green flex-shrink-0" />
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Email — Cold Outreach (Instantly)</h1>
          <p className="text-gray-600 dark:text-gray-300 mt-1">
            Live view of our Instantly.ai sending infrastructure — mailboxes, warmup health, and campaigns — plus the
            playbook for how we run cold email at MFunding.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-200 hover:border-ocean-blue disabled:opacity-60"
        >
          <ArrowPathIcon className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {/* ── Live status ─────────────────────────────────────────────── */}
      <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Mailboxes" value={loading ? "…" : String(accounts.length)} />
        <Stat label="Campaigns" value={loading ? "…" : String(campaigns.length)} />
        <Stat
          label="Warming"
          value={loading ? "…" : String(accounts.filter((a) => String(a.warmup_status) === "1").length)}
        />
        <Stat
          label="Avg health"
          value={
            loading || !accounts.length
              ? "…"
              : `${Math.round(accounts.reduce((s, a) => s + (Number(warmScore(a)) || 0), 0) / accounts.length)}%`
          }
        />
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-300">
          <ExclamationTriangleIcon className="w-5 h-5 flex-shrink-0" />
          <div>
            <b>Couldn't load Instantly data.</b> {error}
            <div className="text-xs mt-1 opacity-80">
              The API key is read server-side from the vault. If this persists, the Instantly plan/API access may be
              inactive, or the key needs refreshing.
            </div>
          </div>
        </div>
      )}

      {/* Sending accounts */}
      <section className="mt-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Sending mailboxes</h2>
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="py-2 px-3">Email</th>
                <th className="py-2 px-3">Status</th>
                <th className="py-2 px-3">Warmup</th>
                <th className="py-2 px-3">Health score</th>
                <th className="py-2 px-3">Daily limit</th>
              </tr>
            </thead>
            <tbody>
              {!loading && accounts.length === 0 && (
                <tr><td colSpan={5} className="py-6 text-center text-gray-400">No mailboxes provisioned yet.</td></tr>
              )}
              {accounts.map((a, i) => {
                const score = Number(warmScore(a));
                return (
                  <tr key={(a.email as string) ?? i} className="border-t border-gray-100 dark:border-gray-700/50">
                    <td className="py-2 px-3 font-medium text-gray-900 dark:text-gray-100">{a.email ?? "—"}</td>
                    <td className="py-2 px-3">{a.setup_pending ? <span className="text-amber-600">Setup pending</span> : label(ACCOUNT_STATUS, a.status)}</td>
                    <td className="py-2 px-3">{label(WARMUP_STATUS, a.warmup_status)}</td>
                    <td className="py-2 px-3">
                      {Number.isFinite(score) && score > 0 ? (
                        <span className={score >= 90 ? "text-mint-green font-semibold" : score >= 60 ? "text-amber-600" : "text-red-500"}>
                          {score}%
                        </span>
                      ) : "—"}
                    </td>
                    <td className="py-2 px-3">{a.daily_limit ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Campaigns */}
      <section className="mt-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Campaigns</h2>
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="py-2 px-3">Campaign</th>
                <th className="py-2 px-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {!loading && campaigns.length === 0 && (
                <tr><td colSpan={2} className="py-6 text-center text-gray-400">No campaigns yet.</td></tr>
              )}
              {campaigns.map((c, i) => (
                <tr key={(c.id as string) ?? i} className="border-t border-gray-100 dark:border-gray-700/50">
                  <td className="py-2 px-3 font-medium text-gray-900 dark:text-gray-100">{c.name ?? "—"}</td>
                  <td className="py-2 px-3">{label(CAMPAIGN_STATUS, c.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── How to add a new sending domain ─────────────────────────── */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Add a new sending domain — step by step</h2>
        <p className="text-sm text-gray-500 mb-3">
          The exact process to stand up a new domain + 5 mailboxes and get them ready to send. Do this each time we add capacity.
        </p>
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700/60 bg-white dark:bg-gray-900">
          {STEPS.map((s, i) => {
            const open = openSteps.has(i);
            return (
              <div key={i}>
                <button onClick={() => toggleStep(i)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
                  <span className="w-6 h-6 rounded-full bg-ocean-blue text-white text-xs flex items-center justify-center font-bold flex-shrink-0">{i + 1}</span>
                  <span className="font-medium text-gray-900 dark:text-white flex-1">{s.title}</span>
                  <ChevronDownIcon className={`w-5 h-5 text-gray-400 transition-transform flex-shrink-0 ${open ? "" : "-rotate-90"}`} />
                </button>
                {open && <div className="pb-4 pr-4 pl-[3.25rem] text-sm text-gray-600 dark:text-gray-300 space-y-2">{s.body}</div>}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Strategy ────────────────────────────────────────────────── */}
      <section className="mt-10">
        <button
          onClick={() => setShowStrategy((v) => !v)}
          className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white"
        >
          <ChevronDownIcon className={`w-5 h-5 transition-transform ${showStrategy ? "" : "-rotate-90"}`} />
          Our cold-email strategy
        </button>
        {showStrategy && (
          <div className="mt-4 grid md:grid-cols-2 gap-4">
            <Card title="1 · Two sending engines — and the MCA trap">
              <p><b>Google (DFY)</b> = real Google Workspace mailboxes on fresh domains — strongest inbox trust, and the only option that can deliver to <b>personal</b> recipient addresses.</p>
              <p><b>AirMail (by Instantly)</b> = Instantly's own private servers/IPs (~$4/mailbox), no suspension risk — but it's <b>strictly B2B and silently drops @gmail/@yahoo/@outlook recipients</b>. Since many merchants use personal Gmail as their business email, <b>Google is our backbone</b>; AirMail is only additive for business-domain lists.</p>
            </Card>
            <Card title="2 · Own your infrastructure">
              <p>Instantly's DFY domains are <b>rented, not owned</b> — they keep admin/ownership and you can't take them if you leave.</p>
              <p>Preferred: <b>register domains yourself</b> (Cloudflare/Namecheap ~$12/yr) + <b>Google Workspace direct</b> (~$7/mo), or a <b>3rd-party pre-warmed provider</b> (Zapmail / InboxKit ~$3/inbox, real GWS, OAuth into Instantly). Connect via "Connect existing accounts" so Instantly is just software on top of infrastructure <b>we</b> own.</p>
            </Card>
            <Card title="3 · Keep real email separate">
              <p><b>Never send cold email from our main domain.</b> Use throwaway <b>secondary</b> sending domains (e.g. getmfunding.com) so if one lands in spam, mfunding.net's reputation is untouched.</p>
              <p>Set each sending domain's <b>forwarding domain</b> to the real site (mfunding.net) so a curious prospect lands somewhere legit.</p>
            </Card>
            <Card title="4 · Personas — who sends vs. who closes">
              <p>One <b>consistent, backable persona per domain</b> (real name + LinkedIn + photo). Prefixes that look human: <code>ernesto@</code>, <code>ernesto.lee@</code>, <code>elee@</code>, <code>ernestolee@</code>, <code>e.lee@</code>. Avoid role addresses (info@, sales@, funding@).</p>
              <p>Replies land in Instantly's <b>Unibox</b>; assign the lead to whoever closes it (often on the phone). The email name just opens the door.</p>
            </Card>
            <Card title="5 · Warmup discipline">
              <p>New mailboxes must warm <b>4–6 weeks</b> before any cold send — rushing warmup is the #1 cause of landing in spam.</p>
              <p>Start <b>2–4 warmup emails/day</b>, ~20–30% reply rate, ramp to ~20–30/day. Keep warmup <b>on permanently</b>. Health score climbing into the 90s is the green light.</p>
            </Card>
            <Card title="6 · Scale by adding inboxes, not volume">
              <p>Safe ceiling is ~<b>30–50 cold emails/day per inbox</b> — permanently. You scale by adding inboxes (5 per domain), not by cranking one up.</p>
              <table className="w-full mt-2 text-xs">
                <thead className="text-gray-500"><tr><th className="text-left">Daily target</th><th className="text-left">Inboxes</th><th className="text-left">Domains</th></tr></thead>
                <tbody className="text-gray-700 dark:text-gray-300">
                  <tr><td>150</td><td>5</td><td>1 <span className="text-mint-green">(now)</span></td></tr>
                  <tr><td>500</td><td>~17</td><td>~4</td></tr>
                  <tr><td>1,000</td><td>~33</td><td>~7</td></tr>
                  <tr><td>3,000</td><td>~100</td><td>~20</td></tr>
                  <tr><td>10,000</td><td>~333</td><td>~67</td></tr>
                </tbody>
              </table>
            </Card>
            <Card title="7 · The reframe — targeted beats big" wide>
              <p>10,000/day isn't automatically better — it's usually worse. A tight, well-segmented <b>500–1,000/day</b> worked hard on the phone out-earns a sloppy 10k/day every time. Our bottleneck isn't send volume — it's <b>verified leads and closer capacity</b>. Solve for the daily send that keeps closers at capacity, then scale infrastructure to hit it.</p>
            </Card>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3">
      <div className="text-xs uppercase text-gray-500">{label}</div>
      <div className="text-2xl font-bold text-gray-900 dark:text-white">{value}</div>
    </div>
  );
}

function Card({ title, children, wide }: { title: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 ${wide ? "md:col-span-2" : ""}`}>
      <h3 className="font-semibold text-gray-900 dark:text-white mb-2">{title}</h3>
      <div className="space-y-2 text-sm text-gray-600 dark:text-gray-300">{children}</div>
    </div>
  );
}
