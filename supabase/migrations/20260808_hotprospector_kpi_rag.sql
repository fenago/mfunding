-- HotProspector — KPI targets, number health, and per-rep transfers.
-- =============================================================================
-- Turns /admin/dialer from a table of numbers into a RAG (red/amber/green) floor
-- monitor for a 2-3 agent PH team running 200-350 dials/day off UCC + aged lists.
-- =============================================================================

-- ── 1. Per-rep transfers ──────────────────────────────────────────────────────
-- The appointments KPI is "appts + transfers", but HotProspector's dashboard
-- object carries no transfer count. The call log does (`transfer: "Yes"` per
-- row), and the poller already sweeps it for speed-to-lead — so transfers are
-- counted from that same pass at no extra API cost.
-- NULL (not 0) when the call-log pull failed: unknown is not zero.
alter table public.hotprospector_agent_daily
  add column if not exists transfers integer;
comment on column public.hotprospector_agent_daily.transfers is
  'Calls with transfer=Yes for this rep on this day, counted from FetchUserCallLog. NULL when the call-log pull failed — never 0-filled.';

-- ── 2. Number health (caller-ID spam reputation) ──────────────────────────────
-- CURRENT STATE, not a daily snapshot: GetNumberHealthList reports how carriers
-- currently label each caller ID. A burned "Scam Likely" number silently craters
-- connect rate, which for a 300-dial/day operation is the single most expensive
-- failure on the floor — hence its own alert on the page.
--
-- ⚠️ ROW SHAPE UNVERIFIED. As of 2026-08-08 the account has no numbers
-- provisioned (GetNumberHealthList returns 200 with pagination.total = 0 and an
-- empty data[]), so the per-number field names could not be observed. The poller
-- therefore reads each field through a list of plausible aliases and keeps the
-- untouched object in `raw`; is_spam_detected is NULL when no recognized spam
-- field was present, which the UI reports as "unknown", never as "clean".
create table if not exists public.hotprospector_number_health (
  id               uuid primary key default gen_random_uuid(),
  phone            text not null unique,
  friendly_name    text,
  is_spam_detected boolean,                    -- NULL = the API did not say
  status           text,                       -- overall label, e.g. 'clean' / 'at_risk' / 'flagged'
  carrier_status   jsonb not null default '{}'::jsonb,  -- per-carrier detail as reported
  last_checked     timestamptz,                -- when the CARRIER data was refreshed (per the API)
  raw              jsonb not null default '{}'::jsonb,
  synced_at        timestamptz not null default now()
);
create index if not exists hotprospector_number_health_spam_idx
  on public.hotprospector_number_health (is_spam_detected);
comment on table public.hotprospector_number_health is
  'Current caller-ID spam reputation per number from HotProspector GetNumberHealthList. Refreshed by hotprospector-sync. is_spam_detected NULL means the API did not report it — the UI shows "unknown", never "clean". Row shape unverified (no numbers on the account yet) — see the migration header.';

alter table public.hotprospector_number_health enable row level security;
drop policy if exists hotprospector_number_health_admin_read on public.hotprospector_number_health;
create policy hotprospector_number_health_admin_read on public.hotprospector_number_health
  for select to authenticated using (is_admin_or_super(auth.uid()));

-- ── 3. KPI targets (tunable, NOT hardcoded in the component) ──────────────────
-- BAND SEMANTICS — one rule, applied to every metric:
--   direction 'higher' → green when value >= green, else amber when value >= amber, else red
--   direction 'lower'  → green when value <= green, else amber when value <= amber, else red
-- Both comparisons are INCLUSIVE of the named edge. (Owner spec said idle gap
-- green is "< 45"; inclusive bands read exactly 45.0 as green rather than amber.
-- That is the only boundary that differs, and it is on a continuous metric.)
--
-- A metric with no value, or a target that is missing/unparseable, renders as
-- "no data" — deliberately NOT green. Green must always mean a real number was
-- measured against a real threshold.
insert into public.platform_settings (key, value)
values ('ph_dialer_kpi_targets', jsonb_build_object(
  'dials_per_day',         jsonb_build_object('label','Dials/day',       'direction','higher','green',200,'amber',120,'unit',''),
  'talk_min',              jsonb_build_object('label','Talk min',        'direction','higher','green',150,'amber',75, 'unit','m'),
  'idle_gap_min',          jsonb_build_object('label','Idle gap',        'direction','lower', 'green',45, 'amber',90, 'unit','m'),
  'dials_per_hour',        jsonb_build_object('label','Dials/hr',        'direction','higher','green',40, 'amber',20, 'unit',''),
  'connect_rate_pct',      jsonb_build_object('label','Connect %',       'direction','higher','green',10, 'amber',5,  'unit','%'),
  'contacts_per_day',      jsonb_build_object('label','Convos',          'direction','higher','green',20, 'amber',10, 'unit',''),
  'prospects_per_day',     jsonb_build_object('label','Prospects',       'direction','higher','green',3,  'amber',1,  'unit',''),
  'appts_per_day',         jsonb_build_object('label','Appts+transfers', 'direction','higher','green',2,  'amber',1,  'unit',''),
  'conversion_rate_pct',   jsonb_build_object('label','Conversion %',    'direction','higher','green',15, 'amber',8,  'unit','%'),
  'dials_per_prospect',    jsonb_build_object('label','Dials/prospect',  'direction','lower', 'green',60, 'amber',120,'unit',''),
  'credit_days_remaining', jsonb_build_object('label','Credit days left','direction','higher','green',15, 'amber',5,  'unit','d')
))
on conflict (key) do nothing;   -- never clobber thresholds the owner has tuned
