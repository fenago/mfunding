-- Phone census — the sibling of the email census on the Campaign Audit.
--
-- Every vendor-supplied merchant phone (customers.phone) gets a durable verdict,
-- decided by THREE truth layers with an explicit precedence (strongest wins):
--
--   1. HUMAN / BEHAVIORAL (strongest — derived LIVE from ghl_call_log, the same
--      ledger the contact-truth tiers use):
--        · PROVEN BAD  — any call graded 'wrong_number' (a human said this number
--          does not reach the merchant). Outranks everything, even a good call.
--        · PROVEN GOOD — the line demonstrably works: a completed call ≥30s, OR a
--          disposition in (spoke, voicemail, gatekeeper, callback_set,
--          never_requested). A voicemail pickup PROVES the line is live even though
--          it was never a conversation — that's the whole point of the phone census
--          vs. the contact-truth tiers (which don't count voicemail as "connected").
--        · SUSPECT     — 3+ outbound dials and the line never once connected
--          ("never connects"). Its own visible bucket, not folded into bad.
--   2. FORMAT sanity (free, runs for everyone with no behavioral verdict): NANP
--      validity — 10 digits (optionally +1), area code and exchange N=[2-9], no N11
--      service codes, no 555-01xx fiction, not 10 identical digits. Invalid = bad.
--   3. CARRIER lookup (line type / VoIP): NOT configured. No phone-lookup endpoint
--      is reachable on the GHL Private Integration token (verified 2026-07-20:
--      /phone-system/numbers returns only our OWN outbound numbers; /phone/lookup,
--      /phone/verify, /lookup/phone all 404; contacts carry no carrier/line-type
--      field). The layer is a clean seam — platform_settings.phone_lookup.provider
--      = 'none' — so line_type stays null and no VoIP% is shown until a provider
--      (Twilio Lookup or IPQS) is wired up. We never fabricate a lookup result.
--
-- A format-valid number with no behavioral proof and no lookup is 'unchecked'
-- (honest: format passed, but that is not proof the line reaches the merchant).
--
-- The Campaign Audit computes this census LIVE in-query (cheap at this volume) so
-- the owner never sees stale humanness; these persisted columns are the durable,
-- queryable record for other consumers, backfilled now and refreshed by pg_cron.
-- recompute_phone_status() is the single canonical classifier for the persisted
-- copy; campaignAuditService.classifyPhone mirrors it for the live read.

-- ── Persisted per-customer verdict ───────────────────────────────────────────
alter table public.customers
  add column if not exists phone_status text
    check (phone_status in ('good','bad','suspect','unchecked')),
  add column if not exists phone_status_source text
    check (phone_status_source in ('human','format','lookup')),
  add column if not exists phone_checked_at timestamptz,
  add column if not exists line_type text;  -- mobile|landline|voip — null until carrier lookup is configured

comment on column public.customers.phone_status is
  'Phone census verdict: good|bad|suspect|unchecked. Precedence human(behavioral) > format > lookup. Recomputable via recompute_phone_status(); the Campaign Audit computes the same live.';
comment on column public.customers.phone_status_source is
  'Which truth layer decided phone_status: human (ghl_call_log behavioral), format (NANP validity), or lookup (carrier). Null when unchecked.';
comment on column public.customers.line_type is
  'Carrier line type (mobile|landline|voip). Null — carrier lookup not configured (no provider on the GHL token).';

create index if not exists customers_phone_status_idx on public.customers (phone_status);

-- ── Carrier-lookup config seam (disabled) ────────────────────────────────────
-- provider='none' → line_type stays null and the audit shows the not-configured
-- note instead of a VoIP% cell. Flip provider + wire a function to enable.
insert into public.platform_settings (key, value)
values ('phone_lookup', jsonb_build_object(
  'provider', 'none',
  'note', 'No carrier/number lookup on the GHL token. To enable line-type + VoIP detection, wire Twilio Lookup (~$0.008/number, line_type_intelligence) or IPQS (~$0.004/lookup) and set provider accordingly.',
  'candidates', jsonb_build_array(
    jsonb_build_object('provider','twilio_lookup','per_check_usd',0.008,'gives',jsonb_build_array('line_type','carrier','validity')),
    jsonb_build_object('provider','ipqs','per_check_usd',0.004,'gives',jsonb_build_array('line_type','voip','risk_score','validity'))
  )
))
on conflict (key) do update set value = excluded.value, updated_at = now();

-- ── NANP format validity (immutable, reusable) ───────────────────────────────
create or replace function public.is_valid_nanp(p_phone text)
returns boolean
language sql immutable as $$
  with n as (
    select case
      when p_phone is null then null
      when length(regexp_replace(p_phone,'\D','','g')) = 11
           and left(regexp_replace(p_phone,'\D','','g'),1) = '1'
        then right(regexp_replace(p_phone,'\D','','g'),10)
      when length(regexp_replace(p_phone,'\D','','g')) = 10
        then regexp_replace(p_phone,'\D','','g')
      else null
    end as d
  )
  select d is not null
    and substr(d,1,1) between '2' and '9'                       -- area code N
    and substr(d,4,1) between '2' and '9'                       -- exchange N
    and substr(d,2,2) <> '11'                                   -- not an N11 area service code
    and substr(d,5,2) <> '11'                                   -- not an N11 exchange
    and not (substr(d,4,3) = '555' and substr(d,7,4) between '0100' and '0199') -- not 555-01xx fiction
    and d <> repeat(substr(d,1,1),10)                           -- not 10 identical digits
  from n;
$$;

-- ── Canonical recompute — behavioral (live) > format > lookup(none) ──────────
-- p_customer_ids null = all customers with a phone. Idempotent; safe to re-run.
create or replace function public.recompute_phone_status(p_customer_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_count integer;
begin
  with target as (
    select c.id as customer_id, c.phone
    from public.customers c
    where (p_customer_ids is null or c.id = any(p_customer_ids))
  ),
  -- Behavioral signal per customer, aggregated across ALL their deals' outbound calls.
  beh as (
    select t.customer_id,
      count(cl.*) filter (where cl.direction = 'outbound') as dials,
      bool_or(cl.direction = 'outbound' and (
        (cl.call_status = 'completed' and coalesce(cl.duration_seconds,0) >= 30)
        or cl.disposition in ('spoke','voicemail','gatekeeper','callback_set','never_requested')
      )) as line_proven,
      bool_or(cl.disposition = 'wrong_number') as wrong
    from target t
    left join public.deals d on d.customer_id = t.customer_id
    left join public.ghl_call_log cl on cl.deal_id = d.id
    group by t.customer_id
  ),
  verdict as (
    select t.customer_id,
      case
        when nullif(trim(t.phone),'') is null then null                        -- no number on file
        when coalesce(b.wrong,false) then 'bad'                                 -- human: wrong number
        when coalesce(b.line_proven,false) then 'good'                          -- human: line proven live
        when coalesce(b.dials,0) >= 3 and not coalesce(b.line_proven,false) then 'suspect'  -- never connects
        when not public.is_valid_nanp(t.phone) then 'bad'                       -- format invalid
        else 'unchecked'                                                        -- format-valid, unproven
      end as status,
      case
        when nullif(trim(t.phone),'') is null then null
        when coalesce(b.wrong,false) or coalesce(b.line_proven,false)
          or (coalesce(b.dials,0) >= 3 and not coalesce(b.line_proven,false)) then 'human'
        when not public.is_valid_nanp(t.phone) then 'format'
        else null
      end as source
    from target t
    left join beh b on b.customer_id = t.customer_id
  )
  update public.customers c
  set phone_status = v.status,
      phone_status_source = v.source,
      phone_checked_at = now()
      -- line_type intentionally untouched — carrier lookup not configured.
  from verdict v
  where c.id = v.customer_id
    and (c.phone_status is distinct from v.status
         or c.phone_status_source is distinct from v.source);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.recompute_phone_status(uuid[]) from public, anon;
grant execute on function public.recompute_phone_status(uuid[]) to authenticated, service_role;

-- ── Short-cron refresh of the persisted copy (audit reads live regardless) ───
do $$
begin
  if exists (select 1 from cron.job where jobname = 'recompute-phone-status') then
    perform cron.unschedule('recompute-phone-status');
  end if;
end $$;
select cron.schedule('recompute-phone-status', '*/30 * * * *',
  $$ select public.recompute_phone_status(); $$);

-- ── Backfill now ─────────────────────────────────────────────────────────────
select public.recompute_phone_status();
