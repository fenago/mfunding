// Revenue Playbooks — step-by-step closer instructions for the 3 flows that
// generate revenue. Content distilled from the MFunding funnel/follow-up docs,
// the brokerage playbook, and the VCF call scripts.

export type StepTone = "leak" | "win" | "branch" | "speed";

export interface PlaybookStep {
  n: number;
  title: string;
  stageKey?: string; // maps to a pipeline stage (for the funnel)
  sla?: string;
  do: string[]; // what the closer does
  say?: string; // verbatim script
  collect?: string[]; // docs / info to gather
  route?: { to: string; label: string }; // where to do it in the app
  tone?: StepTone;
  note?: string;
}

export interface Playbook {
  id: "website" | "live-transfer" | "vcf";
  name: string;
  tagline: string;
  pipeline: "mca" | "vcf";
  revenue: string;
  entry: string;
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
    entry: "Inbound: merchant submits the form at /apply",
    steps: [
      {
        n: 1,
        title: "New lead lands",
        stageKey: "new",
        sla: "First touch < 5 min",
        tone: "speed",
        do: [
          "Merchant submits the application form on the website.",
          "Speed-to-Lead fires: auto-response + round-robin assignment + a 'call in 5 min' task.",
          "Open the deal and claim it.",
        ],
        route: { to: "/admin/deals", label: "Deals pipeline" },
        note: "Every minute of delay costs ~10% contact rate on web leads. Call within 5 minutes.",
      },
      {
        n: 2,
        title: "First contact",
        stageKey: "contacted",
        sla: "65%+ contact rate",
        do: ["Call immediately. If no answer, text + voicemail and start Sequence B.", "Confirm they own the business and it's a good time."],
        say: "Hi [First Name], it's [Closer] from Momentum Funding — you just requested working capital for [Business Name]. I'm not here to sell you anything, just to understand your situation and see if we're a fit. Do you have 5 minutes?",
        route: { to: "/admin/deals", label: "Log the call on the deal" },
      },
      {
        n: 3,
        title: "Qualify (BANT-F)",
        stageKey: "qualifying",
        do: [
          "Run the 5-question checklist. If they're carrying ≥2 active advances or struggling → tag route-to-vcf and switch to the VCF playbook.",
        ],
        say: "Let me ask five quick questions so I can find the right options. How long have you been in business? Roughly what's your monthly revenue? How much are you looking for, and what for? And — are you currently making any daily or weekly payments on other advances?",
        collect: [
          "Time in business (6+ months)",
          "Monthly revenue ($15K+ min, $20K+ preferred)",
          "Amount needed + use of funds",
          "Industry (no cannabis / adult / firearms / nonprofit)",
          "Existing advances? (≥2 → route to VCF)",
        ],
        tone: "branch",
      },
      {
        n: 4,
        title: "Send the application",
        stageKey: "application_sent",
        sla: "Same day",
        do: ["Text + email the app link with the state-specific disclosure.", "Reminders at +4h and Day 1."],
        say: "Based on what you told me, you look like a solid fit. I'm texting you a 3-minute application plus a secure link to connect your bank so we can verify revenue. Want me to walk you through it now?",
      },
      {
        n: 5,
        title: "Collect docs + bank statements",
        stageKey: "bank_statements",
        sla: "14-day chase (Sequence A) — stop the instant statements arrive",
        tone: "leak",
        do: ["Get the 4 stips + 3 months of bank statements (Plaid preferred — 60 seconds).", "Run the Day 0/1/2/4/7/10/14 chase until docs are in."],
        collect: ["Signed application", "Owner photo ID", "Voided business check", "Credit/ACH authorization", "3 months bank statements (or Plaid)"],
        say: "Quick follow-up [First Name] — I've got a funder reviewing files today and I'd love to get yours in. Just connect your bank in 60 seconds → [Plaid Link], or text me photos of your last 3 statements.",
        note: "#1 FUNNEL LEAK — only ~50–60% of apps survive this. Plaid = 60s vs. days for manual.",
      },
      {
        n: 6,
        title: "Submit to 3–5 funders",
        stageKey: "submitted_to_funder",
        sla: "5-day SLA per funder",
        do: ["Match deal to 3–5 funders (A/B/C paper).", "Package signed app + statements + stips and submit in parallel.", "If all decline → resubmit to tier-2 / route to VCF if stacked."],
        route: { to: "/admin/deals", label: "Submit from the deal" },
        say: "Great news — I've sent your file to our top funding partners. They usually respond in 24–48 hours and I'll call you the moment offers come in.",
      },
      {
        n: 7,
        title: "Present offers (always 2+)",
        stageKey: "offer_presented",
        sla: "70–80% acceptance",
        do: ["Collect every offer (amount, factor, term, payment).", "Present 2+ side-by-side and frame to cash flow."],
        say: "I've got two options. Option A is more capital with slightly higher payments; Option B is lower payments. Which feels better for your weekly cash flow?",
      },
      {
        n: 8,
        title: "Accept + e-sign",
        stageKey: "offer_accepted",
        do: ["Send the funder agreement for e-signature.", "Reminders at +4h, Day 1, Day 2.", "Ops coordinates funding."],
        say: "Perfect — I'm emailing the contract now. Quick e-signature, about 2 minutes. Once you sign, the funder finalizes and you should see funds by [date].",
      },
      {
        n: 9,
        title: "Funded → renewal pipeline",
        stageKey: "funded",
        tone: "win",
        do: ["Confirm deposit. Commission auto-calculates.", "Day-1 congrats + Google review + $100 referral ask.", "Arm renewal triggers at 40/60/75/100% paydown."],
        route: { to: "/admin/renewals", label: "Renewals monitor" },
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
    steps: [
      {
        n: 1,
        title: "Transfer connects (0–60s)",
        stageKey: "new",
        sla: "First touch < 60 seconds — you're already on the call",
        tone: "speed",
        do: ["Pick up energized. The merchant is LIVE and expecting you.", "Treat it like you called them — warm, not pushy."],
        say: "Hi, is this [First Name]? This is [Closer] with Momentum Funding — I see you're looking for working capital. Quick question: are you the owner of [Business Name]?",
      },
      {
        n: 2,
        title: "Qualify in 3 quick questions (next 30s)",
        stageKey: "contacted",
        do: ["Rapid-fire, conversational. Listen for disqualifiers."],
        say: "How long have you been running [Business Name]? … Ballpark monthly revenue? … And what would the capital go toward — payroll, inventory, cash flow?",
        collect: ["6+ months in business", "$15K+/mo revenue", "Use of funds", "Not a prohibited industry"],
        note: "Under 6 months or under $15K/mo → exit politely and tag soft_no / nurture.",
        tone: "branch",
      },
      {
        n: 3,
        title: "The ask (45s)",
        do: ["Lock the next step: text the application link while on the call.", "Confirm their cell number out loud."],
        say: "Based on what you've told me, you likely qualify. I'm going to text you a 3-minute application right now — no cost, zero credit impact. What's the best cell? … Texting it now from Momentum. Open it when you can and I'll follow up tomorrow.",
      },
      {
        n: 4,
        title: "Log it immediately",
        stageKey: "contacted",
        do: ["Create/advance the deal: status contacted, lead_source live_transfer, vendor name.", "Send the app link within 60 seconds.", "If no app by +2h → start Sequence B (No-Answer 7-day)."],
        route: { to: "/admin/deals", label: "Create the deal" },
      },
      {
        n: 5,
        title: "Then follow the Website Lead flow",
        do: ["From here it's the same MCA path: qualify → application → docs (Sequence A) → submit → offers → funded.", "Open the Website Lead playbook for steps 3–9."],
        note: "A live transfer just gets you to 'contacted' faster — the rest of the pipeline is identical.",
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
    steps: [
      {
        n: 1,
        title: "Identify the distressed merchant",
        stageKey: "new_distressed",
        do: [
          "Best source is your own CRM: declined MCA applicants, funded merchants now stacked, anyone who went cold because payments got tight.",
          "Also: UCC filing data (merchants with active MCAs).",
        ],
        route: { to: "/admin/customers", label: "Mine the customer list" },
        note: "Warm, zero-cost, highest-converting VCF channel. Never name 'Value Capital Funding' — it's white-label.",
      },
      {
        n: 2,
        title: "Outreach call",
        stageKey: "hardship_consult",
        do: ["Open with empathy, not a pitch. Find out if they're carrying daily/weekly payments."],
        say: "Hey [First Name], it's [Closer] from Momentum — we spoke a while back about working capital. I'm not calling to sell an advance. A lot of folks who got a 'no' are already carrying advances eating their cash flow, and I now help owners get those payments DOWN. Are you making any daily or weekly payments on advances right now?",
      },
      {
        n: 3,
        title: "Qualify (5 questions)",
        stageKey: "hardship_consult",
        do: ["Get the stacking picture. Qualified = $50K+ total MCA/business debt, multiple positions or clear hardship, decision-maker."],
        say: "How many advances/positions are you carrying? … Total balance across all of them? … Combined daily or weekly payment? … Who are the funders? … What's making it hardest right now — slow season, a big debit, payroll?",
        collect: ["# of positions", "Total balance ($50K+ qualifies)", "Combined daily/weekly debit", "Funder names", "Hardship reason"],
        tone: "branch",
      },
      {
        n: 4,
        title: "The pitch",
        stageKey: "strategy_proposal",
        do: ["Explain simply: attorney-led team renegotiates existing advances → one lower payment (often 50–75% less). Optional FDIC bank loan refi. No upfront fees."],
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
        sla: "Chase 14 days (Sequence A style)",
        do: ["Text the secure upload link immediately.", "Tally every active position, balance, and daily/weekly debit."],
        collect: ["Every current MCA agreement", "2–3 months bank statements showing the debits", "Hardship note (optional)"],
        say: "I'll text you a secure link right now to upload your last few statements and advance agreements. A specialist will call within 24 hours with your plan. Best number for that text?",
      },
      {
        n: 7,
        title: "Agreement + submit to VCF",
        stageKey: "submitted_to_vcf",
        do: ["Send the engagement agreement for e-signature (reminders +4h/Day1/Day2).", "Submit the file to the VCF partner. The attorney team does all closing — you just refer."],
        route: { to: "/admin/deals", label: "Advance the VCF deal" },
        note: "All closings are done-for-you by the attorney-led team. Your job ends at a clean submission.",
      },
      {
        n: 8,
        title: "Restructured → servicing",
        stageKey: "restructure_executed",
        tone: "win",
        do: ["Positions consolidated; payment restructured. Congrats + review + referral ask.", "Quarterly check-ins; watch for when they're healthy enough for new funding."],
        say: "[First Name], your positions are restructured and your payment is way down. When cash flow is healthy again, I'm here to help you grow. Know any owners in the same spot? I can help them too.",
        note: "Recurring commission pays weekly/monthly over the 12–24 month program — keep the relationship warm.",
      },
    ],
  },
];

export const getPlaybook = (id: string) => PLAYBOOKS.find((p) => p.id === id);
