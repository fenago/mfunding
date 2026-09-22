import { useEffect, useState } from "react";
import supabase from "@/supabase";

/**
 * contact id -> where that lead came from, for per-row origin badges.
 *
 * Owner, 2026-09-21: "i need some kind of badge or something to know what is
 * real-time, live transfer or setter wavv call". A positive disposition means
 * something different depending on its origin — a callback off a live transfer
 * is not the same event as a callback off a cold UCC dial — and the tables had
 * no way to say which.
 *
 * ONE RPC FOR A PAGE OF ROWS, never one per row. Keyed on the sorted id list so
 * a re-render with the same merchants doesn't refetch.
 *
 * HONESTY: a failed read returns an EMPTY map and sets `error`. Callers render
 * no badge at all in that case — a row with no badge means "we didn't establish
 * it", and must never be styled to look like a known origin. `unattributed`
 * (which the RPC returns as "Origin unknown") is a different thing: that one we
 * asked about and could not trace.
 */

export interface DialOrigin {
  origin: string;
  short_label: string;
  is_cold_outbound: boolean;
}

export default function useDialOrigins(contactIds: (string | null | undefined)[]) {
  const ids = [...new Set(contactIds.filter((v): v is string => !!v))].sort();
  const key = ids.join(",");
  const [map, setMap] = useState<Map<string, DialOrigin>>(new Map());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ids.length === 0) { setMap(new Map()); return; }
    let alive = true;
    supabase.rpc("dial_origin_for_contacts", { p_contact_ids: ids }).then(({ data, error: err }) => {
      if (!alive) return;
      if (err) { setError(err.message); setMap(new Map()); return; }
      setError(null);
      const next = new Map<string, DialOrigin>();
      for (const r of (data ?? []) as (DialOrigin & { contact_id: string })[]) {
        next.set(r.contact_id, { origin: r.origin, short_label: r.short_label, is_cold_outbound: r.is_cold_outbound });
      }
      setMap(next);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { origins: map, error };
}

/** Badge classes by origin family. Warm vendor traffic reads green, cold list
 *  reads neutral-grey, and an origin we could not trace reads amber — the same
 *  three-state colour language the signature badges use. */
export function originBadgeClass(o: DialOrigin): string {
  if (o.origin === "unattributed") {
    return "border-amber-400/50 text-amber-700 dark:text-amber-400";
  }
  if (o.is_cold_outbound) {
    return "border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400";
  }
  return "border-mint-green/40 text-mint-green";
}
