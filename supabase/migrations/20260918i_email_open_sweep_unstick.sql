-- The email-open sweep wrote its last row on 2026-09-10 and nothing for the eight
-- days after, while the Campaign Audit kept presenting that frozen count as a live
-- metric. Three separate defects, each verified by CALLING the function, not by
-- reading it:
--
--   1. email_open_events.opened_at is NOT NULL (from the original open-only ledger),
--      but the sweep records every observed status. Every 'delivered'/'sent' record
--      therefore failed its insert — 98 rows in the table, 0 of them non-opened —
--      and, never persisted, got re-fetched on every single run forever, burning the
--      run's tiny budget on records it could never store.
--   2. The cron call carried no timeout_milliseconds, so pg_net gives up at its 5s
--      default. A full run takes ~39s. Confirmed live:
--        "Timeout of 5000 ms reached. Total time: 5000.352000 ms"
--      The response was discarded every night, so nobody could see (1) either.
--   3. Candidates were ordered unopened-first over the newest 400 deals and sliced to
--      40. A merchant who never opens sorts to the front FOREVER, so the same head of
--      the list was re-polled every night and the tail was never reached. Worse, deals
--      in a terminal status were excluded outright: 197 of 345 campaign merchants were
--      permanently invisible to the collector while still counting in the audit's
--      denominator.
--
-- The GHL webhook PUSH path cannot cover for any of this: ghl_webhook_events has never
-- recorded a single email-open event. The poll is the ONLY collector.

-- ── 1) A non-open status is a real observation, not a broken open ──
alter table public.email_open_events alter column opened_at drop not null;

comment on column public.email_open_events.opened_at is
  'When the email was observed OPENED. NULL for a record observed in a non-open state '
  '(delivered/sent/failed) — that is a recorded observation, not a missing one.';

-- ── 2) Rotation watermark: which merchants the sweep has actually looked at ──
-- Stamped per contact on every pass, whether or not anything was found, so a run cut
-- short resumes where it left off instead of restarting at the same head of the list.
-- It is also the freshness signal the Campaign Audit needs: a lead with no open and no
-- check is UNKNOWN, not zero.
alter table public.customers add column if not exists email_open_checked_at timestamptz;

comment on column public.customers.email_open_checked_at is
  'Last time ghl-email-open-sweep read this contact''s email records from GHL. NULL = '
  'never checked, so "no opens" for this lead is UNKNOWN rather than zero.';

create index if not exists customers_email_open_checked_idx
  on public.customers (email_open_checked_at nulls first)
  where ghl_contact_id is not null;

-- ── 3) Least-recently-checked candidate selection, in SQL ──
-- Ordering by the watermark (nulls first) is what guarantees full coverage: every
-- merchant reaches the front of the queue eventually, and one that opens nothing no
-- longer pins itself there. Scope is the audit's own scope — campaign-attributed
-- merchants with an email address — INCLUDING terminal deals, because a dead lead that
-- opened three emails is exactly the engagement signal the campaign is judged on.
create or replace function public.pick_email_open_candidates(p_limit integer default 60)
returns table(customer_id uuid, ghl_contact_id text, last_checked_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select c.id, c.ghl_contact_id, c.email_open_checked_at
  from public.customers c
  where c.ghl_contact_id is not null
    and coalesce(c.email, '') <> ''
    and exists (
      select 1 from public.deals d
      where d.customer_id = c.id and d.campaign_id is not null
    )
  order by c.email_open_checked_at asc nulls first, c.created_at desc
  limit greatest(1, least(coalesce(p_limit, 60), 500));
$$;

revoke all on function public.pick_email_open_candidates(integer) from public, anon, authenticated;
grant execute on function public.pick_email_open_candidates(integer) to service_role;

-- How much of the book the sweep can currently vouch for. The audit reads this to date
-- its own number instead of asserting freshness it does not have.
create or replace function public.email_open_sweep_status()
returns table(eligible bigint, checked bigint, last_checked_at timestamptz, last_event_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*) from public.customers c
      where c.ghl_contact_id is not null and coalesce(c.email, '') <> ''
        and exists (select 1 from public.deals d where d.customer_id = c.id and d.campaign_id is not null)),
    (select count(*) from public.customers c
      where c.email_open_checked_at is not null and c.ghl_contact_id is not null
        and coalesce(c.email, '') <> ''
        and exists (select 1 from public.deals d where d.customer_id = c.id and d.campaign_id is not null)),
    (select max(c.email_open_checked_at) from public.customers c),
    (select max(e.created_at) from public.email_open_events e);
$$;

grant execute on function public.email_open_sweep_status() to service_role, authenticated;

-- ── 4) Cron: honest names, and a timeout long enough for the job to finish ──
--
-- ghl-email-open-sweep: the poll is the primary (only) collector, so it runs often
-- enough to cover all ~346 eligible merchants once a day — 4 passes of 90, rotating by
-- the watermark above. Cost is bounded by the rotation, not by the book: ~2.3 GHL calls
-- per contact observed live (13 record fetches across 40 contacts), so ~800 calls/day
-- against the 200k/day location cap — under 1% (see the ghl-standing-consumers-ledger).
do $$
begin
  perform cron.unschedule('ghl-email-open-sweep-30min');
exception when others then null;
end $$;

select cron.schedule(
  'ghl-email-open-sweep-6h',
  '5 */6 * * *',
  $$
  select net.http_post(
    url := 'https://ehibjeonqpqskhcvizow.supabase.co/functions/v1/ghl-email-open-sweep?secret='
           || (select decrypted_secret from vault.decrypted_secrets where name = 'GHL_WEBHOOK_SECRET'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_ANON_KEY')
    ),
    body := '{"limit":90}'::jsonb,
    timeout_milliseconds := 150000
  );
  $$
);

-- The next two run ONCE A DAY and are named for a cadence they have never kept. The
-- cadence is correct and deliberate — ghl-event-hook carries the real load and these
-- are the nightly safety-net reconcile CLAUDE.md prescribes — so only the NAME changes.
-- An operator chasing a missing call must not read "5min", conclude the sweep already
-- ran, and believe the data is genuinely absent.
-- pg_cron has no rename, so each is re-scheduled under the honest name with its OWN
-- schedule and command carried across verbatim — nothing about what they do changes.
do $$
declare
  r record;
begin
  for r in
    select jobname, schedule, command, new_name
    from cron.job
    join (values ('ghl-call-sweep-5min', 'ghl-call-sweep-nightly'),
                 ('vendor-conversation-sweep-15min', 'vendor-conversation-sweep-nightly')
         ) as rename(old_name, new_name) on cron.job.jobname = rename.old_name
  loop
    perform cron.unschedule(r.jobname);
    perform cron.schedule(r.new_name, r.schedule, r.command);
  end loop;
end $$;
