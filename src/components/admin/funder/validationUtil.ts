// Pure helpers for funder validation. Separate from the component file so the
// panel exports components only — mixing value and component exports breaks
// React Fast Refresh for the whole module.

export type AnswerType =
  | "none"
  | "text"
  | "longtext"
  | "phone"
  | "email"
  | "url"
  | "money"
  | "number"
  | "bool"
  | "date"
  | "choice";

export type ValItem = {
  key: string;
  section: string;
  label: string;
  help: string | null;
  answer_type: AnswerType;
  choices: string[] | null;
  product: string | null;
  is_required: boolean;
  sort: number;
};

export type ValPass = {
  id: string;
  lender_id: string;
  validated_on: string;
  is_complete: boolean;
  validated_by: string;
  validated_by_label: string | null;
  outcome: string | null;
  summary: string | null;
  created_at: string;
};

export type ValCheck = {
  id: string;
  validation_id: string;
  item_key: string;
  checked: boolean;
  value: string | null;
  note: string | null;
};

export type EndpointVerification = {
  id: string;
  lender_id: string;
  endpoint_kind: "phone" | "email";
  endpoint_value: string;
  endpoint_label: string | null;
  result: "works" | "dead" | "wrong_party" | "no_answer" | "bounced" | "unknown";
  reaches: string | null;
  note: string | null;
  verified_at: string;
};

/** An endpoint the card already shows, offered up for verification. */
export type Endpoint = { kind: "phone" | "email"; shown: string; label: string | null };

export const digitsOf = (s: string) => s.replace(/\D/g, "");

/**
 * The STORED key for an endpoint: digits for phones, lowercased for emails.
 *
 * `funder_contact_verifications.endpoint_value` is constrained to ^[0-9]+$ for
 * phones on purpose. The call buttons dedupe and match on digits, so a stored
 * "(954) 280-0359" would be a row that silently never colours the button it was
 * written to colour — which is the exact bug that shipped a dead line as a
 * healthy green Call.
 */
export const endpointKey = (kind: "phone" | "email", shown: string) =>
  kind === "phone" ? digitsOf(shown) : shown.trim().toLowerCase();

/** Newest verdict per endpoint, across every pass. Dead in August is dead in October. */
export function latestVerdictByEndpoint(rows: EndpointVerification[]) {
  const m = new Map<string, EndpointVerification>();
  for (const r of rows) {
    const k = `${r.endpoint_kind}:${r.endpoint_value}`;
    const prev = m.get(k);
    if (!prev || new Date(r.verified_at) > new Date(prev.verified_at)) m.set(k, r);
  }
  return m;
}

/**
 * Six months. Long enough not to nag, short enough that a rotted line surfaces.
 *
 * ONE definition, imported by the collapsed-row chip, the "validated over 6
 * months ago" filter and the panel's banner. Three copies of a threshold drift,
 * and then the filter and the chip disagree about the same funder.
 */
export const STALE_DAYS = 180;

export const daysSinceValidated = (validated_on: string) =>
  Math.floor((Date.now() - new Date(`${validated_on}T12:00:00`).getTime()) / 86_400_000);

export const validationStale = (p: { validated_on: string }) =>
  daysSinceValidated(p.validated_on) > STALE_DAYS;
