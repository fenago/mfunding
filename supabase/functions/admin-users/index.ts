// admin-users — privileged user administration, restricted to super_admins.
//
// Every action is gated: the caller's JWT is verified and their profile role
// must be 'super_admin'. Uses the service-role key (never exposed to the client)
// to perform Supabase Auth admin operations.
//
// Actions (POST { action, ... }):
//   list                                  → all users merged with auth status
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
