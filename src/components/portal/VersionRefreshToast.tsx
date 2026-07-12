import { useEffect, useState } from "react";
import { ArrowPathIcon, XMarkIcon } from "@heroicons/react/24/outline";

/**
 * Stale-bundle detector for the portal. A long-lived SPA tab keeps running the
 * JS it loaded, so after a deploy the merchant can be on old code. We poll
 * /version.json (the build writes it) every ~60s and on focus; when its buildId
 * differs from the one baked into this bundle, we show an unobtrusive toast with
 * a Refresh button. We NEVER auto-reload — the merchant taps Refresh, so a
 * reload can't interrupt a signature or an in-progress upload.
 */
export default function VersionRefreshToast() {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let alive = true;

    const check = async () => {
      if (!alive || document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/version.json?ts=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { buildId?: string };
        if (alive && data.buildId && data.buildId !== __BUILD_ID__) setStale(true);
      } catch {
        /* offline / transient — ignore, try again next tick */
      }
    };

    const interval = setInterval(check, 60_000);
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    void check();

    return () => {
      alive = false;
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  if (!stale) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[120] flex justify-center px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pointer-events-none">
      <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl px-4 py-3 max-w-md w-full">
        <ArrowPathIcon className="w-5 h-5 text-ocean-blue flex-shrink-0" />
        <p className="flex-1 min-w-0 text-sm text-gray-700 dark:text-gray-200">
          A new version of your portal is available.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-mint-green text-white text-sm font-semibold hover:bg-mint-green/90 transition-colors flex-shrink-0"
        >
          Refresh
        </button>
        <button
          type="button"
          onClick={() => setStale(false)}
          aria-label="Dismiss"
          className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex-shrink-0"
        >
          <XMarkIcon className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
