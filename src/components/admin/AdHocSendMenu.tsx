// AdHocSendMenu — "📨 Send docs" on the deal context bar: the closer picks a
// document and it goes out RIGHT NOW, at any stage. Two families:
//   · the application paths (partial 04C / blank 04) — delivered by the existing
//     push-application-to-ghl machinery, resend:true so "send anytime" re-fires;
//     (the full-prefill path stays in its modal — it needs the form filled first)
//   · standalone docs from the platform_settings `adhoc_docs` registry (broker
//     agreement / TCPA consent, and whatever gets registered later) — delivered
//     by send-adhoc-doc. An entry without a workflow id shows as "setup needed"
//     instead of vanishing, so the gap is visible, not mysterious.
import { useEffect, useRef, useState } from "react";
import { PaperAirplaneIcon, ChevronDownIcon } from "@heroicons/react/24/outline";
import supabase from "../../supabase";
import { getSetting } from "../../services/platformService";
import { parseEdgeError } from "../../lib/edgeError";

interface AdhocDocDef {
  key: string;
  label: string;
  /** GHL delivery: enrollment-only workflow (send-adhoc-doc). */
  workflow_id?: string;
  doc_pattern?: string;
  /** NATIVE delivery: our own e-sign — send-merchant-document per template id.
   *  Merges against the deal, freezes, lands in the merchant portal + email. */
  native_template_ids?: string[];
  /** Public blank-form link for this doc (textable) — copy affordance in the menu. */
  public_link?: string;
  tag?: string;
}

interface Props {
  dealId: string;
  merchantEmail?: string | null;
  /** GHL contact — enables the "Their signing links" section (per-merchant
   *  bearer links, copyable for texting). */
  ghlContactId?: string | null;
}

type Busy = string | null; // the in-flight item key

/** A sent document's per-merchant signing link (from ghl-docs-status). */
interface SentDocLink { name: string; signed: boolean; url: string | null }

// The shared parseEdgeError digs the server's real message + JSON body out from
// under supabase-js's useless "non-2xx status code". Here we add the one flag
// this menu cares about: email_undeliverable, so the specific dead-email failure
// can be told apart from every other 422 (only IT gets the mint-anyway offer).
async function errorInfo(
  e: unknown,
  fallback: string,
): Promise<{ message: string; undeliverable: boolean }> {
  const { message, body } = await parseEdgeError(e, fallback);
  return { message, undeliverable: body?.email_undeliverable === true };
}

/** The status note under the button. Beyond ok/text it can carry an inline action:
 *  · signingUrl — a "📋 Copy their signing link" tap after any send that minted one
 *  · onMintAnyway — the "📱 email is dead — mint it anyway" retry after an
 *    email-undeliverable failure (armed two-step, like the send items). */
interface NoteState {
  ok: boolean;
  text: string;
  signingUrl?: string | null;
  onMintAnyway?: (() => void) | null;
}

export default function AdHocSendMenu({ dealId, merchantEmail, ghlContactId }: Props) {
  const [open, setOpen] = useState(false);
  const [docs, setDocs] = useState<AdhocDocDef[]>([]);
  const [busy, setBusy] = useState<Busy>(null);
  const [note, setNote] = useState<NoteState | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Two-step inline confirm — NO browser confirm() popups (owner rule). First
  // tap arms the item ("tap again to send"), second tap fires; disarms after 5s.
  const [armed, setArmed] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 5000);
    return () => clearTimeout(t);
  }, [armed]);

  /** Returns true when the item is armed and should FIRE; otherwise arms it. */
  const armOrFire = (key: string): boolean => {
    if (armed === key) { setArmed(null); return true; }
    setArmed(key);
    return false;
  };

  const [uploadFormUrl, setUploadFormUrl] = useState<string | null>(null);
  useEffect(() => {
    getSetting<{ docs?: AdhocDocDef[]; upload_form_url?: string }>("adhoc_docs", {}).then((v) => {
      setDocs(v.docs ?? []);
      setUploadFormUrl(v.upload_form_url ?? null);
    });
  }, []);

  // THIS merchant's signing links — fetched when the menu opens, so "copy the
  // link and text it to them" is one click away from where sends happen.
  const [sentLinks, setSentLinks] = useState<SentDocLink[] | null>(null);
  useEffect(() => {
    if (!open || !ghlContactId) return;
    let cancelled = false;
    setSentLinks(null);
    supabase.functions.invoke("ghl-docs-status", { body: { ghl_contact_id: ghlContactId } })
      .then(({ data }) => {
        if (cancelled || data?.error) { if (!cancelled) setSentLinks([]); return; }
        setSentLinks(((data?.documents ?? []) as SentDocLink[]).filter((d) => d.url));
      })
      .catch(() => { if (!cancelled) setSentLinks([]); });
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

  // Show a note. Notes carrying an inline action (copy-link / mint-anyway) linger
  // longer so the closer has time to tap; plain notes clear in 8s.
  const finish = (n: NoteState) => {
    setBusy(null);
    setNote(n);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    const ttl = n.signingUrl || n.onMintAnyway ? 30000 : 8000;
    noteTimer.current = setTimeout(() => setNote(null), ttl);
  };
  const flash = (ok: boolean, text: string) => finish({ ok, text });

  const sendApp = async (kind: "partial" | "blank" | "prefill", mintAnyway = false) => {
    const label =
      kind === "partial" ? "partial application (04C)"
      : kind === "blank" ? "blank application"
      : "prefilled application (04B)";
    setBusy(kind);
    try {
      // prefill = the function's default mode (no flag); it refuses with a clear
      // 422 if the application form hasn't been completed yet.
      const body: Record<string, unknown> = { dealId, resend: true };
      if (kind !== "prefill") body[kind] = true;
      if (mintAnyway) body.mintAnyway = true;
      const { data, error } = await supabase.functions.invoke("push-application-to-ghl", {
        body,
      });
      if (error) throw error;
      const d = data as { error?: string; signing_url?: string | null } | null;
      if (d?.error) throw new Error(d.error);
      finish({
        ok: true,
        text: `✓ ${label} sent${mintAnyway ? " — email is dead, text them the link" : ""}`,
        signingUrl: d?.signing_url ?? null,
      });
    } catch (e) {
      const { message, undeliverable } = await errorInfo(e, `Could not send the ${label}.`);
      finish({
        ok: false,
        text: message,
        // Offer mint-anyway ONLY for the email-undeliverable failure, and never on a
        // send that was already a mint-anyway attempt (that would loop).
        onMintAnyway: undeliverable && !mintAnyway ? () => void sendApp(kind, true) : null,
      });
    }
  };

  const sendAdhoc = async (def: AdhocDocDef, mintAnyway = false) => {
    setBusy(def.key);
    try {
      const { data, error } = await supabase.functions.invoke("send-adhoc-doc", {
        body: { dealId, docKey: def.key, ...(mintAnyway ? { mintAnyway: true } : {}) },
      });
      if (error) throw error;
      const d = data as { error?: string; verification?: string; signing_url?: string | null } | null;
      if (d?.error) throw new Error(d.error);
      finish({
        ok: true,
        text: d?.verification === "confirmed"
          ? `✓ ${def.label} sent + verified${mintAnyway ? " — email dead, text the link" : ""}`
          : `✓ ${def.label} sent (verify in GHL)${mintAnyway ? " — email dead, text the link" : ""}`,
        signingUrl: d?.signing_url ?? null,
      });
    } catch (e) {
      const { message, undeliverable } = await errorInfo(e, `Could not send ${def.label}.`);
      finish({
        ok: false,
        text: message,
        onMintAnyway: undeliverable && !mintAnyway ? () => void sendAdhoc(def, true) : null,
      });
    }
  };

  const itemCls =
    "w-full text-left px-3 py-1.5 text-[12px] text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <div ref={rootRef} className="relative inline-block" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded border border-ocean-blue/50 text-ocean-blue hover:bg-ocean-blue/5"
        title="Send a document to the merchant right now — any stage"
      >
        <PaperAirplaneIcon className="w-3.5 h-3.5" />
        Send docs
        <ChevronDownIcon className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-72 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-lg py-1">
          <p className="px-3 py-1 text-[10px] uppercase tracking-wide text-gray-400">Application</p>
          {([
            ["partial", "⚡ Partial application (04C) — we prefill, they finish"],
            ["blank", "📨 Blank application — they fill everything"],
            ["prefill", "📄 Prefilled application (04B) — needs the form completed"],
          ] as const).map(([kind, label]) => (
            <button
              key={kind}
              type="button"
              disabled={!!busy}
              onClick={() => { if (armOrFire(kind)) void sendApp(kind); }}
              className={`${itemCls} ${armed === kind ? "bg-amber-50 dark:bg-amber-900/30 font-semibold" : ""}`}
            >
              {busy === kind ? "Sending…" : armed === kind ? `⚠️ Tap again to send to ${merchantEmail || "the merchant"} →` : label}
            </button>
          ))}
          {docs.length > 0 && (
            <p className="px-3 py-1 mt-1 text-[10px] uppercase tracking-wide text-gray-400 border-t border-gray-100 dark:border-gray-700">Agreements</p>
          )}
          {docs.map((d) => (
            <div key={d.key}>
              {d.workflow_id ? (
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => { if (armOrFire(d.key)) void sendAdhoc(d); }}
                  className={`${itemCls} ${armed === d.key ? "bg-amber-50 dark:bg-amber-900/30 font-semibold" : ""}`}
                >
                  {busy === d.key ? "Sending…" : armed === d.key ? `⚠️ Tap again to send to ${merchantEmail || "the merchant"} →` : `📝 ${d.label}`}
                </button>
              ) : (
                <div className="px-3 py-1.5 text-[12px] text-gray-400" title="Create the enrollment-only GHL workflow for this document and save its id in the adhoc_docs setting.">
                  📝 {d.label} <span className="text-[10px] text-amber-600">· setup needed</span>
                </div>
              )}
              {d.public_link && (
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(d.public_link!);
                    flash(true, "📋 Blank form link copied — paste it into a text.");
                  }}
                  className="w-full text-left px-3 pb-1.5 -mt-0.5 text-[11px] text-ocean-blue hover:underline"
                  title="Copies the public blank form link for this document — anyone with the link can fill and sign"
                >
                  📋 Copy blank form link (textable)
                </button>
              )}
            </div>
          ))}

          {/* The document-UPLOAD link — the GHL 'Bank Statements & Documents
              Upload' form, email-prefilled so submissions land on THIS merchant's
              contact. The link keeps working; every submission adds files. */}
          {uploadFormUrl && (
            <>
              <p className="px-3 py-1 mt-1 text-[10px] uppercase tracking-wide text-gray-400 border-t border-gray-100 dark:border-gray-700">
                Document upload
              </p>
              <button
                type="button"
                onClick={() => {
                  const url = merchantEmail
                    ? `${uploadFormUrl}?email=${encodeURIComponent(merchantEmail)}`
                    : uploadFormUrl;
                  void navigator.clipboard.writeText(url);
                  finish({ ok: true, text: "📤 Upload link copied — text it; their files land on this contact automatically." });
                }}
                className={itemCls}
                title="Copies the secure upload-form link (bank statements, ID, voided check) prefilled with their email so uploads attach to this merchant"
              >
                📤 Copy their upload link (statements, ID, voided check)
              </button>
            </>
          )}

          {/* THIS merchant's signing links — every document already sent to them,
              one copy-click from a text message. Bearer links: whoever holds one
              can open + sign that document. */}
          {ghlContactId && (
            <>
              <p className="px-3 py-1 mt-1 text-[10px] uppercase tracking-wide text-gray-400 border-t border-gray-100 dark:border-gray-700">
                Their signing links
              </p>
              {sentLinks === null ? (
                <p className="px-3 py-1.5 text-[11px] text-gray-400">Checking…</p>
              ) : sentLinks.length === 0 ? (
                <p className="px-3 py-1.5 text-[11px] text-gray-400">Nothing sent yet — send a document above and its link appears here.</p>
              ) : (
                sentLinks.map((l, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(l.url!);
                      flash(true, `📋 Copied their "${l.name}" link — paste it into a text.`);
                    }}
                    className={itemCls}
                    title={`Copies this merchant's own link for ${l.name}`}
                  >
                    📋 {l.name} {l.signed ? "· ✓ signed (view link)" : "· awaiting signature"}
                  </button>
                ))
              )}
            </>
          )}
        </div>
      )}

      {note && (
        <div className={`absolute left-0 top-full mt-1 w-72 text-[11px] z-30 rounded-md px-2 py-1 border ${note.ok ? "text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-800" : "text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800"}`}>
          <p>{note.text}</p>

          {/* Success that minted a per-recipient link → one tap to text it. */}
          {note.ok && note.signingUrl && (
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(note.signingUrl!);
                flash(true, "📋 Signing link copied — paste it into a text.");
              }}
              className="mt-1 w-full text-left font-semibold text-ocean-blue hover:underline"
              title="Copies this merchant's own signing link for the document just sent"
            >
              📋 Copy their signing link
            </button>
          )}

          {/* Email-undeliverable failure → don't dead-end. Two-step inline confirm
              (armed pattern, no popups): first tap arms, second mints anyway and
              the resulting success note carries the copy-link affordance above. */}
          {!note.ok && note.onMintAnyway && (
            <button
              type="button"
              disabled={!!busy}
              onClick={() => { if (armOrFire("mint-anyway")) note.onMintAnyway!(); }}
              className={`mt-1 w-full text-left font-semibold text-amber-700 dark:text-amber-300 hover:underline ${armed === "mint-anyway" ? "underline" : ""}`}
              title="Mint the document despite the dead email, so you can text the signing link"
            >
              {busy
                ? "Minting…"
                : armed === "mint-anyway"
                ? "⚠️ Tap again — mint it anyway & get the texting link →"
                : "📱 Their email is dead — mint it anyway and copy the texting link"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
