import { useState } from "react";
import { requestBlankApplication } from "../../services/portalService";
import { openGhlDoc, type ApplicationStatus } from "../../utils/signing";

/**
 * A modest fallback link shown only when the merchant's PENDING application is a
 * PRE-FILLED one (name contains "prefill") — in case the pre-filled details are
 * wrong, they can request a fresh blank fillable instead. Hidden when the
 * application is already signed, when there's none, or when the pending one is
 * already the blank fillable. Opens the fresh application in a new tab.
 */
export default function FreshApplicationLink({
  application,
  className = "",
}: {
  application: ApplicationStatus;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const showable = application.state === "pending" && /prefill/i.test(application.name ?? "");
  if (!showable) return null;

  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    const res = await requestBlankApplication();
    setBusy(false);
    if (res.ok && res.url) {
      openGhlDoc(res.url);
      setMsg("Opened a fresh application in a new tab.");
    } else {
      setMsg(res.message ?? "We couldn't do that right now — please try again.");
    }
  };

  return (
    <div className={className}>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="text-xs text-ocean-blue hover:underline disabled:opacity-50"
      >
        {busy
          ? "Preparing a fresh application…"
          : "Something look wrong on your application? Fill out a fresh one instead."}
      </button>
      {msg && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{msg}</p>}
    </div>
  );
}
