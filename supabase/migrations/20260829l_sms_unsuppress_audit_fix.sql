-- Fix the audit trail on sms_admin_unsuppress.
--
-- The original (20260829e) logged with entity_type='sms' and no entity_id, but
-- activity_log.entity_id is NOT NULL and entity_type is CHECK'd to
-- customer/lender/marketing_vendor/deal. That insert failed both constraints and
-- was swallowed by the best-effort wrapper — so the super-admin "re-enable
-- texting" override (which overrides a TCPA opt-out) ran WITHOUT an audit row.
-- This rewrites it to log one CHECK-valid, customer-scoped audit row per merchant
-- whose do_not_contact it clears. (A number with only an sms_opt_outs row and no
-- customer has no valid entity_id to scope to, so it simply gets no audit row.)
create or replace function public.sms_admin_unsuppress(p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role    text;
  v_norm    text;
  v_last10  text;
  v_optout  int;
  v_cleared int := 0;
  r         record;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is distinct from 'super_admin' then
    raise exception 'not authorized: super_admin only' using errcode = '42501';
  end if;

  v_norm := public.sms_normalize_phone(p_phone);
  if v_norm is null or v_norm = '' then
    raise exception 'unparseable phone: %', p_phone;
  end if;
  v_last10 := right(regexp_replace(v_norm, '\D', '', 'g'), 10);
  if length(v_last10) < 10 then
    raise exception 'phone must have 10 digits: %', p_phone;
  end if;

  delete from public.sms_opt_outs
   where right(regexp_replace(phone, '\D', '', 'g'), 10) = v_last10;
  get diagnostics v_optout = row_count;

  for r in
    update public.customers
       set do_not_contact = false
     where do_not_contact is true
       and ( right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) = v_last10
             or exists (
               select 1 from unnest(coalesce(additional_phones, '{}'::text[])) ap
               where right(regexp_replace(ap, '\D', '', 'g'), 10) = v_last10
             ) )
    returning id
  loop
    v_cleared := v_cleared + 1;
    begin
      insert into public.activity_log
        (entity_type, entity_id, interaction_type, subject, content, logged_by)
      values
        ('customer', r.id, 'note',
         'SMS suppression lifted for ' || v_norm,
         'Super-admin re-enabled texting: removed ' || v_optout ||
           ' suppression row(s); cleared do_not_contact.',
         auth.uid());
    exception when others then
      null;
    end;
  end loop;

  return jsonb_build_object(
    'phone', v_norm,
    'optout_deleted', v_optout,
    'customers_cleared', v_cleared
  );
end;
$$;
