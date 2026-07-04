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

export default function EmailPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showStrategy, setShowStrategy] = useState(true);

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
                    <td className="py-2 px-3">{label(ACCOUNT_STATUS, a.status)}</td>
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
              <p><b>Never send cold email from our main domain.</b> Use throwaway <b>secondary</b> sending domains (e.g. getmfunding.com) so if one lands in spam, mfunding.com's reputation is untouched.</p>
              <p>Set each sending domain's <b>forwarding domain</b> to the real site (mfunding.com) so a curious prospect lands somewhere legit.</p>
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
