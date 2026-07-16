import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import supabase from "../../supabase";
import SEO from "../../components/seo/SEO";
import MerchantLoginLinkForm from "../../components/auth/MerchantLoginLinkForm";
import OSAuthShell from "../../components/landing/os/trust/OSAuthShell";

type Phase = "signing-in" | "expired";

/**
 * Magic-link landing route. A merchant taps the link we texted/emailed them;
 * Supabase drops the OTP tokens in the URL hash and the client (detectSessionInUrl)
 * exchanges them for a session. We wait for that session, then send them into the
 * portal (relative /portal, so we stay on whichever host the link opened on).
 * If the link is bad/expired we say so plainly.
 *
 * Canonical landing URL is https://my.mfunding.net/auth/merchant, but this route
 * MUST work on either host — the backend currently redirects to
 * https://mfunding.net/auth/merchant. Keep it host-agnostic.
 *
 * This is the very first thing a merchant ever sees — it must be flawless on a phone.
 *
 * Reskin to the Momentum OS design — the session-exchange logic is unchanged.
 */
export default function MerchantAuthPage() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>("signing-in");

  useEffect(() => {
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      navigate("/portal", { replace: true });
    };

    // If Supabase reported an auth error in the URL hash, the link is bad/expired.
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    if (hash.includes("error=") || hash.includes("error_code=")) {
      setPhase("expired");
      return;
    }

    // Already have a session (link already exchanged)? Go.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) finish();
    });

    // Otherwise wait for the client to process the hash tokens.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) finish();
    });

    // Safety net: if nothing resolves in a reasonable window, the link failed.
    const timer = setTimeout(() => {
      if (!done) setPhase("expired");
    }, 10_000);

    return () => {
      sub.subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, [navigate]);

  return (
    <OSAuthShell home={false} maxWidth={400}>
      <SEO title="Signing you in" noIndex={true} />
      {phase === "signing-in" ? (
        <div className="os-ma-loading">
          <span className="os-ma-spinner" aria-hidden />
          <h1 className="os-auth-title">Signing you in…</h1>
          <p className="os-auth-sub">One moment while we open your funding dashboard.</p>
        </div>
      ) : (
        <div className="os-authcard">
          <h1 className="os-auth-title">This link has expired</h1>
          <p className="os-auth-sub">
            For your security, sign-in links only work for a short time. Enter your email and
            we'll send you a fresh one.
          </p>
          <MerchantLoginLinkForm compact />
        </div>
      )}
      <style>{`
        .os-ma-loading{text-align:center}
        .os-ma-spinner{display:inline-block;width:46px;height:46px;border-radius:50%;
          border:3px solid var(--hair);border-top-color:var(--go);animation:os-ma-spin .8s linear infinite;margin-bottom:22px}
        @keyframes os-ma-spin{to{transform:rotate(360deg)}}
        @media (prefers-reduced-motion:reduce){.os-ma-spinner{animation-duration:2s}}
      `}</style>
    </OSAuthShell>
  );
}
