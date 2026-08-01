import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PhoneArrowUpRightIcon,
  ArrowRightIcon,
  ChatBubbleLeftRightIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  XMarkIcon,
  ArrowRightCircleIcon,
  PaperAirplaneIcon,
  BuildingLibraryIcon,
  MagnifyingGlassIcon,
  ClipboardDocumentIcon,
  BoltIcon,
  StarIcon,
  UserCircleIcon,
} from "@heroicons/react/24/outline";
import supabase from "@/supabase";
import { mustWrite } from "@/supabase/writes";
import { useUserProfile } from "@/context/UserProfileContext";
import { useDealPlaidItem } from "@/hooks/useDealPlaidItem";

/* ------------------------------------------------------------------ */
/* PH Setter — the outbound setter's ONLY screen.                     */
/* A NEW playbook rendered alongside the existing MCA/VCF flows; it    */
/* never touches src/data/playbooks.ts. Stage content is read live     */
/* from public.rnd_items (sections plan_pipeline / plan_scripts /      */
/* plan_automations) so the R&D plan stays the single source of truth. */
/* Compliance: advance / working capital / funding — never "loan".     */
/* ------------------------------------------------------------------ */

const PH_PLAYBOOK_ID = "ph-setter";
const GHL_PH_PIPELINE = "ZTSCCAEt9wFI6rfdPsLD"; // PH — Outbound Setters

/* Stage colors — mirror the R&D setter-pipeline hues so the two surfaces read
   as the same pipeline. Keyed by content.color from plan_pipeline. */
const STAGE_CARD: Record<string, string> = {
  gray: "border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/60",
  blue: "border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20",
  teal: "border-teal-300 dark:border-teal-800 bg-teal-50 dark:bg-teal-900/20",
  purple: "border-purple-300 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20",
  orange: "border-orange-300 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/20",
  green: "border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20",
  yellow: "border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20",
  red: "border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/20",
  brown: "border-amber-700/50 dark:border-amber-900 bg-amber-100/50 dark:bg-amber-950/30",
};
const STAGE_DOT: Record<string, string> = {
  gray: "bg-gray-400",
  blue: "bg-blue-500",
  teal: "bg-teal-500",
  purple: "bg-purple-500",
  orange: "bg-orange-500",
  green: "bg-emerald-500",
  yellow: "bg-amber-500",
  red: "bg-rose-500",
  brown: "bg-amber-700",
};

/* ── rnd_items shape (the slice this page reads) ── */
interface Ladder {
  label?: string;
  step?: string;
  text: string;
}
interface Objection {
  q: string;
  a: string;
}
interface RndContent {
  color?: string;
  stageNum?: number;
  stageName?: string;
  definition?: string;
  handoff?: boolean;
  script?: string;
  ladder?: Ladder[];
  objections?: Objection[];
  coach_note?: string;
  draft?: boolean;
  trigger?: string;
  action?: string;
}
interface RndItem {
  id: string;
  section: string;
  label: string;
  content: RndContent;
  sort_order: number;
}

/* Per-stage guide — the ACTION + which say-this scripts belong here + the
   transition rule. Scripts are referenced by their plan_scripts label so the
   verbatim copy always comes from the DB; this only decides placement. Authored
   transition/action text stays compliance-safe (working capital / advance). */
interface StageGuide {
  action: string;
  scripts: string[]; // plan_scripts labels to render on this stage
  showObjections?: boolean;
  transition: string;
  isPacketStage?: boolean; // Application Attempt → Send packet button
  isBankStage?: boolean; // Bank Connected → Plaid chip + handoff
}
const STAGE_GUIDE: Record<number, StageGuide> = {
  1: {
    action: "Load a scrubbed UCC list and TCPA-scrub the cells before the first dial. DNC is honored globally.",
    scripts: [],
    transition: "Start dialing a record → move it to Dialing.",
  },
  2: {
    action: "Work the list. The second someone picks up, run the opener — a pattern interrupt straight to the core question.",
    scripts: ["Opener (pattern interrupt)"],
    showObjections: true,
    transition: "A real conversation → Live Conversation. No answer → keep dialing. Bad number → Recycle / Nurture.",
  },
  3: {
    action: "Qualify: is the owner open to $20K–$100K in working capital if the terms fit? Confirm the business is real and needs capital.",
    scripts: [],
    showObjections: true,
    transition: "They're open and it's a fit → Application Attempt. Won't engage → Not Interested / DNC or Recycle.",
  },
  4: {
    action: "Close for the application and send the packet LIVE on the call — the agreement takes ~30 seconds to e-sign.",
    scripts: ["Application close", "Application decline → fallback appointment ladder"],
    transition: "Signs the agreement → Signed. Declines → work the fallback ladder → Fallback Appointment.",
    isPacketStage: true,
  },
  5: {
    action: "Signature is in. Pivot straight to Plaid and send the bank-connect link while you're still on the phone.",
    scripts: ["Plaid pivot"],
    transition: "Bank connects → Bank Connected (complete file). Resists → work the Plaid resistance ladder.",
  },
  6: {
    action: "Plaid pull done = COMPLETE FILE. This is the ONLY handoff into the existing business — a deal is created in the main pipeline here.",
    scripts: ["Plaid resistance ladder"],
    transition: "Complete file → HANDOFF to the main business pipeline (manual for now — flag the owner/closer).",
    isBankStage: true,
  },
  7: {
    action: "Would not finish now. Book and confirm the follow-up; send the agreement + Plaid link so they already have everything.",
    scripts: ["Application decline → fallback appointment ladder"],
    transition: "They finish on the follow-up → Signed / Bank Connected. Goes cold → Recycle / Nurture.",
  },
  8: {
    action: "Respect the no. Write the number to the suppression list so it's never dialed again.",
    scripts: [],
    transition: "Terminal — honors do-not-call globally.",
  },
  9: {
    action: "Not now, not a no. Drop into the 30-day re-dial cadence and reactivation cycle.",
    scripts: [],
    transition: "Re-engages later → back to Dialing.",
  },
};

/* Daily per-setter targets (mirror plan_kpis · Daily / setter). A metric is
   green when the entered value meets or beats its floor, red otherwise. */
interface Metric {
  key: keyof ScorecardCounts;
  label: string;
  target: number;
  targetLabel: string;
}
const DAILY_METRICS: Metric[] = [
  { key: "dials", label: "Dials", target: 320, targetLabel: "≥ 320" },
  { key: "live_conversations", label: "Live convos", target: 38, targetLabel: "≥ 38" },
  { key: "application_attempts", label: "App attempts", target: 22, targetLabel: "≥ 22" },
  { key: "signed", label: "Signed", target: 2, targetLabel: "≥ 2" },
  { key: "plaid_connected", label: "Plaid connected", target: 1.5, targetLabel: "≥ 1.5" },
  { key: "fallback_appointments", label: "Fallback appts", target: 4, targetLabel: "4–6" },
];
/* ⭐ marks the two metrics the whole model turns on (per plan_kpis funnel). */
const STAR_METRICS = new Set<keyof ScorecardCounts>(["signed", "plaid_connected"]);

interface ScorecardCounts {
  dials: number;
  live_conversations: number;
  application_attempts: number;
  signed: number;
  plaid_connected: number;
  fallback_appointments: number;
}
interface ScorecardRow extends ScorecardCounts {
  id: string;
  user_id: string | null;
  setter_name: string | null;
  date: string;
}
const ZERO_COUNTS: ScorecardCounts = {
  dials: 0,
  live_conversations: 0,
  application_attempts: 0,
  signed: 0,
  plaid_connected: 0,
  fallback_appointments: 0,
};

/* Local YYYY-MM-DD (the scorecard is a per-day, per-setter row). */
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function daysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
/* Monday of the current week — matches Postgres date_trunc('week', …) used by the
   ph_scorecard_weekly view, so we can read this setter's current-week row. */
function weekStartISO(): string {
  const d = new Date();
  const dow = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - dow);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function isMissingTable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return err.code === "42P01" || /relation .* does not exist|could not find the table/i.test(err.message ?? "");
}

// supabase.functions.invoke hides a non-2xx body in error.context; pull the
// server's { error } out so the setter sees the real reason, not the generic
// "non-2xx status" string.
async function invokeThrow(error: unknown): Promise<never> {
  const ctx = (error as { context?: { json?: () => Promise<unknown> } } | null)?.context;
  if (ctx && typeof ctx.json === "function") {
    const body = (await ctx.json().catch(() => null)) as { error?: string } | null;
    if (body?.error) throw new Error(body.error);
  }
  throw new Error((error as { message?: string } | null)?.message ?? "Request failed.");
}

/* Active lead loaded into the workspace — drives Send packet + the Plaid chip. */
interface ActiveLead {
  customerId: string;
  label: string;
  dealId: string | null;
}

export default function PhSetterPlaybookPage() {
  const { profile, effectiveUserId } = useUserProfile();
  const [items, setItems] = useState<RndItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "error" | "warn" } | null>(null);
  const notify = (text: string, tone: "ok" | "error" | "warn" = "ok") => setToast({ text, tone });

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("rnd_items")
        .select("id, section, label, content, sort_order")
        .in("section", ["plan_pipeline", "plan_scripts", "plan_automations"])
        .order("sort_order", { ascending: true });
      setItems((data as RndItem[]) ?? []);
      setLoading(false);
    })();
  }, []);

  const pipeline = useMemo(
    () =>
      items
        .filter((i) => i.section === "plan_pipeline")
        .sort((a, b) => (a.content.stageNum ?? 0) - (b.content.stageNum ?? 0)),
    [items],
  );
  const scriptByLabel = useMemo(() => {
    const m: Record<string, RndItem> = {};
    for (const i of items) if (i.section === "plan_scripts") m[i.label] = i;
    return m;
  }, [items]);
  const objections = useMemo(
    () => items.find((i) => i.section === "plan_scripts" && i.label === "Objection bank")?.content,
    [items],
  );
  const automationByStage = useMemo(() => {
    const m: Record<string, RndItem> = {};
    for (const i of items) if (i.section === "plan_automations") m[i.label] = i;
    return m;
  }, [items]);

  const [activeLead, setActiveLead] = useState<ActiveLead | null>(null);

  return (
    <div className="p-6 max-w-4xl space-y-6" data-playbook-id={PH_PLAYBOOK_ID}>
      {/* Header */}
      <div className="flex items-start gap-3">
        <PhoneArrowUpRightIcon className="w-8 h-8 shrink-0 text-ocean-blue" />
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">PH Setter Playbook</h1>
            <span className="inline-flex items-center gap-1 rounded-full bg-ocean-blue text-white px-2 py-0.5 text-[11px] font-bold">
              PH · Outbound Setters
            </span>
          </div>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Dial the list, drive every live call to a <strong className="font-semibold text-gray-700 dark:text-gray-300">complete file</strong>{" "}
            (e-signed agreement + Plaid), and hand off at Bank Connected. Say-this scripts are pinned at each stage.
          </p>
        </div>
      </div>

      {/* DAILY SCORECARD — always expanded, the setter's primary daily tool */}
      <Scorecard profileId={effectiveUserId ?? profile?.id ?? null} setterName={profile?.display_name ?? profile?.email ?? null} notify={notify} />

      {/* ACTIVE LEAD — powers Send packet + the Plaid chip on the stage cards */}
      <ActiveLeadBar lead={activeLead} onLoad={setActiveLead} onClear={() => setActiveLead(null)} notify={notify} />

      {/* THE 9-STAGE PIPELINE */}
      <div>
        <h2 className="text-base font-bold text-gray-900 dark:text-white mb-1">The Setter Pipeline — 9 stages</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Each stage: what it means, the exact words to say, the action, and how to move it. Cards are closed — tap to open.
        </p>
        {loading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading the playbook…</p>
        ) : (
          <div className="space-y-3">
            {pipeline.map((stage) => (
              <StageCard
                key={stage.id}
                stage={stage}
                guide={STAGE_GUIDE[stage.content.stageNum ?? 0]}
                scriptByLabel={scriptByLabel}
                objections={objections}
                automation={automationByStage[stage.content.stageName ?? stage.label]}
                lead={activeLead}
                notify={notify}
              />
            ))}
          </div>
        )}
      </div>

      {/* Source-of-truth footer — traceability for the owner */}
      <p className="text-[11px] text-gray-400 dark:text-gray-500">
        Stage content is read live from the R&D plan (rnd_items · plan_pipeline / plan_scripts). GHL pipeline{" "}
        <span className="font-mono">{GHL_PH_PIPELINE}</span> — PH · Outbound Setters.
      </p>

      {/* Toast — bottom-right, no browser popups (house rule) */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 max-w-sm rounded-lg bg-gray-900 dark:bg-gray-700 text-white shadow-xl px-4 py-3 flex items-start gap-3">
          {toast.tone === "error" ? (
            <ExclamationTriangleIcon className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          ) : toast.tone === "warn" ? (
            <ExclamationTriangleIcon className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          ) : (
            <CheckCircleIcon className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
          )}
          <p className="text-sm">{toast.text}</p>
          <button onClick={() => setToast(null)} className="shrink-0 text-gray-400 hover:text-white">
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Daily scorecard ─────────────────────────── */
function Scorecard({
  profileId,
  setterName,
  notify,
}: {
  profileId: string | null;
  setterName: string | null;
  notify: (t: string, tone?: "ok" | "error" | "warn") => void;
}) {
  const [counts, setCounts] = useState<ScorecardCounts>(ZERO_COUNTS);
  const [rowId, setRowId] = useState<string | null>(null);
  const [week, setWeek] = useState<ScorecardCounts>(ZERO_COUNTS);
  // Signed → Plaid conversion for the current week (funnel KPI: ≥ 70%). Comes
  // from the ph_scorecard_weekly view when available; null otherwise.
  const [plaidRate, setPlaidRate] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [backendReady, setBackendReady] = useState(true);
  const today = todayISO();

  const load = useCallback(async () => {
    if (!profileId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("ph_setter_scorecards")
      .select("id, user_id, setter_name, date, dials, live_conversations, application_attempts, signed, plaid_connected, fallback_appointments")
      .eq("user_id", profileId)
      .gte("date", daysAgoISO(6))
      .lte("date", today)
      .order("date", { ascending: false });
    if (error) {
      if (isMissingTable(error)) setBackendReady(false);
      setLoading(false);
      return;
    }
    setBackendReady(true);
    const rows = (data as ScorecardRow[]) ?? [];
    const todays = rows.find((r) => r.date === today);
    if (todays) {
      setRowId(todays.id);
      setCounts({
        dials: todays.dials ?? 0,
        live_conversations: todays.live_conversations ?? 0,
        application_attempts: todays.application_attempts ?? 0,
        signed: todays.signed ?? 0,
        plaid_connected: todays.plaid_connected ?? 0,
        fallback_appointments: todays.fallback_appointments ?? 0,
      });
    } else {
      setRowId(null);
      setCounts(ZERO_COUNTS);
    }
    // Weekly rollup — prefer the ph_scorecard_weekly view (ISO week + conversion
    // ratios). Fall back to a client-side sum of the last-7-days rows if the view
    // isn't deployed yet, so the strip always shows something honest.
    const weekly = await supabase
      .from("ph_scorecard_weekly")
      .select("dials, live_conversations, application_attempts, signed, plaid_connected, fallback_appointments, plaid_rate")
      .eq("user_id", profileId)
      .eq("week_start", weekStartISO())
      .maybeSingle();
    if (!weekly.error && weekly.data) {
      const w = weekly.data as ScorecardCounts & { plaid_rate: number | null };
      setWeek({
        dials: w.dials ?? 0,
        live_conversations: w.live_conversations ?? 0,
        application_attempts: w.application_attempts ?? 0,
        signed: w.signed ?? 0,
        plaid_connected: w.plaid_connected ?? 0,
        fallback_appointments: w.fallback_appointments ?? 0,
      });
      setPlaidRate(w.plaid_rate ?? null);
    } else {
      const sum = rows.reduce<ScorecardCounts>(
        (acc, r) => ({
          dials: acc.dials + (r.dials ?? 0),
          live_conversations: acc.live_conversations + (r.live_conversations ?? 0),
          application_attempts: acc.application_attempts + (r.application_attempts ?? 0),
          signed: acc.signed + (r.signed ?? 0),
          plaid_connected: acc.plaid_connected + (r.plaid_connected ?? 0),
          fallback_appointments: acc.fallback_appointments + (r.fallback_appointments ?? 0),
        }),
        { ...ZERO_COUNTS },
      );
      setWeek(sum);
      setPlaidRate(sum.signed > 0 ? sum.plaid_connected / sum.signed : null);
    }
    setLoading(false);
  }, [profileId, today]);

  useEffect(() => {
    load();
  }, [load]);

  const set = (key: keyof ScorecardCounts, v: string) =>
    setCounts((c) => ({ ...c, [key]: Math.max(0, Math.round(Number(v) || 0)) }));

  async function save() {
    if (!profileId) {
      notify("No user profile — can't attribute this scorecard.", "error");
      return;
    }
    setSaving(true);
    try {
      // setter_name is NOT NULL in the table — coalesce so a login without a
      // display name still records a row.
      const payload = { user_id: profileId, setter_name: setterName || "Setter", date: today, ...counts };
      if (rowId) {
        await mustWrite("update scorecard", supabase.from("ph_setter_scorecards").update(counts).eq("id", rowId));
      } else {
        const inserted = await mustWrite<{ id: string }>(
          "insert scorecard",
          supabase.from("ph_setter_scorecards").insert(payload).select("id"),
        );
        if (inserted[0]?.id) setRowId(inserted[0].id);
      }
      notify("Scorecard saved for today.");
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not save the scorecard.";
      if (/does not exist|find the table/i.test(msg)) {
        setBackendReady(false);
        notify("Scorecard table isn't deployed yet — the backend migration is still landing.", "warn");
      } else {
        notify(msg, "error");
      }
    } finally {
      setSaving(false);
    }
  }

  if (!backendReady) {
    return (
      <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4">
        <p className="text-sm font-semibold text-amber-800 dark:text-amber-200 flex items-center gap-2">
          <ExclamationTriangleIcon className="w-5 h-5" /> Daily scorecard — backend not ready
        </p>
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
          The <code>ph_setter_scorecards</code> table isn't deployed yet. Once the backend migration lands, the entry form and
          targets appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <StarIcon className="w-5 h-5 text-mint-green" />
        <h2 className="text-base font-bold text-gray-900 dark:text-white">Daily Scorecard</h2>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {new Date(today + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
        </span>
        {setterName && (
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
            <UserCircleIcon className="w-4 h-4" /> {setterName}
          </span>
        )}
      </div>

      {/* Entry grid + per-metric target chip (green/red vs entered) */}
      <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
        {DAILY_METRICS.map((m) => {
          const v = counts[m.key];
          const hit = v >= m.target;
          return (
            <div key={m.key} className="rounded-lg border border-gray-100 dark:border-gray-700 p-2.5">
              <label className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                {STAR_METRICS.has(m.key) && <span className="text-mint-green">⭐</span>}
                {m.label}
              </label>
              <input
                type="number"
                min={0}
                value={v === 0 ? "" : v}
                onChange={(e) => set(m.key, e.target.value)}
                placeholder="0"
                disabled={loading}
                className="mt-1 w-full rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1.5 text-lg font-bold text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-ocean-blue"
              />
              <span
                className={`mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                  hit
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                    : "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
                }`}
              >
                {hit ? "on target" : "under"} · {m.targetLabel}
              </span>
            </div>
          );
        })}
      </div>

      <button
        onClick={save}
        disabled={saving || loading}
        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-ocean-blue px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
      >
        {saving ? "Saving…" : rowId ? "Update today's scorecard" : "Save today's scorecard"}
      </button>

      {/* Weekly rollup — last 7 days, this setter */}
      <div className="mt-4 border-t border-gray-100 dark:border-gray-700 pt-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2">
          This week (from{" "}
          {new Date(weekStartISO() + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })})
        </p>
        <div className="flex flex-wrap gap-2 text-xs">
          <WeekChip label="Dials" value={week.dials} />
          <WeekChip label="Live convos" value={week.live_conversations} />
          <WeekChip label="App attempts" value={week.application_attempts} />
          <WeekChip label="Signed" value={week.signed} target="10–14" hit={week.signed >= 10} star />
          <WeekChip label="Plaid" value={week.plaid_connected} target="8–11" hit={week.plaid_connected >= 8} star />
          <WeekChip label="Fallback" value={week.fallback_appointments} />
          {plaidRate !== null && (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold ${
                plaidRate >= 0.7
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                  : "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
              }`}
              title="Signed → Plaid conversion (funnel target ≥ 70%)"
            >
              ⭐ Signed→Plaid: <span className="font-bold">{Math.round(plaidRate * 100)}%</span>
              <span className="opacity-70">/ ≥ 70%</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function WeekChip({
  label,
  value,
  target,
  hit,
  star,
}: {
  label: string;
  value: number;
  target?: string;
  hit?: boolean;
  star?: boolean;
}) {
  const toned =
    target !== undefined
      ? hit
        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
        : "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
      : "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold ${toned}`}>
      {star && <span>⭐</span>}
      {label}: <span className="font-bold">{value}</span>
      {target && <span className="opacity-70">/ {target}</span>}
    </span>
  );
}

/* ─────────────────────────── Active lead bar ─────────────────────────── */
interface CustomerHit {
  id: string;
  business_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
}
function ActiveLeadBar({
  lead,
  onLoad,
  onClear,
  notify,
}: {
  lead: ActiveLead | null;
  onLoad: (l: ActiveLead) => void;
  onClear: () => void;
  notify: (t: string, tone?: "ok" | "error" | "warn") => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<CustomerHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      const like = `%${term}%`;
      const { data } = await supabase
        .from("customers")
        .select("id, business_name, first_name, last_name, phone")
        .or(`business_name.ilike.${like},phone.ilike.${like},last_name.ilike.${like},first_name.ilike.${like}`)
        .limit(8);
      setHits((data as CustomerHit[]) ?? []);
      setSearching(false);
      setOpen(true);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  async function pick(h: CustomerHit) {
    // Attach the customer's most recent deal id (if any) so the Plaid chip and
    // packet send can target it. Setter leads may have no deal yet — that's fine.
    const { data } = await supabase
      .from("deals")
      .select("id")
      .eq("customer_id", h.id)
      .order("created_at", { ascending: false })
      .limit(1);
    const dealId = (data as { id: string }[] | null)?.[0]?.id ?? null;
    const label = h.business_name || [h.first_name, h.last_name].filter(Boolean).join(" ") || "Lead";
    onLoad({ customerId: h.id, label, dealId });
    setQ("");
    setHits([]);
    setOpen(false);
    notify(`Loaded ${label}.`);
  }

  if (lead) {
    return (
      <div className="rounded-xl border border-ocean-blue/40 bg-ocean-blue/5 dark:bg-ocean-blue/10 px-4 py-3 flex flex-wrap items-center gap-2">
        <UserCircleIcon className="w-5 h-5 text-ocean-blue" />
        <span className="text-sm font-semibold text-gray-900 dark:text-white">{lead.label}</span>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            lead.dealId
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
              : "bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300"
          }`}
        >
          {lead.dealId ? "deal linked" : "no deal yet"}
        </span>
        <span className="text-xs text-gray-500 dark:text-gray-400">— Send packet + Plaid target this lead</span>
        <button onClick={onClear} className="ml-auto text-xs font-medium text-gray-500 hover:text-gray-800 dark:hover:text-white underline">
          Clear
        </button>
      </div>
    );
  }

  return (
    <div ref={boxRef} className="relative">
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3 flex items-center gap-2">
        <MagnifyingGlassIcon className="w-5 h-5 text-gray-400 shrink-0" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => hits.length && setOpen(true)}
          placeholder="Load a lead (business, name, or phone) to enable Send packet + Plaid…"
          className="flex-1 bg-transparent text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none"
        />
        {searching && <span className="text-xs text-gray-400">searching…</span>}
      </div>
      {open && hits.length > 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl overflow-hidden">
          {hits.map((h) => (
            <button
              key={h.id}
              onClick={() => pick(h)}
              className="w-full text-left px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 border-b border-gray-100 dark:border-gray-700 last:border-0"
            >
              <span className="block text-sm font-semibold text-gray-900 dark:text-white">
                {h.business_name || [h.first_name, h.last_name].filter(Boolean).join(" ") || "Lead"}
              </span>
              {h.phone && <span className="block text-xs text-gray-500 dark:text-gray-400">{h.phone}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Stage card ─────────────────────────── */
function StageCard({
  stage,
  guide,
  scriptByLabel,
  objections,
  automation,
  lead,
  notify,
}: {
  stage: RndItem;
  guide?: StageGuide;
  scriptByLabel: Record<string, RndItem>;
  objections?: RndContent;
  automation?: RndItem;
  lead: ActiveLead | null;
  notify: (t: string, tone?: "ok" | "error" | "warn") => void;
}) {
  const c = stage.content;
  const color = c.color ?? "gray";
  return (
    <details className={`group rounded-xl border overflow-hidden ${STAGE_CARD[color] ?? STAGE_CARD.gray}`}>
      <summary className="flex cursor-pointer list-none items-center gap-3 p-3.5 select-none">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white text-xs font-bold ${
            STAGE_DOT[color] ?? STAGE_DOT.gray
          }`}
        >
          {c.stageNum}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-gray-900 dark:text-white">{c.stageName ?? stage.label}</span>
            {c.handoff && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600 text-white px-2 py-0.5 text-[10px] font-bold">
                <ArrowRightCircleIcon className="w-3 h-3" /> handoff
              </span>
            )}
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-400 truncate">{c.definition}</p>
        </div>
        <ArrowRightIcon className="w-4 h-4 shrink-0 text-gray-400 transition group-open:rotate-90" />
      </summary>

      <div className="border-t border-black/5 dark:border-white/10 bg-white/60 dark:bg-gray-900/40 p-4 space-y-4">
        {/* Definition (full) */}
        <p className="text-sm text-gray-700 dark:text-gray-300">{c.definition}</p>

        {/* Action */}
        {guide?.action && (
          <div className="rounded-lg border border-ocean-blue/30 bg-ocean-blue/5 dark:bg-ocean-blue/10 p-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-ocean-blue mb-1 flex items-center gap-1">
              <BoltIcon className="w-3.5 h-3.5" /> Do this
            </p>
            <p className="text-sm text-gray-800 dark:text-gray-100 leading-relaxed">{guide.action}</p>
          </div>
        )}

        {/* Send packet — Application Attempt only */}
        {guide?.isPacketStage && <SendPacket lead={lead} notify={notify} />}

        {/* Plaid chip + handoff — Bank Connected only */}
        {guide?.isBankStage && <BankConnected lead={lead} />}

        {/* Say-this scripts */}
        {guide?.scripts.map((label) => {
          const s = scriptByLabel[label];
          if (!s) return null;
          return <ScriptBlock key={label} item={s} />;
        })}

        {/* Objection bank (stages that field pushback) */}
        {guide?.showObjections && objections?.objections && objections.objections.length > 0 && (
          <details className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40">
            <summary className="flex cursor-pointer list-none items-center gap-2 p-2.5 text-sm font-semibold text-gray-900 dark:text-white">
              <ChatBubbleLeftRightIcon className="w-4 h-4 text-ocean-blue" /> Objection bank
              <span className="text-xs font-normal text-gray-400">({objections.objections.length})</span>
            </summary>
            <div className="px-2.5 pb-2.5 space-y-2">
              {objections.coach_note && (
                <p className="text-[11px] italic text-gray-500 dark:text-gray-400 leading-relaxed">{objections.coach_note}</p>
              )}
              {objections.objections.map((o, i) => (
                <div key={i} className="rounded-md border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 px-2.5 py-2">
                  <p className="text-xs font-semibold text-gray-900 dark:text-white">“{o.q}”</p>
                  <p className="mt-0.5 text-xs italic text-gray-600 dark:text-gray-400 leading-relaxed">→ {o.a}</p>
                </div>
              ))}
            </div>
          </details>
        )}

        {/* What fires here (automation) */}
        {automation && (automation.content.trigger || automation.content.action) && (
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">What fires here</p>
            <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">
              <span className="font-semibold">{automation.content.trigger}</span> — {automation.content.action}
            </p>
          </div>
        )}

        {/* Transition guidance */}
        {guide?.transition && (
          <div className="flex items-start gap-2 rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-100 dark:border-gray-700 px-3 py-2">
            <ArrowRightCircleIcon className="w-4 h-4 shrink-0 mt-0.5 text-gray-500 dark:text-gray-400" />
            <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">
              <span className="font-semibold">Move it:</span> {guide.transition}
            </p>
          </div>
        )}
      </div>
    </details>
  );
}

/* One say-this script: verbatim line, resistance/fallback ladder, all from DB. */
function ScriptBlock({ item }: { item: RndItem }) {
  const c = item.content;
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-bold text-gray-900 dark:text-white">{item.label}</p>
        {c.draft && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-2 py-0.5 text-[10px] font-semibold">
            <ExclamationTriangleIcon className="w-3 h-3" /> draft — owner to confirm
          </span>
        )}
      </div>
      {c.script && (
        <p className="mt-1.5 text-sm italic text-gray-700 dark:text-gray-300 leading-relaxed">“{c.script}”</p>
      )}
      {c.ladder && c.ladder.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {c.ladder.map((rung, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0 rounded-full bg-ocean-blue/10 text-ocean-blue px-2 py-0.5 text-[10px] font-bold">
                {rung.label ?? rung.step}
              </span>
              <span className="text-xs italic text-gray-700 dark:text-gray-300 leading-relaxed">“{rung.text}”</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* Send packet — Application Attempt action. Calls ph-send-packet and reports the
   partial (workflow-not-built) case HONESTLY: link minted + field written, but
   no email went out. */
function SendPacket({
  lead,
  notify,
}: {
  lead: ActiveLead | null;
  notify: (t: string, tone?: "ok" | "error" | "warn") => void;
}) {
  const [busy, setBusy] = useState(false);
  const [packetUrl, setPacketUrl] = useState<string | null>(null);

  async function send() {
    if (!lead) return;
    setBusy(true);
    setPacketUrl(null);
    try {
      const { data, error } = await supabase.functions.invoke("ph-send-packet", {
        body: { customerId: lead.customerId, dealId: lead.dealId ?? undefined },
      });
      // A genuine failure comes back as a non-2xx and lands in `error` — surface
      // the server's reason. On a 200 the function ALWAYS returns ok:true; a
      // partial success ALSO carries an `error` (the runbook reason), so we must
      // NOT treat that `error` as a failure.
      if (error) await invokeThrow(error);
      const res = (data ?? {}) as {
        ok?: boolean;
        partial?: boolean;
        url?: string;
        error?: string;
        field_verified?: boolean;
      };
      if (!res.ok) throw new Error(res.error ?? "The packet send did not complete.");
      if (res.url) setPacketUrl(res.url);
      if (res.partial) {
        // Honest partial: link minted + written to the GHL contact, but the PH 01
        // workflow isn't wired, so NOTHING was sent to the merchant.
        notify(
          `Packet link minted + written to the contact (verified=${res.field_verified ? "yes" : "no"}) — but the PH 01 workflow isn't built yet, so NO email/SMS went out. Send it manually (see runbook).`,
          "warn",
        );
      } else {
        notify("Packet sent — the merchant gets the connect-bank link to complete the file live on the call.");
      }
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not send the packet.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-purple-300 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20 p-3">
      {lead ? (
        <>
          <button
            onClick={send}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            <PaperAirplaneIcon className="w-4 h-4" />
            {busy ? "Sending…" : `Send packet to ${lead.label}`}
          </button>
          <p className="mt-1.5 text-[11px] text-gray-600 dark:text-gray-400">
            Mints the merchant's connect-bank link and sends it via the PH packet workflow. Stage moves never auto-send — this
            is the explicit send.
          </p>
          {packetUrl && (
            <button
              onClick={() => {
                navigator.clipboard?.writeText(packetUrl).then(
                  () => notify("Packet link copied."),
                  () => notify("Couldn't copy — the link is shown below.", "warn"),
                );
              }}
              className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-purple-700 dark:text-purple-300 hover:underline break-all"
            >
              <ClipboardDocumentIcon className="w-3.5 h-3.5 shrink-0" /> Copy packet link
            </button>
          )}
        </>
      ) : (
        <p className="text-xs text-gray-600 dark:text-gray-400">
          Load a lead above to send the packet from here.
        </p>
      )}
    </div>
  );
}

/* Bank Connected — the Plaid ground-truth chip (reuses useDealPlaidItem) plus
   the handoff guidance. Handoff into the main pipeline is manual for now. */
function BankConnected({ lead }: { lead: ActiveLead | null }) {
  return (
    <div className="rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 p-3 space-y-2">
      {lead ? (
        <PlaidChip dealId={lead.dealId} customerId={lead.customerId} />
      ) : (
        <p className="text-xs text-gray-600 dark:text-gray-400">Load a lead above to see its bank-connection status.</p>
      )}
      <div className="flex items-start gap-2">
        <ArrowRightCircleIcon className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
        <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">
          <span className="font-semibold">Hand off to the main pipeline:</span> a complete file (signed + Plaid) is the ONLY
          record that crosses into the existing business. Handoff is <span className="font-semibold">manual for now</span> — flag
          the owner/closer so a deal is created in the main pipeline.
        </p>
      </div>
    </div>
  );
}

function PlaidChip({ dealId, customerId }: { dealId: string | null; customerId: string }) {
  const { item, loading } = useDealPlaidItem(dealId ?? "", customerId);
  if (loading) return <span className="text-xs text-gray-500 dark:text-gray-400">Checking bank connection…</span>;
  if (!item || item.status !== "active") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 px-2.5 py-1 text-xs font-bold">
        <BuildingLibraryIcon className="w-4 h-4" /> Bank not connected ✗
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 px-2.5 py-1 text-xs font-bold">
      <BuildingLibraryIcon className="w-4 h-4" /> Bank connected ✓
      {item.institution_name ? ` · ${item.institution_name}` : ""}
      {item.statements_count ? ` · ${item.statements_count} stmts` : ""}
    </span>
  );
}
