// FunderChaseTab — the processor's funder chase surface.
//
// A LIST OF MERCHANTS. One row per merchant with a deal out to funders (9 rows,
// not 33 — a merchant's funders belong together). Clicking a row opens it in
// place to reveal ALL of that merchant's funders at once, rendered by the same
// FunderWorkspace the Revenue Playbook shows on Step 7: a card per funder with
// its ⏳/💰/❌ state and "sent 21h ago", the message timeline beneath each
// (submitted, every message out with its subject, the green "Opened" badge,
// view-email links), and the "Submit to more funders" picker.
//
// Two earlier shapes were tried and discarded, and the reasons are worth
// keeping: a row per SUBMISSION split a merchant's funders across the table and
// could only carry one "opened" flag, losing the threads that are the actual
// chase tools; always-expanded panels made the page unusable past a few deals.
// A collapsed merchant row carries the summary, the panel carries the work.
//
// The collapsed row must surface its WORST funder, not an average — otherwise
// an overdue Cashable hides inside a row that looks calm.
//
// One merchant open at a time, and opening one never disturbs the filter or the
// sort. Expansion is also what mounts FunderWorkspace, which mounts FunderPicker
// and scores the whole funder network — lazy on purpose, not merely tidy.
//
// Ordered oldest-silent first: the merchant that has gone longest without a
// funder touch sits at the top, and one past a funder's OWN quoted turnaround
// (lenders.funding_speed) sorts above everything.
//
// HONESTY: a failed read renders RED with a retry. "Nothing outstanding" from a
// broken query would stop her chasing altogether.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
  PaperAirplaneIcon,
} from "@heroicons/react/24/outline";
import supabase from "@/supabase";
import FunderWorkspace from "@/components/admin/FunderWorkspace";
import DeclineCloseOut from "@/components/admin/DeclineCloseOut";
// The cheat sheet's disclosure blocks, extracted by cheatsheet-products so this
// page mounts them rather than owning a second copy. The credential guard, the
// link-classification chips and the unreadable-vs-absent split all come with
// them — hand-rolling any of the three here would re-ship a leak or a lie.
import { FunderContactBlock } from "@/components/admin/funder/FunderContactBlock";
import { FunderProgramBox } from "@/components/admin/funder/FunderProgramBox";
import { FunderDisclosureStyles } from "@/components/admin/funder/styles";
import {
  loadDocs,
  loadPrograms,
  loadProfiles,
  progKey,
  type ContactFields,
  type DocState,
  type ProfileState,
  type ProgramState,
} from "@/lib/funderDisclosure";
import {
  DEAL_STATUS_CONFIG,
  PARKED_STATUSES,
  type DealStatus,
  type DealWithCustomer,
} from "@/types/deals";
import {
  CHASE_TONE_CLS,
  chaseTone,
  hoursSince,
  isLive,
  isNoTypedText,
  money,
  quotedDecisionHours,
  relTime,
  stateOf,
  type StateKey,
} from "@/lib/funderSubmissions";

/** A submission, flattened just enough to summarise a deal's header. The full
 *  detail is FunderWorkspace's job once the section is expanded. */
interface SubSummary {
  id: string;
  lenderId: string;
  lenderName: string;
  fundingSpeed: string | null;
  status: string;
  submittedAt: string | null;
  responseAt: string | null;
  openedAt: string | null;
  openCount: number;
  /** response_data.parsed.method — "llm" | "heuristic" | "no_typed_text". */
  parseMethod: string | null;
  offerAmount: number | null;
  factorRate: number | null;
  dailyPayment: number | null;
  weeklyPayment: number | null;
  totalPayback: number | null;
}

interface DealGroup {
  dealId: string;
  deal: DealWithCustomer;
  businessName: string;
  dealNumber: string | null;
  status: string | null;
  amountRequested: number | null;
  subs: SubSummary[];
  /** Most recent funder touch on this deal — a send or a reply, whichever is
   *  later. The chase clock runs from here. */
  lastTouchAt: string | null;
  /** Most recent SEND. Distinct from lastTouchAt (which a reply also moves):
   *  "newest submitted" must mean when we last put the package out. */
  newestSubmittedAt: string | null;
  doNotContact: boolean;
  firstName: string | null;
  /** Already parked (nurture / declined / dead). Off the default list, and the
   *  close-out is hidden on these — its whole job is to park a deal. */
  parked: boolean;
  /** Any funder past its own quoted turnaround. Drives the row's red border
   *  and its clock tone only — WHICH funder, and by how long, is said on that
   *  funder's own line (FunderLine), not summarised up here. */
  breached: boolean;
}

type Load =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; groups: DealGroup[] };

type Filter = "outstanding" | "offers" | "declined" | "all";

const FILTERS: { key: Filter; label: string; hint: string }[] = [
  { key: "outstanding", label: "Awaiting", hint: "a funder still owes us an answer" },
  { key: "offers", label: "Offers", hint: "terms came back" },
  { key: "declined", label: "All passed", hint: "every funder declined or withdrew" },
  { key: "all", label: "All", hint: "every deal that has gone out" },
];

/** A deal's bucket is its most promising live state: still waiting beats an
 *  offer beats everyone having passed. */
function bucketOfDeal(subs: SubSummary[]): Filter {
  const keys = subs.map((s) => stateOf(s).key);
  if (keys.some((k) => k === "awaiting" || k === "replied")) return "outstanding";
  if (keys.some((k: StateKey) => k === "offer" || k === "accepted")) return "offers";
  return "declined";
}

/** PARKED_STATUSES is the one source of truth for "off the board" (nurture /
 *  declined / dead) — the same set updateDealStatus demands a reason for. */
const isParked = (status: string | null | undefined): boolean =>
  !!status && (PARKED_STATUSES as readonly string[]).includes(status);

/** The batched disclosure bundle, loaded once per page and passed down. */
type DiscState =
  // Split rather than { kind: "idle" | "loading" }: a member whose discriminant
  // is itself a union can't be narrowed OUT by an equality check, so the ready
  // branch never narrows and every field read errors.
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      lenders: Record<string, ContactFields & { id: string; company_name: string }>;
      profiles: ProfileState;
      docs: DocState;
      programs: ProgramState;
    };

/**
 * ONE LINE PER FUNDER, rendered in the COLLAPSED merchant row.
 *
 * This deliberately replaced a summary count ("2 funders · both awaiting").
 * A count describes the information instead of being it: the whole job of this
 * tab is deciding who to chase WITHOUT clicking, and "both awaiting" cannot
 * tell you that Highland Hill is 4 hours out and Uplyft is 50 days out. Each
 * funder carries its own chip, its own clock and its own open state.
 */
function FunderLine({
  s,
  disc,
}: {
  s: SubSummary;
  disc: DiscState;
}) {
  const st = stateOf(s);
  const quoted = quotedDecisionHours(s.fundingSpeed);
  const hrs = hoursSince(s.submittedAt);
  const tone = chaseTone(hrs, quoted);
  const awaiting = st.key === "awaiting";
  const breached = tone === "breached";
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] pl-6">
      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold shrink-0 ${st.cls}`}>
        {st.emoji} {st.label}
      </span>
      <span className="font-medium text-gray-800 dark:text-gray-100">{s.lenderName}</span>
      <span className={CHASE_TONE_CLS[tone]}>
        {s.submittedAt ? `sent ${relTime(s.submittedAt)}` : "never stamped"}
      </span>
      {/* They replied and typed nothing — the body was only the quoted thread.
          Said out loud, because a bare "✉ Replied" chip implies someone wrote
          something a human has read, and here nobody has: whatever they sent is
          in the attachments. NOT a decline, and not "not a decline" either —
          the classifier's verdict is a default on this path, so the honest
          render is "needs a look". */}
      {isNoTypedText(s) && (
        <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 px-1.5 py-px text-[10px] font-bold">
          ⚠ no typed text — open it
        </span>
      )}
      {s.openedAt ? (
        <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 px-1.5 py-px text-[10px] font-semibold">
          👀 opened{s.openCount > 1 ? ` ${s.openCount}×` : ""}
        </span>
      ) : (
        <span className="text-[10px] text-gray-400">not opened</span>
      )}
      {breached && quoted != null && (
        <span className="text-[10px] font-bold text-red-700 dark:text-red-300">
          ⚠ past its own {quoted < 1 ? `${Math.round(quoted * 60)}-min` : `${quoted}h`} promise
        </span>
      )}
      {/* No promise on file is UNKNOWN, not "on time" — say which it is. */}
      {awaiting && quoted == null && (
        <span className="text-[10px] text-gray-400">no quoted turnaround on file</span>
      )}

      {/* The cheat sheet's two disclosures, on the row she is already reading.
          Collapsed: the value of this tab is scanning many funders at once and
          these blocks are tall. */}
      <FunderDisclosures s={s} disc={disc} />
    </div>
  );
}

/** The two green disclosures from /admin/cheat-sheet, per funder.
 *  `.fcs fcs-embed` is required: the blocks' CSS is scoped to `.fcs`, and
 *  `fcs-embed` drops the page background/min-height so it sits inside this
 *  panel instead of painting over it. */
function FunderDisclosures({ s, disc }: { s: SubSummary; disc: DiscState }) {
  if (disc.kind === "loading" || disc.kind === "idle") {
    return <span className="text-[10px] text-gray-400">loading contacts…</span>;
  }
  if (disc.kind === "error") {
    return (
      <span className="text-[10px] text-red-600 dark:text-red-400">
        contacts unreadable — {disc.message}
      </span>
    );
  }
  const l = disc.lenders[s.lenderId];
  if (!l) {
    return <span className="text-[10px] text-gray-400">funder record not readable</span>;
  }
  const profile = disc.profiles.map[s.lenderId];
  const progs = Object.values(disc.programs.byKey).filter((p) => p.lender_id === s.lenderId);

  // basis-full forces its own line inside FunderLine's flex-wrap row. A DIV, not
  // a span: the blocks emit block-level markup, and a <div> inside a <span> gets
  // re-parented by the browser, which no typecheck or build would have caught.
  return (
    <div className="basis-full">
      <div className="fcs fcs-embed">
        <details className="mt-1">
          <summary className="cursor-pointer select-none text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
            Who to call · submission links ↓
          </summary>
          <div className="mt-1">
            {/* FunderContactBlock renders FunderLinksBlock inside itself —
                mounting both would print the portal and materials twice. */}
            <FunderContactBlock
              l={l}
              profile={profile}
              profilesReadable={disc.profiles.readable}
              docs={disc.docs}
            />
          </div>
        </details>

        <details className="mt-1">
          <summary className="cursor-pointer select-none text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
            The full box ↓
          </summary>
          <div className="mt-1">
            {!disc.programs.readable ? (
              <p className="text-[10px] text-amber-600 dark:text-amber-400">
                The criteria table isn&apos;t readable from this account — this is not &ldquo;no criteria
                recorded&rdquo;.
              </p>
            ) : progs.length === 0 ? (
              <p className="text-[10px] text-gray-400">No criteria recorded for this funder.</p>
            ) : (
              progs.map((p) => (
                <FunderProgramBox
                  key={progKey(p.lender_id, p.product_type ?? "mca")}
                  p={p}
                  productLabel={(p.product_type ?? "mca").replace(/_/g, " ")}
                />
              ))
            )}
          </div>
        </details>
      </div>
    </div>
  );
}

// ── Sorting ─────────────────────────────────────────────────────────────────
// Newest-submitted first by default. Every column is sortable and the choice
// persists, because this is his list and he decides its order.
//
// NOTE: a breached deal deliberately does NOT jump the order. The red border
// and the "past its own promise" line still shout, but a row reordering itself
// against an explicit sort is the tool overriding the person using it.
type SortKey = "submitted" | "silence" | "merchant" | "amount" | "funders" | "status";
type SortDir = "asc" | "desc";

const SORTS: { key: SortKey; label: string; hint: string; initial: SortDir }[] = [
  { key: "submitted", label: "Submitted", hint: "when the package last went out", initial: "desc" },
  { key: "silence", label: "Silence", hint: "longest since any funder contact", initial: "desc" },
  { key: "merchant", label: "Merchant", hint: "alphabetical", initial: "asc" },
  { key: "amount", label: "Amount", hint: "largest first", initial: "desc" },
  { key: "funders", label: "Funders out", hint: "how many funders hold the file", initial: "desc" },
  { key: "status", label: "Status", hint: "awaiting → offers → passed", initial: "asc" },
];

const STATUS_RANK: Record<Filter, number> = { outstanding: 0, offers: 1, declined: 2, all: 3 };
const SORT_STORAGE_KEY = "mf.funderChase.sort";

/** Read the saved sort. Storage can be unavailable (private window, blocked
 *  site data) or hold junk from an older build — either way we fall back to the
 *  default rather than render a broken list. */
function loadSort(): { key: SortKey; dir: SortDir } {
  const fallback = { key: "submitted" as SortKey, dir: "desc" as SortDir };
  try {
    const raw = localStorage.getItem(SORT_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as { key?: string; dir?: string };
    const key = SORTS.find((o) => o.key === parsed.key)?.key;
    const dir = parsed.dir === "asc" || parsed.dir === "desc" ? parsed.dir : null;
    if (!key || !dir) return fallback;
    return { key, dir };
  } catch {
    return fallback;
  }
}

function saveSort(sort: { key: SortKey; dir: SortDir }) {
  try {
    localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(sort));
  } catch {
    /* a per-viewer convenience; never worth failing the page over */
  }
}

/** Epoch ms, or null. Nulls always sort last whichever direction is active — an
 *  unstamped row is not "the oldest", it is unknown. */
const ms = (iso: string | null): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
};

export default function FunderChaseTab() {
  const [state, setState] = useState<Load>({ kind: "loading" });
  const [filter, setFilter] = useState<Filter>("outstanding");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>(() => loadSort());
  // ONE open at a time — this is a list you scan, not a set of panels you leave
  // lying open. Filter and sort are separate state, so opening never moves the list.
  const [openId, setOpenId] = useState<string | null>(null);
  // Parked deals are OFF by default: this is a queue for what's live, and a
  // nurture row is not something anyone is chasing. Hidden, never erased — a
  // funder still holding a package on a parked deal that silently vanishes is
  // a package nobody chases and nobody knows exists.
  const [showParked, setShowParked] = useState(false);
  // ── Funder disclosures ──
  // ONE batched load for every funder on screen, not one per row: up to six
  // funders per merchant across nine merchants is 50+ round trips if each block
  // fetches its own. The loaders come from funderDisclosure so their chunking
  // AND their unreadable-vs-absent discriminator come with them — passing a
  // hand-made `readable: true` would make the blocks say "not recorded" to
  // someone who simply isn't allowed to read the table.
  const [disc, setDisc] = useState<DiscState>({ kind: "idle" });
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState({ kind: "loading" });

    // 1) Every submission, with its funder's name + quoted turnaround.
    const { data: subData, error: subErr } = await supabase
      .from("deal_submissions")
      .select(
        "id, deal_id, lender_id, status, submitted_at, response_at, opened_at, open_count, offer_amount, factor_rate, " +
          "daily_payment, weekly_payment, total_payback, response_data, " +
          "lender:lenders!lender_id ( company_name, funding_speed )",
      );
    if (subErr) {
      setState({ kind: "error", message: `Submissions: ${subErr.message}` });
      return;
    }
    if (subData == null) {
      setState({ kind: "error", message: "The submissions read came back empty." });
      return;
    }

    // Group the LIVE ones by deal.
    const byDeal = new Map<string, SubSummary[]>();
    for (const r of subData as unknown as Record<string, unknown>[]) {
      const lender = r.lender as { company_name?: string; funding_speed?: string | null } | null;
      const s: SubSummary = {
        id: r.id as string,
        lenderId: r.lender_id as string,
        lenderName: lender?.company_name ?? "Funder",
        fundingSpeed: lender?.funding_speed ?? null,
        status: r.status as string,
        submittedAt: (r.submitted_at as string | null) ?? null,
        responseAt: (r.response_at as string | null) ?? null,
        openedAt: (r.opened_at as string | null) ?? null,
        openCount: (r.open_count as number | null) ?? 0,
        parseMethod:
          (r.response_data as { parsed?: { method?: string | null } } | null)?.parsed?.method ?? null,
        offerAmount: (r.offer_amount as number | null) ?? null,
        factorRate: (r.factor_rate as number | null) ?? null,
        dailyPayment: (r.daily_payment as number | null) ?? null,
        weeklyPayment: (r.weekly_payment as number | null) ?? null,
        totalPayback: (r.total_payback as number | null) ?? null,
      };
      if (!isLive(s)) continue;
      const key = r.deal_id as string;
      const arr = byDeal.get(key);
      if (arr) arr.push(s);
      else byDeal.set(key, [s]);
    }

    const dealIds = [...byDeal.keys()];
    if (dealIds.length === 0) {
      setState({ kind: "ready", groups: [] });
      return;
    }

    // 2) The REAL deals, with their customers — FunderWorkspace reads deal.id,
    //    customer_id, deal_type, amount_requested, ghl_contact_id and
    //    ai_lender_recommendations, so this has to be the whole row.
    const { data: dealData, error: dealErr } = await supabase
      .from("deals")
      .select("*, customer:customers!customer_id ( * )")
      .in("id", dealIds);
    if (dealErr) {
      setState({ kind: "error", message: `Deals: ${dealErr.message}` });
      return;
    }
    if (dealData == null) {
      setState({ kind: "error", message: "The deals read came back empty." });
      return;
    }

    const groups: DealGroup[] = [];
    for (const d of dealData as unknown as DealWithCustomer[]) {
      const subs = byDeal.get(d.id) ?? [];
      if (subs.length === 0) continue;

      // Last funder touch = the latest send or reply across this deal's funders.
      let lastTouchAt: string | null = null;
      let newestSubmittedAt: string | null = null;
      for (const s of subs) {
        for (const t of [s.submittedAt, s.responseAt]) {
          if (t && (!lastTouchAt || new Date(t) > new Date(lastTouchAt))) lastTouchAt = t;
        }
        if (s.submittedAt && (!newestSubmittedAt || new Date(s.submittedAt) > new Date(newestSubmittedAt))) {
          newestSubmittedAt = s.submittedAt;
        }
      }

      // Breach is judged per still-silent funder against ITS own promise. The
      // row only needs to know THAT one is late; FunderLine names which.
      const breached = subs.some((s) => {
        if (stateOf(s).key !== "awaiting") return false;
        const q = quotedDecisionHours(s.fundingSpeed);
        const h = hoursSince(s.submittedAt);
        return q != null && h != null && h > q;
      });

      const cust = d.customer as
        | { business_name?: string | null; first_name?: string | null; last_name?: string | null; do_not_contact?: boolean | null }
        | undefined;
      groups.push({
        dealId: d.id,
        deal: d,
        businessName:
          cust?.business_name?.trim() ||
          [cust?.first_name, cust?.last_name].filter(Boolean).join(" ").trim() ||
          d.deal_number ||
          "Unnamed merchant",
        dealNumber: d.deal_number ?? null,
        status: (d.status as string | null) ?? null,
        amountRequested: (d.amount_requested as number | null) ?? null,
        parked: isParked(d.status as string | null),
        doNotContact: !!cust?.do_not_contact,
        firstName: cust?.first_name ?? null,
        subs,
        lastTouchAt,
        newestSubmittedAt,
        breached,
      });
    }

    setState({ kind: "ready", groups });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => (state.kind === "ready" ? state.groups : []), [state]);

  // Fire once the rows land, keyed on the SET of funders actually on screen.
  const lenderIdKey = useMemo(
    () => [...new Set(groups.flatMap((g) => g.subs.map((x) => x.lenderId)))].sort().join(","),
    [groups],
  );

  const loadDisclosures = useCallback(async () => {
    const ids = lenderIdKey ? lenderIdKey.split(",") : [];
    if (ids.length === 0) {
      setDisc({ kind: "idle" });
      return;
    }
    setDisc({ kind: "loading" });
    try {
      // `lenders` is ours to fetch (the shared module owns profiles/docs/programs).
      // Chunked for the same reason theirs are: 121 ids was a 4.7KB URL and a 414.
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += 40) chunks.push(ids.slice(i, i + 40));
      const lenderRows: Record<string, ContactFields & { id: string; company_name: string }> = {};
      for (const c of chunks) {
        const { data, error } = await supabase
          .from("lenders")
          .select(
            "id, company_name, primary_contact_name, primary_contact_email, primary_contact_phone, " +
              "contacts, submission_email, submission_portal_url, submission_notes, website, notes",
          )
          .in("id", c);
        if (error) throw new Error(error.message);
        for (const row of (data ?? []) as unknown as (ContactFields & { id: string; company_name: string })[]) {
          lenderRows[row.id] = row;
        }
      }
      const [profiles, docs, programs] = await Promise.all([
        loadProfiles(ids),
        loadDocs(ids),
        loadPrograms(ids),
      ]);
      setDisc({ kind: "ready", lenders: lenderRows, profiles, docs, programs });
    } catch (e) {
      setDisc({ kind: "error", message: e instanceof Error ? e.message : "Could not load funder contacts." });
    }
  }, [lenderIdKey]);

  useEffect(() => {
    void loadDisclosures();
  }, [loadDisclosures]);


  // The chase list is ACTIVE deals. Parked ones are a separate, subordinate set.
  const activeGroups = useMemo(() => groups.filter((g) => !g.parked), [groups]);
  const parkedGroups = useMemo(() => groups.filter((g) => g.parked), [groups]);

  // Counts describe what the chips will actually show, so they follow the same
  // parked rule — a chip promising 4 that reveals 2 is its own small lie.
  const counts = useMemo(() => {
    const pool = showParked ? groups : activeGroups;
    const c: Record<Filter, number> = { outstanding: 0, offers: 0, declined: 0, all: pool.length };
    for (const g of pool) c[bucketOfDeal(g.subs)] += 1;
    return c;
  }, [groups, activeGroups, showParked]);

  const visible = useMemo(() => {
    const pool = showParked ? groups : activeGroups;
    const rows = pool.filter((g) => filter === "all" || bucketOfDeal(g.subs) === filter);
    const flip = sort.dir === "desc" ? -1 : 1;
    // Nulls last in BOTH directions — an unstamped row is unknown, not extreme.
    const nullsLast = (a: number | null, b: number | null): number | null => {
      if (a == null && b == null) return 0;
      if (a == null) return 1;
      if (b == null) return -1;
      return null;
    };
    return [...rows].sort((a, b) => {
      switch (sort.key) {
        case "merchant":
          return flip * a.businessName.localeCompare(b.businessName, undefined, { sensitivity: "base" });
        case "funders":
          return flip * (a.subs.length - b.subs.length);
        case "status":
          return flip * (STATUS_RANK[bucketOfDeal(a.subs)] - STATUS_RANK[bucketOfDeal(b.subs)]);
        case "amount": {
          const n = nullsLast(a.amountRequested, b.amountRequested);
          return n ?? flip * ((a.amountRequested ?? 0) - (b.amountRequested ?? 0));
        }
        case "silence": {
          // "desc" = longest silence first, i.e. the OLDEST last-touch.
          const n = nullsLast(ms(a.lastTouchAt), ms(b.lastTouchAt));
          return n ?? flip * (ms(b.lastTouchAt)! - ms(a.lastTouchAt)!);
        }
        case "submitted":
        default: {
          const n = nullsLast(ms(a.newestSubmittedAt), ms(b.newestSubmittedAt));
          return n ?? flip * (ms(a.newestSubmittedAt)! - ms(b.newestSubmittedAt)!);
        }
      }
    });
  }, [groups, activeGroups, showParked, filter, sort]);

  /** Click a column: same column toggles direction, a new one starts at its
   *  natural direction (newest, largest, A→Z). Never touches the open row or
   *  the filter. */
  function applySort(key: SortKey) {
    setSort((cur) => {
      const next: { key: SortKey; dir: SortDir } =
        cur.key === key
          ? { key, dir: cur.dir === "asc" ? "desc" : "asc" }
          : { key, dir: SORTS.find((o) => o.key === key)!.initial };
      saveSort(next);
      return next;
    });
  }

  function toggle(dealId: string) {
    setOpenId((cur) => (cur === dealId ? null : dealId));
  }

  if (state.kind === "error") {
    return (
      <div className="rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-5">
        <div className="flex items-start gap-2">
          <ExclamationTriangleIcon className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-bold text-red-700 dark:text-red-300">
              Couldn&apos;t load the funder queue.
            </div>
            <p className="mt-0.5 text-xs text-red-700 dark:text-red-300">
              This is <span className="font-bold">not</span> &ldquo;nothing outstanding&rdquo; — it is an unread
              query. Don&apos;t stop chasing on the strength of this screen until it loads.
            </p>
            <p className="mt-0.5 font-mono text-[11px] text-red-700/80 dark:text-red-300/80">{state.message}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-1.5 text-xs font-semibold text-ocean-blue hover:underline"
            >
              Try again →
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* The disclosure blocks' CSS, injected once for the whole page. */}
      <FunderDisclosureStyles />

      {/* Controls */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <PaperAirplaneIcon className="w-4 h-4 text-ocean-blue" />
          <h2 className="text-sm font-bold text-gray-900 dark:text-white">Funder chase</h2>
          <span className="text-[11px] text-gray-400">
            one row per merchant · click a merchant to work its funders
          </span>
          <button
            type="button"
            onClick={() => void load()}
            className="ml-auto text-[11px] text-ocean-blue hover:underline inline-flex items-center gap-1"
          >
            <ArrowPathIcon className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>

        {/* Sort — his order, persisted. Arrow shows on the active column only. */}
        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          <span className="text-[10px] uppercase tracking-wide text-gray-400 mr-0.5">Sort</span>
          {SORTS.map((o) => {
            const active = sort.key === o.key;
            return (
              <button
                key={o.key}
                type="button"
                onClick={() => applySort(o.key)}
                aria-pressed={active}
                title={o.hint}
                className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border transition-colors ${
                  active
                    ? "border-ocean-blue bg-ocean-blue/10 text-ocean-blue"
                    : "border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600"
                }`}
              >
                {o.label}
                {active && <span className="ml-1">{sort.dir === "desc" ? "↓" : "↑"}</span>}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-gray-400 mr-0.5">Show</span>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              title={f.hint}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors ${
                filter === f.key
                  ? "border-ocean-blue bg-ocean-blue/10 text-ocean-blue"
                  : "border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600"
              }`}
            >
              {f.label}
              <span className="ml-1 tabular-nums opacity-70">
                {state.kind === "ready" ? counts[f.key] : "—"}
              </span>
            </button>
          ))}
        </div>
      </div>

      {toast && (
        <div className="rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
          {toast}
        </div>
      )}

      {state.kind === "loading" ? (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <span className="loading loading-spinner loading-sm" /> Loading the funder queue…
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 text-sm text-gray-500 dark:text-gray-400">
          {filter === "outstanding"
            ? "Nothing outstanding — every funder holding a file has answered."
            : "No merchants in this view."}
        </div>
      ) : (
        visible.map((g) => {
          const isOpen = openId === g.dealId;
          const hrs = hoursSince(g.lastTouchAt);
          const tone = g.breached ? "breached" : chaseTone(hrs, null);
          const stageCfg = g.status ? DEAL_STATUS_CONFIG[g.status as DealStatus] : undefined;
          return (
            <div
              key={g.dealId}
              className={`rounded-xl border bg-white dark:bg-gray-800 ${
                g.breached
                  ? "border-red-300 dark:border-red-800"
                  : "border-gray-200 dark:border-gray-700"
              }`}
            >
              {/* ── The merchant row: enough to triage without opening ── */}
              <button
                type="button"
                onClick={() => toggle(g.dealId)}
                aria-expanded={isOpen}
                className="w-full text-left px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 hover:bg-gray-50 dark:hover:bg-gray-700/40 rounded-xl"
              >
                <ChevronRightIcon
                  className={`w-4 h-4 shrink-0 text-gray-400 transition-transform ${isOpen ? "rotate-90" : ""}`}
                />
                <span className="text-sm font-bold text-gray-900 dark:text-white truncate">
                  {g.businessName}
                </span>

                {stageCfg && (
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${stageCfg.bgColor} ${stageCfg.color}`}>
                    {stageCfg.label}
                  </span>
                )}
                {g.parked && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                    parked — not being chased
                  </span>
                )}

                {g.amountRequested != null && (
                  <span className="text-[11px] font-semibold tabular-nums text-gray-600 dark:text-gray-300">
                    {money(g.amountRequested)}
                  </span>
                )}

                <span className="text-[11px] text-gray-400">
                  {g.subs.length} funder{g.subs.length === 1 ? "" : "s"}
                </span>

                <span className={`ml-auto text-[11px] whitespace-nowrap ${CHASE_TONE_CLS[tone]}`}>
                  {g.lastTouchAt ? `silent ${relTime(g.lastTouchAt)}` : "never stamped"}
                </span>
              </button>

              {/* The detail he reads BEFORE opening anything — a line per funder. */}
              <div className="pb-2 space-y-0.5">
                {g.subs.map((sub) => (
                  <FunderLine key={sub.id} s={sub} disc={disc} />
                ))}
              </div>

              {g.dealNumber && (
                <div className="px-3 pb-2 flex items-center">
                  <Link
                    to={`/admin/deals/${g.dealId}`}
                    className="ml-auto text-[10px] text-gray-400 hover:text-ocean-blue inline-flex items-center gap-0.5"
                  >
                    {g.dealNumber}
                    <ArrowTopRightOnSquareIcon className="w-3 h-3" />
                  </Link>
                </div>
              )}

              {/* ── Close-out: tell the merchant everyone passed, then park ──
                  Same component the Playbook's FunderWorkspace mounts. The
                  guard rows are handed down so it doesn't re-query what this
                  tab already loaded. */}
              {/* No close-out on a parked deal: the action's whole job is to
                  email the decline and park it, and it is already parked. */}
              {!g.parked && (
              <div className="px-3 pb-2">
                <DeclineCloseOut
                  deal={g.deal}
                  rows={g.subs.map((x) => ({
                    lenderName: x.lenderName,
                    status: x.status,
                    submittedAt: x.submittedAt,
                    responseAt: x.responseAt,
                    offerAmount: x.offerAmount,
                    factorRate: x.factorRate,
                    dailyPayment: x.dailyPayment,
                    weeklyPayment: x.weeklyPayment,
                    totalPayback: x.totalPayback,
                  }))}
                  onDone={() => {
                    void load();
                    setToast(`${g.businessName} — closed out.`);
                    setTimeout(() => setToast(null), 6000);
                  }}
                />
              </div>
              )}

              {/* ── The full panel, identical to the Playbook's Step 7 ──
                  Mounted only when open: FunderWorkspace mounts FunderPicker,
                  which scores the whole funder network per deal. */}
              {isOpen && (
                <div className="px-3 pb-3 border-t border-gray-100 dark:border-gray-700/60">
                  <FunderWorkspace deal={g.deal} showCloseOut={false} onChanged={() => void load()} />
                </div>
              )}
            </div>
          );
        })
      )}

      {/* Parked deals with a funder still holding a package. Quiet and below
          the list on purpose — present so nobody loses them, subordinate so
          they don't compete with the work. Nothing renders when there are
          none, and nothing renders while the list is still loading, because
          "0 parked" and "not counted yet" are not the same claim. */}
      {state.kind === "ready" && parkedGroups.length > 0 && (
        <p className="px-1 text-[11px] text-gray-500 dark:text-gray-400">
          {parkedGroups.length} parked deal{parkedGroups.length === 1 ? "" : "s"} still{" "}
          {parkedGroups.length === 1 ? "has" : "have"} a funder holding a package
          {" — "}
          <button
            type="button"
            onClick={() => setShowParked((v) => !v)}
            className="font-semibold text-ocean-blue hover:underline"
          >
            {showParked ? "hide" : "show"}
          </button>
        </p>
      )}
    </div>
  );
}
