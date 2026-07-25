import { useEffect, useState, type ReactNode } from "react";
import supabase from "@/supabase";
import {
  EnvelopeIcon,
  ArrowPathIcon,
  ArrowLeftIcon,
  ExclamationTriangleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CheckCircleIcon,
  CheckIcon,
  XMarkIcon,
  PencilSquareIcon,
  FireIcon,
  PaperAirplaneIcon,
} from "@heroicons/react/24/outline";
import { BarChart, Bar, XAxis, YAxis, Cell, ReferenceLine, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { useUserProfile } from "@/context/UserProfileContext";
import { getInstantlySettings, saveInstantlySettings } from "@/services/platformService";

// ── Live Instantly data ──────────────────────────────────────────────────────
// The warmup model + domain grouping live in a shared module so this page and
// the Cold Email Planner always agree on what "warmed" means. Do not fork it.
import {
  WARM_YELLOW_DAYS,
  WARM_GREEN_DAYS,
  WARM_TONE,
  groupDomains,
  type InstantlyAccount,
  type InstantlyCampaign,
  type Overview,
  type DomainGroup,
} from "@/lib/instantlyWarmup";

const ACCOUNT_STATUS: Record<string, string> = { "1": "Active", "2": "Paused", "-1": "Error", "-2": "Suspended", "0": "Setup pending" };
const WARMUP_STATUS: Record<string, string> = { "0": "Paused", "1": "Active", "-1": "Error" };
const CAMPAIGN_STATUS: Record<string, string> = { "0": "Draft", "1": "Active", "2": "Paused", "3": "Completed", "4": "Running (subseq.)" };
// Instantly provider_code → human label (verified against the live accounts payload).
const PROVIDER_CODE: Record<string, string> = { "1": "Custom IMAP/SMTP", "2": "Google", "3": "Microsoft", "4": "AWS" };

function label(map: Record<string, string>, v: unknown): string {
  if (v === undefined || v === null) return "—";
  return map[String(v)] ?? String(v);
}

function fmtDate(iso: unknown): string {
  if (!iso || typeof iso !== "string") return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  return new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

// ── Send-capacity resolution ──────────────────────────────────────────────────
// A mailbox counts toward capacity only when it's Active (status 1) and finished
// provisioning. Its per-day limit comes from the API when present; otherwise we
// fall back to the workspace default (Instantly doesn't report a limit for
// managed accounts, so in practice every mailbox here is "assumed").
function isActive(a: InstantlyAccount): boolean {
  return String(a.status) === "1" && !a.setup_pending;
}

/** Resolve a mailbox's daily send limit. `assumed` = we used the workspace
 * default because the API didn't report a real per-mailbox limit. */
function resolveDailyLimit(a: InstantlyAccount, fallback: number): { limit: number; assumed: boolean } {
  const raw = a.daily_limit;
  if (typeof raw === "number" && raw > 0) return { limit: raw, assumed: false };
  return { limit: fallback, assumed: true };
}

/** Sum resolved daily limits over the ACTIVE mailboxes in a set. */
function capacityOf(accounts: InstantlyAccount[], fallback: number): number {
  return accounts.filter(isActive).reduce((s, a) => s + resolveDailyLimit(a, fallback).limit, 0);
}

// Step-by-step runbook for standing up a new sending domain (from our Instantly playbook).
const STEPS: { title: string; body: ReactNode }[] = [
  {
    title: "Pick the sending domain (never our main domain)",
    body: (
      <>
        <p><b>Our naming convention: <code>[word]mfunding.com</code></b> — a short action word in front of "mfunding", always <code>.com</code>. Keep it close to the brand but clearly a secondary sending domain.</p>
        <p><b>Domains we already own</b> (don't reuse — one at a time): <code>getmfunding.com</code>, <code>trymfunding.com</code>, <code>workmfunding.com</code>.</p>
        <p><b>Next ones to register</b> (pick the next unused): <code>gomfunding.com</code> · <code>joinmfunding.com</code> · <code>hellomfunding.com</code> · <code>mymfunding.com</code> · <code>usemfunding.com</code> · <code>trymomentumfunding.com</code>.</p>
        <p className="text-red-600 dark:text-red-400"><b>NEVER use <code>mfunding.net</code></b> (our real live site — protect its reputation) <b>or <code>mfunding.com</code></b> (a parked placeholder, not ours). Those are never sending domains.</p>
        <p>One new domain = <b>exactly 5 mailboxes</b> under one real persona.</p>
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
      <>
        <p>In the order/setup screen, the <b>Forwarding Domain</b> field must be exactly:</p>
        <p className="my-1"><code className="text-base font-bold">mfunding.net</code> <span className="text-xs text-gray-500">(no <code>https://</code>, no <code>www</code>, no trailing slash)</span></p>
        <p>This redirects anyone who visits the sending domain to our real site, so it resolves somewhere legitimate instead of a dead page (a trust/deliverability signal). <b>Not</b> the sending domain, <b>not</b> <code>mfunding.com</code>.</p>
        <p className="text-xs text-gray-500 dark:text-gray-400"><b>Already-bought domain pointing wrong?</b> Fix it in Instantly at <b>Billing → Email Accounts and Domains → select the domain → update Forwarding Domain → <code>mfunding.net</code></b>. (This is exactly how <code>getmfunding.com</code> gets corrected from <code>mfunding.com</code>.)</p>
      </>
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
  const { isSuperAdmin } = useUserProfile();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showStrategy, setShowStrategy] = useState(true);
  const [openSteps, setOpenSteps] = useState<Set<number>>(new Set([0]));
  // Assumed per-mailbox daily limit (workspace default from platform_settings).
  const [defaultLimit, setDefaultLimit] = useState(30);
  // Which domain's detail is open (null = the cards/overview view).
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
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
      // The overview DEGRADES rather than fails: a dead API (e.g. lapsed
      // Instantly plan → 402) comes back as empty arrays + errors{}. Rendering
      // "0 mailboxes" for that is a lie — surface the real reason loudly.
      const o = res as Overview;
      const apiErr = o?.errors?.accounts || o?.errors?.campaigns;
      if (apiErr) {
        setError(
          /402|paid plan|Payment Required/i.test(apiErr)
            ? "Instantly plan is INACTIVE (API returned 402 'Workspace does not have an active paid plan'). Mailboxes, warmup, campaigns AND lead email-verification are suspended until the plan is renewed at instantly.ai → Billing. The zeros below reflect the dead API, not your real infrastructure."
            : `Instantly API degraded: ${apiErr}`,
        );
      }
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
    getInstantlySettings().then((s) => setDefaultLimit(s.default_daily_limit)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const accounts = data?.accounts ?? [];
  const campaigns = data?.campaigns ?? [];
  const warmScore = (a: InstantlyAccount) => a.stat_warmup_score ?? a.warmup_score;
  const domains = groupDomains(accounts, data?.forwarding ?? {}, Date.now());

  // ── Send capacity ────────────────────────────────────────────────────────
  // Total = active mailboxes × their resolved per-day limit. "Safe" only counts
  // mailboxes whose DOMAIN has cleared the 6-week (42-day) warmup line — before
  // that, sending burns the domain, so real safe capacity is 0.
  const activeCount = accounts.filter(isActive).length;
  const perDay = capacityOf(accounts, defaultLimit);
  const safePerDay = domains
    .filter((g) => g.ws.tone === "green")
    .reduce((s, g) => s + capacityOf(g.accts, defaultLimit), 0);
  // Are any capacity figures based on the assumed default rather than the API?
  const anyAssumed = accounts.filter(isActive).some((a) => resolveDailyLimit(a, defaultLimit).assumed);
  // Uniform per-mailbox number to show ("varies" when limits differ).
  const activeLimits = accounts.filter(isActive).map((a) => resolveDailyLimit(a, defaultLimit).limit);
  const uniformLimit = activeLimits.length && activeLimits.every((l) => l === activeLimits[0]) ? activeLimits[0] : null;

  const selectedGroup = selectedDomain ? domains.find((g) => g.domain === selectedDomain) ?? null : null;

  async function saveDefaultLimit(n: number) {
    setDefaultLimit(n);
    await saveInstantlySettings({ default_daily_limit: n });
  }

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

      {/* ── Send capacity ───────────────────────────────────────────────── */}
      <SendCapacityCard
        loading={loading}
        activeCount={activeCount}
        perDay={perDay}
        safePerDay={safePerDay}
        anyAssumed={anyAssumed}
        uniformLimit={uniformLimit}
        defaultLimit={defaultLimit}
        canEdit={isSuperAdmin}
        onSaveDefault={saveDefaultLimit}
      />

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

      {/* Domain warmup — countdown clocks + forwarding + progress chart, with
          per-domain drill-down. */}
      <DomainWarmupDashboard
        domains={domains}
        realSite={data?.real_site ?? "mfunding.net"}
        loading={loading}
        campaigns={campaigns}
        defaultLimit={defaultLimit}
        selectedGroup={selectedGroup}
        onSelect={setSelectedDomain}
        onBack={() => setSelectedDomain(null)}
      />

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
                const dl = resolveDailyLimit(a, defaultLimit);
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
                    <td className="py-2 px-3">
                      {dl.assumed ? (
                        <span
                          className="text-gray-700 dark:text-gray-300"
                          title="Assumed workspace default — Instantly's API doesn't report a per-mailbox limit for managed accounts."
                        >
                          {dl.limit}<span className="text-amber-500">*</span>
                        </span>
                      ) : (
                        <span className="text-gray-900 dark:text-gray-100 font-medium">{dl.limit}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!loading && anyAssumed && (
          <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
            <span className="text-amber-500">*</span> Assumed <b>{defaultLimit}/day</b> — Instantly's API doesn't report a per-mailbox
            limit for managed accounts. Edit the default in the <b>Send capacity</b> card above to match your real Instantly setting.
          </p>
        )}
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

// ── Domain warmup dashboard ───────────────────────────────────────────────────
function DomainWarmupDashboard({
  domains,
  realSite,
  loading,
  campaigns,
  defaultLimit,
  selectedGroup,
  onSelect,
  onBack,
}: {
  domains: DomainGroup[];
  realSite: string;
  loading: boolean;
  campaigns: InstantlyCampaign[];
  defaultLimit: number;
  selectedGroup: DomainGroup | null;
  onSelect: (domain: string) => void;
  onBack: () => void;
}) {
  if (loading && domains.length === 0) {
    return <section className="mt-6"><p className="text-sm text-gray-400">Loading domain warmup…</p></section>;
  }
  if (domains.length === 0) return null;

  // Drill-down: a single domain's mailboxes, rollup, and campaigns.
  if (selectedGroup) {
    return <DomainDetail group={selectedGroup} realSite={realSite} campaigns={campaigns} defaultLimit={defaultLimit} onBack={onBack} />;
  }

  const chartData = domains.map((g) => ({ name: g.domain.replace(/\.com$|\.net$/, ""), days: g.ws.days, tone: g.ws.tone }));

  return (
    <section className="mt-6">
      <div className="flex items-center gap-2 mb-1">
        <FireIcon className="w-5 h-5 text-amber-500" />
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">Domain warmup</h2>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        Do <b>not</b> send cold email until a domain is warmed. <span className="text-red-600 dark:text-red-400 font-medium">Red &lt; 3 wks</span> ·{" "}
        <span className="text-amber-600 dark:text-amber-400 font-medium">Yellow 3–6 wks</span> (earliest send ~3.5 wks) ·{" "}
        <span className="text-emerald-600 dark:text-emerald-400 font-medium">Green ≥ 6 wks (safe)</span>.
      </p>

      {/* Countdown cards — click to drill into a domain */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {domains.map((g) => {
          const t = WARM_TONE[g.ws.tone];
          return (
            <button
              key={g.domain}
              type="button"
              onClick={() => onSelect(g.domain)}
              className={`text-left rounded-xl border-2 ${t.ring} bg-white dark:bg-gray-900 p-4 cursor-pointer transition hover:shadow-md hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-ocean-blue`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-gray-900 dark:text-white truncate">{g.domain}</span>
                <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${t.chip}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${t.dot}`} /> {g.ws.tone}
                </span>
              </div>

              {/* The clock */}
              <div className="mt-3 flex items-end gap-2">
                <span className={`text-4xl font-extrabold tabular-nums ${t.text}`}>{g.ws.started ? g.ws.days : "—"}</span>
                <span className="text-sm text-gray-500 dark:text-gray-400 mb-1">days warming</span>
              </div>
              <p className={`text-xs font-medium ${t.text}`}>{g.ws.label}</p>

              {/* Progress toward 6 weeks, with the 3-week + 3.5-week markers */}
              <div className="mt-3">
                <div className="relative h-2.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                  <div className={`h-full ${t.bar} transition-all`} style={{ width: `${g.ws.pct}%` }} />
                  {/* 3-week (50%) and 6-week (100%) markers */}
                  <span className="absolute top-0 bottom-0 w-px bg-gray-400/70" style={{ left: `${(WARM_YELLOW_DAYS / WARM_GREEN_DAYS) * 100}%` }} title="3 weeks" />
                </div>
                <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                  <span>0</span><span>3 wk</span><span>6 wk ✓</span>
                </div>
              </div>

              <p className="text-xs text-gray-600 dark:text-gray-300 mt-2">
                {g.ws.tone === "green"
                  ? "✅ Safe to send."
                  : g.ws.started
                    ? <><b className={t.text}>{g.ws.toGreen} days</b> until safe to send{g.ws.canStart ? " (can start light now)" : ""}.</>
                    : "Warmup hasn't started yet."}
              </p>

              {/* Meta: mailboxes · health · forwarding */}
              <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 space-y-1 text-xs">
                <div className="flex justify-between"><span className="text-gray-500">Mailboxes</span><span className="text-gray-800 dark:text-gray-200 font-medium">{g.accts.length}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Warmup health</span><span className="text-gray-800 dark:text-gray-200 font-medium">{g.avgHealth}%</span></div>
                <div className="flex justify-between items-center gap-2">
                  <span className="text-gray-500">Forwarding</span>
                  {g.fwd?.ok ? (
                    <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium"><CheckCircleIcon className="w-3.5 h-3.5" />{realSite}</span>
                  ) : g.fwd?.target ? (
                    <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400 font-medium" title={`Should forward to ${realSite}`}><ExclamationTriangleIcon className="w-3.5 h-3.5" />→ {g.fwd.target} ✕</span>
                  ) : (
                    <span className="text-gray-400">unknown</span>
                  )}
                </div>
              </div>

              <div className="mt-3 flex items-center justify-end gap-1 text-xs font-medium text-ocean-blue">
                View details <ChevronRightIcon className="w-3.5 h-3.5" />
              </div>
            </button>
          );
        })}
      </div>

      {/* Warmup progress chart */}
      <div className="mt-5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Warmup progress — days toward the 6-week safe line</h3>
        <ResponsiveContainer width="100%" height={Math.max(140, chartData.length * 46)}>
          <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-gray-200 dark:stroke-gray-700" />
            <XAxis type="number" domain={[0, WARM_GREEN_DAYS]} tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}d`} />
            <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 12 }} />
            <Tooltip formatter={(v) => [`${v} days`, "Warming"]} />
            <ReferenceLine x={WARM_YELLOW_DAYS} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: "3 wk", position: "top", fontSize: 10, fill: "#f59e0b" }} />
            <ReferenceLine x={WARM_GREEN_DAYS} stroke="#10b981" strokeDasharray="4 4" label={{ value: "6 wk", position: "top", fontSize: 10, fill: "#10b981" }} />
            <Bar dataKey="days" radius={[0, 4, 4, 0]} barSize={20}>
              {chartData.map((d, i) => (
                <Cell key={i} fill={d.tone === "green" ? "#10b981" : d.tone === "yellow" ? "#f59e0b" : "#ef4444"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

// ── Domain drill-down ─────────────────────────────────────────────────────────
function DomainDetail({
  group,
  realSite,
  campaigns,
  defaultLimit,
  onBack,
}: {
  group: DomainGroup;
  realSite: string;
  campaigns: InstantlyCampaign[];
  defaultLimit: number;
  onBack: () => void;
}) {
  const t = WARM_TONE[group.ws.tone];
  const dayCap = capacityOf(group.accts, defaultLimit);
  const anyAssumed = group.accts.filter(isActive).some((a) => resolveDailyLimit(a, defaultLimit).assumed);
  // Campaigns that send from at least one of this domain's mailboxes.
  const domainEmails = new Set(group.accts.map((a) => String(a.email ?? "").toLowerCase()));
  const usingCampaigns = campaigns.filter((c) => {
    const list = Array.isArray(c.email_list) ? (c.email_list as unknown[]) : [];
    return list.some((e) => domainEmails.has(String(e).toLowerCase()));
  });

  return (
    <section className="mt-6">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-300 hover:text-ocean-blue mb-3"
      >
        <ArrowLeftIcon className="w-4 h-4" /> All domains
      </button>

      <div className="flex items-center gap-2 mb-3">
        <FireIcon className="w-5 h-5 text-amber-500" />
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">{group.domain}</h2>
        <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${t.chip}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${t.dot}`} /> {group.ws.tone}
        </span>
      </div>

      {/* Rollup */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
        <MiniStat label="Mailboxes" value={String(group.accts.length)} />
        <MiniStat label="Daily capacity" value={`${dayCap.toLocaleString()}${anyAssumed ? "*" : ""}`} sub="emails/day" />
        <MiniStat label="Avg health" value={`${group.avgHealth}%`} />
        <MiniStat label="Days warming" value={group.ws.started ? String(group.ws.days) : "—"} />
        <MiniStat
          label="Safe to send"
          value={group.ws.tone === "green" ? "Now ✓" : group.ws.started ? `${group.ws.toGreen}d` : "—"}
          sub={group.ws.tone === "green" ? "warmed" : "until 42-day line"}
          tone={group.ws.tone === "green" ? "green" : "red"}
        />
        <MiniStat
          label="Forwarding"
          value={group.fwd?.ok ? "OK ✓" : group.fwd?.target ? "Wrong ✕" : "—"}
          sub={group.fwd?.ok ? realSite : group.fwd?.target ? `→ ${group.fwd.target}` : "unknown"}
          tone={group.fwd?.ok ? "green" : group.fwd?.target ? "red" : undefined}
        />
      </div>

      {/* Mailboxes */}
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Mailboxes</h3>
      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700 mb-5">
        <table className="w-full text-sm whitespace-nowrap">
          <thead className="bg-gray-50 dark:bg-gray-800 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="py-2 px-3">Email</th>
              <th className="py-2 px-3">Name</th>
              <th className="py-2 px-3">Status</th>
              <th className="py-2 px-3">Warmup</th>
              <th className="py-2 px-3">Health</th>
              <th className="py-2 px-3">Provider</th>
              <th className="py-2 px-3">Tracking domain</th>
              <th className="py-2 px-3">Created</th>
              <th className="py-2 px-3">Warmup start</th>
              <th className="py-2 px-3">Days</th>
              <th className="py-2 px-3">Daily limit</th>
            </tr>
          </thead>
          <tbody>
            {group.accts.map((a, i) => {
              const score = Number(a.stat_warmup_score ?? a.warmup_score);
              const dl = resolveDailyLimit(a, defaultLimit);
              const name = [a.first_name, a.last_name].filter(Boolean).join(" ") || "—";
              const start = a.timestamp_warmup_start || null;
              const daysWarming = start ? Math.max(0, Math.floor((Date.now() - Date.parse(start)) / 86_400_000)) : null;
              const trackStatus = String(a.tracking_domain_status ?? "");
              return (
                <tr key={(a.email as string) ?? i} className="border-t border-gray-100 dark:border-gray-700/50">
                  <td className="py-2 px-3 font-medium text-gray-900 dark:text-gray-100">{a.email ?? "—"}</td>
                  <td className="py-2 px-3 text-gray-700 dark:text-gray-300">{name}</td>
                  <td className="py-2 px-3">{a.setup_pending ? <span className="text-amber-600">Setup pending</span> : label(ACCOUNT_STATUS, a.status)}</td>
                  <td className="py-2 px-3">{label(WARMUP_STATUS, a.warmup_status)}</td>
                  <td className="py-2 px-3">
                    {Number.isFinite(score) && score > 0 ? (
                      <span className={score >= 90 ? "text-mint-green font-semibold" : score >= 60 ? "text-amber-600" : "text-red-500"}>{score}%</span>
                    ) : "—"}
                  </td>
                  <td className="py-2 px-3 text-gray-700 dark:text-gray-300">{label(PROVIDER_CODE, a.provider_code)}</td>
                  <td className="py-2 px-3 text-gray-700 dark:text-gray-300">
                    {a.tracking_domain_name ? (
                      <span className="inline-flex items-center gap-1">
                        {String(a.tracking_domain_name)}
                        {/CTD_ACTIVE|ACTIVE/i.test(trackStatus) ? (
                          <CheckCircleIcon className="w-3.5 h-3.5 text-emerald-500" />
                        ) : trackStatus ? (
                          <ExclamationTriangleIcon className="w-3.5 h-3.5 text-amber-500" />
                        ) : null}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="py-2 px-3 text-gray-500">{fmtDate(a.timestamp_created)}</td>
                  <td className="py-2 px-3 text-gray-500">{fmtDate(a.timestamp_warmup_start)}</td>
                  <td className="py-2 px-3 tabular-nums text-gray-700 dark:text-gray-300">{daysWarming ?? "—"}</td>
                  <td className="py-2 px-3">
                    {dl.assumed ? (
                      <span title="Assumed workspace default — API doesn't report a per-mailbox limit for managed accounts.">
                        {dl.limit}<span className="text-amber-500">*</span>
                      </span>
                    ) : (
                      <span className="font-medium">{dl.limit}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {anyAssumed && (
        <p className="-mt-3 mb-5 text-xs text-gray-500 dark:text-gray-400">
          <span className="text-amber-500">*</span> Assumed <b>{defaultLimit}/day</b> — Instantly's API doesn't report per-mailbox limits for managed accounts.
        </p>
      )}

      {/* Campaigns using this domain */}
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Campaigns sending from this domain</h3>
      {usingCampaigns.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          None — no campaign's sending list includes a mailbox on {group.domain}.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="py-2 px-3">Campaign</th>
                <th className="py-2 px-3">Status</th>
                <th className="py-2 px-3">Daily limit</th>
              </tr>
            </thead>
            <tbody>
              {usingCampaigns.map((c, i) => (
                <tr key={(c.id as string) ?? i} className="border-t border-gray-100 dark:border-gray-700/50">
                  <td className="py-2 px-3 font-medium text-gray-900 dark:text-gray-100">{c.name ?? "—"}</td>
                  <td className="py-2 px-3">{label(CAMPAIGN_STATUS, c.status)}</td>
                  <td className="py-2 px-3 tabular-nums text-gray-700 dark:text-gray-300">
                    {typeof c.daily_limit === "number" ? c.daily_limit : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function MiniStat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "green" | "red" }) {
  const valClass = tone === "green" ? "text-emerald-600 dark:text-emerald-400" : tone === "red" ? "text-red-600 dark:text-red-400" : "text-gray-900 dark:text-white";
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3">
      <div className="text-[10px] uppercase text-gray-500">{label}</div>
      <div className={`text-lg font-bold tabular-nums ${valClass}`}>{value}</div>
      {sub && <div className="text-[10px] text-gray-500 dark:text-gray-400 truncate" title={sub}>{sub}</div>}
    </div>
  );
}

// ── Send capacity card ────────────────────────────────────────────────────────
function SendCapacityCard({
  loading,
  activeCount,
  perDay,
  safePerDay,
  anyAssumed,
  uniformLimit,
  defaultLimit,
  canEdit,
  onSaveDefault,
}: {
  loading: boolean;
  activeCount: number;
  perDay: number;
  safePerDay: number;
  anyAssumed: boolean;
  uniformLimit: number | null;
  defaultLimit: number;
  canEdit: boolean;
  onSaveDefault: (n: number) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(defaultLimit));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(String(defaultLimit));
  }, [defaultLimit, editing]);

  async function commit() {
    const n = Math.round(Number(draft));
    if (!Number.isFinite(n) || n <= 0) return; // ignore junk; keep editing
    setSaving(true);
    try {
      await onSaveDefault(n);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  const perMailbox = uniformLimit != null ? `${uniformLimit}/day` : "varies";

  return (
    <div className="mt-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        {/* Headline capacity */}
        <div className="min-w-[200px]">
          <div className="flex items-center gap-1.5 text-xs uppercase text-gray-500">
            <PaperAirplaneIcon className="w-3.5 h-3.5" /> Send capacity
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-gray-900 dark:text-white tabular-nums">
              {loading ? "…" : perDay.toLocaleString()}
            </span>
            <span className="text-sm text-gray-500">emails/day</span>
          </div>
          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 space-x-3">
            <span><b className="text-gray-700 dark:text-gray-200">{loading ? "…" : (perDay * 7).toLocaleString()}</b>/week</span>
            <span><b className="text-gray-700 dark:text-gray-200">{loading ? "…" : (perDay * 30).toLocaleString()}</b>/month</span>
          </div>
          <div className="mt-1 text-xs text-gray-500">
            {loading ? "" : <>{activeCount} active {activeCount === 1 ? "mailbox" : "mailboxes"} · per mailbox: <b className="text-gray-700 dark:text-gray-200">{perMailbox}</b></>}
          </div>
        </div>

        {/* Warmup-gated truth */}
        <div className="min-w-[180px]">
          <div className="text-xs uppercase text-gray-500">Safe to send today</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className={`text-3xl font-bold tabular-nums ${safePerDay > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
              {loading ? "…" : safePerDay.toLocaleString()}
            </span>
            <span className="text-sm text-gray-500">emails/day</span>
          </div>
          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {loading
              ? ""
              : safePerDay > 0
                ? "Only counts domains past the 6-week (42-day) warmup line."
                : "0 — domains still warming (need ≥ 42 days before any cold send)."}
          </div>
        </div>

        {/* Editable default */}
        <div className="min-w-[170px]">
          <div className="text-xs uppercase text-gray-500">Assumed per-mailbox limit</div>
          {editing ? (
            <div className="mt-1 flex items-center gap-1.5">
              <input
                type="number"
                min={1}
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit();
                  if (e.key === "Escape") setEditing(false);
                }}
                className="w-20 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm text-gray-900 dark:text-gray-100"
              />
              <span className="text-xs text-gray-500">/day</span>
              <button
                onClick={commit}
                disabled={saving}
                className="p-1 rounded-md text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 disabled:opacity-50"
                title="Save"
              >
                <CheckIcon className="w-4 h-4" />
              </button>
              <button
                onClick={() => setEditing(false)}
                disabled={saving}
                className="p-1 rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                title="Cancel"
              >
                <XMarkIcon className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="mt-1 flex items-center gap-1.5">
              <span className="text-lg font-semibold text-gray-900 dark:text-white tabular-nums">{defaultLimit}</span>
              <span className="text-xs text-gray-500">/day</span>
              {canEdit && (
                <button
                  onClick={() => setEditing(true)}
                  className="p-1 rounded-md text-gray-400 hover:text-ocean-blue hover:bg-gray-100 dark:hover:bg-gray-800"
                  title="Edit assumed per-mailbox daily limit"
                >
                  <PencilSquareIcon className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {!loading && anyAssumed && (
        <p className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
          Assumed <b>{defaultLimit}/day</b> per mailbox (Instantly default — the API doesn't report limits for managed accounts;
          {canEdit ? " tap ✎ to match your Instantly setting" : " a super-admin can adjust it above"}).
        </p>
      )}
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
