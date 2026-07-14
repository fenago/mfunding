import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ExclamationTriangleIcon,
  GlobeAltIcon,
  MinusCircleIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline";
import supabase from "../../supabase";

/**
 * EnrichmentCard — one-button Firecrawl research on a lead's business
 * (research/PLAN_business_enrichment.md, ENR3 — the card, built mount-ready).
 *
 * STANDALONE + SELF-CONTAINED: give it a dealId + customerId and it fetches its
 * own data. It NEVER writes to customers/deals/drafts itself — every found value
 * is surfaced through the onUse(field, value) callback and the HOST decides what
 * to do with it (plan §7: LOAD is always an explicit human action).
 *
 * States: never-run / running / confident / possible-mismatch banner / no-match
 * (with "Not the right business?" seed-URL re-run) / stale-refresh / cap-reached.
 *
 * TRUTH DISCIPLINE: everything shown here is UNVERIFIED web data — the card says
 * so on every surface. A no_match run exposes NO Use buttons at all.
 *
 * ⚠️ INJECTION SAFETY (P1): the row's found_* / candidates / raw content is scraped
 * from arbitrary web pages. This card only RENDERS it as text. Nothing in P1
 * feeds it to an LLM — if P2 wires it into deal-assistant/underwrite-deal, that
 * code must fence it as untrusted DATA per plan §7. Do not wire it naively.
 */

export type EnrichmentUseField =
  | "street" | "city" | "state" | "zip" | "phone" | "website" | "entity_hint" | "ein" | "year_started";

interface EnrichmentRow {
  id: string;
  deal_id: string | null;
  customer_id: string | null;
  status: "searching" | "crawling" | "analyzing" | "completed" | "failed";
  error: string | null;
  candidates: Array<{ url: string; title: string; snippet: string; score: number; reasons: string[] }> | null;
  chosen_url: string | null;
  match_score: number | null;
  match_verdict: "confident" | "possible" | "no_match" | null;
  mismatch_reasons: string[] | null;
  found_street: string | null;
  found_city: string | null;
  found_state: string | null;
  found_zip: string | null;
  found_phone: string | null;
  found_website: string | null;
  found_entity_hint: string | null;
  found_ein: string | null;
  found_year_started: number | null;
  confirmations: Array<{ claim: string; lead_value: string | null; web_value: string | null; verdict: "match" | "differ" | "not_found" }> | null;
  credits_estimate: number | null;
  created_at: string;
  completed_at: string | null;
}

const STALE_DAYS = 30;

const LOAD_FIELDS: Array<{ key: EnrichmentUseField; label: string; pick: (r: EnrichmentRow) => string | null }> = [
  { key: "street", label: "Street", pick: (r) => r.found_street },
  { key: "city", label: "City", pick: (r) => r.found_city },
  { key: "state", label: "State", pick: (r) => r.found_state },
  { key: "zip", label: "ZIP", pick: (r) => r.found_zip },
  { key: "phone", label: "Phone", pick: (r) => r.found_phone },
  { key: "website", label: "Website", pick: (r) => r.found_website },
  { key: "entity_hint", label: "Entity type (hint)", pick: (r) => r.found_entity_hint },
  { key: "ein", label: "EIN (public)", pick: (r) => r.found_ein },
  { key: "year_started", label: "Year started", pick: (r) => (r.found_year_started != null ? String(r.found_year_started) : null) },
];

export default function EnrichmentCard({
  dealId,
  customerId,
  onUse,
}: {
  dealId: string;
  customerId: string;
  /** The HOST decides what a used value does (prefill a draft field, etc.). This card never writes. */
  onUse?: (field: EnrichmentUseField, value: string) => void;
}) {
  const [row, setRow] = useState<EnrichmentRow | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [running, setRunning] = useState(false);
  const [capReached, setCapReached] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [seedDraft, setSeedDraft] = useState("");
  const [showSeed, setShowSeed] = useState(false);
  const [showCandidates, setShowCandidates] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("business_enrichment")
      .select("*")
      .or(`deal_id.eq.${dealId},customer_id.eq.${customerId}`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setRow((data as EnrichmentRow | null) ?? null);
    setLoaded(true);
    return (data as EnrichmentRow | null) ?? null;
  }, [dealId, customerId]);

  useEffect(() => { void load(); }, [load]);

  // While a run is in flight (server-side status non-terminal), poll the row.
  const inFlight = running || (row != null && row.status !== "completed" && row.status !== "failed");
  useEffect(() => {
    if (!inFlight) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    pollRef.current = setInterval(() => { void load(); }, 4000);
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [inFlight, load]);

  const run = async (opts: { force?: boolean; seed_url?: string } = {}) => {
    setRunning(true); setNote(null); setCapReached(false);
    try {
      const { data, error } = await supabase.functions.invoke("enrich-business", {
        body: { dealId, ...(opts.force ? { force: true } : {}), ...(opts.seed_url ? { seed_url: opts.seed_url } : {}) },
      });
      if (error) {
        // FunctionsHttpError carries the Response in .context — read the real status/message.
        const ctx = (error as { context?: Response }).context;
        let msg = error.message;
        if (ctx) {
          try {
            const body = await ctx.clone().json();
            msg = (body as { error?: string })?.error ?? msg;
            if (ctx.status === 429) { setCapReached(true); setNote(msg); return; }
          } catch { /* keep default message */ }
        }
        setNote(msg);
        return;
      }
      if ((data as { cached?: boolean })?.cached) setNote("Loaded from a recent research run (cached — $0).");
      setShowSeed(false); setSeedDraft("");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Research failed.");
    } finally {
      setRunning(false);
      void load();
    }
  };

  if (!loaded) return null;

  // ── Never run ──────────────────────────────────────────────────────────────
  if (!row && !running) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
        <button
          type="button"
          onClick={() => void run()}
          disabled={capReached}
          title={capReached ? "Daily research budget reached — resets at midnight ET" : "Research this business online (Firecrawl)"}
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          <GlobeAltIcon className="w-4 h-4" /> Research business
        </button>
        {note && <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">{note}</p>}
      </div>
    );
  }

  // ── Running ────────────────────────────────────────────────────────────────
  if (inFlight) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 flex items-center gap-2">
        <ArrowPathIcon className="w-4 h-4 animate-spin text-indigo-500" />
        <span className="text-xs text-gray-600 dark:text-gray-300">Researching… ~60–90 s. You can keep working — results appear here.</span>
      </div>
    );
  }

  if (!row) return null;

  // ── Failed ─────────────────────────────────────────────────────────────────
  if (row.status === "failed") {
    return (
      <div className="rounded-xl border border-red-200 dark:border-red-900 bg-white dark:bg-gray-800 p-3">
        <p className="text-xs text-red-700 dark:text-red-300 font-semibold">Research failed</p>
        {row.error && <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 font-mono">{row.error}</p>}
        <button type="button" onClick={() => void run({ force: true })}
          className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">
          <ArrowPathIcon className="w-3 h-3" /> Try again
        </button>
        {note && <p className="mt-1.5 text-[11px] text-gray-600 dark:text-gray-300">{note}</p>}
      </div>
    );
  }

  // ── Completed ──────────────────────────────────────────────────────────────
  const verdict = row.match_verdict ?? "no_match";
  const noMatch = verdict === "no_match";
  const ageDays = row.completed_at ? Math.floor((Date.now() - new Date(row.completed_at).getTime()) / 86400_000) : 0;
  const stale = ageDays > STALE_DAYS;
  const loadRows = LOAD_FIELDS.map((f) => ({ ...f, value: f.pick(row) })).filter((f) => f.value);
  const sourceHost = row.chosen_url ? safeHost(row.chosen_url) : null;

  const verdictChip = verdict === "confident" ? (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
      <CheckCircleIcon className="w-3 h-3" /> Confident match {row.match_score}
    </span>
  ) : verdict === "possible" ? (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
      <ExclamationTriangleIcon className="w-3 h-3" /> Possible match {row.match_score} — verify
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600">
      <XCircleIcon className="w-3 h-3" /> No match
    </span>
  );

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <GlobeAltIcon className="w-4 h-4 text-indigo-500" />
        <span className="text-xs font-semibold text-gray-800 dark:text-gray-100">Business research</span>
        {verdictChip}
        {sourceHost && (
          <a href={row.chosen_url ?? "#"} target="_blank" rel="noreferrer"
            className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline">{sourceHost}</a>
        )}
        <span className="text-[10px] text-gray-400">found online — confirm with merchant</span>
        <span className="ml-auto text-[10px] text-gray-400">
          {stale ? `Researched ${ageDays}d ago` : row.completed_at ? new Date(row.completed_at).toLocaleDateString() : ""}
        </span>
        {stale && (
          <button type="button" onClick={() => void run({ force: true })} disabled={running}
            title="Re-run the research (this spends Firecrawl credits)"
            className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
            <ArrowPathIcon className="w-3 h-3" /> Refresh
          </button>
        )}
      </div>

      {/* Possible-mismatch banner */}
      {verdict === "possible" && (
        <div className="mt-2 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30 px-2.5 py-1.5">
          <p className="text-[11px] font-semibold text-amber-800 dark:text-amber-300">
            Possible mismatch — verify before using anything below.
          </p>
          {(row.mismatch_reasons ?? []).map((r, i) => (
            <p key={i} className="text-[11px] text-amber-700 dark:text-amber-400">• {r}</p>
          ))}
        </div>
      )}

      {/* No match */}
      {noMatch && (
        <p className="mt-2 text-xs text-gray-600 dark:text-gray-300">
          Couldn't find this business online with what the lead gave us.
        </p>
      )}

      {/* LOAD block — a no_match run exposes NO Use buttons at all (plan §4 hard rule). */}
      {!noMatch && loadRows.length > 0 && (
        <div className="mt-2">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold text-gray-700 dark:text-gray-200">Found online (unverified)</p>
            {onUse && (
              <button type="button"
                onClick={() => loadRows.forEach((f) => onUse(f.key, f.value as string))}
                className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
                Use all
              </button>
            )}
          </div>
          <div className="mt-1 divide-y divide-gray-100 dark:divide-gray-700">
            {loadRows.map((f) => (
              <div key={f.key} className="flex items-center gap-2 py-1">
                <span className="w-28 shrink-0 text-[11px] text-gray-500 dark:text-gray-400">{f.label}</span>
                <span className="flex-1 text-[11px] text-gray-800 dark:text-gray-100 break-all">{f.value}</span>
                {onUse && (
                  <button type="button" onClick={() => onUse(f.key, f.value as string)}
                    className="text-[11px] font-semibold px-2 py-0.5 rounded-lg border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/30">
                    Use
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CONFIRM block — deterministic claim-vs-web table. */}
      {!noMatch && (row.confirmations?.length ?? 0) > 0 && (
        <div className="mt-2">
          <p className="text-[11px] font-semibold text-gray-700 dark:text-gray-200">What they told us vs. the web</p>
          <div className="mt-1 divide-y divide-gray-100 dark:divide-gray-700">
            {row.confirmations!.map((c, i) => (
              <div key={i} className="flex items-center gap-2 py-1">
                {c.verdict === "match" ? <CheckCircleIcon className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
                  : c.verdict === "differ" ? <ExclamationTriangleIcon className="w-3.5 h-3.5 shrink-0 text-amber-500" />
                  : <MinusCircleIcon className="w-3.5 h-3.5 shrink-0 text-gray-400" />}
                <span className="w-24 shrink-0 text-[11px] text-gray-500 dark:text-gray-400">{c.claim}</span>
                <span className="flex-1 text-[11px] text-gray-700 dark:text-gray-200 break-all">
                  {c.lead_value ?? "—"} <span className="text-gray-400">vs</span> {c.web_value ?? "not found"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Candidates disclosure — what was considered and rejected. */}
      {(row.candidates?.length ?? 0) > 0 && (
        <div className="mt-2">
          <button type="button" onClick={() => setShowCandidates((s) => !s)}
            className="inline-flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
            <ChevronDownIcon className={`w-3 h-3 transition-transform ${showCandidates ? "rotate-180" : ""}`} />
            Candidates considered ({row.candidates!.length})
          </button>
          {showCandidates && (
            <div className="mt-1 space-y-0.5">
              {row.candidates!.map((c, i) => (
                <p key={i} className="text-[11px] text-gray-500 dark:text-gray-400 break-all">
                  <span className="font-mono">{c.score}</span> · {safeHost(c.url)} — {c.title}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Not the right business? Seed-URL re-run (server validates the URL). */}
      <div className="mt-2">
        {!showSeed ? (
          <button type="button" onClick={() => setShowSeed(true)}
            className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline">
            Not the right business? Re-run with their website URL
          </button>
        ) : (
          <div className="flex gap-1.5">
            <input type="url" value={seedDraft} onChange={(e) => setSeedDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && seedDraft.trim()) void run({ seed_url: seedDraft.trim() }); }}
              placeholder="https://theirbusiness.com"
              className="flex-1 text-[11px] rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 px-2 py-1" />
            <button type="button" disabled={running || !seedDraft.trim()}
              onClick={() => void run({ seed_url: seedDraft.trim() })}
              className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
              Re-run
            </button>
          </div>
        )}
      </div>

      {capReached && (
        <p className="mt-1.5 text-[11px] text-amber-700 dark:text-amber-300">
          Daily research budget reached — resets at midnight ET.
        </p>
      )}
      {note && !capReached && <p className="mt-1.5 text-[11px] text-gray-600 dark:text-gray-300">{note}</p>}
    </div>
  );
}

function safeHost(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}
