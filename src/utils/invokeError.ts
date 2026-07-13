// supabase.functions.invoke() collapses EVERY non-2xx into the useless
// "Edge Function returned a non-2xx status code" — the server's real message
// (e.g. "No bank statements on file for this deal yet.") is hidden inside
// error.context, an un-read Response. Swallowing it has bitten us repeatedly.
//
// Call this on any invoke error path:  `if (error) await invokeThrow(error);`
// It throws an Error carrying the server's `{ error }` body when there is one,
// and falls back to the original message otherwise. Always throws.
export async function invokeThrow(error: unknown): Promise<never> {
  const ctx = (error as { context?: { json?: () => Promise<unknown> } } | null)?.context;
  if (ctx && typeof ctx.json === "function") {
    const body = (await ctx.json().catch(() => null)) as { error?: string } | null;
    if (body?.error) throw new Error(body.error);
  }
  throw new Error((error as { message?: string } | null)?.message ?? "Request failed.");
}
