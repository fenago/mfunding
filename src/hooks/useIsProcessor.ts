import { useEffect, useState } from "react";
import supabase from "@/supabase";
import { useUserProfile } from "@/context/UserProfileContext";

/**
 * useIsProcessor — is the signed-in user a PROCESSOR (a closer with the extra
 * whole-board capability)? A processor is NOT a new role: it's a boolean flag on
 * their `closers` row (see 20260830_processor_flag.sql). This calls the
 * SECURITY DEFINER `is_processor(uid)` RPC (which reads past the closers RLS) for
 * the EFFECTIVE user id, so a super_admin "viewing as" a setter sees THAT setter's
 * capability, matching the rest of the console.
 *
 * Cheap + cached: the answer is memoised per user id at module scope, so mounting
 * the hook again (e.g. re-rendering the Ops tab) does not re-hit the RPC.
 *
 * HONESTY (readers-must-distinguish-unreadable): a FAILED read is NOT "false".
 * On error the hook returns { isProcessor: false, error } and never caches — the
 * caller can choose to keep the board hidden (fail-closed, the safe default here)
 * while still knowing the read did not succeed.
 */

const cache = new Map<string, boolean>();

interface State {
  isProcessor: boolean;
  loading: boolean;
  error: string | null;
}

export default function useIsProcessor(): State {
  const { effectiveUserId } = useUserProfile();
  const [state, setState] = useState<State>(() => {
    const cached = effectiveUserId ? cache.get(effectiveUserId) : undefined;
    return cached === undefined
      ? { isProcessor: false, loading: !!effectiveUserId, error: null }
      : { isProcessor: cached, loading: false, error: null };
  });

  useEffect(() => {
    if (!effectiveUserId) {
      setState({ isProcessor: false, loading: false, error: null });
      return;
    }
    const cached = cache.get(effectiveUserId);
    if (cached !== undefined) {
      setState({ isProcessor: cached, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState({ isProcessor: false, loading: true, error: null });
    supabase
      .rpc("is_processor", { uid: effectiveUserId })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          // Do NOT cache a failed read — an unreadable capability is not "false".
          setState({ isProcessor: false, loading: false, error: error.message });
          return;
        }
        const val = data === true;
        cache.set(effectiveUserId, val);
        setState({ isProcessor: val, loading: false, error: null });
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveUserId]);

  return state;
}
