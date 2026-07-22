/**
 * supabase-js buries an edge function's JSON error body under `error.context`
 * (a Response) and surfaces only the useless "Edge Function returned a non-2xx
 * status code". Dig out the REAL server message, the raw JSON body (machine
 * flags such as `email_undeliverable` live there), and the HTTP status — so a
 * caller can tell a transient 5xx apart from a 4xx guard the user must act on.
 */
export interface EdgeError {
  /** The server's own `error` string when present, else the given fallback. */
  message: string;
  /** HTTP status of the failed response, or null when it wasn't an HTTP error. */
  status: number | null;
  /** The parsed JSON error body, or null when there was none / it wasn't JSON. */
  body: Record<string, unknown> | null;
}

export async function parseEdgeError(e: unknown, fallback: string): Promise<EdgeError> {
  const ctx = (e as { context?: Response })?.context;
  if (ctx && typeof ctx.clone === "function") {
    const status = typeof ctx.status === "number" ? ctx.status : null;
    try {
      const body = (await ctx.clone().json()) as Record<string, unknown>;
      const message = typeof body?.error === "string" && body.error ? body.error : fallback;
      return { message, status, body };
    } catch {
      /* not JSON — fall through, but keep the status we already read */
    }
    return { message: fallback, status, body: null };
  }
  const message = e instanceof Error && e.message && !/non-2xx/i.test(e.message) ? e.message : fallback;
  return { message, status: null, body: null };
}
