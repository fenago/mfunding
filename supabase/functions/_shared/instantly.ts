// Instantly.ai email VERIFICATION (API v2) — "is this mailbox real?" asked BEFORE
// we ever try to use it.
//
// WHY (deal MF-2026-0029): a lead vendor supplied klbreen3@yahoo.com. Syntactically
// perfect, so every regex passed. It was a DEAD MAILBOX: GHL's first automated email
// hard-bounced (550, "mailbox not found"), GHL flagged the address, and every later
// send 400'd. A closer discovered this only after completing the entire application.
// Instantly answers the same question in ~20 seconds for 0.25 credits, at intake.
//
// The key lives ONLY in the Supabase vault (INSTANTLY_API_KEY), read server-side via
// the public.get_instantly_key() SECURITY DEFINER RPC — same as the instantly fn.
//
// ASYNCHRONOUS BY DESIGN: the POST usually answers "pending"; the verdict lands on a
// subsequent GET a few seconds later. Verified live:
//   klbreen3@yahoo.com       (dead)              → invalid   (~20s)
//   sabin.ricoh101@yahoo.com (dead)              → invalid
//   vnnautorepair@yahoo.com  (GHL delivered it)  → verified, catch_all false
//   wendy5rudolph@gmail.com  (delivered)         → verified, catch_all false
// Note catch_all can come back TRUE alongside "invalid" (Yahoo, and our own send-only
// domain), so catch-all is only meaningful when the verdict is otherwise good.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const INSTANTLY_API_BASE = "https://api.instantly.ai/api/v2";

/** The only statuses this app stores on customers.email_status. */
export type EmailHealth =
  | "verified"   // a real, reachable mailbox (or one GHL has actually delivered to)
  | "catch_all"  // the domain accepts everything — we genuinely CANNOT tell
  | "risky"      // Instantly is not confident
  | "invalid"    // the mailbox does not exist → never send, get a new address
  | "bounced"    // PROVEN dead: a real send to it hard-bounced (outranks all of the above)
  | "unknown";   // we asked and got no verdict — never blocks anything

export interface VerifyResult {
  health: EmailHealth;
  /** Instantly's raw verification_status, for the audit trail. */
  raw: string | null;
  catchAll: boolean;
  /** Set when the lookup itself failed (network/API) — health is then "unknown". */
  error?: string;
  /** Instantly returned HTTP 403/429 — we are RATE-LIMITED, not told the mailbox is bad.
   * health stays "unknown"; a batch driver should stop and retry the whole address later.
   * A rate-limit must NEVER be recorded as a verdict (see the sweep). */
  rateLimited?: boolean;
}

/** Load the Instantly API key from the vault. */
export async function getInstantlyKey(db: SupabaseClient): Promise<string> {
  const { data, error } = await db.rpc("get_instantly_key");
  if (error) throw new Error(`get_instantly_key failed: ${error.message}`);
  if (!data || typeof data !== "string") throw new Error("INSTANTLY_API_KEY missing from vault");
  return data;
}

async function call(apiKey: string, method: "POST" | "GET", path: string, body?: unknown) {
  const res = await fetch(`${INSTANTLY_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch { /* non-JSON */ }
  if (!res.ok) {
    console.error("[instantly] verification call failed", JSON.stringify({
      endpoint: `${method} ${path}`, status: res.status, response: text.slice(0, 500),
    }));
  }
  return { ok: res.ok, status: res.status, data: parsed };
}

/** Map Instantly's verdict onto the health we store.
 *
 * catch_all is only honoured when the verdict is otherwise GOOD. Instantly returns
 * catch_all:true alongside "invalid" as well (observed on Yahoo and on our own
 * send-only domain), and an invalid verdict is the one that matters — treating that
 * as "can't tell" would hide exactly the failure we built this for. */
function mapHealth(raw: string, catchAll: boolean): EmailHealth {
  const s = raw.toLowerCase();
  if (s === "invalid") return "invalid";
  if (s === "verified" || s === "valid") return catchAll ? "catch_all" : "verified";
  if (s === "catch_all" || s === "accept_all") return "catch_all";
  if (s === "risky") return "risky";
  return "unknown"; // pending / unknown / anything new Instantly invents
}

/**
 * Verify one address. POSTs, then polls the GET until the verdict resolves or we
 * run out of patience.
 *
 * NEVER throws and NEVER blocks a lead: any failure resolves to "unknown", which no
 * guard treats as bad. A lead is worth vastly more than a verification.
 */
export async function verifyEmail(
  apiKey: string,
  email: string,
  opts?: { attempts?: number; delayMs?: number },
): Promise<VerifyResult> {
  const attempts = opts?.attempts ?? 8;   // ~40s worst case; live runs resolved in ~20s
  const delayMs = opts?.delayMs ?? 5000;
  const enc = encodeURIComponent(email);

  // A 403/429 from Instantly means we are RATE-LIMITED — it is NOT a verdict on the
  // mailbox. Bail immediately (don't burn the poll loop) and flag it so the caller can
  // retry the whole address later. It must never look like "invalid".
  const isRateLimit = (status: number) => status === 403 || status === 429;

  try {
    const post = await call(apiKey, "POST", "/email-verification", { email });
    if (isRateLimit(post.status)) {
      return { health: "unknown", raw: null, catchAll: false, rateLimited: true, error: `rate-limited (HTTP ${post.status})` };
    }
    let raw = String(post.data.verification_status ?? "");
    let catchAll = post.data.catch_all === true;

    for (let i = 0; i < attempts && (raw === "" || raw === "pending"); i++) {
      await new Promise((r) => setTimeout(r, delayMs));
      const get = await call(apiKey, "GET", `/email-verification/${enc}`);
      if (isRateLimit(get.status)) {
        return { health: "unknown", raw: raw || null, catchAll, rateLimited: true, error: `rate-limited (HTTP ${get.status})` };
      }
      raw = String(get.data.verification_status ?? raw);
      catchAll = get.data.catch_all === true;
    }

    if (raw === "" || raw === "pending") {
      // Still undecided. "unknown" is the honest answer — it must not look like a pass.
      return { health: "unknown", raw: raw || null, catchAll, error: "verification did not resolve in time" };
    }
    return { health: mapHealth(raw, catchAll), raw, catchAll };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[instantly] verifyEmail failed (treating as unknown):", msg);
    return { health: "unknown", raw: null, catchAll: false, error: msg };
  }
}

/** Statuses a merchant-facing SEND must refuse. A prediction ("invalid") and a proof
 * ("bounced") both mean: this address will not receive the document. Everything else
 * — including catch_all/risky/unknown — is allowed through, because a false block on
 * a live merchant costs a deal. */
export const UNSENDABLE: ReadonlySet<string> = new Set<EmailHealth>(["invalid", "bounced"]);

/** Persist a verification verdict — WITHOUT ever overwriting a proven bounce.
 * A bounce is evidence; a verification is a guess. Evidence wins. */
export async function recordVerification(
  db: SupabaseClient,
  customerId: string,
  email: string,
  result: VerifyResult,
): Promise<void> {
  const { data: current } = await db
    .from("customers").select("email_status").eq("id", customerId).maybeSingle();
  if (current?.email_status === "bounced") return; // proof outranks prediction

  const { error } = await db.from("customers").update({
    email_status: result.health,
    email_verified_at: new Date().toISOString(),
    email_checked_at: new Date().toISOString(),
    email_bounce_reason: result.health === "invalid"
      ? `Instantly: the mailbox does not exist (${result.raw ?? "invalid"})`
      : null,
  }).eq("id", customerId).eq("email", email); // don't stamp a verdict onto a NEWER address
  if (error) console.error("[instantly] recordVerification update failed:", error.message);
}
