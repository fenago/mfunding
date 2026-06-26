if (!import.meta.env.VITE_SUPABASE_ANON_KEY) {
  alert("VITE_SUPABASE_ANON_KEY is required");
  throw new Error("VITE_SUPABASE_ANON_KEY is required");
}
if (!import.meta.env.VITE_SUPABASE_URL) {
  alert("VITE_SUPABASE_URL is required");
  throw new Error("VITE_SUPABASE_URL is required");
}

console.log(import.meta.env.VITE_SUPABASE_ANON_KEY);
console.log(import.meta.env.VITE_SUPABASE_URL);
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

// Plaid is OPTIONAL. Production keys require an application/approval process, so
// the app must not depend on them. When false (default), the application portal
// shows only the manual document path; flip VITE_PLAID_ENABLED=true once keys clear.
export const PLAID_ENABLED = import.meta.env.VITE_PLAID_ENABLED === "true";
