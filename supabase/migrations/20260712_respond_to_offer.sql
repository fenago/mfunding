-- ============================================================================
-- Wave 3 — 4.1: merchant offer accept / decline.
-- Applied live via MCP 2026-07-12.
--
-- Two changes, both additive:
--   1. get_my_deal_submissions() ALSO returns submission_id (the deal_submissions
--      row id). It is an OPAQUE HANDLE the portal uses to target accept/decline —
--      it is NOT lender identity and leaks nothing (the RPC stays anonymized:
--      still no lender_id, commission, or notes).
--   2. respond_to_offer(p_submission_id, p_response) — the only way a merchant can
--      accept or decline an offer. SECURITY DEFINER, ownership-gated, status-gated,
--      expiry-gated. It changes ONLY deal_submissions.status. It deliberately does
--      NOT touch deals.status, sibling submissions, commissions, or GHL — accepting
--      an offer is the merchant saying "this one" ; the closer still drives the deal
--      to funded (STATUS_TIMESTAMP_MAP + autoCreateCommissionForFundedDeal + GHL
--      sync all live on the closer's stage-move path, untouched here).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Re-declare get_my_deal_submissions with submission_id prepended.
--    Everything else is byte-for-byte identical to
--    20260711_offer_expires_and_deal_submissions_rpc.sql — same anonymization,
--    same status_bucket map, same positional partner_label. Additive column only.
-- ---------------------------------------------------------------------------
drop function if exists public.get_my_deal_submissions(uuid);
create function public.get_my_deal_submissions(p_deal_id uuid)
returns table (
  submission_id   uuid,
  partner_label   text,
  status_bucket   text,
  submitted_at    timestamptz,
  offer_amount    numeric,
  offer_payback   numeric,
  offer_term      integer,
  offer_payment   numeric,
  offer_frequency text,
  offer_expires_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  with owned as (
    select d.id
    from public.deals d
    join public.customers c on c.id = d.customer_id
    where d.id = p_deal_id
      and c.user_id = auth.uid()
  ),
  ranked as (
    select
      s.*,
      row_number() over (order by s.created_at, s.id) as pos,
      case s.status
        when 'pending'        then 'submitted'
        when 'submitted'      then 'submitted'
        when 'under_review'   then 'reviewing'
        when 'approved'       then 'offer'
        when 'offer_made'     then 'offer'
        when 'offer_accepted' then 'offer'
        when 'funded'         then 'offer'
        when 'declined'       then 'declined'
        when 'offer_declined' then 'declined'
        when 'withdrawn'      then 'withdrawn'
        else 'submitted'
      end as bucket
    from public.deal_submissions s
    where s.deal_id in (select id from owned)
  )
  select
    id                                                           as submission_id,
    'Funding Partner ' || chr(64 + pos::int)                     as partner_label,
    bucket                                                       as status_bucket,
    submitted_at,
    case when bucket = 'offer' then offer_amount   end           as offer_amount,
    case when bucket = 'offer' then total_payback  end           as offer_payback,
    case when bucket = 'offer' then term_months    end           as offer_term,
    case when bucket = 'offer'
         then coalesce(daily_payment, weekly_payment) end        as offer_payment,
    case when bucket = 'offer'
         then case
                when daily_payment  is not null then 'daily'
                when weekly_payment is not null then 'weekly'
                else null
              end
    end                                                          as offer_frequency,
    case when bucket = 'offer' then offer_expires_at end         as offer_expires_at
  from ranked
  order by pos;
$$;

revoke all on function public.get_my_deal_submissions(uuid) from public, anon;
grant execute on function public.get_my_deal_submissions(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) respond_to_offer — merchant accepts or declines a presented offer.
--
--    Validates, in order:
--      • signed in
--      • p_response in ('accept','decline')
--      • the submission exists AND its deal's customer belongs to the caller
--        (customers.user_id = auth.uid())
--      • the submission is in a live offer-presented status: 'approved' or
--        'offer_made'. Already-responded ('offer_accepted'/'offer_declined') and
--        terminal ('funded') are refused with a clear message.
--      • the offer has not expired (offer_expires_at)
--
--    Effect: status -> 'offer_accepted' | 'offer_declined', response_at = now().
--    Writes a closer-facing activity_log entry using the EXISTING board protocol
--    marker `funder:note — <LenderName>`, so it renders on the correct funder card
--    in FunderResponsesBoard (Step 7) with no reader change. Merchants have no
--    SELECT on activity_log, so naming the lender there does not leak it to them.
--
--    SECURITY DEFINER because a merchant (role 'user') has no INSERT on
--    activity_log and no UPDATE on deal_submissions — both must happen through
--    this server-controlled entry point, built from the server's view of who the
--    caller is.
-- ---------------------------------------------------------------------------
create or replace function public.respond_to_offer(
  p_submission_id uuid,
  p_response      text
)
returns public.deal_submissions
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_uid       uuid := auth.uid();
  v_sub       public.deal_submissions%rowtype;
  v_owns      boolean;
  v_new_status text;
  v_lender    text;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if p_response not in ('accept', 'decline') then
    raise exception 'Response must be accept or decline';
  end if;

  select * into v_sub from public.deal_submissions where id = p_submission_id;
  if not found then
    raise exception 'Offer not found';
  end if;

  -- Ownership: the deal behind this submission must belong to the caller.
  select exists (
    select 1
    from public.deals d
    join public.customers c on c.id = d.customer_id
    where d.id = v_sub.deal_id and c.user_id = v_uid
  ) into v_owns;
  if not v_owns then
    raise exception 'This offer is not on one of your deals';
  end if;

  -- Must be a live, presented offer awaiting a response.
  if v_sub.status in ('offer_accepted', 'offer_declined') then
    raise exception 'You have already responded to this offer';
  end if;
  if v_sub.status not in ('approved', 'offer_made') then
    raise exception 'This offer is not available to accept or decline';
  end if;

  -- Expiry: a lapsed offer cannot be accepted or declined.
  if v_sub.offer_expires_at is not null and v_sub.offer_expires_at < now() then
    raise exception 'This offer has expired';
  end if;

  v_new_status := case when p_response = 'accept' then 'offer_accepted' else 'offer_declined' end;

  update public.deal_submissions
  set status = v_new_status,
      response_at = now(),
      updated_at = now()
  where id = p_submission_id
  returning * into v_sub;

  -- Closer-facing trail. `funder:note — <name>` is the existing board marker
  -- (FunderResponsesBoard already filters + renders it on the matching card).
  select company_name into v_lender from public.lenders where id = v_sub.lender_id;
  insert into public.activity_log (entity_type, entity_id, interaction_type, subject, content, logged_by)
  values (
    'deal', v_sub.deal_id, 'note',
    'funder:note — ' || coalesce(v_lender, 'Funding Partner'),
    case when p_response = 'accept'
         then 'Merchant ACCEPTED this offer from the customer portal.'
         else 'Merchant DECLINED this offer from the customer portal.' end,
    v_uid
  );

  return v_sub;
end;
$fn$;

revoke all on function public.respond_to_offer(uuid, text) from public, anon;
grant execute on function public.respond_to_offer(uuid, text) to authenticated;
