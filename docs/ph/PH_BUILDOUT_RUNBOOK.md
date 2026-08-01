# PH Setter Operation — Human Buildout Runbook

**Agentic Voice, Inc. — d/b/a MFunding.net | Momentum Funding**
**Audience:** Owner (Ernesto) + Developer (Khalil)
**Last updated:** July 31, 2026

---

## What this document is

The PH Setter Operation is a **new, parallel outbound line**: two Philippine-based
setters dial UCC lists all day, drive every live call to a **complete file**
(e-signed application + Plaid bank connect), and hand the record off to the
existing business **only** at the "Bank Connected" stage.

Everything a machine *can* do is being built for you right now by other
automated teammates — the pipeline, the per-stage automations, the packet
edge function, the Revenue Playbook, the setter scorecard, and the campaign
wiring. **This runbook covers only the steps a machine cannot do**: buying
things, clicking inside GHL's API-blocked screens, judging vendor demos,
buying data, and hiring/managing people.

Do the steps in order. Each step says **who** does it, **how long**, the
**exact clicks**, how to **verify** it worked, and **what it unblocks**.

### NAMING LAW (non-negotiable)

Every new asset you create is prefixed **`PH`**. Never touch, rename, or edit
the existing MCA or VCF pipelines, playbooks, workflows, or document
templates — they are **read-only** to this project. The PH line gets its own
pipeline, its own workflows, its own doc template, its own phone numbers, and
its own campaign codes so the existing business keeps running untouched and
the audit stays clean.

> **Naming note for the R&D plan page.** The plan surface at `/admin/rnd`
> still shows these assets under the older draft label **"SETTER —"**. The
> assets that were actually built in GHL use the final **"PH —"** prefix
> (e.g. the live pipeline is **"PH — Outbound Setters"**). When the plan says
> "SETTER 01 — Packet Send," the real workflow you create is **"PH 01 —
> Packet Send."** Same thing, final name wins.

### The verified facts this runbook is built on

| Fact | Value |
|------|-------|
| GHL location (MFunding.net) | `t7NmVR4WCy927j4Zon4b` |
| PH pipeline (already created) | **PH — Outbound Setters** · `ZTSCCAEt9wFI6rfdPsLD` |
| Handoff pipeline (do not modify) | **MFunding MCA Pipeline** · `bG9ZEh4eP9x60E1CyaMx` |
| Connect-bank custom field | **PH Connect Bank URL** · merge tag `{{contact.ph_connect_bank_url}}` · id `OUlkd6rcVZ4ZrYTuPob4` |
| Sending email address | `sales@send.mfunding.net` |
| Doc template to duplicate | **04C MCA PARTIAL** · `6a5594fa268297575c2770d5` |
| Disclosure content to append | **Broker Compensation Disclosure** · `6a40dda27ded2344b54ecbce` |

> **Why some steps are human-only.** We confirmed empirically that GHL's API
> blocks the creation of **workflows, document/contract templates, and phone
> number purchases** — those three must be done by hand in the GHL web UI.
> That is why Steps 1–3 and 7 are click-by-click.

> **Compliance guardrail (applies to every word you type).** In PH copy,
> scripts, emails, and the doc template, an MCA is **never** a "loan." Use
> **funding**, **capital**, **working capital**, or **advance**. Scrub cell
> numbers for TCPA before dialing and honor DNC globally.

---

## STEP 1 — Buy 2 phone numbers

- **Who:** Owner
- **Time:** ~5 minutes
- **Cost:** ~$1.15–3/mo each + per-minute usage (far below the old $50 guess)

**Exact clicks:**
1. In the MFunding.net sub-account, go to **Settings → Phone Numbers → Add Number**.
2. Search area code **954** (Broward). If nothing clean is available, fall back to **754**.
3. Buy **two** numbers.
4. Rename them **`PH Setter 1`** and **`PH Setter 2`**.
5. **Do NOT** add either number to any ring group. These are dedicated outbound setter lines and must stay off the corporate rotation.

**Verify:** Both numbers appear in Settings → Phone Numbers, each labeled
`PH Setter 1` / `PH Setter 2`, and neither is a member of a ring group.

**Then hand off to Claude:** Tell Claude the two numbers so they get recorded
in `platform_settings.ph_settings.setter_numbers` (SQL is in
[Appendix A](#appendix-a--the-phsettings-sql)).

**What this unblocks:** Setters can be assigned working lines (Step 7); the
scorecard can attribute dials/calls to the right setter.

---

## STEP 2 — Create the two PH workflows

- **Who:** Owner or Khalil
- **Time:** ~10 minutes each
- **Note:** Build the **doc template in Step 3 first**, then come back and
  attach it here — or create these shells now and attach the template once it exists.

Workflows cannot be created through the API — they must be built in the GHL UI.
Both PH workflows are **enrollment-only**: they have **NO trigger**. This is a
house rule (July 13) — **a stage move must never auto-send documents.** The
setter (or the packet edge function) enrolls a contact deliberately.

### 2a. Workflow `PH 01 — Packet Send`

**Exact clicks:**
1. **Automation → Create Workflow → Start from scratch (blank).**
2. Name it **`PH 01 — Packet Send`**.
3. Leave the trigger **empty** (enrollment-only).
4. **Action 1 — Send Documents & Contracts** → select the template
   **`PH — Application + Disclosure (Combined)`** (built in Step 3).
5. **Action 2 — Send Email** → from `sales@send.mfunding.net`, paste the copy
   from [Appendix B](#appendix-b--ph-01-packet-email-copy) **verbatim**. The
   **CONNECT YOUR BANK** button's URL must be exactly `{{contact.ph_connect_bank_url}}`.
6. **Publish.**
7. Copy the **workflow ID** out of the browser URL (the long ID after
   `/workflow/`). Give it to Claude to store in `ph_settings.packet_workflow_id`.

**Verify:** Workflow shows **Published**, has no trigger, and both actions are
present. Send yourself a test enrollment and confirm the email arrives with a
working CONNECT YOUR BANK button.

### 2b. Workflow `PH 02 — File Complete Notify`

**Exact clicks:**
1. **Automation → Create Workflow → blank**, name it **`PH 02 — File Complete Notify`**.
2. Trigger **empty** (enrollment-only).
3. **Action — Internal Notification** (email/SMS to owner + closer): "PH file
   complete — [contact name] signed + bank connected. Ready for MCA pipeline handoff."
4. **Publish**, copy the workflow ID, give it to Claude for `ph_settings.notify_workflow_id`.

**Verify:** Published, no trigger, internal notification action present.

**What this unblocks:** The packet edge function (built by teammates) enrolls
contacts into `PH 01` to send the app + bank link; the "Bank Connected" stage
enrolls into `PH 02` so you're notified the moment a file is complete and
ready to hand to the MCA pipeline. Until the IDs are stored in `ph_settings`,
the automated enrollment has nothing to call.

---

## STEP 3 — Build the combined document template

- **Who:** Owner
- **Time:** ~20–30 minutes

You need **one** e-sign document that contains the application **and** the
broker compensation disclosure, ending in a **single** signature block.

**Exact clicks:**
1. Go to the GHL document/contract templates.
2. **Duplicate** the template **04C MCA PARTIAL** (`6a5594fa268297575c2770d5`).
   Never edit the original.
3. Rename the copy **`PH — Application + Disclosure (Combined)`**.
4. Open the **Broker Compensation Disclosure** template
   (`6a40dda27ded2344b54ecbce`), and **append its content as a new section** at
   the end of your combined doc.
5. Ensure there is exactly **ONE signature block**, at the very end (it covers
   both the application and the disclosure).
6. **Save**, then **reload the page** and re-open the template to confirm it
   actually saved.

> **Doc-editor gotchas (these have bitten us before):**
> - **Fillable fields never pre-fill.** They are write-back only. Do not rely
>   on them showing the merchant's data in advance.
> - **Type every merge tag manually.** GHL's autolink/auto-suggest corrupts
>   tags like `contact.business`, `contact.date`, `user.name` — type the exact
>   text yourself, don't click the suggestion.
> - **A broken variable silently blocks the save.** That's why you **reload
>   after Save** — if your edits are gone, a merge tag is malformed. Fix it and
>   re-save.
> - Keep all wording **advance/funding**, never "loan."

**Verify:** After a reload, the combined template shows both the application
section and the disclosure section, one signature block, and it is selectable
in the `PH 01 — Packet Send` workflow's Send Documents action.

**What this unblocks:** `PH 01 — Packet Send` (Step 2a) has a template to
send; setters can close the application live on the call.

---

## STEP 4 — Pick and buy the power dialer

- **Who:** Owner
- **Time:** 2 demos (book both this week)

Two front-runners. Both integrate with GHL; the decision is about call quality
to/from the Philippines and true two-way disposition sync.

| Dialer | Pricing | Parallel lines | Notes |
|--------|---------|----------------|-------|
| **Hot Prospector** | $137–497/mo flat | 3-line | Built for GHL, bring-your-own-Twilio |
| **PowerDialer.ai** | ~$45–199/user/mo | up to 5-line | Native GHL sync, PH-carrier-optimized |

**Demo checklist — ask/verify on every demo:**
- [ ] **Two-way GHL disposition sync?** When the dialer marks an outcome, does it
      write back to the GHL contact/opportunity — and vice versa? (This is what
      feeds the setter scorecard.)
- [ ] **PH-agent call quality** — test with an **actual PH-based tester** on the
      call, not just a US rep. Listen for latency and dropouts.
- [ ] **Parallel dialing** — confirm 3-line (minimum) works cleanly; note the
      path to 5-line.
- [ ] **True cost** — per-seat price **plus** Twilio/telephony usage. Get the
      all-in monthly number for 2 seats.

**Decision gate:** Pick one. Start with **power dialing + 3-line parallel**.
Do **not** go predictive until you have 10+ agents.

**Then hand off to Claude:** Tell Claude which dialer you chose and whether it
syncs dispositions to GHL, so the dialer→scorecard sync gets built to match.

**What this unblocks:** Setters have a dialer; Phase 2's scorecard can be wired
to the real disposition feed.

---

## STEP 5 — Buy the list data

- **Who:** Owner
- **Time:** ~30 minutes
- **Cost:** ~$500–850/mo

**Exact steps:**
1. Order **UCC list data from Klover Data**. Apply the **$100K+ originals**
   filter — targeting merchants whose existing advance was $100K+ roughly
   doubles your average deal size at no extra cost.
2. (Optional) Layer **aged Synergy data** as extra dialing ammo.
3. Run the file through a **TCPA cell-scrub service** before anything is dialed.
   Cells must be scrubbed; DNC is honored globally.

**Then hand off to Claude:** Give Claude the scrubbed file. Claude imports it
into the **`PH-UCC-2026-001`** campaign (own campaign code for clean audit
separation).

**Verify:** The import lands in the `PH-UCC-2026-001` campaign and records
appear at the **New List Lead** stage of the PH — Outbound Setters pipeline.

**What this unblocks:** There is something to dial — the whole operation.

---

## STEP 6 — Hire the 2 PH setters

- **Who:** Owner (with Khalil for the tooling walkthrough)
- **Time:** ~2 weeks elapsed (runs in parallel with Steps 1–5)

### 6a. Post the job

Post on **OnlineJobs.ph**, **The Calling Agency**, and **Techmart**. A
ready-to-paste JD is in [Appendix C](#appendix-c--job-description-draft).

### 6b. Screen and secure

Funnel: **voice sample → live roleplay on the objection scripts → paid 3-day
trial on aged data → hire.** Use the objection bank (already in the Revenue
Playbook / plan) for the roleplay.

**Security rules (per the Access Control Policy):**
- Setters **never** touch bank credentials — Plaid is read-only and the
  merchant does it themselves.
- **Individual logins only** — no shared accounts.
- **MFA required** on every account.
- **Offboarding = same-day revocation** of every login.

### 6c. Comp plan (never pay per appointment booked)

| Component | Amount |
|-----------|--------|
| Base | **$550/mo** |
| Per signed agreement | **$45** |
| Per Plaid bank connected | **$75** |
| Per fallback appointment **shown** | **$8** |
| Per funded deal (override) | **$120** |

A strong performer earns ≈ **$3,000–4,500/mo**. All-in for two setters ≈
**$3,200–3,400/mo** (~$10/hr equivalent). **Never pay per appointment
*booked*** — it rewards junk. Pay on signed, connected, shown, and funded.

### 6d. Training week

Scripts + objection drills + tool walkthrough (dialer, GHL, packet send, Plaid
explainer) + listen to the best real calls.

**What this unblocks:** You have humans to run Step 7 and launch.

---

## STEP 7 — Provision each setter in GHL + assign numbers/seats

- **Who:** Owner or Khalil
- **Time:** ~10 minutes per setter

GHL user creation is a UI task.

**Exact clicks:**
1. **Settings → My Staff → Add Employee** for each setter.
2. Give each a **limited role** — pipeline + conversations + dialer only; **no**
   settings, billing, or other pipelines. Individual login, **MFA on**.
3. Assign **PH Setter 1** number + a dialer seat to setter #1; **PH Setter 2**
   number + a seat to setter #2.
4. In the dialer, set the **call timeout to ~20 seconds** (lesson learned:
   longer timeouts waste dial capacity on no-answers).

**Verify:** Each setter can log in, sees only the **PH — Outbound Setters**
pipeline and their own number, and cannot reach settings or the MCA/VCF
pipelines.

**What this unblocks:** Setters can dial. Launch.

---

## STEP 8 — Launch checklist and gates

- **Who:** Owner
- **Time:** Weeks 1–2 ramp, then ongoing

**Launch checklist:**
- [ ] Scripts drilled — opener, application close, Plaid pivot, resistance
      ladder, fallback ladder, objection bank (all in the Revenue Playbook).
- [ ] Daily scorecards posted in the group chat.
- [ ] **Announce every Signed and every Plaid connected** in the group chat
      the moment it happens — this is the ritual that builds momentum.
- [ ] Heavy call review during weeks 1–2.

**Daily per-setter targets:**

| Metric | Target |
|--------|--------|
| Dials | ≥ 320 (320–350) |
| Live conversations | ≥ 38 (12% contact) |
| Application attempts | ≥ 22 |
| Signed | ≥ 2 |
| Plaid connected | ≥ 1.5 |
| Fallback appointments | 4–6 |

**Weekly review ritual:** per-setter Signed (10–14) and Plaid connected
(8–11); funnel health (Signed→Plaid ≥ 70%, Plaid→submitted ≥ 90%); cost per
signed (≤ $150) and cost per funded (≤ $600) by list source via Campaign Audit.

**🛑 KILL CRITERION:** If you reach **20+ clean submissions with ZERO
fundings → STOP** and diagnose the list/funder mix before spending more. You
will have learned that for ~$2,500 instead of ~$25,000.

**Scale gate:** Add **setter #3 only after 45–60 days** of consistent
per-setter targets **AND** first funded deals.

**October milestone:** **3–4 funded/mo** — this is the exact bar Zach @
Greenbox set and matches the Bitty reapplication window. When you hit it:
**reapply to Bitty via Rosmery** and **call Zach @ Greenbox**.

---

## Appendix A — the `ph_settings` SQL

`platform_settings.ph_settings` does **not exist yet**. After Steps 1 and 2,
hand Claude the two workflow IDs and the two setter numbers; Claude runs this
(or you can run it in the Supabase SQL editor):

```sql
insert into platform_settings (key, value, updated_at)
values (
  'ph_settings',
  jsonb_build_object(
    'packet_workflow_id', 'PASTE_PH_01_WORKFLOW_ID',
    'notify_workflow_id', 'PASTE_PH_02_WORKFLOW_ID',
    'setter_numbers',     jsonb_build_array('PH_SETTER_1_NUMBER', 'PH_SETTER_2_NUMBER')
  ),
  now()
)
on conflict (key) do update
  set value = platform_settings.value || excluded.value,
      updated_at = now();
```

The `||` merge means you can run it again later to add or overwrite individual
keys without wiping the others.

---

## Appendix B — `PH 01` packet email copy

Paste **verbatim** into the Send Email action. From: `sales@send.mfunding.net`.

**Subject:** Two quick steps to finish your funding request

**Body:**

> Hi {{contact.first_name}},
>
> Great talking with you. Two quick steps and we can pull your numbers and show
> you exact funding options:
>
> **1. Review + sign** — the short agreement we just sent takes about 30 seconds.
>
> **2. Connect your bank** — takes about 60 seconds. It's read-only through
> Plaid; **we never see your login or password.**
>
> [**CONNECT YOUR BANK →**]  ← button URL: `{{contact.ph_connect_bank_url}}`
>
> Do both while we're on the phone and we'll keep everything moving today.
>
> — The Momentum Funding team

> Keep the language **funding/capital/advance** — never "loan." The button URL
> must be exactly `{{contact.ph_connect_bank_url}}` (type it, don't autolink).

---

## Appendix C — Job description draft

Paste and lightly edit for each board (OnlineJobs.ph / The Calling Agency / Techmart).

> **Title:** MCA Appointment-to-Application Setter (US Business Hours, Full-Time)
>
> **About the role:** We're a US business-funding company (Momentum Funding).
> You'll call US small-business owners from a pre-scrubbed list, qualify them
> for working capital, and walk them through a short e-sign application and a
> 60-second read-only bank connection — live on the call. This is a
> results-driven outbound role with base + performance pay.
>
> **You must have:** Fluent, clear spoken English • Prior US outbound sales /
> appointment-setting experience • A quiet home workspace • Stable internet
> (25 Mbps+) • Reliability during US business hours.
>
> **Nice to have:** Power-dialer and CRM experience (GoHighLevel a plus); MCA
> or business-funding background.
>
> **Comp:** Monthly base + per-signed-agreement + per-bank-connected +
> per-appointment-shown + per-funded override. Strong performers earn
> $3,000–4,500/mo equivalent.
>
> **How to apply:** Send a 60-second voice sample introducing yourself and
> describing a US outbound sales role you've held.

---

## Handoff map — who does what

| The machines are building (do not do by hand) | You do (this runbook) |
|-----------------------------------------------|------------------------|
| PH — Outbound Setters pipeline + 9 stages | Buy 2 phone numbers (Step 1) |
| Per-stage automations (enrollment-only) | Create PH 01 / PH 02 workflows (Step 2) |
| `send-setter-packet` edge function (mints Plaid link → writes `ph_connect_bank_url` → enrolls in PH 01) | Build combined doc template (Step 3) |
| "Setter Operation" Revenue Playbook | Choose + buy dialer (Step 4) |
| Setter scorecard / daily dashboards | Buy + scrub list data (Step 5) |
| Campaign-audit KPIs + `PH-UCC-2026-001` code | Hire + train setters (Step 6) |
| `ph_settings` row write (once you hand over IDs) | Provision setters in GHL (Step 7) |
| — | Launch, run the gates (Step 8) |

*The single handoff point to the existing business is the **Bank Connected**
stage — and only there. Everything upstream is the PH line's own, never
entangled with the running MCA/VCF flow.*
