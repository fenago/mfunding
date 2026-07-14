// scoreLeadInvoke.ts — fire-and-forget invocation of the score-lead edge function
// from OTHER edge functions (intake, underwriting, email-health).
//
// THE ONE RULE: scoring must NEVER block or fail the caller. A lead is worth
// vastly more than its score; the nightly sweep catches anything missed. So this
// helper swallows every error, never awaits in the caller's critical path, and
// uses EdgeRuntime.waitUntil to keep the worker alive just long enough for the
// request to leave.
//
// Auth: service-role bearer — score-lead recognizes it in-code (same precedent as
// underwrite-deal's auto mode). Not the staff path, so house rule #1's "service
// role fails the role check" does not apply here.

export function fireAndForgetScore(dealId: string, trigger: string): void {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key || !dealId) return;
    const p = fetch(`${url}/functions/v1/score-lead`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ dealId, trigger }),
    })
      .then((r) => { r.body?.cancel().catch(() => {}); })
      .catch(() => {});
    // deno-lint-ignore no-explicit-any
    (globalThis as any).EdgeRuntime?.waitUntil?.(p);
  } catch {
    /* scoring never interferes with the caller */
  }
}
