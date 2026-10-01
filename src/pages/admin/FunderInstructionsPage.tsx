// FunderInstructionsPage — /admin/funder-instructions
//
// The reader that `response_type = 'other'` never had.
//
// THE FAILURE. On 2026-09-17 Scott Villavicencio at Uplyft Capital replied to
// submission MF-2026-0196: "Effective immediately, please send all new deal
// submissions to submissions@uplyftcapital.com. Please stop sending submissions
// to underwriting@uplyftcapital.com, as that inbox is now reserved for internal
// underwriting communication." Our pipeline received it, classified it, and
// wrote down what it meant — then filed it under 'other' and stopped. Twelve
// days later MF-2026-0385 and MF-2026-0366 both went to the retired inbox and
// got silence. The instruction was in the database the whole time.
//
// ── NOTHING ON THIS PAGE APPLIES A CHANGE ───────────────────────────────────
//
// There is no "apply this address for me" button and there must never be one.
// An inbound email saying "send submissions to this new address" is UNTRUSTED
// INPUT, and the package being redirected is the merchant's signed application
// and bank statements — their full financial identity. If the system applied it
// automatically, anyone who could spoof or compromise one reply thread would
// redirect those documents to a mailbox they control, with our own system doing
// the forwarding. There is no safe trusted-sender shortcut either: the attack
// IS a reply inside a known thread from a known domain.
//
// So this page shows the funder's own words and the current recipe destination
// side by side, and a human edits the recipe on the funder's page. The only
// thing it writes is `status` on funder_directives.
//
// ── AND "APPLIED" IS VERIFIED, NOT ASSERTED ─────────────────────────────────
//
// Marking an address change applied re-reads the live destination first
// (funder_submission_profiles.to_email, else lenders.submission_email — the
// same two-step fallback the submit engine resolves) and REFUSES if it still
// points at the retired inbox. A row that says "applied" while the recipe is
// unchanged is worse than an open one: it looks handled and warns nobody.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ExclamationTriangleIcon, CheckCircleIcon, XCircleIcon,
  ArrowPathIcon, ArrowTopRightOnSquareIcon, ClipboardDocumentIcon,
} from "@heroicons/react/24/outline";
import supabase from "../../supabase";
import { mustWrite } from "@/supabase/writes";
import { useSession } from "../../context/SessionContext";
import { readResult, type Readable } from "@/lib/readable";

type Kind = "submission_email_change" | "use_portal" | "new_required_docs" | "contact_change";
type Status = "open" | "applied" | "dismissed";

interface Directive {
  id: string;
  lender_id: string;
  kind: Kind;
  status: Status;
  summary: string;
  retired_email: string | null;
  new_email: string | null;
  evidence_quote: string;
  matched_phrases: string[] | null;
  from_email: string | null;
  received_at: string | null;
  created_at: string;
  resolved_at: string | null;
  resolution_note: string | null;
  deal_id: string | null;
  /** From the view: the destination submit-to-funders would resolve today. */
  current_destination: string | null;
  /**
   * From the view, COMPUTED not stored. False when the recipe already does what
   * this row asks — a funder onboarding email naming the inbox we already use.
   * 9 of the 12 funders with a detected address instruction are in that state;
   * showing them as outstanding work would make this page three-quarters noise.
   */
  needs_action: boolean;
  /**
   * A LATER address instruction exists from this funder, so this one is
   * history. Shown rather than hidden: Uplyft told us on 2026-08-12 to submit
   * to underwriting@, then retired that inbox on 09-17. Both are real; before
   * this existed the queue offered the dead one back as outstanding work.
   */
  is_superseded: boolean;
  company_name: string | null;
}

const KIND_LABEL: Record<Kind, string> = {
  submission_email_change: "Submission address changed",
  use_portal: "Portal submission requested",
  new_required_docs: "New required documents",
  contact_change: "Contact changed",
};

const KIND_WHAT_TO_DO: Record<Kind, string> = {
  submission_email_change:
    "Open the funder and set the recipe's submission address to what they asked for. Then mark it applied — this page re-reads the live address and will refuse if it has not changed.",
  use_portal:
    "Open the funder and switch the recipe's method to portal (or email_and_portal), with the portal URL and steps filled in.",
  new_required_docs:
    "Open the funder and add the item(s) to the recipe's required stips so the submit gate asks for them.",
  contact_change:
    "Open the funder and update the contact / CC addresses on the recipe.",
};

function fmt(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function FunderInstructionsPage() {
  const { session } = useSession();
  // ⚠ Readable, not an array. This IS a work queue, and an unreadable queue
  // rendered as an empty one tells a human "this funder has asked for nothing"
  // while a retired inbox sits live on the recipe.
  const [rows, setRows] = useState<Readable<Directive[]>>({ kind: "loading" });
  const [showResolved, setShowResolved] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  /** Per-row outcome of the last action — including a REFUSED mark-applied. */
  const [outcome, setOutcome] = useState<Record<string, { ok: boolean; msg: string }>>({});
  /** Live recipe destination per lender, re-read on load and before any apply. */
  const [liveDest, setLiveDest] = useState<Record<string, string | null>>({});
  const [copied, setCopied] = useState<string | null>(null);

  /**
   * Resolve a funder's CURRENT submission destination exactly the way
   * submit-to-funders does: `funder_submission_profiles.to_email` first, then
   * `lenders.submission_email`. Reading it any other way would let this page
   * approve an address the engine does not actually use.
   *
   * Returns `undefined` when the read FAILED — distinct from `null`, which
   * means the funder genuinely has no destination on file.
   */
  const resolveDest = useCallback(async (lenderId: string): Promise<string | null | undefined> => {
    const [prof, lender] = await Promise.all([
      supabase.from("funder_submission_profiles")
        .select("to_email, active").eq("lender_id", lenderId).eq("active", true).maybeSingle(),
      supabase.from("lenders").select("submission_email").eq("id", lenderId).maybeSingle(),
    ]);
    if (prof.error || lender.error) return undefined;
    const recipeTo = (prof.data?.to_email as string | null) || null;
    const fallback = (lender.data?.submission_email as string | null) || null;
    return recipeTo || fallback;
  }, []);

  const load = useCallback(async () => {
    setRows({ kind: "loading" });
    const statuses: Status[] = showResolved ? ["open", "applied", "dismissed"] : ["open"];
    const res = await supabase
      // The VIEW, not the table: it carries current_destination and
      // needs_action, resolved the same way the submit engine resolves them.
      .from("funder_directives_actionable")
      .select(
        "id, lender_id, kind, status, summary, retired_email, new_email, evidence_quote, " +
        "matched_phrases, from_email, received_at, created_at, resolved_at, resolution_note, deal_id, " +
        "current_destination, needs_action, is_superseded, company_name",
      )
      .in("status", statuses)
      .order("needs_action", { ascending: false })
      .order("status", { ascending: true })
      .order("received_at", { ascending: false, nullsFirst: false });
    const r = readResult<Directive[]>(res as never, []);
    setRows(r);
    // The view already resolved the destination the same way the engine does,
    // so the page no longer re-reads it per lender just to display it.
    // resolveDest() stays for markApplied, which must re-read at CLICK time —
    // the whole point there is to check the recipe as it is now, not as it was
    // when the page loaded.
    if (r.kind === "ok") {
      const dests: Record<string, string | null> = {};
      for (const d of r.value) dests[d.lender_id] = d.current_destination;
      setLiveDest(dests);
    }
  }, [showResolved]);

  useEffect(() => { void load(); }, [load]);

  /**
   * Mark a directive applied — only after proving it actually was.
   *
   * For an address change this re-reads the live destination and refuses when
   * it still equals the retired inbox, or when the read fails. "The recipe says
   * what the funder asked for" is a claim this page can check, so it checks it
   * rather than taking the clicker's word.
   */
  async function markApplied(d: Directive) {
    setBusy(d.id);
    setOutcome((o) => { const n = { ...o }; delete n[d.id]; return n; });
    try {
      if (d.kind === "submission_email_change") {
        const dest = await resolveDest(d.lender_id);
        if (dest === undefined) {
          setOutcome((o) => ({ ...o, [d.id]: { ok: false,
            msg: "Refused — could not read this funder's current submission address, so there is nothing to verify against. Try again; do not mark it applied blind." } }));
          return;
        }
        const now = (dest ?? "").trim().toLowerCase();
        if (d.retired_email && now === d.retired_email.trim().toLowerCase()) {
          setOutcome((o) => ({ ...o, [d.id]: { ok: false,
            msg: `Refused — the recipe still sends to ${dest}, the inbox they asked us to stop using. Change it on the funder first; marking this applied now would make the queue say "handled" while every submission still goes to a dead mailbox.` } }));
          return;
        }
        if (d.new_email && now !== d.new_email.trim().toLowerCase()) {
          // Not a refusal: a funder's named address and the address we choose to
          // use can legitimately differ (a rep's inbox, a CC convention). But it
          // is recorded, so "applied" never silently means "applied to something
          // else".
          setNote((n) => ({ ...n, [d.id]: (n[d.id] ? `${n[d.id]} ` : "") + `[destination is ${dest ?? "none"}, funder named ${d.new_email}]` }));
        }
      }
      await mustWrite(
        "funder_directives.markApplied",
        supabase.from("funder_directives")
          .update({
            status: "applied",
            resolved_by: session?.user?.id ?? null,
            resolution_note: note[d.id]?.trim() || null,
          })
          .eq("id", d.id),
      );
      setOutcome((o) => ({ ...o, [d.id]: { ok: true, msg: "Marked applied — the submit-time guard will stop warning on this funder." } }));
      await load();
    } catch (e) {
      setOutcome((o) => ({ ...o, [d.id]: { ok: false, msg: e instanceof Error ? e.message : "Could not update the row" } }));
    } finally {
      setBusy(null);
    }
  }

  /**
   * Dismiss a directive — this is the security-relevant click, because a
   * dismissed row stops warning anybody. A reason is REQUIRED: "a detection
   * nobody can explain was switched off by nobody for no reason" is how a real
   * instruction gets buried a second time.
   */
  async function dismiss(d: Directive) {
    const why = note[d.id]?.trim();
    if (!why) {
      setOutcome((o) => ({ ...o, [d.id]: { ok: false,
        msg: "Say why first. Dismissing stops this warning for good, including at submit time — the next person needs to know whether it was a false detection or a change we chose not to make." } }));
      return;
    }
    setBusy(d.id);
    try {
      await mustWrite(
        "funder_directives.dismiss",
        supabase.from("funder_directives")
          .update({ status: "dismissed", resolved_by: session?.user?.id ?? null, resolution_note: why })
          .eq("id", d.id),
      );
      await load();
    } catch (e) {
      setOutcome((o) => ({ ...o, [d.id]: { ok: false, msg: e instanceof Error ? e.message : "Could not update the row" } }));
    } finally {
      setBusy(null);
    }
  }

  async function reopen(d: Directive) {
    setBusy(d.id);
    try {
      await mustWrite(
        "funder_directives.reopen",
        supabase.from("funder_directives").update({ status: "open" }).eq("id", d.id),
      );
      await load();
    } catch (e) {
      setOutcome((o) => ({ ...o, [d.id]: { ok: false, msg: e instanceof Error ? e.message : "Could not update the row" } }));
    } finally {
      setBusy(null);
    }
  }

  function copy(text: string, id: string) {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 2000);
    });
  }

  const list = rows.kind === "ok" ? rows.value : [];
  const openCount = list.filter((d) => d.status === "open" && d.needs_action).length;
  const satisfiedCount = list.filter((d) => d.status === "open" && !d.needs_action).length;

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-start justify-between gap-4 mb-1">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Funder instructions</h1>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            <input type="checkbox" className="rounded" checked={showResolved}
              onChange={(e) => setShowResolved(e.target.checked)} />
            Show resolved
          </label>
          <button type="button" onClick={() => void load()}
            className="inline-flex items-center gap-1 text-xs font-medium text-ocean-blue hover:underline">
            <ArrowPathIcon className="w-4 h-4" /> Refresh
          </button>
        </div>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-5 max-w-3xl">
        Replies where a funder told us to change <em>how we submit</em> — a new submissions inbox,
        a retired one, a move to their portal, newly required documents, a changed contact.
        <strong className="text-gray-700 dark:text-gray-300"> Nothing here is applied automatically.</strong>{" "}
        An inbound email asking us to redirect submissions is untrusted input, and the package
        carries the merchant's signed application and bank statements — so a person reads the
        funder's own words, changes the recipe, and marks it applied here.
      </p>

      {/* THREE STATES. A failed read must never render as an empty queue. */}
      {rows.kind === "loading" && (
        <p className="text-sm text-gray-400">Loading…</p>
      )}

      {rows.kind === "unreadable" && (
        <div className="rounded-lg border-2 border-rose-500 bg-rose-50 dark:bg-rose-900/30 p-4">
          <p className="font-bold text-rose-800 dark:text-rose-200">
            ⚠ Could not read the instruction queue — this is NOT "nothing to do"
          </p>
          <p className="mt-1 text-sm text-rose-700 dark:text-rose-300">
            {rows.why}. A funder may have asked us to change where submissions go and this page
            cannot tell you. Do not treat an empty screen as an all-clear.
          </p>
        </div>
      )}

      {rows.kind === "ok" && openCount === 0 && !showResolved && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 p-4">
          <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
            Nothing needs doing. The queue was read successfully.
          </p>
          {satisfiedCount > 0 && (
            <p className="mt-1 text-[12px] text-emerald-700 dark:text-emerald-300">
              {satisfiedCount} instruction{satisfiedCount === 1 ? " is" : "s are"} on file and already
              satisfied by the current recipe — listed below for the record, not as work.
            </p>
          )}
        </div>
      )}

      <div className="space-y-4 mt-4">
        {list.map((d) => {
          const name = d.company_name ?? "Funder";
          const dest = Object.prototype.hasOwnProperty.call(liveDest, d.lender_id)
            ? liveDest[d.lender_id] : undefined;
          const stillRetired = !!d.retired_email && !!dest &&
            dest.trim().toLowerCase() === d.retired_email.trim().toLowerCase();
          const o = outcome[d.id];
          const isOpen = d.status === "open";

          return (
            <div key={d.id}
              className={`rounded-xl border-2 bg-white dark:bg-gray-800 p-4 ${
                stillRetired ? "border-rose-400"
                  : isOpen && d.needs_action ? "border-amber-300"
                  : "border-gray-200 dark:border-gray-700"
              }`}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-900 dark:text-white">{name}</span>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                      {KIND_LABEL[d.kind] ?? d.kind}
                    </span>
                    {!isOpen && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                        {d.status} {d.resolved_at ? `· ${fmt(d.resolved_at)}` : ""}
                      </span>
                    )}
                    {/* Open but already complied with. Shown, not hidden — it is
                        evidence, and it becomes work again the moment someone
                        edits the recipe away from it. Just not counted as work. */}
                    {isOpen && !d.needs_action && (
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        d.is_superseded
                          ? "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"
                          : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                      }`}>
                        {d.is_superseded
                          ? "superseded — this funder sent a later address"
                          : "already satisfied — recipe matches"}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-gray-700 dark:text-gray-200">{d.summary}</p>
                  <p className="mt-0.5 text-[11px] text-gray-400">
                    Received {fmt(d.received_at)}{d.from_email ? ` from ${d.from_email}` : ""}
                  </p>
                </div>
                <Link to={`/admin/lenders/${d.lender_id}`}
                  className="inline-flex items-center gap-1 text-xs font-medium text-ocean-blue hover:underline whitespace-nowrap">
                  Open funder <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" />
                </Link>
              </div>

              {/* THE FUNDER'S OWN WORDS. A submission destination changes on the
                  strength of this, never on the strength of our summary. */}
              <blockquote className="mt-3 rounded-md border-l-4 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900/40 px-3 py-2 text-[13px] italic text-gray-800 dark:text-gray-200">
                “{d.evidence_quote}”
              </blockquote>
              {(d.matched_phrases?.length ?? 0) > 0 && (
                <p className="mt-1 text-[10px] text-gray-400">
                  Detected by rule on: {d.matched_phrases!.join(", ")} — if that looks wrong, this is a false
                  detection; dismiss it with that as the reason.
                </p>
              )}

              {/* What the engine will actually do today vs what they asked for. */}
              {d.kind === "submission_email_change" && (
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[12px]">
                  <div className="rounded-md border border-gray-200 dark:border-gray-700 px-2.5 py-2">
                    <p className="text-gray-400 text-[10px] uppercase tracking-wide">Recipe sends to now</p>
                    {dest === undefined ? (
                      <p className="font-semibold text-rose-700 dark:text-rose-300">
                        ⚠ could not read — not "none"
                      </p>
                    ) : (
                      <p className={`font-mono font-semibold ${stillRetired ? "text-rose-700 dark:text-rose-300" : "text-gray-900 dark:text-white"}`}>
                        {dest ?? "— no address on file —"}
                        {stillRetired && <span className="ml-1 font-sans text-[11px]">← the retired inbox</span>}
                      </p>
                    )}
                  </div>
                  <div className="rounded-md border border-gray-200 dark:border-gray-700 px-2.5 py-2">
                    <p className="text-gray-400 text-[10px] uppercase tracking-wide">They asked for</p>
                    <p className="font-mono font-semibold text-gray-900 dark:text-white flex items-center gap-1.5">
                      {d.new_email ?? "— not stated —"}
                      {d.new_email && (
                        <button type="button" onClick={() => copy(d.new_email!, d.id)}
                          title="Copy" className="text-gray-400 hover:text-ocean-blue">
                          <ClipboardDocumentIcon className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {copied === d.id && <span className="font-sans text-[10px] text-emerald-600">copied</span>}
                    </p>
                    {d.retired_email && (
                      <p className="mt-0.5 text-[11px] text-gray-500">
                        stop using <span className="font-mono">{d.retired_email}</span>
                      </p>
                    )}
                  </div>
                </div>
              )}

              <p className="mt-3 text-[12px] text-gray-600 dark:text-gray-300">
                <strong>What a person has to do:</strong> {KIND_WHAT_TO_DO[d.kind]}
              </p>

              {o && (
                <p className={`mt-2 text-[12px] font-medium ${o.ok ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300"}`}>
                  {o.ok ? "✓ " : "⛔ "}{o.msg}
                </p>
              )}

              {isOpen ? (
                <div className="mt-3 space-y-2">
                  <input
                    type="text"
                    value={note[d.id] ?? ""}
                    onChange={(e) => setNote((n) => ({ ...n, [d.id]: e.target.value }))}
                    placeholder="Note — required to dismiss, optional to mark applied"
                    className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1.5 text-[12px] text-gray-900 dark:text-white"
                  />
                  <div className="flex items-center gap-2 flex-wrap">
                    <button type="button" disabled={busy === d.id} onClick={() => void markApplied(d)}
                      className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                      <CheckCircleIcon className="w-4 h-4" /> I changed the recipe — mark applied
                    </button>
                    <button type="button" disabled={busy === d.id} onClick={() => void dismiss(d)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50">
                      <XCircleIcon className="w-4 h-4" /> Dismiss
                    </button>
                    {d.deal_id && (
                      <Link to={`/admin/deals/${d.deal_id}`} className="text-xs text-ocean-blue hover:underline">
                        the deal it arrived on
                      </Link>
                    )}
                  </div>
                </div>
              ) : (
                <div className="mt-3 flex items-center gap-3 flex-wrap">
                  {d.resolution_note && (
                    <p className="text-[12px] text-gray-500 dark:text-gray-400">“{d.resolution_note}”</p>
                  )}
                  <button type="button" disabled={busy === d.id} onClick={() => void reopen(d)}
                    className="text-xs font-medium text-ocean-blue hover:underline disabled:opacity-50">
                    Re-open
                  </button>
                </div>
              )}

              {stillRetired && isOpen && (
                <p className="mt-3 inline-flex items-start gap-1.5 text-[12px] font-semibold text-rose-700 dark:text-rose-300">
                  <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  Submissions to {name} are BLOCKED at send until the recipe stops pointing at {d.retired_email}.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
