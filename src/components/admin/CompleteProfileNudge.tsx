import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { UserCircleIcon, XMarkIcon, ArrowRightIcon } from "@heroicons/react/24/outline";
import { useUserProfile } from "../../context/UserProfileContext";
import supabase from "../../supabase";

// "Complete your profile" nudge — shown to staff (especially new setters,
// role=closer) whose own profile isn't filled in yet, pointing them to
// /admin/my-profile so payroll has their contact, address, and payment details.
//
// IMPORTANT: this is keyed to the REAL signed-in user (realProfile), never an
// impersonated one — a super_admin viewing-as a setter must not be nagged about
// the setter's blanks, and must not see their own dismissal keyed to someone
// else. The payout check is a cheap own-row read (RLS lets the user read only
// their own payout_profiles row); any error just hides the nudge — it must never
// crash the page it's mounted on.

const dismissKey = (uid: string) => `mf.completeProfileNudge.dismissed.${uid}`;

const blank = (v: string | null | undefined) => !v || v.trim() === "";

export default function CompleteProfileNudge() {
  const { realProfile } = useUserProfile();
  const uid = realProfile?.id ?? null;

  // null = still checking, true = a payout method is on file, false = none/blank.
  const [hasPayoutMethod, setHasPayoutMethod] = useState<boolean | null>(null);
  // localStorage dismissal, read once per user id.
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!uid) return;
    try {
      setDismissed(localStorage.getItem(dismissKey(uid)) === "1");
    } catch {
      setDismissed(false);
    }
  }, [uid]);

  useEffect(() => {
    let alive = true;
    if (!uid) {
      setHasPayoutMethod(null);
      return;
    }
    (async () => {
      try {
        const { data, error } = await supabase
          .from("payout_profiles")
          .select("preferred_method")
          .eq("profile_id", uid)
          .maybeSingle();
        if (!alive) return;
        if (error) {
          // Resilient: an error means we simply can't confirm — don't nag on it.
          setHasPayoutMethod(true);
          return;
        }
        const method = (data as { preferred_method?: string | null } | null)?.preferred_method;
        setHasPayoutMethod(!blank(method));
      } catch {
        if (alive) setHasPayoutMethod(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [uid]);

  // What's missing, in plain language — drives both the "incomplete?" verdict and
  // the checklist hint. Payout is only judged once the async read has resolved.
  const missing = useMemo(() => {
    const out: string[] = [];
    if (!realProfile) return out;
    if (blank(realProfile.first_name) || blank(realProfile.last_name)) out.push("your name");
    if (blank(realProfile.phone_number)) out.push("phone number");
    if (blank(realProfile.address_line1) || blank(realProfile.city) || blank(realProfile.state))
      out.push("mailing address");
    if (blank(realProfile.country)) out.push("country");
    if (hasPayoutMethod === false) out.push("payment method");
    return out;
  }, [realProfile, hasPayoutMethod]);

  // Incomplete when the completion flag isn't set, any key field is blank, or no
  // payout method is chosen. profile_completed only covers name+phone, so the
  // address/country/payout gaps still count as incomplete on their own.
  const incomplete =
    !!realProfile && (!realProfile.profile_completed || missing.length > 0);

  const onDismiss = () => {
    setDismissed(true);
    if (uid) {
      try {
        localStorage.setItem(dismissKey(uid), "1");
      } catch {
        /* ignore */
      }
    }
  };

  // Don't render for signed-out users, once complete, while the payout read is
  // still pending (avoid a flash), or after dismissal.
  if (!realProfile || !incomplete || dismissed || hasPayoutMethod === null) return null;

  const missingLabel = missing.length
    ? missing.slice(0, 4).join(", ") + (missing.length > 4 ? "…" : "")
    : "a few details";

  return (
    <div className="mb-6 overflow-hidden rounded-2xl border border-amber-300/70 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-900/20 shadow-sm">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-100 dark:bg-amber-800/40">
          <UserCircleIcon className="h-7 w-7 text-amber-600 dark:text-amber-300" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold text-amber-900 dark:text-amber-100">
            Finish setting up your profile
          </p>
          <p className="mt-0.5 text-sm text-amber-800/90 dark:text-amber-200/90">
            We need your contact, address, and payment details to pay you.
          </p>
          <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-300">
            Missing: {missingLabel}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-stretch">
          <Link
            to="/admin/my-profile"
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-amber-700"
          >
            Complete my profile <ArrowRightIcon className="h-4 w-4" />
          </Link>
          <button
            type="button"
            onClick={onDismiss}
            className="inline-flex items-center justify-center gap-1 rounded-lg px-3 py-2 text-xs font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-100/70 dark:hover:bg-amber-800/30"
          >
            <XMarkIcon className="h-3.5 w-3.5" /> Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
