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

// supabase-js buries the server's JSON error under error.context and surfaces
// only "Edge Function returned a non-2xx status code" — useless to a closer.
// Dig the real message out so a 422 guard ("no business name on file…") is
// SHOWN, not hidden.
async function realError(e: unknown, fallback: string): Promise<string> {
  const ctx = (e as { context?: Response })?.context;
  if (ctx && typeof ctx.clone === "function") {
    try {
      const j = await ctx.clone().json() as { error?: string };
      if (j?.error) return j.error;
    } catch { /* not JSON — fall through */ }
  }
  return e instanceof Error && e.message && !/non-2xx/i.test(e.message) ? e.message : fallback;
}

export default function AdHocSendMenu({ dealId, merchantEmail, ghlContactId }: Props) {
  const [open, setOpen] = useState(false);
  const [docs, setDocs] = useState<AdhocDocDef[]>([]);
  const [busy, setBusy] = useState<Busy>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
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

  useEffect(() => {
    getSetting<{ docs?: AdhocDocDef[] }>("adhoc_docs", {}).then((v) => setDocs(v.docs ?? []));
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

  const finish = (ok: boolean, text: string) => {
    setBusy(null);
    setNote({ ok, text });
    setTimeout(() => setNote(null), 8000);
  };

  const sendApp = async (kind: "partial" | "blank" | "prefill") => {
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
      const { data, error } = await supabase.functions.invoke("push-application-to-ghl", {
        body,
      });
      if (error) throw error;
      const d = data as { error?: string } | null;
      if (d?.error) throw new Error(d.error);
      finish(true, `✓ ${label} sent`);
    } catch (e) {
      finish(false, await realError(e, `Could not send the ${label}.`));
    }
  };

  const sendAdhoc = async (def: AdhocDocDef) => {
    setBusy(def.key);
    try {
      const { data, error } = await supabase.functions.invoke("send-adhoc-doc", {
        body: { dealId, docKey: def.key },
      });
      if (error) throw error;
      const d = data as { error?: string; verification?: string } | null;
      if (d?.error) throw new Error(d.error);
      finish(true, d?.verification === "confirmed" ? `✓ ${def.label} sent + verified` : `✓ ${def.label} sent (verify in GHL)`);
    } catch (e) {
      finish(false, await realError(e, `Could not send ${def.label}.`));
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
                    finish(true, "📋 Blank form link copied — paste it into a text.");
                  }}
                  className="w-full text-left px-3 pb-1.5 -mt-0.5 text-[11px] text-ocean-blue hover:underline"
                  title="Copies the public blank form link for this document — anyone with the link can fill and sign"
                >
                  📋 Copy blank form link (textable)
                </button>
              )}
            </div>
          ))}

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
                      finish(true, `📋 Copied their "${l.name}" link — paste it into a text.`);
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
        <p className={`absolute left-0 top-full mt-1 w-72 text-[11px] z-30 rounded-md px-2 py-1 border ${note.ok ? "text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-800" : "text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800"}`}>
          {note.text}
        </p>
      )}
    </div>
  );
}
