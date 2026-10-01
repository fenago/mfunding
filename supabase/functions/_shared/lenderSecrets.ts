// ─────────────────────────────────────────────────────────────────────────────
// STRIP CREDENTIALS BEFORE A FUNDER ROW LEAVES OUR INFRASTRUCTURE.
//
// lenders.notes and lenders.submission_notes are free-text columns humans paste
// into. What gets pasted includes portal logins: as of 2026-10-01 our own shared
// mailbox password sits in four lines across four funders, one of them beside
// the owner's personal email as a complete uid/pw pair. A funder never requires
// a password to evaluate a deal, so the value is removed rather than relied on
// being absent — it is NOT absent.
//
// This lived only in recommend-lenders (3f4d8f2). It is here because
// deal-assistant selected submission_notes into its own prompt with NO scrubber
// at all, and measurement showed the credential reaching the model for 2 of the
// 3 funders that carry it in that column. deal-assistant clips notes to 400
// chars, which hid it for the third (Uplyft, at char 531 of 541) — truncation is
// luck, not a control, and the next edit to that number silently un-hides it.
//
// BOTH patterns are load-bearing. Measured against every line in the table that
// carries the value:
//   Guidant (notes)              caught by KEYWORD only  — mailbox misses it
//   IOU Financial, Uplyft        caught by MAILBOX only  — keyword misses them
//   Lendini                      caught by both
// Drop either one and a line goes to the model. Do not "simplify" this to one.
//
// Redacts the LINE and says so, rather than dropping it silently: a reader who
// sees a gap must know a gap is there.
//
// THIS REDUCES EXPOSURE. IT DOES NOT UNDO IT. A credential that has already been
// transmitted must be rotated; hiding it afterwards proves nothing.
// ─────────────────────────────────────────────────────────────────────────────

export const SECRET_LINE_RE =
  /(pass\s?word|passwd|\bpwd\b|\bpw\s*[:=]|login\s*[:=]|credential|user\s*(name)?\s*[:=].*\bpass)/i;

// The address is stored NEXT TO the password as a login pair more often than the
// word "password" appears nearby, so the address itself is the better tell.
export const SHARED_MAILBOX_RE = /send\.mfunding\.net/i;

export const REDACTED = "[credential line withheld — not sent to the model]";

const hit = (line: string) => SECRET_LINE_RE.test(line) || SHARED_MAILBOX_RE.test(line);

/** Redact credential-bearing LINES, preserving everything else verbatim. */
export function scrubText(v: unknown): unknown {
  if (typeof v !== "string" || !v) return v;
  if (!hit(v)) return v;
  return v
    .split(/\r?\n/)
    .map((line) => (hit(line) ? REDACTED : line))
    .join("\n");
}

/**
 * Scrub the free-text columns on a lender row. Call this on EVERY path that
 * sends a lender row off our infrastructure — a model API, a webhook, an export.
 *
 * Scrub BEFORE truncating. Clipping first can cut a line in half and leave the
 * half with the secret in it while removing the keyword that would have caught
 * it, which turns a working guard into a guard that passes.
 */
export function scrubLenderSecrets<T extends Record<string, unknown>>(l: T): T {
  return {
    ...l,
    submission_notes: scrubText(l.submission_notes),
    notes: scrubText(l.notes),
  };
}
