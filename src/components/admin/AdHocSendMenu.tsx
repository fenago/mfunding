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
  workflow_id: string;
  doc_pattern: string;
  tag?: string;
}

interface Props {
  dealId: string;
  merchantEmail?: string | null;
}

type Busy = string | null; // the in-flight item key

export default function AdHocSendMenu({ dealId, merchantEmail }: Props) {
  const [open, setOpen] = useState(false);
  const [docs, setDocs] = useState<AdhocDocDef[]>([]);
  const [busy, setBusy] = useState<Busy>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getSetting<{ docs?: AdhocDocDef[] }>("adhoc_docs", {}).then((v) => setDocs(v.docs ?? []));
  }, []);

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
    if (!confirm(`Send the ${label} to ${merchantEmail || "the merchant"} now?`)) return;
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
      finish(false, e instanceof Error ? e.message : `Could not send the ${label}.`);
    }
  };

  const sendAdhoc = async (def: AdhocDocDef) => {
    if (!confirm(`Send "${def.label}" to ${merchantEmail || "the merchant"} now?`)) return;
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
      finish(false, e instanceof Error ? e.message : `Could not send ${def.label}.`);
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
          <button type="button" disabled={!!busy} onClick={() => void sendApp("partial")} className={itemCls}>
            {busy === "partial" ? "Sending…" : "⚡ Partial application (04C) — we prefill, they finish"}
          </button>
          <button type="button" disabled={!!busy} onClick={() => void sendApp("blank")} className={itemCls}>
            {busy === "blank" ? "Sending…" : "📨 Blank application — they fill everything"}
          </button>
          <button type="button" disabled={!!busy} onClick={() => void sendApp("prefill")} className={itemCls}>
            {busy === "prefill" ? "Sending…" : "📄 Prefilled application (04B) — needs the form completed"}
          </button>
          {docs.length > 0 && (
            <p className="px-3 py-1 mt-1 text-[10px] uppercase tracking-wide text-gray-400 border-t border-gray-100 dark:border-gray-700">Agreements</p>
          )}
          {docs.map((d) =>
            d.workflow_id ? (
              <button key={d.key} type="button" disabled={!!busy} onClick={() => void sendAdhoc(d)} className={itemCls}>
                {busy === d.key ? "Sending…" : `📝 ${d.label}`}
              </button>
            ) : (
              <div key={d.key} className="px-3 py-1.5 text-[12px] text-gray-400" title="Create the enrollment-only GHL workflow for this document and save its id in the adhoc_docs setting.">
                📝 {d.label} <span className="text-[10px] text-amber-600">· setup needed</span>
              </div>
            ),
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
