import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import supabase from "../../supabase";
import Logo from "../../components/ui/Logo";
import SEO from "../../components/seo/SEO";

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
    <main className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col items-center justify-center p-6">
      <SEO title="Signing you in" noIndex={true} />
      <div className="w-full max-w-sm text-center">
        <div className="flex justify-center mb-8">
          <Logo variant="full" size="md" theme="light" />
        </div>

        {phase === "signing-in" ? (
          <>
            <div className="mx-auto mb-6 h-12 w-12 rounded-full border-b-2 border-mint-green animate-spin" />
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Signing you in…</h1>
            <p className="text-gray-500 dark:text-gray-400 mt-2">
              One moment while we open your funding dashboard.
            </p>
          </>
        ) : (
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-6">
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">This link has expired</h1>
            <p className="text-gray-500 dark:text-gray-400 mt-2">
              For your security, sign-in links only work for a short time. Ask your funding
              advisor to send you a fresh link and you'll be right in.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
