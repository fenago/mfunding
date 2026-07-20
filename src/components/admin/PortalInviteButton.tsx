import { useEffect, useState } from "react";
import { PaperAirplaneIcon, CheckCircleIcon, ExclamationCircleIcon } from "@heroicons/react/24/outline";
import supabase from "../../supabase";

interface PortalInviteButtonProps {
  customerId: string;
  className?: string;
  /**
   * Compact renders a single chip-style button (for the playbook deal context bar)
   * instead of the full label+button card. Same invite action and state either way.
   */
  compact?: boolean;
}

/**
 * Staff action: invite a merchant to the portal. Calls the `merchant-invite`
 * edge function (creates/links the auth user, stamps customers.user_id, sends
 * the magic link via GHL email + SMS) and reflects invite state from
 * customers.portal_invited_at. Self-contained — reads its own invite state — so
 * host pages only drop in <PortalInviteButton customerId={...} />.
 */
export default function PortalInviteButton({ customerId, className = "", compact = false }: PortalInviteButtonProps) {
  // undefined = still loading the current invite state.
  const [invitedAt, setInvitedAt] = useState<string | null | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("customers")
      .select("portal_invited_at")
      .eq("id", customerId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setInvitedAt((data?.portal_invited_at as string | null) ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  const sendInvite = async () => {
    setSending(true);
    setFeedback(null);
    try {
      const { error } = await supabase.functions.invoke("merchant-invite", {
        body: { customer_id: customerId },
      });
      if (error) throw error;
      setInvitedAt(new Date().toISOString());
      setFeedback({ ok: true, text: "Portal invite sent." });
    } catch (err) {
      setFeedback({
        ok: false,
        text: err instanceof Error ? err.message : "Couldn't send the invite. Try again.",
      });
    } finally {
      setSending(false);
    }
  };

  const sentLabel =
    invitedAt && !Number.isNaN(new Date(invitedAt).getTime())
      ? `Portal invite sent ${new Date(invitedAt).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        })}`
      : "Not invited";

  if (compact) {
    return (
      <span className={`relative inline-flex items-center ${className}`}>
        <button
          type="button"
          onClick={sendInvite}
          disabled={sending || invitedAt === undefined}
          title={
            invitedAt
              ? "Resend the merchant's portal invite — the sign-in link that lets them upload docs and e-sign"
              : "Send the merchant their portal invite — the sign-in link that lets them upload docs and e-sign"
          }
          className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-ocean-blue hover:bg-deep-sea text-white disabled:opacity-60 transition-colors"
        >
          {sending ? (
            <span className="w-3 h-3 rounded-full border-2 border-white/40 border-t-white animate-spin" />
          ) : (
            <PaperAirplaneIcon className="w-3 h-3" />
          )}
          {invitedAt ? "Resend portal invite" : "Send portal invite"}
        </button>
        {feedback && (
          <span
            className={`ml-1.5 inline-flex items-center gap-1 text-[11px] ${
              feedback.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
            }`}
          >
            {feedback.ok ? (
              <CheckCircleIcon className="w-3.5 h-3.5 flex-shrink-0" />
            ) : (
              <ExclamationCircleIcon className="w-3.5 h-3.5 flex-shrink-0" />
            )}
            {feedback.text}
          </span>
        )}
      </span>
    );
  }

  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Merchant portal</p>
          <p className="text-sm text-gray-900 dark:text-white truncate">
            {invitedAt === undefined ? "Checking…" : sentLabel}
          </p>
        </div>
        <button
          type="button"
          onClick={sendInvite}
          disabled={sending || invitedAt === undefined}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-ocean-blue hover:bg-deep-sea disabled:opacity-60 text-white text-sm font-medium transition-colors flex-shrink-0"
        >
          {sending ? (
            <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
          ) : (
            <PaperAirplaneIcon className="w-4 h-4" />
          )}
          {invitedAt ? "Resend invite" : "Send portal invite"}
        </button>
      </div>

      {feedback && (
        <p
          className={`mt-2 flex items-center gap-1.5 text-xs ${
            feedback.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
          }`}
        >
          {feedback.ok ? (
            <CheckCircleIcon className="w-4 h-4 flex-shrink-0" />
          ) : (
            <ExclamationCircleIcon className="w-4 h-4 flex-shrink-0" />
          )}
          {feedback.text}
        </p>
      )}
    </div>
  );
}
