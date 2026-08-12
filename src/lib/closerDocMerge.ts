// closerDocMerge — turn a closer legal TEMPLATE into a document a human can sign.
//
// THE PROBLEM: research/legal/closer-*.md are templates. They ship with
// [COMPANY], [CLOSER NAME], [DATE], [COMMISSION %], [DRAW AMOUNT], [# days],
// [SIGNATORY NAME, TITLE], and Schedule A §4 even ships with the draw-repayment
// choice unresolved ("[ ] forgiven / [x] repayable — select one"). Nobody can
// sign any of that.
//
// WHAT THIS DOES: substitutes real values from the closer's row + company
// settings, and reports every placeholder it could NOT resolve. A document with
// even one unresolved placeholder must never reach a closer — `missing` being
// non-empty is a hard send blocker, enforced again in SQL at signing time.
//
// WHAT THIS DOES NOT DO: author, reword, soften, or summarize legal language.
// Every substitution swaps a bracket token for a value. If you find yourself
// writing a sentence in this file, stop — that is a lawyer's job, not ours.
//
// ⚠ MIRRORED FILE: supabase/functions/_shared/closerDocMerge.ts is a byte-for-byte
//   copy of the logic below (Deno edge functions cannot import from src/). The
//   SERVER copy is authoritative — it produces the content that actually gets
//   frozen and signed. This copy exists so the admin UI can preview the merge and
//   show what's missing BEFORE sending. Change one, change the other.

export type DrawTreatment = "repayable" | "forgiven";

/**
 * Schedule A §4 default. "repayable" is the owner's standing policy: an
 * unrecovered draw balance is recovered, not written off. Changed on
 * /admin/platform-config, never here.
 */
export const DEFAULT_DRAW_TREATMENT: DrawTreatment = "repayable";

export interface MergeSettings {
  company_legal_name?: string | null;
  company_signatory?: string | null;
  governing_state?: string | null;
  clawback_window_days?: number | string | null;
  renewal_override_pct?: number | string | null;
  /**
   * Schedule A §4 — how an unrecovered draw balance is treated.
   * Admin flag, set on /admin/platform-config. Defaults to "repayable"
   * (DEFAULT_DRAW_TREATMENT) so a merged Schedule A always states ONE
   * unambiguous term. A signer must never see both boxes empty.
   */
  draw_unrecovered_treatment?: "forgiven" | "repayable" | null;
  payment_method?: string | null;
}

export interface MergeCloser {
  first_name: string;
  last_name: string;
  company_lead_split?: number | string | null;
  self_gen_split?: number | string | null;
  renewal_split?: number | string | null;
  draw_amount?: number | string | null;
  draw_start_date?: string | null;
  draw_end_date?: string | null;
  start_date?: string | null;
  // --- Substitute W-8BEN (foreign contractor tax) inputs. Populated by the edge
  // functions from profiles + payout_profiles via buildW8benInputs(); absent for
  // the onboarding docs, whose templates contain none of these tokens.
  legal_name?: string | null;
  citizenship_country?: string | null;
  residence_address?: string | null;
  mailing_address?: string | null;
  foreign_tin?: string | null;
}

/** Profile fields the substitute W-8BEN pulls from (public.profiles). */
export interface W8benProfile {
  first_name?: string | null;
  last_name?: string | null;
  display_name?: string | null;
  country?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
}

/** Payout fields the substitute W-8BEN pulls from (public.payout_profiles). */
export interface W8benPayout {
  tax_country?: string | null;
  foreign_tax_id?: string | null;
}

/**
 * Assemble the W-8BEN merge inputs from a contractor's profile + payout rows.
 *
 * PURE — no DB, no auth. The edge functions read the rows (service role) and
 * hand them here. Any required field it cannot fill is returned null, which makes
 * the merge report it as `missing` and BLOCKS the send — we never freeze a
 * W-8BEN with a missing legal name, country, residence, or TIN.
 *
 * `mailing_address` always resolves ("Same as permanent residence address
 * above.") — the official W-8BEN allows the mailing address to be omitted when it
 * matches the residence, so it must never block a foreign contractor's form.
 */
export function buildW8benInputs(
  profile?: W8benProfile | null,
  payout?: W8benPayout | null,
): {
  legal_name: string | null;
  citizenship_country: string | null;
  residence_address: string | null;
  mailing_address: string;
  foreign_tin: string | null;
} {
  const p = profile ?? {};
  const pay = payout ?? {};
  const t = (v?: string | null) => (v ?? "").trim();

  const legal_name = `${t(p.first_name)} ${t(p.last_name)}`.trim() || t(p.display_name) || null;
  const citizenship_country = t(p.country) || t(pay.tax_country) || null;

  const cityLine = [t(p.city), t(p.state), t(p.postal_code)].filter(Boolean).join(", ");
  const parts = [t(p.address_line1), t(p.address_line2), cityLine, t(p.country)].filter(Boolean);
  // Require at least a street line + city before we call the address complete.
  const residence_address = t(p.address_line1) && t(p.city) ? parts.join(", ") : null;

  const foreign_tin = t(pay.foreign_tax_id) || null;

  return {
    legal_name,
    citizenship_country,
    residence_address,
    mailing_address: "Same as permanent residence address above.",
    foreign_tin,
  };
}

export interface MissingField {
  /** The raw token still sitting in the document, e.g. "[SIGNATORY NAME, TITLE]". */
  token: string;
  /** Human label for the super-admin. */
  label: string;
  /** Where the owner goes to fix it. */
  fix: "settings" | "closer";
}

export interface MergeResult {
  content: string;
  missing: MissingField[];
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** 30 → "30%". Trims a trailing ".0". */
const pct = (v: unknown): string | null => {
  const n = num(v);
  if (n === null) return null;
  return `${Number.isInteger(n) ? n : Number(n.toFixed(2))}%`;
};

const money = (v: unknown): string | null => {
  const n = num(v);
  if (n === null) return null;
  return n.toLocaleString("en-US");
};

/** "2026-07-02" → "July 2, 2026". Date-only, parsed as local to avoid TZ slips. */
export function formatDocDate(iso?: string | null): string {
  const d = iso ? new Date(`${iso}T00:00:00`) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

/** Inclusive day count between two ISO dates. */
function daysBetween(a?: string | null, b?: string | null): number | null {
  if (!a || !b) return null;
  const start = new Date(`${a}T00:00:00`).getTime();
  const end = new Date(`${b}T00:00:00`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return Math.round((end - start) / 86_400_000);
}

/**
 * Any leftover bracket token that looks like a FILL-ME field.
 *
 * DEFAULT-DENY, and it must stay that way. An earlier version of this only
 * matched SHOUTING_CASE tokens, which silently let real placeholders through —
 * "[DRAW AMOUNT — recommended $2,500]", "[# — recommended 90]" and
 * "[RENEWAL OVERRIDE % — e.g., 0–10%]" all contain lowercase, and "[#]" is a
 * single symbol. Every one of those would have shipped to a closer as raw
 * brackets inside a contract. So: match ANY bracketed run, then subtract the
 * three things that are legitimately allowed to survive a merge.
 */
export const PLACEHOLDER_RE = /\[[^\]\n]{1,80}\](?!\()/g; // (?!\() — not a [text](url) markdown link

/** Markdown checkbox "[ ]" / "[x]", or a hand-written blank "[____]". Not placeholders. */
const ALLOWED_BRACKET_RE = /^\[(\s*|[xX]|_+)\]$/;

export const isPlaceholder = (token: string): boolean => !ALLOWED_BRACKET_RE.test(token);

const LABELS: Record<string, { label: string; fix: "settings" | "closer" }> = {
  "[COMPANY]": { label: "Company legal name", fix: "settings" },
  "[SIGNATORY NAME, TITLE]": { label: "Company signatory (name + title)", fix: "settings" },
  "[STATE]": { label: "Governing-law state", fix: "settings" },
  "[CLOSER NAME]": { label: "Closer's full legal name", fix: "closer" },
  "[DATE]": { label: "Effective date", fix: "closer" },
  // Substitute W-8BEN — the contractor fixes all of these on their own profile.
  "[LEGAL NAME]": { label: "Your full legal name (Personal tab)", fix: "closer" },
  "[CITIZENSHIP COUNTRY]": { label: "Country of citizenship (Mailing Address tab)", fix: "closer" },
  "[RESIDENCE ADDRESS]": { label: "Permanent residence address (Mailing Address tab)", fix: "closer" },
  "[MAILING ADDRESS]": { label: "Mailing address", fix: "closer" },
  "[FOREIGN TIN]": { label: "Foreign tax ID / TIN (Tax tab)", fix: "closer" },
  "[SIGN DATE]": { label: "Signing date", fix: "closer" },
};

function labelFor(token: string): { label: string; fix: "settings" | "closer" } {
  if (LABELS[token]) return LABELS[token];
  if (token.includes("COMMISSION")) return { label: "Commission split", fix: "closer" };
  if (token.includes("DRAW AMOUNT")) {
    return { label: "Ramp-up draw amount — set it to 0 if this closer has no draw", fix: "closer" };
  }
  if (token.includes("RENEWAL OVERRIDE")) return { label: "Renewal override %", fix: "settings" };
  if (token === "[#]") return { label: "Clawback window (days)", fix: "settings" };
  if (token.startsWith("[#")) {
    return { label: "Draw period length — set the closer's draw start + end dates", fix: "closer" };
  }
  if (token.includes("ROUTING") || token.includes("ACCOUNT") || token.includes("BANK")) {
    return { label: "Bank details (the closer fills these in)", fix: "closer" };
  }
  return { label: token.replace(/[[\]]/g, ""), fix: "settings" };
}

/** Replace every occurrence of a literal token. */
const sub = (s: string, token: string, value: string | null): string =>
  value === null ? s : s.split(token).join(value);

/**
 * Merge one template.
 *
 * Order matters: the long, suffixed Schedule A tokens ("[# — recommended 90]")
 * must be substituted BEFORE the short ones ("[#]"), or the short pattern would
 * corrupt them.
 */
export function mergeCloserDoc(
  /** Kept in the signature for call-site readability + future per-doc rules. */
  _slug: string,
  templateBody: string,
  closer: MergeCloser,
  settings: MergeSettings,
): MergeResult {
  let s = templateBody;

  const closerName = `${closer.first_name ?? ""} ${closer.last_name ?? ""}`.trim() || null;
  const effectiveDate = formatDocDate(closer.start_date) || null;

  // --- Schedule A §2: three [COMMISSION %] tokens. Each row carries a distinct
  // suffix ("(default 30%)" / "(recommended 65%)" / "(recommended 30%)"), so we
  // anchor on that rather than on positional order — reordering the table can't
  // silently swap a closer's self-gen rate onto their company-lead row.
  s = sub(s, "[COMMISSION %] (default 30%)", pct(closer.company_lead_split));
  s = sub(s, "[COMMISSION %] (recommended 65%)", pct(closer.self_gen_split));
  s = sub(s, "[COMMISSION %] (recommended 30%)", pct(closer.renewal_split));

  // --- Schedule A §4: the draw.
  s = sub(s, "[DRAW AMOUNT — recommended $2,500]", money(closer.draw_amount));
  const drawDays = daysBetween(closer.draw_start_date, closer.draw_end_date);
  s = sub(s, "[# — recommended 90]", drawDays === null ? null : String(drawDays));

  // Schedule A §4 ships with the forgiven-vs-repayable choice unresolved. Resolve
  // it from the admin flag — ALWAYS to one side or the other, never leaving both
  // boxes empty. We only move the [x] between the two boxes; the sentence itself
  // is untouched. Defaulting means Schedule A is sendable out of the box.
  const treatment = settings.draw_unrecovered_treatment ?? DEFAULT_DRAW_TREATMENT;
  s =
    treatment === "forgiven"
      ? s.split("[ ] forgiven / [x] repayable").join("[x] forgiven / [ ] repayable")
      : s.split("[ ] forgiven / [x] repayable").join("[ ] forgiven / [x] repayable");

  s = sub(s, "[RENEWAL OVERRIDE % — e.g., 0–10%]", pct(settings.renewal_override_pct));
  s = sub(s, "[direct deposit / method]", settings.payment_method ?? "direct deposit (ACH)");

  // --- Clawback window, e.g. "within [#] days".
  s = sub(s, "[#]", settings.clawback_window_days == null ? null : String(settings.clawback_window_days));

  // --- Global tokens.
  s = sub(s, "[COMPANY]", settings.company_legal_name ?? null);
  s = sub(s, "[CLOSER NAME]", closerName);
  s = sub(s, "[SIGNATORY NAME, TITLE]", settings.company_signatory ?? null);
  s = sub(s, "[STATE]", settings.governing_state ?? null);
  s = sub(s, "[DATE]", effectiveDate);

  // --- Substitute W-8BEN tokens. No-ops on the onboarding docs (none contain
  // them). [MAILING ADDRESS] and [SIGN DATE] always resolve, so they can never
  // block; [LEGAL NAME] / [CITIZENSHIP COUNTRY] / [RESIDENCE ADDRESS] /
  // [FOREIGN TIN] block when the contractor hasn't filled their profile.
  s = sub(s, "[LEGAL NAME]", closer.legal_name ?? closerName);
  s = sub(s, "[CITIZENSHIP COUNTRY]", closer.citizenship_country ?? null);
  s = sub(s, "[RESIDENCE ADDRESS]", closer.residence_address ?? null);
  s = sub(s, "[MAILING ADDRESS]", closer.mailing_address ?? null);
  s = sub(s, "[FOREIGN TIN]", closer.foreign_tin ?? null);
  s = sub(s, "[SIGN DATE]", formatDocDate() || null);

  // --- What's still unfilled?
  const seen = new Set<string>();
  const missing: MissingField[] = [];
  for (const m of s.match(PLACEHOLDER_RE) ?? []) {
    if (!isPlaceholder(m) || seen.has(m)) continue;
    seen.add(m);
    const { label, fix } = labelFor(m);
    missing.push({ token: m, label, fix });
  }

  return { content: s, missing };
}

/** SHA-256 of the merged content, hex. Browser + Deno both expose SubtleCrypto. */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
