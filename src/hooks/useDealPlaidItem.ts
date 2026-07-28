// useDealPlaidItem — the deal's Plaid bank connection for staff surfaces, from
// the one shared query (getDealPlaidItem). Every admin bank affordance that only
// needs to ANSWER "is the bank connected, and how much data?" reads through this
// hook so they never disagree: the Playbooks context-bar chip, the Docs-back
// line, and the checklist hint. DealBankPanel keeps its own richer load (it also
// does "Pull now"), but shares the same underlying query.
import { useEffect, useState } from "react";
import { getDealPlaidItem } from "../services/portalService";
import type { PlaidItem } from "../services/portalService";

export interface DealPlaidState {
  item: PlaidItem | null;
  loading: boolean;
  reload: () => void;
}

export function useDealPlaidItem(dealId: string, customerId: string | null): DealPlaidState {
  const [item, setItem] = useState<PlaidItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getDealPlaidItem(dealId, customerId)
      .then((it) => { if (!cancelled) setItem(it); })
      .catch(() => { if (!cancelled) setItem(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [dealId, customerId, nonce]);

  return { item, loading, reload: () => setNonce((n) => n + 1) };
}
