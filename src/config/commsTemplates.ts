// Reusable email templates for the Comms page. Static config for v1 (promote to
// a DB table only if staff need to edit them in-app).
//
// COMPLIANCE: MCA is a purchase of future receivables, NOT a loan. These
// templates use "advance" / "working capital" / "funding" language and NEVER
// the word "loan". Placeholders are plain {curly} tokens the closer fills in.

export interface CommsTemplate {
  id: string;
  name: string;
  description: string;
  subject: string;
  /** Plain-text body with {placeholders}; rendered as the email body. */
  body: string;
}

export const COMMS_TEMPLATES: CommsTemplate[] = [
  {
    id: "submission-cover",
    name: "Submission cover",
    description: "Send a new MCA deal to a funder for review.",
    subject: "New deal for review — {merchant} ({state})",
    body: `Hi {contactFirstName},

We have a new merchant cash advance opportunity for your review:

• Business: {merchant}
• State: {state}
• Monthly revenue: {monthlyRevenue}
• Time in business: {timeInBusiness}
• Amount requested: {amountRequested}
• Use of funds: working capital

Bank statements and the signed application are attached. This is a purchase of future receivables (advance), not a loan. Please let me know what offers you can put together and any additional stips you need.

Thanks,
{senderName}
MFunding`,
  },
  {
    id: "status-follow-up",
    name: "Status follow-up",
    description: "Check on a deal already submitted to a funder.",
    subject: "Following up — {merchant} (submitted {submittedDate})",
    body: `Hi {contactFirstName},

Following up on {merchant}, which we submitted on {submittedDate}. Has underwriting had a chance to review the file?

The merchant is ready to move quickly on working capital, so any update on offers or outstanding stips would be a big help.

Appreciate it,
{senderName}
MFunding`,
  },
  {
    id: "new-iso-intro",
    name: "New ISO intro",
    description: "First contact with a funder's ISO / partner program.",
    subject: "Introduction — MFunding (ISO partnership)",
    body: `Hi {contactFirstName},

I'm {senderName} with MFunding, an ISO sourcing small-business funding across our target markets. We're building out our funder network and would like to start submitting advance and working-capital deals to {funder}.

Could you share your ISO onboarding packet, submission email, and current paper/buy-rates? Happy to send a sample file so your team can see our deal quality.

Looking forward to working together,
{senderName}
MFunding`,
  },
];

export function getTemplate(id: string): CommsTemplate | undefined {
  return COMMS_TEMPLATES.find((t) => t.id === id);
}
