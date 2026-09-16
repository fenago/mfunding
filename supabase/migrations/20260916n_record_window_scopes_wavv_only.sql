-- Documentation only. No behaviour change. ══════════════════════════════════
--
-- Records an invariant that is easy to get wrong and was nearly got wrong here:
--
--   win_lo / win_hi in deal_call_events scope the WAVV branch ONLY.
--
-- WAVV is phone-keyed, so a window is the only way to decide which deal a call
-- belongs to. ghl_call_log and activity_log rows are DEAL-KEYED and join on
-- deal_id with no window predicate at all — they pass straight through, and they
-- can and do predate the deal's own created_at.
--
-- Measured book-wide on 2026-09-16: 91 deals carry deal-keyed call rows older
-- than the deal itself — 110 ghl_call_log rows (0 activity_log), worst single
-- deal 14. One of those is in the live 7-day hot window (MF-2026-0347, whose
-- pre-arrival row is a GHL call 41 days before the deal existed).
--
-- THE CONSEQUENCE, which is the whole reason this comment exists: any
-- "since the lead arrived" rule must be applied to the UNIFIED EVENT STREAM, as
-- realtime_lead_call_history does with `e.at >= a.created_at` (20260916m). The
-- obvious place — inside the window logic, tightening win_lo — would have fixed
-- NOTHING for those 110 GHL rows, because the window never governed them. It
-- would have looked correct, passed a WAVV-shaped test, and left 91 deals
-- feeding pre-arrival dials into a speed-to-lead deficit.
--
-- Corollary for the next person: the window is about ATTRIBUTION (which deal
-- does this phone-keyed call belong to). The arrival cut is about INTERVAL
-- (does this call fall inside the period the pace expectation covers). They are
-- different questions, they need different mechanisms, and neither substitutes
-- for the other.

comment on function public.deal_call_events(uuid[]) is
  'THE definition of the calls on a deal: wavv_calls (phone-matched inside the deal''s window) + ghl_call_log + activity_log ''call'' rows, deduped rank wavv>ghl>activity by 180s + the keeper''s duration, never within a source. ⚠ THE WINDOW (win_lo/win_hi) SCOPES THE WAVV BRANCH ONLY — WAVV is phone-keyed so it needs attribution; ghl_call_log and activity_log are deal-keyed and pass through unwindowed, so they CAN predate the deal''s own created_at (measured 2026-09-16: 91 deals, 110 GHL rows, worst 14). Any "since arrival" rule therefore belongs on the unified event stream, never inside the window. Window: the deal''s whole ENGAGEMENT — no time cap either way, bounded only by the previous and next genuine re-entry; a sibling within 24 HOURS is a DUPLICATE, not a re-entry, so it does not partition and both records carry the one history. is_conversation marks a real two-way conversation per source (WAVV: outbound, >=120s, outcome <> VOICEMAIL; GHL: completed and >=120s; hand-logged: never). NO VISIBILITY CHECK — callers must authorise and filter the deal ids first, hence service_role only.';

comment on function public.realtime_lead_call_history(uuid[]) is
  'Hot Leads call history, money-walled (own book + unassigned for a plain closer; ops and processors see any deal). Returns TWO counts per deal and they are not interchangeable: `attempts` is LIFETIME — "has anyone ever called this merchant", what the row displays and the only count NEVER DIALED may be judged on; `attempts_since_arrival` counts events at or after deals.created_at — "is this lead being worked NOW", and it alone drives the pace deficit, the blazing tier and the 5-minute speed-to-lead badge, because expectedAttempts() is a pace over the lead''s age and the numerator must cover the same interval. The arrival cut is applied to the unified event stream on purpose: deal-keyed GHL rows routinely predate the deal, so cutting inside deal_call_events'' window would have missed them entirely.';
