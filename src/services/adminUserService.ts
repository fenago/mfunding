import supabase from "../supabase";
import type { UserRole } from "../context/UserProfileContext";

export interface AdminUser {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  role: UserRole;
  company_name: string | null;
  company_phone: string | null;
  created_at: string;
  paused: boolean;
  last_sign_in_at: string | null;
  email_confirmed: boolean;
}

// All privileged user-admin operations go through the `admin-users` edge function,
// which verifies the caller is a super_admin and uses the service-role key.
async function callAdmin<T = unknown>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("admin-users", {
    body: { action, ...payload },
  });
  if (error) {
    let msg = error.message;
    try {
      // FunctionsHttpError carries the response; surface our JSON { error } message.
      const ctx = (error as unknown as { context?: Response }).context;
      const body = ctx && typeof ctx.json === "function" ? await ctx.json() : null;
      if (body?.error) msg = body.error;
    } catch {
      /* keep default message */
    }
    throw new Error(msg);
  }
  return data as T;
}

export async function adminListUsers(): Promise<AdminUser[]> {
  const data = await callAdmin<{ users: AdminUser[] }>("list");
  return data.users ?? [];
}

export const adminSetRole = (userId: string, role: UserRole) => callAdmin("setRole", { userId, role });

export const adminUpdateFields = (
  userId: string,
  fields: Partial<Pick<AdminUser, "first_name" | "last_name" | "display_name" | "company_name" | "company_phone">>
) => callAdmin("updateFields", { userId, fields });

export const adminSetPaused = (userId: string, paused: boolean) => callAdmin("setPaused", { userId, paused });

export const adminSetPassword = (userId: string, password: string) => callAdmin("setPassword", { userId, password });

export const adminLogoutUser = (userId: string) => callAdmin("logout", { userId });

export const adminDeleteUser = (userId: string) => callAdmin("delete", { userId });

export const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: "user", label: "User" },
  { value: "closer", label: "Closer" },
  { value: "employee", label: "Employee" },
  { value: "admin", label: "Admin" },
  { value: "super_admin", label: "Super Admin" },
];
