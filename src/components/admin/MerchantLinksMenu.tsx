// MerchantLinksMenu — "🔗 Copy links": the two URLs somebody working a merchant
// texts them, one tap each, wherever that merchant is on screen.
//
//   📄 their application link   → the per-recipient GHL signing link. Opens and
//                                 signs with no login. See src/lib/merchantLinks.ts
//                                 for why this exists when the proposals API
//                                 appears to offer no such thing.
//   📤 their upload link        → the secure upload form, email-prefilled so the
//                                 statements/ID/voided check land on this contact.
//
// The owner asked for this after having to request a link by hand: "I want that
// link to be available to easily be copied to send the application (assuming
// it's a completed application) and to submit bank statements."
//
// ── THE GATE IS THE POINT ("assuming it's a completed application") ─────────
// A copy button that copies nothing is worse than no button, so the application
// entry resolves to FOUR states, never two, and says which one it is:
//
//   signed   → copy the view link, and say it's already signed so nobody
//              re-chases a signature they already have
//   pending  → copy the signing link (the normal case)
//   none     → "no application sent yet" — we looked, there genuinely isn't one
//   unknown  → "couldn't check VibeReach" — WE COULDN'T LOOK. Never rendered as
//              "nothing sent". An empty list from a failed read became a claim
//              about a merchant once already (2026-09-18: a merchant who had
//              signed was shown across the app as having signed nothing, with
//              the owner on the phone to him). The four-state resolution is
//              unifyDocs', not ours.
//
// ── COST ────────────────────────────────────────────────────────────────────
// The doc read fires only when the menu is OPENED, and takes the 60s
// ghl-docs-status cache (no `refresh`). Per that function's own rule, refresh is
// for surfaces where a stale read becomes an ACCUSATION; copying a link is not
// one — the worst a slightly-old list does here is miss a link sent in the last
// minute, and the menu says what it knows rather than asserting a negative.
//
// No browser popups anywhere (standing owner rule) — everything is inline.
import { useEffect, useRef, useState } from "react";
import { LinkIcon, ChevronDownIcon } from "@heroicons/react/24/outline";
import supabase from "../../supabase";
import { getSetting } from "../../services/platformService";
import { readDocsStatus, duplicateContactNote, type GhlDocsStatus } from "../../lib/ghlDocs";
import {
  applicationFromDocs,
  copyText,
  copyFailureMessage,
  uploadLinkFor,
  uploadLinkIsAttributed,
  MERCHANT_PORTAL_URL,
} from "../../lib/merchantLinks";
import type { ApplicationStatus } from "../../utils/signing";

interface Props {
  /** The merchant's GHL contact. No contact = no signing link can exist yet,
   *  and the menu says exactly that rather than showing a dead button. */
  ghlContactId?: string | null;
  merchantEmail?: string | null;
  /** Small pill (table rows, drawers) vs. the default inline button. */
  compact?: boolean;
  /**
   * Which edge the panel hangs from. The panel is ~320px wide, so this is not
   * cosmetic: right-anchored next to a button on the LEFT of the screen pushes
   * the panel off the left edge of the viewport and the application entry
   * becomes unreadable. Left for a button on the left (the setter action rail),
   * right for one on the right (the processor drawer).
   */
  align?: "left" | "right";
  className?: string;
}

/** What the application row currently knows. Mirrors the read's own honesty. */
type AppState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "no-contact" }
  | { kind: "unreadable"; why: string }
  | { kind: "ready"; application: ApplicationStatus; caveat: string | null; contactCount: number };

/** A copy that failed leaves the URL on screen to be selected by hand. */
interface Note {
  ok: boolean;
  text: string;
  /** Shown as selectable text when the clipboard refused us. */
  fallbackUrl?: string;
}

export default function MerchantLinksMenu({
  ghlContactId,
  merchantEmail,
  compact = false,
  align = "left",
  className = "",
}: Props) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const [uploadFormUrl, setUploadFormUrl] = useState<string | null>(null);
  const [uploadSettingRead, setUploadSettingRead] = useState(false);
  const [app, setApp] = useState<AppState>({ kind: "idle" });
  const rootRef = useRef<HTMLDivElement>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (noteTimer.current) clearTimeout(noteTimer.current); }, []);

  // The upload form URL is a platform setting, not a per-merchant read — load it
  // once on mount so the upload entry is instant when the menu opens.
  useEffect(() => {
    let cancelled = false;
    getSetting<{ upload_form_url?: string }>("adhoc_docs", {})
      .then((v) => { if (!cancelled) { setUploadFormUrl(v.upload_form_url ?? null); setUploadSettingRead(true); } })
      .catch(() => { if (!cancelled) setUploadSettingRead(true); });
    return () => { cancelled = true; };
  }, []);

  // The merchant's documents — ON OPEN ONLY, and cached (see the cost note up top).
  useEffect(() => {
    if (!open) return;
    if (!ghlContactId) { setApp({ kind: "no-contact" }); return; }
    let cancelled = false;
    setApp({ kind: "loading" });
    supabase.functions
      .invoke("ghl-docs-status", { body: { ghl_contact_id: ghlContactId } })
      .then(({ data, error }) => {
        if (cancelled) return;
        const state = readDocsStatus(data as GhlDocsStatus, error);
        if (state.kind === "unreadable") { setApp({ kind: "unreadable", why: state.why }); return; }
        setApp({
          kind: "ready",
          // `readable` is true by construction here — readDocsStatus already
          // routed every not-readable shape to the branch above. `partial` still
          // has to travel, because a one-contact read of a three-contact
          // merchant can miss the very document being asked about.
          application: applicationFromDocs(state.docs, true, state.caveat !== null),
          caveat: state.caveat,
          contactCount: state.contactCount,
        });
      })
      .catch((e: unknown) => {
        if (!cancelled) setApp({ kind: "unreadable", why: e instanceof Error ? e.message : String(e) });
      });
    return () => { cancelled = true; };
  }, [open, ghlContactId]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const flash = (n: Note) => {
    setNote(n);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    // A failure leaves the URL on screen to be copied by hand — give that a lot
    // longer than a success anyone can simply repeat.
    noteTimer.current = setTimeout(() => setNote(null), n.fallbackUrl ? 45000 : 8000);
  };

  /** Copy, then say WHAT was copied — or hand back the URL when we couldn't.
   *  Closing the menu is part of the feedback: the note is anchored to the same
   *  corner, so leaving the menu open buries the confirmation under it. */
  const copy = async (url: string, confirmation: string) => {
    setOpen(false);
    const r = await copyText(url);
    if (r.ok) flash({ ok: true, text: confirmation });
    else flash({ ok: false, text: copyFailureMessage(r.reason), fallbackUrl: url });
  };

  const itemCls =
    "w-full text-left px-3 py-1.5 text-[12px] text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed";
  const mutedCls = "px-3 py-1.5 text-[11px] leading-snug text-gray-500 dark:text-gray-400";
  const warnCls = "px-3 py-1.5 text-[11px] leading-snug text-amber-700 dark:text-amber-400";

  return (
    <div ref={rootRef} className={`relative inline-block ${className}`} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Copy this merchant's application link and their document-upload link — ready to paste into a text"
        className={
          compact
            ? "inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full border border-ocean-blue/50 text-ocean-blue hover:bg-ocean-blue/5 dark:hover:bg-ocean-blue/10"
            : "inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded border border-ocean-blue/50 text-ocean-blue hover:bg-ocean-blue/5 dark:hover:bg-ocean-blue/10"
        }
      >
        <LinkIcon className="w-3.5 h-3.5" />
        Copy links
        <ChevronDownIcon className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          className={`absolute z-40 mt-1 w-80 ${align === "right" ? "right-0" : "left-0"} rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-lg py-1`}
        >
          {/* ───────────────── 1. THE APPLICATION LINK ───────────────── */}
          <p className="px-3 py-1 text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
            Application
          </p>

          {app.kind === "loading" && <p className={mutedCls}>Checking VibeReach…</p>}

          {app.kind === "no-contact" && (
            <p className={warnCls}>
              This merchant isn't linked to a VibeReach contact yet, so no application could have been
              sent to them — and there's no signing link to copy.
            </p>
          )}

          {app.kind === "unreadable" && (
            // UNREADABLE ≠ NOTHING SENT. Saying "no application sent" here about
            // a merchant who already signed is the 2026-09-18 failure.
            <p className={warnCls}>
              Couldn't check VibeReach — {app.why}. This does <strong>not</strong> mean no application
              was sent. Check in VibeReach before sending another one.
            </p>
          )}

          {app.kind === "ready" && (
            <>
              {duplicateContactNote(app.contactCount) && (
                <p className={warnCls}>{duplicateContactNote(app.contactCount)}</p>
              )}
              <ApplicationEntry
                application={app.application}
                caveat={app.caveat}
                itemCls={itemCls}
                mutedCls={mutedCls}
                warnCls={warnCls}
                onCopy={copy}
              />
            </>
          )}

          {/* ───────────────── 2. THE UPLOAD LINK ───────────────── */}
          <p className="px-3 py-1 mt-1 text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500 border-t border-gray-100 dark:border-gray-700">
            Bank statements &amp; documents
          </p>
          {!uploadSettingRead ? (
            <p className={mutedCls}>Loading the upload link…</p>
          ) : !uploadFormUrl ? (
            <p className={warnCls}>
              No upload form is configured — set <code>upload_form_url</code> in the{" "}
              <code>adhoc_docs</code> platform setting and it appears here.
            </p>
          ) : (
            <>
              <button
                type="button"
                onClick={() =>
                  void copy(
                    uploadLinkFor(uploadFormUrl, merchantEmail),
                    uploadLinkIsAttributed(merchantEmail)
                      ? "📤 Upload link copied — text it; their files land on this contact automatically."
                      : "📤 Upload link copied — but with no email on file, you'll have to attach their files by hand.",
                  )
                }
                className={itemCls}
                title="Copies the secure upload-form link (bank statements, ID, voided check), prefilled with their email so uploads attach to this merchant"
              >
                📤 Copy their upload link (statements, ID, voided check)
              </button>
              {!uploadLinkIsAttributed(merchantEmail) && (
                <p className={warnCls}>
                  ⚠ No email on file, so the link can't be prefilled — whatever they upload arrives
                  unattached and someone has to file it by hand.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {note && (
        <div
          className={`absolute ${align === "right" ? "right-0" : "left-0"} top-full mt-1 w-80 text-[11px] z-40 rounded-md px-2 py-1 border ${
            note.ok
              ? "text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-800"
              : "text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800"
          }`}
        >
          <p>{note.text}</p>
          {/* The clipboard refused. Never a silent no-op: put the URL on screen,
              selectable, so it can still be copied by hand. */}
          {note.fallbackUrl && (
            <textarea
              readOnly
              rows={3}
              value={note.fallbackUrl}
              onFocus={(e) => e.currentTarget.select()}
              onClick={(e) => e.currentTarget.select()}
              className="mt-1 w-full select-all rounded border border-red-200 dark:border-red-800 bg-white dark:bg-gray-900 px-1.5 py-1 font-mono text-[10px] leading-snug text-gray-800 dark:text-gray-100"
            />
          )}
        </div>
      )}
    </div>
  );
}

/** The application row, one branch per resolved state. Split out so each state
 *  reads as its own sentence instead of a nest of ternaries. */
function ApplicationEntry({
  application,
  caveat,
  itemCls,
  mutedCls,
  warnCls,
  onCopy,
}: {
  application: ApplicationStatus;
  caveat: string | null;
  itemCls: string;
  mutedCls: string;
  warnCls: string;
  onCopy: (url: string, confirmation: string) => void | Promise<void>;
}) {
  const { state, name, signable } = application;

  // `unknown` from unifyDocs means the same thing as our own unreadable branch:
  // we could not establish an answer. It must not read as "nothing sent".
  if (state === "unknown") {
    return (
      <p className={warnCls}>
        Couldn't establish whether an application was sent. This does <strong>not</strong> mean none
        was — check VibeReach.
      </p>
    );
  }

  if (state === "none") {
    return (
      <>
        <p className={mutedCls}>
          <strong>No application sent yet</strong> — there's no link to copy until one goes out. Send
          it from “Send docs”, then come back here.
        </p>
        {caveat && (
          <p className={warnCls}>
            ⚠ Only part of this merchant's contacts could be searched ({caveat}), so “none” here isn't
            proof.
          </p>
        )}
      </>
    );
  }

  // signed / pending. Both are worth copying — one to chase the signature, one
  // to show them what they already signed.
  const signed = state === "signed";
  const url = signable?.url ?? null;

  if (!url) {
    return (
      <p className={warnCls}>
        Their application (<strong>{name ?? "application"}</strong>) is{" "}
        {signed ? "signed" : "out for signature"}, but VibeReach hasn't minted a link for this
        recipient — so there's nothing to copy. Open the contact in VibeReach.
      </p>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() =>
          void onCopy(
            url,
            signed
              ? "📄 Copied the link to their SIGNED application — it opens as a view, not a new signature."
              : "📄 Application link copied — text it; they open and sign it with no login.",
          )
        }
        className={itemCls}
        title={
          signed
            ? `Copies this merchant's own link to ${name ?? "their application"} — already signed, opens read-only`
            : `Copies this merchant's own signing link for ${name ?? "their application"} — no login needed`
        }
      >
        📄 Copy their application link{" "}
        {signed ? (
          <span className="text-emerald-600 dark:text-emerald-400">· ✓ already signed</span>
        ) : (
          <span className="text-amber-600 dark:text-amber-400">· awaiting signature</span>
        )}
      </button>
      <p className={mutedCls}>
        {signed
          ? "They've already signed this one — copy it only if they want to see it again."
          : "One tap for them: the link opens their application and they sign it. No portal account needed."}
      </p>
      {caveat && (
        <p className={warnCls}>
          ⚠ Only part of this merchant's contacts could be searched ({caveat}) — there may be a newer
          application on another contact.
        </p>
      )}
      {/* The portal stays available as a fallback, deliberately UNDER the real
          link: "sign in at my.mfunding.net" is a far weaker text message, and it
          only works at all once customers.user_id is set (the portal invite). */}
      <p className="px-3 pb-1.5 text-[10px] leading-snug text-gray-400 dark:text-gray-500">
        Fallback if the link fails: {MERCHANT_PORTAL_URL} — but only if they've accepted a portal
        invite.
      </p>
    </>
  );
}
