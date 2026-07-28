import { useCallback, useEffect, useRef, useState } from "react";
import {
  usePlaidLink,
  type PlaidLinkOnSuccessMetadata,
  type PlaidLinkError,
} from "react-plaid-link";
import supabase from "../supabase";
import { parseEdgeError } from "../lib/edgeError";

/**
 * usePlaidConnect — the one shared bank-connection flow, driven by the DEPLOYED
 * edge functions:
 *   1. plaid-create-link-token  → a short-lived Link token
 *   2. usePlaidLink (Plaid's own secure UI — WE never see bank credentials)
 *   3. plaid-exchange           → server swaps the public_token for an item
 *      (no access token EVER returns to the client)
 *
 * Both surfaces reuse this: the authenticated portal card passes { dealId } (or
 * nothing → latest deal), the logged-out public page passes { link_ref }. The
 * `institution` a merchant just linked is reported to `onConnected` so callers
 * can refresh status without a round-trip guess.
 *
 * Errors are surfaced verbatim from the server (parseEdgeError) — including the
 * honest "this bank isn't supported yet, use your upload link instead" message
 * the backend returns for institutions we can't pull yet.
 */

export type PlaidConnectPhase =
  | "idle"
  | "starting" // fetching the link token
  | "opening" // token in hand, Plaid Link about to open
  | "exchanging" // public_token → server exchange in flight
  | "done"
  | "error";

interface Options {
  /** Extra body merged into plaid-create-link-token (e.g. { dealId } or { link_ref }). */
  createBody: Record<string, unknown>;
  /** Extra body merged into plaid-exchange (e.g. { dealId } or { link_ref }). */
  exchangeBody: Record<string, unknown>;
  /** Fired after a successful server exchange. `institution` is best-effort. */
  onConnected?: (institution?: string | null) => void;
}

export interface PlaidConnectController {
  /** Kick off the flow: fetch a token, then open Plaid Link. */
  start: () => void;
  phase: PlaidConnectPhase;
  /** Any in-flight step (button should show a spinner / be disabled). */
  busy: boolean;
  /** Server/exit error message, or null. */
  error: string | null;
  /** Clear an error and return to idle (for a "try again" affordance). */
  reset: () => void;
}

export function usePlaidConnect(opts: Options): PlaidConnectController {
  // Keep the latest callbacks/bodies without re-subscribing usePlaidLink.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const [phase, setPhase] = useState<PlaidConnectPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const wantOpen = useRef(false);

  const handleSuccess = useCallback(
    async (publicToken: string | null, metadata: PlaidLinkOnSuccessMetadata) => {
      if (!publicToken) {
        setError("We couldn't finish connecting your bank. Please try again.");
        setPhase("error");
        return;
      }
      setPhase("exchanging");
      try {
        const { data, error: exErr } = await supabase.functions.invoke("plaid-exchange", {
          body: { public_token: publicToken, ...optsRef.current.exchangeBody },
        });
        if (exErr) throw exErr;
        const d = data as { ok?: boolean; institution?: string | null; error?: string } | null;
        if (d?.error) throw new Error(d.error);
        setPhase("done");
        optsRef.current.onConnected?.(
          d?.institution ?? metadata?.institution?.name ?? null,
        );
      } catch (e) {
        const { message } = await parseEdgeError(
          e,
          "We couldn't finish connecting your bank. Please try again.",
        );
        setError(message);
        setPhase("error");
      }
    },
    [],
  );

  const handleExit = useCallback(
    (err: PlaidLinkError | null) => {
      // A clean cancel (no error) just returns to idle — never a scary message.
      if (err) {
        setError(err.display_message || err.error_message || null);
        setPhase("error");
      } else {
        setPhase((p) => (p === "exchanging" || p === "done" ? p : "idle"));
      }
    },
    [],
  );

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: (publicToken, metadata) => void handleSuccess(publicToken, metadata),
    onExit: handleExit,
  });

  // Open only once, and only once Plaid reports the token is ready.
  useEffect(() => {
    if (wantOpen.current && linkToken && ready) {
      wantOpen.current = false;
      open();
    }
  }, [linkToken, ready, open]);

  const start = useCallback(() => {
    setError(null);
    setPhase("starting");
    void (async () => {
      try {
        const { data, error: ctErr } = await supabase.functions.invoke(
          "plaid-create-link-token",
          { body: { ...optsRef.current.createBody } },
        );
        if (ctErr) throw ctErr;
        const d = data as { link_token?: string; error?: string } | null;
        if (d?.error) throw new Error(d.error);
        if (!d?.link_token) {
          throw new Error("We couldn't start the bank connection. Please try again.");
        }
        wantOpen.current = true;
        setLinkToken(d.link_token);
        setPhase("opening");
      } catch (e) {
        const { message } = await parseEdgeError(
          e,
          "We couldn't start the bank connection. Please try again.",
        );
        setError(message);
        setPhase("error");
      }
    })();
  }, []);

  const reset = useCallback(() => {
    setError(null);
    setPhase("idle");
  }, []);

  const busy = phase === "starting" || phase === "opening" || phase === "exchanging";

  return { start, phase, busy, error, reset };
}
