// MerchantLinks — TWO BUTTONS. The merchant's application link, and the link
// they send bank statements to. Nothing else, no menu, no submenu.
//
// ── WHY TWO BUTTONS AND NOT THE SEND-DOCS MENU ──────────────────────────────
// AdHocSendMenu is the right control for the Revenue Playbook, where someone is
// deciding WHAT to send. It is the wrong control everywhere else, because by the
// time a merchant has been worked it offers twelve-plus choices, and the owner's
// own words on seeing it were: "I know that information exists. It's just
// confusing, and it's hard to find. I only care about the merchant funding
// application and the bank statement for a specific merchant."
//
// The confusing part is not the menu's length, it is that THE APPLICATION
// APPEARS UNDER THREE NAMES — '04B MCA PREFILL', '04C MCA PARTIAL' and
// 'MCA_Merchant_Funding_Application' — sitting in a list next to three copies of
// the Broker Compensation Disclosure. A human picking from that list is being
// asked to know our template vocabulary. One merchant signed the disclosure
// believing he had finished his application and then waited.
//
// So this control does the picking. The reader asks for "the application link"
// and gets the one live application, named, with the date on it.
//
// ── THE RESOLUTION RULES, AND WHY THEY ARE SAID OUT LOUD ────────────────────
//   one awaiting signature   → copy it
//   several awaiting         → copy the NEWEST and say which, because the older
//                              copies are still signable and some carry stale
//                              merge data (wrong company name)
//   already signed           → do NOT hand out a signing link. Say when it was
//                              signed and copy the VIEW link instead
//   none sent                → "no application sent yet". Not a dead copy
//   couldn't read            → say so. NEVER "nothing sent" — an empty list from
//                              a read that failed is how a merchant who had
//                              signed was shown everywhere as having signed
//                              nothing, with the owner on the phone to him
//
// Never the Broker Compensation Disclosure, under any of these branches.
//
// ── WHY THE READ HAPPENS ON CLICK ───────────────────────────────────────────
// These buttons are mounted on LIST ROWS, so resolving eagerly would cost one
// ghl-docs-status call per row on every render of a 500-row queue, against a
// 200k/day account cap (see the ghl-standing-consumers-ledger rule: cost must
// track new information, not the size of the book). Resolving on click costs one
// read per actual use and zero when nobody clicks. The button therefore states
// its PURPOSE, not the document's status; the status arrives in the confirmation,
// which is where it is needed anyway — nobody needs to know an application is
// unsigned until they are about to send the link.
//
// The read takes the 60s ghl-docs-status cache (no `refresh`). That function's
// own rule is that refresh is for surfaces where a stale read becomes an
// ACCUSATION; copying a link is not one.
//
// No browser popups (standing owner rule) — the confirmation is inline.
import { useEffect, useRef, useState } from "react";
import { DocumentTextIcon, InboxArrowDownIcon } from "@heroicons/react/24/outline";
import supabase from "../../supabase";
import { getSetting } from "../../services/platformService";
import { readDocsStatus, type GhlDoc, type GhlDocsStatus } from "../../lib/ghlDocs";
import {
  applicationFromDocs,
  copyText,
  copyFailureMessage,
  uploadLinkFor,
  uploadLinkIsAttributed,
  countPendingApplications,
  shortDateET,
} from "../../lib/merchantLinks";

interface Props {
  /** The merchant's GHL contact, when the host already holds it. */
  ghlContactId?: string | null;
  /**
   * Fallback when the host does NOT hold a contact id — most list rows don't,
   * because neither processor_pipeline_rows() nor processor_application_queue()
   * emits one. Given a customer id the control resolves the contact id (and the
   * email) itself, on click.
   *
   * Reading `customers` directly is sound for every role that sees these
   * buttons: the `closer_select_all_customers` policy grants SELECT on all
   * customers to any closer or closer-row holder, and `admin_all_customers`
   * covers ops staff. So an empty result here means the row is genuinely
   * missing, not that RLS filtered it — which is the only reason it's safe to
   * say anything at all when nothing comes back.
   */
  customerId?: string | null;
  merchantEmail?: string | null;
  /** Table rows / drawers: smaller pills. */
  compact?: boolean;
  /**
   * Which edge the confirmation hangs from. It is ~320px wide, so on a control
   * near the left of the screen a right-anchored note runs off the viewport.
   */
  align?: "left" | "right";
  className?: string;
}

/** Roughly how tall the confirmation gets (the fallback-URL variant is the tall
 *  one). Below this much room, it flips above the buttons instead. */
const NOTE_CLEARANCE_PX = 150;

/** The confirmation under the buttons. `fallbackUrl` appears only when the
 *  clipboard refused, so the link can still be copied by hand. */
interface Note {
  tone: "ok" | "warn" | "error";
  text: string;
  fallbackUrl?: string;
}

export default function MerchantLinks({
  ghlContactId,
  customerId,
  merchantEmail,
  compact = false,
  align = "left",
  className = "",
}: Props) {
  const [busy, setBusy] = useState<"app" | "upload" | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [uploadFormUrl, setUploadFormUrl] = useState<string | null>(null);
  const [uploadSettingRead, setUploadSettingRead] = useState(false);
  const [placeAbove, setPlaceAbove] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (noteTimer.current) clearTimeout(noteTimer.current);
    };
  }, []);

  // The upload form URL is one platform setting, not a per-merchant read.
  useEffect(() => {
    let cancelled = false;
    getSetting<{ upload_form_url?: string }>("adhoc_docs", {})
      .then((v) => { if (!cancelled) { setUploadFormUrl(v.upload_form_url ?? null); setUploadSettingRead(true); } })
      .catch(() => { if (!cancelled) setUploadSettingRead(true); });
    return () => { cancelled = true; };
  }, []);

  const flash = (n: Note) => {
    if (!alive.current) return;
    // Flip the confirmation ABOVE the buttons when there isn't room below.
    // These sit on the last row of long queues, where a note anchored downward
    // is simply cut off by the viewport — and an unread confirmation naming the
    // document that was copied is the entire safeguard against handing a
    // merchant a stale application.
    const box = rootRef.current?.getBoundingClientRect();
    setPlaceAbove(!!box && window.innerHeight - box.bottom < NOTE_CLEARANCE_PX);
    setNote(n);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    // A failure leaves the URL on screen to be copied by hand; a "nothing to
    // copy" answer is something to read and act on. Both linger.
    noteTimer.current = setTimeout(() => setNote(null), n.tone === "ok" ? 10000 : 45000);
  };

  /** Copy, then say exactly what landed on the clipboard. */
  const copyAndSay = async (url: string, confirmation: string) => {
    const r = await copyText(url);
    if (r.ok) flash({ tone: "ok", text: confirmation });
    else flash({ tone: "error", text: copyFailureMessage(r.reason), fallbackUrl: url });
  };

  /**
   * The merchant's contact id + email, from the host when it has them and from
   * `customers` when it doesn't.
   *
   * Three outcomes, kept apart on purpose: we HAVE it, we LOOKED AND IT ISN'T
   * THERE, and WE COULDN'T LOOK. Collapsing the last two is how "no application
   * sent yet" gets said about a merchant nobody actually checked.
   */
  type Resolved =
    | { kind: "ok"; contactId: string; email: string | null }
    | { kind: "none" }
    | { kind: "unreadable"; why: string };

  const resolveMerchant = async (): Promise<Resolved> => {
    if (ghlContactId) return { kind: "ok", contactId: ghlContactId, email: merchantEmail ?? null };
    if (!customerId) return { kind: "none" };
    const { data, error } = await supabase
      .from("customers")
      .select("ghl_contact_id, email")
      .eq("id", customerId)
      .maybeSingle();
    if (error) return { kind: "unreadable", why: error.message };
    const id = (data?.ghl_contact_id as string | null) ?? null;
    if (!id) return { kind: "none" };
    return { kind: "ok", contactId: id, email: (data?.email as string | null) ?? merchantEmail ?? null };
  };

  // ── 📄 THE APPLICATION ────────────────────────────────────────────────────
  const copyApplication = async () => {
    if (busy) return;
    setNote(null);
    setBusy("app");
    try {
      const who = await resolveMerchant();
      if (who.kind === "unreadable") {
        flash({ tone: "warn", text: `Couldn't look this merchant up — ${who.why}. Nothing was checked, so this says nothing about whether an application was sent.` });
        return;
      }
      if (who.kind === "none") {
        flash({
          tone: "warn",
          text: "This merchant isn't linked to a VibeReach contact, so no application could have been sent to them yet.",
        });
        return;
      }
      const { data, error } = await supabase.functions.invoke("ghl-docs-status", {
        body: { ghl_contact_id: who.contactId },
      });
      const state = readDocsStatus(data as GhlDocsStatus, error);
      if (state.kind === "unreadable") {
        // UNREADABLE IS NOT "NOTHING SENT".
        flash({
          tone: "warn",
          text: `Couldn't check VibeReach — ${state.why}. This is not an empty merchant, it's an unreadable one: an application may well be sitting with them. Check VibeReach before sending another.`,
        });
        return;
      }

      const docs: GhlDoc[] = state.docs;
      const app = applicationFromDocs(docs, true, state.caveat !== null);
      const partial = state.caveat ? ` (only part of their contacts could be searched — ${state.caveat})` : "";

      if (app.state === "unknown") {
        flash({ tone: "warn", text: `Couldn't establish whether an application was sent${partial}. This does not mean none was.` });
        return;
      }
      if (app.state === "none") {
        flash({
          tone: "warn",
          text: `No application sent yet — there's nothing to copy until one goes out${partial}. Send it from "Send docs" in the playbook, then come back.`,
        });
        return;
      }

      const doc = app.signable;
      const name = app.name ?? "their application";
      const when = shortDateET(doc?.ghlDoc?.updatedAt ?? null);
      const url = doc?.url ?? null;
      if (!url) {
        flash({
          tone: "warn",
          text: `Their application (${name}) exists in VibeReach but has no link for this recipient, so there's nothing to copy. Open the contact in VibeReach.`,
        });
        return;
      }

      if (app.state === "signed") {
        // Don't hand out a signing link for something already signed — that
        // invites a second signature on a document that is already done.
        await copyAndSay(
          url,
          `✓ Already signed${when ? ` ${when}` : ""} — ${name}. Copied the VIEW link, not a new signature.`,
        );
        return;
      }

      // Pending. Several application-family documents can be live at once (every
      // re-send mints a new one and never voids the old), and the older copies
      // can carry stale merge data — so name the one that was copied.
      const pending = countPendingApplications(docs);
      const extra = pending > 1 ? ` — ${pending} were awaiting signature, copied the newest` : "";
      await copyAndSay(
        url,
        `📄 Copied ${name}${when ? `, sent ${when}` : ""}${extra}. They open it and sign — no login.`,
      );
    } catch (e) {
      flash({ tone: "warn", text: `Couldn't check VibeReach — ${e instanceof Error ? e.message : String(e)}. This does not mean nothing was sent.` });
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  // ── 📤 BANK STATEMENTS & DOCUMENTS ────────────────────────────────────────
  const copyUpload = async () => {
    if (busy) return;
    setNote(null);
    if (!uploadSettingRead) return;
    if (!uploadFormUrl) {
      flash({ tone: "warn", text: "No upload form is configured — set upload_form_url in the adhoc_docs platform setting." });
      return;
    }
    setBusy("upload");
    try {
      // Prefer an email the host handed us; otherwise take the one on the
      // customer row. The prefill is the whole value of this link — without it
      // the files arrive attached to nobody.
      let email = merchantEmail ?? null;
      if (!uploadLinkIsAttributed(email) && customerId) {
        const who = await resolveMerchant();
        if (who.kind === "ok") email = who.email;
      }
      await copyAndSay(
        uploadLinkFor(uploadFormUrl, email),
        uploadLinkIsAttributed(email)
          ? "📤 Copied their bank-statement upload link — text it; their files land on this contact automatically."
          : "📤 Copied the upload link — but there's no email on file, so it can't be prefilled and their files will arrive unattached.",
      );
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  const btn = compact
    ? "inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-semibold px-2 py-1 rounded-full border transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    : "inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  // SHORTER WORDS ON A NARROW CARD, NOT A DIFFERENT CONTROL. The My Day cards
  // are ~180px of usable width and the full labels ran straight over the grade
  // chip and the transfer buttons — unreadable, reported live 2026-09-30. The
  // shape stays identical everywhere (two buttons, same order, same icons, same
  // behaviour); only the label length responds to the space. The full sentence
  // is still on the tooltip, so nothing is lost.
  const appLabel = compact ? "Application" : "Copy application link";
  const upLabel = compact ? "Bank statements" : "Copy bank statement link";
  const appCls = "border-ocean-blue/50 text-ocean-blue hover:bg-ocean-blue/5 dark:hover:bg-ocean-blue/10";
  const upCls =
    "border-emerald-500/50 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20";

  const toneCls =
    note?.tone === "ok"
      ? "text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-800"
      : note?.tone === "warn"
        ? "text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 border-amber-200 dark:border-amber-800"
        : "text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800";

  return (
    <div ref={rootRef} className={`relative inline-flex items-center gap-1.5 ${className}`} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => void copyApplication()}
        title="Copies this merchant's own application link — the one that's actually live. They open it and sign with no login."
        className={`${btn} ${appCls}`}
      >
        <DocumentTextIcon className="w-3.5 h-3.5" />
        {busy === "app" ? "Finding it…" : appLabel}
      </button>

      <button
        type="button"
        disabled={busy !== null || !uploadSettingRead}
        onClick={() => void copyUpload()}
        title="Copies their secure upload link (bank statements, ID, voided check), prefilled with their email so the files attach to this merchant"
        className={`${btn} ${upCls}`}
      >
        <InboxArrowDownIcon className="w-3.5 h-3.5" />
        {busy === "upload" ? "Copying…" : upLabel}
      </button>

      {note && (
        <div
          className={`absolute ${align === "right" ? "right-0" : "left-0"} ${placeAbove ? "bottom-full mb-1" : "top-full mt-1"} w-80 text-[11px] z-40 rounded-md px-2 py-1.5 border shadow-lg ${toneCls}`}
        >
          <p className="leading-snug">{note.text}</p>
          {/* The clipboard refused (insecure origin, unfocused document, denied
              permission). Never a silent no-op: the URL goes on screen,
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
          <button
            type="button"
            onClick={() => setNote(null)}
            className="mt-1 text-[10px] font-semibold opacity-70 hover:opacity-100 hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
