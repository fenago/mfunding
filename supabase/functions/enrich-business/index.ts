// enrich-business — ONE-BUTTON business research (ENR2, plan: research/PLAN_business_enrichment.md).
//
// POST { dealId, force?: boolean, seed_url?: string }
//   → { enrichment_id, status, enrichment, cached? }
//
// Pipeline (plan §2): gate & cache check → Firecrawl SEARCH (cheap, 2 queries +
// free email-domain shortcut) → DETERMINISTIC candidate scoring (plan §4 — pure
// TypeScript, never an LLM) → ONE /v2/agent crawl of the top candidate (the only
// expensive step; skipped entirely when the best pre-crawl score is below the
// floor) → store LOAD fields + match verdict on public.business_enrichment.
//
// Auth mirrors push-application-to-ghl: verify_jwt = true at the gateway PLUS an
// in-code role check (closer/admin/super_admin); a CLOSER may only research deals
// they own (closer_owns_deal RPC). No anonymous path, no service-role bypass.
//
// Cost controls (plan §5): business_key cache (normalize(name)|state, TTL from
// platform_settings.enrichment.cache_ttl_days, default 30d — a cache hit costs $0),
// search-first-crawl-one, and a per-day cap (platform_settings.enrichment.daily_cap,
// default 25; resets midnight ET) → 429 when hit.
//
// FIRECRAWL_API_KEY comes from the Supabase secret store ONLY. Never VITE_*
// (audit 2026-06-29 finding #4 — the old client-bundle key is compromised).
//
// ⚠️ INJECTION SAFETY (P1): everything scraped off the web (candidates, raw,
// found_* fields) is UNTRUSTED third-party text. This function stores it and
// compares it deterministically — it NEVER feeds it to an LLM. P2's ANALYZE pass
// (and any deal-assistant / underwrite-deal wiring) MUST fence this content as
// DATA inside delimiters per plan §7 before any model sees it. Do not wire it
// into a prompt naively.
//
// Compliance: internal research tool; produces no merchant-facing copy. MCA =
// purchase of future receivables, never "loan" — nothing here says otherwise.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, serviceClient } from "../_shared/ghl.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────────────────
// Normalization helpers (all deterministic — plan §4)
// ─────────────────────────────────────────────────────────────────────────────

const ENTITY_SUFFIXES = new Set([
  "llc", "inc", "incorporated", "corp", "corporation", "co", "company",
  "ltd", "llp", "lp", "pc", "pllc", "pa", "plc", "dba",
]);

/** Lowercase, strip entity suffixes + punctuation, collapse whitespace. */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !ENTITY_SUFFIXES.has(t))
    .join(" ")
    .trim();
}

function nameTokens(name: string): string[] {
  const STOP = new Set(["and", "the", "of", "a", "an", "&"]);
  return normalizeName(name).split(" ").filter((t) => t.length > 1 && !STOP.has(t));
}

function businessKey(name: string, state: string | null | undefined): string {
  return `${normalizeName(name)}|${(state ?? "").trim().toUpperCase()}`;
}

const last10 = (phone: string | null | undefined): string | null => {
  const d = (phone ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
};

const FREEMAIL = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com", "icloud.com",
  "msn.com", "live.com", "ymail.com", "comcast.net", "att.net", "verizon.net",
  "sbcglobal.net", "protonmail.com", "proton.me", "me.com", "mac.com", "gmx.com",
  "mail.com", "zoho.com", "bellsouth.net", "cox.net", "charter.net", "earthlink.net",
  "rocketmail.com", "yandex.com", "hey.com",
]);

function emailBusinessDomain(email: string | null | undefined): string | null {
  const m = (email ?? "").toLowerCase().match(/@([a-z0-9.-]+\.[a-z]{2,})$/);
  if (!m) return null;
  return FREEMAIL.has(m[1]) ? null : m[1];
}

const hostnameOf = (url: string): string => {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
};

// US states for the state-contradiction anchor signal.
const STATES: Record<string, string> = {
  AL: "alabama", AK: "alaska", AZ: "arizona", AR: "arkansas", CA: "california",
  CO: "colorado", CT: "connecticut", DE: "delaware", FL: "florida", GA: "georgia",
  HI: "hawaii", ID: "idaho", IL: "illinois", IN: "indiana", IA: "iowa",
  KS: "kansas", KY: "kentucky", LA: "louisiana", ME: "maine", MD: "maryland",
  MA: "massachusetts", MI: "michigan", MN: "minnesota", MS: "mississippi",
  MO: "missouri", MT: "montana", NE: "nebraska", NV: "nevada", NH: "new hampshire",
  NJ: "new jersey", NM: "new mexico", NY: "new york", NC: "north carolina",
  ND: "north dakota", OH: "ohio", OK: "oklahoma", OR: "oregon", PA: "pennsylvania",
  RI: "rhode island", SC: "south carolina", SD: "south dakota", TN: "tennessee",
  TX: "texas", UT: "utah", VT: "vermont", VA: "virginia", WA: "washington",
  WV: "west virginia", WI: "wisconsin", WY: "wyoming", DC: "district of columbia",
};

/** Normalize a found state ("California", "CA", "ca.") to a 2-letter abbrev, or null. */
function toStateAbbrev(v: string | null | undefined): string | null {
  const s = (v ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!s) return null;
  const up = s.toUpperCase();
  if (STATES[up]) return up;
  for (const [ab, name] of Object.entries(STATES)) if (name === s) return ab;
  return null;
}

/** Which states does this free text affirmatively mention (address-shaped `", XX "` or full name)? */
function statesInText(text: string): Set<string> {
  const found = new Set<string>();
  const lower = text.toLowerCase();
  for (const [ab, name] of Object.entries(STATES)) {
    if (lower.includes(name)) { found.add(ab); continue; }
    // Abbrevs only in address-like context — bare "IN"/"OR"/"ME" are English words.
    if (new RegExp(`,\\s*${ab}\\b[\\s,]*(\\d{5})?`, "i").test(text)) found.add(ab);
  }
  return found;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic scoring (plan §4). NEVER computed by an LLM.
// ─────────────────────────────────────────────────────────────────────────────

interface Facts {
  nameOverlap: number;                          // 0..1
  state: "match" | "contradiction" | "unknown"; // anchor signal — we always have lead state
  phoneMatch: boolean;
  emailDomainMatch: boolean;
  industry: "consistent" | "different" | "unknown";
  contactNameFound: boolean;
}

function scoreFacts(f: Facts): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = Math.round(35 * Math.max(0, Math.min(1, f.nameOverlap)));
  reasons.push(`name similarity ${(f.nameOverlap * 100).toFixed(0)}% → +${score}`);
  if (f.state === "match") { score += 25; reasons.push("state matches lead → +25"); }
  if (f.state === "contradiction") { score -= 40; reasons.push("DIFFERENT state affirmatively found → −40"); }
  if (f.phoneMatch) { score += 25; reasons.push("phone matches lead → +25"); }
  if (f.emailDomainMatch) { score += 20; reasons.push("lead email domain matches site → +20"); }
  if (f.industry === "consistent") { score += 10; reasons.push("industry consistent → +10"); }
  if (f.industry === "different") { score -= 15; reasons.push("industry clearly different → −15"); }
  if (f.contactNameFound) { score += 10; reasons.push("contact name found on site → +10"); }
  return { score: Math.max(0, Math.min(100, score)), reasons };
}

/** ≥75 confident · 45–74 possible · <45 no_match. A state contradiction ALONE caps at possible. */
function verdictOf(score: number, stateContradiction: boolean): "confident" | "possible" | "no_match" {
  if (score < 45) return "no_match";
  if (score >= 75 && !stateContradiction) return "confident";
  return "possible";
}

const SCORE_FLOOR = 45; // below this we DON'T crawl — no agent spend on a bad match

// ─────────────────────────────────────────────────────────────────────────────
// SSRF hygiene for closer-supplied seed URLs (plan §6.5)
// ─────────────────────────────────────────────────────────────────────────────

function validateSeedUrl(raw: string): { ok: true; url: string } | { ok: false; reason: string } {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return { ok: false, reason: "not a valid URL" }; }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, reason: "URL must be http(s)" };
  }
  const host = u.hostname.toLowerCase();
  if (
    host === "localhost" || host.endsWith(".localhost") ||
    host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan") ||
    !host.includes(".")
  ) return { ok: false, reason: "URL must be a public website" };
  // Reject ALL IP literals (v4 + v6) — a real business site has a hostname.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return { ok: false, reason: "IP-literal URLs are not allowed" };
  if (host.includes(":") || /^\[/.test(u.hostname)) return { ok: false, reason: "IP-literal URLs are not allowed" };
  return { ok: true, url: u.toString() };
}

// ─────────────────────────────────────────────────────────────────────────────
// Firecrawl calls
// ─────────────────────────────────────────────────────────────────────────────

interface Candidate { url: string; title: string; snippet: string; score: number; reasons: string[] }

async function firecrawlSearch(apiKey: string, query: string, limit = 5): Promise<Array<{ url: string; title: string; snippet: string }>> {
  const res = await fetch("https://api.firecrawl.dev/v2/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, limit }),
  });
  if (!res.ok) {
    console.error(`Firecrawl search failed (${res.status}): ${await res.text()}`);
    return [];
  }
  const data = await res.json();
  // v2 shape: { success, data: { web: [{url,title,description}] } } — be defensive.
  const items: Array<Record<string, unknown>> = data?.data?.web ?? data?.data?.results ?? (Array.isArray(data?.data) ? data.data : []);
  return items
    .filter((r) => typeof r?.url === "string")
    .map((r) => ({
      url: r.url as string,
      title: (r.title as string) ?? "",
      snippet: (r.description as string) ?? (r.snippet as string) ?? "",
    }));
}

// Business-profile extraction schema for the ONE /v2/agent crawl (plan §2 step 3).
const AGENT_SCHEMA = {
  type: "object",
  properties: {
    business_name: { type: "string", description: "Official business name as shown on the site" },
    street_address: { type: "string", description: "Street address (number + street) of the business" },
    city: { type: "string" },
    state: { type: "string", description: "US state (2-letter abbreviation preferred)" },
    zip: { type: "string" },
    phone: { type: "string", description: "Primary business phone number" },
    website: { type: "string", description: "Canonical website URL" },
    entity_type_hint: { type: "string", description: "Entity type if evident: LLC, Corp, PC, PLLC, etc." },
    ein_if_public: { type: "string", description: "EIN ONLY if publicly posted on the site (rare)" },
    year_founded_or_established: { type: "number", description: "Year founded/established if stated" },
    locations_count: { type: "number", description: "Number of physical locations if evident" },
    employee_hint: { type: "string", description: "Team/employee size signal if evident" },
    what_they_do: { type: "string", description: "1-3 sentences: what this business actually does" },
    products_services: { type: "array", items: { type: "string" } },
    customer_type: { type: "string", description: "b2b, b2c, or both" },
    hours: { type: "string" },
    social_links: { type: "array", items: { type: "string" } },
    review_signals: {
      type: "array",
      items: {
        type: "object",
        properties: { source: { type: "string" }, rating: { type: "number" }, count: { type: "number" } },
      },
    },
    red_flags: {
      type: "array", items: { type: "string" },
      description: "Closed/for-sale notices, lawsuit mentions, restricted-industry signals",
    },
  },
};

const AGENT_PROMPT =
  `You are researching a small business for a funding brokerage CRM. ` +
  `Extract the business's real-world footprint from its website: legal/official name, ` +
  `full street address, phone, entity type, year established, what it actually does, ` +
  `and any red flags (closed, for sale, lawsuits mentioned). Extract only what the ` +
  `pages actually say — leave fields empty when not found.`;

interface AgentOutcome {
  extracted: Record<string, unknown> | null;
  creditsUsed: number | null;
  rawTrimmed: unknown;
  error?: string;
}

/** ONE /v2/agent crawl — same call+poll shape as scan-lender-website (start → poll 1.5s, ≤105s). */
async function firecrawlAgent(apiKey: string, url: string): Promise<AgentOutcome> {
  const start = await fetch("https://api.firecrawl.dev/v2/agent", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ urls: [url], prompt: AGENT_PROMPT, schema: AGENT_SCHEMA }),
  });
  if (!start.ok) {
    return { extracted: null, creditsUsed: null, rawTrimmed: null, error: `agent start ${start.status}: ${(await start.text()).slice(0, 300)}` };
  }
  const startData = await start.json();
  const jobId = startData?.id;
  if (!jobId) return { extracted: null, creditsUsed: null, rawTrimmed: startData, error: "no agent job id returned" };

  const maxAttempts = 70; // 70 × 1.5s = 105s, same budget as scan-lender-website
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await delay(1500);
    const poll = await fetch(`https://api.firecrawl.dev/v2/agent/${jobId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!poll.ok) continue;
    const status = await poll.json();
    if (status?.status === "completed") {
      const output = status.result ?? status.output ?? status.data ?? null;
      let extracted: Record<string, unknown> | null = null;
      if (output && typeof output === "object") extracted = output as Record<string, unknown>;
      else if (typeof output === "string") { try { extracted = JSON.parse(output); } catch { extracted = { what_they_do: output.slice(0, 1500) }; } }
      const credits = typeof status.creditsUsed === "number" ? status.creditsUsed
        : typeof status.credits_used === "number" ? status.credits_used : null;
      return {
        extracted,
        creditsUsed: credits,
        rawTrimmed: JSON.parse(JSON.stringify(status, (_k, v) => typeof v === "string" && v.length > 2000 ? v.slice(0, 2000) + "…[trimmed]" : v)),
      };
    }
    if (status?.status === "failed" || status?.status === "error") {
      return { extracted: null, creditsUsed: null, rawTrimmed: status, error: `agent job failed: ${JSON.stringify(status).slice(0, 300)}` };
    }
  }
  return { extracted: null, creditsUsed: null, rawTrimmed: null, error: "agent timed out (~105s)" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let payload: { dealId?: string; force?: boolean; seed_url?: string };
  try { payload = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  const dealId = payload.dealId;
  if (!dealId) return json({ error: "dealId is required" }, 400);
  const force = payload.force === true;

  const db = serviceClient();

  // --- Authn/Authz: mirror push-application-to-ghl. Signed-in staff only;
  // a closer may only research deals assigned to them. ---
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Missing authorization" }, 401);
  const { data: userData, error: userErr } = await db.auth.getUser(token);
  const caller = userData?.user;
  if (userErr || !caller) return json({ error: "Invalid session" }, 401);
  const { data: callerProfile } = await db
    .from("profiles").select("role").eq("id", caller.id).single();
  const callerRole = callerProfile?.role as string | undefined;
  if (!callerRole || !["closer", "admin", "super_admin"].includes(callerRole)) {
    return json({ error: "Forbidden — staff only" }, 403);
  }

  const { data: deal, error: dErr } = await db
    .from("deals").select("id, customer_id").eq("id", dealId).maybeSingle();
  if (dErr || !deal) return json({ error: `deal not found: ${dErr?.message ?? dealId}` }, 404);

  if (callerRole === "closer") {
    const { data: owns } = await db.rpc("closer_owns_deal", { uid: caller.id, d_id: dealId });
    if (!owns) return json({ error: "Forbidden — this deal isn't assigned to you" }, 403);
  }

  const { data: customer, error: cErr } = await db
    .from("customers")
    .select("id, business_name, first_name, last_name, phone, email, industry, address_state")
    .eq("id", deal.customer_id).maybeSingle();
  if (cErr || !customer) return json({ error: `customer not found: ${cErr?.message ?? deal.customer_id}` }, 404);
  const bizName = (customer.business_name ?? "").trim();
  if (!bizName) return json({ error: "This lead has no business name to research." }, 422);

  // Validate the closer-supplied override URL BEFORE spending anything (SSRF hygiene).
  let seedUrl: string | null = null;
  if (payload.seed_url) {
    const v = validateSeedUrl(payload.seed_url);
    if (!v.ok) return json({ error: `seed_url rejected: ${v.reason}` }, 400);
    seedUrl = v.url;
  }

  const leadState = toStateAbbrev(customer.address_state) ?? (((customer.address_state ?? "").trim().toUpperCase()) || null);
  const key = businessKey(bizName, leadState);

  // --- Settings (tunable without a deploy) ---
  const { data: settingsRow } = await db
    .from("platform_settings").select("value").eq("key", "enrichment").maybeSingle();
  const dailyCap = Number(settingsRow?.value?.daily_cap ?? 25);
  const ttlDays = Number(settingsRow?.value?.cache_ttl_days ?? 30);

  // --- Cache check: a completed run on the same business inside the TTL is free. ---
  if (!force && !seedUrl) {
    const ttlCutoff = new Date(Date.now() - ttlDays * 86400_000).toISOString();
    const { data: cached } = await db
      .from("business_enrichment")
      .select("*")
      .eq("business_key", key)
      .eq("status", "completed")
      .gte("completed_at", ttlCutoff)
      .order("completed_at", { ascending: false })
      .limit(1).maybeSingle();
    if (cached) return json({ enrichment_id: cached.id, status: "completed", cached: true, enrichment: cached });
  }

  // --- Daily cap (resets midnight ET) — count today's real runs, cache hits excluded. ---
  const capSince = etMidnightUtcIso();
  const { count: todayCount, error: capErr } = await db
    .from("business_enrichment")
    .select("id", { count: "exact", head: true })
    .gte("created_at", capSince);
  if (capErr) return json({ error: `cap check failed: ${capErr.message}` }, 500);
  if ((todayCount ?? 0) >= dailyCap) {
    return json({ error: "Daily research budget reached — resets at midnight ET.", daily_cap: dailyCap }, 429);
  }

  const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY"); // secret store ONLY — never VITE_*
  if (!firecrawlKey) return json({ error: "FIRECRAWL_API_KEY not configured" }, 500);

  // --- Create the run row (rows are written at each phase so a timeout still leaves partials). ---
  const { data: row, error: insErr } = await db
    .from("business_enrichment")
    .insert({
      customer_id: customer.id, deal_id: dealId, business_key: key,
      requested_by: caller.id, status: "searching", seed_url: seedUrl,
    })
    .select("id").single();
  if (insErr || !row) return json({ error: `could not create enrichment row: ${insErr?.message}` }, 500);
  const enrichmentId = row.id as string;

  const fail = async (msg: string, extra: Record<string, unknown> = {}) => {
    const { error: e } = await db.from("business_enrichment")
      .update({ status: "failed", error: msg, completed_at: new Date().toISOString(), ...extra })
      .eq("id", enrichmentId);
    if (e) console.error("failed to record failure:", e.message);
    return json({ enrichment_id: enrichmentId, status: "failed", error: msg }, 502);
  };

  try {
    // ── SEARCH (cheap) or seed override ─────────────────────────────────────
    const leadPhone10 = last10(customer.phone);
    const leadEmailDomain = emailBusinessDomain(customer.email);
    const contactTokens = nameTokens(`${customer.first_name ?? ""} ${customer.last_name ?? ""}`);
    const bizTokens = nameTokens(bizName);
    let searchCount = 0;

    let candidates: Candidate[] = [];
    if (seedUrl) {
      candidates = [{ url: seedUrl, title: "closer-supplied URL", snippet: "", score: 100, reasons: ["seed_url override — search skipped"] }];
    } else {
      // Name goes UNQUOTED: exact-phrase quoting a vendor-supplied legal name
      // ("Braun Blaising And Wynne P.C.") returns ZERO hits when the business
      // styles itself differently ("Braun Blaising & Wynne") — verified live
      // 2026-07-14. Precision comes from the deterministic scorer, not the query.
      const queries = [`${bizName} ${leadState ?? ""}`.trim()];
      if (customer.phone) queries.push(`${bizName} "${customer.phone}"`);
      const resultsNested = await Promise.all(queries.map((q) => firecrawlSearch(firecrawlKey, q, 5)));
      searchCount = queries.length;

      const seen = new Map<string, { url: string; title: string; snippet: string }>();
      // Free shortcut: a non-freemail lead email domain is promoted to candidate #1.
      if (leadEmailDomain) {
        seen.set(leadEmailDomain, { url: `https://${leadEmailDomain}`, title: `${leadEmailDomain} (from lead email domain)`, snippet: "" });
      }
      for (const results of resultsNested) {
        for (const r of results) {
          const host = hostnameOf(r.url);
          if (!host || seen.has(host)) continue;
          seen.set(host, r);
        }
      }

      // Pre-crawl deterministic scoring from search metadata (plan §4).
      candidates = [...seen.values()].slice(0, 8).map((r) => {
        const text = `${r.title} ${r.snippet} ${r.url}`;
        const lower = text.toLowerCase();
        const overlap = bizTokens.length
          ? bizTokens.filter((t) => lower.includes(t)).length / bizTokens.length : 0;
        const mentioned = statesInText(text);
        const state: Facts["state"] = leadState && mentioned.has(leadState) ? "match"
          : leadState && mentioned.size > 0 && !mentioned.has(leadState) ? "contradiction"
          : "unknown";
        const industryTokens = nameTokens(customer.industry ?? "");
        const facts: Facts = {
          nameOverlap: overlap,
          state,
          phoneMatch: !!leadPhone10 && text.replace(/\D/g, "").includes(leadPhone10),
          emailDomainMatch: !!leadEmailDomain && hostnameOf(r.url).endsWith(leadEmailDomain),
          industry: industryTokens.length && industryTokens.some((t) => lower.includes(t)) ? "consistent" : "unknown",
          contactNameFound: contactTokens.length >= 2 && contactTokens.every((t) => lower.includes(t)),
        };
        const { score, reasons } = scoreFacts(facts);
        return { url: r.url, title: r.title, snippet: r.snippet.slice(0, 400), score, reasons };
      }).sort((a, b) => b.score - a.score);
    }

    const top = candidates[0];

    // ── Below the floor → STOP. No crawl money on a wrong business. ─────────
    if (!top || (!seedUrl && top.score < SCORE_FLOOR)) {
      const upd = {
        status: "completed", candidates, chosen_url: null,
        match_score: top?.score ?? 0, match_verdict: "no_match",
        mismatch_reasons: top ? [`best candidate scored ${top.score} (<${SCORE_FLOOR}) — crawl skipped`] : ["no search results"],
        credits_estimate: searchCount, completed_at: new Date().toISOString(),
      };
      const { error: e } = await db.from("business_enrichment").update(upd).eq("id", enrichmentId);
      if (e) return json({ error: `store failed: ${e.message}` }, 500);
      await logActivity(db, dealId, caller.id, bizName, "no_match", top?.score ?? 0, null);
      return json({ enrichment_id: enrichmentId, status: "completed", enrichment: { id: enrichmentId, ...upd } });
    }

    // ── CRAWL + EXTRACT — the expensive step, ONE candidate only. ───────────
    {
      const { error: e } = await db.from("business_enrichment")
        .update({ status: "crawling", candidates, chosen_url: top.url }).eq("id", enrichmentId);
      if (e) console.error("phase update failed:", e.message);
    }

    const agent = await firecrawlAgent(firecrawlKey, top.url);
    if (!agent.extracted) return fail(agent.error ?? "crawl produced no output", { candidates, chosen_url: top.url, credits_estimate: searchCount });
    const x = agent.extracted;
    const str = (v: unknown): string | null => (typeof v === "string" && v.trim() && !v.includes("{")) ? v.trim() : null;

    const foundState = toStateAbbrev(str(x.state)) ?? str(x.state);
    const foundPhone10 = last10(str(x.phone));
    const foundName = str(x.business_name);
    const foundWebsiteHost = hostnameOf(str(x.website) ?? top.url);

    // ── Post-crawl re-score: extracted facts override search-snippet guesses. ──
    const crawlText = JSON.stringify(x).toLowerCase();
    const postNameOverlap = Math.max(
      bizTokens.length ? bizTokens.filter((t) => crawlText.includes(t)).length / bizTokens.length : 0,
      foundName ? (bizTokens.length ? bizTokens.filter((t) => normalizeName(foundName).includes(t)).length / bizTokens.length : 0) : 0,
    );
    const stateContradiction = !!(foundState && leadState && toStateAbbrev(foundState) && toStateAbbrev(foundState) !== leadState);
    const industryTokens = nameTokens(customer.industry ?? "");
    const facts: Facts = {
      nameOverlap: postNameOverlap,
      state: foundState && leadState ? (stateContradiction ? "contradiction" : "match") : "unknown",
      phoneMatch: !!leadPhone10 && !!foundPhone10 && leadPhone10 === foundPhone10,
      emailDomainMatch: !!leadEmailDomain && foundWebsiteHost.endsWith(leadEmailDomain),
      industry: industryTokens.length && industryTokens.some((t) => crawlText.includes(t)) ? "consistent" : "unknown",
      contactNameFound: contactTokens.length >= 2 && contactTokens.every((t) => crawlText.includes(t)),
    };
    const { score, reasons } = scoreFacts(facts);
    // A found-state contradiction ALONE caps the verdict at 'possible' (plan §4).
    const verdict = verdictOf(score, stateContradiction);

    const mismatch: string[] = [];
    if (stateContradiction) mismatch.push(`state differs: ${toStateAbbrev(foundState)} found vs lead ${leadState}`);
    if (leadPhone10 && foundPhone10 && leadPhone10 !== foundPhone10) mismatch.push("phone on site differs from lead phone");

    // CONFIRM table — deterministic claim-vs-web comparisons.
    const conf = (claim: string, leadVal: string | null, webVal: string | null, match: boolean | null) => ({
      claim, lead_value: leadVal, web_value: webVal,
      verdict: webVal == null ? "not_found" : match ? "match" : "differ",
    });
    const confirmations = [
      conf("business name", bizName, foundName, postNameOverlap >= 0.6),
      conf("state", leadState, foundState ? (toStateAbbrev(foundState) ?? foundState) : null, !stateContradiction && !!foundState),
      conf("phone", customer.phone ?? null, str(x.phone), facts.phoneMatch),
      conf("industry", customer.industry ?? null, str(x.what_they_do)?.slice(0, 160) ?? null, facts.industry === "consistent"),
    ];

    const upd = {
      status: "completed",
      candidates,
      chosen_url: top.url,
      match_score: score,
      match_verdict: verdict,
      mismatch_reasons: mismatch.length ? mismatch : null,
      found_street: str(x.street_address),
      found_city: str(x.city),
      found_state: foundState ? (toStateAbbrev(foundState) ?? foundState) : null,
      found_zip: str(x.zip),
      found_phone: str(x.phone),
      found_website: str(x.website) ?? top.url,
      found_entity_hint: str(x.entity_type_hint),
      found_ein: str(x.ein_if_public),
      found_year_started: typeof x.year_founded_or_established === "number" ? x.year_founded_or_established : null,
      confirmations,
      // P1 stores the raw extraction; the LLM ANALYZE pass is P2 (plan §7 fencing required).
      analysis: null,
      credits_estimate: searchCount + (agent.creditsUsed ?? 0),
      raw: { score_reasons: reasons, agent: agent.rawTrimmed },
      completed_at: new Date().toISOString(),
    };
    const { error: updErr } = await db.from("business_enrichment").update(upd).eq("id", enrichmentId);
    if (updErr) return json({ error: `store failed: ${updErr.message}` }, 500);

    await logActivity(db, dealId, caller.id, bizName, verdict, score, hostnameOf(top.url));
    return json({ enrichment_id: enrichmentId, status: "completed", enrichment: { id: enrichmentId, ...upd } });
  } catch (e) {
    console.error("enrich-business error:", e);
    return fail(e instanceof Error ? e.message : "unexpected error");
  }
});

/** Midnight ET (America/New_York) expressed as a UTC ISO string — the daily-cap window. */
function etMidnightUtcIso(): string {
  const now = new Date();
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now); // YYYY-MM-DD
  const [y, m, d] = ymd.split("-").map(Number);
  let t = Date.UTC(y, m - 1, d, 5, 0, 0); // EST guess (UTC-5)
  const hourAtGuess = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }).format(new Date(t)),
  );
  if (hourAtGuess % 24 === 1) t -= 3600_000; // EDT (UTC-4): shift back one hour
  return new Date(t).toISOString();
}

/** Best-effort activity_log note — but the .error IS checked (house rule #3).
 *  interaction_type MUST be 'note' — 'system' is not in the check constraint. */
async function logActivity(
  db: ReturnType<typeof serviceClient>, dealId: string, userId: string,
  bizName: string, verdict: string, score: number, domain: string | null,
) {
  const { error } = await db.from("activity_log").insert({
    entity_type: "deal", entity_id: dealId, interaction_type: "note",
    subject: "Business research run",
    content: `Firecrawl research on "${bizName}" — verdict: ${verdict} (score ${score})${domain ? `, source: ${domain}` : ""}. Findings are unverified web data; confirm with the merchant.`,
    logged_by: userId,
  });
  if (error) console.error("activity_log insert failed:", error.message);
}
