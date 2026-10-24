// ─────────────────────────────────────────────────────────────────────────────
// Portal logins and funder documents.
//
// 26 of the 76 funders on this tab submit through a broker portal, and the
// logins lived nowhere — IOU Financial's record still says in plain text
// "[sending-identity credential line removed 2026-10-01 at owner request —
// ask the owner for it]". So people could not log in, and the workaround was
// to message someone.
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
//  • Only ops and super-admin can SET anything here. `username` is an ordinary
//    column, but its UPDATE policy is the same `is_ops_staff OR is_super_admin`
//    test the password RPC raises 42501 on, so the two halves of one login
//    cannot drift apart in who may change them. The editor below is hidden
//    from everyone else as a courtesy, never as the control.
//
// DOCUMENTS: a setter can upload submission guidelines and nothing else, and
// CANNOT read the document list back. That is deliberate — the bucket also
// holds our executed ISO agreements, and six of these files contain the
// owner's SSN. Widening the read would have been worse than it looks:
// `funderDisclosure.canRead()` decides "unreadable" vs "nothing on file" by
// asking whether ANY row is visible, so a partial grant would have made every
// funder report "no documents on file" to a setter. So the panel confirms her
// own upload from local state and says plainly who can see it.
//
// OPENING a document widens nothing either. `storage.objects` carries exactly
// two SELECT policies for this bucket — `ops_all_lender_documents`
// (is_ops_staff) and `processor_select_lender_documents_storage`
// (is_processor) — so `createSignedUrl` is refused for anyone who could not
// already read the bytes. Five accounts in total. The viewer is a convenience
// for them, not a new door; and because the refusal is a real error rather
// than an empty list, it is shown as a refusal and never as "missing file".
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from "react";
import supabase from "@/supabase";
import { clean } from "@/lib/funderDisclosure";
import { CopyMini } from "./parts";
import { mustWrite } from "@/supabase/writes";
import {
  BTN_PRIMARY,
  BTN_QUIET,
  CHIP_NEUTRAL,
  CHIP_WARN,
  ERRTEXT,
  FIELD,
  INK,
  INK_FAINT,
  INK_SOFT,
  KEY,
  LINE,
  NONE,
} from "./ink";

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

function CredRow({
  c,
  canEdit,
  onSaved,
}: {
  c: PortalCred;
  canEdit: boolean;
  onSaved: (patch: Partial<PortalCred> & { id: string }) => void;
}) {
  const [shown, setShown] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [userDraft, setUserDraft] = useState("");
  const [passDraft, setPassDraft] = useState("");
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

  function startEdit() {
    setUserDraft(clean(c.username) ?? "");
    setPassDraft("");
    setErr(null);
    setSaved(null);
    setEditing(true);
  }

  // Username and password travel different routes — a column UPDATE and a
  // Vault RPC — so they are saved independently and reported independently.
  // A single "Saved" after a half-failure is the lie this is avoiding: you
  // would walk away believing a login works when only its username landed.
  async function saveLogin() {
    const u = userDraft.trim();
    const p = passDraft;
    const wantUser = u !== (clean(c.username) ?? "");
    const wantPass = p.trim() !== "";
    if (!wantUser && !wantPass) {
      setEditing(false);
      return;
    }

    setBusy(true);
    setErr(null);
    setSaved(null);
    const done: string[] = [];

    try {
      if (wantUser) {
        // mustWrite, not a bare .update(): an RLS-refused update comes back as
        // {error:null,data:[]} — success with zero rows — and would have told
        // a non-ops user their username saved.
        await mustWrite(
          "Save the portal username",
          supabase.from("funder_portal_credentials").update({ username: u === "" ? null : u }).eq("id", c.id),
        );
        onSaved({ id: c.id, username: u === "" ? null : u });
        done.push(u === "" ? "username cleared" : "username saved");
      }

      if (wantPass) {
        const { error } = await supabase.rpc("set_funder_portal_password", { p_cred_id: c.id, p_password: p });
        if (error) throw new Error(error.message);
        setHasSecret(true);
        done.push("password saved to the vault");
      }

      setPassDraft("");
      setEditing(false);
      setSaved(done.join(" · "));
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      setErr(done.length > 0 ? `${done.join(" · ")} — then it stopped: ${why}` : `Not saved — ${why}`);
    } finally {
      setBusy(false);
    }
  }

  const url = clean(c.portal_url);
  const user = clean(c.username);

  return (
    <div className={`border ${LINE} rounded-[9px] px-[11px] py-[9px] flex flex-col gap-[6px]`}>
      <div className="flex flex-wrap items-baseline gap-[8px]">
        <span className={`text-[12.5px] font-extrabold ${INK}`}>{c.label}</span>
        {c.last_confirmed_on && <span className={CHIP_NEUTRAL}>login confirmed {c.last_confirmed_on}</span>}
        {!user && <span className={CHIP_WARN}>no username</span>}
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
          <div className={`flex flex-col gap-[6px] border-t ${LINE} pt-[8px] mt-[2px]`}>
            <label className="flex flex-wrap items-center gap-[6px]">
              <span className={`text-[11.5px] ${INK_FAINT} min-w-[62px]`}>Username</span>
              <input
                className={`${FIELD} max-w-[280px]`}
                type="text"
                autoComplete="off"
                value={userDraft}
                onChange={(e) => setUserDraft(e.target.value)}
                placeholder="e.g. momentumfunding"
                aria-label={`Username for ${c.label}`}
              />
            </label>
            <label className="flex flex-wrap items-center gap-[6px]">
              <span className={`text-[11.5px] ${INK_FAINT} min-w-[62px]`}>Password</span>
              <input
                className={`${FIELD} max-w-[280px]`}
                type="password"
                autoComplete="new-password"
                value={passDraft}
                onChange={(e) => setPassDraft(e.target.value)}
                placeholder={hasSecret ? "Leave blank to keep the stored one" : "New password"}
                aria-label={`Password for ${c.label}`}
              />
            </label>
            <div className="flex flex-wrap items-center gap-[6px]">
              <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => void saveLogin()}>
                {busy ? "Saving…" : "Save login"}
              </button>
              <button
                type="button"
                className={BTN_QUIET}
                disabled={busy}
                onClick={() => {
                  setEditing(false);
                  setPassDraft("");
                }}
              >
                Cancel
              </button>
              <span className={`text-[10.5px] ${INK_FAINT}`}>
                The password goes straight into the vault — it is never stored on this row.
              </span>
            </div>
          </div>
        ) : (
          <button type="button" className={`${BTN_QUIET} self-start`} onClick={startEdit}>
            {user || hasSecret ? "Edit login" : "Set username and password"}
          </button>
        ))}

      {saved && <div className="text-[12px] font-bold text-[#1f8a5b] dark:text-[#54c68d]">✓ {saved}</div>}
      {err && <div className={ERRTEXT}>{err}</div>}
    </div>
  );
}

/** Ops-only: record a login for a funder that has a portal but no row yet. */
function AddCred({
  lenderId,
  portalUrl,
  onAdded,
}: {
  lenderId: string;
  portalUrl: string | null;
  onAdded: (c: PortalCred) => void;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("Broker portal");
  const [url, setUrl] = useState(portalUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setErr(null);
    try {
      const rows = await mustWrite<PortalCred>(
        "Add a portal login",
        supabase.from("funder_portal_credentials").insert({
          lender_id: lenderId,
          label: label.trim() === "" ? "Broker portal" : label.trim(),
          portal_url: url.trim() === "" ? null : url.trim(),
          login_note: "Added by hand on the Funder Contact tab.",
        }),
      );
      onAdded(rows[0]);
      setOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className={`${BTN_QUIET} self-start mt-[6px]`} onClick={() => setOpen(true)}>
        Add a portal login
      </button>
    );
  }

  return (
    <div className={`border ${LINE} rounded-[9px] px-[11px] py-[9px] flex flex-col gap-[6px] mt-[6px]`}>
      <label className="flex flex-wrap items-center gap-[6px]">
        <span className={`text-[11.5px] ${INK_FAINT} min-w-[62px]`}>Name it</span>
        <input
          className={`${FIELD} max-w-[280px]`}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Broker portal"
          aria-label="What this login is for"
        />
      </label>
      <label className="flex flex-wrap items-center gap-[6px]">
        <span className={`text-[11.5px] ${INK_FAINT} min-w-[62px]`}>Portal</span>
        <input
          className={`${FIELD} max-w-[380px]`}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
          aria-label="Portal URL"
        />
      </label>
      <div className="flex flex-wrap items-center gap-[6px]">
        <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => void create()}>
          {busy ? "Adding…" : "Add it"}
        </button>
        <button type="button" className={BTN_QUIET} disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </button>
        <span className={`text-[10.5px] ${INK_FAINT}`}>Then set the username and password on the row it creates.</span>
      </div>
      {err && <div className={ERRTEXT}>Not added — {err}</div>}
    </div>
  );
}

export function FunderPortalAccess({
  lenderId,
  creds,
  readable,
  canEdit,
  roleUnknown,
  recordedPortalUrl,
  onCredsChanged,
}: {
  lenderId: string;
  creds: PortalCred[];
  readable: boolean;
  canEdit: boolean;
  roleUnknown: boolean;
  /** The portal URL on the funder record, used to prefill a new login row. */
  recordedPortalUrl: string | null;
  onCredsChanged: (next: PortalCred[]) => void;
}) {
  const patch = (p: Partial<PortalCred> & { id: string }) =>
    onCredsChanged(creds.map((c) => (c.id === p.id ? { ...c, ...p } : c)));

  return (
    <div>
      <div className={KEY}>Portal login</div>
      {!readable ? (
        <div className="text-[12px] font-bold text-[#b7791f] dark:text-[#dcab55]">
          Portal logins could not be read by your account. UNKNOWN, not empty — there may well be one on file.
        </div>
      ) : (
        <div className="flex flex-col gap-[8px]">
          {creds.length === 0 ? (
            <div className={NONE}>
              No portal login recorded for this funder.
              {recordedPortalUrl && " A portal URL is on the funder record, though — so there is probably a login to capture."}
            </div>
          ) : (
            creds.map((c) => <CredRow key={c.id} c={c} canEdit={canEdit} onSaved={patch} />)
          )}

          {canEdit && (
            <AddCred
              lenderId={lenderId}
              portalUrl={creds.length === 0 ? recordedPortalUrl : null}
              onAdded={(c) => onCredsChanged([...creds, c])}
            />
          )}

          {roleUnknown && (
            <div className={`text-[11.5px] font-bold text-[#b7791f] dark:text-[#dcab55]`}>
              Your role could not be read, so the login editor is hidden. If you are ops and expected to set one here,
              that is this read failing — not a permission you lack.
            </div>
          )}
          {creds.length > 0 && (
            <div className={`text-[11px] ${INK_FAINT} leading-[1.45]`}>
              Revealing a password is recorded against your name and the time. Nobody is accusing you of anything — it
              means that if one of these logins is ever misused, we can tell what happened instead of guessing.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Documents ────────────────────────────────────────────────────────────────

export type FunderDoc = {
  id: string;
  filename: string;
  document_type: string;
  description: string | null;
  storage_path: string | null;
};

const extOf = (name: string) => (name.split(".").pop() ?? "").toLowerCase();
const IMAGES = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp"]);

/** How long a preview link stays good. Long enough to read a 40-page ISO
 *  agreement; the browser re-requests byte ranges as you scroll a PDF, and a
 *  60-second link dies halfway down the page. */
const SIGNED_SECONDS = 900;

type Signed = { s: "loading" } | { s: "ok"; url: string } | { s: "fail"; why: string };

/** In-page document viewer. Not a browser popup — the owner's rule forbids
 *  confirm/alert/prompt, and this is an overlay we draw ourselves. */
function DocViewer({ doc, onClose }: { doc: FunderDoc; onClose: () => void }) {
  const [link, setLink] = useState<Signed>({ s: "loading" });
  const [dlErr, setDlErr] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!doc.storage_path) {
        setLink({ s: "fail", why: "No storage path is recorded on this row, so there is no file to fetch." });
        return;
      }
      const { data, error } = await supabase.storage
        .from("lender-documents")
        .createSignedUrl(doc.storage_path, SIGNED_SECONDS);
      if (cancelled) return;
      // A refusal here is a PERMISSION answer, not a missing file. Say which.
      if (error || !data?.signedUrl) {
        setLink({
          s: "fail",
          why: `${error?.message ?? "No link came back"}. This bucket is readable only by ops and the processors — if that is not you, the file exists and you cannot open it.`,
        });
        return;
      }
      setLink({ s: "ok", url: data.signedUrl });
    })();
    return () => {
      cancelled = true;
    };
  }, [doc.storage_path]);

  async function download() {
    setDlErr(null);
    if (!doc.storage_path) return;
    const { data, error } = await supabase.storage
      .from("lender-documents")
      .createSignedUrl(doc.storage_path, 120, { download: doc.filename });
    if (error || !data?.signedUrl) {
      setDlErr(`Could not start the download — ${error?.message ?? "no link came back"}.`);
      return;
    }
    window.location.href = data.signedUrl;
  }

  const ext = extOf(doc.filename);
  const isImage = IMAGES.has(ext);
  const isPdf = ext === "pdf";

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-[16px]"
      onClick={onClose}
      role="presentation"
    >
      <div
        className={`bg-white dark:bg-[#0e1a26] border ${LINE} rounded-[12px] shadow-2xl w-full max-w-[980px] h-[min(88vh,900px)] flex flex-col overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={doc.filename}
      >
        <div className={`flex flex-wrap items-center gap-[8px] px-[14px] py-[10px] border-b ${LINE}`}>
          <span className={CHIP_NEUTRAL}>{doc.document_type.replace(/_/g, " ")}</span>
          <span className={`text-[13px] font-extrabold ${INK} break-all flex-1 min-w-[160px]`}>{doc.filename}</span>
          {link.s === "ok" && (
            <a
              className={`${BTN_QUIET} no-underline! text-[#40546b]! dark:text-[#a9b8c8]!`}
              href={link.url}
              target="_blank"
              rel="noreferrer"
            >
              Open in a new tab
            </a>
          )}
          <button type="button" className={BTN_QUIET} onClick={() => void download()}>
            Download
          </button>
          <button type="button" className={BTN_QUIET} onClick={onClose}>
            Close
          </button>
        </div>

        <div className="flex-1 overflow-auto bg-[#f4f7fa] dark:bg-[#0a131c] flex items-start justify-center">
          {link.s === "loading" && <div className={`text-[12.5px] ${INK_SOFT} p-[20px]`}>Fetching a one-time link…</div>}
          {link.s === "fail" && <div className={`${ERRTEXT} p-[20px] leading-[1.5] max-w-[560px]`}>{link.why}</div>}
          {link.s === "ok" &&
            (isPdf ? (
              <iframe src={link.url} title={doc.filename} className="w-full h-full border-0" />
            ) : isImage ? (
              <img src={link.url} alt={doc.filename} className="max-w-full h-auto" />
            ) : (
              <div className={`text-[12.5px] ${INK_SOFT} p-[20px] leading-[1.55] max-w-[560px]`}>
                A <b>.{ext || "file"}</b> does not render in the browser. Use <b>Download</b> above, or open it in a new
                tab and let your machine handle it. Nothing is wrong with the file.
              </div>
            ))}
        </div>

        {dlErr && <div className={`${ERRTEXT} px-[14px] py-[8px]`}>{dlErr}</div>}
        {link.s === "ok" && (
          <div className={`text-[10.5px] ${INK_FAINT} px-[14px] py-[7px] border-t ${LINE}`}>
            This link is yours alone and expires in {Math.round(SIGNED_SECONDS / 60)} minutes. Some of these files carry
            signed terms and personal details — don't forward the link.
          </div>
        )}
      </div>
    </div>
  );
}

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
  const [viewing, setViewing] = useState<FunderDoc | null>(null);
  // Uploads this session. A setter who cannot LIST documents still gets
  // confirmation that the thing she just did worked; anyone who CAN list gets
  // the new file in the list straight away, openable, without a reload.
  const [justAdded, setJustAdded] = useState<FunderDoc[]>([]);

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

      // mustWrite, not a bare .insert(). supabase-js RETURNS errors rather than
      // throwing, AND an RLS-blocked insert comes back as {error:null,data:[]}
      // — success with zero rows. Either way the file would be orphaned in the
      // bucket with no row pointing at it, and the setter would be told it
      // worked.
      const rows = await mustWrite<{ id: string }>(
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

      setJustAdded((x) => [
        {
          id: rows[0].id,
          filename: file.name,
          document_type: "submission_requirements",
          description: null,
          storage_path: path,
        },
        ...x,
      ]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const shown = readable ? [...justAdded, ...docs] : [];

  return (
    <div>
      <div className={KEY}>Their submission guidelines</div>

      {!readable ? (
        <div className={`text-[11.5px] ${INK_FAINT} leading-[1.45] mb-[7px]`}>
          Your account cannot list documents for this funder — this bucket also holds our executed ISO agreements. That
          is a permission limit, <b>not</b> a statement that nothing is on file. Anything you upload here still reaches
          ops and the processors.
        </div>
      ) : shown.length === 0 ? (
        <div className={`${NONE} mb-[7px]`}>Nothing on file.</div>
      ) : (
        <ul className="flex flex-col gap-[3px] mb-[7px] list-none p-0 m-0">
          {shown.map((d) => {
            // Several funders store two files under one name with different
            // bytes, both approved. Say so rather than silently showing one.
            const twins = shown.filter((x) => x.filename === d.filename).length;
            return (
              <li key={d.id} className={`text-[12px] ${INK} flex flex-wrap items-baseline gap-[7px]`}>
                <span className={CHIP_NEUTRAL}>{d.document_type.replace(/_/g, " ")}</span>
                <button
                  type="button"
                  className="font-[inherit] text-[12px] bg-transparent border-0 p-0 cursor-pointer text-[#1d4f85] dark:text-[#6aa6e0] underline underline-offset-2 break-all text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c08a2d]"
                  onClick={() => setViewing(d)}
                  title="Open it here"
                >
                  {d.filename}
                </button>
                {twins > 1 && (
                  <span
                    className={CHIP_WARN}
                    title="Stored more than once under this name, with different contents. Nobody has said which is current."
                  >
                    {twins} copies
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!readable && justAdded.length > 0 && (
        <ul className="flex flex-col gap-[3px] mb-[7px] list-none p-0 m-0">
          {justAdded.map((d) => (
            <li key={d.id} className="text-[12px] font-bold text-[#1f8a5b] dark:text-[#54c68d] break-all">
              ✓ Uploaded {d.filename}
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

      {viewing && <DocViewer doc={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
