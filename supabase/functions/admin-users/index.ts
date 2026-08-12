// admin-users — privileged user administration, restricted to super_admins.
//
// Every action is gated: the caller's JWT is verified and their profile role
// must be 'super_admin'. Uses the service-role key (never exposed to the client)
// to perform Supabase Auth admin operations.
//
// Actions (POST { action, ... }):
//   list                                  → all users merged with auth status
//   invite      { email, firstName?, lastName?, role?, redirectBase? }
//                                         → create a staff account, email the
//                                           set-password invite, return a link
//   setRole     { userId, role }          → change profiles.role
//   updateFields{ userId, fields }        → names / company
//   setPaused   { userId, paused }        → ban (pause) or unban a user
//   setPassword { userId, password }      → set a new password
//   logout      { userId }                → revoke all of a user's sessions
//   delete      { userId }                → permanently delete the user

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function serviceClient() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const VALID_ROLES = ["user", "closer", "employee", "admin", "super_admin"];
const PAUSE_DURATION = "876000h"; // ~100 years = effectively indefinite

// Where an invited staffer lands to pick a password. The client passes its own
// origin (mfunding.net vs my.mfunding.net), but we only honour hosts on the auth
// allow-list so this can never be turned into an open redirect.
const DEFAULT_SET_PASSWORD_URL = "https://mfunding.net/auth/set-password";
const ALLOWED_INVITE_HOSTS = ["mfunding.net", "www.mfunding.net", "my.mfunding.net", "localhost", "127.0.0.1"];

function safeRedirect(raw: unknown): string {
  const candidate = String(raw ?? "").trim();
  if (!candidate) return DEFAULT_SET_PASSWORD_URL;
  try {
    const u = new URL(candidate);
    if (!ALLOWED_INVITE_HOSTS.includes(u.hostname)) return DEFAULT_SET_PASSWORD_URL;
    return u.origin + "/auth/set-password";
  } catch {
    return DEFAULT_SET_PASSWORD_URL;
  }
}

/** Find an existing auth user by email (paged; the staff/user base is small). */
async function findAuthUserByEmail(
  // deno-lint-ignore no-explicit-any
  db: any,
  email: string,
): Promise<{ id: string; email?: string | null } | null> {
  const target = email.trim().toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const users = data?.users ?? [];
    // deno-lint-ignore no-explicit-any
    const hit = users.find((u: any) => (u.email ?? "").toLowerCase() === target);
    if (hit) return hit;
    if (users.length < 200) break;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const db = serviceClient();

  // --- Authn/Authz: caller must be a signed-in super_admin ---
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Missing authorization" }, 401);

  const { data: userData, error: userErr } = await db.auth.getUser(token);
  const caller = userData?.user;
  if (userErr || !caller) return json({ error: "Invalid session" }, 401);

  const { data: callerProfile } = await db.from("profiles").select("role").eq("id", caller.id).single();
  if (callerProfile?.role !== "super_admin") {
    return json({ error: "Forbidden — super admin only" }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }

  const action = String(body.action ?? "");
  const userId = body.userId ? String(body.userId) : "";

  // Guard destructive self-actions.
  const selfDestructive = ["setPaused", "logout", "delete"].includes(action) && userId === caller.id;
  if (selfDestructive) return json({ error: "You can't perform that action on your own account" }, 400);

  try {
    switch (action) {
      case "list": {
        // Merge auth users (status) with profiles (role + details).
        const authUsers: Record<string, { banned_until?: string | null; last_sign_in_at?: string | null; email_confirmed_at?: string | null }> = {};
        let page = 1;
        for (;;) {
          const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
          if (error) throw error;
          for (const u of data.users) {
            authUsers[u.id] = {
              // deno-lint-ignore no-explicit-any
              banned_until: (u as any).banned_until ?? null,
              last_sign_in_at: u.last_sign_in_at ?? null,
              email_confirmed_at: u.email_confirmed_at ?? null,
            };
          }
          if (data.users.length < 200) break;
          page++;
        }

        const { data: profiles, error: pErr } = await db
          .from("profiles")
          .select("id, email, first_name, last_name, display_name, role, company_name, company_phone, created_at")
          .order("created_at", { ascending: true });
        if (pErr) throw pErr;

        const now = Date.now();
        const users = (profiles ?? []).map((p) => {
          const a = authUsers[p.id];
          const bannedUntil = a?.banned_until ? new Date(a.banned_until).getTime() : 0;
          return {
            ...p,
            paused: bannedUntil > now,
            last_sign_in_at: a?.last_sign_in_at ?? null,
            email_confirmed: !!a?.email_confirmed_at,
          };
        });
        return json({ users });
      }

      case "invite": {
        const email = String(body.email ?? "").trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Enter a valid email address" }, 400);

        const requested = String(body.role ?? "");
        const role = VALID_ROLES.includes(requested) ? requested : "closer";
        const firstName = String(body.firstName ?? "").trim();
        const lastName = String(body.lastName ?? "").trim();
        const displayName = [firstName, lastName].filter(Boolean).join(" ") || email.split("@")[0];
        const redirectTo = safeRedirect(body.redirectBase);
        const meta = { first_name: firstName || null, last_name: lastName || null, display_name: displayName };

        // Already has an account? Never silently re-invite — roles change from the list.
        const existing = await findAuthUserByEmail(db, email);
        if (existing) {
          return json({ error: "That email already has an account — change their role from the list instead." }, 409);
        }

        // inviteUserByEmail creates the auth user AND sends the invite email. It fails
        // when the project has no custom SMTP (or the built-in sender is rate-limited),
        // and that must NOT cost us the account: fall back to creating the user outright
        // and hand back a link the admin can deliver themselves.
        let emailSent = false;
        let emailError: string | null = null;
        let newUserId: string | null = null;

        const invited = await db.auth.admin.inviteUserByEmail(email, { redirectTo, data: meta });
        if (invited.error) emailError = invited.error.message;
        else {
          emailSent = true;
          newUserId = invited.data?.user?.id ?? null;
        }

        if (!newUserId) {
          const created = await db.auth.admin.createUser({ email, email_confirm: false, user_metadata: meta });
          newUserId = created.data?.user?.id ??
            // The invite may have created the user before failing to send.
            (await findAuthUserByEmail(db, email))?.id ?? null;
          if (!newUserId) {
            return json({ error: `Could not create the account: ${created.error?.message ?? emailError ?? "unknown error"}` }, 500);
          }
        }

        // The set-password link. type:"invite" is rejected once the user exists, so
        // recovery is the one that always works; /auth/set-password accepts either.
        let inviteLink: string | null = null;
        let linkError: string | null = null;
        for (const type of ["recovery", "magiclink"] as const) {
          const link = await db.auth.admin.generateLink({ type, email, options: { redirectTo } });
          if (link.data?.properties?.action_link) {
            inviteLink = link.data.properties.action_link;
            linkError = null;
            break;
          }
          linkError = link.error?.message ?? "no action_link";
        }

        // Role + names. The on_auth_user_created trigger already inserted a profiles row
        // at the default role 'user', so this is effectively an UPDATE — upsert keeps it
        // correct either way. Loud: failing here means the account has no access.
        const { error: pErr } = await db.from("profiles").upsert(
          {
            id: newUserId,
            email,
            role,
            first_name: firstName || null,
            last_name: lastName || null,
            display_name: displayName,
          },
          { onConflict: "id" },
        );
        if (pErr) return json({ error: `Account created but the role could not be set: ${pErr.message}` }, 500);

        const warning = [
          emailError ? `Invite email not sent (${emailError}) — send the link below instead.` : null,
          linkError ? `Set-password link unavailable (${linkError}) — use Reset password on the row instead.` : null,
        ].filter(Boolean).join(" ");

        return json({
          ok: true,
          userId: newUserId,
          email,
          role,
          invite_link: inviteLink,
          email_sent: emailSent,
          warning: warning || null,
        });
      }

      case "setRole": {
        const role = String(body.role ?? "");
        if (!VALID_ROLES.includes(role)) return json({ error: "invalid role" }, 400);
        if (userId === caller.id && role !== "super_admin") {
          return json({ error: "You can't demote your own account" }, 400);
        }
        const { error } = await db.from("profiles").update({ role }).eq("id", userId);
        if (error) throw error;
        return json({ ok: true });
      }

      case "updateFields": {
        const fields = (body.fields ?? {}) as Record<string, unknown>;
        const allowed = ["first_name", "last_name", "display_name", "company_name", "company_phone"];
        const patch: Record<string, unknown> = {};
        for (const k of allowed) if (k in fields) patch[k] = fields[k] === "" ? null : fields[k];
        if (Object.keys(patch).length === 0) return json({ error: "no fields" }, 400);
        const { error } = await db.from("profiles").update(patch).eq("id", userId);
        if (error) throw error;
        return json({ ok: true });
      }

      case "setPaused": {
        const paused = !!body.paused;
        const { error } = await db.auth.admin.updateUserById(userId, {
          ban_duration: paused ? PAUSE_DURATION : "none",
        });
        if (error) throw error;
        return json({ ok: true, paused });
      }

      case "setPassword": {
        const password = String(body.password ?? "");
        if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);
        const { error } = await db.auth.admin.updateUserById(userId, { password });
        if (error) throw error;
        return json({ ok: true });
      }

      case "logout": {
        // Revoke all refresh tokens / sessions for the user via the GoTrue admin endpoint.
        const url = Deno.env.get("SUPABASE_URL")!;
        const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const res = await fetch(`${url}/auth/v1/admin/users/${userId}/logout`, {
          method: "POST",
          headers: { apikey: key, Authorization: `Bearer ${key}` },
        });
        if (!res.ok && res.status !== 204) {
          return json({ error: `logout failed (${res.status})` }, 500);
        }
        return json({ ok: true });
      }

      case "delete": {
        const { error } = await db.auth.admin.deleteUser(userId);
        if (error) throw error;
        await db.from("profiles").delete().eq("id", userId); // in case no FK cascade
        return json({ ok: true });
      }

      default:
        return json({ error: `unknown action: ${action}` }, 400);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "operation failed" }, 500);
  }
});
