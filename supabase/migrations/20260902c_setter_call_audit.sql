-- Daily setter CALL AUDIT (admin-only) + disposition relabeling (2026-09-02)
--
-- Owner: "I want this analysis done daily … only the administrator can see it,
-- once a day at the end of the work day" + "tell me which are mislabeled and give
-- me an accept/decline button to fix them."
-- The nightly setter-daily-audit fn stores one row per setter per day: hard
-- metrics from wavv_calls + a transcript sample classified (conversation /
-- VM-with-our-drop / VM-greeting-listened / no-transcript) with suspected
-- mislabels + suggested dispositions. Accepting a relabel fixes OUR mirrored
-- wavv_calls.disposition (original preserved) so every scorecard counts right.

alter table public.wavv_calls
  add column if not exists disposition_original text;

create table if not exists public.setter_call_audits (
  id          uuid primary key default gen_random_uuid(),
  audit_date  date not null,
  setter_name text not null,
  metrics     jsonb not null default '{}'::jsonb,
  sample      jsonb not null default '[]'::jsonb,
  summary     text,
  created_at  timestamptz not null default now(),
  unique (audit_date, setter_name)
);

alter table public.setter_call_audits enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='setter_call_audits' and policyname='audit_super_admin_read') then
    create policy audit_super_admin_read on public.setter_call_audits
      for select to authenticated
      using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'super_admin'));
  end if;
end$$;
-- writes via the edge fn (service role) only.

-- Accept/decline a suspected mislabel. accept → relabel our mirrored call row
-- (original kept) + mark the sample item; decline → mark only.
create or replace function public.setter_audit_review(
  p_audit_id uuid,
  p_call_id text,
  p_verdict text,
  p_new_disposition text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not exists (select 1 from public.profiles p where p.id = v_uid and p.role = 'super_admin') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_verdict not in ('accept','decline') then
    raise exception 'verdict must be accept or decline' using errcode = 'P0001';
  end if;

  if p_verdict = 'accept' then
    if p_new_disposition is null or btrim(p_new_disposition) = '' then
      raise exception 'accept needs the corrected disposition' using errcode = 'P0001';
    end if;
    update public.wavv_calls
       set disposition_original = coalesce(disposition_original, disposition),
           disposition = p_new_disposition
     where wavv_call_id = p_call_id;
  end if;

  update public.setter_call_audits
     set sample = (
       select coalesce(jsonb_agg(
         case when item->>'call_id' = p_call_id
              then item || jsonb_build_object('review', p_verdict,
                     'applied_disposition', case when p_verdict='accept' then p_new_disposition end)
              else item end), '[]'::jsonb)
       from jsonb_array_elements(sample) as item
     )
   where id = p_audit_id;

  return jsonb_build_object('ok', true, 'verdict', p_verdict);
end;
$function$;

revoke all on function public.setter_audit_review(uuid, text, text, text) from public, anon;
grant execute on function public.setter_audit_review(uuid, text, text, text) to authenticated, service_role;
