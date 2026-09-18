import { useCallback, useEffect, useState } from "react";
import supabase from "../supabase";
import { SIGNED_APP_EVENT } from "./useSignedApplicationAlert";

// useSignedAppsBadge — the standing count behind the sidebar pill.
//
// WHAT THE NUMBER MEANS: merchants who have SIGNED their application and have
// NO bank statements on file yet. Chosen over "signed today" or "signed ever"
// because a badge should count WORK, not history: the merchant has done their
// part, the deal cannot go to a funder without statements, and nothing else in
// the app counts this. It empties by itself the moment the statements land, so
// it can never become permanent decoration.
//
// Counted by MERCHANT, not by deal — a duplicate deal on one customer is one
// chase, and an inflated badge is an ignored badge. The rule lives in SQL
// (public.signed_apps_awaiting_statements), which also re-states the deal money
// wall: a setter sees their own book plus unassigned, ops and the processor see
// the board.
//
// ⚠️ UNREADABLE IS NEVER ZERO. `null` means the count could not be read, and the
// pill must render that as an unknown ("?"), never as a confident 0. A badge
// quietly dropping to zero is how a signed application goes unchased for a
// second time — the exact failure this whole feature exists to stop.
//
// CHEAP BY DESIGN: no rows are loaded and nothing polls. It refetches on mount,
// on window focus (which also catches statements arriving — customer_documents
// is not published to realtime), and when the signature alert fires.

export interface SignedAppsBadge {
  /** The count, or null when it could not be read. NEVER 0 on failure. */
  count: number | null;
  /** Set when the last read failed — surfaced in the pill's tooltip. */
  error: string | null;
  refetch: () => void;
}

export function useSignedAppsBadge(): SignedAppsBadge {
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const { data, error: err } = await supabase.rpc("signed_apps_awaiting_statements");
    if (err) {
      // Keep the last known count if we had one — but remember that it is stale
      // and say so. Never fabricate a zero.
      setError(err.message);
      return;
    }
    if (typeof data === "number") {
      setCount(data);
      setError(null);
    } else {
      setError("the signed-application count came back in a shape we don't understand");
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // A fresh signature raises the count; returning to the tab re-syncs everything
  // (statements uploaded elsewhere, a deal closed out, another sweep).
  useEffect(() => {
    const onSigned = () => void refetch();
    const onFocus = () => {
      if (!document.hidden) void refetch();
    };
    window.addEventListener(SIGNED_APP_EVENT, onSigned);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener(SIGNED_APP_EVENT, onSigned);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refetch]);

  return { count, error, refetch };
}

export default useSignedAppsBadge;
