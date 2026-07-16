import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import {
  ChevronDownIcon,
  MapIcon,
  DevicePhoneMobileIcon,
  ShieldCheckIcon,
} from "@heroicons/react/24/outline";
import { useSession } from "../../context/SessionContext";
import { useUserProfile } from "../../context/UserProfileContext";
import supabase from "../../supabase";
import LoadingPage from "../LoadingPage";
import { SignInPageSEO } from "../../components/seo/SEO";
import MerchantLoginLinkForm from "../../components/auth/MerchantLoginLinkForm";
import OSAuthShell from "../../components/landing/os/trust/OSAuthShell";
import { IS_PORTAL_HOST } from "../../config";

/**
 * Sign-in, and WHICH form leads depends on WHICH HOST you came in on.
 *
 * There are two audiences on one bundle, and putting the wrong one first makes
 * the page useless to whoever actually showed up:
 *
 *   my.mfunding.net  → the MERCHANT portal. A business owner is on the phone with
 *                      a closer. Passwordless merchant sign-in leads.
 *   mfunding.net     → the company site / staff app. The team signs in here every
 *                      day with a password. TEAM sign-in leads.
 *
 * It previously showed the merchant form first on BOTH hosts, which buried the
 * team login behind a collapsed link on the domain the team actually uses.
 * The app already knows the host (IS_PORTAL_HOST in config.ts) — this just uses it.
 *
 * Either form is still reachable from either host (the non-primary one sits in a
 * collapsible below), so no one is ever locked out of the wrong door.
 *
 * COMPLIANCE: the reassurance strip uses "funding"/"capital", never "loan",
 * and makes no approval or outcome guarantees.
 *
 * This is a RESKIN to the Momentum OS design — all auth logic (host routing,
 * signInWithPassword, redirects, the anti-enumeration merchant form) is unchanged.
 */
const SignInPage = () => {
  const { session } = useSession();
  const { isStaff, isLoading: profileLoading } = useUserProfile();
  const [status, setStatus] = useState("");
  const [formValues, setFormValues] = useState({ email: "", password: "" });

  // The merchant form leads ONLY on the portal subdomain.
  const merchantFirst = IS_PORTAL_HOST;
  // The secondary form starts collapsed; on the staff host that's the merchant one.
  const [showSecondary, setShowSecondary] = useState(false);

  // Already signed in → route by role: staff to the admin app, merchants
  // (role `user`) to their portal. Wait for the profile so we don't send a
  // staffer to /portal (or vice versa) on a race.
  if (session) {
    if (profileLoading) return <LoadingPage />;
    return <Navigate to={isStaff ? "/admin" : "/portal"} replace />;
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormValues({ ...formValues, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setStatus("Logging in...");
    const { error } = await supabase.auth.signInWithPassword({
      email: formValues.email,
      password: formValues.password,
    });
    if (error) {
      alert(error.message);
    }
    setStatus("");
  };

  const valueProps = [
    { Icon: MapIcon, text: "See exactly where your funding stands" },
    { Icon: DevicePhoneMobileIcon, text: "Upload and sign documents from your phone" },
    { Icon: ShieldCheckIcon, text: "You never pay us — funding partners compensate us" },
  ];

  const teamForm = (compact = false) => (
    <form className={compact ? "os-auth-teamform" : "os-authcard"} onSubmit={handleSubmit}>
      <h2 className={compact ? "os-auth-secheading" : "os-auth-title"}>Team sign in</h2>
      {!compact && (
        <p className="os-auth-sub">MFunding staff — sign in with your work email and password.</p>
      )}
      <div className="os-auth-fields">
        <input
          className="input-field"
          name="email"
          onChange={handleInputChange}
          type="email"
          placeholder="Work email"
          autoComplete="email"
        />
        <input
          className="input-field"
          name="password"
          onChange={handleInputChange}
          type="password"
          placeholder="Password"
          autoComplete="current-password"
        />
        <button className="btn-primary w-full" type="submit">Login</button>
        <Link className="os-auth-smalllink" to="/auth/sign-up">
          Need a team account? Sign up
        </Link>
        {status && <p className="os-auth-status">{status}</p>}
      </div>
    </form>
  );

  return (
    <OSAuthShell>
      <SignInPageSEO />

      {/* ── PRIMARY: my.mfunding.net → the merchant. mfunding.net → the team. ── */}
      {merchantFirst ? (
        <div className="os-authcard">
          <h1 className="os-auth-title">Sign in to your funding portal</h1>
          <p className="os-auth-sub">We'll email you a secure sign-in link — no password needed.</p>
          <MerchantLoginLinkForm compact />
        </div>
      ) : (
        teamForm(false)
      )}

      {/* Reassurance strip — merchant-facing copy, so only on the portal host. */}
      {merchantFirst && (
        <ul className="os-auth-props">
          {valueProps.map(({ Icon, text }) => (
            <li key={text} className="os-auth-prop">
              <span className="os-auth-propicon"><Icon className="h-4 w-4" /></span>
              <span>{text}</span>
            </li>
          ))}
        </ul>
      )}

      {/* ── SECONDARY: the other door, demoted + collapsible ── */}
      <div className="os-auth-secondary">
        <button
          type="button"
          onClick={() => setShowSecondary((v) => !v)}
          className="os-auth-toggle"
        >
          {merchantFirst ? "MFunding team member? Sign in here" : "Are you a merchant? Sign in here"}
          <ChevronDownIcon className={`h-4 w-4 os-auth-chev ${showSecondary ? "os-auth-chev-open" : ""}`} />
        </button>

        {showSecondary && (
          merchantFirst ? (
            teamForm(true)
          ) : (
            <div className="os-auth-secpanel">
              <h2 className="os-auth-secheading">Merchant sign in</h2>
              <p className="os-auth-secsub">
                We'll email you a secure sign-in link — no password needed.
              </p>
              <MerchantLoginLinkForm compact />
            </div>
          )
        )}
      </div>

      <style>{PAGE_CSS}</style>
    </OSAuthShell>
  );
};

const PAGE_CSS = `
.os-auth-fields{display:flex;flex-direction:column;gap:12px;margin-top:4px}
.os-auth-smalllink{text-align:center;color:var(--go-text);text-decoration:none;font-size:12.5px}
.os-auth-smalllink:hover{text-decoration:underline}

.os-auth-props{list-style:none;margin:22px 0 0;padding:0;display:flex;flex-direction:column;gap:12px}
.os-auth-prop{display:flex;align-items:center;gap:12px;font-size:14px;color:var(--lede)}
.os-auth-propicon{flex:0 0 auto;display:grid;place-items:center;width:32px;height:32px;border-radius:50%;
  background:rgba(22,217,146,.12);color:var(--go-text)}

.os-auth-secondary{margin-top:26px;text-align:center}
.os-auth-toggle{display:inline-flex;align-items:center;gap:6px;background:none;border:none;cursor:pointer;
  font-size:13.5px;color:var(--muted);font-family:'Inter',sans-serif}
.os-auth-toggle:hover{color:var(--go-text)}
.os-auth-chev{transition:transform .18s}
.os-auth-chev-open{transform:rotate(180deg)}

.os-auth-teamform,.os-auth-secpanel{margin-top:16px;text-align:left;
  background:linear-gradient(180deg,var(--panel),var(--panel2));border:1px solid var(--hair);
  border-radius:14px;padding:22px}
.os-auth-secheading{font-family:'Space Mono',monospace;font-weight:700;font-size:14px;letter-spacing:.06em;color:var(--tx);margin:0 0 12px}
.os-auth-secsub{font-size:12.5px;color:var(--muted);margin:0 0 14px}
`;

export default SignInPage;
