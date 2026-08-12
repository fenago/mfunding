import { Link } from "react-router-dom";
import type { ReactNode } from "react";

/**
 * A single, self-contained SMS opt-in checkbox for ONE message use case.
 * Toll-free / A2P 10DLC compliance requires a separate opt-in per use case —
 * different message types cannot share one consent. Render one of these per
 * use case (e.g. account/customer-care vs. marketing) with its own description.
 */
export default function SmsConsentCheckbox({
  id,
  title,
  description,
  checked,
  onChange,
  optional = false,
}: {
  id: string;
  title: string;
  description: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  optional?: boolean;
}) {
  return (
    <label
      htmlFor={id}
      className="flex items-start gap-3 cursor-pointer rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4"
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 w-5 h-5 flex-shrink-0 rounded border-gray-300 text-ocean-blue focus:ring-ocean-blue cursor-pointer"
      />
      <span className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
        <span className="block font-semibold text-gray-800 dark:text-gray-100 text-[13px] mb-1">
          {title}{" "}
          <span className="font-normal text-gray-400 dark:text-gray-500">
            ({optional ? "optional" : "required to opt in"})
          </span>
        </span>
        {description}{" "}
        <span className="block mt-1 text-gray-500 dark:text-gray-400">
          Consent is not a condition of applying for or receiving funding. Message frequency
          varies; message &amp; data rates may apply. Reply <strong>STOP</strong> to opt out,{" "}
          <strong>HELP</strong> for help. We do not share your mobile number or opt-in with third
          parties. See our{" "}
          <Link to="/privacy" className="text-ocean-blue hover:underline">Privacy Policy</Link> and{" "}
          <Link to="/terms" className="text-ocean-blue hover:underline">Terms</Link>.
        </span>
      </span>
    </label>
  );
}
