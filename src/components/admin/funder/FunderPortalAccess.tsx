// ─────────────────────────────────────────────────────────────────────────────
// Portal logins and funder documents.
//
// 26 of the 76 funders on this tab submit through a broker portal, and the
// logins lived nowhere — IOU Financial's record still says in plain text
// "[sending-identity credential line removed 2026-10-01 at owner request — ask
// the owner for it]". So people could not log in, and the workaround was to
// message someone.
//
// They previously lived in `lenders.notes` and `lenders.submission_notes` as
// plaintext, which is why `@/lib/funderDisclosure` now carries a guard that
// withholds any note that merely LOOKS like it contains a credential. This
// panel is the proper home, and it is built so that the old failure cannot
// repeat:
//
//  • There is no password column. `funder_portal_credentials.secret_id` points
//    at a Supabase Vault secret, so a SELECT on the table — which every setter
//    has — returns a uuid that is useless to the client.
//  • The plaintext comes back only from `reveal_funder_portal_password()`, a
//    SECURITY DEFINER function that writes an audit row BEFORE it returns.
//    Every reveal is attributable. The panel says so on screen, because a
//    control that is quietly logged is a trap and a control that is openly
//    logged is a deterrent.
//  • Only ops and super-admin can SET a password. The server raises 42501 at
//    anyone else; the editor below is hidden from them as a courtesy, never as
//    the control.
//
// DOCUMENTS: a setter can upload submission guidelines and nothing else, and
// CANNOT read the document list back. That is deliberate — the bucket also
// holds our executed ISO agreements. Widening the read would have been worse
// than it looks: `funderDisclosure.canRead()` decides "unreadable" vs "nothing
// on file" by asking whether ANY row is visible, so a partial grant would have
// made every funder report "no documents on file" to a setter. So the panel
// confirms her own upload from local state and says plainly who can see it.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from "react";
import supabase from "@/supabase";
import { clean } from "@/lib/funderDisclosure";
import { CopyMini } from "./parts";
import { mustWrite } from "@/supabase/writes";
import { BTN_QUIET, CHIP_NEUTRAL, CHIP_WARN, ERRTEXT, FIELD, INK, INK_FAINT, KEY, LINE, NONE } from "./ink";

export type PortalCred = {
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

/** Hide a revealed password again after this long, so it does not sit on a shared screen. */
const REVEAL_SECONDS = 90;

function CredRow({ c, canEdit }: { c: PortalCred; canEdit: boolean }) {
  const [shown, setShown] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [hasSecret, setHasSecret] = useState(c.secret_id !== null);

  // Auto-hide. Not security theatre: this page gets left open on a shared
  // desk, and a password that stays on screen until navigation is a password
  // on a screen all afternoon.
  useEffect(() => {
    if (shown === null) return;
    const t = window.setTimeout(() => setShown(null), REVEAL_SECONDS * 1000);
    return () => window.clearTimeout(t);
  }, [shown]);

  async function reveal() {
    setBusy(true);
    setErr(null);
    const { data, error } = await supabase.rpc("reveal_funder_portal_password", { p_cred_id: c.id });
    setBusy(false);
    if (error) {
      setErr(`Could not reveal it — ${error.message}`);
      return;
    }
    // NULL means the row exists but no password has been set. That is not the
    // same as "the reveal failed", and the reveal was logged either way.
    if (data === null || data === "") {
      setErr("No password has been set for this portal yet. Ask ops to add one.");
      setHasSecret(false);
      return;
    }
    setShown(String(data));
  }

  async function savePassword() {
    const v = draft;
    if (v.trim() === "") return;
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc("set_funder_portal_password", { p_cred_id: c.id, p_password: v });
    setBusy(false);
    if (error) {
      setErr(`Not saved — ${error.message}`);
      return;
    }
    setDraft("");
    setEditing(false);
    setHasSecret(true);
  }

  const url = clean(c.portal_url);
  const user = clean(c.username);

  return (
    <div className={`border ${LINE} rounded-[9px] px-[11px] py-[9px] flex flex-col gap-[6px]`}>
      <div className="flex flex-wrap items-baseline gap-[8px]">
        <span className={`text-[12.5px] font-extrabold ${INK}`}>{c.label}</span>
        {c.last_confirmed_on && <span className={CHIP_NEUTRAL}>login confirmed {c.last_confirmed_on}</span>}
        {!hasSecret && <span className={CHIP_WARN}>no password stored</span>}
      </div>

      {url && (
        <div className="flex flex-wrap items-center gap-[6px]">
          <span className={`text-[11.5px] ${INK_FAINT} min-w-[62px]`}>Portal</span>
          <a className="text-[12px] text-[#1d4f85]! dark:text-[#6aa6e0]! break-all" href={url} target="_blank" rel="noreferrer">
            {url}
          </a>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-[6px]">
        <span className={`text-[11.5px] ${INK_FAINT} min-w-[62px]`}>Username</span>
        {user ? (
          <>
            <span className={`text-[12.5px] font-mono ${INK} break-all`}>{user}</span>
            <CopyMini value={user} what="username" />
          </>
        ) : (
          <span className={NONE}>Not recorded.</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-[6px]">
        <span className={`text-[11.5px] ${INK_FAINT} min-w-[62px]`}>Password</span>
        {shown !== null ? (
          <>
            <span className={`text-[12.5px] font-mono ${INK} break-all`}>{shown}</span>
            <CopyMini value={shown} what="portal password" />
            <button type="button" className={BTN_QUIET} onClick={() => setShown(null)}>
              Hide
            </button>
            <span className={`text-[10.5px] ${INK_FAINT}`}>hides itself in {REVEAL_SECONDS}s</span>
          </>
        ) : (
          <>
            <span className={`text-[12.5px] font-mono ${INK_FAINT}`} aria-hidden="true">
              ••••••••••
            </span>
            <button type="button" className={BTN_QUIET} disabled={busy} onClick={() => void reveal()}>
              {busy ? "…" : "Reveal"}
            </button>
          </>
        )}
      </div>

      {clean(c.mfa_note) && (
        <div className={`text-[11.5px] font-bold text-[#b7791f] dark:text-[#dcab55] leading-[1.45]`}>
          Two-factor: {clean(c.mfa_note)}
        </div>
      )}
      {clean(c.login_note) && (
        <div className={`text-[11.5px] ${INK_FAINT} leading-[1.45] whitespace-pre-wrap`}>{clean(c.login_note)}</div>
      )}

      {canEdit &&
        (editing ? (
          <div className="flex flex-wrap items-center gap-[6px]">
            <input
              className={`${FIELD} max-w-[280px]`}
              type="password"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="New password"
              aria-label={`New password for ${c.label}`}
            />
            <button type="button" className={BTN_QUIET} disabled={busy || draft.trim() === ""} onClick={() => void savePassword()}>
              Save
            </button>
            <button type="button" className={BTN_QUIET} onClick={() => { setEditing(false); setDraft(""); }}>
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" className={`${BTN_QUIET} self-start`} onClick={() => setEditing(true)}>
            {hasSecret ? "Change password" : "Set password"}
          </button>
        ))}

      {err && <div className={ERRTEXT}>{err}</div>}
    </div>
  );
}

export function FunderPortalAccess({
  creds,
  readable,
  canEdit,
  roleUnknown,
}: {
  creds: PortalCred[];
  readable: boolean;
  canEdit: boolean;
  roleUnknown: boolean;
}) {
  return (
    <div>
      <div className={KEY}>Portal login</div>
      {!readable ? (
        <div className="text-[12px] font-bold text-[#b7791f] dark:text-[#dcab55]">
          Portal logins could not be read by your account. UNKNOWN, not empty — there may well be one on file.
        </div>
      ) : creds.length === 0 ? (
        <div className={NONE}>No portal login recorded for this funder.</div>
      ) : (
        <div className="flex flex-col gap-[8px]">
          {creds.map((c) => (
            <CredRow key={c.id} c={c} canEdit={canEdit} />
          ))}
          {roleUnknown && (
            <div className={`text-[11.5px] font-bold text-[#b7791f] dark:text-[#dcab55]`}>
              Your role could not be read, so the password editor is hidden. If you are ops and expected to set one
              here, that is this read failing — not a permission you lack.
            </div>
          )}
          <div className={`text-[11px] ${INK_FAINT} leading-[1.45]`}>
            Revealing a password is recorded against your name and the time. Nobody is accusing you of anything — it
            means that if one of these logins is ever misused, we can tell what happened instead of guessing.
          </div>
        </div>
      )}
    </div>
  );
}

// ── Documents ────────────────────────────────────────────────────────────────

export type FunderDoc = { id: string; filename: string; document_type: string; description: string | null };

export function FunderDocs({
  lenderId,
  docs,
  readable,
  me,
}: {
  lenderId: string;
  docs: FunderDoc[];
  readable: boolean;
  me: { id: string; label: string } | null;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Uploads this session, so a setter who cannot LIST documents still gets
  // confirmation that the thing she just did worked.
  const [justAdded, setJustAdded] = useState<string[]>([]);

  async function upload(file: File) {
    setBusy(true);
    setErr(null);
    try {
      // One path convention in this bucket: lender/<lender_id>/<file>.
      // Verified across all 71 existing objects — do not invent a second one.
      const safe = file.name.replace(/[^\w.\-() ]+/g, "_");
      const path = `lender/${lenderId}/${Date.now()}-${safe}`;
      const up = await supabase.storage.from("lender-documents").upload(path, file, { upsert: false });
      if (up.error) throw new Error(up.error.message);

      // mustWrite, not a bare insert. supabase-js RETURNS errors rather than
      // throwing, AND an RLS-blocked insert comes back as {error:null,data:[]}
      // — success with zero rows. Either way the file would be orphaned in the
      // bucket with no row pointing at it, and the setter would be told it
      // worked.
      await mustWrite(
        "File funder submission guidelines",
        supabase.from("lender_documents").insert({
          lender_id: lenderId,
          document_type: "submission_requirements",
          filename: file.name,
          storage_path: path,
          file_size: file.size,
          mime_type: file.type || null,
          status: "pending",
          uploaded_by: me?.id ?? null,
          description: "Submission guidelines supplied by the funder during a validation call.",
        }),
      );

      setJustAdded((x) => [file.name, ...x]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className={KEY}>Their submission guidelines</div>

      {!readable ? (
        <div className={`text-[11.5px] ${INK_FAINT} leading-[1.45] mb-[7px]`}>
          Your account cannot list documents for this funder — this bucket also holds our executed ISO agreements. That
          is a permission limit, <b>not</b> a statement that nothing is on file. Anything you upload here still reaches
          ops and the processors.
        </div>
      ) : docs.length === 0 ? (
        <div className={`${NONE} mb-[7px]`}>Nothing on file.</div>
      ) : (
        <ul className="flex flex-col gap-[3px] mb-[7px] list-none p-0 m-0">
          {docs.map((d) => (
            <li key={d.id} className={`text-[12px] ${INK} flex flex-wrap items-baseline gap-[7px]`}>
              <span className={CHIP_NEUTRAL}>{d.document_type.replace(/_/g, " ")}</span>
              <span className="break-all">{d.filename}</span>
            </li>
          ))}
        </ul>
      )}

      {justAdded.length > 0 && (
        <ul className="flex flex-col gap-[3px] mb-[7px] list-none p-0 m-0">
          {justAdded.map((n) => (
            <li key={n} className="text-[12px] font-bold text-[#1f8a5b] dark:text-[#54c68d] break-all">
              ✓ Uploaded {n}
            </li>
          ))}
        </ul>
      )}

      {me ? (
        <label className={`${BTN_QUIET} inline-block`}>
          {busy ? "Uploading…" : "Upload guidelines"}
          <input
            type="file"
            className="hidden"
            disabled={busy}
            accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.gif"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void upload(f);
            }}
          />
        </label>
      ) : (
        <div className={NONE}>Sign-in not resolved, so an upload could not be attributed. Reload the page.</div>
      )}

      {err && <div className={`${ERRTEXT} mt-[5px]`}>Upload failed — {err}</div>}
    </div>
  );
}
