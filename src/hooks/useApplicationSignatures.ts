// useApplicationSignatures — read "did this merchant sign their application?" for
// a list of merchants, in ONE query, with an honest unknown state.
//
// Surfaces fed by processor_application_queue() / processor_pipeline_rows() get
// the answer from the RPC and don't need this. Everything else — deal detail, the
// Revenue Playbook, the setter deal list — holds customer ids and nothing more,
// so this hook batches a single read of public.ghl_doc_completions (RLS: ops
// staff can select) and hands back a per-customer SignatureState.
//
// THE CONTRACT THAT MATTERS: a customer the hook was ASKED about and found no
// application completion for is a proven `unsigned`. A customer it was not asked
// about, or every customer when the read FAILED, is `unknown` — never `unsigned`.
// `signatureFor()` enforces that so no caller can accidentally read absence as a
// denial. See src/lib/applicationSignature.ts.

import { useCallback, useEffect, useMemo, useState } from "react";
import supabase from "@/supabase";
import {
  signatureUnknown,
  signaturesByCustomer,
  type DocCompletion,
  type SignatureState,
} from "@/lib/applicationSignature";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; byCustomer: Map<string, SignatureState> };

export interface ApplicationSignatures {
  /** The answer for one merchant. Absence and failure both return `unknown`. */
  signatureFor: (customerId: string | null | undefined) => SignatureState;
  loading: boolean;
  /** Set when the ledger read failed — surfaces may show a single banner rather
   *  than N amber chips. Every row is still individually `unknown`. */
  error: string | null;
  reload: () => void;
}

export default function useApplicationSignatures(
  customerIds: (string | null | undefined)[],
): ApplicationSignatures {
  const [state, setState] = useState<State>({ kind: "idle" });

  // Stable key so the effect fires on a real change of membership, not on every
  // parent render handing us a fresh array.
  const ids = useMemo(() => {
    const set = new Set<string>();
    for (const id of customerIds) if (id) set.add(id);
    return [...set].sort();
  }, [customerIds]);
  const idKey = ids.join(",");

  const load = useCallback(async () => {
    if (ids.length === 0) {
      setState({ kind: "ready", byCustomer: new Map() });
      return;
    }
    setState({ kind: "loading" });
    // TWO reads, both required. The completions ledger says who signed; the
    // customers' ghl_docs_checked_at says who we ever LOOKED AT — and without
    // the second, an absent completion is indistinguishable from never having
    // checked. See signaturesByCustomer for why that distinction is the point.
    const [comps, custs] = await Promise.all([
      supabase
        .from("ghl_doc_completions")
        .select("customer_id, doc_name, completed_seen_at")
        .in("customer_id", ids),
      supabase.from("customers").select("id, ghl_docs_checked_at").in("id", ids),
    ]);
    if (comps.error || custs.error) {
      // UNREADABLE ≠ unsigned. Everyone asked about becomes `unknown`.
      setState({ kind: "error", message: (comps.error ?? custs.error)!.message });
      return;
    }
    const checked = new Map<string, string | null>(
      ((custs.data ?? []) as { id: string; ghl_docs_checked_at: string | null }[])
        .filter((c) => !!c.ghl_docs_checked_at)
        .map((c) => [c.id, c.ghl_docs_checked_at]),
    );
    setState({
      kind: "ready",
      byCustomer: signaturesByCustomer(
        (comps.data ?? []) as DocCompletion[],
        ids,
        checked,
      ),
    });
    // idKey is the real dependency — see the memo above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const signatureFor = useCallback(
    (customerId: string | null | undefined): SignatureState => {
      if (!customerId) {
        return signatureUnknown("this deal has no merchant record attached");
      }
      if (state.kind === "error") return signatureUnknown(state.message);
      if (state.kind !== "ready") return signatureUnknown("still reading the signature ledger");
      // Absence is NOT a denial: a customer outside the batch was never asked about.
      return state.byCustomer.get(customerId) ?? signatureUnknown("this merchant was not in the batch that was read");
    },
    [state],
  );

  return {
    signatureFor,
    loading: state.kind === "loading" || state.kind === "idle",
    error: state.kind === "error" ? state.message : null,
    reload: () => void load(),
  };
}
