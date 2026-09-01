// useProviderBalances — one fetch of the `provider-balances` edge fn, shared by the
// Data Hygiene panel and System Health.
//
// HONESTY (readers-must-distinguish): a failed call sets `error` (UNREADABLE) and
// leaves `data` null — callers must render an explicit "couldn't read" state, never
// a fake $0. Per-provider `ok`/`gated`/`available` flags also distinguish "keyed but
// zero" from "not keyed" from "no API for this".

import { useCallback, useEffect, useState } from "react";
import supabase from "@/supabase";

export interface BatchdataBalance {
  balance: number | null;
  currency: string | null;
  ok: boolean;
  error?: string;
}
export interface ApolloBalance {
  available: boolean; // Apollo exposes no credit/usage endpoint → always false
  reason: string;
}
export interface PhoneValidationBalance {
  provider: string;
  balance: number | null;
  currency?: string | null;
  ok: boolean;
  gated?: boolean; // true = the Twilio key isn't in the vault yet
  error?: string;
}
export interface RpvBalance {
  provider: string;
  available: boolean;
  balance: number | null;
  currency?: string | null;
  ok: boolean;
  gated?: boolean;
  /** true = no stored starting balance yet — prompt to set one. */
  needs_setup?: boolean;
  /** true = the balance is our estimate (set balance − tracked spend). */
  estimated?: boolean;
  set_at?: string | null;
  tracked_spend?: number;
  reason?: string;
  error?: string;
}
export interface ProviderBalances {
  batchdata: BatchdataBalance;
  apollo: ApolloBalance;
  phone_validation: PhoneValidationBalance;
  realphonevalidation?: RpvBalance;
}

interface State {
  data: ProviderBalances | null;
  loading: boolean;
  error: string | null; // non-null = the whole read failed (UNREADABLE)
  reload: () => Promise<void>;
}

export function useProviderBalances(): State {
  const [data, setData] = useState<ProviderBalances | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: res, error: err } = await supabase.functions.invoke("provider-balances", { body: {} });
      if (err) throw new Error(err.message || "provider-balances call failed");
      const r = res as (ProviderBalances & { ok?: boolean }) | null;
      if (!r || r.ok === false || !r.batchdata || !r.phone_validation) {
        throw new Error("provider-balances returned no usable data");
      }
      setData(r);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, reload: load };
}
