// useApplicationSignatures — "was this application sent, by whom, and did the
// merchant sign it?" for a list of deals, in ONE call, with an honest unknown.
//
// ONE CODE PATH. This reads public.deal_application_status(uuid[]), the same
// resolution the processor's chase queue uses, rather than querying
// ghl_doc_completions itself. That matters for three reasons the earlier
// client-side version got wrong or could only get right by duplicating:
//
//   · The doc-name rule lives in SQL (public.is_application_doc_name). A client
//     copy of it drifts — it already had, four times over, and one of those
//     copies missed '04C MCA PARTIAL', which is the default send path.
//   · "Not signed" requires proof that we LOOKED. ghl_doc_completions is a lazy
//     mirror plus an hourly sweep (ghl-doc-sweep); customers.ghl_docs_checked_at
//     is what makes an absent completion mean "not signed" instead of "nobody
//     looked". The RPC returns that as the third state, 'unchecked'.
//   · The RPC re-states the deals money wall, so a setter sees their own book
//     plus unassigned and a processor sees the board — without this hook having
//     to know anything about that.
//
// UNREADABLE IS NEVER "NO". A failed call makes every deal `unknown`; a deal the
// RPC didn't return is `unknown`; 'unchecked' is `unknown`. None of them render
// as UNSIGNED, which is in practice an accusation that the signature was never
// chased.

import { useCallback, useEffect, useMemo, useState } from "react";
import supabase from "@/supabase";
import { signatureUnknown, type SignatureState } from "@/lib/applicationSignature";
import type { AppSentAttribution } from "@/lib/applicationQueueRow";

/** One row of public.deal_application_status(uuid[]). */
export interface DealApplicationStatus {
  deal_id: string;
  app_sent_at: string | null;
  app_sent_by: string | null;
  app_sent_by_name: string | null;
  app_sent_attribution: AppSentAttribution | null;
  app_sent_attribution_basis: string | null;
  /** application_sent_at was stamped by the GHL mirror at deal creation, not by
   *  a send we made. No send date and no sender may be rendered off it. */
  born_at_application_sent: boolean;
  app_signed_at: string | null;
  app_signed_state: "signed" | "not_signed" | "unchecked";
  app_signed_checked_at: string | null;
  disclosure_signed_at: string | null;
  disclosure_state: "signed" | "not_signed" | "unchecked";
  /**
   * WAS A DOCUMENT ACTUALLY SENT — read back out of GHL, not inferred from this
   * row. It cannot be inferred: Joyce Derian (MF-2026-0363) carries an assigned
   * closer, so `app_sent_attribution` reads 'assumed_owner' for her exactly as it
   * does for a genuine send, while she has no document at all.
   *
   * Rank order, and only the last one licenses a "never sent" claim:
   *   has_evidence        a document was read back
   *   unknown_unreadable  no complete document crawl has ever run
   *   unknown_stale       the send POST-DATES the evidence — our blind spot
   *   never_sent          a complete, current, set-scoped read found nothing
   */
  send_evidence: "has_evidence" | "never_sent" | "unknown_stale" | "unknown_unreadable";
  send_evidence_docs: number;
  /** When the document index this verdict came from was last known complete. */
  send_evidence_checked_at: string | null;
  send_evidence_age_seconds: number | null;
}

/** What <ApplicationSignatureBadge> takes. Four verdicts collapse to three here,
 *  and BOTH unknowns collapse to "unknown" on purpose: the cost of an
 *  unnecessary "unknown" is a shrug, and the cost of a wrong "none" is every
 *  badge on the page accusing a merchant of ignoring an application we never
 *  sent them. */
export type BadgeSendEvidence = "confirmed" | "none" | "unknown";

export function badgeSendEvidence(
  row: DealApplicationStatus | null | undefined,
): BadgeSendEvidence {
  if (!row) return "unknown";
  if (row.send_evidence === "has_evidence") return "confirmed";
  if (row.send_evidence === "never_sent") return "none";
  return "unknown";
}

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; byDeal: Map<string, DealApplicationStatus> };

export interface ApplicationSignatures {
  /** The signature answer for one deal. Absence and failure both → `unknown`. */
  signatureFor: (dealId: string | null | undefined) => SignatureState;
  /** The full row, for surfaces that also want the sender or the send date. */
  statusFor: (dealId: string | null | undefined) => DealApplicationStatus | null;
  /**
   * The send date to hand <ApplicationSignatureBadge>. `null` for a deal that
   * was never sent AND for a phantom stamp — in both cases there is no send to
   * date, and an "UNSIGNED" badge would be about an application nobody sent.
   */
  sentAtFor: (dealId: string | null | undefined) => string | null;
  /** Was a document actually sent? See DealApplicationStatus.send_evidence. */
  sendEvidenceFor: (dealId: string | null | undefined) => BadgeSendEvidence;
  /**
   * EVERYTHING <ApplicationSignatureBadge> needs, as one object:
   *   <ApplicationSignatureBadge {...sigs.badgePropsFor(deal.id)} />
   *
   * Prefer this over passing `signature` and `sentAt` by hand. Passing a send
   * date WITHOUT the send evidence is what produced red "UNSIGNED" on a merchant
   * who was never sent anything — the stamp is present and the document is not —
   * and there is no way to make that mistake through this bundle.
   */
  badgePropsFor: (dealId: string | null | undefined) => {
    signature: SignatureState;
    sentAt: string | null;
    sendEvidence: BadgeSendEvidence;
  };
  loading: boolean;
  /** Set when the read failed — surfaces may show one banner instead of N chips. */
  error: string | null;
  reload: () => void;
}

/** Map one status row to the UI's three-state signature. */
export function signatureFromStatus(
  row: DealApplicationStatus | null | undefined,
): SignatureState {
  if (!row) {
    return signatureUnknown("this deal's application status could not be read");
  }
  if (row.app_signed_state === "signed" || row.app_signed_at) {
    return { kind: "signed", signedAt: row.app_signed_at, docName: null };
  }
  if (row.app_signed_state !== "not_signed") {
    return signatureUnknown(
      "this merchant's e-signed documents have not been read yet — the hourly signature sweep has not covered them",
    );
  }
  return {
    kind: "unsigned",
    // Only claim disclosure-only when the disclosure check itself succeeded.
    disclosureSignedAt: row.disclosure_state === "signed" ? row.disclosure_signed_at : null,
  };
}

export default function useApplicationSignatures(
  dealIds: (string | null | undefined)[],
): ApplicationSignatures {
  const [state, setState] = useState<State>({ kind: "idle" });

  // Stable key so the effect fires on a real change of membership, not on every
  // parent render handing us a fresh array.
  const ids = useMemo(() => {
    const set = new Set<string>();
    for (const id of dealIds) if (id) set.add(id);
    return [...set].sort();
  }, [dealIds]);
  const idKey = ids.join(",");

  const load = useCallback(async () => {
    if (ids.length === 0) {
      setState({ kind: "ready", byDeal: new Map() });
      return;
    }
    setState({ kind: "loading" });
    const { data, error } = await supabase.rpc("deal_application_status", {
      p_deal_ids: ids,
    });
    if (error) {
      // UNREADABLE ≠ unsigned. Everyone asked about becomes `unknown`.
      setState({ kind: "error", message: error.message });
      return;
    }
    const rows = (data ?? []) as unknown as DealApplicationStatus[];
    setState({ kind: "ready", byDeal: new Map(rows.map((r) => [r.deal_id, r])) });
    // idKey is the real dependency — see the memo above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const statusFor = useCallback(
    (dealId: string | null | undefined): DealApplicationStatus | null => {
      if (!dealId || state.kind !== "ready") return null;
      // Absence is NOT a denial: a deal outside the batch, or one the money wall
      // hid, was never answered for.
      return state.byDeal.get(dealId) ?? null;
    },
    [state],
  );

  const signatureFor = useCallback(
    (dealId: string | null | undefined): SignatureState => {
      if (!dealId) return signatureUnknown("this row has no deal attached");
      if (state.kind === "error") return signatureUnknown(state.message);
      if (state.kind !== "ready") return signatureUnknown("still reading the application status");
      return signatureFromStatus(state.byDeal.get(dealId));
    },
    [state],
  );

  const sentAtFor = useCallback(
    (dealId: string | null | undefined): string | null => {
      const row = statusFor(dealId);
      // A phantom stamp is not a send. Handing it to the badge would produce
      // "Sent 12 Sep · UNSIGNED" about an application that never left.
      if (!row || row.born_at_application_sent) return null;
      return row.app_sent_at;
    },
    [statusFor],
  );

  const sendEvidenceFor = useCallback(
    (dealId: string | null | undefined): BadgeSendEvidence => badgeSendEvidence(statusFor(dealId)),
    [statusFor],
  );

  const badgePropsFor = useCallback(
    (dealId: string | null | undefined) => ({
      signature: signatureFor(dealId),
      sentAt: sentAtFor(dealId),
      sendEvidence: sendEvidenceFor(dealId),
    }),
    [signatureFor, sentAtFor, sendEvidenceFor],
  );

  return {
    signatureFor,
    statusFor,
    sentAtFor,
    sendEvidenceFor,
    badgePropsFor,
    loading: state.kind === "loading" || state.kind === "idle",
    error: state.kind === "error" ? state.message : null,
    reload: () => void load(),
  };
}
