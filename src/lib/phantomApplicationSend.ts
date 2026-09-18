// isPhantomApplicationSend — "this application_sent_at stamp is not a send".
//
// THE FACT. Four deals carry an application_sent_at that nobody produced by
// sending anything. The GHL opportunity mirror imported opportunities that were
// already sitting in the Application Sent stage, and the stage trigger stamped
// the timestamp inside the INSERT — 12-15 ms BEFORE created_at, with a null
// created_by, because the writer was service_role and not a person.
//
//   MF-2026-0324  SINGING MIMI MUSIC STUDIO  9/9
//   MF-2026-0273  United Resource Systems    8/28
//   MF-2026-0256  ANDRADE'S STONE INC        8/25
//   MF-2026-0242  Nothing But Waste          8/20
//
// WHAT IT DOES NOT MEAN. Not "the merchant never got an application".
// MF-2026-0273 is flagged AND signed — it plainly reached the merchant, through
// GHL, before this system ever saw the deal. The flag means exactly one thing:
// WE have no record of a send, so nothing here may be dated, attributed to a
// person, or chased as "they haven't signed yet".
//
// ── WHY A TYPESCRIPT COPY EXISTS, AND THE ONE RULE FOR IT ────────────────────
// public.is_phantom_application_send(application_sent_at, created_at, created_by)
// is CANONICAL, and every surface that can read a row of
// deal_application_status() / processor_application_queue() must keep using its
// born_at_application_sent flag rather than this function.
//
// This exists for the one case that flag cannot serve: a page folding counts
// straight out of a `deals` SELECT, where waiting on a second RPC would mean
// rendering the unfiltered number first and correcting it a moment later — a
// wrong figure on screen, which is the whole class of bug this flag was created
// to end. The Setter Performance funnel is that case.
//
// It is SAFE to mirror precisely because the migration
// (20260917h_phantom_flag_is_immutable.sql) made the rule depend only on facts
// about how the row was CREATED. Nothing a processor does can change the
// answer, so the two implementations cannot disagree over time — only over a
// deliberate edit. If you change the rule, change it in BOTH, and the SQL one
// goes first. Do not write a third copy: import this one.
//
// AND THE MIRROR CHECKS ITSELF. Wherever the canonical flag is available beside
// this function's verdict, compare them and show the disagreement — see
// phantomDivergence() below and its one live caller on the Setter Performance
// funnel. A mirror that hopes is how nine copies of the document-name rule
// drifted, one of them counting the broker disclosure as a returned
// application, with nothing watching to notice.

/** How close to `created_at` a stamp must land to be the creating transaction's
 *  own clock rather than a send. Matches the SQL's 2 s.
 *
 *  MEASURED BOOK-WIDE, 2026-09-18, over all 64 stamps:
 *    · the 4 phantoms land at −15.027 ms … −12.469 ms. NEGATIVE: the stage
 *      trigger stamped them fractionally BEFORE the row it belongs to existed.
 *    · the nearest of the 60 real sends is 23.242 s out.
 *    · real sends inside the 2 s threshold: ZERO.
 *    · stamped deals missing created_at (unclassifiable): ZERO.
 *
 *  So the threshold sits in an empty gap with ~10× headroom to the nearest real
 *  send. Do NOT read that as room to widen it: 23 s is the whole margin, not the
 *  90 s an earlier note claimed by measuring only the created_by-is-null rows. */
const PHANTOM_WINDOW_MS = 2_000;

/** The three creation facts the rule is made of. Any row carrying them fits —
 *  a deal row, a query projection, a queue row. */
export interface PhantomSendInputs {
  application_sent_at: string | null;
  created_at: string | null;
  created_by: string | null;
}

/**
 * True when `application_sent_at` was stamped by the GHL opportunity mirror
 * during deal creation rather than by a send we made.
 *
 * NEVER claims a phantom on missing evidence: no stamp, no creation time, or an
 * unparseable one all answer FALSE. Over-counting a real send is a wrong number;
 * calling a real send phantom is telling a closer not to chase a live deal.
 */
export function isPhantomApplicationSend(d: PhantomSendInputs): boolean {
  if (!d.application_sent_at || !d.created_at) return false;
  // A human send always carries the sending user; these are service_role writes.
  if (d.created_by != null) return false;
  const sent = Date.parse(d.application_sent_at);
  const created = Date.parse(d.created_at);
  if (!Number.isFinite(sent) || !Number.isFinite(created)) return false;
  return Math.abs(sent - created) <= PHANTOM_WINDOW_MS;
}

/** One deal on which this mirror and the canonical SQL flag disagree. */
export interface PhantomDivergence {
  dealId: string;
  /** Shown to a human, so the deal is identifiable without a lookup. */
  label: string;
  /** What this module said. */
  mirror: boolean;
  /** What public.is_phantom_application_send said, via the server. */
  canonical: boolean;
}

/**
 * THE TRIPWIRE. Compares this mirror's verdict against the canonical
 * `born_at_application_sent` for every deal present in BOTH, and returns the
 * disagreements.
 *
 * A caller MUST render what comes back — visibly, naming the deals. The point
 * is not to log it; it is that the moment the SQL rule is edited and this copy
 * is not (or the reverse), somebody looking at the screen finds out. Silence
 * here is the only failure mode a mirror has, and a console warning is silence.
 *
 * Deals the server did not return are SKIPPED, not counted as agreement and not
 * counted as divergence: absence is unknown (RLS, a slow load, a partial read),
 * and an unknown announced as a contradiction would train people to ignore this.
 *
 * Costs one pass over the rows both sides already hold. No query.
 */
export function phantomDivergence<T extends PhantomSendInputs>(
  rows: T[],
  idOf: (row: T) => string,
  labelOf: (row: T) => string,
  /** deal id → the canonical flag. `null` = not loaded / unreadable → no check. */
  canonicalByDeal: ReadonlyMap<string, { born_at_application_sent: boolean }> | null,
): PhantomDivergence[] {
  if (!canonicalByDeal || canonicalByDeal.size === 0) return [];
  const out: PhantomDivergence[] = [];
  for (const row of rows) {
    const id = idOf(row);
    const canonicalRow = canonicalByDeal.get(id);
    if (!canonicalRow) continue; // unknown, not a contradiction
    const mirror = isPhantomApplicationSend(row);
    if (mirror !== canonicalRow.born_at_application_sent) {
      out.push({ dealId: id, label: labelOf(row), mirror, canonical: canonicalRow.born_at_application_sent });
    }
  }
  return out;
}
