// ─────────── useUnderwritingSummaries — "has this file been underwritten?" ───────────
//
// WHY A BATCH HOOK AND NOT A PER-ROW FETCH
//
// The owner wants the AI underwriter reachable wherever a merchant has bank
// statements. The processor board renders ~400 rows, and the underwriter itself
// is a ~1-minute LLM call that costs real money ("I don't want to pay for tokens
// every time", 2026-09-21). So the control on a row may cost NOTHING to render
// and the run may only happen on an explicit click.
//
// But a control that cannot tell a completed run from a never-run one is how the
// money gets spent twice: a processor who sees "Run underwriting" on a deal the
// owner already underwrote has no reason not to click it. That is the exact bug
// migration 20260921a was written for — she could not READ the existing row, so
// the panel printed "No AI underwriting yet" over a result that existed.
//
// So: ONE lean read for every visible deal (ids, version, the two verdict
// ratings, the date — no jsonb), and the label follows what came back.
//
// THREE STATES, NOT TWO. A failed read is NOT "never underwritten". It renders as
// a neutral "AI Underwriter", never as "Run" — because "Run" on a deal that has
// already been run is an invitation to spend tokens on work that is already done.
// See src/lib/readable.ts and the memory `readers-must-distinguish-unreadable`.
//
// RLS: `deal_underwriting` is readable by a processor via
// `processor_select_all_underwriting` (migration 20260921a), so this hook works
// unchanged for role=closer + closers.is_processor.

import { useCallback, useEffect, useMemo, useState } from "react";
import supabase from "@/supabase";
import { readResult, type Readable } from "@/lib/readable";

export interface UWSummary {
  dealId: string;
  /** The run row id — the newest version for this deal. */
  id: string;
  version: number | null;
  risk: string | null;
  affordability: string | null;
  createdAt: string | null;
}

/** What a surface is allowed to say about a deal's underwriting. */
export type UWVerdict =
  | { kind: "has"; summary: UWSummary }
  /** The read SUCCEEDED and there is genuinely no run on this deal. */
  | { kind: "none" }
  /** We could not find out. Must never be rendered as "never run". */
  | { kind: "unknown"; why: string };

interface Row {
  id: string;
  deal_id: string;
  version: number | null;
  risk_rating: string | null;
  affordability_rating: string | null;
  created_at: string | null;
}

// PostgREST puts `in(...)` in the query string, so a 500-row board must not go
// out as one URL. 150 uuids ≈ 5.5KB, comfortably inside any proxy's limit.
const CHUNK = 150;

/**
 * Latest underwriting run per deal, for a set of deals, in one lean read.
 *
 * `dealIds` may be recreated every render — the fetch keys on the sorted id set,
 * not the array identity, so a new array with the same ids does not refetch.
 */
export function useUnderwritingSummaries(dealIds: string[], enabled = true) {
  const key = useMemo(
    () => [...new Set(dealIds.filter(Boolean))].sort().join(","),
    [dealIds],
  );
  const [state, setState] = useState<Readable<Map<string, UWSummary>>>({ kind: "loading" });

  const load = useCallback(async () => {
    const ids = key ? key.split(",") : [];
    if (!enabled) {
      // Not asked for — that is not an answer either. Callers that gate on a
      // capability flag must not see an empty map and conclude "no runs".
      setState({ kind: "unreadable", why: "underwriting history was not checked on this surface" });
      return;
    }
    if (ids.length === 0) {
      setState({ kind: "ok", value: new Map() });
      return;
    }
    setState({ kind: "loading" });
    const byDeal = new Map<string, UWSummary>();
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      const res = await supabase
        .from("deal_underwriting")
        .select("id, deal_id, version, risk_rating, affordability_rating, created_at")
        .in("deal_id", slice)
        .order("version", { ascending: false });
      const chunk = readResult<Row[]>(res as { data: Row[] | null; error: { message: string } | null }, []);
      if (chunk.kind !== "ok") {
        // A HOLE IN THE SWEEP IS NOT A SET OF ZEROS. One failed chunk poisons the
        // whole map: the deals in it would otherwise come back as "never run".
        setState({
          kind: "unreadable",
          why: chunk.kind === "unreadable" ? chunk.why : "the underwriting history read did not complete",
        });
        return;
      }
      for (const r of chunk.value) {
        // Ordered version-desc, so the first row seen for a deal is its newest.
        if (byDeal.has(r.deal_id)) continue;
        byDeal.set(r.deal_id, {
          dealId: r.deal_id,
          id: r.id,
          version: r.version,
          risk: r.risk_rating,
          affordability: r.affordability_rating,
          createdAt: r.created_at,
        });
      }
    }
    setState({ kind: "ok", value: byDeal });
  }, [key, enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  const verdictFor = useCallback(
    (dealId: string): UWVerdict => {
      if (state.kind === "loading") return { kind: "unknown", why: "still checking for an existing run" };
      if (state.kind === "unreadable") return { kind: "unknown", why: state.why };
      const s = state.value.get(dealId);
      return s ? { kind: "has", summary: s } : { kind: "none" };
    },
    [state],
  );

  return { state, verdictFor, reload: load };
}

export default useUnderwritingSummaries;
