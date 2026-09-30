-- ════════════════════════════════════════════════════════════════════════════
-- PROCESSOR NOTIFICATIONS — "something changed on a merchant's file"
-- ════════════════════════════════════════════════════════════════════════════
--
-- WHY (owner, 2026-09-30): "whenever there is anything that changes or updates
-- in the merchants file, can we get a pop-up to show for anybody that has the
-- processor role? Bankers LLC sent in a change, and our processor just
-- completely missed it."
--
-- THE MISS, EXACTLY. Bankers LLC / MF-2026-0425, that morning:
--
--   16:44  merchant:email  application sent, addressed to "Air Science Systems Corporation"
--   16:53  merchant:signed MCA — Broker Compensation Disclosure
--   16:54  merchant:reply  "William Banker is correcting his contact information —
--                           corporate name is Hair Science Systems Corporation,
--                           email is wrbanker@gmail.com, phone is 513-260-8110"
--   16:55  merchant:signed MCA — Broker Compensation Disclosure   ← the SAME doc, 84s later
--   17:08  merchant:reply  "Bill says he has completed the application and wants
--                           to know the next steps to receive funding"
--
-- A merchant corrected his corporate name, email and phone. Nobody saw it. The
-- deal is still called "Bankers LLC".
--
-- ⚠️ AND THE DATA WAS FINE. `deals.merchant_reply_at` was stamped 17:07 and
-- `merchant_reply_summary` held the correct summary. The write path worked
-- perfectly. What did not exist was a surface that put it in front of a human.
-- This migration is that surface's spine; it adds no new extraction and fixes
-- no parser, because nothing was broken there.
--
-- ── WHAT FIRES, AND WHY EVERYTHING ELSE DOES NOT ────────────────────────────
-- Measured over the 45 days to 2026-09-30, against `activity_log` on deals:
--
--   IN  (~1.7 events/day total — a number worth looking at)
--     merchant:reply       14   the miss itself
--     merchant:signed      26   a document came back
--     ghl:funder-reply     25   a funder answered (INBOUND — see below)
--     customer_documents  157   a document landed on the file (ROLLED UP — see below)
--     deal_submissions    ~16   an offer or a decline
--
--   OUT, and the exclusions ARE the feature:
--     ghl:OpportunityStageUpdate  716  the GHL mirror. On its own it would be
--                                      ~90% of this feed. A badge that lights up
--                                      for the mirror is unlearned in a week, and
--                                      then it hides the NEXT Bankers.
--     Logged call: / GHL call:  ~1000  our own dialling
--     ghl_opportunity_synced      276  mirror bookkeeping
--     lead:auto-assigned          225  routing, not a merchant action
--     Moved to long-term nurture  143  a cron job
--     Stated call window expired   73  a cron job
--     stage:* corrections         ~115 a cron job
--     realtime:/live-transfer:intake   147  NEW LEADS — the corner-alert stream
--                                      (useNewLeadAlert) already owns these, and
--                                      firing both would double-notify.
--     deals.updated_at                 NEVER. The nightly scorer rewrites every
--                                      row, so it is not a freshness signal at
--                                      all (see the pipeline-position-truth rule).
--
--   OUT BECAUSE IT IS US, NOT THEM — the trap, and it is only visible in the
--   CONTENT, never in the name:
--     merchant:email    85   the app logging that WE sent something
--     funder:email      23   "This is Kristine with MFunding" — outbound
--     application:pushed-to-ghl  77  our own action
--
--   OUT BECAUSE IT IS THE SAME EVENT TWICE:
--     deal_doc_requests          132  a fulfilled request carries `document_id`,
--                                     pointing at the customer_documents row we
--                                     already fire on.
--     "📎 N document(s) scraped"   22  the email-doc sweep writes BOTH that note
--                                     and the customer_documents rows. We keep
--                                     customer_documents because it is the only
--                                     source covering every arrival path — the
--                                     sweep, the merchant portal, and a
--                                     processor's own drag-drop. The 📎 note only
--                                     ever covers email.
--
-- ── TWO KINDS OF DUPLICATE, ONE DEDUPE KEY ──────────────────────────────────
-- Both were measured on live rows, not imagined:
--
--   THE REPEAT: Bankers produced two `merchant:signed` rows for the SAME
--   document 84 seconds apart. So a signature's identity is deal + document
--   NAME, never the activity_log row id.
--
--   THE BURST: one merchant (MF-2026-0418) produced ELEVEN customer_documents
--   rows in 35 seconds — eleven bank statements. Eleven cards is eleven reasons
--   to stop reading the badge. Documents roll up per deal per 10-minute bucket,
--   with a count that increments in place: "12 documents arrived."
--
-- ── SCOPE: THE SAME RULE processor_pipeline_rows ALREADY USES ───────────────
-- That RPC gates on `is_processor(uid) OR is_ops_staff(uid)` and then applies NO
-- owner filter — every deal in an open stage, whoever it is assigned to. The
-- Bankers deal was auto-assigned to Kristine and still has to reach whoever is
-- processing. So this uses the same gate and the same stage array, deliberately,
-- rather than inventing a third scoping rule. A useful property falls out for
-- free: when a deal leaves the open stages, it stops generating alerts by itself.
--
-- ── READ STATE IS PER USER ──────────────────────────────────────────────────
-- `processor_notification_reads` is keyed (notification, profile). Two
-- processors must not clear each other's badge.
--
-- ── UNREADABLE IS NEVER ZERO ────────────────────────────────────────────────
-- The count RPC raises on a failed authorisation rather than returning 0, and
-- the client renders a failed read as an amber "?". A badge quietly dropping to
-- zero is how the next change goes unseen a second time.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. The stage scope, stated once ─────────────────────────────────────────
-- The union of the MCA and VCF arrays inside processor_pipeline_rows. Kept as a
-- function so the trigger, the feed and the count can never drift apart.
create or replace function public.processor_notifiable_stages()
returns text[]
language sql
immutable
as $$
  select array[
    -- MCA
    'new','contacted','qualifying','application_sent','docs_collected',
    'bank_statements','submitted_to_funder','offer_received','offer_presented',
    'offer_accepted','funded','renewal_eligible','nurture',
    -- VCF
    'new_distressed','hardship_consult','positions_analysis','strategy_proposal',
    'agreement_sent','submitted_to_vcf','restructure_executed','servicing'
  ]::text[];
$$;

comment on function public.processor_notifiable_stages() is
  'The open-stage set a processor is alerted about — the union of the MCA and VCF '
  'arrays in processor_pipeline_rows(). One definition so the trigger, the feed '
  'and the badge count can never disagree.';

-- ── 2. Tables ───────────────────────────────────────────────────────────────

create table if not exists public.processor_notifications (
  id            uuid primary key default gen_random_uuid(),
  -- The identity of the EVENT, not of the row that reported it. See the two
  -- duplicate shapes documented at the top of this file.
  dedupe_key    text        not null unique,
  kind          text        not null
                  check (kind in ('merchant_reply','merchant_signed','documents',
                                  'funder_reply','funder_offer','funder_decline')),
  deal_id       uuid        not null references public.deals(id) on delete cascade,
  customer_id   uuid        references public.customers(id) on delete set null,
  title         text        not null,
  detail        text,
  -- How many underlying events this one card stands for. >1 only for a rolled-up
  -- document burst; the card reads "12 documents arrived", not twelve cards.
  event_count   int         not null default 1,
  -- When the merchant/funder actually did it. NOT when we noticed.
  event_at      timestamptz not null,
  source_table  text        not null,
  source_id     uuid,
  -- Who caused it, when we know. Their own action is auto-marked read: a
  -- processor does not need telling about her own drag-drop.
  actor_id      uuid        references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists processor_notifications_event_at_idx
  on public.processor_notifications (event_at desc);
create index if not exists processor_notifications_deal_idx
  on public.processor_notifications (deal_id);

comment on table public.processor_notifications is
  'One row per DEDUPLICATED change on a merchant file that a processor must see. '
  'Written only by the triggers in this migration; see the header for the full '
  'in/out list and the volumes it was chosen from.';

create table if not exists public.processor_notification_reads (
  notification_id uuid        not null references public.processor_notifications(id) on delete cascade,
  profile_id      uuid        not null references public.profiles(id) on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (notification_id, profile_id)
);

comment on table public.processor_notification_reads is
  'Per-user read state. Keyed on (notification, profile) on purpose: two '
  'processors must not clear each other''s badge.';

-- ── 3. The one write path ───────────────────────────────────────────────────

create or replace function public.raise_processor_notification(
  p_dedupe_key   text,
  p_kind         text,
  p_deal_id      uuid,
  p_customer_id  uuid,
  p_title        text,
  p_detail       text,
  p_event_at     timestamptz,
  p_source_table text,
  p_source_id    uuid,
  p_actor_id     uuid
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
begin
  if p_deal_id is null or p_dedupe_key is null then
    return null;
  end if;

  -- SCOPE GATE. A closed/lost deal is not work, and alerting on it is how a
  -- feed fills with things nobody will action. Same stage set as the board.
  if not exists (
    select 1 from public.deals d
     where d.id = p_deal_id
       and d.status = any (public.processor_notifiable_stages())
  ) then
    return null;
  end if;

  insert into public.processor_notifications as n (
    dedupe_key, kind, deal_id, customer_id, title, detail,
    event_at, source_table, source_id, actor_id
  ) values (
    p_dedupe_key, p_kind, p_deal_id, p_customer_id, p_title, left(p_detail, 400),
    coalesce(p_event_at, now()), p_source_table, p_source_id, p_actor_id
  )
  on conflict (dedupe_key) do update
    -- A ROLL-UP, NOT A NEW EVENT. Bumping the count leaves an already-read card
    -- read, which is correct: inside one 10-minute bucket this IS the same
    -- arrival. A genuinely new burst lands in a new bucket and a new key.
    set event_count = n.event_count + 1,
        event_at    = greatest(n.event_at, coalesce(excluded.event_at, n.event_at)),
        detail      = coalesce(excluded.detail, n.detail)
  returning n.id into v_id;

  -- The actor has already seen their own action.
  if v_id is not null and p_actor_id is not null then
    insert into public.processor_notification_reads (notification_id, profile_id)
    values (v_id, p_actor_id)
    on conflict do nothing;
  end if;

  return v_id;
end;
$$;

-- ── 4. activity_log → merchant reply / signature / funder reply ─────────────

create or replace function public.tg_processor_notify_activity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_customer uuid;
  v_biz      text;
  v_detail   text;
  v_doc      text;
  v_funder   text;
begin
  if new.entity_type is distinct from 'deal' or new.entity_id is null then
    return null;
  end if;

  -- Only the three subjects that mean a MERCHANT or a FUNDER acted. Everything
  -- else on this table is the mirror, a cron job, or our own outbound — see the
  -- header for the counts behind each exclusion.
  if not (new.subject = 'merchant:reply'
          or new.subject like 'merchant:signed%'
          or new.subject like 'ghl:funder-reply%') then
    return null;
  end if;

  select d.customer_id, c.business_name
    into v_customer, v_biz
    from public.deals d
    left join public.customers c on c.id = d.customer_id
   where d.id = new.entity_id;

  if new.subject = 'merchant:reply' then
    -- content reads: [re: merchant] <summary>: "<raw body>" [emsg:...]
    -- Keep the summary; the raw body belongs on the deal, not on a card.
    v_detail := btrim(regexp_replace(coalesce(new.content, ''), '^\s*\[[^\]]*\]\s*', ''));
    v_detail := split_part(v_detail, ': "', 1);
    if v_detail = '' then
      v_detail := 'The merchant replied — open the deal to read it.';
    end if;
    perform public.raise_processor_notification(
      'reply:' || new.id::text, 'merchant_reply', new.entity_id, v_customer,
      'Merchant replied', v_detail, new.created_at, 'activity_log', new.id, null);

  elsif new.subject like 'merchant:signed%' then
    -- IDENTITY IS deal + DOCUMENT NAME. Bankers produced two rows for the same
    -- document 84 seconds apart; keying on new.id would have carded both.
    v_doc := btrim(regexp_replace(new.subject, '^merchant:signed\s*[—-]?\s*', ''));
    if v_doc = '' then v_doc := 'a document'; end if;
    perform public.raise_processor_notification(
      'signed:' || new.entity_id::text || ':' || lower(v_doc), 'merchant_signed',
      new.entity_id, v_customer, 'Merchant signed a document', v_doc,
      new.created_at, 'activity_log', new.id, null);

  else -- ghl:funder-reply — <Lender Name>
    v_funder := btrim(regexp_replace(new.subject, '^ghl:funder-reply\s*[—-]?\s*', ''));
    v_detail := btrim(coalesce(new.content, ''));
    v_detail := split_part(v_detail, ': "', 1);  -- the classifier's verdict
    perform public.raise_processor_notification(
      'funderreply:' || new.id::text, 'funder_reply', new.entity_id, v_customer,
      case when v_funder = '' then 'A funder replied' else v_funder || ' replied' end,
      nullif(v_detail, ''), new.created_at, 'activity_log', new.id, null);
  end if;

  return null;
end;
$$;

drop trigger if exists processor_notify_activity on public.activity_log;
create trigger processor_notify_activity
  after insert on public.activity_log
  for each row execute function public.tg_processor_notify_activity();

-- ── 5. customer_documents → "documents arrived", rolled up ──────────────────

create or replace function public.tg_processor_notify_document()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_deal   uuid;
  v_label  text;
  v_bucket bigint;
begin
  if new.customer_id is null then
    return null;
  end if;

  -- customer_documents is keyed on the CUSTOMER, so pick the deal the processor
  -- would actually open: their newest one still in an open stage.
  select d.id into v_deal
    from public.deals d
   where d.customer_id = new.customer_id
     and d.status = any (public.processor_notifiable_stages())
   order by d.created_at desc
   limit 1;

  if v_deal is null then
    return null;
  end if;

  v_label := case new.document_type::text
               when 'bank_statement' then 'bank statement'
               when 'voided_check'   then 'voided check'
               when 'application'    then 'application'
               when 'id'             then 'ID'
               else coalesce(nullif(new.document_type::text, ''), 'document')
             end;

  -- THE BURST GATE. MF-2026-0418 landed ELEVEN rows in 35 seconds. One card per
  -- deal per 10 minutes, with an incrementing count.
  v_bucket := floor(extract(epoch from coalesce(new.created_at, now())) / 600)::bigint;

  perform public.raise_processor_notification(
    'docs:' || v_deal::text || ':' || v_bucket::text, 'documents',
    v_deal, new.customer_id, 'Documents arrived', v_label,
    new.created_at, 'customer_documents', new.id, new.uploaded_by);

  return null;
end;
$$;

drop trigger if exists processor_notify_document on public.customer_documents;
create trigger processor_notify_document
  after insert on public.customer_documents
  for each row execute function public.tg_processor_notify_document();

-- ── 6. deal_submissions → an offer or a decline ─────────────────────────────

create or replace function public.tg_processor_notify_submission()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_customer uuid;
  v_lender   text;
  v_detail   text;
  v_kind     text;
  v_title    text;
begin
  -- Only a TRANSITION into a verdict. An UPDATE that re-stamps the same status
  -- (a sweep re-reading the mailbox) is not news.
  if new.status is not distinct from old.status then
    return null;
  end if;
  if new.status not in ('offer_made', 'declined') then
    return null;
  end if;

  select d.customer_id into v_customer from public.deals d where d.id = new.deal_id;
  select l.company_name into v_lender from public.lenders l where l.id = new.lender_id;
  v_lender := coalesce(nullif(btrim(v_lender), ''), 'A funder');

  if new.status = 'offer_made' then
    v_kind  := 'funder_offer';
    v_title := v_lender || ' made an offer';
    v_detail := coalesce(
      nullif(concat_ws(' · ',
        case when new.offer_amount is not null
             then '$' || to_char(new.offer_amount, 'FM999,999,999') end,
        case when new.factor_rate is not null
             then to_char(new.factor_rate, 'FM990.00') || ' factor' end,
        case when new.term_months is not null
             then new.term_months::text || ' mo' end), ''),
      'Open the deal for the terms.');
  else
    v_kind  := 'funder_decline';
    v_title := v_lender || ' declined';
    v_detail := coalesce(nullif(btrim(new.decline_reason), ''),
                         nullif(btrim(new.response_summary), ''),
                         'No reason given.');
  end if;

  perform public.raise_processor_notification(
    'sub:' || new.id::text || ':' || new.status, v_kind,
    new.deal_id, v_customer, v_title, v_detail,
    coalesce(new.response_at, new.updated_at, now()),
    'deal_submissions', new.id, null);

  return null;
end;
$$;

drop trigger if exists processor_notify_submission on public.deal_submissions;
create trigger processor_notify_submission
  after update on public.deal_submissions
  for each row execute function public.tg_processor_notify_submission();

-- ── 7. Reading it back ──────────────────────────────────────────────────────

-- The feed. Whole board, open stages, newest first — matching the RPC the
-- processor's list already uses.
create or replace function public.processor_notification_feed(
  p_limit        int     default 60,
  p_include_read boolean default true,
  p_days         int     default 30
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_out jsonb;
begin
  if v_uid is null or not (public.is_processor(v_uid) or public.is_ops_staff(v_uid)) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 300 then p_limit := 60; end if;
  if p_days  is null or p_days  < 1 or p_days  > 180 then p_days  := 30;  end if;

  select coalesce(jsonb_agg(x order by x_event_at desc), '[]'::jsonb)
    into v_out
  from (
    select jsonb_build_object(
             'id',           n.id,
             'kind',         n.kind,
             'deal_id',      n.deal_id,
             'deal_number',  d.deal_number,
             'deal_status',  d.status,
             'business_name', coalesce(
                nullif(btrim(c.business_name), ''),
                nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''),
                'Unnamed merchant'),
             'title',        n.title,
             'detail',       n.detail,
             'event_count',  n.event_count,
             'event_at',     n.event_at,
             'is_read',      (r.notification_id is not null),
             'read_at',      r.read_at
           ) as x,
           n.event_at as x_event_at
      from public.processor_notifications n
      join public.deals d      on d.id = n.deal_id
      left join public.customers c on c.id = n.customer_id
      left join public.processor_notification_reads r
             on r.notification_id = n.id and r.profile_id = v_uid
     where n.event_at > now() - make_interval(days => p_days)
       and d.status = any (public.processor_notifiable_stages())
       and (p_include_read or r.notification_id is null)
     order by n.event_at desc
     limit p_limit
  ) s;

  return v_out;
end;
$$;

-- The badge. Returns a NUMBER or RAISES — never a consoling zero.
create or replace function public.processor_unread_updates_count()
returns integer
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_n   int;
begin
  if v_uid is null or not (public.is_processor(v_uid) or public.is_ops_staff(v_uid)) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select count(*)::int into v_n
    from public.processor_notifications n
    join public.deals d on d.id = n.deal_id
   where n.event_at > now() - interval '30 days'
     and d.status = any (public.processor_notifiable_stages())
     and not exists (
       select 1 from public.processor_notification_reads r
        where r.notification_id = n.id and r.profile_id = v_uid);

  return v_n;
end;
$$;

-- One card, resolved for the live toast. Mirrors application_signature_alert():
-- the realtime payload carries ids, and the SERVER says whether this viewer may
-- see it and what the merchant is called. Zero rows means silence.
create or replace function public.processor_notification_card(p_id uuid)
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
  if v_uid is null or not (public.is_processor(v_uid) or public.is_ops_staff(v_uid)) then
    return null;
  end if;

  select jsonb_build_object(
           'id',           n.id,
           'kind',         n.kind,
           'deal_id',      n.deal_id,
           'deal_number',  d.deal_number,
           'business_name', coalesce(
              nullif(btrim(c.business_name), ''),
              nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''),
              'Unnamed merchant'),
           'title',        n.title,
           'detail',       n.detail,
           'event_count',  n.event_count,
           'event_at',     n.event_at,
           'is_read',      (r.notification_id is not null)
         )
    into v_out
    from public.processor_notifications n
    join public.deals d on d.id = n.deal_id
    left join public.customers c on c.id = n.customer_id
    left join public.processor_notification_reads r
           on r.notification_id = n.id and r.profile_id = v_uid
   where n.id = p_id
     and d.status = any (public.processor_notifiable_stages());

  return v_out;
end;
$$;

create or replace function public.processor_notifications_mark_read(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_n   int;
begin
  if v_uid is null or not (public.is_processor(v_uid) or public.is_ops_staff(v_uid)) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    return 0;
  end if;

  with ins as (
    insert into public.processor_notification_reads (notification_id, profile_id)
    select n.id, v_uid from public.processor_notifications n
     where n.id = any (p_ids)
    on conflict do nothing
    returning 1
  )
  select count(*)::int into v_n from ins;

  return v_n;
end;
$$;

create or replace function public.processor_notifications_mark_all_read()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_n   int;
begin
  if v_uid is null or not (public.is_processor(v_uid) or public.is_ops_staff(v_uid)) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  with ins as (
    insert into public.processor_notification_reads (notification_id, profile_id)
    select n.id, v_uid
      from public.processor_notifications n
      join public.deals d on d.id = n.deal_id
     where n.event_at > now() - interval '30 days'
       and d.status = any (public.processor_notifiable_stages())
    on conflict do nothing
    returning 1
  )
  select count(*)::int into v_n from ins;

  return v_n;
end;
$$;

-- ── 8. RLS ──────────────────────────────────────────────────────────────────
-- The RPCs above are SECURITY DEFINER, but the LIVE TOAST subscribes to
-- postgres_changes on processor_notifications, and realtime applies RLS. So the
-- table needs a real SELECT policy or the toast silently never fires.

alter table public.processor_notifications      enable row level security;
alter table public.processor_notification_reads enable row level security;

drop policy if exists processor_notifications_read on public.processor_notifications;
create policy processor_notifications_read
  on public.processor_notifications for select
  using (public.is_processor(auth.uid()) or public.is_ops_staff(auth.uid()));

drop policy if exists processor_notification_reads_own on public.processor_notification_reads;
create policy processor_notification_reads_own
  on public.processor_notification_reads for select
  using (profile_id = auth.uid());

-- No INSERT/UPDATE/DELETE policies on purpose: notifications are written only by
-- the triggers, and read state only through mark_read (both SECURITY DEFINER).

grant select on public.processor_notifications      to authenticated;
grant select on public.processor_notification_reads to authenticated;

-- ── 9. Realtime ─────────────────────────────────────────────────────────────
-- Publish the NOTIFICATIONS table, not activity_log. Publishing activity_log
-- would push ~78 rows/day at every admin browser, ~90% of it the GHL mirror —
-- the same mistake as including the mirror in the trigger set.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'processor_notifications'
  ) then
    alter publication supabase_realtime add table public.processor_notifications;
  end if;
end $$;
