-- Caller-ID -> setter attribution for the Setter Performance page.
--
-- WAVV does NOT attribute a call to a user: the call object carries no user
-- field (wavv_calls.agent_key / agent_name are 100% NULL across 10,454 rows)
-- and team_id is a single constant for the whole account. The ONLY dial-side
-- identifier is caller_id -- the number we dialed FROM.
--
-- GHL cannot fill the gap either: GET /phone-system/numbers/ for location
-- t7NmVR4WCy927j4Zon4b returns exactly one number (+19547375692, "Main Corp
-- Number") and neither WAVV outbound caller ID (9543354964 / 9542450661) is
-- known to GHL at all. So attribution has to be an admin-maintained mapping.
--
-- IMPORTANT: on INBOUND rows caller_id is the MERCHANT's number, so this
-- mapping is only meaningful for direction = 'outbound'. Every read path below
-- filters on that.

create table if not exists public.wavv_caller_setters (
  -- RAW digits exactly as WAVV reports them, e.g. '9543354964' (no +1).
  -- Normalized by trigger so an admin can paste +1 (954) 335-4964 and still
  -- join cleanly against wavv_calls.caller_id.
  caller_id   text primary key,
  setter_id   uuid references public.profiles(id) on delete set null,
  label       text,
  source      text not null default 'manual' check (source in ('manual','ghl')),
  updated_by  uuid references public.profiles(id) on delete set null,
  updated_at  timestamptz not null default now()
);

comment on table public.wavv_caller_setters is
  'Admin-managed map of OUTBOUND WAVV caller-ID number -> setter (profiles.id). WAVV exposes no per-user attribution; caller_id is the only dial-side identifier. Not meaningful for inbound calls (there caller_id is the merchant).';
comment on column public.wavv_caller_setters.caller_id is
  'Raw digits as WAVV reports them (10-digit NANP, no +1). Normalized on write.';
comment on column public.wavv_caller_setters.source is
  'manual = assigned by an admin in the UI; ghl = derived from a GHL user phone assignment.';

create index if not exists wavv_caller_setters_setter_idx
  on public.wavv_caller_setters (setter_id);

-- Normalize caller_id to bare digits (strip +1/leading 1 on 11-digit NANP) and
-- stamp the writer, so the PK always matches wavv_calls.caller_id.
create or replace function public.wavv_caller_setters_normalize()
returns trigger
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  digits text;
begin
  digits := regexp_replace(coalesce(new.caller_id, ''), '\D', '', 'g');
  if length(digits) = 11 and left(digits, 1) = '1' then
    digits := substr(digits, 2);
  end if;
  if digits = '' then
    raise exception 'caller_id must contain digits';
  end if;
  new.caller_id := digits;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

drop trigger if exists wavv_caller_setters_normalize_trg on public.wavv_caller_setters;
create trigger wavv_caller_setters_normalize_trg
  before insert or update on public.wavv_caller_setters
  for each row execute function public.wavv_caller_setters_normalize();

alter table public.wavv_caller_setters enable row level security;

-- OPS read: closer (setters) / employee / admin / super_admin.
drop policy if exists wavv_caller_setters_ops_read on public.wavv_caller_setters;
create policy wavv_caller_setters_ops_read
  on public.wavv_caller_setters
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role = any (array['closer','employee','admin','super_admin']::user_role[])
    )
  );

-- Admin/super_admin write (insert/update/delete).
drop policy if exists wavv_caller_setters_admin_write on public.wavv_caller_setters;
create policy wavv_caller_setters_admin_write
  on public.wavv_caller_setters
  for all
  to authenticated
  using ((select public.is_admin_or_super((select auth.uid()))))
  with check ((select public.is_admin_or_super((select auth.uid()))));

-- ---------------------------------------------------------------------------
-- Read path (a): attribute OUTBOUND calls to a setter.
-- security_invoker so the caller's RLS on wavv_calls still applies.
-- ---------------------------------------------------------------------------
create or replace view public.v_wavv_outbound_setter_calls
with (security_invoker = true) as
select
  c.id,
  c.wavv_call_id,
  c.started_at,
  c.answered_at,
  c.ended_at,
  c.seconds,
  c.outcome,
  c.disposition,
  c.human,
  c.recorded,
  c.phone,
  c.contact_id,
  c.contact_name,
  c.campaign_id,
  c.caller_id,
  m.setter_id,
  m.label       as caller_label,
  m.source      as mapping_source,
  p.display_name as setter_name,
  p.email        as setter_email,
  (m.setter_id is not null) as is_attributed
from public.wavv_calls c
left join public.wavv_caller_setters m on m.caller_id = c.caller_id
left join public.profiles p on p.id = m.setter_id
where c.direction = 'outbound';

comment on view public.v_wavv_outbound_setter_calls is
  'OUTBOUND wavv_calls resolved to a setter via caller_id -> wavv_caller_setters -> profiles. is_attributed=false means the caller_id has no setter assigned yet.';

-- ---------------------------------------------------------------------------
-- Read path (b): every OUTBOUND caller_id actually seen in wavv_calls, with
-- call counts and its mapping state -- this is the admin panel's worklist.
-- in_mapping_table=false => number seen on the wire but never added.
-- ---------------------------------------------------------------------------
create or replace view public.v_wavv_outbound_caller_ids
with (security_invoker = true) as
with seen as (
  select
    caller_id,
    count(*)          as call_count,
    min(started_at)   as first_seen,
    max(started_at)   as last_seen
  from public.wavv_calls
  where direction = 'outbound' and caller_id is not null
  group by caller_id
)
select
  coalesce(s.caller_id, m.caller_id) as caller_id,
  coalesce(s.call_count, 0)          as call_count,
  s.first_seen,
  s.last_seen,
  m.setter_id,
  p.display_name                     as setter_name,
  p.email                            as setter_email,
  m.label,
  m.source,
  m.updated_at                       as mapping_updated_at,
  (m.caller_id is not null)          as in_mapping_table,
  (m.setter_id is not null)          as is_assigned
from seen s
full outer join public.wavv_caller_setters m on m.caller_id = s.caller_id
left join public.profiles p on p.id = m.setter_id;

comment on view public.v_wavv_outbound_caller_ids is
  'Admin worklist: every OUTBOUND caller_id seen in wavv_calls FULL-joined with wavv_caller_setters. in_mapping_table=false = number on the wire but never added; is_assigned=false = present but no setter picked; call_count=0 = mapped number with no calls yet.';

grant select on public.v_wavv_outbound_setter_calls to authenticated;
grant select on public.v_wavv_outbound_caller_ids to authenticated;

-- Seed the two live outbound caller_ids, UNASSIGNED (setter_id null).
-- GHL knows neither number, so there is nothing to auto-resolve; an admin
-- picks the setter in the UI.
insert into public.wavv_caller_setters (caller_id, setter_id, label, source)
values
  ('9543354964', null, 'WAVV outbound line 1', 'manual'),
  ('9542450661', null, 'WAVV outbound line 2', 'manual')
on conflict (caller_id) do nothing;
