import { Link } from "react-router-dom";

/**
 * Express-written TCPA consent checkbox + disclosure. Required on any public form
 * that collects a phone number for marketing contact (audit #11/#12/#13).
 * The visible wording must match TCPA_CONSENT_TEXT in src/lib/consent.ts.
 */
export default function TcpaConsent({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4">
      <input
        type="checkbox"
        required
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 w-5 h-5 flex-shrink-0 rounded border-gray-300 text-ocean-blue focus:ring-ocean-blue cursor-pointer"
      />
      <span className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
        By checking this box, I give my <strong>express written consent</strong> for Agentic Voice Inc.
        d/b/a Momentum Funding (mfunding.net) to contact me at the phone number and email I provided —
        including by <strong>automatic telephone dialing system, prerecorded or artificial voice, and
        SMS/text messages</strong> — about my funding request and related offers.{" "}
        <strong>Consent to receive texts is not a condition of applying for or receiving funding.</strong>{" "}
        Message frequency varies; message and data rates may apply. Reply STOP to opt out, HELP for help.
        We do not share your mobile number or opt-in with third parties for their marketing. See our{" "}
        <Link to="/privacy" className="text-ocean-blue hover:underline">Privacy Policy</Link> and{" "}
        <Link to="/terms" className="text-ocean-blue hover:underline">Terms</Link>.
      </span>
    </label>
  );
}
