import { useCallback, useEffect, useRef, useState } from "react";
import supabase from "../supabase";
import { playSignedChime } from "../lib/chime";
import type { CornerAlert } from "../lib/cornerAlert";

// useSignedApplicationAlert — the corner card that fires when a merchant SIGNS
// THEIR APPLICATION.
//
// ── WHY IT EXISTS ───────────────────────────────────────────────────────────
// 2026-09-18, the morning after a merchant signed and nobody noticed for hours:
// "can we send a notification as a pop-up and a badge somewhere when the
// application is actually signed?" A signature is the moment a lead becomes
// work — statements get chased, a funder package gets built — and until now
// nothing on any screen announced it.
//
// ── ⚠️ THE ALERT IS NOT INSTANT, AND IT MUST NOT PRETEND TO BE ──────────────
// GHL does not push document completions to us. They are DISCOVERED by
// `ghl-doc-sweep`, a cron job that runs at :12 past the hour (plus
// `ghl-docs-status`, which runs only when a human opens a contact's documents).
// So the card can appear up to ~60 minutes after the merchant actually signed.
//
// That is why the card shows `signedAt` — GHL's recipient.signedDate, the
// merchant's REAL signing time — and never "just now". A setter who reads "just
// now" will call believing the pen is still in the merchant's hand; the honest
// card says "signed 47m ago · found 2m ago" and lets them decide. Making this
// genuinely instant needs a GHL document-completion webhook into an edge
// function (the `ghl-event-hook` shape); until that exists, the lag is real and
// the UI states it.
//
// ── WHAT COUNTS AS SIGNED ───────────────────────────────────────────────────
// ONLY the application. `MCA — Broker Compensation Disclosure` is a different,
// one-page document: on 2026-09-16 a merchant signed it TWICE and believed he
// was done while his application sat untouched. An alert that fired on the
// disclosure would repeat that exact lie to the floor.
//
// This hook does NOT decide which document is the application. It hands the
// document id to `public.application_signature_alert()`, which applies
// `public.is_application_doc_name()` — the ONE definition, in SQL. A TypeScript
// mirror of that rule has already drifted four times, once missing
// '04C MCA PARTIAL', which is the default send path. There is no fifth copy here.
//
// ── NO BURST OF ANCIENT SIGNATURES ──────────────────────────────────────────
// The gate is `signed_at` recency, NOT row-insert time. A sweep that first
// covers a backlog inserts rows today for signatures from July; firing on those
// would bury today's real one. A row with no `signed_at` at all is likewise not
// announced — we cannot tell a fresh one from a historical one, and a wrong
// "someone just signed" is worse than a missed chime that the badge still shows.
//
// ── ONE ALERT PER SIGNATURE, ACROSS RELOADS ─────────────────────────────────
// Fired document ids are remembered in localStorage, so a refresh does not
// re-fire yesterday's card (and an F5 does not resurrect one you dismissed).
// Surviving a refresh cleanly matters more than being clever about it. An id is
// recorded ONLY when a card was actually raised — see the note at the mark site;
// recording a zero-row answer is how the heal below gets swallowed.
//
// ── A SIGNATURE CAN ARRIVE WITHOUT A MERCHANT, AND GET ONE LATER ────────────
// A completion whose signer we cannot map to a customer is recorded with a null
// customer_id (it used to be dropped, which meant a signature no human could
// ever see) and ADOPTED by a later run that can resolve it. That adoption is an
// UPDATE, not an INSERT, so this hook listens to both — otherwise the merchant
// whose record was created after they signed would never raise a card, which is
// this feature's own failure mode wearing a different hat.

/** How recent the SIGNATURE must be for a card. The sweep is hourly; this
 *  tolerates a couple of missed runs while never reaching back to history. */
const SIGNED_FRESH_MS = 6 * 60 * 60 * 1000;

/** Fired ids are kept this long, then pruned — long enough that no sweep can
 *  re-announce something, short enough that the entry never grows unbounded. */
const SEEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const SEEN_KEY = "mf.signedAppAlerts.v1";

/** Columns we read off a ghl_doc_completions INSERT payload. */
interface DocCompletionRow {
  document_id: string | null;
  customer_id: string | null;
  doc_name: string | null;
  signed_at: string | null;
  completed_seen_at: string | null;
}

/** One row of public.application_signature_alert(text). */
interface AlertRow {
  document_id: string;
  doc_name: string;
  signed_at: string | null;
  seen_at: string | null;
  customer_id: string;
  business_name: string | null;
  contact_name: string | null;
  deal_id: string | null;
  deal_number: string | null;
  deal_status: string | null;
  statements_count: number | null;
  is_mine: boolean | null;
}

/** Fired-id bookkeeping. A blocked or full localStorage must never break the
 *  alert — worst case we lose the dedupe for this tab, not the signal. */
function loadSeen(): Record<string, number> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number>;
    const cutoff = Date.now() - SEEN_TTL_MS;
    const kept: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "number" && v > cutoff) kept[k] = v;
    }
    return kept;
  } catch {
    return {};
  }
}

function saveSeen(seen: Record<string, number>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    /* storage unavailable — dedupe degrades to this tab's memory */
  }
}

/** Fired when a signature card is raised, so the sidebar badge can recount
 *  without either surface having to know about the other. */
export const SIGNED_APP_EVENT = "mf:application-signed";

export function useSignedApplicationAlert(opts?: {
  /** Mirror of the lead stream's desktop-notification permission state. */
  desktopEnabled?: boolean;
}): {
  alerts: CornerAlert[];
  dismiss: (key: string) => void;
} {
  const [alerts, setAlerts] = useState<CornerAlert[]>([]);
  const seenRef = useRef<Record<string, number>>({});
  const desktopRef = useRef(!!opts?.desktopEnabled);

  useEffect(() => {
    desktopRef.current = !!opts?.desktopEnabled;
  }, [opts?.desktopEnabled]);

  const dismiss = useCallback((key: string) => {
    setAlerts((prev) => prev.filter((a) => a.key !== key));
  }, []);

  useEffect(() => {
    seenRef.current = loadSeen();

    function markSeen(documentId: string) {
      seenRef.current[documentId] = Date.now();
      saveSeen(seenRef.current);
    }

    async function fireSignature(row: DocCompletionRow) {
      const docId = row.document_id;
      if (!docId) return;
      if (seenRef.current[docId]) return;

      // NOT ATTRIBUTED YET. Since 2026-09-18 the write path RECORDS a signature
      // whose signer it cannot map to a customer (customer_id null) instead of
      // dropping it, and HEALS it later when the merchant becomes known. There
      // is no merchant to name on a card yet, so we stay quiet — and because the
      // heal is an UPDATE we are subscribed to, this row comes back to us the
      // moment it has one.
      if (!row.customer_id) return;

      // FRESHNESS, before any round trip. A backfill of historical completions is
      // the common case for this table; it must cost nothing and announce
      // nothing. No signed_at ⇒ we cannot date it ⇒ we stay quiet. A heal is
      // re-checked here on purpose: adopting a July signature today is
      // bookkeeping, not news.
      const signedMs = row.signed_at ? Date.parse(row.signed_at) : NaN;
      if (!Number.isFinite(signedMs) || Date.now() - signedMs > SIGNED_FRESH_MS) return;

      // Ask the DATABASE whether this is an application signature, and whose.
      // Zero rows means one of: not the application (a disclosure, say), or not
      // mine to see. Both are silence — an alert is an interruption, and this
      // one is not addressed to me.
      const { data, error } = await supabase.rpc("application_signature_alert", {
        p_document_id: docId,
      });
      if (error) {
        // Unreadable. Do NOT mark it seen: the next event for this document (or
        // the next sweep) gets another chance, and the sidebar badge — which
        // reads its own count — is the durable surface either way.
        console.warn("[signed-app-alert] resolve failed:", error.message);
        return;
      }
      const rows = (data as AlertRow[] | null) ?? [];
      const r = rows[0];
      // ⚠️ MARK SEEN ONLY WHEN A CARD ACTUALLY FIRES — never on a zero-row
      // answer. Zero rows is not a verdict for all time: an unattributed
      // signature becomes attributable when it is healed, and a deal assigned to
      // me later becomes visible to me. Marking here (the first version did)
      // burned the document id on the orphan's INSERT and then silently swallowed
      // its heal, which is precisely the case the heal was built for. The cost of
      // not marking is one cheap RPC per redelivered event on a row that will
      // never qualify, against ~41 signatures in the account's lifetime.
      if (!r) return;
      markSeen(docId);

      const business =
        r.business_name || r.contact_name || "This merchant";
      const alert: CornerAlert = {
        key: `sig:${r.document_id}`,
        dealId: r.deal_id ?? "",
        dealNumber: r.deal_number,
        business,
        ask: null,
        kind: "app_signed",
        leadSource: null,
        signed: {
          documentId: r.document_id,
          docName: r.doc_name,
          signedAt: r.signed_at,
          seenAt: r.seen_at,
          statementsCount: r.statements_count ?? 0,
          isMine: r.is_mine === true,
        },
        at: Date.now(),
      };
      setAlerts((prev) => [alert, ...prev.filter((a) => a.key !== alert.key)].slice(0, 3));
      playSignedChime();
      window.dispatchEvent(new CustomEvent(SIGNED_APP_EVENT));

      if (desktopRef.current && typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification("✅ Application signed", {
          body: `${business} signed ${r.doc_name}`,
          tag: `sig:${r.document_id}`,
        });
      }
    }

    // INSERT *and* UPDATE, for one reason: A HEAL IS AN UPDATE.
    //
    // The common path is still the INSERT — a completion is written once, keyed
    // on document_id, and never re-inserted. But a signature by a signer we
    // could not map lands with customer_id null and is ADOPTED later by an
    // UPDATE; on an INSERT-only subscription that merchant's card would never
    // appear, which is the whole failure this feature exists to stop, arriving
    // by a different door.
    //
    // The extra UPDATE traffic is harmless and self-limiting: a document already
    // carded is in `seen`, an unattributed one is skipped on customer_id, and a
    // signed_at backfill on a historical row dies at the freshness gate. Every
    // path costs at most one small RPC, and this table sees ~41 rows in its
    // lifetime — not a stream.
    const channel = supabase
      .channel("signed-application-alerts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "ghl_doc_completions" },
        (payload) => {
          void fireSignature(payload.new as DocCompletionRow);
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "ghl_doc_completions" },
        (payload) => {
          void fireSignature(payload.new as DocCompletionRow);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  return { alerts, dismiss };
}

export default useSignedApplicationAlert;
