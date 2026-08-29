import { useCallback, useEffect, useState } from "react";
import { PencilSquareIcon } from "@heroicons/react/24/outline";
import supabase from "../../../supabase";
import {
  addDealNote,
  syncDealNoteToGhl,
  isHumanNoteSubject,
  CLOSER_NOTE_SUBJECT,
} from "../../../services/dealService";
import { dateTimeET } from "../../../utils/time";
import type { DealWithCustomer } from "../../../types/deals";

/**
 * SetterNotes — quick notes tied to the deal for the setter Operations console.
 * Same note mechanism the Revenue Playbook uses (nothing new invented):
 *
 *   · READ  — activity_log rows scoped to the merchant (entity_type='customer',
 *             entity_id=customer id), filtered to HUMAN notes via isHumanNoteSubject.
 *   · WRITE — addDealNote: activity_log first (author-stamped), then a best-effort
 *             GHL contact-note sync; a per-note sync indicator offers a quiet retry
 *             via syncDealNoteToGhl.
 *
 * The load path distinguishes UNREADABLE from empty: a failed fetch shows a red
 * "couldn't load notes", never a silent empty list. Add is a two-step inline
 * confirm — the owner's rule is no browser popups.
 */

interface NoteRow {
  id: string;
  subject: string | null;
  content: string | null;
  created_at: string;
  author: string | null;
}

function noteKind(subject: string | null): string | null {
  if (!subject || subject === CLOSER_NOTE_SUBJECT) return null;
  if (subject.startsWith("Playbook · ")) return `Step: ${subject.slice("Playbook · ".length)}`;
  return subject; // 'Deal closed · …'
}

const ARM_MS = 5000;

export default function SetterNotes({
  deal,
  onRefresh,
}: {
  deal: DealWithCustomer;
  onRefresh: () => void;
}) {
  // entity_id for a deal note is the CUSTOMER id. deal.customer_id is always present
  // even when the (RLS-masked) customer projection isn't.
  const customerId = deal.customer?.id ?? deal.customer_id ?? null;

  const [notes, setNotes] = useState<NoteRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [armed, setArmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // GHL sync state for notes added THIS session, keyed by note id.
  const [sync, setSync] = useState<
    Record<string, { synced: boolean; noContact?: boolean; retrying?: boolean; error?: string }>
  >({});

  const load = useCallback(async () => {
    if (!customerId) {
      setNotes([]);
      setLoadError(null);
      return;
    }
    const { data, error } = await supabase
      .from("activity_log")
      .select("id, subject, content, interaction_type, created_at, profiles:logged_by(first_name,last_name)")
      .eq("entity_type", "customer")
      .eq("entity_id", customerId)
      .order("created_at", { ascending: false });

    // UNREADABLE must never read as empty — surface it loudly.
    if (error) {
      console.error("SetterNotes: failed to load notes:", error);
      setLoadError("Couldn't load notes — this is a read failure, not an empty history. Retry below.");
      setNotes(null);
      return;
    }
    setLoadError(null);
    const rows = ((data ?? []) as unknown as Array<Record<string, any>>) // eslint-disable-line @typescript-eslint/no-explicit-any
      .filter((r) => isHumanNoteSubject(r.subject))
      .map((r) => ({
        id: r.id as string,
        subject: r.subject as string | null,
        content: r.content as string | null,
        created_at: r.created_at as string,
        author: r.profiles
          ? `${r.profiles.first_name ?? ""} ${r.profiles.last_name ?? ""}`.trim() || null
          : null,
      }));
    setNotes(rows);
  }, [customerId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Armed save disarms itself so a stray first tap can't be completed later.
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), ARM_MS);
    return () => clearTimeout(t);
  }, [armed]);

  const save = async () => {
    const content = text.trim();
    if (!content || !customerId) return;
    // Two-step confirm: first tap arms, second fires.
    if (!armed) {
      setSaveError(null);
      setArmed(true);
      return;
    }
    setArmed(false);
    setSaving(true);
    setSaveError(null);
    try {
      const res = await addDealNote({ dealId: deal.id, customerId, content });
      setSync((m) => ({
        ...m,
        [res.noteId]: { synced: res.synced, noContact: res.noContact, error: res.syncError },
      }));
      setText("");
      await load();
      onRefresh();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Couldn't save the note.");
    } finally {
      setSaving(false);
    }
  };

  const retry = async (n: NoteRow) => {
    setSync((m) => ({ ...m, [n.id]: { ...(m[n.id] ?? { synced: false }), retrying: true, error: undefined } }));
    const s = await syncDealNoteToGhl(deal.id, n.content ?? "", n.subject ?? CLOSER_NOTE_SUBJECT);
    setSync((m) => ({ ...m, [n.id]: { synced: s.synced, noContact: s.noContact, error: s.syncError, retrying: false } }));
  };

  const count = notes?.length ?? 0;
  const fieldCls =
    "w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-800 dark:text-gray-100 resize-y focus:outline-none focus:ring-2 focus:ring-ocean-blue";

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-3">
      <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        <PencilSquareIcon className="h-4 w-4" />
        Notes {notes !== null && `(${count})`}
      </h3>

      {/* Add a note */}
      <div>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setSaveError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void save();
            }
          }}
          rows={2}
          placeholder={customerId ? "What happened on this deal…" : "No merchant linked — can't add a note."}
          disabled={!customerId}
          className={`${fieldCls} disabled:opacity-60`}
        />
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="text-[10px] text-gray-400">Saved here + posted to the GHL contact · ⌘/Ctrl+Enter</span>
          <div className="flex items-center gap-2">
            {armed && !saving && (
              <button
                type="button"
                onClick={() => setArmed(false)}
                className="text-[11px] font-semibold px-2 py-1 rounded-full border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
            )}
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || !text.trim() || !customerId}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-full text-white disabled:opacity-50 ${
                armed ? "bg-emerald-600 hover:bg-emerald-700" : "bg-ocean-blue hover:bg-deep-sea"
              }`}
            >
              {saving ? "Saving…" : armed ? "Tap again to save" : "Save note"}
            </button>
          </div>
        </div>
        {saveError && <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{saveError}</p>}
      </div>

      {/* History */}
      <div className="border-t border-gray-100 dark:border-gray-700 pt-2">
        {loadError ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/20 px-2.5 py-2">
            <p className="text-[11px] font-medium text-red-600 dark:text-red-400">{loadError}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="text-[11px] font-semibold px-2 py-0.5 rounded-full border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 flex-shrink-0"
            >
              Retry
            </button>
          </div>
        ) : notes === null ? (
          <p className="text-[11px] text-gray-400 py-2">Loading…</p>
        ) : count === 0 ? (
          <p className="text-[11px] text-gray-400 py-2">No notes yet. Add the first one above.</p>
        ) : (
          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {notes.map((n) => {
              const kind = noteKind(n.subject);
              const s = sync[n.id];
              return (
                <div
                  key={n.id}
                  className="rounded-lg border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 px-2.5 py-1.5"
                >
                  <div className="flex items-center gap-1.5 flex-wrap text-[10px] text-gray-500 dark:text-gray-400">
                    <span className="font-semibold text-gray-700 dark:text-gray-200">{n.author || "Unknown"}</span>
                    <span>· {dateTimeET(n.created_at)}</span>
                    {kind && (
                      <span className="px-1.5 py-0.5 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                        {kind}
                      </span>
                    )}
                    {s?.retrying ? (
                      <span className="text-gray-400">· syncing…</span>
                    ) : s?.synced ? (
                      <span className="text-emerald-600 dark:text-emerald-400">· synced to GHL ✓</span>
                    ) : s?.noContact ? (
                      <span className="text-gray-400" title="This deal has no linked GHL contact yet">
                        · no GHL contact yet
                      </span>
                    ) : s && !s.synced ? (
                      <button
                        type="button"
                        onClick={() => void retry(n)}
                        className="text-amber-600 dark:text-amber-400 hover:underline"
                        title={s.error || "Retry posting this note to the GHL contact"}
                      >
                        · not synced to GHL — retry
                      </button>
                    ) : null}
                  </div>
                  {n.content && (
                    <p className="mt-0.5 text-[12px] text-gray-800 dark:text-gray-100 whitespace-pre-line">
                      {n.content}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
