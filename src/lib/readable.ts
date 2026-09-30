// ───────────────────── Readable<T>: a read that can fail ─────────────────────
//
// THE RULE THIS TYPE EXISTS TO ENFORCE
//
// An empty read is not a zero. A read of external state has THREE outcomes and
// a surface must render all three:
//
//     loading        we haven't asked yet
//     ok    + []     we asked, and there genuinely is nothing
//     unreadable     we asked and could not find out
//
// Collapsing the third into the second is the single defect behind six separate
// incidents in one week. Every one of them told a human something false about a
// person:
//
//   "No documents on file yet — chase the bank statements"
//        He had sent a bank statement and a driver's licence. The VibeReach read
//        had failed and the failure rendered as his negligence.
//   "no submission address recorded"          the setter's role can't read that table
//   44 merchants shown "nothing to sign"      a limit=20 over 268 documents
//   "nothing submitted yet" + a live Send button
//        a failed submissions read; the next click would have double-submitted
//   "2 backward stage moves — clean"          queried a column nobody writes; it was 28
//   "the deploy didn't take"                  grepped a file a broken Docker never wrote
//
// THE TEST FOR WHETHER YOU NEED THIS
//
//     DOES AN EMPTY READ HERE PRODUCE AN ACCUSATION?
//
// Not "could this fail" — everything can fail. The question is whether a wrong
// answer would make this surface assert something false ABOUT A PERSON: that a
// merchant didn't send a document, that a setter never dialled, that a funder
// never replied, that a closer's send didn't go out. If yes, the empty value is
// a lie and you must carry `unreadable` all the way to the pixels.
//
// If no — a browse list, a reference table, a cosmetic count — `?? []` is fine
// and this type is overhead. Use judgement; the point is honesty, not ceremony.
//
// LINEAGE
//
// This generalises `DocsReadState` in src/lib/ghlDocs.ts, which solved the same
// problem for one payload on 2026-09-18 and is the proven shape. `DocsReadState`
// is structurally an instance of this family (same `kind` discriminant, same
// `why`), so the two interoperate without a conversion layer. Read the header
// comment there and in supabase/functions/_shared/merchantIdentity.ts for the
// full history.
//
// See also: the memory `readers-must-distinguish-unreadable`, and the ESLint
// rule `no-absence-from-failed-read` which flags the coalesce this type replaces.

// ── THE HALF THIS TYPE DOES NOT COVER ───────────────────────────────────────
//
// `Readable` separates UNREADABLE from EMPTY. There is a second, independent
// way to turn nothing into an accusation, and carrying a `Readable` does not
// help with it at all:
//
//     ONE STORE'S ZERO RENDERED AS THE WHOLE TRUTH.
//
// Found on 2026-09-30 in the processor drawer, and it is worth reading twice
// because the read SUCCEEDED. `ghl-docs-status` answered HTTP 200 with
// `documents_error: null`, `uploads_error: null`, `identity_readable: true`,
// eight documents and both of the merchant's uploaded files — and the panel
// still printed "No documents on file yet" above ten rows of his files. The
// count came from `processor_deal_detail`, which reads `customer_documents`,
// and `customer_documents` only holds what arrived THROUGH THIS APP. A merchant
// who uploads to a VibeReach form never touches it.
//
// So a row can be correctly unticked from a perfectly good read and still be
// wrong, because the file is in the other store. No amount of `kind:
// "unreadable"` catches that, and neither does the `no-absence-from-failed-read`
// ESLint rule — both only see reads that failed.
//
// **The fix for this half is naming the store in the sentence**, not wrapping
// the value: say "none in app" or "none on the VibeReach contact", never a bare
// "no documents". A count is only a verdict about a person if it covers
// everywhere they could have put the thing.
//
// Corollary, same day: `readDocsStatus` rules on the DOCUMENTS half of the
// envelope only. `uploads_error` fails independently and comes back as a SHORT
// list with no error anywhere `readDocsStatus` looks — which is exactly what
// made a bank-statement row read "not collected" for a merchant who had sent
// one. Check `uploads_error` yourself; see DocumentChecklist.tsx for the shape.

/**
 * The result of a read that might not have happened.
 *
 * The discriminant makes the failure unskippable: `value` exists only on the
 * `ok` arm, so TypeScript will not let you reach the data without first saying
 * what you do when the read failed.
 */
export type Readable<T> =
  | { kind: "loading" }
  | { kind: "ok"; value: T }
  /** `why` is shown to a human, so it must say what we could not find out —
   *  not a stack trace. "VibeReach didn't answer", not "TypeError undefined". */
  | { kind: "unreadable"; why: string };

/** The shape supabase-js hands back from `.select()`, `.rpc()` and `functions.invoke()`. */
type SupabaseResult<T> = { data: T | null; error: { message: string } | null };

export const loading = <T,>(): Readable<T> => ({ kind: "loading" });
export const ok = <T,>(value: T): Readable<T> => ({ kind: "ok", value });
export const unreadable = <T,>(why: string): Readable<T> => ({ kind: "unreadable", why });

/**
 * Turn a supabase-js result into a `Readable`. This is the one-line conversion
 * that replaces `data ?? []`:
 *
 *     const rows = readResult(await supabase.from("deal_submissions").select("*"), []);
 *     // rows.kind === "unreadable"  →  "couldn't check", never "nothing submitted"
 *
 * `whenNull` is the value to use when the read SUCCEEDED and returned nothing —
 * `[]` for a list, `0` for a count. That is a genuine empty, and it is the only
 * empty this function will ever produce.
 */
export function readResult<T>(res: SupabaseResult<T>, whenNull: T): Readable<T> {
  if (res.error) return { kind: "unreadable", why: res.error.message };
  return { kind: "ok", value: res.data ?? whenNull };
}

/**
 * Same, for a `{ count, error }` head query. A failed count is NOT zero — a
 * queue that renders 0 because the read failed tells a processor their work is
 * done. That was the "2 backward stage moves — clean" incident.
 */
export function readCount(res: { count: number | null; error: { message: string } | null }): Readable<number> {
  if (res.error) return { kind: "unreadable", why: res.error.message };
  return { kind: "ok", value: res.count ?? 0 };
}

/**
 * For an edge-function call, where the transport can succeed and the payload
 * still carry its own `error`/`ok:false`. Both are unreadable.
 */
export function readInvoke<T extends { error?: string; ok?: boolean } | null>(
  res: { data: T; error: { message: string } | null },
  whatWeAsked: string,
): Readable<NonNullable<T>> {
  if (res.error) return { kind: "unreadable", why: res.error.message };
  if (!res.data) return { kind: "unreadable", why: `${whatWeAsked} returned nothing` };
  if (res.data.error) return { kind: "unreadable", why: res.data.error };
  if (res.data.ok === false) return { kind: "unreadable", why: `${whatWeAsked} could not answer` };
  return { kind: "ok", value: res.data as NonNullable<T> };
}

/** True when the read succeeded AND there is genuinely nothing. The ONLY state
 *  a surface may render as "none" / "nothing yet" / "hasn't". */
export function isGenuinelyEmpty<T>(r: Readable<T[]>): boolean {
  return r.kind === "ok" && r.value.length === 0;
}

/**
 * The value, or a fallback, for the cases where you have ALREADY decided the
 * distinction doesn't matter here (a browse list, a cosmetic count).
 *
 * ⚠ Using this in a surface that says "no documents" / "never dialled" /
 * "nothing submitted" re-introduces the exact bug this file exists to prevent.
 * If the sentence you are about to render is about what a PERSON did, handle
 * `unreadable` explicitly instead.
 */
export function orElse<T>(r: Readable<T>, fallback: T): T {
  return r.kind === "ok" ? r.value : fallback;
}

/** Map the loaded value, carrying `loading` and `unreadable` through untouched. */
export function mapReadable<T, U>(r: Readable<T>, f: (v: T) => U): Readable<U> {
  return r.kind === "ok" ? { kind: "ok", value: f(r.value) } : r;
}

/**
 * Combine several reads. If ANY is unreadable the whole thing is unreadable —
 * a panel assembled from four reads where one failed is not a partial truth,
 * it is a claim with a hole in it. The `why`s are joined so the human learns
 * which part we couldn't get.
 */
export function allReadable<T extends readonly Readable<unknown>[]>(
  ...rs: T
): Readable<{ [K in keyof T]: T[K] extends Readable<infer V> ? V : never }> {
  const whys = rs.filter((r) => r.kind === "unreadable").map((r) => (r as { why: string }).why);
  if (whys.length) return { kind: "unreadable", why: [...new Set(whys)].join("; ") };
  if (rs.some((r) => r.kind === "loading")) return { kind: "loading" };
  return {
    kind: "ok",
    value: rs.map((r) => (r as { value: unknown }).value) as never,
  };
}

/**
 * The one sentence a surface shows instead of an accusation. Deliberately says
 * what we could not do, never what the person did not do — and never goes
 * quiet: a processor must LEARN that the check failed, not stop seeing it.
 */
export function unreadableNote(r: { kind: "unreadable"; why: string }, subject: string): string {
  return `⚠ Couldn't check ${subject} — ${r.why}. This is NOT "none on file"; re-check before telling anyone they're missing.`;
}
