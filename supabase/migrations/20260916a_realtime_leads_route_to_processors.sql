-- Real-time leads route to the PROCESSOR pool
-- ============================================
-- Owner ruling 2026-09-16.
--
-- WHY. A live-transfer lead (MF-2026-0308, Vonbangoulap LLC) round-robin'd to a
-- closer who was later terminated. The deal sat "assigned" to a departed employee
-- while a processor actually worked it, so the board credited the wrong person and
-- the deal had no real owner. Processors are the people who work hot leads; they
-- should own them from the moment they land, not by later cleanup.
--
-- WHAT IS A REAL-TIME LEAD. Exactly the two Synergy products that are time-critical
-- the instant they arrive:
--
--   deals.lead_source = 'live_transfer'  -- vendor warm-transfers the merchant to
--                                           us on the phone; they are ON THE LINE.
--   deals.lead_source = 'realtime_appt'  -- email-delivered; starts a 5-minute
--                                           first-call clock.
--
-- These are the same two values that live-transfer-intake writes (its
-- SYNERGY_LEAD_SOURCES), that src/hooks/useNewLeadAlert.ts chimes on (ALERT_SOURCES),
-- and that MyDayQueue/AssignmentsPanel filter on. Every other lead_source present in
-- the table (ghl_other, ucc_list, ph_setter, referral, aged_list, NULL) is not
-- real-time and is NOT touched by this migration. The set lives in ONE place now —
-- public.is_realtime_lead_source() — so the writer and any future reader can't drift.
--
-- WHAT CHANGES. Only the CANDIDATE POOL, and only for real-time leads. Everything
-- else about assignment is preserved exactly:
--   * closers.status = 'active' is still the only way to be eligible (this is what
--     excluded the terminated closer, and it still does inside the processor pool);
--   * the 'manual' strategy still means "assign nobody";
--   * max_leads_per_month still orders under-cap ahead of over-cap and still reports
--     over_cap = true rather than dropping the lead;
--   * fairness is still the SAME single mechanism — the advisory lock plus
--     lead_assignment_state (last_assigned_at, assigned_count). No second ledger.
--     A processor's stamp is bumped by every lead they get, real-time or not, so the
--     two pools stay consistent with each other.
--
-- STRATEGY INTERACTION. round_robin and least_open_deals keep their ordering INSIDE
-- the processor pool. 'manual' is honored (nothing is assigned). 'specific_closer' is
-- deliberately OVERRIDDEN for real-time leads when an active processor exists — the
-- ruling is that a hot lead lands on someone who works hot leads — and the activity
-- log says so explicitly on every such deal, so the override is never silent.
--
-- FALLBACK. If there is NO active processor at all, a real-time lead falls back to
-- the normal pool rather than going unassigned, and the breadcrumb records that the
-- fallback happened. An unassigned paid lead is the worst outcome; the existing code
-- already treats it that way and this keeps that property.

begin;

-- ── The real-time lead-source set, in one place ──────────────────────────────
-- Any code that needs to ask "is this a hot lead?" calls this instead of
-- re-typing the pair. Changing the set means changing this function only.
create or replace function public.is_realtime_lead_source(p_lead_source text)
returns boolean
language sql
immutable
set search_path to 'public'
as $$
  select coalesce(p_lead_source, '') in ('live_transfer', 'realtime_appt');
$$;

comment on function public.is_realtime_lead_source(text) is
  'True for deals.lead_source values that are time-critical on arrival (Synergy live transfers and real-time appointments). Single source of truth for real-time routing.';

-- ── next_lead_closer: gains a pool selector and a pool report ────────────────
-- The return type gains a 5th column (pool), so the old signatures are dropped
-- and rebuilt. Both are service_role-only; the only caller is the deals trigger,
-- which plpgsql resolves at runtime, so dropping inside this transaction is safe.
drop function if exists public.next_lead_closer();
drop function if exists public.next_lead_closer(boolean);

create function public.next_lead_closer(p_realtime boolean)
returns table(closer_profile_id uuid, closer_name text, over_cap boolean, strategy text, pool text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_strategy text;
  v_specific uuid;
  v_has_processor boolean;
  v_pool text;
begin
  perform pg_advisory_xact_lock(hashtext('mfunding.lead_round_robin'));

  select coalesce(ps.value->>'strategy', 'round_robin'),
         nullif(ps.value->>'specific_closer_profile_id', '')::uuid
    into v_strategy, v_specific
    from public.platform_settings ps
   where ps.key = 'lead_assignment';

  if v_strategy is null
     or v_strategy not in ('round_robin', 'least_open_deals', 'manual', 'specific_closer') then
    v_strategy := 'round_robin';
  end if;

  -- 'manual' means a human assigns. Unchanged for every lead kind.
  if v_strategy = 'manual' then
    return;
  end if;

  insert into public.lead_assignment_state (closer_user_id)
  select c.user_id
    from public.closers c
   where c.status = 'active'
     and c.user_id is not null
  on conflict (closer_user_id) do nothing;

  -- Which pool are we drawing from? Only a real-time lead can draw from the
  -- processor pool, and only if that pool is non-empty.
  if coalesce(p_realtime, false) then
    select exists (
      select 1 from public.closers c
       where c.status = 'active'
         and c.user_id is not null
         and c.is_processor = true
    ) into v_has_processor;
    v_pool := case when v_has_processor then 'processor' else 'processor_fallback' end;
  else
    v_has_processor := false;
    v_pool := 'all';
  end if;

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
      ) as month_count,
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
       -- The processor filter. When the pool is 'processor' this is the ONLY
       -- added restriction; status='active' still applies, so a terminated
       -- processor is as ineligible as a terminated closer.
       and (v_pool <> 'processor' or c.is_processor = true)
  )
  select
    e.user_id,
    nullif(e.name, '')::text,
    (e.max_leads_per_month is not null and e.month_count >= e.max_leads_per_month) as over_cap,
    v_strategy,
    v_pool
  from eligible e
  left join public.lead_assignment_state s on s.closer_user_id = e.user_id
  -- specific_closer is honored for normal leads and for the real-time fallback;
  -- it is bypassed when an actual processor pool exists (see header).
  where (v_strategy <> 'specific_closer' or v_pool = 'processor' or e.user_id = v_specific)
  order by
    (e.max_leads_per_month is null or e.month_count < e.max_leads_per_month) desc,
    (case when v_strategy = 'least_open_deals' then e.open_count end) asc nulls last,
    s.last_assigned_at asc nulls first,
    coalesce(s.assigned_count, 0) asc,
    e.user_id
  limit 1;
end;
$function$;

-- Backwards-compatible zero-arg form (non-real-time). No DEFAULT on the boolean
-- overload, so next_lead_closer() is never ambiguous.
create function public.next_lead_closer()
returns table(closer_profile_id uuid, closer_name text, over_cap boolean, strategy text, pool text)
language sql
security definer
set search_path to 'public'
as $function$
  select * from public.next_lead_closer(false);
$function$;

-- Restore the ORIGINAL privilege surface: service_role only.
-- ⚠️ `revoke ... from public` is NOT enough here. Supabase ships ALTER DEFAULT
-- PRIVILEGES granting EXECUTE on new public-schema functions to anon and
-- authenticated, so a freshly CREATEd function silently picks both up. This is a
-- SECURITY DEFINER function that reads closers and per-closer deal counts and
-- returns a closer's name — leaving anon on it would hand the roster to the
-- public. Revoke both by name.
revoke all on function public.next_lead_closer(boolean) from public, anon, authenticated;
revoke all on function public.next_lead_closer() from public, anon, authenticated;
grant execute on function public.next_lead_closer(boolean) to service_role;
grant execute on function public.next_lead_closer() to service_role;

comment on function public.next_lead_closer(boolean) is
  'Picks the next closer for a new lead. p_realtime=true restricts the pool to active processors (closers.is_processor), falling back to all active closers when no processor exists. Returns pool = processor | processor_fallback | all.';

-- ── The trigger: classify the lead, then explain the routing in the log ──────
create or replace function public.deals_auto_assign_closer()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid; v_name text; v_over_cap boolean; v_strategy text; v_pool text;
  v_label text; v_why text; v_err text; v_realtime boolean;
begin
  begin
    if new.assigned_closer_id is null then
      v_realtime := public.is_realtime_lead_source(new.lead_source);

      select n.closer_profile_id, n.closer_name, n.over_cap, n.strategy, n.pool
        into v_uid, v_name, v_over_cap, v_strategy, v_pool
        from public.next_lead_closer(v_realtime) n;

      if v_uid is null then
        begin
          insert into public.activity_log (entity_type, entity_id, interaction_type, subject, content)
          values ('deal', new.id, 'note', 'lead:assignment-failed',
            'NO CLOSER ASSIGNED — next_lead_closer() returned nobody (strategy=' || coalesce(v_strategy,'unknown')
            || ', pool=' || coalesce(v_pool,'unknown')
            || '). The deal exists but is UNASSIGNED. Closers can see and claim it in My Day; if nobody does, this lead is being paid for and ignored.');
        exception when others then null;
        end;
        return new;
      end if;

      new.assigned_closer_id := v_uid;
      perform public.stamp_lead_assignment(v_uid);

      v_label := case v_strategy
                   when 'least_open_deals' then 'least open deals'
                   when 'specific_closer' then 'specific closer'
                   else 'round-robin'
                 end;

      -- Why this pool. Real-time leads say so out loud; a fallback says so louder.
      v_why := case v_pool
        when 'processor' then
          ' — ROUTED TO A PROCESSOR because this is a real-time lead (lead_source='
          || coalesce(new.lead_source, 'null')
          || '). Real-time leads go to the processor pool so a hot merchant lands on someone who works hot leads.'
          || case when v_strategy = 'specific_closer'
                  then ' The specific_closer setting was overridden for this real-time lead.' else '' end
        when 'processor_fallback' then
          ' — real-time lead (lead_source=' || coalesce(new.lead_source, 'null')
          || ') but NO ACTIVE PROCESSOR exists, so it FELL BACK to the normal pool. '
          || 'Mark a closer as a processor (Admin -> Closers) so the next hot lead routes correctly.'
        else '' end;

      begin
        insert into public.activity_log (entity_type, entity_id, interaction_type, subject, content)
        values ('deal', new.id, 'note', 'lead:auto-assigned',
          'Auto-assigned to ' || coalesce(v_name, v_uid::text) || ' (' || v_label || ')'
          || case when v_over_cap then ' — over monthly cap (all candidates at cap)' else '' end
          || v_why);
      exception when others then null;
      end;
    else
      if exists (select 1 from public.closers c where c.user_id = new.assigned_closer_id and c.status = 'active') then
        perform public.stamp_lead_assignment(new.assigned_closer_id);
      end if;
    end if;
  exception when others then
    v_err := sqlerrm;
    begin
      insert into public.activity_log (entity_type, entity_id, interaction_type, subject, content)
      values ('deal', new.id, 'note', 'lead:assignment-failed',
        'AUTO-ASSIGNMENT ERRORED — the deal was created UNASSIGNED. Error: ' || coalesce(v_err,'unknown'));
    exception when others then null;
    end;
    return new;
  end;
  return new;
end;
$function$;

commit;
