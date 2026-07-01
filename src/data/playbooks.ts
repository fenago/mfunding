// Revenue Playbooks — step-by-step closer instructions for the 3 flows that
// generate revenue. Content distilled from the MFunding funnel/follow-up docs,
// the brokerage playbook, and the VCF call scripts.
//
// Channel note: outreach and follow-up are EMAIL + PHONE only right now.
// Each step lists the exact app screen to use, the pipeline stage it maps to,
// and the GHL automation that supports it.

export type StepTone = "leak" | "win" | "branch" | "speed";

// A structured input the employee fills in AT this step. The value is persisted
// to the named column on either the customer or the deal — so the playbook is
// the only screen they ever touch.
export interface StepField {
  key: string;
  label: string;
  kind: "text" | "number" | "money" | "textarea";
  target: "customer" | "deal";
  column: string;
  placeholder?: string;
  hint?: string;
}

export interface PlaybookStep {
  n: number;
  title: string;
  stageKey?: string; // maps to a pipeline stage (label shown from the pipeline def)
  automation?: string; // supporting GHL workflow
  sla?: string;
  do: string[]; // what the closer does — with exact app locations
  say?: string; // verbatim script (email/phone)
  collect?: string[]; // docs / info to gather
  fields?: StepField[]; // structured inputs captured inline at this step
  route?: { to: string; label: string }; // primary screen for this step
  tone?: StepTone;
  note?: string;
}

// Shared field sets so MCA flows capture the same qualifiers.
const MCA_QUALIFY_FIELDS: StepField[] = [
  { key: "monthly_revenue", label: "Monthly revenue ($)", kind: "money", target: "customer", column: "monthly_revenue", placeholder: "25000" },
  { key: "time_in_business", label: "Time in business (months)", kind: "number", target: "customer", column: "time_in_business", placeholder: "18" },
  { key: "amount_requested", label: "Amount requested ($)", kind: "money", target: "deal", column: "amount_requested", placeholder: "50000" },
  { key: "industry", label: "Industry", kind: "text", target: "customer", column: "industry", placeholder: "Construction, retail…" },
  { key: "use_of_funds", label: "Use of funds", kind: "text", target: "deal", column: "use_of_funds", placeholder: "Working capital, payroll, inventory…" },
];

const VCF_QUALIFY_FIELDS: StepField[] = [
  { key: "vcf_active_positions", label: "# of active positions", kind: "number", target: "deal", column: "vcf_active_positions", placeholder: "3" },
  { key: "vcf_total_balance", label: "Total MCA balance ($)", kind: "money", target: "deal", column: "vcf_total_balance", placeholder: "85000" },
  { key: "vcf_daily_debit", label: "Combined daily/weekly debit ($)", kind: "money", target: "deal", column: "vcf_daily_debit", placeholder: "1200" },
  { key: "vcf_current_funders", label: "Current funders", kind: "text", target: "deal", column: "vcf_current_funders", placeholder: "Funder A, Funder B…" },
  { key: "vcf_hardship_reason", label: "Hardship reason", kind: "text", target: "deal", column: "vcf_hardship_reason", placeholder: "Slow season, big debit, payroll…" },
];

export interface Playbook {
  id: "website" | "live-transfer" | "vcf";
  name: string;
  tagline: string;
  pipeline: "mca" | "vcf";
  revenue: string;
  entry: string;
  /** The screen the closer keeps open and types into for this whole flow. */
  workFrom: { screen: string; route: string; appNote: string };
  steps: PlaybookStep[];
}

export const PLAYBOOKS: Playbook[] = [
  // ─────────────────────────────────────────── WEBSITE LEAD ───────────────────────────────────────────
  {
    id: "website",
    name: "Website Lead → Funded",
    tagline: "A merchant fills out the form on the site. Turn it into a funded MCA deal.",
    pipeline: "mca",
    revenue: "≈ $4,000 avg commission per funded deal (8 pts on $50K)",
    entry: "Inbound: merchant submits the form at /apply (creates a deal at stage New)",
    workFrom: {
      screen: "Open the deal record and work from it the whole call",
      route: "/admin/deals",
      appNote:
        "You live on the deal page (Admin → Deals → click the deal): move the status, collect stips, submit to funders, log every call. KEY: moving a status is what FIRES that stage's email/automation in GHL — there are NO separate 'send email' buttons, and every send is logged in the deal's Activity / Conversations tab so you can confirm it went out. The merchant fills the application themselves at /apply — you never fill it for them.",
    },
    steps: [
      {
        n: 1,
        title: "Open the deal — this is your workspace",
        stageKey: "new",
        automation: "MCA 01 — Speed to Lead",
        sla: "First touch < 5 min",
        tone: "speed",
        do: [
          "The form already created the deal and fired the auto-response email + round-robin assignment.",
          "Go to Admin → Deals (/admin/deals). The new deal is at stage New, sorted to the top — click it to open the deal page (/admin/deals/:id). Keep this page open for the whole call.",
          "Confirm you're the assigned closer (Closer field, right info panel).",
          "Set Lead Source = Website and pick the Campaign (Campaign dropdown in the info panel) so it counts toward ROI in Admin → Campaigns.",
        ],
        route: { to: "/admin/deals", label: "Admin → Deals → open the deal" },
        note: "Speed matters: every minute of delay costs ~10% contact rate on web leads. Call within 5 minutes.",
      },
      {
        n: 2,
        title: "First contact — call, then log it",
        stageKey: "contacted",
        automation: "MCA 02 — No Answer Nurture (fires if they go dark)",
        sla: "65%+ contact rate; same day",
        do: [
          "Call the merchant (phone on the deal's customer panel; click-to-call or the Customer record at /admin/customers/:id).",
          "If no answer: send the intro email and log the attempt.",
          "On the deal page (/admin/deals/:id) move Status → Contacted using the stage stepper at the top of the deal.",
          "Log what happened in the Activity tab (Add interaction) so the next person has context.",
        ],
        say: "Hi [First Name], it's [Closer] from Momentum Funding — you just requested working capital for [Business Name]. I'm not here to sell you anything, just to understand your situation and see if we're a fit. Do you have 5 minutes?",
        route: { to: "/admin/deals", label: "Open the deal → set Contacted" },
      },
      {
        n: 3,
        title: "Qualify (BANT-F)",
        stageKey: "qualifying",
        automation: "MCA 03 — Qualifying",
        do: [
          "On the call, run the 5-question checklist.",
          "On the deal page move Status → Qualifying and record revenue / time-in-business / amount on the Customer record (/admin/customers/:id).",
          "If they're carrying ≥2 active advances or clearly struggling: add the tag route-to-vcf on the deal and switch to the VCF playbook.",
        ],
        say: "Let me ask five quick questions so I can find the right options. How long have you been in business? Roughly what's your monthly revenue? How much are you looking for, and what for? And — are you currently making any daily or weekly payments on other advances?",
        collect: [
          "Time in business (6+ months)",
          "Monthly revenue ($15K+ min, $20K+ preferred)",
          "Amount needed + use of funds",
          "Industry (no cannabis / adult / firearms / nonprofit)",
          "Existing advances? (≥2 → route to VCF)",
        ],
        fields: MCA_QUALIFY_FIELDS,
        tone: "branch",
      },
      {
        n: 4,
        title: "Send the application + e-sign docs",
        stageKey: "application_sent",
        automation: "MCA 04 — Application + Disclosure",
        sla: "Same day; submit target < 24h",
        do: [
          "Move Status → Application Sent on the deal page. THAT is the send — it pushes the stage to GHL and fires the MCA 04 workflow. There is NO separate 'send email' button.",
          "MCA 04 auto-sends the merchant three things: (1) the application link (/apply), (2) two e-sign documents from GHL Documents & Contracts — 'MCA — Broker Compensation Disclosure' and 'MCA — Bank Verification & Credit Authorization' (merge fields pre-fill their name/business; they review + e-sign in one click), and (3) the secure bank-statements link (Plaid, or the 'Bank Statements & Documents Upload' form).",
          "Confirm it went out on the deal's Activity / Conversations tab. Reminders auto-fire at +4h and Day 1 until they sign + submit.",
        ],
        say: "Based on what you told me, you look like a solid fit. I'm emailing you a 3-minute application plus two quick e-signatures and a secure link to connect your bank so we can verify revenue. Want me to stay on while you start it?",
        note: "The e-sign docs come back automatically into GHL (signed copy attaches to their contact). Bank statements are NOT e-signed — they come back via Plaid or the upload form (see step 5).",
      },
      {
        n: 5,
        title: "Collect docs + bank statements",
        stageKey: "bank_statements",
        automation: "MCA 06 — Bank Statements (Sequence A) ⭐",
        sla: "14-day email chase — stop the instant statements arrive",
        tone: "leak",
        do: [
          "Get the 4 stips + 3 months of bank statements (Plaid is fastest; manual upload otherwise).",
          "Review what's in via Admin → Doc Review (/admin/documents) and the deal's Documents tab.",
          "Move Status → Docs Collected, then → Bank Statements as items arrive. The Sequence A email cadence chases anything missing.",
        ],
        collect: ["Broker disclosure (e-signed)", "Bank & credit authorization (e-signed)", "Owner photo ID", "Voided business check", "3 months bank statements (Plaid or upload)"],
        say: "Quick follow-up [First Name] — I've got a funder reviewing files today and I'd love to get yours in. Connect your bank in 60 seconds with the secure link in my email, or reply with photos of your last 3 statements.",
        route: { to: "/admin/documents", label: "Admin → Doc Review" },
        note: "TWO RAILS for docs coming back: (1) the e-sign forms (disclosure + authorization) return automatically via GHL Documents & Contracts — signed copy attaches to the contact. (2) Bank statements + ID + voided check are NOT e-signed — they arrive via Plaid (60-sec bank connect) or the GHL 'Bank Statements & Documents Upload' form. Both land in the deal's Documents tab / Doc Review. #1 FUNNEL LEAK — Plaid = 60s vs. days for manual.",
      },
      {
        n: 6,
        title: "Submit to 3–5 funders",
        stageKey: "submitted_to_funder",
        automation: "MCA 07 — Submission Orchestrator (submit-to-funders fn)",
        sla: "5-day SLA per funder",
        do: [
          "Open the deal → Submissions tab. Review the matched lenders (auto-scored) and pick 3–5.",
          "Click Submit to send the package (signed app + statements + stips) to all of them at once; Status moves to Submitted to Funders.",
          "If all decline → resubmit to the tier-2 / specialty set, or route to VCF if stacked.",
        ],
        route: { to: "/admin/deals", label: "Deal → Submissions tab" },
        say: "Great news — I've sent your file to our top funding partners. They usually respond in 24–48 hours and I'll email you the moment offers come in.",
      },
      {
        n: 7,
        title: "Present offers (always 2+)",
        stageKey: "offer_presented",
        automation: "MCA 09 — Offer Presented",
        sla: "70–80% acceptance",
        do: [
          "Log each funder offer on the Submissions tab (amount, factor, term, payment) as they arrive; Status → Offer Received.",
          "Email the best 2+ offers side-by-side and walk the merchant through them on a call; Status → Offer Presented.",
        ],
        say: "I've got two options. Option A is more capital with slightly higher payments; Option B is lower payments. Which feels better for your weekly cash flow?",
      },
      {
        n: 8,
        title: "Accept + e-sign",
        stageKey: "offer_accepted",
        automation: "MCA 10 — Offer Accepted",
        do: [
          "Mark the chosen offer Accepted on the Submissions tab; Status → Offer Accepted.",
          "Send the funder agreement for e-signature; the automation emails reminders at +4h, Day 1, Day 2. Ops coordinates funding.",
        ],
        say: "Perfect — I'm emailing the contract now. Quick e-signature, about 2 minutes. Once you sign, the funder finalizes and you should see funds by [date].",
      },
      {
        n: 9,
        title: "Funded → renewal pipeline",
        stageKey: "funded",
        automation: "MCA 11 — Funded → Renewal",
        tone: "win",
        do: [
          "When the funder confirms the deposit, move Status → Funded. Commission auto-calculates (see Admin → Commissions).",
          "The Day-1 congrats + Google review + referral-ask email fires automatically.",
          "Renewal triggers arm off Paydown %. Watch them in Admin → Renewals (/admin/renewals).",
        ],
        fields: [
          { key: "amount_funded", label: "Amount funded ($)", kind: "money", target: "deal", column: "amount_funded", placeholder: "50000", hint: "Saving this + marking Funded auto-creates the commission." },
        ],
        route: { to: "/admin/renewals", label: "Admin → Renewals" },
        say: "Congrats [First Name]! The capital should be in your account. If you know any owners who need capital, I'll send you a $100 gift card for every funded referral.",
      },
    ],
  },

  // ─────────────────────────────────────────── LIVE TRANSFER ───────────────────────────────────────────
  {
    id: "live-transfer",
    name: "Live Transfer Call",
    tagline: "A pre-qualified merchant is phone-transferred to you live. You have 60 seconds.",
    pipeline: "mca",
    revenue: "≈ $4,000 avg commission per funded deal · lead cost $50–$100/transfer",
    entry: "Vendor transfers a live call (Lead Tycoons, Synergy, Exclusive, MCA Leads Pro, Master MCA)",
    workFrom: {
      screen: "Admin → Deals → New Deal — open it the second you pick up",
      route: "/admin/deals",
      appNote:
        "There's no customer yet — you create one live. Open Admin → Deals → New Deal, switch the customer toggle to “+ New customer”, and type their name, business, phone and email as you talk. Saving creates the lead + the deal AND pushes the contact into GoHighLevel (fires Speed-to-Lead) — no dead end. The merchant finishes the full application on their own via the link you email (it opens /apply).",
    },
    steps: [
      {
        n: 1,
        title: "Pick up AND open New Deal (0–15s)",
        stageKey: "new",
        sla: "First touch < 60 seconds — you're already on the call",
        tone: "speed",
        do: [
          "Pick up energized — the merchant is LIVE and expecting you; treat it like you called them.",
          "Immediately open Admin → Deals → click New Deal, and switch the customer toggle to “+ New customer” (they're not in the system yet).",
          "Type their first name, business, phone and email into the new-customer fields AS YOU TALK — don't wait until after the call.",
          "Confirm you're speaking with the owner before you invest the pitch.",
        ],
        route: { to: "/admin/deals", label: "Admin → Deals → New Deal" },
        say: "Hi, is this [First Name]? This is [Closer] with Momentum Funding — I see you're looking for working capital. Quick question: are you the owner of [Business Name]?",
      },
      {
        n: 2,
        title: "Qualify in 3 quick questions (next 30s)",
        stageKey: "contacted",
        do: ["Rapid-fire, conversational. Listen for disqualifiers (exit politely if they fail)."],
        say: "How long have you been running [Business Name]? … Ballpark monthly revenue? … And what would the capital go toward — payroll, inventory, cash flow?",
        collect: ["6+ months in business", "$15K+/mo revenue", "Use of funds", "Not a prohibited industry"],
        fields: MCA_QUALIFY_FIELDS,
        note: "Under 6 months or under $15K/mo → exit politely and tag soft-no (it routes to nurture).",
        tone: "branch",
      },
      {
        n: 3,
        title: "The ask — email the application",
        do: [
          "Lock the next step: tell them you're emailing the application right now while you're on the call.",
          "Confirm the best email address out loud and that they can open it today.",
        ],
        say: "Based on what you've told me, you likely qualify. I'm going to email you a 3-minute application right now — no cost, zero credit impact. What's the best email? … Sending it now from Momentum. Open it when you can and I'll follow up tomorrow.",
      },
      {
        n: 4,
        title: "Finish + save the deal you opened in step 1",
        stageKey: "contacted",
        automation: "MCA 02 — No Answer Nurture (fires if no app in 2h)",
        sla: "Before you hang up / right after",
        do: [
          "Finish the New Deal form: Product Type = MCA, Amount, Market, assign yourself as Closer.",
          "Set Lead Source = Live Transfer and choose the Campaign (e.g. '$3,000 Live Leads — June') so this transfer counts against that spend.",
          "Save — this creates the customer + deal and pushes the contact to GoHighLevel. The deal opens at stage New; move Status → Contacted (you already spoke live).",
          "Email the application link now and log the call in the Activity tab.",
        ],
        route: { to: "/admin/deals", label: "Deal page → set Contacted" },
        note: "Tagging the Campaign here is what makes the cost-per-funded math work in Admin → Campaigns.",
      },
      {
        n: 5,
        title: "Then follow the Website Lead flow",
        do: [
          "From here it's the same MCA path: Qualifying → Application Sent → Docs/Bank Statements → Submit → Offers → Funded.",
          "Open the Website Lead playbook (tab above) for steps 3–9 with the exact screens.",
        ],
        note: "A live transfer just reaches 'Contacted' faster — the rest of the pipeline and automations are identical.",
      },
    ],
  },

  // ─────────────────────────────────────────── VCF DEBT RELIEF ───────────────────────────────────────────
  {
    id: "vcf",
    name: "VCF Debt Relief",
    tagline: "A merchant drowning in daily MCA payments. White-label debt restructuring (no new loan).",
    pipeline: "vcf",
    revenue: "Up to 7% of restructured debt · ≈ $14,960 avg comp per file · recurring 12–24 mo",
    entry: "Inbound at /debt-relief, OR own-book outreach to declined / stacked / struggling merchants",
    workFrom: {
      screen: "The VCF deal record (or create one from the customer)",
      route: "/admin/deals",
      appNote:
        "Work from the deal page: log the consult in the Activity tab, record positions/balances/daily debit on the VCF fields, and advance the status. Inbound merchants from /debt-relief arrive as VCF deals automatically; for own-book outreach, create the deal from the customer in Admin → Customers. The merchant uploads their agreements + statements via the secure link you email.",
    },
    steps: [
      {
        n: 1,
        title: "Identify the distressed merchant",
        stageKey: "new_distressed",
        automation: "VCF 01 — New Lead (Distressed)",
        do: [
          "Best source is your own book: Admin → Customers (/admin/customers) — filter for declined MCA applicants and funded merchants who are stacked or went cold.",
          "Inbound: merchants from the /debt-relief form land as VCF deals at stage New Lead.",
          "Open the deal (/admin/deals/:id), confirm deal type is VCF, and tag the Campaign/source.",
        ],
        route: { to: "/admin/customers", label: "Admin → Customers" },
        note: "Warm, zero-cost, highest-converting VCF channel. Never name 'Value Capital Funding' — it's white-label.",
      },
      {
        n: 2,
        title: "Outreach call",
        stageKey: "hardship_consult",
        automation: "VCF 02 — Hardship Consultation",
        do: [
          "Call, or email first to book a time. Open with empathy, not a pitch.",
          "On the deal page move Status → Hardship Review and log the call in the Activity tab.",
        ],
        say: "Hey [First Name], it's [Closer] from Momentum — we spoke a while back about working capital. I'm not calling to sell an advance. A lot of folks who got a 'no' are already carrying advances eating their cash flow, and I now help owners get those payments DOWN. Are you making any daily or weekly payments on advances right now?",
      },
      {
        n: 3,
        title: "Qualify (5 questions)",
        stageKey: "hardship_consult",
        do: [
          "Get the stacking picture. Qualified = $50K+ total MCA/business debt, multiple positions or clear hardship, decision-maker.",
          "Record the numbers on the deal's VCF fields (active positions, total balance, daily debit, current funders, hardship reason).",
        ],
        say: "How many advances/positions are you carrying? … Total balance across all of them? … Combined daily or weekly payment? … Who are the funders? … What's making it hardest right now — slow season, a big debit, payroll?",
        collect: ["# of positions", "Total balance ($50K+ qualifies)", "Combined daily/weekly debit", "Funder names", "Hardship reason"],
        fields: VCF_QUALIFY_FIELDS,
        tone: "branch",
      },
      {
        n: 4,
        title: "The pitch",
        stageKey: "strategy_proposal",
        automation: "VCF 04 — Strategy & Proposal",
        do: [
          "Explain simply: attorney-led team renegotiates existing advances → one lower payment (often 50–75% less). Optional FDIC bank loan refi. No upfront fees.",
          "On the deal page move Status → Strategy once they agree to see a plan.",
        ],
        say: "You're a strong fit. An attorney-led team renegotiates what you owe with your funders, so instead of crushing daily debits you get one manageable payment — many clients see it drop 50 to 75%. No upfront fees, free review, no obligation. I just need a few documents to build your custom plan, usually within 24 hours. Want me to start today?",
      },
      {
        n: 5,
        title: "Handle objections",
        do: [
          "Is this a loan? → No, the main program reduces what you owe; nothing's added unless it lowers your payment.",
          "What's the cost? → No upfront out-of-pocket fees.",
          "Credit impact? → Often no negative impact; the specialist explains your case.",
          "Is it legit? → Attorney-led, 30+ yrs, $100M+ restructured, free review, decide at the end.",
        ],
      },
      {
        n: 6,
        title: "Collect the positions",
        stageKey: "positions_analysis",
        automation: "VCF 03 — Positions & Balances Analysis",
        sla: "Chase 14 days by email",
        do: [
          "Email the secure upload link. Collect every current MCA agreement + 2–3 months of statements showing the debits.",
          "Track what's in via the deal's Documents tab / Admin → Doc Review; move Status → Positions Analysis. Tally every position, balance, and daily/weekly debit.",
        ],
        collect: ["Every current MCA agreement", "2–3 months bank statements showing the debits", "Hardship note (optional)"],
        say: "I'll email you a secure link right now to upload your last few statements and advance agreements. A specialist will call within 24 hours with your plan. What's the best email for that link?",
        route: { to: "/admin/documents", label: "Admin → Doc Review" },
      },
      {
        n: 7,
        title: "Agreement + submit to VCF",
        stageKey: "submitted_to_vcf",
        automation: "VCF 05 — Agreement Sent · VCF 06 — Submitted to VCF",
        do: [
          "Send the engagement agreement for e-signature; reminders email at +4h/Day 1/Day 2. Move Status → Agreement.",
          "Submit the file to the VCF partner and move Status → Submitted to VCF. The attorney team does all closing — you just refer.",
        ],
        route: { to: "/admin/deals", label: "Advance the VCF deal" },
        note: "All closings are done-for-you by the attorney-led team. Your job ends at a clean submission.",
      },
      {
        n: 8,
        title: "Restructured → servicing",
        stageKey: "restructure_executed",
        automation: "VCF 07 — Restructure Executed · VCF 08 — Servicing & Monitoring",
        tone: "win",
        do: [
          "When VCF confirms execution, move Status → Restructured. The congrats + review + referral-ask email fires.",
          "Move to Servicing for ongoing check-ins; watch for when they're healthy enough for new funding.",
        ],
        say: "[First Name], your positions are restructured and your payment is way down. When cash flow is healthy again, I'm here to help you grow. Know any owners in the same spot? I can help them too.",
        note: "Recurring commission pays weekly/monthly over the 12–24 month program — keep the relationship warm.",
      },
    ],
  },
];

export const getPlaybook = (id: string) => PLAYBOOKS.find((p) => p.id === id);
