-- Wave 2 — 3.1: offer_expires_at + get_my_deal_submissions().
--
-- deal_submissions has NO merchant RLS policy (by design — it carries lender_id,
-- commission fields, internal notes). This RPC is the ONLY merchant-facing read:
-- anonymized, per-deal, ownership-gated. It never exposes the funder identity,
-- commission, or notes.

-- 1) When an offer expires (merchant-facing countdown in the portal).
alter table public.deal_submissions
  add column if not exists offer_expires_at timestamptz;

-- 2) Anonymized merchant read of a deal's submissions.
--
-- status_bucket mapping (real SubmissionStatus -> merchant bucket):
--   pending, submitted                        -> 'submitted'  (with a partner / in queue)
--   under_review                              -> 'reviewing'
--   approved, offer_made, offer_accepted,
--     funded                                  -> 'offer'      (an offer exists / was taken)
--   declined, offer_declined                  -> 'declined'
--   withdrawn                                 -> 'withdrawn'
--
-- Offer fields are populated ONLY for offer-stage rows (bucket 'offer'); any field
-- whose underlying column is null stays null. partner_label is positional
-- ("Funding Partner A", "B", …) by created_at — never the real lender.
create or replace function public.get_my_deal_submissions(p_deal_id uuid)
returns table (
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
    -- Zero rows unless the deal belongs to a customer owned by the caller.
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
    'Funding Partner ' || chr(64 + pos::int)                     as partner_label,
    bucket                                                        as status_bucket,
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
