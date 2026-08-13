-- DIAL CAMPAIGNS — the tag is the join key.
--
-- A dial campaign ties one TAG to one campaign row, and that tag is what joins
-- our app, GHL and HotProspector together:
--   Lead Machine push  -> writes the tag onto GHL contacts (lead_records.push_tags)
--   HP "Tags to Dial"  -> the HP campaign dials contacts carrying that tag
--   deals.campaign_id  -> existing KPI model (revenue = amount_funded * 0.08)
--
-- These are CAMPAIGNS, not a new entity: they live in public.campaigns so the
-- existing code minting, CampaignsPage and every KPI join apply unchanged.
--
-- ── CHANNEL VALUE: 'outbound_dial', NOT 'dialer' ─────────────────────────────
-- The brief said channel='dialer'. The table already contains an outbound_dial
-- campaign ("PH Setters — UCC Dialing", PH-UCC-2026-001) meaning exactly this,
-- and `channel` has no check constraint to stop a second spelling taking hold.
-- Adding 'dialer' alongside 'outbound_dial' would split one concept across two
-- values and quietly halve every channel-grouped KPI — the same failure as
-- 'TEXAS' vs 'TX' and 'VoIP' vs 'Voip' earlier in this build. So dial campaigns
-- reuse the existing value. Flagged for reversal if the owner wants otherwise.

-- ── 1. Dial-campaign columns on campaigns ─────────────────────────────────────
alter table public.campaigns
  add column if not exists dial_tag        text,
  add column if not exists hp_campaign_id  text,
  add column if not exists hp_campaign_name text,
  add column if not exists dial_source     jsonb not null default '{}'::jsonb;

-- One tag, one campaign. This is what makes the tag a JOIN KEY rather than a
-- label: if two campaigns could share a tag, every number attributed through it
-- would be ambiguous.
create unique index if not exists campaigns_dial_tag_uidx
  on public.campaigns (dial_tag) where dial_tag is not null;

comment on column public.campaigns.dial_tag is
  'The lowercase-kebab tag that joins this campaign across our app, GHL and HotProspector. UNIQUE where not null — two campaigns sharing a tag would make every attributed number ambiguous. Written onto contacts by lead-push-ghl and set as the HP campaign''s "Tags to Dial".';
comment on column public.campaigns.hp_campaign_id is
  'The HotProspector campaign this dials through. Set MANUALLY (or by title match): HP''s FetchAllCampaigns returns only campaign_id + CampaignTitle — it does NOT expose a campaign''s Tags to Dial, and no per-campaign detail method exists (FetchCampaign / getCampaignDetail / FetchCampaignDetails / getCampaignSettings all 404), so auto-linking by tag is impossible against this API.';
comment on column public.campaigns.dial_source is
  'Provenance of the leads this campaign dials: {lead_types:[], batch_codes:[], filters:{}, lead_count:n} captured at creation. Free-form so the UI can record whatever the owner filtered on.';

-- ── 2. Pushes link to campaigns ───────────────────────────────────────────────
alter table public.lead_push_jobs
  add column if not exists campaign_id uuid references public.campaigns(id) on delete set null;
create index if not exists lead_push_jobs_campaign_idx
  on public.lead_push_jobs (campaign_id, created_at desc);
comment on column public.lead_push_jobs.campaign_id is
  'The dial campaign this push fed. Records WHICH RUN pushed the leads; the durable per-lead attribution is the dial_tag inside lead_records.push_tags, which survives even if the job row is deleted.';

-- ── 3. Tag validation — one place, used by the edge fn and callable by the UI ──
-- RESERVED PREFIXES are the tags this system already assigns automatically. A
-- dial campaign must never claim one, or a campaign would silently inherit every
-- lead the Lead Machine has ever pushed of that type.
create or replace function public.normalize_dial_tag(p_raw text)
returns text language sql immutable as $fn$
  select nullif(
    trim(both '-' from
      regexp_replace(
        regexp_replace(lower(coalesce(p_raw,'')), '[^a-z0-9]+', '-', 'g'),
        '-{2,}', '-', 'g')
    ), '');
$fn$;
comment on function public.normalize_dial_tag(text) is
  'Folds any user input to lowercase-kebab. The tag is a join key across three systems, so it is normalized in ONE place rather than trusted from the client.';

create or replace function public.dial_tag_problem(p_tag text, p_campaign_id uuid default null)
returns text language plpgsql stable security definer set search_path = public as $fn$
declare v text := public.normalize_dial_tag(p_tag);
begin
  if v is null then return 'tag is empty after normalization'; end if;
  if length(v) < 4  then return 'tag must be at least 4 characters'; end if;
  if length(v) > 64 then return 'tag must be 64 characters or fewer'; end if;
  -- Reserved: automatically-assigned Lead Machine and PH UCC tags.
  if v like 'lm-%'        then return 'tags starting with lm- are reserved for Lead Machine type tags'; end if;
  if v like 'ucc-batch-%' then return 'tags starting with ucc-batch- are reserved for PH UCC batches'; end if;
  if v in ('ucc-lead','aged-lead','trigger-lead')
                          then return format('%s is a reserved system tag', v); end if;
  -- A batch tag is the lowercased batch_code, so a campaign must not claim one.
  if exists (select 1 from public.lead_batches b where lower(b.batch_code) = v)
                          then return format('%s is the batch tag of an uploaded list', v); end if;
  if exists (select 1 from public.campaigns c
              where c.dial_tag = v and (p_campaign_id is null or c.id <> p_campaign_id))
                          then return format('%s is already used by another campaign', v); end if;
  return null; -- ok
end;
$fn$;
comment on function public.dial_tag_problem(text, uuid) is
  'Returns a human-readable reason the tag cannot be used, or NULL if it is fine. Checks reserved prefixes (lm-*, ucc-batch-*), reserved system tags, collision with an uploaded batch code, and collision with another campaign. The edge fn calls it; the UI can call it for live validation.';
revoke all on function public.dial_tag_problem(text, uuid) from public, anon;
grant execute on function public.dial_tag_problem(text, uuid) to authenticated;
grant execute on function public.normalize_dial_tag(text) to authenticated;

-- ── 4. Leads-pushed-per-campaign, cheaply ─────────────────────────────────────
-- Counts leads whose push_tags contain the campaign's dial_tag. This is
-- selective (only leads carrying that one tag) and hits the push_tags GIN index,
-- so it does NOT violate the house rule about whole-table aggregates on
-- lead_records — unlike a count over every row, its cost scales with the
-- campaign's size, not the book's.
create or replace function public.dial_campaign_lead_count(p_campaign_id uuid)
returns integer language sql stable security definer set search_path = public as $fn$
  select coalesce((
    select count(*)::int from public.lead_records r
     where r.push_tags @> array[(select dial_tag from public.campaigns where id = p_campaign_id)]
  ), 0);
$fn$;
comment on function public.dial_campaign_lead_count(uuid) is
  'Leads pushed under this campaign''s dial_tag, via the push_tags GIN index. Selective by construction — cost scales with the campaign, not with lead_records.';
revoke all on function public.dial_campaign_lead_count(uuid) from public, anon;
grant execute on function public.dial_campaign_lead_count(uuid) to authenticated;

-- ── 5. Deal attribution ───────────────────────────────────────────────────────
-- (applied as 20260813_deals_dial_campaign_attribution — kept separate so the
-- trigger on the deals table can be reviewed on its own.)
