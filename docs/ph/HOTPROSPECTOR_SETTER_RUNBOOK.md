# HotProspector — Setter Onboarding & Daily Runbook

*MFunding.net / Momentum Funding · PH appointment-setter operation. Companion: `HOTPROSPECTOR_SETTER_SCRIPT.md`.*

## What HotProspector is (and where a setter works)
HotProspector (app.hotprospector.com) is the **PowerDialer** — a setter's home base for ~90% of the day. It auto-dials a list, pops the merchant's info on a live answer, and lets the setter log an outcome (disposition), book an appointment, or transfer to a closer.

**The stack, in plain terms:**
- **HotProspector** = the dialing engine (where setters work).
- **VibeReach / GoHighLevel** = the CRM + pipeline + follow-up (system of record). HotProspector is **natively connected** to it via one-click OAuth — contacts sync GHL→HP automatically, and every disposition writes back to the GHL contact **instantly** and fires GHL workflows. No double entry.
- **The app's `/admin/dialer` page** = the manager's scoreboard (per-rep KPIs, RAG, dispositions). Not for setters.

## Pre-launch setup (owner — one-time, in the HP dashboard)
Verified account state as of setup: GHL sync is LIVE (4 groups — Customers/Leads/Unassigned/DNC — and 104 GHL tags synced in). Still needed before anyone can dial:
1. **Add each setter as a Member** (Members → Add) → gives them a login + assign a caller-ID number. *(Account creation is a dashboard step.)* You have 3 seats.
2. **Register the caller-ID number(s)** for number-health monitoring (spam/scam-likely tracking).
3. **Confirm the `Leads` group has leads** — GHL contacts sync here automatically; UCC/aged batches can also be pushed straight in.
4. **Build a Campaign** on the `Leads` group (dialing window, caller-ID, attach the script). *(Campaigns are created in the HP dashboard — no API for this.)*
5. **Assign the setter** to that campaign.

## Day-one onboarding checklist (per setter)
- [ ] Login works at app.hotprospector.com; caller-ID assigned.
- [ ] Assigned to the correct campaign + `Leads` group.
- [ ] Walked through the daily flow (below) on 2–3 live dials with a manager listening.
- [ ] Knows the disposition set cold (below) and uses one on **every** call.
- [ ] Has the script open (UCC poaching pitch + objection handling).
- [ ] Understands the compliance rules (below) — this is non-negotiable.
- [ ] Knows their daily targets (KPIs below).

## The setter's PRIMARY objective (in priority order)
On every live call, the goal is to get, **while still on the phone:**
1. **A signed application (e-sign).**
2. **Bank statements** — either the merchant **connects Plaid** (~60s, best) or sends **4 months of statements** via the upload link.
**Fallback only if you can't get either live:** book an **appointment / callback**. The appointment is the *backup*, not the goal.

## The daily flow (what a setter does all day)
1. Log in → open the assigned **campaign** → start the dialer.
2. On a live answer, the lead card shows the business (for UCC leads, that they already have funding). Read the **Scripts** tab.
3. Get the verbal yes → **send the application + bank request right now** (see next section) → keep them on the line and walk them through **e-signing** and **connecting Plaid** (or sending statements).
4. **Set a disposition on every call** — this writes back to GHL/VibeReach and fires the follow-up workflow.
5. If they won't sign/connect live → **book the appointment/callback** (fallback) and disposition it. Then next call.
6. Keep dialing toward the daily number.

## How a setter sends the application + Plaid/upload from HotProspector
Two real paths (both visible on the lead card — Email/Sms tabs, ✉️/💬 icons, Contracts, and a "GoHighLevel Custom Link"):
- **Disposition/tag → GHL workflow (recommended for the real docs).** Our e-sign application and the **Plaid Connect-Bank + upload links are per-merchant / tokenized**, so they can't live in a static template. The clean way: the setter applies a tag/disposition (e.g. "send-application") → it syncs to GHL instantly → the GHL workflow emails/texts that merchant their **e-sign app + Connect-Bank link + upload link** (from send.mfunding.net). The setter says "check your email/text now while I'm on the line."
- **HP Email/SMS templates (for generic/first-touch).** From the lead card, ✉️ Email or 💬 Sms → pick a template → send. Good for generic content; NOT for the per-merchant tokenized links unless merge-fielded.
- The **"GoHighLevel Custom Link"** on the lead card jumps the setter straight to the GHL contact if they need it.

## Dispositions (use one on every call)
Keep them mapped to the funnel + GHL workflows:
- **Booked / Appointment** — meeting or callback scheduled (triggers the appointment workflow).
- **Transfer** — handed live to a closer.
- **Hot Lead** — interested, needs follow-up.
- **Callback** — reach later (set the time).
- **Not Interested** — declined.
- **No Answer / Voicemail** — leave the VM script.
- **Bad Number / Wrong Contact.**
- **DNC** — do-not-call; honor immediately, never dial again.

## KPIs — what a setter is measured on (see `/admin/dialer`)
Targets are RAG-graded (🟢/🟡/🔴) and tunable. Launch defaults:
- **Dials/day:** 🟢 ≥200 (target 200–350) · 🟡 120–199 · 🔴 <120
- **Talk time:** 🟢 ≥150 min · 🟡 75–149 · 🔴 <75
- **Idle/gap:** 🟢 <45 min · 🔴 >90 min
- **Connect rate:** 🟢 ≥10% · 🟡 5–9% · 🔴 <5%
- **Conversations/day:** 🟢 ≥20
- **Prospects/day:** 🟢 ≥3 · 🔴 0
- **Appointments + transfers/day:** 🟢 ≥2 · 🔴 0
- **Conversion (convo→prospect):** 🟢 ≥15%
Managers review the leaderboard daily and coach the reds.

## Compliance — non-negotiable (MCA rules)
- **It is NOT a loan.** It's a **merchant cash advance / working capital / funding** — a purchase of future receivables. Never say "loan" for MCA products.
- **Identify yourself and the company** on every call ("Hi, this is ___ with Momentum Funding").
- **No upfront fees** — we're paid by the funder, never the merchant.
- **No guarantees** — never promise approval, a rate, or an amount.
- **Honor DNC / opt-out immediately** — mark DNC and never re-dial.
- **Call only within legal hours** (8am–9pm the merchant's local time).
- **Don't misrepresent** how we got their info or who we are.
> The call script must pass a compliance review before live dialing. See `HOTPROSPECTOR_SETTER_SCRIPT.md` (currently DRAFT).
