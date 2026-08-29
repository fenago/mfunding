-- Admin override to LIFT an SMS suppression.
--
-- Normally the only way a number comes off the SMS suppression list is an
-- inbound START/UNSTOP from the merchant (the TCPA re-consent path). But staff
-- need a manual override for the legitimate cases: a phrase-STOP false trigger,
-- a merchant who re-consents verbally on a call, or a test number. This is that
-- override — super_admin only, audited, and it clears BOTH stores the send-time
-- gate checks (sms_opt_outs AND customers.do_not_contact), because neither is a
-- superset of the other.
--
-- SECURITY DEFINER so it can touch sms_opt_outs (service_role-only RLS); the
-- super_admin check inside is the real gate.
create or replace function public.sms_admin_unsuppress(p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role     text;
  v_norm     text;
  v_last10   text;
  v_optout   int;
  v_cleared  int;
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

  update public.customers
     set do_not_contact = false
   where do_not_contact is true
     and ( right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) = v_last10
           or exists (
             select 1 from unnest(coalesce(additional_phones, '{}'::text[])) ap
             where right(regexp_replace(ap, '\D', '', 'g'), 10) = v_last10
           ) );
  get diagnostics v_cleared = row_count;

  -- Best-effort audit: never let a logging hiccup fail the override itself.
  begin
    insert into public.activity_log
      (entity_type, interaction_type, subject, content, logged_by)
    values
      ('sms', 'sms_unsuppress',
       'SMS suppression lifted for ' || v_norm,
       'Admin re-enabled texting: removed ' || v_optout ||
         ' suppression row(s), cleared do_not_contact on ' || v_cleared || ' customer(s).',
       auth.uid());
  exception when others then
    null;
  end;

  return jsonb_build_object(
    'phone', v_norm,
    'optout_deleted', v_optout,
    'customers_cleared', v_cleared
  );
end;
$$;

revoke all on function public.sms_admin_unsuppress(text) from public, anon;
grant execute on function public.sms_admin_unsuppress(text) to authenticated;
