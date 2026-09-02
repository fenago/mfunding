import { useCallback, useEffect, useRef, useState } from "react";
import {
  MagnifyingGlassIcon,
  ExclamationTriangleIcon,
  BuildingStorefrontIcon,
} from "@heroicons/react/24/outline";
import supabase from "@/supabase";
import type { PlaybookLookup } from "@/hooks/usePlaybookContact";

/**
 * SetterMerchantSearch — the idle-state "Pull up a merchant" box, upgraded from a
 * phone-only input into a real search. A setter finds a merchant by BUSINESS name,
 * CONTACT name, PHONE, or EMAIL, sees matching rows, and clicks one to load it
 * into the console.
 *
 * Load path (delegated to the parent via onOpen → usePlaybookContact.openMerchant):
 *   • a row that resolved a deal  → onOpen({ dealId })   (preferred — exact deal)
 *   • a row with no deal          → onOpen({ phone })     (edge fn resolves/creates)
 *   • ENTER on an all-digits query with no highlighted row → onOpen({ phone })
 *     (the original raw-phone fallback — never regressed)
 *
 * RLS: closers/setters SELECT ALL customers+deals (closer-search-all policy), so
 * this client-side query is sufficient — no edge function needed for the search.
 *
 * UNREADABLE ≠ EMPTY: a failed query renders a red error row, NEVER a silent
 * "no matches" — a setter must know the difference between "nobody by that name"
 * and "the search itself broke."
 */

const DEBOUNCE_MS = 250;
const MIN_CHARS = 2;
const MAX_RESULTS = 10;

type MerchantHit = {
  customerId: string;
  dealId: string | null;
  businessName: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  cityState: string | null;
};

// Closed/parked deal statuses — when a customer has several deals we prefer an
// ACTIVE one to open, falling back to whatever exists.
const CLOSED_STATUSES = new Set(["funded", "renewed", "declined", "dead", "lost"]);

// Pretty-print a phone for display: last-10 digits → (305) 555-0134. Leaves
// anything we can't parse untouched so a weird value still shows.
function prettyPhone(raw: string | null): string {
  if (!raw) return "";
  const d = raw.replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  if (ten.length === 10) return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
  return raw;
}

// Is this query the setter typing a phone number (as opposed to a name)?
// Only phone-shaped characters, and at least 3 digits to be worth a phone match.
function looksLikePhone(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 3 && /^[+()\-.\s\d]+$/.test(raw.trim());
}

type SearchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "results"; hits: MerchantHit[] };

type CustomerRow = {
  id: string;
  business_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  address_city: string | null;
  address_state: string | null;
  deals: Array<{ id: string; status: string | null; created_at: string | null }> | null;
};

function toHit(c: CustomerRow): MerchantHit {
  const deals = c.deals ?? [];
  // Prefer the most-recent ACTIVE deal; else the most-recent deal of any status.
  const sorted = [...deals].sort(
    (a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""),
  );
  const active = sorted.find((d) => !CLOSED_STATUSES.has((d.status ?? "").toLowerCase()));
  const chosen = active ?? sorted[0] ?? null;
  const contactName = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  const cityState = [c.address_city, c.address_state].filter(Boolean).join(", ").trim();
  return {
    customerId: c.id,
    dealId: chosen?.id ?? null,
    businessName: c.business_name?.trim() || null,
    contactName: contactName || null,
    phone: c.phone || null,
    email: c.email?.trim() || null,
    cityState: cityState || null,
  };
}

export default function SetterMerchantSearch({
  onOpen,
}: {
  onOpen: (lookup: PlaybookLookup) => void;
}) {
  const [q, setQ] = useState("");
  const [state, setState] = useState<SearchState>({ kind: "idle" });
  const [highlight, setHighlight] = useState(0);
  const reqId = useRef(0);

  const runSearch = useCallback(async (term: string, myReq: number) => {
    const raw = term.trim();
    const isPhone = looksLikePhone(raw);
    try {
      let query = supabase
        .from("customers")
        .select(
          "id, business_name, first_name, last_name, phone, email, additional_emails, address_city, address_state, deals(id, status, created_at)",
        )
        .limit(MAX_RESULTS);

      if (isPhone) {
        // Contiguous-digit match (raw-digit / +1 storage). Formatted numbers that
        // don't match here are still reachable via the ENTER raw-phone fallback.
        query = query.ilike("phone", `%${raw.replace(/\D/g, "")}%`);
      } else {
        // TOKENIZED match: every word must appear SOMEWHERE (business, first,
        // last, email), each independently. A whole-phrase ILIKE fails the
        // moment punctuation intervenes — "Andrade Stone" never matched
        // "ANDRADE'S STONE INC" because of the 'S. Per-token OR groups are
        // AND-ed together (each .or() call is a separate AND filter), so
        // "john smith" also matches first+last across fields.
        const tokens = raw
          .split(/\s+/)
          .map((w) => w.replace(/[,()]/g, "").trim()) // strip PostgREST syntax chars
          .filter(Boolean)
          .slice(0, 4);
        for (const tok of tokens.length > 0 ? tokens : [raw]) {
          const t = `%${tok}%`;
          const conds = [
            `business_name.ilike.${t}`,
            `first_name.ilike.${t}`,
            `last_name.ilike.${t}`,
            `email.ilike.${t}`,
          ];
          // additional_emails is a text[] — substring ILIKE isn't supported on
          // arrays, but a FULL email can be matched with `contains` (cs).
          if (tok.includes("@")) conds.push(`additional_emails.cs.{"${tok}"}`);
          query = query.or(conds.join(","));
        }
      }

      const { data, error } = await query;
      if (myReq !== reqId.current) return; // a newer keystroke superseded us
      if (error) {
        setState({ kind: "error", message: error.message || "Search failed." });
        return;
      }
      const hits = ((data ?? []) as CustomerRow[]).map(toHit);
      setHighlight(0);
      setState({ kind: "results", hits });
    } catch (e) {
      if (myReq !== reqId.current) return;
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : "Search failed.",
      });
    }
  }, []);

  // Debounced search on input. <MIN_CHARS resets to idle (no dropdown).
  useEffect(() => {
    const raw = q.trim();
    if (raw.length < MIN_CHARS) {
      reqId.current += 1; // cancel any in-flight result
      setState({ kind: "idle" });
      return;
    }
    const myReq = ++reqId.current;
    setState({ kind: "loading" });
    const t = setTimeout(() => void runSearch(raw, myReq), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q, runSearch]);

  const select = useCallback(
    (hit: MerchantHit) => {
      onOpen(hit.dealId ? { dealId: hit.dealId } : { phone: hit.phone ?? "" });
    },
    [onOpen],
  );

  const hits = state.kind === "results" ? state.hits : [];

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && hits.length) {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, hits.length - 1));
    } else if (e.key === "ArrowUp" && hits.length) {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const chosen = hits[highlight];
      if (chosen) {
        select(chosen);
      } else if (looksLikePhone(q)) {
        // Raw-phone fallback: all-digits query, no result row → open by phone
        // directly (the original ContactEntry behavior, preserved).
        onOpen({ phone: q.trim() });
      }
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 max-w-xl">
      <div className="flex items-center gap-2 text-sm font-bold text-gray-900 dark:text-white">
        <MagnifyingGlassIcon className="w-5 h-5 text-mint-green" />
        Pull up a merchant
      </div>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        Search by business, contact name, phone, or email — click a result to load it. Or open a merchant
        from a contact link and you'll land straight here.
      </p>

      <div className="relative mt-3">
        <div className="relative">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search by business, name, phone, or email"
            autoComplete="off"
            aria-label="Search merchants by business, name, phone, or email"
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 pl-9 pr-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-ocean-blue/40"
          />
          {state.kind === "loading" && (
            <span className="loading loading-spinner loading-xs absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
          )}
        </div>

        {/* Results / states — only once the setter has typed enough to search. */}
        {state.kind !== "idle" && (
          <div className="mt-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
            {state.kind === "loading" && (
              <div className="px-3 py-3 text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2">
                <span className="loading loading-spinner loading-xs" /> Searching…
              </div>
            )}

            {state.kind === "error" && (
              <div className="px-3 py-3 flex items-start gap-2 text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20">
                <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold">Search didn't run.</div>
                  <div className="mt-0.5">{state.message}</div>
                  {looksLikePhone(q) && (
                    <button
                      type="button"
                      onClick={() => onOpen({ phone: q.trim() })}
                      className="mt-1.5 font-semibold text-ocean-blue hover:underline"
                    >
                      Open by phone anyway →
                    </button>
                  )}
                </div>
              </div>
            )}

            {state.kind === "results" && hits.length === 0 && (
              <div className="px-3 py-3 text-xs text-gray-500 dark:text-gray-400">
                <span className="font-semibold text-gray-700 dark:text-gray-300">No matches.</span>{" "}
                {looksLikePhone(q) ? (
                  <button
                    type="button"
                    onClick={() => onOpen({ phone: q.trim() })}
                    className="font-semibold text-ocean-blue hover:underline"
                  >
                    Open by phone anyway →
                  </button>
                ) : (
                  "Try a business name, contact name, or phone number."
                )}
              </div>
            )}

            {state.kind === "results" &&
              hits.map((hit, i) => (
                <button
                  key={hit.customerId}
                  type="button"
                  onClick={() => select(hit)}
                  onMouseEnter={() => setHighlight(i)}
                  className={`w-full text-left px-3 py-2.5 flex items-start gap-2.5 border-t border-gray-100 dark:border-gray-800 first:border-t-0 ${
                    i === highlight
                      ? "bg-ocean-blue/10 dark:bg-ocean-blue/20"
                      : "hover:bg-gray-50 dark:hover:bg-gray-800"
                  }`}
                >
                  <BuildingStorefrontIcon className="w-4 h-4 shrink-0 mt-0.5 text-gray-400" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                      {hit.businessName || hit.contactName || "Unnamed merchant"}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {[
                        hit.businessName ? hit.contactName : null,
                        prettyPhone(hit.phone) || null,
                        hit.email,
                        hit.cityState,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "no contact details"}
                    </div>
                  </div>
                  {!hit.dealId && (
                    <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400 mt-0.5">
                      no deal
                    </span>
                  )}
                </button>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
