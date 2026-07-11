-- Round-robin auto-assignment of inbound leads to closers.
--
-- WHY A DB TRIGGER: leads arrive from mca-intake, vcf-intake, live-transfer-intake,
-- ghl-webhook and bulk-lead-import. A BEFORE INSERT trigger on public.deals covers
-- every path at once, with no edge-function changes.
--
-- KEY DATA-MODEL FACT: deals.assigned_closer_id is a FK to profiles(id) — it stores
-- the closer's PROFILE id (closers.user_id). commissions.closer_id is the one that
-- references closers.id. This migration only ever writes closers.user_id.
--
-- FAIRNESS MODEL: least-recently-assigned wins, using a small rotation-state table.
-- The eligible set is recomputed from `closers` on every insert, so adding/removing
-- (or deactivating) a closer self-heals immediately — no fixed cursor to fix up.
--
-- RACE SAFETY: the picker takes a transaction-level advisory lock, so concurrent
-- inserts serialize through the "pick + stamp" step and can never both read the same
-- stale rotation state.
--
-- FAILURE MODE: if no closer is eligible (or anything at all goes wrong), the deal is
-- inserted with assigned_closer_id = NULL. An unassigned lead is far better than a
-- dropped lead; the super-admin sees it via the "Unassigned only" filter on /admin/deals.
--
-- Idempotent: safe to re-run.

-- 1) Rotation state ----------------------------------------------------------
create table if not exists public.lead_assignment_state (
  closer_user_id   uuid primary key references public.profiles(id) on delete cascade,
  last_assigned_at timestamptz,
  assigned_count   bigint not null default 0,
  updated_at       timestamptz not null default now()
);

comment on table public.lead_assignment_state is
  'Round-robin rotation state for auto-assigning inbound deals to closers. Keyed by profile id (closers.user_id), which is what deals.assigned_closer_id holds.';

alter table public.lead_assignment_state enable row level security;

drop policy if exists lead_assignment_state_admin_read on public.lead_assignment_state;
create policy lead_assignment_state_admin_read
  on public.lead_assignment_state for select
  using (public.is_admin_or_super((select auth.uid())));

-- 2) Picker: next eligible closer -------------------------------------------
-- Eligible = closers.status = 'active' AND closers.user_id IS NOT NULL.
-- max_leads_per_month is a SOFT cap: closers under their cap are strictly preferred.
-- If EVERY eligible closer is at/over cap we still assign (to the least-recently
-- assigned one) and flag over_cap = true in the audit note — overflow beats orphaning.
-- NULL max_leads_per_month = unlimited.
drop function if exists public.next_lead_closer();
create or replace function public.next_lead_closer()
returns table (closer_profile_id uuid, closer_name text, over_cap boolean)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- Serialize the pick+stamp across concurrent deal inserts.
  perform pg_advisory_xact_lock(hashtext('mfunding.lead_round_robin'));

  -- Self-heal: make sure every currently-eligible closer has a rotation row.
  -- New closers land with last_assigned_at = NULL and therefore go to the front.
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
      (
        select count(*)
          from public.deals d
         where d.assigned_closer_id = c.user_id
           and d.created_at >= date_trunc('month', now())
      ) as month_count
      from public.closers c
     where c.status = 'active'
       and c.user_id is not null
  )
  select
    e.user_id,
    nullif(e.name, '')::text,
    (e.max_leads_per_month is not null and e.month_count >= e.max_leads_per_month) as over_cap
  from eligible e
  left join public.lead_assignment_state s on s.closer_user_id = e.user_id
  order by
    (e.max_leads_per_month is null or e.month_count < e.max_leads_per_month) desc, -- under-cap first
    s.last_assigned_at asc nulls first,                                            -- least recently assigned
    coalesce(s.assigned_count, 0) asc,
    e.user_id
  limit 1;
end;
$$;

-- 3) Stamp helper ------------------------------------------------------------
-- clock_timestamp(), NOT now(): now() is frozen for the whole transaction, so a bulk
-- multi-row insert (bulk-lead-import) would tie on last_assigned_at. clock_timestamp()
-- advances per row, so the rotation stays correct even inside one transaction.
create or replace function public.stamp_lead_assignment(p_closer_user_id uuid)
returns void
language sql
security definer
set search_path to 'public'
as $$
  insert into public.lead_assignment_state (closer_user_id, last_assigned_at, assigned_count, updated_at)
  values (p_closer_user_id, clock_timestamp(), 1, clock_timestamp())
  on conflict (closer_user_id) do update
    set last_assigned_at = clock_timestamp(),
        assigned_count   = public.lead_assignment_state.assigned_count + 1,
        updated_at       = clock_timestamp();
$$;

-- 4) BEFORE INSERT trigger on deals -----------------------------------------
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
begin
  begin
    if new.assigned_closer_id is null then
      select n.closer_profile_id, n.closer_name, n.over_cap
        into v_uid, v_name, v_over_cap
        from public.next_lead_closer() n;

      -- No eligible closer -> leave NULL. Never raise; never block the intake.
      if v_uid is null then
        return new;
      end if;

      new.assigned_closer_id := v_uid;
      perform public.stamp_lead_assignment(v_uid);

      -- Best-effort audit trail. entity_type 'deal' + interaction_type 'note' are the
      -- only values the activity_log check constraints allow for a system event.
      begin
        insert into public.activity_log (entity_type, entity_id, interaction_type, subject, content)
        values (
          'deal',
          new.id,
          'note',
          'lead:auto-assigned',
          'Auto-assigned to ' || coalesce(v_name, v_uid::text) || ' (round-robin)'
            || case when v_over_cap then ' — over monthly cap (all closers at cap)' else '' end
        );
      exception when others then
        null; -- audit failure must never fail the lead insert
      end;
    else
      -- Explicit/manual assignment at insert time: still advance the rotation so the
      -- next auto-assignment does not double up on the same closer.
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

-- 5) Backfill existing unassigned deals (same logic, oldest first) ------------
do $$
declare
  r          record;
  v_uid      uuid;
  v_name     text;
  v_over_cap boolean;
begin
  for r in
    select id from public.deals where assigned_closer_id is null order by created_at
  loop
    select n.closer_profile_id, n.closer_name, n.over_cap
      into v_uid, v_name, v_over_cap
      from public.next_lead_closer() n;

    exit when v_uid is null;

    update public.deals set assigned_closer_id = v_uid where id = r.id;
    perform public.stamp_lead_assignment(v_uid);

    insert into public.activity_log (entity_type, entity_id, interaction_type, subject, content)
    values ('deal', r.id, 'note', 'lead:auto-assigned',
            'Auto-assigned to ' || coalesce(v_name, v_uid::text) || ' (round-robin backfill)');
  end loop;
end;
$$;
