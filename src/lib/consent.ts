import supabase from "../supabase";
import { tryWrite } from "@/supabase/writes";

// The exact express-written-consent wording shown to the user. Keep this in sync
// with the visible text rendered by <TcpaConsent>. This string is what gets
// stored in tcpa_consents.consent_text as proof of what the user agreed to.
export const TCPA_CONSENT_TEXT =
  "By checking this box, I give my express written consent for Momentum Funding (mfunding.net) and its representatives and funding partners to contact me at the phone number and email I provided — including by automatic telephone dialing system, prerecorded or artificial voice, and SMS/text messages — about funding options and related offers. Consent is not a condition of any purchase. Message frequency varies; message and data rates may apply. Reply STOP to opt out, HELP for help. See our Privacy Policy and Terms.";

/**
 * Persist a durable TCPA consent record (best-effort — never blocks the lead).
 * Stores the exact text shown, the source/page, and a timestamp as proof.
 */
export async function recordConsent(args: {
  name?: string;
  email?: string;
  phone?: string;
  source: string;
  page: string;
}): Promise<void> {
  await tryWrite("record TCPA consent", supabase.from("tcpa_consents").insert({
    name: args.name || null,
    email: args.email || null,
    phone: args.phone || null,
    consent: true,
    consent_text: TCPA_CONSENT_TEXT,
    source: args.source,
    page: args.page,
    user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
  }));
}
