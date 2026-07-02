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
  /** True once we've confirmed the user has a matching `closers` row. */
  hasCloser: boolean;
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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!effectiveUserId) {
        if (!cancelled) {
          setSplits(DEFAULT_CLOSER_SPLITS);
          setHasCloser(false);
          setLoading(false);
        }
        return;
      }
      setLoading(true);
      const { data } = await supabase
        .from("closers")
        .select("company_lead_split, self_gen_split, renewal_split")
        .eq("user_id", effectiveUserId)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        setSplits({
          company_lead_split: data.company_lead_split,
          self_gen_split: data.self_gen_split,
          renewal_split: data.renewal_split,
        });
        setHasCloser(true);
      } else {
        setSplits(DEFAULT_CLOSER_SPLITS);
        setHasCloser(false);
      }
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [effectiveUserId]);

  return { splits, hasCloser, loading };
}
