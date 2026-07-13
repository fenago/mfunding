import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircleIcon, ExclamationTriangleIcon, PaperAirplaneIcon } from "@heroicons/react/24/outline";
import supabase from "../../supabase";
import PortalInviteButton from "./PortalInviteButton";

/**
 * Merchant portal access, AT A GLANCE, inside the playbook's deal context bar.
 *
 * A merchant can only sign in at my.mfunding.net once `customers.user_id` is set,
 * and the only control that sets it is the portal invite. A closer who lives in
 * the playbook used to create portal-less merchants every single time, because
 * that control lived on the deal/customer detail pages. So the state — and the
 * fix — now live right here:
 *
 *   user_id                          → ✅ Portal: active   (they can sign in)
 *   portal_invited_at, no user_id    → ✉ Portal: invite sent
 *   neither                          → ⚠ No portal access  (amber, click to fix)
 *
 * Self-contained (reads its own state from `customers`, same as
 * PortalInviteButton) so the host just drops in <PortalAccessChip customerId />.
 * Clicking the chip opens a small popover that reuses PortalInviteButton to send
 * (or resend) the invite — the closer never leaves the playbook.
 */
export default function PortalAccessChip({ customerId }: { customerId: string }) {
  const [state, setState] = useState<{ userId: string | null; invitedAt: string | null } | null>(null);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("customers")
      .select("user_id, portal_invited_at")
      .eq("id", customerId)
      .maybeSingle();
    setState({
      userId: (data?.user_id as string | null) ?? null,
      invitedAt: (data?.portal_invited_at as string | null) ?? null,
    });
  }, [customerId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Close on outside click; refresh the chip on the way out so a just-sent invite
  // flips the state without a page reload.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        void load();
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, load]);

  if (!state) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400">
        Portal…
      </span>
    );
  }

  const active = !!state.userId;
  const invited = !active && !!state.invitedAt;

  const chipClass = active
    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
    : invited
      ? "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300 border border-sky-200 dark:border-sky-800"
      : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-300 dark:border-amber-800 hover:bg-amber-200 dark:hover:bg-amber-900/60";

  const label = active ? "Portal: active" : invited ? "Portal: invite sent" : "No portal access";

  const title = active
    ? "This merchant can sign in at my.mfunding.net — upload docs, e-sign, and see where the deal stands."
    : invited
      ? "Invite sent — they haven't signed in yet. Resend it from here if they can't find it."
      : "This merchant CANNOT sign in to the portal. Send the invite — one click, right here.";

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={title}
        className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full transition-colors ${chipClass}`}
      >
        {active ? (
          <CheckCircleIcon className="w-3 h-3" />
        ) : invited ? (
          <PaperAirplaneIcon className="w-3 h-3" />
        ) : (
          <ExclamationTriangleIcon className="w-3 h-3" />
        )}
        {label}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1.5 w-80 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl p-3">
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2">
            {active
              ? "They can sign in at my.mfunding.net to upload documents, e-sign, and track the deal."
              : "Until the invite goes out, this merchant has no way to sign in and see their own deal."}
          </p>
          <PortalInviteButton customerId={customerId} />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              void load();
            }}
            className="mt-2 w-full text-[11px] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}
