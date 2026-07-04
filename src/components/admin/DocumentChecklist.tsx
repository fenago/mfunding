// Manual document checklist — the CLOSER-CONTROLLED source of truth for which
// docs are collected on a deal. Funder availability (FunderAvailabilityChecklist
// + the recommend-lenders AI) reads deals.doc_checklist to decide "docs on file",
// so this panel is what actually flips funders ready.
//
// WHY MANUAL: auto-typing docs from customer_documents / GHL MISSES things — a
// merchant's Photo ID uploaded to GHL as "image.jpg" in the Stips field is never
// typed 'id', so the system would wrongly say "needs Photo ID". Here the closer
// ticks what they collected. Detection still runs, but ONLY as a HINT next to each
// row ("detected: image.jpg in GHL Stips") — it never auto-writes a checkbox
// (except a one-time pre-seed of the obvious application/bank-statement rows when
// the checklist has never been touched).
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ClipboardDocumentCheckIcon,
  ArrowUpTrayIcon,
} from "@heroicons/react/24/outline";
import supabase from "../../supabase";
import { mustWrite } from "@/supabase/writes";
import type { DealWithCustomer } from "../../types/deals";

// customer_document_type slugs shown as checklist rows, with friendly labels.
// Order = the order a closer collects them.
const DOC_ROWS: { slug: string; label: string }[] = [
  { slug: "application", label: "Signed application" },
  { slug: "bank_statement", label: "Bank statements" },
  { slug: "id", label: "Photo ID / driver's license" },
  { slug: "voided_check", label: "Voided check" },
  { slug: "credit_authorization", label: "Credit authorization" },
  { slug: "business_license", label: "Business license / proof of ownership" },
  { slug: "personal_guarantee", label: "Personal guarantee" },
  { slug: "tax_return", label: "Tax return / financials" },
  { slug: "other", label: "Other / MTD / processing stmts" },
];

type GhlDoc = { name?: string; signed?: boolean };
type GhlUpload = { field: string; files: { name: string }[] };

export default function DocumentChecklist({
  deal,
  onChange,
}: {
  deal: DealWithCustomer;
  onChange?: (next: Record<string, boolean>) => void;
}) {
  // Optimistic local copy of the checklist; reverts on a failed write.
  const [checklist, setChecklist] = useState<Record<string, boolean>>(deal.doc_checklist ?? {});
  const [saving, setSaving] = useState<string | null>(null);
  // slug → human hints of what detection found on record ("signed in GHL", etc.).
  const [hints, setHints] = useState<Record<string, string[]>>({});
  const seededRef = useRef(false);

  // Keep local state in sync if the deal is swapped underneath us.
  useEffect(() => {
    setChecklist(deal.doc_checklist ?? {});
    seededRef.current = false;
  }, [deal.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Detect what's actually on record (customer_documents + the GHL side) to HINT
  // each row — never to auto-tick. One exception: if the checklist has never been
  // touched (empty), pre-seed the obvious application/bank-statement rows once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const found: Record<string, string[]> = {};
      const add = (slug: string, text: string) => {
        (found[slug] ??= []).push(text);
      };

      // App-side customer_documents — already typed to slugs.
      if (deal.customer_id) {
        const { data } = await supabase
          .from("customer_documents")
          .select("document_type")
          .eq("customer_id", deal.customer_id);
        for (const d of (data ?? []) as { document_type: string }[]) {
          if (d.document_type) add(d.document_type, "on record (customer docs)");
        }
      }

      // GHL side — signed contracts + uploaded stip files (best-effort).
      if (deal.ghl_contact_id) {
        try {
          const { data: ghl } = await supabase.functions.invoke("ghl-docs-status", {
            body: { ghl_contact_id: deal.ghl_contact_id },
          });
          for (const doc of (ghl?.documents ?? []) as GhlDoc[]) {
            if (doc.signed && /application/i.test(doc.name ?? "")) add("application", "signed in GHL");
          }
          for (const u of (ghl?.uploads ?? []) as GhlUpload[]) {
            if (!u.files?.length) continue;
            const names = u.files.map((f) => f.name).join(", ");
            const where = `${names} in GHL ${u.field}`;
            if (/bank|statement/i.test(u.field)) add("bank_statement", where);
            else if (/void|check/i.test(u.field)) add("voided_check", where);
            else if (/tax|financ/i.test(u.field)) add("tax_return", where);
            else if (/stip|\bid\b|licen[cs]e|driver|dl\b/i.test(u.field)) add("id", where);
            else {
              // Generic stips field: an image file most likely a Photo ID.
              const img = u.files.find((f) => /\.(jpe?g|png|heic|gif|webp|pdf)$/i.test(f.name));
              if (img) add("id", `${img.name} in GHL ${u.field}`);
              else add("other", where);
            }
          }
        } catch {
          /* best-effort — hints only */
        }
      }

      if (cancelled) return;
      setHints(found);

      // One-time pre-seed of the OBVIOUS rows when the checklist is untouched.
      // Ambiguous rows (id, etc.) stay UNchecked for the closer to confirm.
      const untouched = !deal.doc_checklist || Object.keys(deal.doc_checklist).length === 0;
      if (untouched && !seededRef.current) {
        seededRef.current = true;
        const seed: Record<string, boolean> = {};
        if (found.application?.length) seed.application = true;
        if (found.bank_statement?.length) seed.bank_statement = true;
        if (Object.keys(seed).length) {
          setChecklist(seed);
          onChange?.(seed);
          try {
            await mustWrite(
              "pre-seed doc checklist",
              supabase.from("deals").update({ doc_checklist: seed }).eq("id", deal.id),
            );
          } catch (e) {
            console.warn("[DocumentChecklist] pre-seed failed:", e);
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deal.id, deal.customer_id, deal.ghl_contact_id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggle(slug: string) {
    const next = { ...checklist, [slug]: !checklist[slug] };
    const prev = checklist;
    setChecklist(next); // optimistic
    onChange?.(next);
    setSaving(slug);
    try {
      await mustWrite(
        "update doc checklist",
        supabase.from("deals").update({ doc_checklist: next }).eq("id", deal.id),
      );
    } catch (e) {
      setChecklist(prev); // revert
      onChange?.(prev);
      alert(e instanceof Error ? e.message : "Couldn't save the checklist. Please try again.");
    } finally {
      setSaving(null);
    }
  }

  const collected = DOC_ROWS.filter((r) => checklist[r.slug] === true).length;

  return (
    <details className="mt-4 rounded-lg border border-ocean-blue/40 dark:border-ocean-blue/40 bg-white dark:bg-gray-800" open>
      <summary className="cursor-pointer select-none px-3 py-2 flex items-center gap-2 flex-wrap">
        <ClipboardDocumentCheckIcon className="w-4 h-4 text-ocean-blue" />
        <span className="text-sm font-semibold text-gray-900 dark:text-white">
          Documents on file — tick what you've collected
        </span>
        <span className="text-[11px] font-medium text-ocean-blue">{collected} collected</span>
        <span className="text-[11px] text-gray-400">this drives funder availability</span>
      </summary>

      <div className="px-3 pb-3 space-y-1.5">
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          Files may live in GHL; if you see it there, tick it here. Detection below is a hint only — you decide.
        </p>
        <ul className="space-y-1">
          {DOC_ROWS.map((row) => {
            const on = checklist[row.slug] === true;
            const rowHints = hints[row.slug] ?? [];
            return (
              <li
                key={row.slug}
                className={`rounded-md border px-3 py-2 ${
                  on
                    ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-900/15"
                    : "border-gray-200 dark:border-gray-700"
                }`}
              >
                <div className="flex items-start gap-2 flex-wrap">
                  <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={saving === row.slug}
                      onChange={() => toggle(row.slug)}
                      className="checkbox checkbox-sm checkbox-success"
                    />
                    <span className="text-sm font-medium text-gray-900 dark:text-white">{row.label}</span>
                    {rowHints.length > 0 && (
                      <span className="text-[11px] text-gray-400 truncate">
                        · detected: {rowHints.join("; ")}
                      </span>
                    )}
                  </label>
                  {!on && (
                    <Link
                      to={`/admin/customers/${deal.customer_id}#documents`}
                      className="text-[11px] text-ocean-blue hover:underline inline-flex items-center gap-1 shrink-0"
                      title="Open the merchant's page to upload / review this document"
                    >
                      upload <ArrowUpTrayIcon className="w-3 h-3" />
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </details>
  );
}
