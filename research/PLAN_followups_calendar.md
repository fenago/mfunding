# PLAN — Callback follow-ups on the calendar

**Problem (owner's words):** "A lot of these folks are asking for follow-ups, and we're not doing the follow-ups. We're missing the follow-ups because we're not using the calendar." Requirement: a real-time lead says "call me at 4pm CST" → that must automatically become a calendar event, assigned to that lead's closer, with a reminder. Secondary question: should the MERCHANT get a calendar invite too?

**Status:** PLANNING ONLY. Nothing in this document is built. Everything below was verified against the live repo, the live Supabase DB (`ehibjeonqpqskhcvizow`), and the live GHL sub-account (`t7NmVR4WCy927j4Zon4b`) on 2026-07-13.

---

## 1. What already exists (verified)

### In the app / DB

| Thing | Where | State |
|---|---|---|
| `deals.callback_at` | `timestamptz` column, live | The in-app callback scheduler. Set by the 🕐 Call back button (`logContactAttempt(…, outcome: "callback")` in `src/services/dealService.ts` ~L1216). Cleared when the closer logs `reached`. **0 rows currently set** — the feature is new. |
| My Day snooze/resurface | `src/components/admin/MyDayQueue.tsx` (`classify()`, L109–137) | Future `callback_at` → calm amber "🕐 Callback at 4:00 PM ET" card (rank 6.8, follow-up lane); past `callback_at` → "☎️ CALLBACK DUE — CALL THEM NOW" at rank 0, top of the board. This flow works and stays the primary surface. |
| `CallbackPicker` | Same file, L575–647 | One-tap presets (1h / 3h / Tomorrow 9am) + a custom `datetime-local` field. ⚠️ Known gap: the custom field is parsed with `new Date(custom)` — i.e. the **browser's** timezone, not ET. Presets are relative so they're safe; the custom field must be normalized to ET as part of this build (see §5). |
| `deals.lead_qual->>'best_time'` | jsonb, 14 of 17 open deals have it | The merchant's free-text stated window ("4:00PM CST"). Deliberately **displayed, never parsed** — `statedTimeInET()` in `src/utils/time.ts` shows a conservative ET translation, and a human picks the actual callback time in `CallbackPicker`. This plan keeps that rule: **no automatic text→timestamp parsing, ever.** A mis-parse buries a hot lead. |
| ET everywhere | `src/utils/time.ts` (`installEasternTime()`, `APP_TZ = America/New_York`) | All rendering is forced to Eastern. The GHL location TZ is also America/New_York. |
| `deals.stips_promised_by` | `date` column (note: the code name is `stips_promised_by`, not `statements_promised_by`) | The docs-promise. Set in the playbook docs step (`src/data/playbooks.ts` L172/677/832), chased by My Day ranks 3.5 / 4.5 / 6.9, and shown to the merchant in the portal (`StepDetail.tsx`, `ActionBlock.tsx`). 1 row currently set. |
| Closers | `closers` table (has `user_id` → profiles; **no** `ghl_user_id` column today). Active: Ernesto Lee (owner), Carlos Marquez. `deals.assigned_closer_id` carries assignment. | |
| GHL linkage | `deals.ghl_contact_id` — **17 of 17 open deals have it**; `deals.ghl_opportunity_id` also present. | |
| Server-side GHL client | `supabase/functions/_shared/ghl.ts` — creds from vault via `get_ghl_config()` RPC, redacted logging. | |
| Team-alert email path | `sendTeamAlert()` in `supabase/functions/live-transfer-intake/index.ts` L768 — sends to `socrates73@gmail.com`, CC `cmarq2k8@gmail.com`, via the GHL alerts-inbox contact. | |
| pg_cron → edge fn pattern | `supabase/migrations/20260713_check_email_bounces_cron.sql`, `20260713_synergy_reconcile_cron.sql`, `20260713_lead_pipe_integrity.sql` — `cron.schedule` + `net.http_post` to an edge function. Reuse this exact pattern. | |

### In GHL (live, read-only checks)

- **Calendars exist and the API is sufficient.** `GET /calendars/?locationId=…` returns 6 calendars: 4 inactive snapshot leftovers (claims-themed), plus two active: "MFunding Consultation Call" (`Y3FHQ9dkpicZJ4c3gy1u`, round-robin, team = Carlos) and "Schedule an Appointment" (`iedCbQcXKXONB3A4hAov`, event type, no team). Neither is right for internal callbacks (both are merchant-booking calendars); we create a dedicated one.
- **Create appointment** (`POST /calendars/events/appointments`, verified against GHL's published OpenAPI spec `apps/calendars.json`): required `calendarId, locationId, contactId, startTime`; supports **`assignedUserId`** (per-closer assignment), `title`, `endTime`, `appointmentStatus`, **`ignoreFreeSlotValidation`** and `ignoreDateRange` (so a 4pm callback books even if the slot grid disagrees), and `toNotify` (false = don't fire automations). Update/cancel via `PUT /calendars/events/appointments/{eventId}` (cancel = `appointmentStatus: "cancelled"`).
- **Reminders are native, per calendar** (`POST /calendars/{calendarId}/notifications`, `CreateCalendarNotificationDTO`): `receiverType` ∈ contact / guest / **assignedUser** / emails / phoneNumbers; `channel` ∈ **email / inApp / sms** / whatsapp; `notificationType` ∈ booked / confirmation / cancellation / **reminder** / followup / reschedule; `beforeTime` array for "N minutes before". So "remind the closer 15 min before" is **configuration, not code** — and merchant-facing confirmations are equally a per-calendar toggle, which is the lever for §3.
- **GHL users:** only Carlos Marquez (`UW2IiJjoAK1pTDRdeLz2`) and Diego De La Vega (`vr8HyuXAf43lfBNMMFpo`) are location users. Ernesto (owner, an active closer) is **not** in the location user list (agency-level login). So closer→GHL-user mapping is real work: a nullable `closers.ghl_user_id` column, and an appointment with no `assignedUserId` still books fine on the calendar — the email fallback covers unmapped closers.
- **Inbound appointment webhooks are NOT handled today** — `ghl-webhook/index.ts` switches on Email/opportunity event types only. GHL does publish AppointmentCreate/Update webhook events, but we don't need them for v1 (see §6: one-way sync).

---

## 2. Architecture — single source of truth, calendar as a derived view

**`deals.callback_at` is the truth. The GHL calendar is a projection of it.** My Day already reads `callback_at` directly and must keep doing so — the queue never depends on GHL being up, and the two surfaces can never disagree because one is derived from the other, always in the direction DB → GHL.

```
Closer taps 🕐 Call back (or edits the time later)
        │  logContactAttempt() writes deals.callback_at   ← synchronous, already works, NEVER blocked on GHL
        ▼
deals.callback_at (timestamptz)  ──── the single source of truth
        │
        ├─▶ My Day: snooze → resurface at rank 0 when due          (exists today, unchanged)
        │
        └─▶ callback-calendar-sync (new edge function, async)
                │  compares callback_at vs callback_synced_at/ghl event
                ├─ callback set/changed → upsert GHL appointment on the
                │    "Callbacks — Internal" calendar:
                │    { contactId: deals.ghl_contact_id,
                │      assignedUserId: closers.ghl_user_id (nullable),
                │      startTime: callback_at (ISO w/ offset), endTime: +15m,
                │      title: "Callback: <business> (<deal_number>)",
                │      ignoreFreeSlotValidation: true, ignoreDateRange: true }
                ├─ callback cleared (reached / rescheduled) → PUT appointment
                │    appointmentStatus: "cancelled" (or new time)
                └─ writes back deals.callback_ghl_event_id,
                     callback_synced_at, callback_sync_error
        ▲
        └── invoked two ways:
            1. pg_cron sweeper every 5 min (the reliability floor — heals ALL drift)
            2. (Phase 2) fire-and-forget invoke right after logContactAttempt,
               so the event appears in seconds instead of ≤5 min
```

**Reminder channel — recommendation: GHL-native calendar notifications** (reminder → `assignedUser`, channels `inApp` + `email`, `beforeTime: 15 min`), configured once on the new calendar. Reasons: zero code, it fires where closers already work (GHL app push + inbox), and it survives our app being closed. Rejected alternatives: reusing `sendTeamAlert` (a broadcast to owner+CC, not per-closer, and we'd own the scheduling loop); building our own reminder cron (duplicate of what GHL ships). The `sendTeamAlert` path stays as the **fallback** for a closer with no `ghl_user_id` (today: Ernesto) — Phase 2 adds a tiny "reminder to email if unmapped" branch in the sync function.

**Done/missed reconciliation back into My Day:** already free. `reached` clears `callback_at` (sync cancels the event); a past-due `callback_at` is rank 0 in My Day until acted on — the calendar event just sits in the past, which is fine and honest. No new state machine.

---

## 3. The merchant-invite question — thought through

**Pros of inviting the merchant:** it's a commitment device (a 4pm block in *their* calendar measurably cuts no-answers); it looks organized/professional; GHL can do it natively (calendar `booked`/`confirmation`/`reminder` notifications with `receiverType: contact`, and reschedule/cancel links).

**Cons:** (1) A calendar invite from a finance brand after one 40-second phone call reads heavy — it can feel like a sales trap and burn goodwill on exactly the leads we're trying to keep warm. (2) Timezone correctness becomes **merchant-facing**: today a TZ slip inconveniences a closer; with an invite, "4pm CST" rendered wrong lands a wrong time in the *merchant's* calendar and the missed call is unambiguously our fault. (3) Tone/compliance: any merchant-facing copy must be product-neutral ("your funding request", never "loan" for MCA) and the reminder cadence must not read as marketing pressure. An emailed appointment confirmation for a call the merchant asked for is transactional, but SMS reminders re-raise TCPA posture — email/ics only.

**Recommendation (position): closer-side is always automatic; merchant-side is a per-send closer choice, default OFF for first-contact callbacks.**
- Mechanically: **two calendars.** "Callbacks — Internal" has ALL contact-facing notifications disabled (the appointment must carry `contactId`, so this is load-bearing, not cosmetic — otherwise every internal callback emails the merchant). "Scheduled Calls — Merchant Invited" has contact `confirmation` + one `reminder` (email) enabled, with compliance-reviewed neutral copy. The closer's checkbox in `CallbackPicker` ("📅 Send them an invite") simply picks which calendar the sync books on.
- Default OFF while the deal is `new`/`contacted` (the "call me at 4" crowd — keep it light). Suggest ON (pre-checked) for later-stage scheduled calls — offer presentation, docs review — where a formal invite raises show rates and the relationship supports it.
- Why not "always invite": the downside of cons 1–2 lands on the exact segment (fresh real-time leads) where we have the least trust built; why not "never": we'd forfeit a real no-show lever at the offer stage. A human toggle per send, with stage-aware defaults, prices both correctly. Merchant-facing copy goes through the `compliance` agent before Phase 3 ships.

---

## 4. Broken-promise inventory — what else belongs on the calendar

| Promise / expected touch | Field | Timed? | Calendar? | Rationale |
|---|---|---|---|---|
| "Call me at 4pm" | `deals.callback_at` | Yes, to the minute | **Yes — Phase 1.** The core of this plan. | |
| "I'll send statements by Friday" | `deals.stips_promised_by` (`date`, no time) | Date-only | **Yes — Phase 4**, as an all-day event on the closer's calendar ("📎 Statements due: <business>"). Same sweeper, same derived-view rule. My Day ranks 3.5/4.5/6.9 stay the chase driver. | |
| 5-min speed-to-lead SLA | `deals.first_call_due_at` | Minutes-scale | **No.** Too fast for a calendar; My Day's live countdown is the right surface. | |
| Merchant's stated window | `lead_qual->>'best_time'` | Free text | **No — never auto.** It stays a display + a hint inside `CallbackPicker`; a human converts it into `callback_at`. | |
| Offer sitting unpresented 24h / funder silent 48h / merchant replied | derived from `offer_received_at`, `submitted_at`, `merchant_reply_at` | Derived, not promised | **No.** These are queue signals, not appointments; putting them on a calendar duplicates My Day and trains closers to ignore both. | |

Rule of thumb the table encodes: **the calendar gets commitments made to a person at a time; My Day gets everything.**

## 5. Timezone rules

- `callback_at` is `timestamptz` — an absolute instant. All comparisons and the GHL `startTime` derive from it; no wall-clock arithmetic anywhere.
- Entry is in **ET**: fix the `CallbackPicker` custom field to interpret its value as America/New_York explicitly (label it "ET"), instead of today's browser-local `new Date(custom)` — this is the exact Phoenix-closer bug `time.ts` was written to kill, one layer up. Presets (1h/3h/tomorrow-9am → tomorrow 9am must also be computed in ET, not browser-local) get the same treatment.
- The merchant's "4pm CST" is translated for display only by `statedTimeInET()` (conservative: returns null rather than guess); the human picks the ET time.
- GHL: location TZ is already America/New_York; `startTime` goes out as ISO-8601 with explicit offset, so even a GHL-side TZ misconfig can't shift the instant.
- Merchant-facing invites (Phase 3) render in the merchant's own calendar client from the ics instant — correct by construction *provided the closer picked the right ET time*, which is why the picker shows their stated local time next to the ET conversion at the moment of choice.

## 6. Failure handling

- **GHL down / API error must never lose a callback.** The write path is unchanged: `logContactAttempt` → `deals.callback_at`, synchronous, no GHL in the loop. My Day resurfaces the deal on time regardless. The calendar is best-effort; `callback_sync_error` records the last failure and the 5-min sweeper retries until it heals. No queues, no dead letters — the DB row *is* the retry state.
- **No `ghl_contact_id`** (can't create an appointment — `contactId` is required): skip, set `callback_sync_error = 'no ghl contact'`, My Day still covers it. (Today: 17/17 open deals have one.)
- **No `ghl_user_id` for the closer:** book unassigned on the calendar + email-fallback reminder (Phase 2). Never block the event on the mapping.
- **One-way sync, declared loudly:** GHL calendar edits (drag an appointment to 5pm in GHL) are **overwritten by the sweeper**. The calendar is a view; reschedules happen in the app. This is the price of a single source of truth and it's the right price at this team size. If it ever hurts, the escape hatch is handling GHL's AppointmentUpdate webhook in `ghl-webhook` and writing `callback_at` back — deliberately out of scope now.
- **Duplicate protection:** the sync upserts keyed on `callback_ghl_event_id`; a changed `callback_at` updates the existing event (PUT), never books a second one.

## 7. Phased build

**Phase 1 — Calendar projection (the owner's ask, minimal moving parts)**
1. Migration: `deals.callback_ghl_event_id text`, `deals.callback_synced_at timestamptz`, `deals.callback_sync_error text`; `closers.ghl_user_id text`.
2. GHL (one-time, scripted + documented): create calendar "Callbacks — Internal" (event type, active, not on the booking widget), disable all contact notifications, add notification reminder → `assignedUser`, channels `inApp`+`email`, `beforeTime` 15 min. Store the calendar id in `platform_settings` (not code). Set `closers.ghl_user_id` for Carlos (`UW2IiJjoAK1pTDRdeLz2`).
3. Edge function `callback-calendar-sync` (uses `_shared/ghl.ts`): sweep deals where `callback_at`-vs-synced state drifted (set/changed/cleared); upsert or cancel appointments; write back sync columns.
4. pg_cron every 5 min → the function (copy the `synergy-reconcile` migration pattern).
5. Fix `CallbackPicker` ET handling (custom field + tomorrow-9am preset computed in ET).

**Phase 2 — Immediacy + unmapped-closer fallback**
6. Fire-and-forget invoke of `callback-calendar-sync` (single-deal mode) from `logContactAttempt`, so the event lands in seconds; the cron remains the reliability floor.
7. Email-fallback reminder for closers without `ghl_user_id`, reusing the alert-email pattern (per-closer address, not the team broadcast).
8. My Day callback card shows a small "📅 on calendar" tick (reads `callback_synced_at`) — closers trust what they can see.

**Phase 3 — Merchant invite (per-send choice)**
9. Second GHL calendar "Scheduled Calls — Merchant Invited": contact `confirmation` + email `reminder` enabled, neutral compliance-reviewed copy (product-agnostic, no "loan", no SMS reminders).
10. `CallbackPicker` checkbox "📅 Send them an invite" (default OFF at `new`/`contacted`, pre-checked for later-stage scheduling surfaces); the flag routes the sync to the invited calendar. Persist the choice (e.g. `deals.callback_invite boolean`).

**Phase 4 — The rest of the disease**
11. `stips_promised_by` → all-day event on the closer's calendar via the same sweeper; cancelled when docs arrive or the deal advances past the stips stages (`STIPS_PENDING` set in `MyDayQueue.tsx`).
12. Auditor pass on the whole flow (set/change/clear/reached/GHL-down/no-mapping) before calling it done.

## TODO entries

- [ ] Followups-calendar P1: migration — `deals.callback_ghl_event_id/callback_synced_at/callback_sync_error` + `closers.ghl_user_id` (map Carlos → UW2IiJjoAK1pTDRdeLz2)
- [ ] Followups-calendar P1: create GHL "Callbacks — Internal" calendar (contact notifications OFF; assignedUser inApp+email reminder 15m before); store calendar id in platform_settings
- [ ] Followups-calendar P1: `callback-calendar-sync` edge function (DB→GHL one-way upsert/cancel, sync columns written back) + 5-min pg_cron sweeper
- [ ] Followups-calendar P1: fix CallbackPicker timezone — custom datetime + "Tomorrow 9am" preset interpreted as ET, labelled ET (today they're browser-local)
- [ ] Followups-calendar P2: instant single-deal sync invoke from `logContactAttempt` (fire-and-forget; cron stays the floor)
- [ ] Followups-calendar P2: email-fallback reminder for closers with no `ghl_user_id` (covers the owner's agency-level login)
- [ ] Followups-calendar P2: "📅 on calendar" tick on the My Day callback card (reads `callback_synced_at`)
- [ ] Followups-calendar P3: merchant-invite calendar ("Scheduled Calls — Merchant Invited", confirmation+email reminder, compliance-reviewed neutral copy) + per-send "Send them an invite" checkbox in CallbackPicker (default OFF at new/contacted)
- [ ] Followups-calendar P4: `stips_promised_by` → all-day closer calendar event via the same sweeper; auto-cancel when docs land or stage passes STIPS_PENDING
- [ ] Followups-calendar P4: auditor pass over set/change/clear/reached/GHL-down/no-mapping paths end-to-end
