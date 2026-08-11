import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import supabase from "../../supabase";
import SEO from "../../components/seo/SEO";
import OSAuthShell from "../../components/landing/os/trust/OSAuthShell";

type Phase = "checking" | "ready" | "expired" | "done";

const MIN_LENGTH = 8;

/**
 * Set / reset password — the missing half of staff onboarding.
 *
 * A newly-invited staffer (appointment setter, closer, admin) gets a Supabase
 * recovery/invite email pointing here. The tokens land in the URL hash and the
 * client (detectSessionInUrl) exchanges them for a short-lived recovery session;
 * we wait for that session, then let them CHOOSE a password via updateUser().
 * Without this route the link signed them in once and left them with no password
 * they could ever type again.
 *
 * Three states, one screen:
 *   checking → waiting on the hash exchange (or an already-live session)
 *   ready    → the password form
 *   expired  → link dead/never had one: self-serve "email me a new link"
 *
 * On success we send them to /auth/sign-in, which already redirects a live
 * session by role (staff → /admin, merchant → /portal) — so the role routing
 * stays in exactly one place.
 *
 * Host-agnostic on purpose: this must work from mfunding.net and my.mfunding.net.
 * The redirectTo we ask for is always the CURRENT origin, so whichever host the
 * request came from is the host the email comes back to.
 */
export default function SetPasswordPage() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>("checking");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // The self-serve "send me a link" form (shown whenever there's no session).
  const [email, setEmail] = useState("");
  const [resend, setResend] = useState<"idle" | "sending" | "sent">("idle");

  // Did they arrive ON a link? Drives the copy ("expired" vs a plain reset request)
  // and whether we wait around for the token exchange at all.
  const [fromLink] = useState(() => {
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    return (
      hash.includes("access_token") ||
      hash.includes("type=recovery") ||
      hash.includes("error=") ||
      hash.includes("error_code=")
    );
  });

  useEffect(() => {
    let settled = false;

    const ready = () => {
      if (settled) return;
      settled = true;
      setPhase("ready");
    };

    // Supabase reports dead/expired links as an error in the URL hash.
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    if (hash.includes("error=") || hash.includes("error_code=")) {
      setPhase("expired");
      return;
    }

    // Already signed in (link already exchanged, or a signed-in user changing
    // their own password) → straight to the form. No link, no session → this is
    // the "forgot my password" door, so ask for the email immediately instead of
    // making them watch a spinner.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) ready();
      else if (!fromLink && !settled) {
        settled = true;
        setPhase("expired");
      }
    });

    if (!fromLink) return;

    // Arrived on a link: wait for the client to process the recovery tokens.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) ready();
    });

    // Safety net: nothing resolved → treat the link as dead rather than spin forever.
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        setPhase("expired");
      }
    }, 8_000);

    return () => {
      sub.subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, [fromLink]);

  const tooShort = password.length > 0 && password.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && password !== confirm;
  const canSubmit = password.length >= MIN_LENGTH && password === confirm && !saving;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setTouched(true);
    if (!canSubmit) return;
    setSaving(true);
    setError("");
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setPhase("done");
    // /auth/sign-in redirects a live session by role, so this lands them in the app.
    setTimeout(() => navigate("/auth/sign-in", { replace: true }), 1800);
  };

  const handleResend = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (resend === "sending") return;
    setResend("sending");
    // Deliberately non-committal: never reveal whether an account exists, so we
    // show the same confirmation whether or not this succeeded.
    await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/set-password`,
    });
    setResend("sent");
  };

  return (
    <OSAuthShell home={false} maxWidth={420}>
      <SEO title="Set your password" noIndex={true} />

      {phase === "checking" && (
        <div className="os-sp-loading">
          <span className="os-sp-spinner" aria-hidden />
          <h1 className="os-auth-title">One moment…</h1>
          <p className="os-auth-sub">Checking your link.</p>
        </div>
      )}

      {phase === "ready" && (
        <form className="os-authcard" onSubmit={handleSubmit} noValidate>
          <h1 className="os-auth-title">Set your password</h1>
          <p className="os-auth-sub">
            Choose a password you'll use to sign in from now on. At least {MIN_LENGTH} characters.
          </p>
          <div className="os-auth-fields">
            <div>
              <input
                className="input-field"
                type="password"
                name="new-password"
                autoComplete="new-password"
                placeholder="New password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={() => setTouched(true)}
              />
              {tooShort && (
                <p className="os-sp-hint">Use at least {MIN_LENGTH} characters.</p>
              )}
            </div>
            <div>
              <input
                className="input-field"
                type="password"
                name="confirm-password"
                autoComplete="new-password"
                placeholder="Confirm password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                onBlur={() => setTouched(true)}
              />
              {mismatch && <p className="os-sp-hint">Both passwords must match.</p>}
            </div>
            <button className="btn-primary w-full" type="submit" disabled={!canSubmit}>
              {saving ? "Saving…" : "Save password and continue"}
            </button>
            {touched && !password && <p className="os-sp-hint">Enter a new password.</p>}
            {error && <p className="os-sp-hint">{error}</p>}
          </div>
        </form>
      )}

      {phase === "expired" && (
        <div className="os-authcard">
          <h1 className="os-auth-title">
            {fromLink ? "This link has expired" : "Reset your password"}
          </h1>
          {resend === "sent" ? (
            <p className="os-auth-sub" style={{ margin: 0 }}>
              If that email is on file, a link is on its way. Check your inbox — and your
              spam folder.
            </p>
          ) : (
            <>
              <p className="os-auth-sub">
                {fromLink
                  ? "For your security, these links only work for a short time. Enter your work email and we'll send you a new one."
                  : "Enter your work email and we'll send you a link to set a new password."}
              </p>
              <form className="os-auth-fields" onSubmit={handleResend}>
                <input
                  className="input-field"
                  type="email"
                  name="email"
                  autoComplete="email"
                  required
                  placeholder="Work email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <button
                  className="btn-primary w-full"
                  type="submit"
                  disabled={resend === "sending"}
                >
                  {resend === "sending" ? "Sending…" : "Email me a new link"}
                </button>
              </form>
            </>
          )}
        </div>
      )}

      {phase === "done" && (
        <div className="os-authcard" style={{ textAlign: "center" }}>
          <h1 className="os-auth-title">Password set</h1>
          <p className="os-auth-sub">Signing you in…</p>
          <button
            className="btn-primary w-full"
            type="button"
            onClick={() => navigate("/auth/sign-in", { replace: true })}
          >
            Continue
          </button>
        </div>
      )}

      <style>{PAGE_CSS}</style>
    </OSAuthShell>
  );
}

const PAGE_CSS = `
.os-auth-fields{display:flex;flex-direction:column;gap:12px;margin-top:4px}
.os-sp-hint{font-size:12.5px;color:var(--muted);margin:6px 2px 0}
.os-sp-loading{text-align:center}
.os-sp-spinner{display:inline-block;width:46px;height:46px;border-radius:50%;
  border:3px solid var(--hair);border-top-color:var(--go);animation:os-sp-spin .8s linear infinite;margin-bottom:22px}
@keyframes os-sp-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.os-sp-spinner{animation-duration:2s}}
`;
