-- funder_replies — the permanent, UNTRUNCATED record of what a funder actually wrote.
--
-- WHY: funder emails were mirrored into activity_log but the body was cut to a ~200
-- char snippet (rows capped out at 344 chars), so every decline REASON was thrown
-- away. The full text lived only in GHL, plus deal_submissions.response_data->>'raw'
-- on the handful of replies the poller matched to a submission. A funder "no" is the
-- single most valuable piece of box intel we get, and we were deleting it.
--
-- This table is scoped to FUNDER/LENDER emails only (lender_id is NOT NULL), so it
-- never bloats merchant/vendor rows. activity_log keeps its short preview for the UI;
-- the complete body lands here once, keyed for idempotency.
--
-- The parser (funder-decline-intel) fills the parsed_* / reason_categories columns,
-- and the rollup writes lenders.category.criteria.decline_history — a SEPARATE key
-- from the human-curated criteria.decline_signal, which is never touched by code.

create table if not exists public.funder_replies (
  id                 uuid primary key default gen_random_uuid(),
  lender_id          uuid not null references public.lenders(id) on delete cascade,
  deal_id            uuid references public.deals(id) on delete set null,
  deal_submission_id uuid references public.deal_submissions(id) on delete set null,

  -- Which capture path wrote the row: poll | webhook | vendor_sweep | backfill.
  source             text not null,
  -- GHL email-record id (the [emsg:<id>] marker) when the path had one.
  ghl_email_record_id text,
  -- Idempotency key. eid when we have one, else 'sub:<submission_id>' /
  -- '<lender_id>:<sha256(body)>'. One row per real email, forever.
  dedupe_key         text not null unique,

  direction          text not null default 'inbound',
  subject            text,
  from_email         text,
  received_at        timestamptz,
  -- THE POINT OF THE TABLE: the complete, untruncated email text.
  full_body          text not null,

  -- ── parser output (funder-decline-intel) ──
  parsed_at          timestamptz,
  parse_method       text,                       -- llm | heuristic
  parse_model        text,
  parse_confidence   text,                       -- high | medium | low
  is_decline         boolean,
  reason_categories  text[] not null default '{}',
  verbatim_quote     text,
  parsed             jsonb,

  created_at         timestamptz not null default now()
);

comment on table public.funder_replies is
  'Untruncated funder/lender email bodies + the structured decline parse. Feeds lenders.category.criteria.decline_history (auto); never writes criteria.decline_signal (human-curated).';
comment on column public.funder_replies.full_body is
  'Complete email text as received. activity_log keeps only a ~200-char preview; this is the permanent copy.';
comment on column public.funder_replies.reason_categories is
  'Subset of: too_many_positions, industry_restricted, tib_too_short, low_revenue, low_fico, negative_days_or_nsf, open_collections, open_lien_or_judgment, prior_default, state_restricted, deposit_quality, other.';

create index if not exists funder_replies_lender_idx on public.funder_replies (lender_id, received_at desc);
create index if not exists funder_replies_deal_idx   on public.funder_replies (deal_id);
-- The parse queue: rows the classifier has not looked at yet.
create index if not exists funder_replies_unparsed_idx on public.funder_replies (created_at) where parsed_at is null;
create index if not exists funder_replies_decline_idx on public.funder_replies (lender_id) where is_decline;

alter table public.funder_replies enable row level security;

drop policy if exists "Ops staff manage funder_replies" on public.funder_replies;
create policy "Ops staff manage funder_replies" on public.funder_replies
  for all using (public.is_ops_staff(auth.uid())) with check (public.is_ops_staff(auth.uid()));

-- ── One-time recovery marker on the existing mirror ledger ───────────────────
-- 78 inbound funder emails were already mirrored (and truncated) before this table
-- existed. Their full bodies are still in GHL and recoverable by re-fetching the
-- email record. funder-decline-intel's `recover` phase walks these rows; this column
-- is how it remembers which ones it has already looked at, so it never re-spends GHL
-- API calls on the same message.
alter table public.ghl_conversation_log
  add column if not exists funder_body_recovered_at timestamptz;

comment on column public.ghl_conversation_log.funder_body_recovered_at is
  'Stamped by funder-decline-intel once this message has been considered for full-body recovery into funder_replies (stamped whether or not a body was found).';

create index if not exists ghl_conversation_log_recover_idx
  on public.ghl_conversation_log (message_at desc)
  where funder_body_recovered_at is null and entity_type = 'lender'
    and channel = 'email' and direction = 'inbound';

-- ── Aggregation the rollup reads (one round trip, no row egress) ──────────────
-- Per lender + reason_category: how many parsed declines cite it, when it was last
-- seen, and the most recent verbatim quote. Only PARSED DECLINES count.
create or replace function public.funder_decline_rollup()
returns table (
  lender_id       uuid,
  reason_category text,
  cnt             bigint,
  last_seen       timestamptz,
  last_quote      text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.lender_id,
    c.reason_category,
    count(*)                                              as cnt,
    max(coalesce(r.received_at, r.created_at))            as last_seen,
    (array_agg(coalesce(nullif(r.verbatim_quote, ''), left(r.full_body, 300))
       order by coalesce(r.received_at, r.created_at) desc))[1] as last_quote
  from public.funder_replies r
  cross join lateral unnest(
    case when cardinality(r.reason_categories) = 0 then array['other'] else r.reason_categories end
  ) as c(reason_category)
  where r.is_decline is true and r.parsed_at is not null
  group by r.lender_id, c.reason_category
$$;

revoke all on function public.funder_decline_rollup() from public, anon, authenticated;

comment on function public.funder_decline_rollup() is
  'Per-funder decline reason tallies for the criteria.decline_history rollup. Service-role only (funder-decline-intel).';

-- ── Schedule ─────────────────────────────────────────────────────────────────
-- Hourly at :25 (off the :00/:15/:30/:45 crowd). Capture is inline on the reply
-- paths; this drains the parse queue and refreshes the rollup. Same vault-secret
-- invocation pattern as vendor-conversation-sweep-15min.
select cron.unschedule('funder-decline-intel-hourly')
where exists (select 1 from cron.job where jobname = 'funder-decline-intel-hourly');

select cron.schedule(
  'funder-decline-intel-hourly',
  '25 * * * *',
  $cron$
  select net.http_post(
    url := 'https://ehibjeonqpqskhcvizow.supabase.co/functions/v1/funder-decline-intel?secret='
           || (select decrypted_secret from vault.decrypted_secrets where name = 'GHL_WEBHOOK_SECRET'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_ANON_KEY')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $cron$
);
