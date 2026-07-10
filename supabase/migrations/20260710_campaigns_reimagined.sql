-- Campaigns, reimagined around lead PARTNERS + CHANNELS with per-campaign KPIs,
-- channel-driven setup checklists, and stored AI analyses.
--
-- Non-destructive: every existing column stays. `budget`/`spent` keep their
-- meaning (planned budget / actual spend) — we only add what was missing.
--
-- What this adds:
--   campaigns.code                      unique human code (e.g. SYN-RT-2026-001)
--   campaigns.partner                   lead partner (default 'Synergy Direct')
--   campaigns.cost_per_lead_contracted  vendor's quoted CPL (for expectation math)
--   campaigns.setup_checklist           jsonb array of channel-specific reminders
--   trigger set_campaign_code           auto-mints `code` on insert when absent
--   table campaign_analyses             history of AI "analyze campaign" runs
--   seed row                            today's Synergy real-time-transfer campaign

begin;

-- ── 1. New columns ──────────────────────────────────────────────────────────
alter table public.campaigns
  add column if not exists code text,
  add column if not exists partner text not null default 'Synergy Direct',
  add column if not exists cost_per_lead_contracted numeric,
  add column if not exists setup_checklist jsonb not null default '[]'::jsonb;

comment on column public.campaigns.budget is 'Planned budget for the campaign (planned spend).';
comment on column public.campaigns.spent is 'Actual spend to date.';
comment on column public.campaigns.cost_per_lead_contracted is 'Vendor-quoted / contracted cost per lead, used for expectation math.';
comment on column public.campaigns.setup_checklist is 'Channel-specific setup reminders: [{key,label,done,done_at,done_by,note,value,needs_value}].';
comment on column public.campaigns.code is 'Unique human code: PARTNER-CHANNEL-YEAR-SEQ, e.g. SYN-RT-2026-001. Auto-minted on insert.';

-- ── 2. Code-generation helpers ──────────────────────────────────────────────
-- Partner → 3-letter abbreviation (first three alphanumerics, uppercased).
create or replace function public.campaign_partner_abbr(p text)
returns text language sql immutable as $$
  select coalesce(
    upper(substr(regexp_replace(coalesce(nullif(trim(p), ''), 'GEN'), '[^A-Za-z0-9]', '', 'g'), 1, 3)),
    'GEN'
  );
$$;

-- Channel → short code. Falls back to the first 3 letters for unknown channels.
create or replace function public.campaign_channel_abbr(ch text)
returns text language sql immutable as $$
  select case ch
    when 'live_transfer'     then 'LT'
    when 'realtime_transfer' then 'RT'
    when 'real_time'         then 'RT'
    when 'ucc'               then 'UCC'
    when 'aged'              then 'AGE'
    when 'aged_leads'        then 'AGE'
    when 'aged_transfer'     then 'AGE'
    when 'email'             then 'EM'
    when 'cold_email'        then 'EM'
    when 'web_purchased'     then 'WEB'
    when 'google_ads'        then 'GAD'
    when 'referral'          then 'REF'
    when 'seo'               then 'SEO'
    when 'social'            then 'SOC'
    when 'trigger'           then 'TRG'
    else upper(substr(regexp_replace(coalesce(nullif(trim(ch), ''), 'GEN'), '[^A-Za-z0-9]', '', 'g'), 1, 3))
  end;
$$;

-- Build the code for a (partner, channel, year), finding the next sequence for
-- that exact prefix. Serialized against concurrent inserts via an advisory lock
-- keyed on the prefix so two campaigns never claim the same sequence.
create or replace function public.next_campaign_code(p text, ch text, yr int)
returns text language plpgsql as $$
declare
  prefix text := public.campaign_partner_abbr(p) || '-' || public.campaign_channel_abbr(ch) || '-' || yr::text;
  seq int;
begin
  perform pg_advisory_xact_lock(hashtext('campaign_code:' || prefix));
  select coalesce(max((regexp_replace(code, '^.*-(\d+)$', '\1'))::int), 0) + 1
    into seq
    from public.campaigns
    where code like prefix || '-%';
  return prefix || '-' || lpad(seq::text, 3, '0');
end;
$$;

-- BEFORE INSERT: mint a code when one wasn't supplied. Year comes from
-- start_date when set, else the insert time.
create or replace function public.set_campaign_code()
returns trigger language plpgsql as $$
begin
  if new.code is null or trim(new.code) = '' then
    new.code := public.next_campaign_code(
      new.partner,
      new.channel,
      extract(year from coalesce(new.start_date, current_date))::int
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_campaign_code on public.campaigns;
create trigger trg_set_campaign_code
  before insert on public.campaigns
  for each row execute function public.set_campaign_code();

-- Unique once populated (partial index skips any legacy NULLs during backfill).
create unique index if not exists campaigns_code_key
  on public.campaigns (code) where code is not null;

-- ── 3. Backfill codes for existing rows ─────────────────────────────────────
-- Assign per-prefix sequence numbers in creation order so early campaigns get
-- the lower numbers. partner already defaulted to 'Synergy Direct' above.
with ranked as (
  select
    id,
    public.campaign_partner_abbr(partner) || '-'
      || public.campaign_channel_abbr(channel) || '-'
      || extract(year from coalesce(start_date, created_at))::int as prefix,
    row_number() over (
      partition by
        public.campaign_partner_abbr(partner),
        public.campaign_channel_abbr(channel),
        extract(year from coalesce(start_date, created_at))::int
      order by created_at, id
    ) as seq
  from public.campaigns
  where code is null
)
update public.campaigns c
set code = r.prefix || '-' || lpad(r.seq::text, 3, '0')
from ranked r
where c.id = r.id;

-- ── 4. AI analysis history ──────────────────────────────────────────────────
create table if not exists public.campaign_analyses (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  verdict text,                       -- scale | keep | fix | kill
  summary text,
  analysis jsonb not null default '{}'::jsonb,  -- full structured result
  kpis_snapshot jsonb not null default '{}'::jsonb, -- KPIs at analysis time
  model text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists campaign_analyses_campaign_id_idx
  on public.campaign_analyses (campaign_id, created_at desc);

alter table public.campaign_analyses enable row level security;

drop policy if exists "Staff can view campaign analyses" on public.campaign_analyses;
create policy "Staff can view campaign analyses"
  on public.campaign_analyses for select
  using (public.is_staff(auth.uid()));

drop policy if exists "Super admins can manage campaign analyses" on public.campaign_analyses;
create policy "Super admins can manage campaign analyses"
  on public.campaign_analyses for all
  using (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.role = 'super_admin'));

-- ── 5. Seed today's real-time-transfer campaign ─────────────────────────────
-- Synergy starts EMAILING leads the moment they come in, today. New channel.
insert into public.campaigns (name, channel, partner, status, budget, spent, market, start_date, notes, setup_checklist)
select
  'Synergy — Real-Time Transfers (emailed leads)',
  'realtime_transfer',
  'Synergy Direct',
  'active',
  0,
  0,
  null,
  current_date,
  'Vendor emails each lead the instant it comes in. Closers must attribute intake to this campaign and call within 5 minutes.',
  '[
    {"key":"inbound_email","label":"Create a dedicated inbound email/alias for this campaign + record it here","done":false,"done_at":null,"done_by":null,"note":"","value":null,"needs_value":true},
    {"key":"intake_procedure","label":"Define the intake procedure (who enters the emailed lead + speed-to-call SLA < 5 min)","done":false,"done_at":null,"done_by":null,"note":"","value":null,"needs_value":false},
    {"key":"send_format","label":"Confirm vendor send format + get a test lead through","done":false,"done_at":null,"done_by":null,"note":"","value":null,"needs_value":false},
    {"key":"attribution_default","label":"Set campaign attribution default (closers pick this campaign at intake)","done":false,"done_at":null,"done_by":null,"note":"","value":null,"needs_value":false}
  ]'::jsonb
where not exists (
  select 1 from public.campaigns where channel = 'realtime_transfer' and partner = 'Synergy Direct'
);

commit;
