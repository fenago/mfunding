-- Lead-pipe integrity: the four ways a PAID Synergy lead can still be lost.
--
-- 1. THE SILENT IGNORE. live-transfer-intake's "not a transfer" gate returned 200 and
--    wrote NOTHING. If the vendor changes sending domain and rewords the subject, every
--    lead is 200-OK'd into the void — and the synergy-reconcile sweep is blind to the
--    SAME condition (it discovers sender robots only by trusted domain / lt-source tag,
--    and that tag is only ever applied to trusted-domain senders). New outcome 'ignored'
--    leaves a trace so the sweep can see what we threw away.
--
-- 2. THE ALERT STORM. The sweep re-drives any row that isn't created/deduped — including
--    'rejected' — and each re-drive fires an unconditional PARSE FAILURE email. The cron
--    runs every 2 minutes (despite being NAMED …-15min), so ONE unparseable lead = ~1,440
--    emails in 48h. Two rows already carry a hand-written "do not recover" reject_reason
--    that NO CODE READS. This adds a real terminal state (do_not_recover /
--    outcome='ignored_permanent') that the sweep obeys, plus a per-record alert cooldown.
--
-- 3. THE DEDUPE RACE. The intake reads customers/deals, then does seconds of GHL work,
--    then inserts. Two concurrent runs for one merchant (GHL workflow + the 2-minute
--    sweep re-driving the same email) both pass the check → two customers, two deals.
--    There is no unique constraint on customers.email/phone and adding one is not safe:
--    a rejected INSERT would DROP a paid lead, which is worse than a duplicate. Instead:
--    an explicit claim row + pg_advisory_xact_lock, so the loser BACKS OFF and is re-driven
--    by the sweep rather than being discarded.
--
-- 4. THE INVISIBLE LEAD. deals_auto_assign_closer swallows every error and can yield an
--    unassigned deal; RLS then hides that deal from every closer (created_by is NULL for
--    service-role intakes, assigned_closer_id is NULL) — so the "closers can pick up
--    unassigned leads" behavior MyDayQueue already assumes has never actually worked.
--    Fixed on both ends: closers can now SEE and CLAIM an unassigned deal, and a failed
--    assignment writes a loud, findable activity_log note instead of vanishing.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1 + 2. Ledger: 'ignored' trace, and a terminal state a human can actually set.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.synergy_intake_log
  drop constraint if exists synergy_intake_log_outcome_check;

alter table public.synergy_intake_log
  add constraint synergy_intake_log_outcome_check
  check (outcome in ('created', 'deduped', 'rejected', 'unprocessed', 'ignored', 'ignored_permanent'));

-- do_not_recover: the ONLY way a human can say "this is not a lead, stop chasing it"
-- and be obeyed. The sweep skips these rows entirely; the intake refuses to reprocess
-- them. Previously this convention lived in free-text reject_reason and was honored by
-- nothing — the two vendor test emails only stopped being re-driven by aging out of the
-- 48h window.
alter table public.synergy_intake_log
  add column if not exists do_not_recover boolean not null default false;

comment on column public.synergy_intake_log.do_not_recover is
  'Human terminal state: never re-drive, never alert on this email again. Set it (with a reject_reason) instead of writing "do not recover" in prose — the sweep reads THIS, not the prose.';
comment on column public.synergy_intake_log.last_alert_at is
  'Per-record alert cooldown. Both live-transfer-intake and synergy-reconcile stamp this and refuse to re-alert on the same email record inside the cooldown window.';

-- Honor the two rows a human already annotated by hand.
update public.synergy_intake_log
   set do_not_recover = true,
       outcome        = 'ignored_permanent',
       notes          = coalesce(notes || ' | ', '') ||
                        'Terminal state applied 2026-07-13: the hand-written "do not recover" reject_reason was read by no code.'
 where do_not_recover = false
   and reject_reason ilike '%do not recover%';

create index if not exists synergy_intake_log_open_idx
  on public.synergy_intake_log (received_at desc)
  where do_not_recover = false;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Dedupe race: an explicit claim, taken under an advisory lock.
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY NOT a unique index on customers.email / customers.phone:
--   • email is nullable and phone is nullable (a valid Synergy lead can arrive with
--     only one of them), so a plain unique index cannot cover the key we dedupe on;
--   • and far more importantly, a unique violation would make the intake's customer
--     INSERT fail, which returns 500 and DROPS THE LEAD. A duplicate deal is an
--     annoyance a human can merge. A dropped lead we paid $60–$100 for is gone.
-- So the race is closed by making the SECOND concurrent run back off politely — it is
-- logged 'unprocessed' and the sweep re-drives it 2 minutes later, at which point the
-- winner's deal exists and the normal 30-day dedupe matches it. No lead is ever dropped
-- on this path; the worst case is a 2-minute delay on a duplicate send.
create table if not exists public.lead_intake_claims (
  identity_key            text primary key,   -- normalized phone digits, else lowercased email
  holder_run_id           uuid not null,      -- unique PER INVOCATION, not per email record:
                                              -- two concurrent runs of the SAME email must not
                                              -- both be granted (that is the dominant race —
                                              -- the GHL workflow and the sweep re-driving it).
  holder_email_record_id  text,
  claimed_at              timestamptz not null default now(),
  completed_at            timestamptz,
  deal_id                 uuid references public.deals(id) on delete set null,
  created_at              timestamptz not null default now()
);

comment on table public.lead_intake_claims is
  'Mutual exclusion for live-transfer-intake. One row per merchant identity; a run must hold the claim to create a customer/deal. Closes the read-then-write dedupe race without a unique constraint that could reject (and therefore DROP) a real lead.';

alter table public.lead_intake_claims enable row level security;
-- Service-role only (edge functions bypass RLS). No policies = no client access.

-- Grant, refuse, or take over a claim — atomically.
--   granted=true  → this run owns the merchant identity and may create.
--   granted=false → another run is in flight; the caller must NOT create. It logs
--                   'unprocessed' and the sweep re-drives it.
create or replace function public.claim_lead_intake(
  p_identity_key    text,
  p_run_id          uuid,
  p_email_record_id text default null,
  p_ttl_seconds     int  default 120
)
returns table (granted boolean, holder_run_id uuid, holder_email_record_id text, reason text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r public.lead_intake_claims%rowtype;
begin
  -- No identity to serialize on (structured POST with neither phone nor email): let it
  -- through. Refusing here would drop a lead to protect against a duplicate.
  if coalesce(p_identity_key, '') = '' then
    return query select true, p_run_id, p_email_record_id, 'no identity key — nothing to serialize'::text;
    return;
  end if;

  -- Serializes the check-and-claim itself. Held only for THIS statement's transaction;
  -- the durable mutual exclusion is the claim row, not the lock.
  perform pg_advisory_xact_lock(hashtext('mfunding.lead_intake:' || p_identity_key));

  select * into r from public.lead_intake_claims where identity_key = p_identity_key;

  if not found then
    insert into public.lead_intake_claims (identity_key, holder_run_id, holder_email_record_id)
    values (p_identity_key, p_run_id, p_email_record_id);
    return query select true, p_run_id, p_email_record_id, 'claimed'::text;
    return;
  end if;

  if r.holder_run_id = p_run_id then
    return query select true, p_run_id, p_email_record_id, 're-entrant (same run)'::text;
    return;
  end if;

  -- A previous run FINISHED. The merchant now has a deal, so the intake's own 30-day
  -- dedupe will match it and refresh rather than duplicate. Safe to proceed.
  if r.completed_at is not null then
    update public.lead_intake_claims
       set holder_run_id = p_run_id, holder_email_record_id = p_email_record_id, claimed_at = now()
     where identity_key = p_identity_key;
    return query select true, p_run_id, p_email_record_id, 'previous intake completed — dedupe will match'::text;
    return;
  end if;

  -- The holder died mid-run (edge function timeout / crash). Take it over rather than
  -- leaving the merchant permanently un-creatable.
  if r.claimed_at < now() - make_interval(secs => p_ttl_seconds) then
    update public.lead_intake_claims
       set holder_run_id = p_run_id, holder_email_record_id = p_email_record_id, claimed_at = now()
     where identity_key = p_identity_key;
    return query select true, p_run_id, p_email_record_id, 'stale claim taken over'::text;
    return;
  end if;

  return query select false, r.holder_run_id, r.holder_email_record_id,
                      'another intake is in flight for this merchant'::text;
end;
$$;

-- Close out a claim. p_deal_id null = ABANDON (the run failed) so a retry isn't blocked
-- for the full TTL.
create or replace function public.complete_lead_intake(
  p_identity_key text,
  p_run_id       uuid,
  p_deal_id      uuid default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if coalesce(p_identity_key, '') = '' then return; end if;

  if p_deal_id is null then
    delete from public.lead_intake_claims
     where identity_key = p_identity_key
       and holder_run_id = p_run_id
       and completed_at is null;
  else
    update public.lead_intake_claims
       set completed_at = now(), deal_id = p_deal_id
     where identity_key = p_identity_key
       and holder_run_id = p_run_id;
  end if;
end;
$$;

revoke all on function public.claim_lead_intake(text, uuid, text, int) from public, anon, authenticated;
revoke all on function public.complete_lead_intake(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_lead_intake(text, uuid, text, int) to service_role;
grant execute on function public.complete_lead_intake(text, uuid, uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1 (cont). Pipe-level alert cooldown: "the lead pipe is dead" must SCREAM, once.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.ops_alert_state (
  alert_key     text primary key,
  last_alert_at timestamptz not null default now(),
  last_detail   text,
  fire_count    int not null default 1,
  updated_at    timestamptz not null default now()
);

comment on table public.ops_alert_state is
  'Cooldown ledger for PIPE-LEVEL alerts (no vendor robots discoverable, no leads seen in N hours, deals with no closer). Keyed by alert kind, not by record — these are conditions, not items. Without it a 2-minute cron would email the owner 720 times a day about one outage.';

alter table public.ops_alert_state enable row level security;

drop policy if exists "Staff read ops alert state" on public.ops_alert_state;
create policy "Staff read ops alert state" on public.ops_alert_state
  for select to authenticated
  using (exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and p.role in ('closer', 'admin', 'super_admin')
  ));

-- ─────────────────────────────────────────────────────────────────────────────
-- 4a. An unassigned deal must be VISIBLE to (and claimable by) a closer.
-- ─────────────────────────────────────────────────────────────────────────────
-- Today: closer_owns_deal(uid, id) = created_by = uid OR assigned_closer_id = uid.
-- A service-role intake sets created_by = NULL by design. If auto-assignment yields
-- NULL (strategy='manual', no active closer with a user_id, or ANY error — the trigger
-- swallows all of them), the deal matches NO closer policy and is invisible to every
-- role=closer user. MyDayQueue.tsx already renders `!d.assigned_closer_id` deals for
-- everyone, and enforce_deal_closer_assignment already has a "a closer may CLAIM an
-- unassigned deal" branch — both were unreachable because RLS never handed over the row.
-- These two policies are strictly ADDITIVE and scoped to assigned_closer_id IS NULL:
-- a closer still cannot see another closer's assigned deals.
drop policy if exists "closer_select_unassigned_deals" on public.deals;
create policy "closer_select_unassigned_deals" on public.deals
  for select to authenticated
  using (
    (public.is_closer((select auth.uid())) or public.has_closer_row((select auth.uid())))
    and assigned_closer_id is null
  );

-- The claim itself. WITH CHECK forces the new row to be assigned to the caller, so the
-- only update a closer can make to an unassigned deal is to take ownership of it.
-- enforce_deal_closer_assignment then re-verifies the same rule at the trigger level.
drop policy if exists "closer_claim_unassigned_deals" on public.deals;
create policy "closer_claim_unassigned_deals" on public.deals
  for update to authenticated
  using (
    (public.is_closer((select auth.uid())) or public.has_closer_row((select auth.uid())))
    and assigned_closer_id is null
  )
  with check (
    (public.is_closer((select auth.uid())) or public.has_closer_row((select auth.uid())))
    and assigned_closer_id = (select auth.uid())
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4b. Assignment may still fail — but it may no longer fail SILENTLY.
-- ─────────────────────────────────────────────────────────────────────────────
-- The blanket `exception when others then return new` stays, deliberately: a broken
-- round-robin must never block the INSERT of a lead we paid for. What changes is that
-- the failure now leaves a loud, queryable trace ('lead:assignment-failed') that
-- synergy-reconcile turns into an email, instead of silently producing an orphan.
create or replace function public.deals_auto_assign_closer()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid      uuid;
  v_name     text;
  v_over_cap boolean;
  v_strategy text;
  v_label    text;
  v_err      text;
begin
  begin
    if new.assigned_closer_id is null then
      select n.closer_profile_id, n.closer_name, n.over_cap, n.strategy
        into v_uid, v_name, v_over_cap, v_strategy
        from public.next_lead_closer() n;

      if v_uid is null then
        -- NO CLOSER. Either strategy='manual', or no active closer has a user_id.
        -- The deal is still created (never drop a lead) but it is now announced.
        begin
          insert into public.activity_log (entity_type, entity_id, interaction_type, subject, content)
          values (
            'deal', new.id, 'note', 'lead:assignment-failed',
            'NO CLOSER ASSIGNED — next_lead_closer() returned nobody (strategy='
              || coalesce(v_strategy, 'unknown')
              || '). The deal exists but is UNASSIGNED. Closers can see and claim it in My Day;'
              || ' if nobody does, this lead is being paid for and ignored.'
          );
        exception when others then
          null;
        end;
        return new;
      end if;

      new.assigned_closer_id := v_uid;
      perform public.stamp_lead_assignment(v_uid);

      v_label := case v_strategy
                   when 'least_open_deals' then 'least open deals'
                   when 'specific_closer'  then 'specific closer'
                   else 'round-robin'
                 end;

      begin
        insert into public.activity_log (entity_type, entity_id, interaction_type, subject, content)
        values (
          'deal',
          new.id,
          'note',
          'lead:auto-assigned',
          'Auto-assigned to ' || coalesce(v_name, v_uid::text) || ' (' || v_label || ')'
            || case when v_over_cap then ' — over monthly cap (all closers at cap)' else '' end
        );
      exception when others then
        null;
      end;
    else
      if exists (
        select 1 from public.closers c
         where c.user_id = new.assigned_closer_id
           and c.status = 'active'
      ) then
        perform public.stamp_lead_assignment(new.assigned_closer_id);
      end if;
    end if;
  exception when others then
    -- Was: `return new` and nothing else. An error here produced an UNASSIGNED deal
    -- that no closer could even SELECT — the lead simply ceased to exist for the team.
    v_err := sqlerrm;
    begin
      insert into public.activity_log (entity_type, entity_id, interaction_type, subject, content)
      values (
        'deal', new.id, 'note', 'lead:assignment-failed',
        'AUTO-ASSIGNMENT ERRORED — the deal was created UNASSIGNED. Error: ' || coalesce(v_err, 'unknown')
      );
    exception when others then
      null;
    end;
    return new;
  end;

  return new;
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2 (cont). The cron job's NAME lied. It says 15 minutes; it runs every 2.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from cron.job where jobname = 'synergy-reconcile-15min') then
    perform cron.unschedule('synergy-reconcile-15min');
  end if;
end;
$$;

select cron.schedule(
  'synergy-reconcile-2min',
  '*/2 * * * *',
  $$
  select net.http_post(
    url := 'https://ehibjeonqpqskhcvizow.supabase.co/functions/v1/synergy-reconcile?secret='
           || (select decrypted_secret from vault.decrypted_secrets where name = 'GHL_WEBHOOK_SECRET'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_ANON_KEY')
    ),
    body := jsonb_build_object('source', 'pg_cron', 'hours', 48),
    timeout_milliseconds := 55000
  );
  $$
);
