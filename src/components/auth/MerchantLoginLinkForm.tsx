import { useState } from "react";
import supabase from "../../supabase";

/**
 * Self-serve merchant sign-in: a logged-out business owner enters their email and
 * we send a passwordless sign-in link (via the merchant-login-link edge function,
 * which routes through GHL email). The response is deliberately non-committal —
 * it never reveals whether an account exists — so success copy always reads "if
 * that email is on file…". Used on the sign-in page and the expired-link screen.
 */
export default function MerchantLoginLinkForm({ compact = false }: { compact?: boolean }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (state === "sending") return;
    setState("sending");
    const { error } = await supabase.functions.invoke("merchant-login-link", {
      body: { email: email.trim() },
    });
    setState(error ? "error" : "sent");
  };

  if (state === "sent") {
    return (
      <div className="rounded-lg bg-mint-green/10 border border-mint-green/30 p-4 text-center">
        <p className="text-sm text-gray-700 dark:text-gray-200">
          If that email is on file, a sign-in link is on its way. Check your inbox.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      {!compact && (
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Business owner? We'll email you a secure sign-in link — no password needed.
        </p>
      )}
      <input
        className="input-field"
        type="email"
        name="merchant-email"
        autoComplete="email"
        required
        placeholder="you@yourbusiness.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <button className="btn-primary w-full" type="submit" disabled={state === "sending"}>
        {state === "sending" ? "Sending…" : "Email me a sign-in link"}
      </button>
      {state === "error" && (
        <p className="text-center text-sm text-red-600 dark:text-red-400">
          Something went wrong sending your link — please try again in a minute.
        </p>
      )}
    </form>
  );
}
