-- Setters (profiles.role='closer') may SEARCH the whole book, but may not read
-- the MONEY on a deal that is not theirs. Enforced at the DATABASE, not the UI.
--
-- WHY THIS EXISTS
-- 20260812_closer_search_all_merchants.sql replaced the own-book SELECT policies
-- on deals + customers with `closer_select_all_deals` / `closer_select_all_customers`
-- (USING: is_closer OR has_closer_row). That fixed a real problem — a setter on a
-- call could not pull up a merchant another setter already worked — but Postgres
-- RLS is ROW-level only: opening the row opens every column on it. deals carries
-- amount_funded, amount_requested, expected_value ("P(close) x expected gross
-- commission"), payback_amount, balance_override, ... so any setter could read the
-- company's entire economics out of devtools and back out the split. Column GRANTs
-- can't help either: admins and setters are both the same DB role (`authenticated`).
--
-- THE SHAPE OF THE FIX
--   1. deals base SELECT for a setter goes back to OWN-BOOK + UNASSIGNED (full row,
--      money included — they're working those, and the Playbook shows their value
--      by design; unassigned is required for the "This is mine" claim).
--   2. Whole-book deal reads move to two SECURITY DEFINER RPCs that MASK the money
--      when the caller neither owns the deal nor is ops staff.
--   3. customers stays whole-book (closer_select_all_customers UNTOUCHED). That is
--      what the setter search box actually queries (PlaybookCapture -> customers),
--      so whole-book search and the claim flow keep working unchanged. customers
--      carries merchant qualification revenue, which a setter must see to qualify;
--      it carries no deal economics and no commission.
--   4. Admin / super_admin / employee: unchanged. "Admins manage deals" (FOR ALL,
--      is_ops_staff) still gives full column access on every row.
--
-- DEFAULT-DENY: the masked shape is built from an explicit ALLOW-LIST of safe
-- columns. A money column added to deals by a future migration is hidden from
-- non-owners automatically — it has to be named here to become visible.

-- ---------------------------------------------------------------------------
-- 0. Helper: the closers.id rows this auth user owns.
-- ---------------------------------------------------------------------------
-- deals.assigned_closer_id is a profiles.id in most rows but a closers.id in the
-- legacy ones (the profiles<->closers split-brain closer_owns_deal already handles).
-- SECURITY DEFINER so the policy's subquery is not itself subject to RLS on
-- `closers`, and array-returning so it evaluates ONCE as an InitPlan instead of
-- per row (matches the 20260813 rls_initplan work).
-- Self-scoped on purpose: the grant below makes it REST-reachable at
-- /rest/v1/rpc/my_closer_ids with an arbitrary uid, and it only ever needs to
-- answer for the caller.
create or replace function public.my_closer_ids(uid uuid)
returns uuid[]
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    when uid is null then '{}'::uuid[]
    when uid = (select auth.uid()) or public.is_ops_staff((select auth.uid()))
      then coalesce((select array_agg(c.id) from public.closers c where c.user_id = uid), '{}'::uuid[])
    else '{}'::uuid[]
  end;
$$;

revoke all on function public.my_closer_ids(uuid) from public, anon;
grant execute on function public.my_closer_ids(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. deals: setter SELECT is own-book + unassigned again.
-- ---------------------------------------------------------------------------
drop policy if exists closer_select_all_deals on public.deals;

drop policy if exists closer_select_own_deals on public.deals;
create policy closer_select_own_deals on public.deals
  for select to authenticated
  using (
    (public.is_closer((select auth.uid())) or public.has_closer_row((select auth.uid())))
    and (
      -- Unassigned is the claim pool: MyDayQueue renders it and
      -- closer_claim_unassigned_deals lets them take it. Must stay visible.
      assigned_closer_id is null
      or assigned_closer_id = (select auth.uid())
      or created_by = (select auth.uid())
      -- NOTE: no (select ...) wrapper here. `= ANY ((select f()))` parses as
      -- ANY(subquery) and fails with "uuid = uuid[]"; the arg is already an
      -- InitPlan, so the stable function is evaluated once per statement.
      or assigned_closer_id = any (public.my_closer_ids((select auth.uid())))
    )
  );

comment on policy closer_select_own_deals on public.deals is
  'Setter (role=closer) full-row read: their own deals + the unassigned claim pool. Whole-book deal reads go through get_deal_lite()/find_customer_deals_lite(), which mask the money. Postgres RLS cannot hide a column, so the money wall has to be a ROW wall plus a masked RPC.';

-- customers is deliberately NOT touched here: closer_select_all_customers stays,
-- because it is the whole-book SEARCH surface and carries no deal economics.

-- ---------------------------------------------------------------------------
-- 2. The masked whole-book read.
-- ---------------------------------------------------------------------------
-- Money columns. Present as explicit NULLs in the masked shape so the client's
-- Deal type stays whole and a missing key never reads as "0".
create or replace function public.deal_money_keys()
returns text[]
language sql
immutable
set search_path to ''
as $$
  select array[
    'amount_requested','amount_funded','payback_amount','remittance_amount',
    'balance_override','expected_value','paydown_percentage',
    'vcf_total_balance','vcf_daily_debit',
    'lead_score','lead_grade','score_reasons','score_version','scored_at','mca_score',
    'ai_lender_recommendations','ai_recommended_at',
    'lead_qual'
  ]::text[];
$$;

comment on function public.deal_money_keys() is
  'Columns on deals that reveal dollar figures or company economics (expected_value is literally P(close) x expected gross commission; lead_qual holds the requested amount; ai_lender_recommendations names funders). Masked to NULL for setters on deals they do not own.';

-- Non-money columns a setter may see on ANY deal. ALLOW-LIST on purpose: a new
-- column is hidden until it is added here.
create or replace function public.deal_safe_keys()
returns text[]
language sql
immutable
set search_path to ''
as $$
  select array[
    'id','customer_id','deal_number','deal_type','status','previous_status',
    'use_of_funds','urgency','application_type',
    'contacted_at','qualified_at','application_sent_at','docs_collected_at',
    'submitted_at','offer_received_at','offer_presented_at','funded_at','declined_at',
    'bank_statements_at','offer_accepted_at','nurture_at','first_call_due_at',
    'assigned_closer_id','created_by','created_at','updated_at',
    'lead_source','lead_source_detail','market','campaign_id',
    'is_renewal','original_deal_id','renewal_count','renewal_eligible_date',
    'last_renewal_milestone',
    'ghl_contact_id','ghl_opportunity_id',
    'notes','tags','lost_reason','closed_reason','closed_note',
    'vcf_current_funders','vcf_hardship_reason',
    'playbook_checklist','doc_checklist','playbook_link_at',
    'merchant_reply_at','merchant_reply_summary',
    'ai_business_summary','temperature','underwriting_context',
    'stips_promised_by','remittance_frequency','first_remittance_date','balance_as_of',
    'first_touch_channel','first_attempt_at','last_attempt_at','contact_attempts','spoke_at',
    'callback_at','callback_ghl_event_id','callback_synced_at','callback_sync_error',
    'callback_invite','callback_ghl_calendar_id','callback_source',
    'products_interested',
    'existing_positions','existing_funders','existing_positions_detail',
    'existing_positions_source','existing_positions_synced_at',
    'appointment_at','appointment_ghl_event_id','appointment_ghl_calendar_id',
    'appointment_synced_at','appointment_sync_error','appointment_owner_user_id',
    'appointment_promised_at'
  ]::text[];
$$;

-- Full row for ops staff and for the setter who owns the deal; masked otherwise.
create or replace function public.deal_row_for_caller(d public.deals, uid uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_full jsonb := to_jsonb(d);
  v_out  jsonb;
begin
  if public.is_ops_staff(uid)
     or d.created_by = uid
     or d.assigned_closer_id = uid
     or d.assigned_closer_id = any (public.my_closer_ids(uid))
  then
    return v_full;
  end if;

  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    into v_out
  from jsonb_each(v_full) e
  where e.key = any (public.deal_safe_keys());

  -- explicit NULLs so the client shape is stable and nothing reads as 0
  select v_out || coalesce(jsonb_object_agg(k, 'null'::jsonb), '{}'::jsonb)
    into v_out
  from unnest(public.deal_money_keys()) k;

  return v_out;
end;
$$;

revoke all on function public.deal_row_for_caller(public.deals, uuid) from public, anon, authenticated;

-- Staff gate shared by both RPCs.
create or replace function public.is_staff_reader(uid uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.is_ops_staff(uid) or public.is_closer(uid) or public.has_closer_row(uid);
$$;

revoke all on function public.is_staff_reader(uuid) from public, anon;
grant execute on function public.is_staff_reader(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2a. Read one deal by id, money-masked when it isn't the caller's.
-- ---------------------------------------------------------------------------
-- Keeps the setter deep-link (?x= -> playbook-open-contact -> getDealById) working
-- on a merchant another setter owns, without handing over the economics.
create or replace function public.get_deal_lite(p_deal_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_uid  uuid := auth.uid();
  v_deal public.deals;
  v_out  jsonb;
begin
  if v_uid is null or not public.is_staff_reader(v_uid) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select * into v_deal from public.deals where id = p_deal_id;
  if not found then
    return null;
  end if;

  v_out := public.deal_row_for_caller(v_deal, v_uid);

  v_out := v_out || jsonb_build_object(
    'customer', (
      select to_jsonb(x) from (
        select c.id, c.first_name, c.last_name, c.business_name, c.email,
               c.additional_emails, c.phone, c.additional_phones,
               c.monthly_revenue, c.time_in_business, c.industry,
               c.address_street, c.address_city, c.address_state, c.address_zip,
               c.annual_revenue, c.employees, c.entity_type, c.owner_title,
               c.sic_code, c.website, c.do_not_contact
        from public.customers c where c.id = v_deal.customer_id
      ) x
    ),
    'closer', (
      select to_jsonb(y) from (
        select p.id, p.first_name, p.last_name
        from public.profiles p where p.id = v_deal.assigned_closer_id
      ) y
    )
  );

  return v_out;
end;
$$;

revoke all on function public.get_deal_lite(uuid) from public, anon;
grant execute on function public.get_deal_lite(uuid) to authenticated, service_role;

comment on function public.get_deal_lite(uuid) is
  'Whole-book single-deal read for staff. Returns the FULL row to ops staff and to the setter who owns the deal; returns the allow-listed non-money columns (money keys NULL) to anyone else. The money wall for role=closer.';

-- ---------------------------------------------------------------------------
-- 2b. A customer's deals of one type, money-masked. Dedupe/resume lookup.
-- ---------------------------------------------------------------------------
-- PlaybookCapture must be able to tell that a merchant already has an OPEN deal
-- even when another setter owns it — otherwise tightening the SELECT policy makes
-- it mint a duplicate deal AND a duplicate GHL opportunity on every pick.
create or replace function public.find_customer_deals_lite(
  p_customer_id uuid,
  p_deal_type   text default null
)
-- Returns ONE jsonb array, not SETOF jsonb: a scalar SETOF return has an ambiguous
-- PostgREST body shape, and this is on the live dedupe path.
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_out jsonb;
begin
  if v_uid is null or not public.is_staff_reader(v_uid) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(public.deal_row_for_caller(d, v_uid) order by d.created_at desc), '[]'::jsonb)
    into v_out
  from public.deals d
  where d.customer_id = p_customer_id
    and (p_deal_type is null or d.deal_type = p_deal_type);

  return v_out;
end;
$$;

revoke all on function public.find_customer_deals_lite(uuid, text) from public, anon;
grant execute on function public.find_customer_deals_lite(uuid, text) to authenticated, service_role;

comment on function public.find_customer_deals_lite(uuid, text) is
  'All deals for one customer (newest first), money-masked for setters who do not own them. Exists so the Playbook dedupe/resume lookup still SEES another setter''s open deal instead of minting a duplicate.';
