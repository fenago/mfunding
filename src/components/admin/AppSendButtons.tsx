import { DocumentTextIcon } from "@heroicons/react/24/outline";

// The three application-send actions, extracted so they can live in MORE than one
// place (the Application-Sent playbook step, the green merchant card up top, and
// the enrichment card) without any copy drift. Labels / titles / icons are the
// owner's EXACT wording — do not reword (MCA-compliance: "funding/advance", never
// "loan"). Click behavior is identical everywhere; only WHERE it renders changes.
//
// Lives in its own module (not inside PlaybooksPage) so EnrichmentCard can reuse it
// without a circular import — PlaybooksPage already imports EnrichmentCard.
//
// `size="sm"` is a tighter variant for chip-dense rows.
export default function AppSendButtons({
  onSendPartial,
  onSendDocs,
  onFillApplication,
  size = "md",
  className = "",
}: {
  onSendPartial: () => void;
  onSendDocs: () => void;
  onFillApplication: () => void;
  size?: "sm" | "md";
  className?: string;
}) {
  const pad = size === "sm" ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5";
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {/* Path 3 — 04C PARTIAL, the DEFAULT: we prefill the lead's info, the
          merchant completes EIN/SSN/banking on the doc. Closer types nothing. */}
      <button
        type="button"
        onClick={onSendPartial}
        title="Prefills everything the lead told us; the merchant completes EIN, SSN, address and banking on the document, then signs. You type nothing."
        className={`inline-flex items-center gap-1.5 rounded-lg bg-mint-green ${pad} text-white font-semibold hover:opacity-90`}
      >
        ⚡ Send partial <span className="font-normal opacity-90">(they finish the rest)</span>
      </button>
      {/* Path 1 — send the ORIGINAL docs, no prefill (the merchant fills it all). */}
      <button
        type="button"
        onClick={onSendDocs}
        title="Send the application + disclosure + upload link as-is — the merchant fills out everything and e-signs. No prefilling."
        className={`inline-flex items-center gap-1.5 rounded-lg bg-ocean-blue ${pad} text-white font-semibold hover:opacity-90`}
      >
        📨 Send blank <span className="font-normal opacity-90">(they fill everything)</span>
      </button>
      {/* Path 2 — white-glove: closer fills it all, merchant just signs. */}
      <button
        type="button"
        onClick={onFillApplication}
        title="Fill the application for the merchant (pre-filled from what we know), then send — all they do is tap to sign."
        className={`inline-flex items-center gap-1.5 rounded-lg border border-ocean-blue/50 text-ocean-blue ${pad} font-semibold hover:bg-ocean-blue/5`}
      >
        <DocumentTextIcon className="w-4 h-4" /> Fill it in for them first
      </button>
    </div>
  );
}
