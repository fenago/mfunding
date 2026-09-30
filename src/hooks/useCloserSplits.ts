import { useEffect, useState } from "react";
import supabase from "../supabase";
import { useUserProfile } from "../context/UserProfileContext";
import { COMMISSION_DEFAULTS } from "../types/commissions";

export interface CloserSplits {
  company_lead_split: number;
  self_gen_split: number;
  renewal_split: number;
}

// Fallback rates when the signed-in user has no `closers` row (e.g. an admin
// viewing the playbook). Company-lead default is 30%; self-gen/renewal reuse
// the shared commission defaults.
export const DEFAULT_CLOSER_SPLITS: CloserSplits = {
  company_lead_split: 30,
  self_gen_split: COMMISSION_DEFAULTS.SELF_GEN_SPLIT,
  renewal_split: COMMISSION_DEFAULTS.RENEWAL_SPLIT,
};

interface UseCloserSplitsResult {
  splits: CloserSplits;
  /** True once we've confirmed the user has a matching `closers` row.
   *  ⚠ FALSE MEANS "CONFIRMED NO ROW", NOT "WE DIDN'T CHECK" — see `unreadable`. */
  hasCloser: boolean;
  /**
   * Non-null = the `closers` read FAILED, so we do not know this person's
   * splits or whether they are a closer at all.
   *
   * This used to be indistinguishable from "not a closer": a failed read fell
   * into the same else-branch as a missing row and served
   * DEFAULT_CLOSER_SPLITS with hasCloser=false. Two separate harms:
   *
   *   MONEY ON SCREEN. The commission calculator and the per-deal "your cut"
   *   figure would show the 30% default instead of the rate the person
   *   actually negotiated, labelled "default rates" as though that were a
   *   fact about them rather than about a read that didn't happen.
   *
   *   A GATE THAT FAILED OPEN. useRenewalsAccess computes
   *   `isSuperAdmin || !hasCloser || renewalsEnabled`, so hasCloser=false
   *   GRANTED renewals to a closer whose renewals_enabled is off. A failed
   *   read must never widen access; it now fails closed and says why.
   */
  unreadable: string | null;
  /** The closer's per-user renewals gate. Meaningful only when hasCloser is true. */
  renewalsEnabled: boolean;
  loading: boolean;
}

/**
 * Loads the signed-in user's per-closer commission splits once, keyed by
 * closers.user_id → profiles.id. Falls back to DEFAULT_CLOSER_SPLITS (and
 * hasCloser=false) when the user isn't a closer.
 */
export function useCloserSplits(): UseCloserSplitsResult {
  const { effectiveUserId } = useUserProfile();
  const [splits, setSplits] = useState<CloserSplits>(DEFAULT_CLOSER_SPLITS);
  const [hasCloser, setHasCloser] = useState(false);
  const [renewalsEnabled, setRenewalsEnabled] = useState(false);
  const [unreadable, setUnreadable] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!effectiveUserId) {
        if (!cancelled) {
          setSplits(DEFAULT_CLOSER_SPLITS);
          setHasCloser(false);
          setRenewalsEnabled(false);
          setUnreadable(null); // no signed-in user is a known state, not a failed read
          setLoading(false);
        }
        return;
      }
      setLoading(true);
      const { data, error } = await supabase
        .from("closers")
        .select("company_lead_split, self_gen_split, renewal_split, renewals_enabled")
        .eq("user_id", effectiveUserId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        // Do NOT fall through to the no-row branch. We keep the defaults so
        // nothing renders NaN, but `unreadable` tells every consumer that the
        // numbers are a placeholder and the gates must not open on them.
        setSplits(DEFAULT_CLOSER_SPLITS);
        setHasCloser(false);
        setRenewalsEnabled(false);
        setUnreadable(error.message);
        setLoading(false);
        return;
      }
      setUnreadable(null);
      if (data) {
        setSplits({
          company_lead_split: data.company_lead_split,
          self_gen_split: data.self_gen_split,
          renewal_split: data.renewal_split,
        });
        setHasCloser(true);
        setRenewalsEnabled(!!data.renewals_enabled);
      } else {
        setSplits(DEFAULT_CLOSER_SPLITS);
        setHasCloser(false);
        setRenewalsEnabled(false);
      }
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [effectiveUserId]);

  return { splits, hasCloser, renewalsEnabled, unreadable, loading };
}

interface UseRenewalsAccessResult {
  /** Whether the signed-in user may see renewals (nav, route, calculator option). */
  canSeeRenewals: boolean;
  loading: boolean;
}

/**
 * Precedence for renewals visibility:
 *   super_admin  → always sees renewals
 *   has closer   → gated by their closers.renewals_enabled flag
 *   no closer    → keeps existing access (e.g. a plain admin)
 */
export function useRenewalsAccess(): UseRenewalsAccessResult {
  const { isSuperAdmin } = useUserProfile();
  const { hasCloser, renewalsEnabled, unreadable, loading } = useCloserSplits();
  // FAIL CLOSED on an unreadable `closers` row. `!hasCloser` is the "plain
  // admin keeps existing access" allowance, and a failed read used to borrow it
  // — silently granting renewals to a closer whose renewals_enabled is off.
  // A super_admin still passes, because that right doesn't come from this read.
  const canSeeRenewals = isSuperAdmin || (unreadable ? false : (!hasCloser || renewalsEnabled));
  return { canSeeRenewals, loading };
}

interface UseCloserLensResult {
  /**
   * True when the user should get the focused "closer lens" — the streamlined
   * work-queue-first experience (lands on the Revenue Playbook, sees only the
   * daily operating links). Mirrors the renewals "is a closer" resolution:
   * a closer/employee, OR an admin who has a `closers` row. super_admins and
   * plain admins (no closer row) keep the full admin console.
   */
  isCloserLens: boolean;
  loading: boolean;
}

export function useCloserLens(): UseCloserLensResult {
  const { isSuperAdmin, isCloser, profile } = useUserProfile();
  const { hasCloser, loading } = useCloserSplits();
  const isEmployee = profile?.role === "employee";
  const isCloserLens = !isSuperAdmin && (isCloser || isEmployee || hasCloser);
  return { isCloserLens, loading };
}
