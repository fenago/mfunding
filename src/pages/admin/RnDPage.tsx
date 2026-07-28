import { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  BeakerIcon,
  ArrowTopRightOnSquareIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  BoltIcon,
  ShieldExclamationIcon,
  StarIcon,
  CalendarDaysIcon,
  PencilSquareIcon,
  PhoneIcon,
  EnvelopeIcon,
  GlobeAltIcon,
  ExclamationTriangleIcon,
  BuildingLibraryIcon,
  UserGroupIcon,
  CheckBadgeIcon,
} from "@heroicons/react/24/outline";
import supabase from "@/supabase";
import { mustWrite } from "@/supabase/writes";
import { useUserProfile } from "@/context/UserProfileContext";

/* ------------------------------------------------------------------ */
/* R&D — the owner's MCA operation build-out, made living.            */
/* Every task carries a tap-to-cycle status; the plan tracks itself.  */
/* Backed by public.rnd_items (see 20260728_rnd_items.sql).           */
/* ------------------------------------------------------------------ */

type Kind = "task" | "link" | "note" | "metric";
type Status = "todo" | "doing" | "done" | "n_a";

interface Content {
  who?: string;
  numbers?: string;
  step?: number;
  cost?: string;
  detail?: string;
  body?: string;
  link?: string;
  linkLabel?: string;
  appLink?: string;
  appLinkLabel?: string;
  alreadyBuilt?: boolean;
  unverified?: boolean;
  url?: string;
  purpose?: string;
  phone?: string; // digits for tel:  e.g. +18664280172
  phoneDisplay?: string; // human-readable  e.g. (866) 428-0172
  email?: string; // for mailto:
  note?: string; // caveat / honesty note
  gain?: string;
  odds?: string;
  recommended?: boolean;
  // roles & hiring
  role?: string;
  aka?: string;
  definition?: string;
  responsibilities?: string[];
  comp?: string;
  compLabel?: string;
  compRule?: string;
  sources?: {
    label: string;
    url?: string;
    appLink?: string;
    appLinkLabel?: string;
    unverified?: boolean;
  }[];
  builtBadge?: string;
  builtDetail?: string;
  rule?: string;
  ruleRef?: string;
  // economics table columns
  months?: string;
  team?: string;
  deals?: string;
  gross?: string;
  ownerHrs?: string;
}

interface RndItem {
  id: string;
  section: string;
  label: string;
  kind: Kind;
  content: Content;
  status: Status;
  sort_order: number;
  notes: string | null;
}

const STATUS_CYCLE: Record<Status, Status> = {
  todo: "doing",
  doing: "done",
  done: "n_a",
  n_a: "todo",
};

const STATUS_CHIP: Record<Status, { label: string; cls: string }> = {
  todo: {
    label: "To do",
    cls: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-600",
  },
  doing: {
    label: "Doing",
    cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 border-amber-200 dark:border-amber-800",
  },
  done: {
    label: "Done ✓",
    cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800",
  },
  n_a: {
    label: "N/A",
    cls: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 border-slate-200 dark:border-slate-700 line-through",
  },
};

/* ---------------------------- shared bits --------------------------- */

function AlreadyBuilt() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-mint-green/15 text-mint-green px-2 py-0.5 text-[11px] font-semibold">
      <CheckCircleIcon className="w-3.5 h-3.5" /> Already built
    </span>
  );
}

function CostChip({ cost }: { cost: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-ocean-blue/10 text-ocean-blue px-2 py-0.5 text-[11px] font-bold">
      {cost}
    </span>
  );
}

/* Tappable resource + contact chips: external link, in-app link, tel:, mailto:.
   Phones use content.phone (digits) for the tel: target and phoneDisplay for
   the label. Renders nothing for fields that aren't present. */
function ContactChips({ c }: { c: Content }) {
  const hasAny = c.link || c.appLink || c.url || c.phone || c.email;
  if (!hasAny) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {c.link && (
        <a
          href={c.link}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-semibold text-ocean-blue hover:underline"
        >
          {c.linkLabel ?? c.link} <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" />
        </a>
      )}
      {c.url && !c.link && (
        <a
          href={c.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-semibold text-ocean-blue hover:underline"
        >
          <GlobeAltIcon className="w-3.5 h-3.5" /> Website
        </a>
      )}
      {c.phone && (
        <a
          href={`tel:${c.phone}`}
          className="inline-flex items-center gap-1 text-xs font-semibold text-ocean-blue hover:underline"
        >
          <PhoneIcon className="w-3.5 h-3.5" /> {c.phoneDisplay ?? c.phone}
        </a>
      )}
      {c.email && (
        <a
          href={`mailto:${c.email}`}
          className="inline-flex items-center gap-1 text-xs font-semibold text-ocean-blue hover:underline"
        >
          <EnvelopeIcon className="w-3.5 h-3.5" /> {c.email}
        </a>
      )}
      {c.appLink && (
        <Link
          to={c.appLink}
          className="inline-flex items-center gap-1 text-xs font-semibold text-mint-green hover:underline"
        >
          {c.appLinkLabel ?? c.appLink} <ArrowRightIcon className="w-3.5 h-3.5" />
        </Link>
      )}
    </div>
  );
}

/* Inline, no-popup note editor. Click to edit; saves on blur. */
function InlineNote({
  value,
  onSave,
}: {
  value: string | null;
  onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");

  useEffect(() => {
    if (!editing) setDraft(value ?? "");
  }, [value, editing]);

  if (editing) {
    return (
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if ((draft ?? "").trim() !== (value ?? "").trim()) onSave(draft.trim());
        }}
        rows={2}
        placeholder="Add a note…"
        className="mt-1 w-full rounded-md border border-ocean-blue/40 bg-white dark:bg-gray-900 px-2 py-1 text-xs text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-ocean-blue"
      />
    );
  }
  return (
    <button
      onClick={() => setEditing(true)}
      className="mt-1 inline-flex items-start gap-1 text-left text-xs text-gray-500 dark:text-gray-400 hover:text-ocean-blue"
    >
      <PencilSquareIcon className="w-3.5 h-3.5 shrink-0 mt-0.5" />
      {value ? (
        <span className="italic">{value}</span>
      ) : (
        <span className="opacity-70">Add a note</span>
      )}
    </button>
  );
}

function StatusButton({
  status,
  onCycle,
}: {
  status: Status;
  onCycle: () => void;
}) {
  const chip = STATUS_CHIP[status];
  return (
    <button
      onClick={onCycle}
      title="Tap to cycle: To do → Doing → Done → N/A"
      className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition hover:brightness-95 ${chip.cls}`}
    >
      {chip.label}
    </button>
  );
}

/* Collapsible section. Closed by default — except `open` (This Week). */
function Section({
  title,
  subtitle,
  icon: Icon,
  progress,
  open = false,
  children,
}: {
  title: string;
  subtitle?: string;
  icon: React.ComponentType<{ className?: string }>;
  progress?: { done: number; total: number };
  open?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details
      open={open}
      className="group rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden"
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 p-4 select-none">
        <Icon className="w-6 h-6 shrink-0 text-ocean-blue" />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold text-gray-900 dark:text-white">{title}</h2>
          {subtitle && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{subtitle}</p>
          )}
        </div>
        {progress && progress.total > 0 && (
          <span className="shrink-0 rounded-full bg-ocean-blue/10 text-ocean-blue px-2.5 py-1 text-xs font-bold">
            {progress.done}/{progress.total}
          </span>
        )}
        <ArrowRightIcon className="w-4 h-4 shrink-0 text-gray-400 transition group-open:rotate-90" />
      </summary>
      <div className="border-t border-gray-100 dark:border-gray-700 p-4">{children}</div>
    </details>
  );
}

/* A task row used by the build phases + This Week. */
function TaskRow({
  item,
  onCycle,
  onNote,
}: {
  item: RndItem;
  onCycle: (i: RndItem) => void;
  onNote: (i: RndItem, v: string) => void;
}) {
  const c = item.content;
  const done = item.status === "done" || item.status === "n_a";
  return (
    <div className="flex items-start gap-3 py-3 border-b border-gray-100 dark:border-gray-700 last:border-0">
      <StatusButton status={item.status} onCycle={() => onCycle(item)} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`text-sm font-semibold ${
              done
                ? "text-gray-400 dark:text-gray-500"
                : "text-gray-900 dark:text-white"
            }`}
          >
            {item.label}
          </span>
          {c.cost && <CostChip cost={c.cost} />}
          {c.alreadyBuilt && <AlreadyBuilt />}
        </div>
        {c.detail && (
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
            {c.detail}
          </p>
        )}
        <div className="mt-1.5">
          <ContactChips c={c} />
        </div>
        {c.note && (
          <p className="mt-1 text-[11px] italic text-gray-400 dark:text-gray-500 leading-relaxed">
            {c.note}
          </p>
        )}
        <InlineNote value={item.notes} onSave={(v) => onNote(item, v)} />
      </div>
    </div>
  );
}

/* A "built" badge for role cards: green when fully built, blue when partial. */
function BuiltBadge({ label }: { label: string }) {
  const partial = /partial/i.test(label);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        partial
          ? "bg-ocean-blue/15 text-ocean-blue"
          : "bg-mint-green/15 text-mint-green"
      }`}
    >
      <CheckBadgeIcon className="w-3.5 h-3.5" /> {label} ✓
    </span>
  );
}

/* One role card: definition, responsibilities, comp norms (labelled estimate),
   where to hire (verified links; unverified sources flagged, not linked), and
   the plan rule that binds the role — cross-referenced to Rules That Keep It Alive. */
function RoleCard({ c }: { c: Content }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <UserGroupIcon className="w-5 h-5 text-ocean-blue" />
        <span className="text-base font-bold text-gray-900 dark:text-white">{c.role}</span>
        {c.aka && (
          <span className="text-xs text-gray-400 dark:text-gray-500">({c.aka})</span>
        )}
        {c.builtBadge && <BuiltBadge label={c.builtBadge} />}
      </div>

      {c.definition && (
        <p className="mt-2 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
          {c.definition}
        </p>
      )}

      {c.responsibilities && c.responsibilities.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">
            What they do
          </p>
          <ul className="space-y-1">
            {c.responsibilities.map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-gray-700 dark:text-gray-300">
                <CheckCircleIcon className="w-3.5 h-3.5 shrink-0 mt-0.5 text-mint-green" />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {c.comp && (
        <div className="mt-3 rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-100 dark:border-gray-700 px-3 py-2">
          <div className="flex items-center gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
              Comp
            </p>
            {c.compLabel && (
              <span className="rounded-full bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 text-[10px] font-semibold">
                {c.compLabel}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-gray-800 dark:text-gray-100">{c.comp}</p>
          {c.compRule && (
            <p className="mt-1 text-[11px] font-semibold text-ocean-blue">{c.compRule}</p>
          )}
        </div>
      )}

      {c.builtDetail && (
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
          {c.builtDetail}
        </p>
      )}

      {c.sources && c.sources.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1.5">
            Where to find them
          </p>
          <div className="flex flex-wrap gap-2">
            {c.sources.map((s, i) =>
              s.url ? (
                <a
                  key={i}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-full border border-ocean-blue/30 text-ocean-blue px-2.5 py-1 text-xs font-semibold hover:bg-ocean-blue/5"
                >
                  {s.label} <ArrowTopRightOnSquareIcon className="w-3 h-3" />
                </a>
              ) : s.appLink ? (
                <Link
                  key={i}
                  to={s.appLink}
                  className="inline-flex items-center gap-1 rounded-full border border-mint-green/40 text-mint-green px-2.5 py-1 text-xs font-semibold hover:bg-mint-green/5"
                >
                  {s.appLinkLabel ?? s.label} <ArrowRightIcon className="w-3 h-3" />
                </Link>
              ) : (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 rounded-full border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 px-2.5 py-1 text-xs font-semibold"
                >
                  {s.label} <ExclamationTriangleIcon className="w-3 h-3" /> unverified
                </span>
              ),
            )}
          </div>
        </div>
      )}

      {c.rule && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-rose-50/60 dark:bg-rose-900/10 border border-rose-100 dark:border-rose-900/40 px-3 py-2">
          <ShieldExclamationIcon className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
          <p className="text-xs text-gray-700 dark:text-gray-200 leading-relaxed">
            <span className="font-semibold">Plan rule:</span> {c.rule}
            {c.ruleRef && (
              <span className="text-gray-400 dark:text-gray-500"> — see {c.ruleRef}.</span>
            )}
          </p>
        </div>
      )}
    </div>
  );
}

/* Derive a tel: href from a human-formatted phone string. Returns null when
   there isn't a clean 10/11-digit number (some records hold notes, not numbers). */
function telHref(raw?: string | null): string | null {
  if (!raw) return null;
  const m = raw.match(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
  if (!m) return null;
  const d = m[0].replace(/\D/g, "");
  if (d.length < 10) return null;
  return `+${d.length === 10 ? "1" + d : d}`;
}
const isEmail = (s?: string | null) => !!s && /.+@.+\..+/.test(s);

interface FunderRow {
  company_name: string;
  submission_email: string | null;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  primary_contact_phone: string | null;
}

// The two funders the plan names first — pinned to the top of the outreach list.
const PINNED_FUNDERS = ["True Advance Funding", "Green Note Capital"];

/* Live funder-outreach list. Pulls active funders straight from the network so
   it never goes stale — the Funder Directory stays the system of record. Powers
   the "Email the funders" task with tappable submission emails + rep contacts. */
function FunderOutreach() {
  const [rows, setRows] = useState<FunderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("lenders")
        .select(
          "company_name, submission_email, primary_contact_name, primary_contact_email, primary_contact_phone, funder_submission_profiles!inner(active)",
        )
        .eq("funder_submission_profiles.active", true)
        .order("company_name", { ascending: true });
      if (error) setErr(error.message);
      else setRows((data as unknown as FunderRow[]) ?? []);
      setLoading(false);
    })();
  }, []);

  const sorted = useMemo(() => {
    const rank = (n: string) => {
      const i = PINNED_FUNDERS.indexOf(n);
      return i === -1 ? 99 : i;
    };
    return [...rows].sort(
      (a, b) => rank(a.company_name) - rank(b.company_name) || a.company_name.localeCompare(b.company_name),
    );
  }, [rows]);

  return (
    <Section
      title="Funder Outreach — active funders"
      subtitle={
        loading
          ? "Loading the network…"
          : `Every active funder on file, tappable. Pick your core to email first — True Advance and Green Note are pinned. (${rows.length})`
      }
      icon={BuildingLibraryIcon}
    >
      {err && (
        <p className="text-xs text-rose-600 dark:text-rose-400">Could not load funders: {err}</p>
      )}
      {!err && (
        <div className="grid gap-3 sm:grid-cols-2">
          {sorted.map((f) => {
            const pinned = PINNED_FUNDERS.includes(f.company_name);
            const repTel = telHref(f.primary_contact_phone);
            return (
              <div
                key={f.company_name}
                className={`rounded-xl border p-3 ${
                  pinned
                    ? "border-mint-green/50 bg-mint-green/5 dark:bg-mint-green/10"
                    : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold text-gray-900 dark:text-white">
                    {f.company_name}
                  </span>
                  {pinned && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-mint-green/15 text-mint-green px-2 py-0.5 text-[10px] font-bold">
                      <StarIcon className="w-3 h-3" /> named in plan
                    </span>
                  )}
                </div>
                {isEmail(f.submission_email) && (
                  <a
                    href={`mailto:${f.submission_email}`}
                    className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-ocean-blue hover:underline"
                  >
                    <EnvelopeIcon className="w-3.5 h-3.5" /> Submit: {f.submission_email}
                  </a>
                )}
                {(f.primary_contact_name || f.primary_contact_email || f.primary_contact_phone) && (
                  <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                    {f.primary_contact_name && (
                      <span className="font-medium text-gray-700 dark:text-gray-300">
                        {f.primary_contact_name}
                      </span>
                    )}
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                      {repTel && (
                        <a
                          href={repTel}
                          className="inline-flex items-center gap-1 font-semibold text-ocean-blue hover:underline"
                        >
                          <PhoneIcon className="w-3.5 h-3.5" /> {f.primary_contact_phone?.trim()}
                        </a>
                      )}
                      {!repTel && f.primary_contact_phone?.trim() && (
                        <span className="inline-flex items-center gap-1">
                          <PhoneIcon className="w-3.5 h-3.5" /> {f.primary_contact_phone.trim()}
                        </span>
                      )}
                      {isEmail(f.primary_contact_email) && (
                        <a
                          href={`mailto:${f.primary_contact_email}`}
                          className="inline-flex items-center gap-1 font-semibold text-ocean-blue hover:underline"
                        >
                          <EnvelopeIcon className="w-3.5 h-3.5" /> {f.primary_contact_email}
                        </a>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

/* ------------------------------ page ------------------------------- */

export default function RnDPage() {
  const { profile } = useUserProfile();
  const [items, setItems] = useState<RndItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("rnd_items")
        .select("id, section, label, kind, content, status, sort_order, notes")
        .order("section", { ascending: true })
        .order("sort_order", { ascending: true });
      if (error) {
        setError(error.message);
      } else {
        setItems((data as RndItem[]) ?? []);
      }
      setLoading(false);
    })();
  }, []);

  const bySection = useMemo(() => {
    const m: Record<string, RndItem[]> = {};
    for (const it of items) (m[it.section] ??= []).push(it);
    return m;
  }, [items]);

  const progressOf = useCallback(
    (section: string) => {
      const tasks = (bySection[section] ?? []).filter((i) => i.kind === "task");
      const done = tasks.filter((t) => t.status === "done" || t.status === "n_a").length;
      return { done, total: tasks.length };
    },
    [bySection],
  );

  /* Optimistic status cycle, persisted. Reverts on failure. */
  const cycleStatus = useCallback(
    async (item: RndItem) => {
      const next = STATUS_CYCLE[item.status];
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, status: next } : i)),
      );
      try {
        await mustWrite(
          "cycle rnd_item status",
          supabase
            .from("rnd_items")
            .update({
              status: next,
              updated_at: new Date().toISOString(),
              updated_by: profile?.id ?? null,
            })
            .eq("id", item.id),
        );
      } catch (e) {
        setItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, status: item.status } : i)),
        );
        setError(e instanceof Error ? e.message : "Could not save status");
      }
    },
    [profile?.id],
  );

  const saveNote = useCallback(
    async (item: RndItem, value: string) => {
      const prevNote = item.notes;
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, notes: value || null } : i)),
      );
      try {
        await mustWrite(
          "save rnd_item note",
          supabase
            .from("rnd_items")
            .update({
              notes: value || null,
              updated_at: new Date().toISOString(),
              updated_by: profile?.id ?? null,
            })
            .eq("id", item.id),
        );
      } catch (e) {
        setItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, notes: prevNote } : i)),
        );
        setError(e instanceof Error ? e.message : "Could not save note");
      }
    },
    [profile?.id],
  );

  if (loading) {
    return (
      <div className="p-6 text-sm text-gray-500 dark:text-gray-400">Loading the game plan…</div>
    );
  }

  const op = bySection["operation"] ?? [];
  const opTasks = op.filter((i) => i.kind === "task");
  const opNote = op.find((i) => i.kind === "note");
  const economics = bySection["economics"] ?? [];
  const multipliers = bySection["multipliers"] ?? [];
  const rules = bySection["rules"] ?? [];
  const plaid = bySection["plaid"] ?? [];
  const plaidNotes = plaid.filter((i) => i.kind === "note");
  const plaidPaths = plaid.filter((i) => i.kind === "task");
  const vendors = bySection["vendors"] ?? [];
  const proveNote = (bySection["build_prove"] ?? []).find((i) => i.kind === "note");
  const proveTasks = (bySection["build_prove"] ?? []).filter((i) => i.kind === "task");

  const PHASE_STRIP: { key: string; label: string }[] = [
    { key: "this_week", label: "This Week" },
    { key: "build_infra", label: "Weeks 1–2" },
    { key: "build_staffing", label: "Weeks 3–4" },
    { key: "build_prove", label: "Months 2–3" },
  ];

  return (
    <div className="p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-start gap-3">
        <BeakerIcon className="w-8 h-8 shrink-0 text-ocean-blue" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Research &amp; Development</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            The game plan for standing up the MCA operation — the 8-step machine, the build
            sequence, the economics, and the levers. Tap any task's chip to move it{" "}
            <strong className="font-semibold text-gray-700 dark:text-gray-300">
              To&nbsp;do → Doing → Done
            </strong>
            ; the plan tracks itself.
          </p>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/20 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </div>
      )}

      {/* Top progress strip — per phase */}
      <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
        {PHASE_STRIP.map((p) => {
          const { done, total } = progressOf(p.key);
          const pct = total ? Math.round((done / total) * 100) : 0;
          return (
            <div
              key={p.key}
              className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3"
            >
              <div className="flex items-baseline justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                  {p.label}
                </span>
                <span className="text-xs font-bold text-gray-900 dark:text-white">
                  {done}/{total}
                </span>
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
                <div
                  className="h-full rounded-full bg-mint-green transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 space-y-4">
        {/* THIS WEEK — active work, always expanded */}
        <Section
          title="This Week"
          subtitle="The four moves that start the machine."
          icon={CalendarDaysIcon}
          progress={progressOf("this_week")}
          open
        >
          <div>
            {(bySection["this_week"] ?? []).map((it) => (
              <TaskRow key={it.id} item={it} onCycle={cycleStatus} onNote={saveNote} />
            ))}
          </div>
        </Section>

        {/* THE 8-STEP OPERATION */}
        <Section
          title="The 8-Step MCA Operation"
          subtitle="The machine, end to end. Each step's status = is this part standing up yet."
          icon={ArrowRightIcon}
          progress={progressOf("operation")}
        >
          <div className="space-y-2">
            {opTasks.map((it) => {
              const c = it.content;
              const done = it.status === "done" || it.status === "n_a";
              return (
                <div
                  key={it.id}
                  className="flex items-start gap-3 rounded-lg border border-gray-100 dark:border-gray-700 p-3"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-ocean-blue/10 text-ocean-blue text-sm font-bold">
                    {c.step}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`text-sm font-semibold ${
                          done ? "text-gray-400 dark:text-gray-500" : "text-gray-900 dark:text-white"
                        }`}
                      >
                        {it.label}
                      </span>
                      {c.alreadyBuilt && <AlreadyBuilt />}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      {c.who && (
                        <span className="inline-flex items-center rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-0.5 font-medium">
                          {c.who}
                        </span>
                      )}
                      {c.numbers && (
                        <span className="font-semibold text-gray-700 dark:text-gray-300">
                          {c.numbers}
                        </span>
                      )}
                      <ContactChips c={c} />
                    </div>
                    <InlineNote value={it.notes} onSave={(v) => saveNote(it, v)} />
                  </div>
                  <StatusButton status={it.status} onCycle={() => cycleStatus(it)} />
                </div>
              );
            })}
            {opNote && (
              <div className="rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-100 dark:border-gray-700 px-3 py-2 text-xs text-gray-600 dark:text-gray-400">
                <span className="font-semibold text-gray-700 dark:text-gray-300">
                  {opNote.label}:
                </span>{" "}
                {opNote.content.body}
              </div>
            )}
          </div>
        </Section>

        {/* ROLES & HIRING — who runs the machine and where to find them */}
        <Section
          title="Roles & Hiring"
          subtitle="Who runs each part of the machine — what they do, what they cost, and where to hire them."
          icon={UserGroupIcon}
        >
          <div className="space-y-4">
            {(bySection["roles"] ?? []).map((it) => (
              <RoleCard key={it.id} c={it.content} />
            ))}
          </div>
        </Section>

        {/* BUILD SEQUENCE — three phases */}
        <Section
          title="Build Sequence · Weeks 1–2 — Infrastructure"
          subtitle="Owner, ~$600. Stand up the plumbing."
          icon={BoltIcon}
          progress={progressOf("build_infra")}
        >
          <div>
            {(bySection["build_infra"] ?? []).map((it) => (
              <TaskRow key={it.id} item={it} onCycle={cycleStatus} onNote={saveNote} />
            ))}
          </div>
        </Section>

        <Section
          title="Build Sequence · Weeks 3–4 — Staffing"
          subtitle="~$1,500/mo. Setters paid on verified complete files — never appointments."
          icon={BoltIcon}
          progress={progressOf("build_staffing")}
        >
          <div>
            {(bySection["build_staffing"] ?? []).map((it) => (
              <TaskRow key={it.id} item={it} onCycle={cycleStatus} onNote={saveNote} />
            ))}
          </div>
        </Section>

        <Section
          title="Build Sequence · Months 2–3 — Prove it"
          subtitle="~$2,500/mo all-in. Targets + weekly levers."
          icon={BoltIcon}
          progress={progressOf("build_prove")}
        >
          <div>
            {proveTasks.map((it) => (
              <TaskRow key={it.id} item={it} onCycle={cycleStatus} onNote={saveNote} />
            ))}
            {proveNote && (
              <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2">
                <ShieldExclamationIcon className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                <p className="text-xs text-amber-800 dark:text-amber-200 leading-relaxed">
                  <span className="font-semibold">{proveNote.label}:</span> {proveNote.content.body}
                </p>
              </div>
            )}
          </div>
        </Section>

        {/* MONEY GROWTH — table */}
        <Section
          title="Money Growth"
          subtitle="Prove → Multiply → Compound. The owner's hours fall as the book matures."
          icon={ArrowRightIcon}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-gray-400 dark:text-gray-500">
                  <th className="py-2 pr-3 font-semibold">Phase</th>
                  <th className="py-2 pr-3 font-semibold">Months</th>
                  <th className="py-2 pr-3 font-semibold">Team</th>
                  <th className="py-2 pr-3 font-semibold">Deals/mo</th>
                  <th className="py-2 pr-3 font-semibold">Gross/mo</th>
                  <th className="py-2 font-semibold">Owner hrs/mo</th>
                </tr>
              </thead>
              <tbody>
                {economics.map((it) => {
                  const c = it.content;
                  return (
                    <tr
                      key={it.id}
                      className="border-t border-gray-100 dark:border-gray-700 align-top"
                    >
                      <td className="py-2.5 pr-3 font-bold text-gray-900 dark:text-white whitespace-nowrap">
                        {it.label}
                      </td>
                      <td className="py-2.5 pr-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                        {c.months}
                      </td>
                      <td className="py-2.5 pr-3 text-gray-600 dark:text-gray-400">{c.team}</td>
                      <td className="py-2.5 pr-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                        {c.deals}
                      </td>
                      <td className="py-2.5 pr-3 font-bold text-mint-green whitespace-nowrap">
                        {c.gross}
                      </td>
                      <td className="py-2.5 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                        {c.ownerHrs}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>

        {/* THREE MULTIPLIERS */}
        <Section
          title="The Three Multipliers"
          subtitle="Where the leverage actually lives."
          icon={BoltIcon}
        >
          <div className="grid gap-3 md:grid-cols-3">
            {multipliers.map((it) => (
              <div
                key={it.id}
                className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-900/15 p-4"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-gray-900 dark:text-white">
                    {it.label}
                  </span>
                  {it.content.gain && (
                    <span className="rounded-full bg-emerald-600/15 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 text-[11px] font-bold">
                      {it.content.gain}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                  {it.content.body}
                </p>
              </div>
            ))}
          </div>
        </Section>

        {/* RULES THAT KEEP IT ALIVE */}
        <Section
          title="Rules That Keep It Alive"
          subtitle="Break one of these and the machine dies quietly."
          icon={ShieldExclamationIcon}
        >
          <ul className="space-y-2">
            {rules.map((it, idx) => (
              <li
                key={it.id}
                className="flex items-start gap-3 rounded-lg border border-rose-100 dark:border-rose-900/40 bg-rose-50/50 dark:bg-rose-900/10 px-3 py-2"
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-rose-600/15 text-rose-700 dark:text-rose-300 text-[11px] font-bold">
                  {idx + 1}
                </span>
                <span className="text-sm text-gray-800 dark:text-gray-100 leading-relaxed">
                  {it.label}
                </span>
              </li>
            ))}
          </ul>
        </Section>

        {/* PLAID / LENDFLOW R&D */}
        <Section
          title="Plaid Trial — R&D"
          subtitle="A 2-week pilot to earn the full Production application. Not infrastructure."
          icon={BeakerIcon}
          progress={progressOf("plaid")}
        >
          <div className="space-y-3">
            {plaidNotes.map((it) => (
              <div
                key={it.id}
                className="rounded-lg border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 px-3 py-2.5"
              >
                <p className="text-sm font-semibold text-gray-900 dark:text-white">{it.label}</p>
                <p className="mt-1 text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                  {it.content.body}
                </p>
                {it.content.odds && (
                  <p className="mt-1.5 text-[11px] font-semibold text-ocean-blue">
                    {it.content.odds}
                  </p>
                )}
              </div>
            ))}
            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 pt-1">
              Three paths to approval
            </p>
            {plaidPaths.map((it) => (
              <div
                key={it.id}
                className={`rounded-lg border p-3 ${
                  it.content.recommended
                    ? "border-mint-green/50 bg-mint-green/5 dark:bg-mint-green/10"
                    : "border-gray-100 dark:border-gray-700"
                }`}
              >
                <div className="flex items-start gap-3">
                  <StatusButton status={it.status} onCycle={() => cycleStatus(it)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-gray-900 dark:text-white">
                        {it.label}
                      </span>
                      {it.content.recommended && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-mint-green/15 text-mint-green px-2 py-0.5 text-[11px] font-bold">
                          <StarIcon className="w-3.5 h-3.5" /> Recommended
                        </span>
                      )}
                      {it.content.odds && (
                        <span className="rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-0.5 text-[11px] font-semibold">
                          odds: {it.content.odds}
                        </span>
                      )}
                    </div>
                    {it.content.detail && (
                      <p className="mt-1 text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                        {it.content.detail}
                      </p>
                    )}
                    <div className="mt-1.5">
                      <ContactChips c={it.content} />
                    </div>
                    <InlineNote value={it.notes} onSave={(v) => saveNote(it, v)} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* VENDOR / LINK DIRECTORY */}
        <Section
          title="Vendor & Link Directory"
          subtitle="Everyone the plan sends you to — real URLs, tappable phones and emails. Unverified items are flagged, never linked with a guess."
          icon={ArrowTopRightOnSquareIcon}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {vendors.map((it) => {
              const c = it.content;
              return (
                <div
                  key={it.id}
                  className="h-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Title links to the site (external) or the in-app page; plain text when unverified/no link */}
                    {c.url ? (
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm font-bold text-gray-900 dark:text-white hover:text-ocean-blue"
                      >
                        {it.label}
                        <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5 text-ocean-blue" />
                      </a>
                    ) : c.appLink ? (
                      <Link
                        to={c.appLink}
                        className="inline-flex items-center gap-1 text-sm font-bold text-gray-900 dark:text-white hover:text-mint-green"
                      >
                        {it.label}
                        <ArrowRightIcon className="w-3.5 h-3.5 text-mint-green" />
                      </Link>
                    ) : (
                      <span className="text-sm font-bold text-gray-900 dark:text-white">
                        {it.label}
                      </span>
                    )}
                    {c.unverified && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 text-[10px] font-semibold">
                        <ExclamationTriangleIcon className="w-3 h-3" /> unverified
                      </span>
                    )}
                  </div>
                  {c.purpose && (
                    <p className="mt-1 text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                      {c.purpose}
                    </p>
                  )}
                  {/* tappable phone / email / in-app chips (title already carries the website) */}
                  {(c.phone || c.email || (c.appLink && c.url)) && (
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                      {c.phone && (
                        <a
                          href={`tel:${c.phone}`}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-ocean-blue hover:underline"
                        >
                          <PhoneIcon className="w-3.5 h-3.5" /> {c.phoneDisplay ?? c.phone}
                        </a>
                      )}
                      {c.email && (
                        <a
                          href={`mailto:${c.email}`}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-ocean-blue hover:underline"
                        >
                          <EnvelopeIcon className="w-3.5 h-3.5" /> {c.email}
                        </a>
                      )}
                      {c.appLink && c.url && (
                        <Link
                          to={c.appLink}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-mint-green hover:underline"
                        >
                          {c.appLinkLabel ?? "In-app"} <ArrowRightIcon className="w-3.5 h-3.5" />
                        </Link>
                      )}
                    </div>
                  )}
                  {c.note && (
                    <p className="mt-1.5 text-[11px] italic text-gray-400 dark:text-gray-500 leading-relaxed">
                      {c.note}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </Section>

        {/* FUNDER OUTREACH — live from the funder network (always fresh) */}
        <FunderOutreach />
      </div>

      {/* Compliance footer — internal, but honest */}
      <p className="mt-8 text-xs text-gray-400 dark:text-gray-500 leading-relaxed border-t border-gray-100 dark:border-gray-700 pt-4">
        Language note: an MCA is a <em>purchase of future receivables</em>, not a loan — say
        “advance,” “capital,” or “funding.” This is an internal planning surface; keep the language
        honest anyway.
      </p>
    </div>
  );
}
