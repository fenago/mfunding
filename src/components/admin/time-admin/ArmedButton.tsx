import { useEffect, useRef, useState } from "react";

/**
 * Two-step confirm button. The owner has a hard no-browser-popups rule, so a
 * destructive/irreversible action confirms in place: the first click "arms" the
 * button (it swaps to `confirmLabel`), the second click fires it.
 *
 * An armed button disarms itself after DISARM_MS so a stray click on Monday
 * can't be completed by an unrelated click on Tuesday.
 */
const DISARM_MS = 6000;

export default function ArmedButton({
  label,
  confirmLabel,
  onFire,
  disabled = false,
  title,
  className = "",
  armedClassName = "",
}: {
  label: string;
  /** What the button reads once armed — say the money out loud, e.g. "Confirm $412.50?" */
  confirmLabel: string;
  onFire: () => void | Promise<void>;
  disabled?: boolean;
  title?: string;
  /** Resting appearance. */
  className?: string;
  /** Armed appearance — should read as "this click commits". */
  armedClassName?: string;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  // Guards a setState after the row unmounts mid-flight (week change, refresh).
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), DISARM_MS);
    return () => clearTimeout(t);
  }, [armed]);

  async function handleClick() {
    if (disabled || busy) return;
    if (!armed) {
      setArmed(true);
      return;
    }
    setBusy(true);
    try {
      await onFire();
    } finally {
      if (alive.current) {
        setBusy(false);
        setArmed(false);
      }
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      onBlur={() => setArmed(false)}
      disabled={disabled || busy}
      title={title}
      className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        armed ? armedClassName : className
      }`}
    >
      {busy ? "Saving…" : armed ? confirmLabel : label}
    </button>
  );
}
