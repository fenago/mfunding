import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  BuildingLibraryIcon,
  ShieldCheckIcon,
  ArrowPathIcon,
  LockClosedIcon,
} from "@heroicons/react/24/outline";
import { CheckBadgeIcon } from "@heroicons/react/24/solid";
import { usePlaidConnect } from "../hooks/usePlaidConnect";

/**
 * ConnectBankPage — the public, logged-OUT bank-connection page at
 * /connect-bank/:token. A closer texts the merchant this link; they connect
 * their bank in ~60 seconds through Plaid's own secure flow so we can verify
 * business revenue without chasing statements.
 *
 * Standalone: no portal/admin chrome, no auth. It drives the DEPLOYED functions
 * with the tokenized `link_ref` from the URL (plaid-create-link-token →
 * usePlaidLink → plaid-exchange). WE never see or store bank login credentials,
 * and this verifies revenue — it is never a loan.
 */
export default function ConnectBankPage() {
  const { token } = useParams<{ token: string }>();
  const [institution, setInstitution] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Connect your bank · Momentum Funding";
  }, []);

  const { start, phase, busy, error, reset } = usePlaidConnect({
    createBody: { link_ref: token },
    exchangeBody: { link_ref: token },
    onConnected: (inst) => setInstitution(inst ?? null),
  });

  const done = phase === "done";

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      {/* Brand bar */}
      <header className="px-5 py-4 border-b border-gray-200 dark:border-gray-800">
        <span className="text-lg font-bold tracking-tight text-gray-900 dark:text-white">
          Momentum <span className="text-mint-green">Funding</span>
        </span>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          {!token ? (
            /* Missing/garbled link */
            <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-8 text-center shadow-xl">
              <LockClosedIcon className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">
                This link looks incomplete
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                Please use the full, most recent link your funding specialist sent you — or reply to
                them and they'll send a fresh one.
              </p>
            </div>
          ) : done ? (
            /* Success */
            <div className="rounded-2xl border border-emerald-200 dark:border-emerald-800 bg-white dark:bg-gray-900 p-8 text-center shadow-xl">
              <CheckBadgeIcon className="w-14 h-14 text-emerald-500 mx-auto mb-4" />
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                Bank connected{institution ? ` — ${institution}` : ""}
              </h1>
              <p className="text-sm text-gray-600 dark:text-gray-300 mt-3">
                Thank you — your business revenue is verified. There's nothing else you need to send
                right now. Your funding specialist will take it from here.
              </p>
              <p className="mt-4 text-xs text-gray-400">You can close this page.</p>
            </div>
          ) : (
            /* The connect CTA */
            <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-8 shadow-xl">
              <div className="w-12 h-12 rounded-xl bg-ocean-blue/10 dark:bg-ocean-blue/20 flex items-center justify-center mb-5">
                <BuildingLibraryIcon className="w-7 h-7 text-ocean-blue" />
              </div>

              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                Connect your bank
              </h1>
              <p className="text-sm text-gray-600 dark:text-gray-300 mt-2">
                Take about <strong>60 seconds</strong> to connect your bank and verify your business
                revenue — the fastest way to move your funding forward, with no statements to dig up
                or upload.
              </p>

              <ul className="mt-5 space-y-2.5">
                <li className="flex items-start gap-2.5 text-sm text-gray-600 dark:text-gray-300">
                  <ShieldCheckIcon className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                  Bank-level security via Plaid — trusted by thousands of apps.
                </li>
                <li className="flex items-start gap-2.5 text-sm text-gray-600 dark:text-gray-300">
                  <LockClosedIcon className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                  We never see or store your bank login credentials.
                </li>
              </ul>

              {error && (
                <div className="mt-5 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2.5">
                  <p className="text-sm text-amber-800 dark:text-amber-200">{error}</p>
                </div>
              )}

              <button
                type="button"
                onClick={() => (error ? reset() : start())}
                disabled={busy}
                className="mt-6 w-full inline-flex items-center justify-center gap-2 px-5 py-3 text-base font-semibold text-white bg-ocean-blue rounded-xl hover:bg-ocean-blue/90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                {busy ? (
                  <>
                    <ArrowPathIcon className="w-5 h-5 animate-spin" />
                    Connecting…
                  </>
                ) : error ? (
                  "Try again"
                ) : (
                  "Connect your bank securely"
                )}
              </button>

              <p className="mt-4 text-center text-[11px] text-gray-400">
                Connecting your bank verifies your business revenue. This is not a loan application.
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
