# Momentum Funding — Go-Live Validation Checklist

**How to use this:** do it top to bottom, in order. Every step tells you exactly what to click. Check each box as you go. Don't skip ahead — later parts assume the earlier ones are done.

**The one safety rule:** nothing calls a real merchant until **you** press **Start Dialing**. Importing leads and adding dialers do **not** place any calls.

**Two small things I need HotProspector logged in to confirm exactly** (marked 🔎 below): the precise label of HP's "add user" menu and the auto-start toggle. Everything else is exact. When you log into HP, ping me and I'll lock those two down live — but the steps as written will get you there.

---

## PART 1 — Log in (do this once, in ONE browser window)

- [ ] Open a browser tab → go to **https://app.hotprospector.com** → sign in with your HotProspector email + password.
- [ ] Open a **second tab** in the **same** browser → go to **https://mfunding.net** → sign in as yourself.
- [ ] Leave **both tabs open.** (Being logged into mfunding.net is what makes the "open MFunding" button work later instead of showing a login screen.)

---

## PART 2 — Import the 995 leads into the dialer

*You do this step yourself because the last checkbox is a legal attestation only you can make.*

- [ ] In HotProspector, left menu → **Contacts**.
- [ ] Click **Import Leads** (top of the Contacts page).
- [ ] **Select Groups** dropdown → choose **`UCC 2026-08-10`**.
- [ ] **Country** → United States / +1.
- [ ] Click **Select file / Choose file** → in the picker, paste or navigate to this exact path and pick the file:
  `/private/tmp/claude-501/-Users-ernestolee-ClaudeProjects-BassReeves/bf1bc568-3e8a-4146-813d-0ffee44ae03a/scratchpad/ucc_hp_import_2026-08-11.csv`
- [ ] Tick ✅ **"Scrub against Global Suppression DNC List"**.
- [ ] Leave ⬜ **"Mobile Verification" UNCHECKED** (it costs 1,000 credits; the account has ~300).
- [ ] Tick ✅ the disclaimer: **"I have permission to contact these phone numbers and emails…"** — **this is your TCPA attestation.**
- [ ] Click **Start Import**.
- [ ] **Step 2 – Map your data:** the columns auto-map (First, Last, Company, Phone, Email, City, State, Zip). Click **Next**.
- [ ] **Step 3 – Existing Data Option:** choose **"Skip duplicates"** (so the ~15 repeat numbers and the 95 already in the group don't double). Click **Next**.
- [ ] **Step 4:** click **Import / Finish**.
- [ ] **Verify it worked:** left menu → **Contacts** → filter by **Group = `UCC 2026-08-10`** (use the **Group filter**, NOT the search box — HP's search is broken). The count should be roughly **1,065** (was ~95 + 995, minus a few duplicates/DNC).

✅ **Leads are in.**

---

## PART 3 — Add yourself as a dialer (so you can test as you)

**3a — Check auto-start FIRST (so nothing dials the second you're assigned):**

- [ ] Left menu → **Dialer** → find **`UCC Parallel-3 — 2026-08-11`** → click **Edit** → **Timezone Settings** tab.
- [ ] Look for an **"Auto Start"** setting. If it's **on/yes**, switch it **OFF → Save**. *(The line "Allow members to disable Auto Start Campaign" is a permission about who can toggle it — not the on/off state; ignore it.)*
- [ ] **Simplest safety net either way:** tell Catherine & Paula **not to press Start until after your own test call** — then no real merchant is dialed before you've validated.

**3b — Assign yourself:**

- [ ] Back on the **Dialer** list, on the **`UCC Parallel-3`** row → click **Action** (the gear/⋮ menu) → **Assign Members**.
- [ ] Add **Dr. Ernesto Lee** → **Save**.
- [ ] *(Prefer I do this? Just ping me once you're logged into HP and the agent will do 3a + 3b for you.)*

✅ **You're a dialer.**

---

## PART 4 — Validate the flow

### 4a — These need NO dialing — do them first

- [ ] **Handoff test:** left menu → **Contacts** → click any contact's **name** → in the **right-hand sidebar, scroll to the bottom** → click **"Gohighlevel Custom Link"** (has a ↗ icon). → MFunding's **Revenue Playbook** opens with that merchant preloaded. ✅
  - ⚠️ **Not** the "Playbook" tab on the call screen — that one is HotProspector's own, not ours. Use **"Gohighlevel Custom Link"** on the contact card.
- [ ] **Application test:** in the Playbook, run the **Send Application (04B)** step to **your own email** (socrates73@gmail.com) → check your inbox: it arrives, reads cleanly, **no raw `{{tags}}`**. ✅
- [ ] **Bank test:** start **Connect Bank** in the Playbook and confirm the link opens. ✅

### 4b — The live dial (one real call)

*This dials real leads in the group. Take ONE call to validate, then Stop.*

- [ ] Left menu → **Dialer** → **`UCC Parallel-3`** row → click the green **▶ (Start Calling)**.
- [ ] A **Session Settings** box appears → tick your **time zone** → **Start Dialing**.
- [ ] When a merchant answers: the **script auto-loads** on the **Script** tab — read it (advance / working-capital language; *"this call may be recorded"*). ✅
- [ ] Click **"Gohighlevel Custom Link"** → the Playbook opens for **that** merchant. ✅
- [ ] Pick a **disposition** for the call (e.g., "Send Application"). ✅
- [ ] Switch to your **mfunding.net** tab → open that contact in VibeReach → confirm the **outcome wrote back**. ✅
- [ ] Click **Stop** / end the session when you're done validating.

✅ **The whole chain works.**

---

## PART 5 — Add Paula & Catherine (do this once you're satisfied)

Your two setters: **Catherine Zaragosa** and **Paula Taruc**. Each needs **two** logins: a **HotProspector** seat (to dial) and their **MFunding** login (already created — they just set a password). Both, in the same browser, same as you.

### 5a — Create their HotProspector seats *(you must do this — I can't create accounts)*

- [ ] HotProspector → **Settings** → the **TEAM** tab (in the tab row, right after "Integrations"; or click **Team** in the top blue menu). *(This is HP's word for Users.)*
- [ ] Click **+ Add** / **Add User** / **Add Team Member**.
- [ ] Enter **Catherine's** details → First: `Catherine`, Last: `Zaragosa`, Email: `cthrnzaragosa@gmail.com` → set the role/permission to the **dialer/agent** level (not Admin) → assign a phone number if asked → **Save**. HP emails her a login.
- [ ] Click **+ Add User** again → **Paula** → First: `Paula`, Last: `Taruc`, Email: `nicopaolotaruc@gmail.com` → dialer/agent role → **Save**.
- [ ] *(You have 3 licenses on the plan — you, Paula, Catherine — so both fit.)*

### 5b — Assign them to the campaign

- [ ] Dialer → **`UCC Parallel-3`** row → **Action → Assign Members** → add **Catherine** and **Paula** → **Save**.

### 5c — Get them into MFunding

- [ ] **Ping me** ("send the setter links") → I generate a one-time setup link for each.
- [ ] Send Catherine her link, Paula hers. They click it → **choose their own password** → they're in. *(Links expire ~1 hour and are single-use, so ask me right when they're about to set up.)*

### 5d — Hand them the guide

- [ ] Send both setters the **onboarding doc**: https://claude.ai/code/artifact/999ef59d-aa9b-470a-9a31-cf422a73afd8

✅ **Setters are live.**

---

## PART 6 — Optional & close-out

- [ ] *(Optional)* Turn on **call recording** → Dialer → `UCC Parallel-3` → **Edit** → **Call Handling** → **Call Recording = Automatic** → click **Agree** on the consent agreement. (Needed for CA + for AI call scoring.)
- [ ] Tell me: does **954-860-7138** reach a **voicemail box** for callbacks? *(the voicemail script leaves this number)*
- [ ] Tell me: keep the **UCC-only edit** of the "How'd you get my number?" line? *(I removed the false "you inquired with us" branch — untrue for UCC leads)*

---

## Reference — what's already built (nothing for you to do here)

| Thing | State |
|---|---|
| **Dialer campaign** | `UCC Parallel-3 — 2026-08-11` · Progressive(M), **3 lines** · caller ID +1 954-860-7138 · 8am–9pm lead-local · script auto-loads |
| **Leads** | 995 traced & clean ($85.96 spent) · CSV ready to import in Part 2 |
| **Setter MFunding logins** | Catherine Zaragosa + Paula Taruc created (closer role, rates/funder data hidden); set-password page live |
| **Setter script** | "UCC Setter Script — Momentum" — attached to the campaign, auto-loads on the call screen |
| **Setter onboarding doc** | https://claude.ai/code/artifact/999ef59d-aa9b-470a-9a31-cf422a73afd8 |
| **Admin SOP (how it all fits)** | in-app at `/admin/dialing-machine` |
