// ─────────────────────────────────────────────────────────────────────────────
// IndustryMatchGate — the control that satisfies a funder's industry-match
// hard stop, and the record of a human having done it.
//
// WHY THIS IS A HARD STOP AND NOT A CHECKBOX. Some funders price the deal off
// the industry WE select in their application. Bitty's own New Applications
// page: "Industry can be the difference between 16% commission and an
// auto-decline", and their worked example is a business with "Excavation" in
// the name filed as "Construction - Residential Remodeler" instead of "Site
// prep contractor" — "Deal gets 1.65 paying 10% instead of 1.55 paying 16%."
// So the pick is a priced term of the deal, and a guess costs six points on a
// file we already paid to originate. The owner's call, 2026-10-30: "this has to
// be a hard stop, a hard check in the process."
//
// ⚠ THE PERCENTAGES ABOVE ARE BACKGROUND FOR YOU, NOT COPY FOR THE SCREEN.
// Bitty's page says 16%; our record of their October 2026 guide caps us at 12%
// (8% on Access); no Bitty file has ever been submitted, so neither has been
// tested against a funded deal. This component renders the notice's FIRST
// sentence — approval impact, no number — on purpose. Do not promote a figure
// into rendered copy: a closer repeats what is on their screen to merchants
// and sub-ISOs. See funderCategoryLists.ts `stakesQuote`.
//
// There is deliberately NO override. The per-funder stip override exists
// because a missing document can honestly follow under separate cover; an
// industry value is typed into THIS application and is either right or it is
// expensive.
//
// The gate is driven by `funder_submission_profiles.requires_industry_match`,
// never by a funder id — so no id appears in this file's logic. Which category
// list we hold (if any) is resolved through ./funderCategoryLists.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  CheckCircleIcon,
  NoSymbolIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import supabase from "@/supabase";
import { mustWrite } from "@/supabase/writes";
import { useSession } from "@/context/SessionContext";
import {
  NAICS_LOOKUP_URL,
  funderCategoryList,
  prohibitedHit,
  suggestCategories,
  tierOf,
  type CategoryTier,
} from "./funderCategoryLists";

/** One confirmed classification — a row of public.deal_industry_classification. */
export interface IndustryClassification {
  deal_id: string;
  lender_id: string;
  naics_code: string;
  naics_title: string;
  activity: string;
  funder_category: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
}

const TIER_CHIP: Record<CategoryTier, string> = {
  preferred: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  standard: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
};

const inputCls =
  "mt-0.5 w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 " +
  "px-2 py-1 text-[12px] text-gray-900 dark:text-white";
const labelCls = "block text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400";

export default function IndustryMatchGate({
  dealId,
  lenderId,
  funderName,
  existing,
  onSaved,
  onClose,
}: {
  dealId: string;
  lenderId: string;
  funderName: string;
  existing: IndustryClassification | null;
  onSaved: (row: IndustryClassification) => void;
  onClose: () => void;
}) {
  const { session } = useSession();
  const list = useMemo(() => funderCategoryList(lenderId), [lenderId]);

  const [activity, setActivity] = useState(existing?.activity ?? "");
  const [naicsCode, setNaicsCode] = useState(existing?.naics_code ?? "");
  const [naicsTitle, setNaicsTitle] = useState(existing?.naics_title ?? "");
  const [category, setCategory] = useState(existing?.funder_category ?? "");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Arm-then-fire (house rule: no browser confirm()/alert()/prompt()). The
  // armed label spells out the attestation, because that is what the second
  // tap is actually agreeing to.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);

  const code = naicsCode.replace(/\D/g, "").slice(0, 6);
  const codeValid = /^\d{6}$/.test(code);
  const barred = list ? prohibitedHit(list, category) : null;
  const tier = list && !barred ? tierOf(list, category) : null;
  const suggestions = useMemo(
    () => (list && showSuggestions ? suggestCategories(list, category) : []),
    [list, category, showSuggestions],
  );

  const complete =
    activity.trim().length > 0 && codeValid && naicsTitle.trim().length > 0 && category.trim().length > 0;
  const canSave = complete && !barred && !saving;

  async function save() {
    const confirmedBy = session?.user?.id ?? null;
    if (!confirmedBy) {
      setError("We can't tell who you are, and this record has to name the person who confirmed it. Sign in again.");
      return;
    }
    if (barred) return;
    const row: IndustryClassification = {
      deal_id: dealId,
      lender_id: lenderId,
      naics_code: code,
      naics_title: naicsTitle.trim(),
      activity: activity.trim(),
      funder_category: category.trim(),
      confirmed_by: confirmedBy,
      confirmed_at: new Date().toISOString(),
    };
    setSaving(true);
    setError(null);
    try {
      // Re-confirming is a NEW attestation, so confirmed_by/confirmed_at are
      // re-stamped rather than preserved — the row says who vouched for the
      // value that is there now, not who vouched for an earlier one.
      await mustWrite(
        "confirm industry classification",
        supabase.from("deal_industry_classification").upsert(row, { onConflict: "deal_id,lender_id" }),
      );
      onSaved(row);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the classification.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border-2 border-rose-400 dark:border-rose-700 bg-rose-50/60 dark:bg-rose-900/15 p-3 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[12px] font-bold text-rose-800 dark:text-rose-200">
            Industry match — required before this file can go to {funderName}
          </p>
          {list ? (
            <p className="mt-0.5 text-[11px] text-rose-700 dark:text-rose-300">
              <span className="italic">“{list.stakesQuote}”</span>{" "}
              <span className="opacity-80">— {list.stakesSource}</span>
            </p>
          ) : (
            <p className="mt-0.5 text-[11px] text-rose-700 dark:text-rose-300">
              {funderName}&apos;s recipe requires a confirmed industry classification before we submit.
            </p>
          )}
        </div>
        <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 flex-shrink-0">
          <XMarkIcon className="w-4 h-4" />
        </button>
      </div>

      {/* 1 — the basis. Everything below is derived from this, and it is the
          field the funder's own worked example turns on. */}
      <div>
        <label className={labelCls}>
          What the merchant actually does
          <textarea
            rows={2}
            value={activity}
            onChange={(e) => setActivity(e.target.value)}
            placeholder="e.g. digs foundations and trenches for residential builders — site prep, not remodeling"
            className={inputCls}
          />
        </label>
        <p className="mt-0.5 text-[10px] text-gray-500 dark:text-gray-400">
          The real trade, not the business name. This is the basis for the code and the dropdown value below —
          a company with “Excavation” in its name is site prep, and only what it <em>does</em> says so.
        </p>
      </div>

      {/* 2 — the shared, checkable anchor. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <label className={labelCls}>
          NAICS code (6 digits)
          <input
            type="text"
            inputMode="numeric"
            value={naicsCode}
            onChange={(e) => setNaicsCode(e.target.value)}
            placeholder="238910"
            className={inputCls}
          />
          {naicsCode.trim() !== "" && !codeValid && (
            <span className="mt-0.5 block text-[10px] font-normal normal-case text-rose-600 dark:text-rose-400">
              Six digits — {code.length} so far.
            </span>
          )}
        </label>
        <label className={`${labelCls} sm:col-span-2`}>
          NAICS title (as published)
          <input
            type="text"
            value={naicsTitle}
            onChange={(e) => setNaicsTitle(e.target.value)}
            placeholder="Site Preparation Contractors"
            className={inputCls}
          />
        </label>
      </div>
      <p className="-mt-1 text-[10px] text-gray-500 dark:text-gray-400">
        Look it up at{" "}
        <a
          href={list?.lookupUrl ?? NAICS_LOOKUP_URL}
          target="_blank"
          rel="noreferrer"
          className="text-ocean-blue hover:underline inline-flex items-center gap-0.5"
        >
          naics.com/code-search <ArrowTopRightOnSquareIcon className="w-3 h-3" />
        </a>{" "}
        {list ? `— ${list.lookupAttribution}.` : "— the public NAICS code search."} Copy the title as published, so a
        wrong code shows up as a wrong title instead of hiding behind six digits.
      </p>

      {/* 3 — the funder's own label. Free text on purpose. */}
      <div>
        <label className={labelCls}>
          The value you will select in {funderName}&apos;s dropdown
          <input
            type="text"
            value={category}
            onChange={(e) => { setCategory(e.target.value); setShowSuggestions(true); }}
            onFocus={() => setShowSuggestions(true)}
            placeholder="type it exactly as their form prints it"
            className={inputCls}
          />
        </label>
        {tier && (
          <span className={`mt-1 inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${TIER_CHIP[tier]}`}>
            {tier === "preferred" ? "PREFERRED tier in our list" : "STANDARD tier in our list"}
          </span>
        )}

        {list ? (
          <>
            {suggestions.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {suggestions.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => { setCategory(s.value); setShowSuggestions(false); }}
                    className={`text-[10px] px-1.5 py-0.5 rounded-full border border-transparent hover:border-gray-400 ${TIER_CHIP[s.tier]}`}
                  >
                    {s.value}
                  </button>
                ))}
              </div>
            )}
            <p className="mt-1 text-[10px] text-gray-500 dark:text-gray-400">
              {list.dropdownCaveat}{" "}
              <Link to={list.backgroundHref} className="text-ocean-blue hover:underline">
                {list.backgroundLabel}
              </Link>{" "}
              carries the full notice and their worked examples.
            </p>

            {/* Name a list, print the list — the kill-list travels with the
                control, never "see the playbook tab for which ones". */}
            <div className="mt-1.5 rounded border border-rose-300 dark:border-rose-800 bg-white/70 dark:bg-gray-900/40 px-2 py-1.5">
              <p className="text-[10px] font-semibold text-rose-700 dark:text-rose-300">
                {funderName} will not fund these {list.prohibited.length} at any price:
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {list.prohibited.map((p) => (
                  <span
                    key={p}
                    className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                      barred === p
                        ? "bg-rose-600 text-white font-bold"
                        : "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
                    }`}
                  >
                    {p}
                  </span>
                ))}
              </div>
              <p className="mt-1 text-[10px] text-gray-500 dark:text-gray-400">
                From {list.sourceLabel}.
              </p>
            </div>
          </>
        ) : (
          <p className="mt-1 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
            ⚠ We hold no category list for this funder — so nothing here can tell you which values they accept,
            prefer, or refuse. This is not an empty list; it is no list. Read their application&apos;s dropdown and
            record exactly what you will click.
          </p>
        )}
      </div>

      {/* The refusal. Not a warning — the file cannot go to this funder. */}
      {barred && (
        <div className="rounded-md border-2 border-rose-500 bg-rose-100 dark:bg-rose-900/40 px-2.5 py-2">
          <p className="text-[12px] font-bold text-rose-800 dark:text-rose-200 inline-flex items-center gap-1">
            <NoSymbolIcon className="w-4 h-4 flex-shrink-0" /> “{barred}” is on {funderName}&apos;s prohibited list
          </p>
          <p className="mt-0.5 text-[11px] text-rose-700 dark:text-rose-300">
            This file cannot go to {funderName} at any price — not at a worse factor, not with a bigger package.
            Nothing is saved and nothing will be sent. If the merchant&apos;s real trade is something else, correct
            the activity above; if it is this, take the deal to another funder.
          </p>
        </div>
      )}

      {error && <p className="text-[11px] text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          disabled={!canSave}
          onClick={() => { if (armed) { setArmed(false); void save(); } else setArmed(true); }}
          title={
            barred
              ? "Prohibited industry — this funder cannot take the file"
              : !complete
                ? "Fill in the activity, the six-digit NAICS code, its title, and the dropdown value"
                : undefined
          }
          className={`text-[11px] font-semibold px-2.5 py-1 rounded text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1 ${
            armed ? "bg-amber-600" : "bg-ocean-blue"
          }`}
        >
          {saving ? <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" /> : <CheckCircleIcon className="w-3.5 h-3.5" />}
          {saving
            ? "Saving…"
            : armed
              ? `⚠️ Tap again — I will select “${category.trim()}” in ${funderName}'s application`
              : "Confirm the industry match"}
        </button>
        <button type="button" onClick={onClose} className="text-[11px] text-gray-500 hover:text-gray-700 inline-flex items-center gap-1">
          <XMarkIcon className="w-3.5 h-3.5" /> Cancel
        </button>
        {existing && (
          <span className="text-[10px] text-gray-500 dark:text-gray-400">
            Currently on file: {existing.naics_code} · {existing.funder_category}
            {existing.confirmed_at ? ` (confirmed ${existing.confirmed_at.slice(0, 10)})` : ""}
          </span>
        )}
      </div>
    </div>
  );
}
