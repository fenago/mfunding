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
  // "date" renders as a native <input type="date"> and persists an ISO date
  // string (YYYY-MM-DD) straight into a `date` column.
  kind: "text" | "number" | "money" | "textarea" | "date";
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

// Renewal math — surfaced on the renewal call so the closer frames the offer
// as the NET number (new advance minus the payoff), not the gross. This is the
// single most-fumbled part of a renewal conversation.
export const RENEWAL_NET_EXPLAIN: PlaybookExplain = {
  label: "How renewals size — and the net-funding math",
  intro:
    "A renewal is not a fresh first-position deal. Proven repayment history is the merchant's biggest asset here, and the offer almost always PAYS OFF the current balance first — so quote the NET, never the gross.",
  rows: [
    ["⬆ Proven repayment", "On-time history de-risks the file", "Renewals commonly size 1.2–1.5× monthly revenue — bigger than the original"],
    ["⬆ Incumbent edge", "The funder holding the current advance already knows the payment history", "They usually beat new paper — fastest approval, best terms; give them first look"],
    ["🧮 Net-of-balance", "The new advance retires the remaining balance, merchant pockets the rest", "$60K approval − $22K balance owed = $38K NET into the account"],
    ["🗣 Say the NET number", "Merchants hear 'gross' and panic about the payoff", "“You're approved for sixty; after we clear the twenty-two you still owe, you net about thirty-eight thousand.”"],
    ["⏱ Timing = terms", "Higher paydown → more favorable renewal", "75%+ paid down is the sweet spot — lead with that when it's true"],
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
  id:
    | "website"
    | "live-transfer"
    | "web-lead"
    | "aged-transfer"
    | "realtime"
    | "cold-email"
    | "vcf"
    | "renewal";
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
      "STAY ON THE LINE until they confirm the email landed. Not in the inbox within ~60 seconds? It's almost certainly in SPAM — have them check spam, drag it to the inbox, and reply 'got it'. That reply + drag is what trains Gmail to trust our sending domain; every merchant who does it makes the next send land cleaner.",
    ],
    say: "Based on what you told me, you look like a solid fit. I'm emailing you the funding application to complete and e-sign, a quick disclosure, and a secure link to upload your documents. Let's knock out the e-signature right now while I'm on with you — it takes about three minutes — and if you can snap photos of your ID and a voided check, we're 90% done. The bank statements you can upload tonight from the same link; it keeps working and each upload just adds on. I just hit send — if it's not in your inbox within a minute, check your spam folder; if it landed there, drag it to your inbox and reply 'got it' so I know you have it.",
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
      "Statements in? Run the Internal AI underwriter below — it reads the statements and gives you the affordability verdict, revenue-padding read, red flags, and funder fit BEFORE you burn submissions.",
      "ASK FOR THE DATE — don't leave it open-ended. Get them to name a day for the statements, then type it into “Statements promised by” below. That date is your chase clock: My Day flags the deal the moment it slips.",
    ],
    collect: ["Merchant Funding Application (completed + e-signed)", "Broker Compensation Disclosure (e-signed)", "Owner photo ID", "Voided business check", "Proof of business ownership", "Last 4 months bank statements (upload)"],
    fields: [
      { key: "stips_promised_by", label: "Statements promised by", kind: "date", target: "deal", column: "stips_promised_by", hint: "The day THEY committed to. If it passes with no statements, My Day surfaces this deal as an overdue chase." },
    ],
    say: "Quick follow-up [First Name] — I've got a funder reviewing files today and I'd love to get yours in. Upload your last 4 statements with the secure link in my email, or reply with photos. When do you think you can get those bank statements over to me — today, or tomorrow? … Perfect, I'll put you down for [day]. Can I count on that? I'll watch for them and follow up with you that afternoon if anything's missing.",
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

// Which playbook a deal opens into, keyed by its lead_source (mirrors
// inbound_lead_sources.playbook_id). A deal from a real-time lead opens the
// realtime intake; a purchased web lead opens the web-lead intake; etc.
export const LEAD_SOURCE_TO_PLAYBOOK: Record<string, Playbook["id"]> = {
  website: "website",
  website_apply: "website", // the /apply form stamps this — it's a website lead
  live_transfer: "live-transfer",
  web_purchased: "web-lead",
  aged_transfer: "aged-transfer",
  realtime_appt: "realtime",
  cold_email: "cold-email",
  cold_email_landing: "cold-email",
  renewal: "renewal",
};

export function playbookIdForLeadSource(leadSource?: string | null): Playbook["id"] | undefined {
  return leadSource ? LEAD_SOURCE_TO_PLAYBOOK[leadSource] : undefined;
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
        "You don't know who they are yet — so the intake at the top IS the script. Read each line and type the answer in the box right under it (name → business → cell → email); the greeting ASKS for the name, it doesn't assume it. Save lead creates the customer + MCA deal and pushes them into GoHighLevel (fires Speed-to-Lead), then you roll straight into the qualifying steps on this page.",
    },
    steps: [
      {
        n: 2,
        title: "Qualify + lock it in (30s)",
        stageKey: "qualifying",
        automation: "MCA 03 — Qualifying",
        do: [
          "Rapid-fire, conversational — type each answer into the fields below as they say it. Listen for disqualifiers (exit politely if they fail).",
          "If they pass, prime them for what's coming so the emails don't surprise them — the application to e-sign + a secure upload link. Saving this step marks them Qualifying.",
        ],
        say: "How long have you been running [Business Name]? … Ballpark monthly revenue? … And what would the capital go toward — payroll, inventory, cash flow? … Based on that, you qualify — stay with me two minutes, I'll grab a couple details and send your application over already filled out; all you'll do is tap to sign.",
        collect: ["6+ months in business", "$15K+/mo revenue", "Use of funds", "Not a prohibited industry"],
        fields: MCA_QUALIFY_FIELDS,
        explain: APPROVAL_SIZING_EXPLAIN,
        note: "Under 6 months or under $15K/mo → exit politely and tag soft-no (it routes to nurture). One save both captures the qualifiers AND moves them to Qualifying.",
        tone: "branch",
      },
      ...MCA_CLOSE_STEPS,
    ],
  },

  // ─────────────────────────────────────────── WEB LEAD (purchased) ───────────────────────────────────────────
  {
    id: "web-lead",
    name: "Purchased Web Lead → Funded",
    tagline: "You bought a form-fill with full qual data. Verify it fast — these decay by the day.",
    pipeline: "mca",
    revenue: "≈ $4,000 avg commission · lead cost $1–$3 (fresher = pricier)",
    entry: "Bulk CSV import → deal at New (warm). Arrives WITH revenue, TIB, FICO, funding request in the qual snapshot.",
    workFrom: {
      screen: "Open the deal — the qual they submitted is already on it; you verify, not re-collect",
      route: "/admin/deals",
      appNote:
        "This merchant filled a funding form (on a site or social campaign) and you bought it. The deal is already on the board at New with everything they told the form — revenue, time in business, FICO, funding request — sitting in the deal's qual snapshot. Your job is speed + verification, not a cold pitch: they raised their hand, so confirm the numbers and move to the app. Fresh leads (1–7 days) convert far better than 30-day ones, so the board sorts them fresh-first.",
    },
    steps: [
      {
        n: 1,
        title: "Call fast — they asked for this (< 5 min fresh)",
        stageKey: "new",
        automation: "MCA 01 — Speed to Lead",
        sla: "< 5 min (1–7 day leads) · < 1 hr (older)",
        tone: "speed",
        do: [
          "Open the deal (Admin → Deals, sorted fresh-first). Read the qual snapshot BEFORE you dial — you already know their revenue, TIB, FICO, and what they want.",
          "Confirm you're the assigned closer + set the Campaign for ROI.",
          "Call now. They submitted a form requesting funding — reference it so you're a callback, not a cold call.",
        ],
        route: { to: "/admin/deals", label: "Admin → Deals → open the fresh lead" },
        say: "Hi [First Name], [Closer] from Momentum Funding — you requested about [amount] in working capital for [Business Name]. I've got your info in front of me, just calling to get you options. Good time?",
        note: "Every day a web lead ages, contact + close rates drop. Fresh ones are the priority in your queue.",
      },
      {
        n: 2,
        title: "VERIFY their numbers (don't re-interrogate)",
        stageKey: "contacted",
        do: [
          "You already have revenue / TIB / FICO / funding request from the form — CONFIRM each, don't re-ask cold. 'I show about $Xk/mo and roughly N months in business — still accurate?'",
          "Correct anything that changed; log it on the fields below. Move Status → Contacted.",
        ],
        say: "I've got you at roughly [revenue]/month, about [time in business] in business, looking for [amount]. Is that all still right? Anything changed?",
        collect: ["Confirm revenue", "Confirm time in business", "Confirm amount + use", "Confirm existing advances (≥2 → VCF)"],
        fields: MCA_QUALIFY_FIELDS,
        explain: APPROVAL_SIZING_EXPLAIN,
        tone: "branch",
      },
      {
        n: 3,
        title: "Verified → Qualifying + send the app",
        stageKey: "qualifying",
        automation: "MCA 03 — Qualifying",
        do: [
          "Numbers check out → Status → Qualifying and send the application same call (< 24h hard).",
          "Set expectations: app to e-sign + secure upload link.",
        ],
        say: "Everything lines up — you're a fit. Two minutes and I'll send your application pre-filled; just tap to sign.",
      },
      ...MCA_CLOSE_STEPS,
    ],
  },

  // ─────────────────────────────────────────── AGED LIVE TRANSFER ───────────────────────────────────────────
  {
    id: "aged-transfer",
    name: "Aged Live Transfer → Funded",
    tagline: "Fully qualified once — but 1–4 months ago. Re-warm and re-confirm; things change.",
    pipeline: "mca",
    revenue: "≈ $4,000 avg commission · lead cost $3–$5 (by age)",
    entry: "Bulk CSV import → deal at New (warmer). Arrives with the FULL prior live-transfer qualification + the date it was taken.",
    workFrom: {
      screen: "Open the deal — the prior qualification is on it, but treat it as a starting point, not gospel",
      route: "/admin/deals",
      appNote:
        "This merchant was qualified on a live transfer 30–120 days ago; you bought the qual data without the live call. The deal is on the board at New with that prior qualification in the snapshot — but it's MONTHS old. Revenue, positions, and appetite may have moved, so your first job is to re-warm ('we spoke a while back') and RE-CONFIRM before you invest. Warmer than a web lead (they were fully qualified once) but staler than fresh.",
    },
    steps: [
      {
        n: 1,
        title: "Re-engage — 'we connected a while back' (< 30 min)",
        stageKey: "new",
        sla: "< 30 min, same day",
        tone: "speed",
        do: [
          "Open the deal. Note the qualified-date in the snapshot — that's how long ago they were vetted.",
          "Set the Campaign for ROI; confirm you're the closer.",
          "Call with a re-engagement open — they DID look for funding before, so it's a warm reconnect.",
        ],
        route: { to: "/admin/deals", label: "Admin → Deals → open the aged transfer" },
        say: "Hi [First Name], [Closer] with Momentum Funding — we connected a little while back about working capital for [Business Name]. Circling back because programs have improved. Still looking for funding?",
      },
      {
        n: 2,
        title: "RE-CONFIRM the qual (it's months old)",
        stageKey: "contacted",
        do: [
          "Do NOT assume the old numbers hold. Re-verify revenue, positions, and amount — a lot changes in 1–4 months.",
          "Update the fields below with today's reality. Move Status → Contacted.",
          "Watch for NEW positions taken since — could flip them to a VCF (debt relief) candidate.",
        ],
        say: "Last time you were around [revenue]/month looking for [amount]. Where are things today — revenue still there? Taken on any new advances since we spoke?",
        collect: ["Re-confirm revenue", "Re-confirm time in business", "Re-confirm amount + use", "NEW positions since? (≥2 → VCF)"],
        fields: MCA_QUALIFY_FIELDS,
        explain: APPROVAL_SIZING_EXPLAIN,
        tone: "branch",
      },
      {
        n: 3,
        title: "Re-confirmed → Qualifying + send the app",
        stageKey: "qualifying",
        automation: "MCA 03 — Qualifying",
        do: [
          "Still qualifies on today's numbers → Status → Qualifying and send the app.",
          "Set expectations: e-sign app + secure upload link.",
        ],
        say: "Perfect — you still qualify, and terms are better than before. Two minutes and I'll send your application pre-filled to sign.",
      },
      ...MCA_CLOSE_STEPS,
    ],
  },

  // ─────────────────────────────────── REAL-TIME / APPOINTMENT (hot) ───────────────────────────────────
  {
    id: "realtime",
    name: "Real-Time Lead → Funded",
    tagline: "Synergy qualified them and emailed it in — they JUST hung up. Call in 60 seconds.",
    pipeline: "mca",
    revenue: "≈ $4,000 avg commission · lead cost $10–$20",
    entry: "Synergy emails the lead to sales@ → auto-parsed into a deal at New (HOT) with a 60-second call countdown.",
    workFrom: {
      screen: "Open the deal from the top of My Day — the countdown is running",
      route: "/admin/playbooks",
      appNote:
        "Synergy pre-qualified this merchant and emailed it to sales@ the instant the merchant hung up — the system already parsed it into a deal at New, pinned it to the TOP of your My Day with a red 60-second countdown, and dropped their full qual (revenue, FICO, funding request, existing balances) into the snapshot. This is the closest thing to a live transfer without the phone handoff: the merchant is expecting your call RIGHT NOW. Speed is the entire product — call before the countdown hits zero.",
    },
    steps: [
      {
        n: 1,
        title: "CALL NOW — before the countdown hits zero",
        stageKey: "new",
        automation: "MCA 01 — Speed to Lead",
        sla: "First call < 60 seconds (hard countdown)",
        tone: "speed",
        do: [
          "The deal is already created and at the top of My Day with a live countdown — open it and CALL immediately.",
          "The merchant literally just finished with Synergy and expects you; open like an expected call, not a cold one.",
          "No answer? Redial now → +2m → +5m → +15m before letting it fall to nurture. A $10–$20 lead you don't call fast is money lit on fire.",
        ],
        route: { to: "/admin/deals", label: "Open the hot deal (top of My Day)" },
        say: "Hi [First Name]? [Closer] with Momentum Funding — you were just speaking with our team about working capital for [Business Name]. Got you right here — let's get you options.",
        note: "If the countdown expires uncalled it re-alerts + reassigns to the next closer, then pings the manager. Don't let it.",
      },
      {
        n: 2,
        title: "Verify Synergy's pre-qual (don't re-interrogate)",
        stageKey: "contacted",
        do: [
          "Synergy already vetted revenue / FICO / funding request / existing balances — it's in the snapshot. CONFIRM, don't re-run a full cold qualify.",
          "Quick verify + update the fields below, then Status → Contacted.",
        ],
        say: "I've got your details in front of me — about [revenue]/month, looking for [amount] for [use]. Just confirming that's all accurate before I pull your options.",
        collect: ["Confirm revenue", "Confirm TIB", "Confirm amount + use", "Confirm existing positions (≥2 → VCF)"],
        fields: MCA_QUALIFY_FIELDS,
        explain: APPROVAL_SIZING_EXPLAIN,
        tone: "branch",
      },
      {
        n: 3,
        title: "Confirmed → Qualifying + send the app (same call)",
        stageKey: "qualifying",
        automation: "MCA 03 — Qualifying",
        do: [
          "Everything checks → Status → Qualifying and send the app on THIS call while they're hot.",
          "Set expectations: e-sign app + secure upload link.",
        ],
        say: "You're a strong fit. Stay with me two minutes — I'll send your application pre-filled right now; just tap to sign.",
      },
      ...MCA_CLOSE_STEPS,
    ],
  },

  // ─────────────────────────────────────────── COLD EMAIL (Instantly) ───────────────────────────────────────────
  {
    id: "cold-email",
    name: "Cold Campaign Reply → Funded",
    tagline: "Someone replied to our cold email campaign. They raised a hand — re-engage warm.",
    pipeline: "mca",
    revenue: "≈ $4,000 avg commission · list cost $0.01–$0.05/record, emailed at scale",
    entry: "We buy a cold list (Aged/UCC/Trigger) → load it into Instantly → email it → an interested REPLY comes back (garbage filtered) → deal at New (cool).",
    workFrom: {
      screen: "Open the deal — read what they replied to, then re-engage on that thread/offer",
      route: "/admin/deals",
      appNote:
        "This is the ONLY cold path, and it's email-only — nobody dials a cold list. We bought a list (Aged/UCC/Trigger) from Synergy, loaded it into Instantly, and emailed it; this person REPLIED with interest. The system filtered out the 'remove me' / junk, classified this as interested, created a deal at New (cool), tagged with the campaign, and auto-stopped their sequence. They are NOT pre-qualified — they answered an email, not a phone screen. So: reference the specific offer they replied to, then qualify from scratch.",
    },
    steps: [
      {
        n: 1,
        title: "Re-engage the reply (< 15 min — they're at their desk)",
        stageKey: "new",
        automation: "MCA 01 — Speed to Lead",
        sla: "First contact < 15 min of the reply",
        tone: "speed",
        do: [
          "Open the deal; read the campaign tag + their reply so you reference the exact offer they responded to.",
          "They just emailed from their desk — reply/call fast while it's top of mind. Set the Campaign for ROI.",
          "Reply on the same thread or call; either way, be a human following up on THEIR message.",
        ],
        route: { to: "/admin/deals", label: "Admin → Deals → open the cold-email lead" },
        say: "Hi [First Name], [Closer] from Momentum Funding — thanks for replying about [campaign offer]. Happy to walk you through it. Are you the owner of [Business Name], and do you have a couple minutes?",
      },
      {
        n: 2,
        title: "Qualify fresh (they're a cold prospect)",
        stageKey: "contacted",
        do: [
          "They replied to an email — you know nothing yet. Run the full BANT-F, type answers into the fields below.",
          "Move Status → Contacted.",
        ],
        say: "So I can point you at the right option — how long in business, roughly what's monthly revenue, how much are you looking for, and are you making payments on any existing advances?",
        collect: ["6+ months in business", "$15K+/mo revenue", "Amount + use of funds", "Existing advances (≥2 → VCF)"],
        fields: MCA_QUALIFY_FIELDS,
        explain: APPROVAL_SIZING_EXPLAIN,
        tone: "branch",
      },
      {
        n: 3,
        title: "Qualifies → Qualifying + send the app",
        stageKey: "qualifying",
        automation: "MCA 03 — Qualifying",
        do: [
          "Passed BANT-F → Status → Qualifying and send the application (< 24h).",
          "Set expectations: e-sign app + secure upload link.",
        ],
        say: "Great — you qualify. Give me two minutes and I'll send your application pre-filled; all you do is tap to sign.",
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
        title: "Collect the positions",
        stageKey: "positions_analysis",
        automation: "VCF 03 — Positions & Balances Analysis",
        sla: "Chase 14 days by email",
        do: [
          "Email the secure upload link. Collect every current MCA agreement + 2–3 months of statements showing the debits.",
          "Track what's in via the deal's Documents tab / Admin → Doc Review; move Status → Positions Analysis. Tally every position, balance, and daily/weekly debit.",
          "Get a DAY out of them for the statements and type it into “Statements promised by” below — a distressed merchant is the most likely to go quiet, and that date is what My Day chases on.",
        ],
        collect: ["Every current MCA agreement", "2–3 months bank statements showing the debits", "Hardship note (optional)"],
        fields: [
          { key: "stips_promised_by", label: "Statements promised by", kind: "date", target: "deal", column: "stips_promised_by", hint: "The day THEY committed to. If it passes with no statements, My Day surfaces this deal as an overdue chase." },
        ],
        say: "I'll email you a secure link right now to upload your last few statements and advance agreements. A specialist will call within 24 hours with your plan. What's the best email for that link? … And when can you get those statements back to me? Can I count on [day]?",
        route: { to: "/admin/documents", label: "Admin → Doc Review" },
      },
      {
        n: 5,
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
        n: 6,
        title: "Handle objections",
        do: [
          "Is this a loan? → No, the main program reduces what you owe; nothing's added unless it lowers your payment.",
          "What's the cost? → No upfront out-of-pocket fees.",
          "Credit impact? → Often no negative impact; the specialist explains your case.",
          "Is it legit? → Attorney-led, 30+ yrs, $100M+ restructured, free review, decide at the end.",
        ],
      },
      {
        n: 7,
        title: "Send the engagement agreement",
        stageKey: "agreement_sent",
        automation: "VCF 05 — Agreement Sent",
        do: [
          "Send the engagement agreement for e-signature; reminders email at +4h / Day 1 / Day 2.",
          "Clicking below moves Status → Agreement Sent and fires the e-sign automation — the merchant gets the agreement to sign.",
        ],
        route: { to: "/admin/deals", label: "Send the agreement (moves to Agreement Sent)" },
        note: "Nothing goes to the VCF partner until the engagement is signed.",
      },
      {
        n: 8,
        title: "Submit to VCF",
        stageKey: "submitted_to_vcf",
        automation: "VCF 06 — Submitted to VCF",
        do: [
          "Once the engagement is signed, submit the file to the VCF partner and move Status → Submitted to VCF.",
          "The attorney team does all closing — you just refer.",
        ],
        route: { to: "/admin/deals", label: "Advance the VCF deal" },
        note: "All closings are done-for-you by the attorney-led team. Your job ends at a clean submission.",
      },
      {
        n: 9,
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

  // ─────────────────────────────────────────── RENEWAL → SECOND ADVANCE ───────────────────────────────────────────
  {
    id: "renewal",
    name: "Renewal → Second Advance",
    tagline: "A funded merchant is paying down. Turn their track record into a second advance — the cheapest deal you'll ever close.",
    pipeline: "mca",
    revenue: "6 points on renewal · ≈ $3,000 avg per renewal · 45–60% of funded merchants take one",
    entry: "From Admin → Renewals (/admin/renewals): the MCA 12 automation fires renewal emails at 40%, 60%, 75%, and 100% paydown. Every merchant on that board is already warmed — you're following up, not cold-calling.",
    workFrom: {
      screen: "The Renewals board — pick a merchant, then create their renewal deal",
      route: "/admin/renewals",
      appNote:
        "Start on Admin → Renewals (/admin/renewals): it lists funded merchants by paydown %, and MCA 12 has already emailed them at their trigger. Work the hottest first (75%+). When they say yes, create a NEW deal for that customer with the Renewal box checked (is_renewal = true) — that's what makes it commission at 6 points instead of 8. From there it's the same deal page as any MCA, just lighter: the incumbent funder already holds their history.",
    },
    steps: [
      {
        n: 1,
        title: "Spot the trigger — work the board hottest-first",
        stageKey: "new",
        automation: "MCA 12 — Renewal Triggers (fires at 40 / 60 / 75 / 100% paydown)",
        sla: "Same day the trigger fires",
        tone: "speed",
        do: [
          "Open Admin → Renewals (/admin/renewals). It lists every funded merchant with their live paydown %; the ones at a trigger are flagged.",
          "Call order: 75%+ paid down = HOTTEST (best terms, most eager) → then 100% (advance nearly done) → then 60% → then 40% (earliest, softest ask).",
          "MCA 12 already emailed them at their trigger, so open with that: they've SEEN the 'you may qualify for more' note. You're the follow-up, not a surprise.",
          "When they're interested, create the renewal deal: New deal on their customer with the Renewal box checked (is_renewal = true). Everything downstream keys off that flag.",
        ],
        route: { to: "/admin/renewals", label: "Admin → Renewals" },
        note: "Renewals are the cheapest deals you'll ever fund — no lead cost, no cold call, a merchant who already trusts you and has a funder who already knows them. 45–60% take one. This is the highest-margin motion in the whole business.",
      },
      {
        n: 2,
        title: "The renewal call — match the pitch to their trigger",
        stageKey: "contacted",
        automation: "MCA 12 — Renewal Triggers",
        sla: "65%+ contact rate on your own funded book",
        explain: RENEWAL_NET_EXPLAIN,
        do: [
          "Open the deal (/admin/deals/:id) and move Status → Contacted once you reach them; log the call in the Activity tab.",
          "Use the script for THEIR paydown tier (below) — the ask is different at 40% vs. 100%.",
          "Quote the NET, not the gross. The renewal pays off their remaining balance first; say the number that actually hits their account (see 'How renewals size' above).",
        ],
        say:
          "40% paid down: “[First Name], you're about 40% through your advance and paying like clockwork — that track record means you may already qualify for additional capital. Want me to run the numbers?”\n" +
          "60% paid down: “You're more than halfway paid down, so I can put a renewal offer together right now. It pays off what's left and puts fresh capital on top — want to see the net?”\n" +
          "75% paid down: “This is the best window you'll get — you're 75% paid down, which unlocks our most favorable renewal terms. Let's lock it in before the balance runs off.”\n" +
          "100% paid down: “You've paid this one off in full — congratulations. You've earned the strongest terms we offer. Ready for the next round?”",
        note: "Incumbent funder usually beats new paper on a renewal — faster approval, better terms, because they own the payment history. Frame it as a reward for good repayment, never as 'more debt'.",
      },
      {
        n: 3,
        title: "Re-qualify light — only what changed",
        stageKey: "qualifying",
        automation: "MCA 03 — Qualifying",
        do: [
          "You already know this merchant — do NOT re-run the full BANT-F. Confirm just three things: current monthly revenue, current balance / paydown, and any NEW positions taken since you funded them.",
          "On the deal page move Status → Qualifying and update the numbers on the Customer record (/admin/customers/:id).",
          "CHECK FOR NEW STACKING: if they've taken on 2+ new advances since your deal, the renewal may not clear — size down or, if they're underwater, switch to the VCF playbook.",
        ],
        say: "Just need to refresh a couple numbers since we funded you. Roughly what's monthly revenue running now? And have you taken any other advances since ours — anybody else pulling daily or weekly?",
        collect: [
          "Current monthly revenue (has it grown?)",
          "Current balance / paydown % (confirm against the Renewals board)",
          "Any NEW positions since funding (≥2 new → size down or route to VCF)",
        ],
        fields: [
          { key: "monthly_revenue", label: "Current monthly revenue ($)", kind: "money", target: "customer", column: "monthly_revenue", placeholder: "28000" },
          { key: "amount_requested", label: "Renewal amount requested ($)", kind: "money", target: "deal", column: "amount_requested", placeholder: "60000", hint: "Gross approval target — the net after payoff is what you quote the merchant." },
        ],
        tone: "branch",
        note: "Minimal friction — this is a returning customer, not a fresh lead. The whole point of a renewal is that it's fast.",
      },
      {
        n: 4,
        title: "Docs light — usually 1–2 recent months",
        stageKey: "bank_statements",
        automation: "MCA 06 — Bank Statements (Sequence A)",
        sla: "Short chase — most of the file already exists",
        tone: "leak",
        cta: "Send the upload link (moves to Bank Statements)",
        do: [
          "The incumbent funder already has the original application and history, so a renewal typically needs just the 1–2 MOST RECENT months of statements to show current activity — not a fresh 4-month package.",
          "Send the secure 'Bank Statements & Documents Upload' link (same link as a new deal); move Status → Bank Statements as they arrive.",
          "Review what's in via Admin → Doc Review (/admin/documents). Sequence A chases anything missing, but there's far less to chase here.",
          "Pin them to a day for the statements and type it into “Statements promised by” below — even on an easy renewal, an open-ended “I'll get to it” is how a 48-hour deal turns into a 2-week deal.",
        ],
        collect: ["Last 1–2 months bank statements (upload)", "Updated voided check ONLY if their bank changed"],
        fields: [
          { key: "stips_promised_by", label: "Statements promised by", kind: "date", target: "deal", column: "stips_promised_by", hint: "The day THEY committed to. If it passes with no statements, My Day surfaces this deal as an overdue chase." },
        ],
        say: "Almost nothing to gather since you're already in our system — just your last month or two of statements so the funder sees current activity. I'll email you the secure link; upload takes about a minute. When can you get those over to me? … Great, I'll put you down for [day] — can I count on that?",
        route: { to: "/admin/documents", label: "Admin → Doc Review" },
        note: "Way less friction than a new deal — the funder already holds the original file. Don't over-ask; requesting a full 4-month package on a renewal is the #1 way to stall an easy deal.",
      },
      {
        n: 5,
        title: "Submit — incumbent funder FIRST",
        stageKey: "submitted_to_funder",
        automation: "MCA 07 — Submission Orchestrator (submit-to-funders fn)",
        sla: "Incumbent usually responds fastest",
        do: [
          "Open the deal → Submissions tab. Submit to the INCUMBENT funder first — the one who holds the current advance. They know the payment history, approve fastest, and usually give the best renewal terms.",
          "Only go wide (3–5 funders, like a new deal) if the incumbent's offer is weak or they pass.",
          "When offers land, compare on NET dollars to the merchant, not gross approval — a bigger gross with a bigger payoff can net LESS. Present the net side-by-side.",
        ],
        route: { to: "/admin/deals", label: "Deal → Submissions tab" },
        say: "Good news — I'm putting your renewal in front of your current funder first since they already know your history, which usually means the fastest yes and the best terms. I'll have numbers back to you within a day.",
        note: "Net-funding math matters most here: new advance − remaining balance = what the merchant actually receives. When you compare two offers, rank them by that net number, and that's the only number you quote.",
      },
      {
        n: 6,
        title: "Fund → restart the clock",
        stageKey: "funded",
        automation: "MCA 11 — Funded → Renewal",
        tone: "win",
        do: [
          "When the funder confirms the deposit, move Status → Funded. Commission auto-calculates at 6 points × the renewal split (see Admin → Commissions) — because this deal is flagged is_renewal.",
          "The Day-1 congrats + Google review + referral-ask email fires automatically — ask for the referral AGAIN; repeat renewers are your best referral source.",
          "Renewal triggers re-arm automatically off the NEW deal's paydown %. This same merchant reappears on Admin → Renewals for the next round — the flywheel just keeps turning.",
        ],
        fields: [
          { key: "amount_funded", label: "Amount funded — gross ($)", kind: "money", target: "deal", column: "amount_funded", placeholder: "60000", hint: "Gross funded amount. Saving this + marking Funded auto-creates the 6-point renewal commission." },
        ],
        route: { to: "/admin/renewals", label: "Admin → Renewals" },
        say: "Done, [First Name]! Your renewal funded and the net is in your account. Same deal as before — send any owner who needs capital my way and there's a $100 gift card in it for you on every one that funds.",
        note: "Renewal commission is 6 points (≈ $3,000 on $50K) at the renewal split — lower gross than a new deal, but near-zero acquisition cost makes it the highest-margin dollar you earn. And it re-arms itself: fund it, and the next renewal is already scheduled.",
      },
    ],
  },
];

export const getPlaybook = (id: string) => PLAYBOOKS.find((p) => p.id === id);
