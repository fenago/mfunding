// supabase.functions.invoke() collapses EVERY non-2xx into the useless
// "Edge Function returned a non-2xx status code" — the server's real message
// (e.g. "No bank statements on file for this deal yet.") is hidden inside
// error.context, an un-read Response. Swallowing it has bitten us repeatedly.
//
// Call this on any invoke error path:  `if (error) await invokeThrow(error);`
// It throws an Error carrying the server's `{ error }` body when there is one,
// and falls back to the original message otherwise. Always throws.

// Statuses the Supabase edge RUNTIME produces when it kills the worker — the
// function itself never ran to completion, so there is no `{ error }` body and
// no try/catch inside the function can ever report these. Without naming them
// the UI shows "non-2xx status code", which reads as a generic app bug and sent
// us hunting for a missing API key when the real cause was a worker that got
// SIGKILLed mid-run. Distinguishing "your request was refused" from "the worker
// died" is the whole point.
const RUNTIME_KILL: Record<number, string> = {
  546: "The server ran out of memory or CPU while processing this request — it was cut off partway through, not refused. This usually means there was too much to process in one run (e.g. an unusually large batch of documents). Please retry; if it keeps happening, report it.",
  504: "The server took too long and the request timed out before it finished.",
  502: "The server function failed to start.",
};

export async function invokeThrow(error: unknown): Promise<never> {
  const ctx = (error as { context?: { json?: () => Promise<unknown>; status?: number } } | null)?.context;
  if (ctx && typeof ctx.json === "function") {
    const body = (await ctx.json().catch(() => null)) as
      | { error?: string; message?: string; code?: string }
      | null;
    if (body?.error) throw new Error(body.error);
    // A runtime kill still carries a body, but it's the RUNTIME's ({code,message}),
    // not ours — check the status before falling through to the generic message.
    const killed = ctx.status != null ? RUNTIME_KILL[ctx.status] : undefined;
    if (killed) {
      const detail = body?.message || body?.code;
      throw new Error(detail ? `${killed} (${detail})` : killed);
    }
  }
  const killed = ctx?.status != null ? RUNTIME_KILL[ctx.status] : undefined;
  if (killed) throw new Error(killed);
  throw new Error((error as { message?: string } | null)?.message ?? "Request failed.");
}
