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
import Logo from "../../components/ui/Logo";
import MerchantLoginLinkForm from "../../components/auth/MerchantLoginLinkForm";
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

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 bg-gradient-to-b from-gray-50 to-gray-100 dark:from-midnight-blue dark:to-gray-900">
      <SignInPageSEO />
      <Link
        className="absolute top-6 left-6 text-sm text-gray-500 hover:text-ocean-blue dark:text-gray-400 dark:hover:text-mint-green transition-colors"
        to="/"
      >
        ◄ Home
      </Link>

      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="flex justify-center mb-8">
          <div className="dark:hidden">
            <Logo variant="full" size="lg" theme="light" />
          </div>
          <div className="hidden dark:block">
            <Logo variant="full" size="lg" theme="dark" />
          </div>
        </div>

        {/* ── PRIMARY ─────────────────────────────────────────────────────────
            my.mfunding.net → the merchant. mfunding.net → the team. */}
        {merchantFirst ? (
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-xl p-8">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white text-center">
              Sign in to your funding portal
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center mt-2 mb-6">
              We'll email you a secure sign-in link — no password needed.
            </p>
            <MerchantLoginLinkForm compact />
          </div>
        ) : (
          <form
            className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-xl p-8 flex flex-col gap-3"
            onSubmit={handleSubmit}
          >
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white text-center">
              Team sign in
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center mt-1 mb-3">
              MFunding staff — sign in with your work email and password.
            </p>
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
            <button className="btn-primary w-full" type="submit">
              Login
            </button>
            <Link
              className="text-center text-ocean-blue hover:text-mint-green transition-colors text-xs"
              to="/auth/sign-up"
            >
              Need a team account? Sign up
            </Link>
            {status && (
              <p className="text-center text-gray-500 dark:text-gray-400 text-sm">{status}</p>
            )}
          </form>
        )}

        {/* Reassurance strip — merchant-facing copy, so only on the portal host. */}
        {merchantFirst && (
          <ul className="mt-6 space-y-3">
            {valueProps.map(({ Icon, text }) => (
              <li key={text} className="flex items-center gap-3">
                <span className="flex-shrink-0 flex h-8 w-8 items-center justify-center rounded-full bg-mint-green/15 text-teal dark:text-mint-green">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="text-sm text-gray-600 dark:text-gray-300">{text}</span>
              </li>
            ))}
          </ul>
        )}

        {/* ── SECONDARY: the other door, demoted + collapsible ──────────────── */}
        <div className="mt-8 text-center">
          <button
            type="button"
            onClick={() => setShowSecondary((v) => !v)}
            className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-ocean-blue dark:text-gray-400 dark:hover:text-mint-green transition-colors"
          >
            {merchantFirst ? "MFunding team member? Sign in here" : "Are you a merchant? Sign in here"}
            <ChevronDownIcon
              className={`h-4 w-4 transition-transform ${showSecondary ? "rotate-180" : ""}`}
            />
          </button>

          {showSecondary && (
            merchantFirst ? (
              <form
                className="mt-4 flex flex-col gap-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm p-6 text-left"
                onSubmit={handleSubmit}
              >
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                  Team sign in
                </h2>
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
                <button className="btn-primary w-full" type="submit">
                  Login
                </button>
                <Link
                  className="text-center text-ocean-blue hover:text-mint-green transition-colors text-xs"
                  to="/auth/sign-up"
                >
                  Need a team account? Sign up
                </Link>
                {status && (
                  <p className="text-center text-gray-500 dark:text-gray-400 text-sm">{status}</p>
                )}
              </form>
            ) : (
              <div className="mt-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm p-6 text-left">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                  Merchant sign in
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 mb-3">
                  We'll email you a secure sign-in link — no password needed.
                </p>
                <MerchantLoginLinkForm compact />
              </div>
            )
          )}
        </div>
      </div>
    </main>
  );
};

export default SignInPage;
