import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import supabase from "../supabase";
import { mustWrite, tryWrite } from "@/supabase/writes";
import { useSession } from "../context/SessionContext";
import type { QueueDeal } from "../services/dealService";

// The columns the My Day cards render — mirrors getOpenDealsForQueue's select so a
// STARRED card looks identical whether the deal is still in the live queue or has
// moved on (funded/parked). Deliberately NOT status-filtered: a bookmark must
// survive the deal leaving the queue, so we pull the row whatever its status.
const PINNED_DEAL_SELECT = `
  *,
  customer:customers!customer_id (
    id, first_name, last_name, business_name, email, additional_emails, phone, additional_phones,
    monthly_revenue, time_in_business, industry
  ),
  submissions:deal_submissions ( response_at, status )
`;

export interface UseDealPins {
  /** deal_ids the current user has starred. */
  pinnedIds: Set<string>;
  /** deal_id → pinned-at epoch ms, for "most-recently-pinned first" ordering. */
  pinnedAt: Map<string, number>;
  /**
   * Full deal rows for EVERY pin the user has (same shape as the queue), so the
   * Starred group can render a card even for a deal that has dropped out of the
   * live queue. A pin whose deal RLS hides (e.g. reassigned away) simply won't
   * appear here — the bookmark row still exists, we just can't show what we can't read.
   */
  pinnedDeals: QueueDeal[];
  /** Optimistic star/un-star. Reverts + throws (loud) on failure. */
  togglePin: (dealId: string) => Promise<void>;
  loading: boolean;
  /** Last write error, surfaced loudly by the caller; cleared on the next toggle. */
  error: string | null;
  /** Manual reload (the caller polls the queue; pins piggyback on that cadence). */
  reload: () => void;
}

/**
 * The current user's personal deal bookmarks. Keyed to the REAL signed-in user
 * (auth.uid()), not an impersonated profile — a star is a private, per-person
 * shortcut, and RLS on deal_pins enforces exactly that.
 */
export function useDealPins(): UseDealPins {
  const { session } = useSession();
  const userId = session?.user?.id ?? null;

  const [pins, setPins] = useState<{ deal_id: string; created_at: string }[]>([]);
  const [pinnedDeals, setPinnedDeals] = useState<QueueDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Guards a fetch race: an optimistic toggle bumps this, and a slower in-flight
  // load() that resolves afterward is ignored so it can't clobber the new state.
  const genRef = useRef(0);

  const load = useCallback(() => {
    if (!userId) {
      setPins([]);
      setPinnedDeals([]);
      setLoading(false);
      return;
    }
    const gen = ++genRef.current;
    supabase
      .from("deal_pins")
      .select("deal_id, created_at")
      .eq("user_id", userId)
      .then(async ({ data, error: pinErr }) => {
        if (gen !== genRef.current) return;
        if (pinErr) {
          setPins([]);
          setPinnedDeals([]);
          setLoading(false);
          return;
        }
        const rows = (data ?? []) as { deal_id: string; created_at: string }[];
        setPins(rows);
        const ids = rows.map((r) => r.deal_id);
        if (ids.length === 0) {
          setPinnedDeals([]);
          setLoading(false);
          return;
        }
        const { data: deals } = await supabase.from("deals").select(PINNED_DEAL_SELECT).in("id", ids);
        if (gen !== genRef.current) return;
        setPinnedDeals(((deals ?? []) as unknown) as QueueDeal[]);
        setLoading(false);
      });
  }, [userId]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const pinnedIds = useMemo(() => new Set(pins.map((p) => p.deal_id)), [pins]);
  const pinnedAt = useMemo(
    () => new Map(pins.map((p) => [p.deal_id, Date.parse(p.created_at)])),
    [pins],
  );

  const togglePin = useCallback(
    async (dealId: string) => {
      if (!userId) throw new Error("Sign in to star a deal.");
      setError(null);
      const wasPinned = pinnedIds.has(dealId);
      // Optimistic: flip the pin locally now, reconcile with the server after.
      genRef.current++;
      if (wasPinned) {
        setPins((prev) => prev.filter((p) => p.deal_id !== dealId));
      } else {
        setPins((prev) => [...prev, { deal_id: dealId, created_at: new Date().toISOString() }]);
      }
      try {
        if (wasPinned) {
          // Un-star. tryWrite (not mustWrite): a delete that removes 0 rows because
          // the pin is already gone — a double-tap, or another tab beat us — is not
          // a failure, and RLS permits a user to delete only their own pins anyway.
          const ok = await tryWrite(
            "Un-star deal",
            supabase.from("deal_pins").delete().eq("user_id", userId).eq("deal_id", dealId),
          );
          if (!ok) throw new Error("the un-star write was rejected.");
        } else {
          // Star. Upsert (not insert) so a re-star of an already-pinned deal is
          // idempotent — it returns the existing row instead of a 23505, and
          // mustWrite still surfaces a real RLS/constraint failure loudly.
          await mustWrite(
            "Star deal",
            supabase
              .from("deal_pins")
              .upsert({ user_id: userId, deal_id: dealId }, { onConflict: "user_id,deal_id" }),
          );
        }
        // Pull the authoritative pin list (and any newly-pinned deal row).
        load();
      } catch (e) {
        // Revert the optimistic flip and surface loudly.
        genRef.current++;
        if (wasPinned) {
          setPins((prev) =>
            prev.some((p) => p.deal_id === dealId)
              ? prev
              : [...prev, { deal_id: dealId, created_at: new Date().toISOString() }],
          );
        } else {
          setPins((prev) => prev.filter((p) => p.deal_id !== dealId));
        }
        const msg = e instanceof Error ? e.message : "Couldn't update the star.";
        setError(msg);
        throw new Error(msg);
      }
    },
    [userId, pinnedIds, load],
  );

  return { pinnedIds, pinnedAt, pinnedDeals, togglePin, loading, error, reload: load };
}
