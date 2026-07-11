-- Lead-assignment STRATEGY becomes a super-admin setting instead of hardcoded round-robin.
--
-- Stored in the existing key/value `platform_settings` table (RLS: anyone reads,
-- super_admin writes) under key 'lead_assignment':
--   { "strategy": "round_robin" | "least_open_deals" | "manual" | "specific_closer",
--     "specific_closer_profile_id": "<profiles.id>" | null }
--
-- The BEFORE INSERT trigger on deals reads the setting at insert time, so flipping the
-- strategy takes effect immediately for every intake path (mca-intake, vcf-intake,
-- live-transfer-intake, ghl-webhook, bulk-lead-import) with no redeploy.
--
-- SAFE FALLBACK IS UNIVERSAL: whatever the strategy, if no eligible closer resolves,
-- the deal is inserted UNASSIGNED. Never error, never drop the lead.
--
-- Idempotent: safe to re-run.

-- Seed the default. `on conflict do nothing` so a re-run never clobbers the owner's choice.
insert into public.platform_settings (key, value)
values ('lead_assignment', '{"strategy":"round_robin","specific_closer_profile_id":null}'::jsonb)
on conflict (key) do nothing;

-- Strategy-aware picker. Returns 0 rows => leave the deal unassigned.
drop function if exists public.next_lead_closer();
create or replace function public.next_lead_closer()
returns table (closer_profile_id uuid, closer_name text, over_cap boolean, strategy text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_strategy text;
  v_specific uuid;
begin
  -- Serialize pick+stamp across concurrent deal inserts (race safety).
  perform pg_advisory_xact_lock(hashtext('mfunding.lead_round_robin'));

  select coalesce(ps.value->>'strategy', 'round_robin'),
         nullif(ps.value->>'specific_closer_profile_id', '')::uuid
    into v_strategy, v_specific
    from public.platform_settings ps
   where ps.key = 'lead_assignment';

  -- Unknown/missing strategy => default round_robin.
  if v_strategy is null
     or v_strategy not in ('round_robin', 'least_open_deals', 'manual', 'specific_closer') then
    v_strategy := 'round_robin';
  end if;

  -- manual: super-admin assigns by hand from the Unassigned queue.
  if v_strategy = 'manual' then
    return;
  end if;

  -- Self-heal: every currently-eligible closer gets a rotation row (new ones sort first).
  insert into public.lead_assignment_state (closer_user_id)
  select c.user_id
    from public.closers c
   where c.status = 'active'
     and c.user_id is not null
  on conflict (closer_user_id) do nothing;

  return query
  with eligible as (
    select
      c.user_id,
      trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')) as name,
      c.max_leads_per_month,
      -- leads assigned this calendar month (soft cap input)
      (
        select count(*)
          from public.deals d
         where d.assigned_closer_id = c.user_id
           and d.created_at >= date_trunc('month', now())
      ) as month_count,
      -- currently-open deals (load-balancing input): everything not finished/dead
      (
        select count(*)
          from public.deals d
         where d.assigned_closer_id = c.user_id
           and d.status not in ('funded', 'renewal_eligible', 'restructure_executed',
                                'servicing', 'declined', 'dead', 'nurture')
      ) as open_count
      from public.closers c
     where c.status = 'active'
       and c.user_id is not null
  )
  select
    e.user_id,
    nullif(e.name, '')::text,
    (e.max_leads_per_month is not null and e.month_count >= e.max_leads_per_month) as over_cap,
    v_strategy
  from eligible e
  left join public.lead_assignment_state s on s.closer_user_id = e.user_id
  -- specific_closer: only the configured closer is a candidate, and only if still eligible.
  where (v_strategy <> 'specific_closer' or e.user_id = v_specific)
  order by
    -- Soft cap: under-cap closers strictly preferred. If ALL are at cap we still assign
    -- (overflow, flagged in the audit note) rather than orphaning the lead.
    (e.max_leads_per_month is null or e.month_count < e.max_leads_per_month) desc,
    -- least_open_deals: fewest open deals wins. NULL (=no-op) for the other strategies.
    (case when v_strategy = 'least_open_deals' then e.open_count end) asc nulls last,
    -- round_robin: least-recently-assigned wins. Also the tiebreaker everywhere else.
    s.last_assigned_at asc nulls first,
    coalesce(s.assigned_count, 0) asc,
    e.user_id
  limit 1;
end;
$$;

-- Trigger: same safety contract, now strategy-aware + strategy named in the audit note.
create or replace function public.deals_auto_assign_closer()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid      uuid;
  v_name     text;
  v_over_cap boolean;
  v_strategy text;
  v_label    text;
begin
  begin
    if new.assigned_closer_id is null then
      select n.closer_profile_id, n.closer_name, n.over_cap, n.strategy
        into v_uid, v_name, v_over_cap, v_strategy
        from public.next_lead_closer() n;

      -- manual strategy, no eligible closer, or configured closer deactivated ->
      -- leave NULL. Never raise; never block the intake.
      if v_uid is null then
        return new;
      end if;

      new.assigned_closer_id := v_uid;
      perform public.stamp_lead_assignment(v_uid);

      v_label := case v_strategy
                   when 'least_open_deals' then 'least open deals'
                   when 'specific_closer'  then 'specific closer'
                   else 'round-robin'
                 end;

      -- Best-effort audit trail. entity_type 'deal' + interaction_type 'note' are the only
      -- values the activity_log check constraints allow for a system event.
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
        null; -- audit failure must never fail the lead insert
      end;
    else
      -- Explicit/manual assignment at insert time: still advance the rotation so the next
      -- auto-assignment does not double up on the same closer.
      if exists (
        select 1 from public.closers c
         where c.user_id = new.assigned_closer_id
           and c.status = 'active'
      ) then
        perform public.stamp_lead_assignment(new.assigned_closer_id);
      end if;
    end if;
  exception when others then
    return new; -- any unexpected failure -> unassigned lead, never a dropped lead
  end;

  return new;
end;
$$;

drop trigger if exists trg_deals_auto_assign_closer on public.deals;
create trigger trg_deals_auto_assign_closer
  before insert on public.deals
  for each row
  execute function public.deals_auto_assign_closer();
