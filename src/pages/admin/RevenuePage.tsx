import { BanknotesIcon } from "@heroicons/react/24/outline";
import MoneyInPlay from "@/components/admin/MoneyInPlay";
import FundedDeals from "@/components/admin/FundedDeals";
import StageConversion from "@/components/admin/StageConversion";
import SpeedToLead from "@/components/admin/SpeedToLead";

/**
 * Revenue & Commission (super_admin only).
 *
 * Four questions, in the order the owner asks them:
 *   1. What's in play, and what does it pay?      → <MoneyInPlay /> (reused as-is)
 *   2. What actually funded, and what did it pay? → <FundedDeals />  (fact: currently none)
 *   3. Is the funnel we forecast with real?       → <StageConversion /> (measured vs target)
 *   4. Are we even answering the phone in time?   → <SpeedToLead /> (the one input we control)
 *
 * (1) is a forecast. (2) is fact. (3) is the bridge — it exists to eventually replace
 * the estimated odds in (1) with measured ones. Today it mostly reports that we cannot
 * measure yet, which is the honest answer and the point of building it now: the
 * scoreboard has to be standing before the game starts. (4) is the leading indicator
 * that moves first — long before any of the rates above have a sample worth reading.
 */
export default function RevenuePage() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start gap-3">
        <BanknotesIcon className="w-8 h-8 text-mint-green flex-shrink-0" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Revenue &amp; Commission</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-3xl">
            Pipeline commission, funded commission, and whether the funnel odds we forecast with survive contact with
            reality. An advance is a purchase of future receivables — revenue here is the commission funders pay
            MFunding, never interest.
          </p>
        </div>
      </div>

      <MoneyInPlay />
      <FundedDeals />
      <StageConversion />
      <SpeedToLead />
    </div>
  );
}
