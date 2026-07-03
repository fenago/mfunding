// How MFunding partners with a funder (distinct from the funding *products* they
// offer). Stored on lenders.partnership_types (text[]).

export interface PartnershipType {
  value: string;
  label: string;
  color: string; // tailwind chip classes
}

export const PARTNERSHIP_TYPES: PartnershipType[] = [
  { value: "referral", label: "Referral / Affiliate", color: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
  { value: "broker_iso", label: "Broker / ISO", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300" },
  { value: "white_label", label: "White-Label", color: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300" },
  { value: "syndication", label: "Syndication", color: "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300" },
  { value: "marketplace", label: "Marketplace", color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" },
  { value: "direct", label: "Direct", color: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200" },
];

export const PARTNERSHIP_LABEL: Record<string, string> = Object.fromEntries(
  PARTNERSHIP_TYPES.map((p) => [p.value, p.label]),
);
export const PARTNERSHIP_COLOR: Record<string, string> = Object.fromEntries(
  PARTNERSHIP_TYPES.map((p) => [p.value, p.color]),
);
