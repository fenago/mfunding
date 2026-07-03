// Loud-by-default Supabase writes.
//
// WHY THIS EXISTS: supabase-js RETURNS errors, it never throws — so a bare
// `await supabase.from(x).update(y)` swallows RLS denials and constraint
// violations, and a try/catch around it catches nothing. Worse, an UPDATE/DELETE
// blocked by RLS comes back as { error: null, data: [] } — success with zero
// rows. These wrappers make every write surface its failure.
//
//   mustWrite  → throws on error OR zero rows affected (use for writes that must
//                succeed; the caller's catch shows the user a real error).
//   tryWrite   → best-effort: returns false + console.warns on failure, never
//                throws (use for nice-to-have telemetry that must not block).
//
// Contract: pass an UNSELECTED builder (e.g. .from(t).update(x).eq("id", id)).
// The wrappers append .select() so the affected rows come back and can be
// asserted. Do not add your own .select()/.single().

type WriteResult<T> = { data: T[] | T | null; error: { message: string } | null };
type Builder<T> = PromiseLike<WriteResult<T>> & { select?: () => PromiseLike<WriteResult<T>> };

export class DbWriteError extends Error {
  constructor(public label: string, public cause: { message: string } | null, public rows = 0) {
    super(
      cause
        ? `${label} failed: ${cause.message}`
        : `${label} affected 0 rows — blocked by RLS or no matching row`,
    );
    this.name = "DbWriteError";
  }
}

function rowsOf<T>(data: T[] | T | null): T[] {
  return Array.isArray(data) ? data : data == null ? [] : [data];
}

/** Await a write; throw DbWriteError on error OR zero affected rows. */
export async function mustWrite<T = unknown>(label: string, builder: Builder<T>): Promise<T[]> {
  const q = typeof builder.select === "function" ? builder.select() : builder;
  const { data, error } = await q;
  if (error) throw new DbWriteError(label, error);
  const rows = rowsOf(data);
  if (rows.length === 0) throw new DbWriteError(label, null, 0);
  return rows;
}

/** Best-effort write: surfaces failures to the console, never throws. Returns
 *  whether it succeeded. For telemetry/logging that must not block the action. */
export async function tryWrite<T = unknown>(label: string, builder: Builder<T>): Promise<boolean> {
  const q = typeof builder.select === "function" ? builder.select() : builder;
  const { error } = await q;
  if (error) {
    // eslint-disable-next-line no-console
    console.warn(`[tryWrite] ${label} failed (non-blocking): ${error.message}`);
    return false;
  }
  return true;
}
