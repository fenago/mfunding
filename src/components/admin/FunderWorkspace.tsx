// FunderWorkspace — the funder-response half of a deal's life, as ONE unit.
//
// Two panels that always belong together once a deal has gone out:
//   1. FunderResponsesBoard — what came BACK (⏳ Awaiting → ✉ Replied → 💰 Offer
//      → ✅ Accepted / 🙅 Merchant declined / ❌ Funder declined), logged inline.
//   2. FunderPicker, folded into a closed accordion — second-wave submissions.
//      Declines come back, new funders go live; widen the net without leaving
//      the screen. Already-submitted rows gray out; the signed-app gate holds.
//
// This composite was inline in the Revenue Playbook's Step 7. It is a component
// now because the Processor drawer needs the SAME thing on submitted deals, and
// a second copy would drift — we'd find out through a wrong number on one of
// the two screens. One implementation, two mounts.
//
// Neither panel advances a stage: logging an offer here never moves the deal.
import FunderResponsesBoard from "./FunderResponsesBoard";
import FunderPicker from "./FunderPicker";
import type { DealWithCustomer } from "../../types/deals";

export default function FunderWorkspace({ deal }: { deal: DealWithCustomer }) {
  return (
    <>
      <FunderResponsesBoard deal={deal} />
      {/* Second-wave submissions: declines happen, new funders get added — the
          same picker as Step 6 in a collapsed accordion (house rule: reference
          content folds, active work stays open). */}
      <details className="mt-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-800/40">
        <summary className="cursor-pointer select-none px-3 py-2 text-[12px] font-semibold text-gray-700 dark:text-gray-200">
          ➕ Submit to more funders — declines came back or new funders went live? Widen the net.
        </summary>
        <div className="p-3 pt-1">
          <FunderPicker deal={deal} />
        </div>
      </details>
    </>
  );
}
