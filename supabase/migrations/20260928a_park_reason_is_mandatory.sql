-- A deal does not get parked without saying why
--
-- deals.lost_reason was NULL on all 274 nurture deals. That was never a
-- discipline problem: of the eleven code paths that can park a deal, NINE do
-- not accept a reason at all. updateDealStatus(id, status) has no reason
-- parameter, so the six client call sites could not have recorded one if the
-- person wanted to. processor_move_to_nurture DOES take p_reason — and writes
-- it to activity_log.content, not to deals.lost_reason, which is the column
-- analyticsService and campaignAuditService actually read. Two of its three
-- callers pass nothing at all. 132 parks through that RPC, zero reasons.
--
-- WHAT THE REAL PARKS LOOK LIKE (136 processor parks, by last WAVV disposition
-- before the park, and by the rung they were parked from):
--
--   ~88  never reached        Voice Message 34 · No Answer 30 · None 11 ·
--                             blocked 4 · no call 9            → no_contact
--    35  said no                                                → merchant_declined
--    29  parked from application_sent — went dark after the app → docs_not_provided
--
-- The existing thirteen values cover ~95% of real parks. Two are added, and
-- only two, because a picker where everything lands on 'other' is the same
-- emptiness with more clicks:
--
--   business_closed  Express Redemption was parked because the business is
--                    closing. Nothing in the list said that; it would have
--                    become 'other' and the fact would be gone.
--   bogus_lead       deals.closed_reason already carries 'bogus_never_requested'
--                    13 times — the merchant denies ever asking for funding
--                    info. Campaign Audit counts it per campaign to prove a
--                    lead vendor is selling garbage. That signal must survive
--                    into the coded column, not die in a parallel vocabulary.
--
-- ON THE PARALLEL VOCABULARY. deals.closed_reason (9 values, 57 rows, set by
-- the Playbooks close dialog) and deals.lost_reason (13 values) are two lists
-- for one question. This migration does not merge them — that is a bigger call
-- than tonight — but the client now maps closed_reason onto lost_reason at the
-- one place the close dialog writes, so the coded column is populated without
-- asking anyone to answer the same question twice.

-- ---------------------------------------------------------------------------
-- 1. Two more reasons, for cases that genuinely have no home
-- ---------------------------------------------------------------------------
alter table public.deals drop constraint if exists deals_lost_reason_check;
alter table public.deals add constraint deals_lost_reason_check check (
  lost_reason is null or lost_reason = any (array[
    'no_contact', 'disqualified', 'docs_not_provided', 'bank_data_fail',
    'funders_declined_all', 'merchant_declined', 'offer_expired',
    'funding_fell_through', 'routed_to_vcf', 'duplicate', 'opted_out',
    'prohibited_industry', 'business_closed', 'bogus_lead', 'other'
  ])
);

comment on column public.deals.lost_reason is
  'Why a deal was parked or closed. Required on every park from 2026-09-28. NOT an '
  'enum — text with a CHECK constraint; a migration written against pg_enum will find '
  'nothing. Fifteen allowed values; see deals_lost_reason_check.';

-- ---------------------------------------------------------------------------
-- 2. processor_move_to_nurture writes the column, and demands the reason
-- ---------------------------------------------------------------------------
-- Was (p_deal_id, p_reason text default null) and wrote p_reason only into the
-- activity note. Now the CODE is required and lands in deals.lost_reason, with
-- the operator's free text kept alongside it as p_note — the code is what gets
-- counted, the text is what gets read by the next human.
--
-- Dropped and recreated rather than replaced: the old two-argument form would
-- otherwise stay resolvable and let a caller keep parking without a reason.
-- Body captured from pg_get_functiondef, not from migration text.

drop function if exists public.processor_move_to_nurture(uuid, text);

create or replace function public.processor_move_to_nurture(
  p_deal_id uuid,
  p_reason  text,
  p_note    text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_old text;
begin
  if v_uid is null or not (public.is_processor(v_uid) or public.is_ops_staff(v_uid)) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  -- No silent park. The column exists to answer "why is this deal here", and a
  -- null answer is how 274 deals ended up unexplainable.
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A park needs a reason' using errcode = 'P0001';
  end if;

  select status into v_old from public.deals where id = p_deal_id;
  if v_old is null then raise exception 'Deal not found' using errcode = 'P0002'; end if;

  update public.deals
     set previous_status = status,
         status          = 'nurture',
         lost_reason     = p_reason,          -- the CHECK rejects anything invalid
         nurture_at      = coalesce(nurture_at, now()),
         updated_at      = now()
   where id = p_deal_id;

  insert into public.activity_log(entity_type, entity_id, interaction_type, subject, content,
                                  old_status, new_status, logged_by)
  values ('deal', p_deal_id, 'note', 'Moved to long-term nurture — processor',
          concat_ws(' — ', p_reason, nullif(btrim(coalesce(p_note, '')), '')),
          v_old, 'nurture', v_uid);

  return jsonb_build_object('ok', true, 'lost_reason', p_reason);
end;
$function$;

revoke all on function public.processor_move_to_nurture(uuid, text, text) from public, anon;
grant execute on function public.processor_move_to_nurture(uuid, text, text) to authenticated, service_role;

comment on function public.processor_move_to_nurture(uuid, text, text) is
  'Parks a deal in long-term nurture. The reason CODE is mandatory and is written to '
  'deals.lost_reason (the column the analytics read), with optional free text kept '
  'beside it in the activity note. Refuses to park without one.';

-- ---------------------------------------------------------------------------
-- 3. NOT back-filled, on purpose
-- ---------------------------------------------------------------------------
-- The 274 existing nurture deals carry no recorded reason anywhere — not in
-- lost_reason, not in the activity note, not in closed_reason. Anything written
-- for them now would be invention, and an invented reason is worse than a null
-- because it cannot be told apart from a real one. They stay NULL. The
-- constraint that makes a reason mandatory is enforced in the write paths, not
-- as a table-level CHECK on status, precisely so these rows remain legal and
-- visibly unexplained.
