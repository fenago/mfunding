-- HotProspector — per-campaign disposition breakdown.
-- =============================================================================
-- WHAT: how each rep's dials on each campaign ended — "Hot Lead", "Not
-- Interested", "Callback", etc. — one row per
-- (day, campaign, member, disposition) with its count. This is the "who is
-- generating Hot Leads" layer under the /admin/dialer scorecard.
--
-- SOURCE: getDashboardMemberDatabyCampaign {campaign_id, date}, whose per-member
-- objects carry a `dispositionStatus` map. It is documented at
-- app.hotprospector.com/glu/CustomApi as requiring BOTH campaign_id and date.
--
-- ⚠️ UNVERIFIED SHAPE — READ BEFORE TRUSTING THIS TABLE. As of 2026-08-08 the
-- MFunding HotProspector account has ZERO campaigns (FetchAllCampaigns returns
-- "No campaign found"), so this endpoint could not be exercised against real
-- data. Probing it with invented campaign_ids returns an nginx 404 — byte-for-byte
-- the same 404 an unknown method name returns — while every OTHER documented
-- method (getMemberDashboardData, GetNumberHealthList, FetchCallTranscripts,
-- FetchAllTags, FetchAllGroups) returns 200 on this account. The likeliest
-- reading is that the route 404s on a campaign_id that does not exist, but
-- "endpoint unavailable on this account" cannot be ruled out until a real
-- campaign exists. The poller therefore treats a 404 as a recorded WARNING, not
-- a crash, and the dispositionStatus parser accepts both a {label: count} map and
-- a [{status, count}] array. First real campaign = re-verify the shape.
-- =============================================================================

create table if not exists public.hotprospector_disposition_daily (
  id             uuid primary key default gen_random_uuid(),
  stat_date      date not null,
  campaign_id    text not null,
  campaign_title text,
  member_id      text not null,
  agent_name     text,
  disposition    text not null,          -- e.g. 'Hot Lead', 'Not Interested'
  cnt            integer not null,       -- as reported; 0 is a real reported zero
  raw            jsonb not null default '{}'::jsonb,
  synced_at      timestamptz not null default now(),
  unique (stat_date, campaign_id, member_id, disposition)
);
create index if not exists hotprospector_disposition_daily_date_idx
  on public.hotprospector_disposition_daily (stat_date desc, campaign_id);
comment on table public.hotprospector_disposition_daily is
  'Per-campaign, per-rep disposition counts from HotProspector getDashboardMemberDatabyCampaign. Refreshed by hotprospector-sync, which deletes+reinserts a campaign-day it successfully pulled so a disposition that disappears cannot linger as a stale row. Shape unverified against live data — see the migration header.';

-- ── RLS — admin + super_admin read; writes service-role only ──────────────────
-- (Matches hotprospector_agent_daily / hotprospector_account_daily.)
alter table public.hotprospector_disposition_daily enable row level security;
drop policy if exists hotprospector_disposition_daily_admin_read
  on public.hotprospector_disposition_daily;
create policy hotprospector_disposition_daily_admin_read
  on public.hotprospector_disposition_daily
  for select to authenticated using (is_admin_or_super(auth.uid()));
