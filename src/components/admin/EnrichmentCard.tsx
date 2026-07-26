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
  // Verify & save (confirm-enrichment). Null on every fresh run → unverified again.
  verified_at: string | null;
  verified_by: string | null;
  verified_fields: string[] | null;
}

/** What confirm-enrichment returns, so the card can report exactly what landed. */
interface ConfirmResponse {
  ok?: boolean;
  error?: string;
  verified_by_name?: string | null;
  verified_fields?: string[];
  applied?: Array<{ field: string; label: string; value: string; where: string; from: string | null }>;
  skipped?: Array<{ field: string; label: string; reason: string }>;
  ghl_synced?: boolean;
  ghl_fields?: string[];
  ghl_error?: string | null;
}

/** Fields the confirm flow can write to the merchant record / GHL contact. entity
 *  type and year-started have no customers column (and are risky on a legal doc),
 *  so they surface as read-only findings, never a save. */
const CONFIRMABLE = new Set<EnrichmentUseField>(["street", "city", "state", "zip", "phone", "website", "ein"]);

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
  enableConfirm = false,
}: {
  dealId: string;
  customerId: string;
  /** The HOST decides what a used value does (prefill a draft field, etc.). In this
   *  mode the card never writes anything itself. */
  onUse?: (field: EnrichmentUseField, value: string) => void;
  /** Opt in to the VERIFY & SAVE flow: per-field "✓ Use this" + "Confirm all" that
   *  write the found values onto the merchant record (customers) + GHL contact and
   *  stamp the run verified. Playbook card only — the application modal stays
   *  compare/draft-fill so research never mutates a doc already on paper. Ignored
   *  when onUse is provided (draft-fill takes precedence). */
  enableConfirm?: boolean;
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

  // ── Verify & save (confirm-to-record) — only when NOT in draft-fill mode.
  // With onUse the card prefills an application draft (host owns the write); without
  // it (the playbook card) the card confirms findings onto the merchant record. ──
  const confirmMode = enableConfirm && !onUse;
  const [confirming, setConfirming] = useState<string | null>(null); // "all" | field key
  const [confirmNote, setConfirmNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [verifierName, setVerifierName] = useState<string | null>(null);
  // Two-step arm/fire for "Confirm all" — NO browser popups (owner rule).
  const [armed, setArmed] = useState<string | null>(null);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 5000);
    return () => clearTimeout(t);
  }, [armed]);
  const armOrFire = (key: string): boolean => {
    if (armed === key) { setArmed(null); return true; }
    setArmed(key);
    return false;
  };

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

  // Resolve who confirmed (for the "✓ Confirmed by [name]" badge on reload).
  useEffect(() => {
    const by = row?.verified_by;
    if (!by) { setVerifierName(null); return; }
    let cancelled = false;
    void supabase
      .from("profiles").select("display_name, first_name, last_name, email").eq("id", by).maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return;
        setVerifierName(
          data.display_name ||
          [data.first_name, data.last_name].filter(Boolean).join(" ") ||
          data.email || "staff",
        );
      });
    return () => { cancelled = true; };
  }, [row?.verified_by]);

  const edgeMsg = async (error: unknown, fallback: string): Promise<string> => {
    const ctx = (error as { context?: Response }).context;
    if (ctx) {
      try { const b = await ctx.clone().json(); return (b as { error?: string })?.error ?? fallback; } catch { /* fall through */ }
    }
    return (error as Error)?.message ?? fallback;
  };

  // Confirm one field or all confirmable fields → writes to customers + GHL,
  // stamps the research row verified. Surfaces a GHL failure LOUDLY (no silent ok).
  const confirm = async (fields: EnrichmentUseField[]) => {
    if (!row || fields.length === 0) return;
    setConfirming(fields.length === 1 ? fields[0] : "all");
    setConfirmNote(null);
    try {
      const { data, error } = await supabase.functions.invoke("confirm-enrichment", {
        body: { enrichmentId: row.id, fields },
      });
      if (error) { setConfirmNote({ ok: false, text: await edgeMsg(error, "Confirm failed.") }); return; }
      const d = data as ConfirmResponse;
      if (d?.error) { setConfirmNote({ ok: false, text: d.error }); return; }
      if (d?.verified_by_name) setVerifierName(d.verified_by_name);
      const appliedTxt = (d.applied ?? []).map((a) => a.label).join(", ") || "nothing new";
      let text = `✓ Saved to the record: ${appliedTxt}.`;
      if (d.ghl_error) text += ` ⚠ ${d.ghl_error}`;
      else if ((d.ghl_fields?.length ?? 0) > 0) text += " Pushed to GHL.";
      if ((d.skipped?.length ?? 0) > 0) text += ` Skipped: ${d.skipped!.map((s) => `${s.label} (${s.reason})`).join(", ")}.`;
      setConfirmNote({ ok: !d.ghl_error, text });
    } catch (e) {
      setConfirmNote({ ok: false, text: e instanceof Error ? e.message : "Confirm failed." });
    } finally {
      setConfirming(null);
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

  // Confirm-to-record state (playbook card only).
  const appliedSet = new Set(row.verified_fields ?? []);
  const verified = confirmMode && !!row.verified_at;
  const unconfirmed = loadRows.filter((f) => CONFIRMABLE.has(f.key) && !appliedSet.has(f.key));

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
        {verified ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800"
            title={`Confirmed fields: ${(row.verified_fields ?? []).join(", ")}`}>
            <CheckCircleIcon className="w-3 h-3" /> Confirmed by {verifierName ?? "staff"}
            {row.verified_at ? ` · ${new Date(row.verified_at).toLocaleDateString()}` : ""}
          </span>
        ) : (
          <span className="text-[10px] text-gray-400">found online — confirm with merchant</span>
        )}
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
            <p className="text-[11px] font-semibold text-gray-700 dark:text-gray-200">
              {confirmMode
                ? (verified ? "Findings (confirm applies to the merchant record)" : "Found online (unverified)")
                : "Found online (unverified)"}
            </p>
            {onUse ? (
              <button type="button"
                onClick={() => loadRows.forEach((f) => onUse(f.key, f.value as string))}
                className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
                Use all
              </button>
            ) : confirmMode && unconfirmed.length > 0 ? (
              // Two-step arm/fire — this WRITES to the merchant record + GHL.
              <button type="button"
                disabled={!!confirming}
                onClick={() => { if (armOrFire("confirm-all")) void confirm(unconfirmed.map((f) => f.key)); }}
                className={`text-[11px] font-semibold px-2 py-0.5 rounded-lg ${armed === "confirm-all"
                  ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-300 dark:border-amber-800"
                  : "bg-emerald-600 text-white hover:bg-emerald-700"} disabled:opacity-50`}
                title="Confirm every found field onto this merchant's record and GHL contact">
                {confirming === "all" ? "Saving…" : armed === "confirm-all" ? "⚠️ Tap again to save all →" : "✅ Confirm all"}
              </button>
            ) : null}
          </div>
          <div className="mt-1 divide-y divide-gray-100 dark:divide-gray-700">
            {loadRows.map((f) => {
              const isConfirmable = CONFIRMABLE.has(f.key);
              const isApplied = appliedSet.has(f.key);
              return (
                <div key={f.key} className="flex items-center gap-2 py-1">
                  <span className="w-28 shrink-0 text-[11px] text-gray-500 dark:text-gray-400">{f.label}</span>
                  <span className="flex-1 text-[11px] text-gray-800 dark:text-gray-100 break-all">{f.value}</span>
                  {onUse ? (
                    <button type="button" onClick={() => onUse(f.key, f.value as string)}
                      className="text-[11px] font-semibold px-2 py-0.5 rounded-lg border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/30">
                      Use
                    </button>
                  ) : confirmMode && isApplied ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                      <CheckCircleIcon className="w-3.5 h-3.5" /> {f.key === "website" ? "in GHL" : "saved"}
                    </span>
                  ) : confirmMode && isConfirmable ? (
                    <button type="button"
                      disabled={!!confirming}
                      onClick={() => void confirm([f.key])}
                      className="text-[11px] font-semibold px-2 py-0.5 rounded-lg border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 disabled:opacity-50"
                      title="Save this value onto the merchant's record + GHL contact">
                      {confirming === f.key ? "Saving…" : "✓ Use this"}
                    </button>
                  ) : confirmMode ? (
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 shrink-0" title="No field on the merchant record for this">not saved</span>
                  ) : null}
                </div>
              );
            })}
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

      {confirmNote && (
        <p className={`mt-1.5 text-[11px] ${confirmNote.ok
          ? "text-emerald-700 dark:text-emerald-300"
          : "text-amber-700 dark:text-amber-300"}`}>
          {confirmNote.text}
        </p>
      )}
    </div>
  );
}

function safeHost(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}
