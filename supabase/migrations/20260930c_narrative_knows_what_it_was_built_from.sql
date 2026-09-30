-- A true sentence went stale and was sent to a funder as current fact
--
-- MF-2026-0418's submission to Cashable said the merchant had "no negative
-- days" and "approximately $150,000" in verified revenue. Both were TRUE when
-- written: ai_business_summary was generated 2026-09-25 01:12:45 from
-- underwriting v2, which reported $150,437 verified and zero negative days.
-- v4 ran seventeen minutes later, found $127,740 and 19 negative days, and
-- nothing regenerated the narrative. Four days later submit-to-funders pasted
-- it verbatim into an email to a funder who was about to parse the same
-- statements and reach v4's numbers.
--
-- Nobody overstated the file. The defect is that the narrative carried no link
-- to the analysis it came from, so nothing could tell it had been overtaken.
--
-- Two columns close that gap:
--   ai_business_summary_uw_version  the deal_underwriting.version the summary
--                                   was generated from (NULL = generated with
--                                   no underwriting run at all)
--   ai_business_summary_at          when it was generated, so an amount change
--                                   can invalidate it too
--
-- THE AMOUNT CASE IS THE SAME DEFECT WEARING DIFFERENT CLOTHES. The same email
-- asked for $100,000 in the subject (an override typed in the picker) while
-- the narrative argued $200,000. Editing the ask does not re-run underwriting,
-- so a version check alone would not catch it — hence the timestamp, compared
-- against the deal's own updated_at for the amount fields.
--
-- EXISTING ROWS ARE NULL AND STAY NULL. A summary we cannot date is exactly
-- the kind we know nothing about; treating NULL as "probably fine" is how the
-- Cashable email went out. NULL reads as stale and requires one regeneration.

alter table public.deals
  add column if not exists ai_business_summary_uw_version integer,
  add column if not exists ai_business_summary_at timestamptz;

comment on column public.deals.ai_business_summary_uw_version is
  'deal_underwriting.version that ai_business_summary was generated from. NULL means the '
  'summary predates this tracking or was generated with no underwriting run — treated as '
  'STALE, never as current. submit-to-funders refuses to paste a stale narrative.';

comment on column public.deals.ai_business_summary_at is
  'When ai_business_summary was generated. Lets an amount_requested change invalidate the '
  'narrative even when no new underwriting run happened — the MF-2026-0418 email asked for '
  '$100,000 in the subject while the narrative argued $200,000.';

-- ---------------------------------------------------------------------------
-- Is this deal's funder-facing narrative safe to send?
-- ---------------------------------------------------------------------------
-- One definition, so the edge function that blocks the paste and any UI that
-- warns about it can never disagree about what "stale" means.

create or replace function public.deal_narrative_staleness(p_deal_id uuid)
returns table(
  has_summary        boolean,
  is_stale           boolean,
  reason             text,
  summary_uw_version integer,
  latest_uw_version  integer
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with d as (
    select id, ai_business_summary, ai_business_summary_uw_version, ai_business_summary_at,
           amount_requested, updated_at
      from public.deals where id = p_deal_id
  ),
  uw as (
    select max(version) as v, max(created_at) as run_at
      from public.deal_underwriting where deal_id = p_deal_id
  )
  select
    coalesce(nullif(btrim(coalesce(d.ai_business_summary, '')), ''), null) is not null,
    case
      when coalesce(nullif(btrim(coalesce(d.ai_business_summary, '')), ''), null) is null then false
      when d.ai_business_summary_uw_version is null then true
      when uw.v is not null and uw.v > d.ai_business_summary_uw_version then true
      when uw.run_at is not null and d.ai_business_summary_at is not null
           and uw.run_at > d.ai_business_summary_at then true
      else false
    end,
    case
      when coalesce(nullif(btrim(coalesce(d.ai_business_summary, '')), ''), null) is null
        then 'no narrative on this deal'
      when d.ai_business_summary_uw_version is null
        then 'the narrative is not linked to any underwriting run, so we cannot tell what it was based on'
      when uw.v is not null and uw.v > d.ai_business_summary_uw_version
        then 'underwriting has run again (v' || uw.v || ') since the narrative was written (v'
             || d.ai_business_summary_uw_version || ')'
      when uw.run_at is not null and d.ai_business_summary_at is not null and uw.run_at > d.ai_business_summary_at
        then 'an underwriting run landed after the narrative was written'
      else 'current'
    end,
    d.ai_business_summary_uw_version,
    uw.v
  from d cross join uw;
$function$;

revoke all on function public.deal_narrative_staleness(uuid) from public, anon;
grant execute on function public.deal_narrative_staleness(uuid) to authenticated, service_role;

comment on function public.deal_narrative_staleness(uuid) is
  'Whether a deal''s ai_business_summary is safe to put in front of a funder. NULL version '
  'is STALE, not "probably fine". One definition shared by submit-to-funders and the UI.';
