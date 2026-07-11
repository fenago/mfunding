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

// Dedicated merchant-portal subdomain. The same React app serves both hosts;
// when it's loaded from my.mfunding.net we treat it as the portal (root routes
// to /portal, merchants stay on-subdomain). Pure runtime hostname check — no
// build-time env, so the same bundle works on either host.
export const PORTAL_HOST = "my.mfunding.net";
export const IS_PORTAL_HOST =
  typeof window !== "undefined" && window.location.hostname === PORTAL_HOST;

// Canonical magic-link landing URL. /auth/merchant works on EITHER host (the
// backend currently redirects to https://mfunding.net/auth/merchant), but this
// is the address to prefer in merchant-facing copy once DNS is live.
export const PORTAL_MAGIC_LINK_URL = `https://${PORTAL_HOST}/auth/merchant`;
