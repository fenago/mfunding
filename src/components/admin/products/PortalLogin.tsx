// ─────────────────────────────────────────────────────────────────────────────
// Portal logins on the product lines page.
//
// The owner asked for the portal link plus the username and password on every
// product line. As of today there is no password to show: the
// `funder_portal_credentials` table holds 27 rows seeded from the funder
// records, and EVERY one of them has a null username and a null secret. So the
// honest job of this component is to render three different things and never
// let them look alike:
//
//   • UNREADABLE — the query failed. Says so, in warning colour. It must never
//     render as "no login", because that is an accusation against ops for a
//     job they may well have done.
//   • NO ROW — nobody has even started capturing a login for this funder.
//     Careful here: RLS on this table returns an EMPTY LIST, not an error, to
//     an account that may not read logins. So a zero result is ambiguous by
//     construction. When the whole page comes back empty — not one row across
//     any funder — the caller sets `allEmpty` and we say out loud that it may
//     be the viewer's permissions rather than an empty table.
//   • A ROW WITH NOTHING IN IT — ops opened the slot and the login was never
//     filled in. Different problem, different person to chase.
//
// The password itself never travels in a SELECT. `secret_id` is a uuid
// pointing into Supabase Vault, and plaintext comes back only from
// `reveal_funder_portal_password()`, a SECURITY DEFINER function that writes an
// audit row BEFORE it returns. This component calls that same function rather
// than carrying a second copy of the rule — and it says on screen that the
// reveal is logged, because a control that is quietly logged is a trap and one
// that is openly logged is a deterrent.
//
// Styling is `fp-` prefixed. The page injects `.fcs` as a raw <style> block,
// which silently outranks every Tailwind utility sharing a class name, so
// nothing here uses `flex`, `grid` or `hidden`.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from "react";
import supabase from "@/supabase";
import type { PortalRef } from "./lines";

export type PortalCredRow = {
  id: string;
  lender_id: string;
  label: string;
  portal_url: string | null;
  username: string | null;
  secret_id: string | null;
  mfa_note: string | null;
  login_note: string | null;
  last_confirmed_on: string | null;
};

/** Loaded state for the whole page's credential fetch. */
export type CredState =
  | { s: "load" }
  | { s: "fail"; why: string }
  | { s: "ok"; rows: PortalCredRow[] };

/** Hide a revealed password again after this long — this page gets left open. */
const REVEAL_SECONDS = 90;

function blank(v: string | null | undefined): boolean {
  return v === null || v === undefined || v.trim() === "";
}

function Reveal({ cred }: { cred: PortalCredRow }) {
  const [shown, setShown] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hasSecret, setHasSecret] = useState(!blank(cred.secret_id));

  useEffect(() => {
    if (shown === null) return;
    const t = window.setTimeout(() => setShown(null), REVEAL_SECONDS * 1000);
    return () => window.clearTimeout(t);
  }, [shown]);

  if (!hasSecret) {
    return <span className="fp-miss">no password captured</span>;
  }

  async function reveal() {
    setBusy(true);
    setErr(null);
    const { data, error } = await supabase.rpc("reveal_funder_portal_password", { p_cred_id: cred.id });
    setBusy(false);
    if (error) {
      setErr(`Could not reveal it — ${error.message}`);
      return;
    }
    // Null means the row exists and no password was ever set. That is not the
    // same as the reveal failing, and it was logged either way.
    if (data === null || data === "") {
      setHasSecret(false);
      setErr("No password has been set for this portal yet. Ask ops to add one.");
      return;
    }
    setShown(String(data));
  }

  if (shown !== null) {
    return (
      <>
        <code className="fp-secret">{shown}</code>
        <button type="button" className="fp-pbtn" onClick={() => setShown(null)}>
          Hide
        </button>
        <span className="fp-phint"> hides itself after {REVEAL_SECONDS} seconds</span>
      </>
    );
  }

  return (
    <>
      <button type="button" className="fp-pbtn" onClick={() => void reveal()} disabled={busy}>
        {busy ? "Revealing…" : "Reveal password"}
      </button>
      {err ? <span className="fp-perr"> {err}</span> : <span className="fp-phint"> recorded against your name</span>}
    </>
  );
}

export function PortalLogin({
  lenderId,
  funderName,
  portal,
  portalNote,
  creds,
  allEmpty,
}: {
  lenderId: string;
  funderName: string;
  portal: PortalRef[];
  portalNote?: string;
  creds: CredState;
  /** True when the page-wide fetch returned nothing for ANY funder. */
  allEmpty: boolean;
}) {
  const rows = creds.s === "ok" ? creds.rows.filter((r) => r.lender_id === lenderId) : [];

  return (
    <>
      <div className="fp-ckgroup">Portal &amp; login</div>

      {portal.length === 0 ? (
        <div className="fp-pline">
          <span className="fp-plk">Portal</span>
          {portalNote ?? "No portal recorded."}
        </div>
      ) : (
        portal.map((p) => (
          <div className="fp-pline" key={p.url}>
            <span className="fp-plk">
              {p.label}
              {p.unverified ? <span className="fp-unver">unverified</span> : null}
            </span>
            <a className="fp-link" href={p.url} target="_blank" rel="noreferrer">
              {p.url}
            </a>
            {p.note ? <div className="fp-pnote">{p.note}</div> : null}
          </div>
        ))
      )}

      <div className="fp-pline">
        <span className="fp-plk">Login</span>
        {creds.s === "load" ? (
          <span style={{ color: "var(--ink-soft)" }}>Reading…</span>
        ) : creds.s === "fail" ? (
          // UNREADABLE is not "none". Saying "no login" here would blame ops
          // for a row they may well have filled in.
          <span className="fp-miss">
            Portal logins could not be read by your account — {creds.why} UNKNOWN, not empty: there may well be one
            on file.
          </span>
        ) : rows.length === 0 ? (
          <span className="fp-miss">
            No login slot has been opened for {funderName} yet
            {lenderId ? "" : " (and no funder record is wired to this card)"}. If you have one, add it on the
            funder record so it is held in the vault rather than in somebody's notes.
            {allEmpty ? (
              <>
                {" "}
                <b>
                  Every funder on this page is reading empty, which can also mean your account is not allowed to
                  see portal logins — ask ops before concluding there are none.
                </b>
              </>
            ) : null}
          </span>
        ) : (
          rows.map((r) => (
            <div key={r.id} style={{ marginTop: 4 }}>
              <b>{r.label}</b>
              {" · "}
              {blank(r.username) ? (
                <span className="fp-miss">no username captured</span>
              ) : (
                <>
                  user <code className="fp-secret">{r.username}</code>
                </>
              )}
              {" · "}
              <Reveal cred={r} />
              {r.mfa_note ? <div className="fp-pnote">MFA: {r.mfa_note}</div> : null}
              {r.last_confirmed_on ? (
                <div className="fp-pnote">Last confirmed working {r.last_confirmed_on}</div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </>
  );
}
