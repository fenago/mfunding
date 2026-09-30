import { useCallback, useEffect, useState } from "react";
import supabase from "../supabase";
import { MERCHANT_UPDATE_EVENT } from "./useMerchantUpdateAlert";

// useProcessorUpdatesBadge — the standing count of UNREAD changes on merchant
// files, behind the red half of the Processor sidebar pill and the count on the
// Updates tab.
//
// WHAT THE NUMBER MEANS: changes in the last 30 days, on deals still in an open
// stage, that THIS user has not marked read. Per-user on purpose
// (processor_notification_reads is keyed on notification × profile): two
// processors must not clear each other's badge.
//
// It empties by being worked, and a deal leaving the open stages drops its own
// rows out of the count, so it can never become permanent decoration.
//
// ⚠️ UNREADABLE IS NEVER ZERO. `count === null` with an `error` set means the
// read FAILED, and the pill must render that as an amber "?", never as a
// confident 0. A badge quietly showing nothing is precisely how the Bankers
// correction went unseen — this hook will not repeat it in miniature. The RPC
// raises rather than returning 0 for an unauthorised caller, so a failure
// cannot arrive disguised as an empty queue.
//
// CHEAP BY DESIGN: no rows are loaded and nothing polls. It refetches on mount,
// on window focus, and when a live update card fires.

export interface ProcessorUpdatesBadge {
  /** The count, or null when it could not be read. NEVER 0 on failure. */
  count: number | null;
  /** Set when the last read failed — surfaced in the pill's tooltip. */
  error: string | null;
  refetch: () => void;
}

export function useProcessorUpdatesBadge(opts?: {
  /** Only read for someone who can see the surface. Default true. */
  enabled?: boolean;
}): ProcessorUpdatesBadge {
  const enabled = opts?.enabled ?? true;
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!enabled) return;
    const { data, error: err } = await supabase.rpc("processor_unread_updates_count");
    if (err) {
      // Keep the last known count if we had one, but remember it is stale and
      // say so in the tooltip. Never fabricate a zero.
      setError(err.message);
      return;
    }
    if (typeof data === "number") {
      setCount(data);
      setError(null);
    } else {
      setError("the unread-updates count came back in a shape we don't understand");
    }
  }, [enabled]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEffect(() => {
    if (!enabled) return;
    const onUpdate = () => void refetch();
    const onFocus = () => {
      if (!document.hidden) void refetch();
    };
    window.addEventListener(MERCHANT_UPDATE_EVENT, onUpdate);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener(MERCHANT_UPDATE_EVENT, onUpdate);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [enabled, refetch]);

  return { count, error, refetch };
}

export default useProcessorUpdatesBadge;
