import { useCallback, useEffect, useMemo, useState } from "react";
import { SUPABASE_URL } from "../config";

// SendAppPage — the setter's one-press "Send Application" confirm page.
//
// A setter reaches this from the link custom field on the VibeReach (GHL) contact
// card — Additional Info — or from any pasted link. It:
//   1. reads the contact id (c) + link token (k) from the URL,
//   2. PEEKS the merchant name via the send-app-link edge function (GET, no send),
//   3. shows one "Send Application" button — the send fires ONLY on that explicit
//      click (POST), so a link preview / prefetch / misclick can never send.
//
// The edge function (send-app-link) is a JSON API because Supabase's functions
// gateway forces text/plain and can't serve a rendered HTML page; this React route
// on mfunding.net is that page. The link token is the GET-safe SEND_APP_LINK_TOKEN,
// never the master send secret.
//
// URL styles supported:
//   • current: /send-app?c=<contactId>&k=<token>  — the form written onto the
//              contact's link custom field, which is what setters actually click.
//   • legacy:  /send-app?k=<token>&x=<suffix containing /contacts/detail/<id>>
//              Back-compat only. This dates from the retired HotProspector
//              integration, whose "Custom URL" force-appended
//              /v2/location/{loc}/contacts/detail/{id}?... to whatever base you
//              gave it, so the contact id landed in ?x= and had to be recovered
//              from there. That dialer is gone, but the recovery branch stays so
//              any old link still resolves instead of erroring.
//
// Compliance: MCA = purchase of future receivables, NOT a loan.

const ENDPOINT = `${SUPABASE_URL}/functions/v1/send-app-link`;

type Phase = "loading" | "confirm" | "sending" | "sent" | "error";

function parseParams(): { c: string; k: string } {
  const sp = new URLSearchParams(window.location.search);
  let c = sp.get("c") ?? "";
  const k = sp.get("k") ?? "";
  // Legacy (retired-dialer) links put the appended suffix in ?x=… (or occasionally
  // on the path); recover the id so those still work.
  if (!c) {
    const hay = `${sp.get("x") ?? ""} ${window.location.pathname}`;
    c = hay.match(/\/contacts\/detail\/([^/?#\s]+)/)?.[1] ?? "";
  }
  return { c, k };
}

export default function SendAppPage() {
  const { c, k } = useMemo(parseParams, []);
  const [phase, setPhase] = useState<Phase>("loading");
  const [business, setBusiness] = useState<string>("this merchant");
  const [email, setEmail] = useState<string | null>(null);
  const [message, setMessage] = useState<string>("");
  const [missing, setMissing] = useState<string[]>([]);

  // PEEK — load the merchant name (GET never sends).
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!c || !k) {
        if (alive) { setPhase("error"); setMessage("This link is missing its contact or token. Ask an admin for a fresh Send Application link."); }
        return;
      }
      try {
        const res = await fetch(`${ENDPOINT}?c=${encodeURIComponent(c)}&k=${encodeURIComponent(k)}`);
        const data = await res.json();
        if (!alive) return;
        if (res.ok && data.ok) {
          setBusiness(data.business || "this merchant");
          setEmail(data.email ?? null);
          setPhase("confirm");
        } else {
          setPhase("error");
          setMessage(data.error || "This link is invalid or expired.");
        }
      } catch {
        if (alive) { setPhase("error"); setMessage("Couldn't reach the server. Check your connection and try again."); }
      }
    })();
    return () => { alive = false; };
  }, [c, k]);

  // SEND — the explicit action.
  const send = useCallback(async () => {
    setPhase("sending");
    setMissing([]);
    try {
      // form-encoded → a "simple" request, so no CORS preflight.
      const body = new URLSearchParams({ c, k });
      const res = await fetch(ENDPOINT, { method: "POST", body });
      const data = await res.json();
      if (res.ok && data.ok) {
        setBusiness(data.business || business);
        setEmail(data.sent_to ?? email);
        setMessage(
          data.verification === "confirmed"
            ? `Confirmed — GHL created "${data.template || "04B MCA PREFILL"}".`
            : "Sending is in progress; it should arrive shortly.",
        );
        setPhase("sent");
      } else {
        setMissing(Array.isArray(data.missing_fields) ? data.missing_fields : []);
        setMessage(data.error || "Something went wrong and nothing was sent.");
        setPhase("error");
      }
    } catch {
      setMessage("Couldn't reach the server. Nothing was sent — try again.");
      setPhase("error");
    }
  }, [c, k, business, email]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0b1f3a] p-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-2xl">
        <div className="mb-5 text-xs font-bold uppercase tracking-[0.14em] text-[#0f8a4f]">
          MFunding · Momentum Funding
        </div>

        {phase === "loading" && (
          <p className="py-6 text-[#516079]">Loading merchant…</p>
        )}

        {(phase === "confirm" || phase === "sending") && (
          <>
            <h1 className="text-lg font-semibold text-[#0b1f3a]">Send the pre-filled application to</h1>
            <div className="my-2 break-words text-2xl font-extrabold text-[#0b1f3a]">{business}</div>
            {email && <div className="break-all text-sm text-[#516079]">✉️ {email}</div>}
            <p className="mt-2 text-sm leading-relaxed text-[#516079]">
              This e-mails the merchant their MCA application to review and e-sign.
            </p>
            <button
              onClick={send}
              disabled={phase === "sending"}
              className="mt-6 w-full rounded-xl bg-[#0f8a4f] px-5 py-4 text-[17px] font-extrabold text-white transition hover:brightness-105 disabled:opacity-60"
            >
              {phase === "sending" ? "Sending…" : "▶ Send Application"}
            </button>
            <div className="mt-5 text-xs text-[#8894a8]">One press. No typing. Safe to run outside a call.</div>
          </>
        )}

        {phase === "sent" && (
          <>
            <div className="mb-2 text-5xl leading-none text-[#0f8a4f]">✅</div>
            <h1 className="text-lg font-semibold text-[#0b1f3a]">Application sent to {business}</h1>
            {email && <div className="mt-1 break-all text-sm text-[#516079]">✉️ {email}</div>}
            <p className="mt-2 text-sm leading-relaxed text-[#516079]">{message}</p>
            <p className="mt-2 text-sm text-[#516079]">You can close this tab.</p>
          </>
        )}

        {phase === "error" && (
          <>
            <div className="mb-2 text-5xl leading-none text-[#b3261e]">⚠️</div>
            <h1 className="text-lg font-semibold text-[#0b1f3a]">Application NOT sent</h1>
            <div className="mt-3 rounded-lg border border-[#f3c6c1] bg-[#fbeae8] p-4 text-left text-sm leading-relaxed text-[#7a1f18]">
              {message}
              {missing.length > 0 && (
                <ul className="mt-2 list-disc pl-5">
                  {missing.map((m) => <li key={m}>{m}</li>)}
                </ul>
              )}
            </div>
            {c && k && (
              <button
                onClick={send}
                className="mt-4 text-sm font-bold text-[#0f8a4f] hover:underline"
              >
                Try again
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
