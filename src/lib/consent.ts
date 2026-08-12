import supabase from "../supabase";
import { tryWrite } from "@/supabase/writes";

// The exact express-written-consent wording shown to the user. Keep this in sync
// with the visible text rendered by <TcpaConsent>. This string is what gets
// stored in tcpa_consents.consent_text as proof of what the user agreed to.
export const TCPA_CONSENT_TEXT =
  "By checking this box, I give my express written consent for Agentic Voice Inc. d/b/a Momentum Funding (mfunding.net) to contact me at the phone number and email I provided — including by automatic telephone dialing system, prerecorded or artificial voice, and SMS/text messages — about my funding request and related offers. Consent to receive texts is not a condition of applying for or receiving funding. Message frequency varies; message and data rates may apply. Reply STOP to opt out, HELP for help. We do not share your mobile number or opt-in with third parties for their marketing. See our Privacy Policy and Terms.";

// Toll-free / A2P 10DLC compliance requires a SEPARATE opt-in per message use case —
// different message types cannot share one consent checkbox. These two texts back the
// two independent checkboxes on /optin. Keep each in sync with its rendered wording.
export const SMS_ACCOUNT_CONSENT_TEXT =
  "By checking this box, I give my express written consent for Agentic Voice Inc. d/b/a Momentum Funding (mfunding.net) to send me account & customer-care SMS/text messages about my funding request — including application status, document and verification requests, and account updates — at the mobile number I provided, including via automated technology. Consent is not a condition of applying for or receiving funding. Message frequency varies; message and data rates may apply. Reply STOP to opt out, HELP for help. We do not share your mobile number or opt-in with third parties. See our Privacy Policy and Terms.";

export const SMS_MARKETING_CONSENT_TEXT =
  "By checking this box, I give my express written consent for Agentic Voice Inc. d/b/a Momentum Funding (mfunding.net) to send me marketing & promotional SMS/text messages — including special offers, promotions, and funding tips — at the mobile number I provided, including via automated technology. Consent is not a condition of applying for or receiving funding. Message frequency varies; message and data rates may apply. Reply STOP to opt out, HELP for help. We do not share your mobile number or opt-in with third parties. See our Privacy Policy and Terms.";

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
  // Optional overrides so a per-use-case opt-in stores the EXACT text the user saw
  // (e.g. the separate account vs. marketing SMS consents on /optin).
  consentText?: string;
}): Promise<void> {
  await tryWrite("record TCPA consent", supabase.from("tcpa_consents").insert({
    name: args.name || null,
    email: args.email || null,
    phone: args.phone || null,
    consent: true,
    consent_text: args.consentText ?? TCPA_CONSENT_TEXT,
    source: args.source,
    page: args.page,
    user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
  }));
}
