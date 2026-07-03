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

export interface PlaybookExplain {
  label: string;
  intro?: string;
  rows: [string, string, string][];
}

// Industry sizing heuristic — surfaced as a drop-down wherever the closer
// captures the amount or presents offers, so expectations get set correctly.
export const APPROVAL_SIZING_EXPLAIN: PlaybookExplain = {
  label: "How much will they approve?",
  intro:
    "Rule of thumb: a clean FIRST-position MCA approves ≈ 70–110% of average monthly revenue — funders compute that average themselves from the 3–4 months of statements. Set the merchant's expectation at about one month of revenue.",
  rows: [
    ["⬇ Existing positions", "The biggest cut — each open advance eats repayment capacity", "2+ open positions → maybe 30–50% of monthly, or a decline (route to VCF)"],
    ["⬇ Weak banking", "Low daily balances, NSFs, lumpy/declining deposits shrink offers", "Funders read the statements harder than the revenue number"],
    ["⬇ C/D paper", "Short time-in-business, rough credit, risky industry", "Expect 50–70% of monthly revenue"],
    ["⛓ The real constraint", "Funders size the PAYMENT, not the amount", "The daily/weekly pull must stay ~8–15% of monthly revenue"],
    ["⬆ Strong file", "Consistent deposits + healthy balances (A/B paper)", "Can clear 100%+ of monthly"],
    ["⬆ Renewals", "Proven repayment history unlocks bigger rounds", "1.2–1.5× monthly at 40–60% paydown — the renewal pipeline's whole play"],
    ["🗣 Say it out loud", "“Funders typically approve around one month's revenue.”", "A $16K offer on $18K/mo then lands as a win, not a letdown"],
  ],
};

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
  /** Override for the save button label when the click DOES something big
   * (e.g. fires the doc send) — so the button says what actually happens. */
  cta?: string;
  /** Collapsible how-to for rare-but-important maneuvers (rendered as a
   * fold-out so it doesn't clutter the happy path). */
  howto?: { title: string; steps: string[]; warn?: string };
  /** Tiny "what does this mean?" popovers next to the title — for jargon like
   * BANT-F or sizing rules. rows = [term, meaning, detail/question]. */
  explain?: PlaybookExplain | PlaybookExplain[];
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

// Steps 4–9 of the MCA close — SHARED by the Website Lead and Live Transfer
// playbooks (a live transfer just reaches Qualifying faster; the close is
// identical). One source of truth so both flows always match.
const MCA_CLOSE_STEPS: PlaybookStep[] = [
  {
    n: 4,
    title: "Send the application + e-sign docs",
    stageKey: "application_sent",
    automation: "MCA 04 — Application + Disclosure",
    sla: "Same day; submit target < 24h",
    cta: "Send the docs (moves to Application Sent)",
    do: [
      "Hit the button below — THAT is the send. It moves the deal to Application Sent, pushes it to GHL, and MCA 04 emails the merchant everything. Nothing else to click.",
      "MCA 04 auto-sends the merchant: (1) the Merchant Funding Application to complete + e-sign — your full application (all 7 sections) in GHL Documents & Contracts; this is the exact document funders accept, and they fill the fields and sign in one flow; (2) the Broker Compensation Disclosure to e-sign; and (3) a secure link to the 'Bank Statements & Documents Upload' form for their last 4 months of statements, photo ID, and voided check.",
      "OPTIONAL white-glove: want the app to arrive pre-filled? BEFORE you hit send, open their GHL contact (button below) and type the app fields — SSN, DOB, driver's license, home address, bank — as they read them to you. Then send, and all they do is tap to sign.",
      "Confirm it went out on the deal's Activity / Conversations tab. Reminders auto-fire at +4h and Day 1 until they sign + submit.",
    ],
    say: "Based on what you told me, you look like a solid fit. I'm emailing you the funding application to complete and e-sign, a quick disclosure, and a secure link to upload your documents. Let's knock out the e-signature right now while I'm on with you — it takes about three minutes — and if you can snap photos of your ID and a voided check, we're 90% done. The bank statements you can upload tonight from the same link; it keeps working and each upload just adds on.",
    note: "The signed application + disclosure come back automatically into GHL (signed PDFs attach to their contact). Bank statements / ID / voided check are NOT e-signed — they come back via the upload form (see step 5).",
    howto: {
      title: "Need to fix or update a doc you already sent (not signed yet)?",
      steps: [
        "In GHL: Payments → Documents & Contracts → All Documents & Contracts → 'Waiting for others' tab → find their document.",
        "Click the ⋮ menu → 'Move to Draft'. Now you can edit it — fix a value, pre-fill more fields, whatever.",
        "Hit Send again — they get a fresh email with a new signing link.",
      ],
      warn: "The old link stops working the moment you move it to Draft — tell them to use the newest email. Don't use 'Mark as Completed' (that force-completes WITHOUT a signature). And note: updating contact fields does NOT change an already-sent doc — pre-fill freezes at send time, so re-send if you filled fields late.",
    },
  },
  {
    n: 5,
    title: "Collect docs + bank statements",
    stageKey: "bank_statements",
    automation: "MCA 06 — Bank Statements (Sequence A) ⭐",
    sla: "14-day email chase — stop the instant statements arrive",
    tone: "leak",
    do: [
      "Get the stips + last 4 months of bank statements via the secure 'Bank Statements & Documents Upload' link.",
      "Review what's in via Admin → Doc Review (/admin/documents) and the deal's Documents tab.",
      "Move Status → Docs Collected, then → Bank Statements as items arrive. The Sequence A email cadence chases anything missing.",
    ],
    collect: ["Merchant Funding Application (completed + e-signed)", "Broker Compensation Disclosure (e-signed)", "Owner photo ID", "Voided business check", "Proof of business ownership", "Last 4 months bank statements (upload)"],
    say: "Quick follow-up [First Name] — I've got a funder reviewing files today and I'd love to get yours in. Upload your last 4 statements with the secure link in my email, or reply with photos.",
    route: { to: "/admin/documents", label: "Admin → Doc Review" },
    note: "TWO RAILS for docs coming back: (1) the Merchant Funding Application + Broker Compensation Disclosure return automatically e-signed via GHL Documents & Contracts — signed PDFs attach to the contact. (2) Bank statements + ID + voided check + proof of ownership arrive via the GHL 'Bank Statements & Documents Upload' form. PARTIAL IS FINE: the upload link keeps working and every new submission ADDS files to the same contact — get the e-sign + ID + voided check while they're on the phone, and Sequence A chases whatever's still missing. #1 FUNNEL LEAK — chase fast.",
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
    say: "Great news — your file is with our internal underwriting and is being sent to our top funding partners. They usually respond in 24–48 hours, and I'll email you the moment offers come in.",
  },
  {
    n: 7,
    title: "Present offers (always 2+)",
    stageKey: "offer_presented",
    automation: "MCA 09 — Offer Presented",
    sla: "70–80% acceptance",
    explain: APPROVAL_SIZING_EXPLAIN,
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
];

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
        explain: [{
          label: "What's BANT-F?",
          intro: "The 5 qualification checks — run them before you invest the pitch:",
          rows: [
            ["B — Budget", "Can they support payments?", "“Roughly what's your monthly revenue?” ($15K+ min)"],
            ["A — Authority", "Talking to the decision-maker?", "“Are you the owner?”"],
            ["N — Need", "What's the money actually for?", "“How much are you looking for, and what for?”"],
            ["T — Timeline", "How urgent is it?", "“How soon do you need the funding?”"],
            ["F — Fundability", "Can a funder approve them?", "6+ months in business · industry not prohibited · existing advances (≥2 → route to VCF)"],
          ],
        }, APPROVAL_SIZING_EXPLAIN],
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
      ...MCA_CLOSE_STEPS,
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
      screen: "THIS page — start the lead in the green box the second you pick up",
      route: "/admin/playbooks",
      appNote:
        "There's no customer yet — you create one live, right here. Type their first name + phone into the capture box at the top AS YOU TALK and hit Save lead: that creates the customer + the MCA deal AND pushes the contact into GoHighLevel (fires Speed-to-Lead). Then just work the steps below — the qualify answers, the doc send, everything happens on this page.",
    },
    steps: [
      {
        n: 1,
        title: "Pick up AND start the lead above (0–15s)",
        stageKey: "new",
        sla: "First touch < 60 seconds — you're already on the call",
        tone: "speed",
        do: [
          "Pick up energized — the merchant is LIVE and expecting you; treat it like you called them.",
          "In the green capture box at the top of this page: type their first name + phone AS YOU TALK, set Lead Source = Live Transfer and pick the Campaign (e.g. '$3,000 Live Leads — June'), assign yourself as Closer, and hit Save lead.",
          "That one save creates the customer + deal and pushes them into GoHighLevel — the steps below light up and you work everything from here.",
          "Confirm you're speaking with the owner before you invest the pitch.",
        ],
        say: "Hi, is this [First Name]? This is [Closer] with Momentum Funding — I see you're looking for working capital. Quick question: are you the owner of [Business Name]?",
        note: "Tagging the Campaign at save is what makes the cost-per-funded math work in Admin → Campaigns.",
      },
      {
        n: 2,
        title: "Qualify in 3 quick questions (next 30s)",
        stageKey: "contacted",
        do: [
          "Rapid-fire, conversational — type each answer into the fields below as they say it. Listen for disqualifiers (exit politely if they fail).",
          "Saving this step logs the call and marks them Contacted (you spoke live).",
        ],
        say: "How long have you been running [Business Name]? … Ballpark monthly revenue? … And what would the capital go toward — payroll, inventory, cash flow?",
        collect: ["6+ months in business", "$15K+/mo revenue", "Use of funds", "Not a prohibited industry"],
        fields: MCA_QUALIFY_FIELDS,
        explain: APPROVAL_SIZING_EXPLAIN,
        note: "Under 6 months or under $15K/mo → exit politely and tag soft-no (it routes to nurture).",
        tone: "branch",
      },
      {
        n: 3,
        title: "Lock it in — mark them Qualifying",
        stageKey: "qualifying",
        automation: "MCA 03 — Qualifying",
        do: [
          "They passed the 3 questions — save this step to move them to Qualifying while you set up the send.",
          "Tell them what's coming next so the emails don't surprise them: the application to e-sign + a secure upload link.",
        ],
        say: "Based on what you've told me, you qualify. Stay with me two more minutes — I'm going to take down a few details and send your application over so it arrives already filled out. All you'll do is tap to sign.",
      },
      ...MCA_CLOSE_STEPS,
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
