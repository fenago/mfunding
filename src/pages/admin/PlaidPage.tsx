// /admin/plaid — the Plaid control room (super_admin).
//
// Three kinds of truth, kept visually distinct so nothing reads as more certain than
// it is:
//   · LIVE   — probed right now by the plaid-institutions edge function (API
//              reachable, vault key presence, connected-bank count).
//   · SNAPSHOT — what the Plaid dashboard said when a human last recorded it
//              (product enablement, OAuth bank enablement). Plaid exposes no API for
//              either, so every snapshot block carries its "as of" date + a dashboard
//              link. Never dressed up as live.
//   · DIRECTORY — Plaid's own institution list: browsable by default (paged
//              /institutions/get), or filtered by name (/institutions/search).
//
// The editable status ledger lives on /admin/settings/integrations (PlaidStatusPanel);
// this page is read-only and links there rather than duplicating the editor.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  BanknotesIcon,
  BuildingLibraryIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  KeyIcon,
  MagnifyingGlassIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline";
import {
  getPlaidHealth,
  listInstitutions,
  searchInstitutions,
  PLAID_PRODUCTS,
  PRODUCT_STATUS_LABEL,
  type PlaidHealth,
  type PlaidInstitution,
  type ProductStatus,
} from "@/services/plaidStatusService";

/** How many institutions each "Load more" pull fetches. Plaid caps a page at 500,
 * but the payload carries base64 logos — 60 keeps the list snappy to scroll. */
const BROWSE_PAGE = 60;

const OAUTH_DASHBOARD_URL = "https://dashboard.plaid.com/activity/status/oauth-institutions";
const KEYS_DASHBOARD_URL = "https://dashboard.plaid.com/developers/keys";

const CHIP: Record<ProductStatus, string> = {
  enabled: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  requested: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  not_requested: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
  not_eligible: "bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500 line-through",
};

function Card({
  title, subtitle, children, action,
}: { title: string; subtitle?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="font-bold text-gray-900 dark:text-white">{title}</h2>
          {subtitle && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

/** A green/red presence dot — used only for facts we actually verified. */
function Presence({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      {ok
        ? <CheckCircleIcon className="w-4 h-4 text-emerald-500 shrink-0" />
        : <XCircleIcon className="w-4 h-4 text-red-500 shrink-0" />}
      <span className={ok ? "text-gray-700 dark:text-gray-200" : "text-red-600 dark:text-red-400"}>{label}</span>
    </span>
  );
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div>
      <div className="text-xs text-gray-400">{label}</div>
      <div className="text-gray-900 dark:text-white font-semibold">{value}</div>
      {hint && <div className="text-xs text-gray-400 mt-0.5">{hint}</div>}
    </div>
  );
}

/** One bank in the directory — name first, then OAuth flag, site link, id, products. */
function InstitutionRow({ inst }: { inst: PlaidInstitution }) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700">
      {inst.logo ? (
        <img
          src={`data:image/png;base64,${inst.logo}`}
          alt=""
          className="w-9 h-9 rounded-lg object-contain bg-white shrink-0"
        />
      ) : (
        <div className="w-9 h-9 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center shrink-0">
          <BuildingLibraryIcon className="w-5 h-5 text-gray-400" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-gray-900 dark:text-white">{inst.name}</span>
          {inst.oauth && (
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
              OAuth
            </span>
          )}
          {inst.url && (
            <a
              href={inst.url}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-ocean-blue hover:underline inline-flex items-center gap-1"
            >
              site <ArrowTopRightOnSquareIcon className="w-3 h-3" />
            </a>
          )}
        </div>
        <p className="text-xs text-gray-400 font-mono mt-0.5">{inst.institution_id}</p>
        {inst.products.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {inst.products.map((p) => (
              <span
                key={p}
                className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"
              >
                {p}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function PlaidPage() {
  const [health, setHealth] = useState<PlaidHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaidInstitution[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  // Guards against an older in-flight search overwriting a newer one.
  const searchSeq = useRef(0);

  // Browsable directory (no query) — paged through Plaid's /institutions/get.
  const [browse, setBrowse] = useState<PlaidInstitution[]>([]);
  const [browseTotal, setBrowseTotal] = useState<number | null>(null);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [browseDone, setBrowseDone] = useState(false);
  // Set once the first page has been requested, so the effect never double-fires.
  const browseStarted = useRef(false);

  /** Fetch the next directory page and append it (deduped by institution_id). */
  const loadMoreBanks = useCallback(async () => {
    setBrowseLoading(true);
    setBrowseError(null);
    try {
      const offset = browse.length;
      const page = await listInstitutions(offset, BROWSE_PAGE);
      setBrowseTotal(page.total);
      setBrowse((prev) => {
        const seen = new Set(prev.map((i) => i.institution_id));
        return [...prev, ...page.institutions.filter((i) => !seen.has(i.institution_id))];
      });
      // Plaid returned a short page (or nothing) — that's the end of the directory.
      if (page.institutions.length < BROWSE_PAGE) setBrowseDone(true);
    } catch (e) {
      setBrowseError(e instanceof Error ? e.message : String(e));
    } finally {
      setBrowseLoading(false);
    }
  }, [browse.length]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setHealth(await getPlaidHealth());
    } catch (e) {
      setHealth(null);
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // First page of the browsable directory, once on mount.
  useEffect(() => {
    if (browseStarted.current) return;
    browseStarted.current = true;
    loadMoreBanks();
  }, [loadMoreBanks]);

  // Debounced institution search (350ms after typing stops).
  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults(null); setSearchError(null); setSearching(false); return; }
    setSearching(true);
    const seq = ++searchSeq.current;
    const t = setTimeout(async () => {
      try {
        const found = await searchInstitutions(q, 50);
        if (seq !== searchSeq.current) return;
        setResults(found);
        setSearchError(null);
      } catch (e) {
        if (seq !== searchSeq.current) return;
        setResults(null);
        setSearchError(e instanceof Error ? e.message : String(e));
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  const keysNeverRotated = !!health && !health.keys_rotated_at;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <BanknotesIcon className="w-6 h-6 text-mint-green" /> Plaid
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Bank-connection integration: credentials, product access, OAuth bank coverage, and the institution directory.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="/admin/settings/integrations"
            className="text-sm text-ocean-blue hover:underline"
          >
            Edit recorded status →
          </a>
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 text-sm text-ocean-blue hover:underline disabled:opacity-50"
          >
            <ArrowPathIcon className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </div>

      {loadError && (
        <div className="flex items-start gap-2 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
          <ExclamationTriangleIcon className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div className="text-sm text-red-700 dark:text-red-300">
            <div className="font-semibold">Could not read the Plaid integration status.</div>
            <div className="mt-0.5 font-mono text-xs break-all">{loadError}</div>
          </div>
        </div>
      )}

      {loading && !health && <p className="text-sm text-gray-400">Probing Plaid…</p>}

      {health && (
        <>
          {/* ── Integration status (LIVE) ───────────────────────────────────── */}
          <Card
            title="Integration status"
            subtitle="Probed live just now — API reachability, vault credentials, connected banks."
            action={
              health.api_reachable === true ? (
                <span className="text-xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wide bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                  API reachable
                </span>
              ) : health.api_reachable === false ? (
                <span className="text-xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wide bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
                  API unreachable
                </span>
              ) : (
                <span className="text-xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wide bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300">
                  Not probed
                </span>
              )
            }
          >
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
              <Stat
                label="Environment"
                value={
                  <span className="inline-flex items-center gap-1.5 capitalize">
                    <span className={`w-2 h-2 rounded-full ${health.env === "production" ? "bg-emerald-500" : "bg-amber-500"}`} />
                    {health.env}
                  </span>
                }
              />
              <Stat
                label="Connected banks"
                value={health.connected_items}
                hint={health.connected_items === 0 ? "no merchant has linked a bank yet" : undefined}
              />
              <Stat label="Products enabled" value={health.products_enabled.length} />
              <Stat
                label="Statements pull"
                value={health.statements_enabled ? "On" : "Off"}
                hint="platform_settings.plaid"
              />
            </div>

            <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
              Vault credentials <span className="font-normal">— presence only; values never leave the server.</span>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2 mb-5">
              <Presence ok={health.keys_present.client_id} label="PLAID_CLIENT_ID" />
              <Presence ok={health.keys_present.secret_production} label="PLAID_SECRET_PRODUCTION" />
              <Presence ok={health.keys_present.secret_sandbox} label="PLAID_SECRET_SANDBOX" />
            </div>

            {keysNeverRotated ? (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                <KeyIcon className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-sm text-amber-800 dark:text-amber-200">
                  <span className="font-semibold">Never rotated — rotate the production secret.</span>{" "}
                  The keys were shared through chat when the account was set up. Rotate at{" "}
                  <a href={KEYS_DASHBOARD_URL} target="_blank" rel="noreferrer" className="underline">
                    dashboard.plaid.com/developers/keys
                  </a>
                  , update the vault, then mark it rotated on{" "}
                  <a href="/admin/settings/integrations" className="underline">Integrations</a>.
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
                <CheckCircleIcon className="w-5 h-5" />
                Keys rotated {new Date(health.keys_rotated_at as string).toLocaleDateString()}.
              </div>
            )}
          </Card>

          {/* ── Products (SNAPSHOT) ─────────────────────────────────────────── */}
          <Card
            title="Product access"
            subtitle="As recorded from the Plaid dashboard — Plaid has no API for product entitlements."
          >
            <div className="flex flex-wrap gap-2">
              {PLAID_PRODUCTS.map((p) => {
                const rec = health.products[p.id];
                const st = (rec?.status ?? "not_requested") as ProductStatus;
                return (
                  <span
                    key={p.id}
                    title={rec?.date ? `Recorded ${rec.date}` : "No date recorded"}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${CHIP[st] ?? CHIP.not_requested}`}
                  >
                    <span className="font-semibold">{p.label}</span>
                    <span className="opacity-70">· {PRODUCT_STATUS_LABEL[st] ?? st}</span>
                  </span>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
              Statements and Transactions are the two the underwriter depends on. Change a status on{" "}
              <a href="/admin/settings/integrations" className="underline text-ocean-blue">Integrations</a>.
            </p>
          </Card>

          {/* ── OAuth bank enablement (SNAPSHOT) ────────────────────────────── */}
          <Card
            title="OAuth bank enablement"
            subtitle={
              health.oauth_as_of
                ? `Dashboard snapshot as of ${health.oauth_as_of} — not a live API read. Plaid exposes no endpoint for per-bank OAuth approval.`
                : "Dashboard snapshot — not a live API read. No 'as of' date recorded yet."
            }
            action={
              <a
                href={OAUTH_DASHBOARD_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-ocean-blue hover:underline whitespace-nowrap"
              >
                Plaid dashboard <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" />
              </a>
            }
          >
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircleIcon className="w-4 h-4 text-emerald-500" />
                  <span className="text-sm font-semibold text-gray-900 dark:text-white">
                    Enabled ({health.oauth_enabled.length})
                  </span>
                </div>
                {health.oauth_enabled.length === 0 ? (
                  <p className="text-sm text-gray-400">None recorded.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {health.oauth_enabled.map((n) => (
                      <span
                        key={n}
                        className="px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                      >
                        {n}
                      </span>
                    ))}
                  </div>
                )}
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  Merchants at these banks can complete the OAuth connect flow.
                </p>
              </div>

              <div>
                <div className="flex items-center gap-2 mb-2">
                  <ExclamationTriangleIcon className="w-4 h-4 text-amber-500" />
                  <span className="text-sm font-semibold text-gray-900 dark:text-white">
                    Request needed ({health.oauth_request_needed.length})
                  </span>
                </div>
                {health.oauth_request_needed.length === 0 ? (
                  <p className="text-sm text-gray-400">None outstanding.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {health.oauth_request_needed.map((n) => (
                      <span
                        key={n}
                        className="px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                      >
                        {n}
                      </span>
                    ))}
                  </div>
                )}
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  Not yet approved for our account — a merchant at one of these gets the "use your upload link instead"
                  fallback until we request access in the Plaid dashboard.
                </p>
              </div>
            </div>
            {health.oauth_source && (
              <p className="mt-4 text-xs text-gray-400 font-mono break-all">source: {health.oauth_source}</p>
            )}
          </Card>
        </>
      )}

      {/* ── Institution lookup (LIVE DIRECTORY) ───────────────────────────── */}
      <Card
        title="Institution lookup"
        subtitle="Plaid's live US institution directory — browse the whole list, or search it by name. Each bank shows its OAuth flag and supported products."
      >
        <div className="relative mb-4">
          <MagnifyingGlassIcon className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name — e.g. Chase, Navy Federal, Regions"
            className="w-full pl-10 pr-24 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-ocean-blue/40"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-ocean-blue hover:underline"
            >
              Clear · browse all
            </button>
          )}
        </div>

        {query.trim() ? (
          /* ── Filtered: live /institutions/search ── */
          searchError ? (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
              <ExclamationTriangleIcon className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold">Institution search failed.</div>
                <div className="mt-0.5 font-mono text-xs break-all">{searchError}</div>
              </div>
            </div>
          ) : searching ? (
            <p className="text-sm text-gray-400">Searching Plaid…</p>
          ) : results && results.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No institution in Plaid's directory matches "{query.trim()}".
            </p>
          ) : results ? (
            <>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                <span className="font-semibold text-gray-700 dark:text-gray-200">{results.length}</span> match
                {results.length === 1 ? "" : "es"} for "{query.trim()}".
              </p>
              <div className="space-y-2 max-h-[32rem] overflow-y-auto pr-1">
                {results.map((inst) => (
                  <InstitutionRow key={inst.institution_id} inst={inst} />
                ))}
              </div>
            </>
          ) : null
        ) : (
          /* ── Browsing: paged /institutions/get, scrollable ── */
          <>
            {browseError && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300 mb-3">
                <ExclamationTriangleIcon className="w-5 h-5 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="font-semibold">Could not load Plaid's institution directory.</div>
                  <div className="mt-0.5 font-mono text-xs break-all">{browseError}</div>
                  <button
                    onClick={loadMoreBanks}
                    disabled={browseLoading}
                    className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold underline disabled:opacity-50"
                  >
                    <ArrowPathIcon className={`w-3.5 h-3.5 ${browseLoading ? "animate-spin" : ""}`} /> Try again
                  </button>
                </div>
              </div>
            )}

            {browse.length > 0 && (
              <>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                  Showing <span className="font-semibold text-gray-700 dark:text-gray-200">{browse.length}</span>
                  {browseTotal !== null && <> of <span className="font-semibold text-gray-700 dark:text-gray-200">{browseTotal.toLocaleString()}</span></>}{" "}
                  US institutions — scroll the list, or search above to jump to one.
                </p>
                <div className="space-y-2 max-h-[32rem] overflow-y-auto pr-1">
                  {browse.map((inst) => (
                    <InstitutionRow key={inst.institution_id} inst={inst} />
                  ))}
                </div>
              </>
            )}

            {browseLoading && (
              <p className="text-sm text-gray-400 mt-3">
                {browse.length === 0 ? "Loading Plaid's institution directory…" : "Loading more banks…"}
              </p>
            )}

            {!browseLoading && !browseError && browse.length === 0 && (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Plaid returned no institutions for the US directory.
              </p>
            )}

            {browse.length > 0 && !browseLoading && (
              browseDone ? (
                <p className="text-xs text-gray-400 mt-3">End of the directory — all {browse.length.toLocaleString()} loaded.</p>
              ) : (
                <button
                  onClick={loadMoreBanks}
                  className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Load {BROWSE_PAGE} more
                </button>
              )
            )}
          </>
        )}

        <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
          An <span className="font-semibold">OAuth</span> badge means the bank requires Plaid's OAuth flow — which only
          works for us if that bank is on the enabled list above. The directory order is Plaid's own; it is not ranked
          by size or relevance.
        </p>
      </Card>
    </div>
  );
}
