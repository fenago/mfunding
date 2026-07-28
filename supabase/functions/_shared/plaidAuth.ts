// Shared caller-context resolver for the public Plaid link/exchange functions.
//
// These two functions run verify_jwt = false because they serve BOTH:
//   · the authenticated merchant portal (Authorization: Bearer <user JWT>), and
//   · a public, tokenized "connect your bank" link a closer texts (body.link_ref),
//     mirroring how the upload-form link works for a logged-out merchant.
// Auth is therefore enforced IN CODE. A caller is only ever bound to a customer we
// can prove they're entitled to: their own portal account, a staff session, or a
// valid non-expired link token that itself names exactly one customer.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface CallerContext {
  ok: boolean;
  status: number;          // HTTP status to return on failure
  error?: string;
  customerId?: string;
  dealId?: string | null;
  isStaff?: boolean;
  /** 'link' (public token), 'merchant' (own JWT), or 'staff' (ops JWT). */
  via?: "link" | "merchant" | "staff";
  /** Staff-only environment override for admin testing; ignored for merchant/link. */
  envOverride?: string | null;
}

interface Body {
  link_ref?: string;
  dealId?: string;
  customerId?: string;
  environment?: string;
}

export async function resolvePlaidCaller(
  db: SupabaseClient,
  req: Request,
  body: Body,
): Promise<CallerContext> {
  // ── Public tokenized link path ──
  if (body.link_ref) {
    const { data: tok } = await db
      .from("merchant_bank_link_tokens")
      .select("customer_id, deal_id, expires_at")
      .eq("token", body.link_ref)
      .maybeSingle();
    if (!tok) return { ok: false, status: 403, error: "This bank-connection link is not valid." };
    if (new Date(tok.expires_at as string).getTime() < Date.now()) {
      return { ok: false, status: 403, error: "This bank-connection link has expired. Please ask for a new one." };
    }
    return {
      ok: true, status: 200, via: "link",
      customerId: tok.customer_id as string,
      dealId: (tok.deal_id as string | null) ?? null,
    };
  }

  // ── Authenticated path (merchant JWT or staff JWT) ──
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return { ok: false, status: 401, error: "Missing authorization" };
  const { data: userData, error: userErr } = await db.auth.getUser(token);
  const caller = userData?.user;
  if (userErr || !caller) return { ok: false, status: 401, error: "Invalid session" };

  const { data: staff } = await db.rpc("is_ops_staff", { uid: caller.id });
  const isStaff = staff === true;

  if (isStaff) {
    // Staff acting on a deal/customer: they must tell us which one.
    let customerId = body.customerId ?? null;
    let dealId = body.dealId ?? null;
    if (!customerId && dealId) {
      const { data: deal } = await db.from("deals").select("customer_id").eq("id", dealId).maybeSingle();
      customerId = (deal?.customer_id as string | null) ?? null;
    }
    if (!customerId) return { ok: false, status: 400, error: "customerId or dealId is required" };
    return { ok: true, status: 200, via: "staff", isStaff: true, customerId, dealId, envOverride: body.environment ?? null };
  }

  // Merchant: bind to THEIR customer only. A supplied dealId must belong to them.
  const { data: cust } = await db
    .from("customers")
    .select("id")
    .eq("user_id", caller.id)
    .limit(1)
    .maybeSingle();
  if (!cust) return { ok: false, status: 403, error: "No merchant account is linked to this login." };
  const customerId = cust.id as string;

  let dealId = body.dealId ?? null;
  if (dealId) {
    const { data: deal } = await db.from("deals").select("id").eq("id", dealId).eq("customer_id", customerId).maybeSingle();
    if (!deal) dealId = null; // silently ignore a deal that isn't theirs
  }
  if (!dealId) {
    const { data: deal } = await db
      .from("deals").select("id").eq("customer_id", customerId)
      .order("updated_at", { ascending: false }).limit(1).maybeSingle();
    dealId = (deal?.id as string | null) ?? null;
  }
  return { ok: true, status: 200, via: "merchant", customerId, dealId };
}
