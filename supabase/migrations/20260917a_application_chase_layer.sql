-- Application lifecycle: who sent it, did they sign it, can we even tell. ═══════
--
-- MEASURED ON LIVE (2026-09-17, before this migration):
--   63 deals carry deals.application_sent_at.
--   Only 18 mca_applications rows carry sent_by → 45 sends recorded NOTHING about
--   who did them. Every other send path (MerchantApplicationModal's three send
--   buttons, SetterActionRail, SetterAppProgress, QuickAppModal, and the
--   ghl-webhook stage mirror) advances the deal through updateDealStatus /
--   ensureDealStageAtLeast, and the stage trigger fills application_sent_at with
--   no idea who asked for it.
--
-- WHY THE SENDER IS CAPTURED IN A TRIGGER, NOT IN THE SIX CALL SITES
--   application_sent_at has exactly ONE chokepoint: the moment it goes from NULL
--   to non-NULL on public.deals. Six client paths and one edge function reach it,
--   and the next new send path will not know to record anything. A trigger on the
--   transition cannot be bypassed and needs no change in any caller. The client
--   paths all write with the user's JWT, so auth.uid() IS the sender; the
--   ghl-webhook mirror writes as service_role, where auth.uid() is NULL — and
--   NULL is the honest answer there (GHL moved the stage; we do not know who).
--
-- WHY BACKFILLED ATTRIBUTION IS MARKED, NOT ASSERTED
--   The historical 45 can only be reconstructed by proximity, which is evidence,
--   not a record. deals.application_sent_attribution says which it is
--   ('recorded' | 'inferred'), and application_sent_attribution_basis says what
--   the evidence was, so the UI can show "inferred" and the reason instead of
--   claiming a certainty we do not have. Deals with no evidence stay NULL —
--   unattributable, never guessed.
--
-- WHY A SIGNATURE READ HAS THREE STATES, NOT TWO
--   public.ghl_doc_completions is NOT a sweep. It is filled lazily by the
--   ghl-docs-status edge function, and only when someone actually opens that
--   contact's documents (merchant portal load/focus, or a staff screen). So "no
--   completion row" means EITHER "not signed" OR "nobody ever looked" — and
--   rendering the second as the first is exactly the failure-reads-as-success
--   trap that has cost this project four outages. customers.ghl_docs_checked_at
--   records when we last successfully read a contact's doc list, which lets the
--   readers below return 'unchecked' as its own state. Bank statements have no
--   such problem: customer_documents is a local table, so 0 really is 0.

begin;

-- ── 1. THE ONE DEFINITION OF "THIS DOC IS THE APPLICATION" ───────────────────
-- Live doc names in ghl_doc_completions (30 rows): '04B MCA PREFILL' (12),
-- '04C MCA PARTIAL' (2), 'MCA_Merchant_Funding_Application' (1) — and
-- 'MCA — Broker Compensation Disclosure' (15), which is a SEPARATE required
-- disclosure and is NOT the application. 2 merchants have signed only the
-- disclosure and must not read as having signed an application.
--
-- processor_pipeline_rows previously inlined the regex 'application|prefill|partial'.
-- It happens to exclude the disclosure today, but only by luck of wording — a
-- future doc called "Application Disclosure" would silently flip 2+ deals to
-- signed. The rule lives here now, and every reader calls it.
create or replace function public.is_application_doc_name(p_name text)
returns boolean
language sql
immutable
parallel safe
as $function$
  select case
    when p_name is null then false
    -- A disclosure is never the application, whatever else its name contains.
    when p_name ~* 'disclosure' then false
    when btrim(p_name) in (
      '04B MCA PREFILL',
      '04C MCA PARTIAL',
      'MCA_Merchant_Funding_Application'
    ) then true
    -- Defensive: a renamed or newly added application template still reads as
    -- the application rather than silently becoming invisible.
    when p_name ~* '(funding[ _-]*application|mca[ _]*(prefill|partial))' then true
    else false
  end;
$function$;

-- Granted so the ghl-docs-status edge function can ask the SAME question instead
-- of re-implementing it in TypeScript (its old inline /application|prefill/i test
-- silently missed '04C MCA PARTIAL', so a signed 04C never ticked the checklist).
grant execute on function public.is_application_doc_name(text) to authenticated, service_role;

comment on function public.is_application_doc_name(text) is
  'THE definition of which ghl_doc_completions.doc_name values are the merchant APPLICATION. The Broker Compensation Disclosure is explicitly not one. Every signed/unsigned reader must call this — do not re-inline a regex.';

-- ── 2. COLUMNS ──────────────────────────────────────────────────────────────
alter table public.deals
  add column if not exists application_sent_by uuid references public.profiles(id),
  add column if not exists application_sent_attribution text,
  add column if not exists application_sent_attribution_basis text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'deals_application_sent_attribution_check') then
    alter table public.deals
      add constraint deals_application_sent_attribution_check
      check (application_sent_attribution is null
             or application_sent_attribution in ('recorded','inferred'));
  end if;
end$$;

comment on column public.deals.application_sent_by is
  'Who sent the merchant application. Stamped by zz_deals_application_sender_trg at the moment application_sent_at goes NULL -> non-NULL, or backfilled. NULL = genuinely unattributable.';
comment on column public.deals.application_sent_attribution is
  'recorded = we captured the sender as it happened (auth.uid() at the stamp, or mca_applications.sent_by). inferred = reconstructed after the fact from activity_log proximity. NULL = unknown; never guess.';
comment on column public.deals.application_sent_attribution_basis is
  'Human-readable evidence behind application_sent_by, for the UI tooltip.';

-- The doc-mirror readability ledger (see header note 3).
alter table public.customers
  add column if not exists ghl_docs_checked_at timestamptz;

comment on column public.customers.ghl_docs_checked_at is
  'Last time ghl-docs-status successfully read this contact''s GHL document list. NULL means we have NEVER looked — so an absent signature is unknown, not "unsigned".';

-- ── 3. CAPTURE THE SENDER AT THE TRANSITION ─────────────────────────────────
-- Named zz_* on purpose: Postgres fires BEFORE row triggers in NAME order, and
-- this one must run AFTER deals_stamp_stage_timestamps_trg has filled
-- application_sent_at. 'zz_' < nothing else here, so it is last.
create or replace function public.deals_stamp_application_sender()
returns trigger
language plpgsql
as $function$
declare
  v_uid uuid := auth.uid();
begin
  -- Cleared back to NULL (a correction / un-send): the attribution goes with it.
  if new.application_sent_at is null then
    new.application_sent_by := null;
    new.application_sent_attribution := null;
    new.application_sent_attribution_basis := null;
    return new;
  end if;

  -- Only the NULL -> non-NULL transition is a "send". Re-sends and later edits
  -- must never overwrite who did it the first time.
  if tg_op = 'UPDATE' and old.application_sent_at is not null then
    return new;
  end if;

  -- The writer may have set application_sent_by explicitly in the same
  -- statement (an edge function that knows its caller); that wins.
  if new.application_sent_by is not null then
    new.application_sent_attribution :=
      coalesce(new.application_sent_attribution, 'recorded');
    new.application_sent_attribution_basis :=
      coalesce(new.application_sent_attribution_basis, 'set by the writing call');
    return new;
  end if;

  -- Every client send path writes with the user's JWT, so this IS the sender.
  -- service_role writers (the ghl-webhook stage mirror, cron) have no uid, and
  -- the row stays honestly unattributed.
  if v_uid is not null then
    new.application_sent_by := v_uid;
    new.application_sent_attribution := 'recorded';
    new.application_sent_attribution_basis := 'signed-in user at the moment the stage was stamped';
  end if;

  return new;
end;
$function$;

drop trigger if exists zz_deals_application_sender_trg on public.deals;
create trigger zz_deals_application_sender_trg
  before insert or update on public.deals
  for each row execute function public.deals_stamp_application_sender();

comment on function public.deals_stamp_application_sender() is
  'Records WHO sent the merchant application, at the one chokepoint every send path passes through (application_sent_at going NULL -> non-NULL). Runs last among BEFORE triggers by name (zz_) so the stage trigger has already filled the timestamp.';

-- ── 4. BACKFILL, TIERED, AND HONEST ABOUT WHICH TIER ────────────────────────
-- Tier 1 (recorded): mca_applications.sent_by — an actual record of the send.
-- Tier 2 (inferred): a deal-scoped activity_log row within ±10 minutes whose
--   subject is one of the application-send markers. 'application:pushed-to-ghl'
--   is the marker push-application-to-ghl writes, so this is near-direct
--   evidence, not merely "this person was awake".
-- Tier 3 (inferred): any logged_by activity within ±10 minutes on the deal or
--   its customer, deal-scoped preferred, then nearest in time. Weakest tier.
-- No tier matched → left NULL. Unattributable stays unattributable.
with scope as (
  select d.id, d.customer_id, d.application_sent_at
    from public.deals d
   where d.application_sent_at is not null
     and d.application_sent_by is null
),
recorded as (
  select s.id,
         (select a.sent_by
            from public.mca_applications a
           where a.deal_id = s.id and a.sent_by is not null
           order by a.sent_to_merchant_at desc nulls last
           limit 1) as who
    from scope s
),
strong as (
  select s.id,
         (select al.logged_by
            from public.activity_log al
           where al.logged_by is not null
             and al.entity_type = 'deal'
             and al.entity_id = s.id
             and al.subject ~* '(application:pushed-to-ghl|merchant:email — Your funding application|Portal invite sent)'
             and al.created_at between s.application_sent_at - interval '10 minutes'
                                   and s.application_sent_at + interval '10 minutes'
           order by abs(extract(epoch from (al.created_at - s.application_sent_at))) asc
           limit 1) as who
    from scope s
),
weak as (
  select s.id,
         (select al.logged_by
            from public.activity_log al
           where al.logged_by is not null
             and ((al.entity_type = 'deal'     and al.entity_id = s.id)
               or (al.entity_type = 'customer' and al.entity_id = s.customer_id))
             and al.created_at between s.application_sent_at - interval '10 minutes'
                                   and s.application_sent_at + interval '10 minutes'
           order by (al.entity_type = 'deal') desc,
                    abs(extract(epoch from (al.created_at - s.application_sent_at))) asc
           limit 1) as who
    from scope s
),
resolved as (
  select s.id,
         coalesce(r.who, st.who, w.who) as who,
         case
           when r.who  is not null then 'recorded'
           when st.who is not null then 'inferred'
           when w.who  is not null then 'inferred'
         end as attribution,
         case
           when r.who  is not null then 'mca_applications.sent_by (recorded at send time)'
           when st.who is not null then 'inferred: application-send marker in the deal timeline within 10 min'
           when w.who  is not null then 'inferred: only person active on this deal/customer within 10 min'
         end as basis
    from scope s
    left join recorded r on r.id = s.id
    left join strong  st on st.id = s.id
    left join weak     w on w.id = s.id
)
update public.deals d
   set application_sent_by = res.who,
       application_sent_attribution = res.attribution,
       application_sent_attribution_basis = res.basis
  from resolved res
 where d.id = res.id
   and res.who is not null;

-- Backfill the doc-mirror ledger: a customer with a completion row is proof we
-- DID read their GHL doc list at least once, at that moment.
update public.customers c
   set ghl_docs_checked_at = g.seen
  from (select customer_id, max(completed_seen_at) as seen
          from public.ghl_doc_completions
         where customer_id is not null
         group by customer_id) g
 where g.customer_id = c.id
   and c.ghl_docs_checked_at is null;

-- ── 5. THE CHEAP COMPANION READER (TASK 3) ──────────────────────────────────
-- Everywhere "application sent" already appears (deal detail, playbook, setter
-- performance) can call this for the signed/unsigned/unchecked badge. Local
-- tables only, one pass, no GHL call — safe on a list page.
--
-- app_signed_state:
--   'signed'     an application doc completion exists.
--   'not_signed' we have read this contact's doc list and there was none.
--   'unchecked'  we have never read it (or there is no GHL contact to read) —
--                the UI must NOT render this as unsigned.
drop function if exists public.deal_application_status(uuid[]);
create function public.deal_application_status(p_deal_ids uuid[])
returns table (
  deal_id               uuid,
  app_sent_at           timestamptz,
  app_sent_by           uuid,
  app_sent_by_name      text,
  app_sent_attribution  text,
  app_sent_attribution_basis text,
  app_signed_at         timestamptz,
  app_signed_state      text,
  app_signed_checked_at timestamptz,
  disclosure_signed_at  timestamptz,
  disclosure_state      text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    d.id,
    d.application_sent_at,
    d.application_sent_by,
    nullif(btrim(concat_ws(' ', sp.first_name, sp.last_name)), ''),
    -- NULL when the application was never sent (nothing to attribute); 'unknown'
    -- only for a send whose sender we genuinely cannot establish. Conflating the
    -- two would print "sent by unknown" on a deal nobody has sent yet.
    case when d.application_sent_at is null then null
         else coalesce(d.application_sent_attribution, 'unknown') end,
    d.application_sent_attribution_basis,
    sig.app_at,
    case
      when sig.app_at is not null then 'signed'
      when c.ghl_contact_id is null or c.ghl_docs_checked_at is null then 'unchecked'
      else 'not_signed'
    end,
    c.ghl_docs_checked_at,
    sig.disc_at,
    case
      when sig.disc_at is not null then 'signed'
      when c.ghl_contact_id is null or c.ghl_docs_checked_at is null then 'unchecked'
      else 'not_signed'
    end
  from public.deals d
  join public.customers c on c.id = d.customer_id
  left join public.profiles sp on sp.id = d.application_sent_by
  left join lateral (
    select max(gc.completed_seen_at) filter (where public.is_application_doc_name(gc.doc_name)) as app_at,
           max(gc.completed_seen_at) filter (where gc.doc_name ~* 'disclosure')                 as disc_at
      from public.ghl_doc_completions gc
     where gc.customer_id = d.customer_id
  ) sig on true
  where d.id = any (p_deal_ids)
    and (
      public.is_ops_staff(auth.uid())
      or public.is_processor(auth.uid())
      or d.assigned_closer_id is null
      or d.assigned_closer_id = auth.uid()
      or d.created_by = auth.uid()
      or d.assigned_closer_id = any (public.my_closer_ids(auth.uid()))
    );
$function$;

revoke all on function public.deal_application_status(uuid[]) from public, anon;
grant execute on function public.deal_application_status(uuid[]) to authenticated, service_role;

comment on function public.deal_application_status(uuid[]) is
  'Cheap signed/unsigned/unchecked badge data for any list page. Re-states the deals money-wall SELECT predicate (ops + processors see all; a setter sees own book + unassigned). Reads local tables only.';

-- ── 6. THE PROCESSOR APPLICATION QUEUE (TASK 2) ─────────────────────────────
-- SCOPE: every MCA deal that has an application in flight (a sent stamp or a
-- saved draft) OR is at/past Qualifying — including deals that have since been
-- parked to nurture/dead, because an unsigned application on a parked deal is
-- precisely what the processor is chasing. 77 rows on live today.
--
-- GATE: processors AND ops staff. The processor money-wall exemption is
-- deliberate (see migration 20260830z / the closer-money-wall-and-processor
-- convention) — do NOT re-narrow this to own-book.
--
-- NOT COMPUTED HERE: partial-vs-complete. src/lib/applicationCompleteness.ts is
-- the one definition of which fields make an application complete, and the modal
-- imports the same list. Restating it in SQL is exactly the lockstep divergence
-- this codebase keeps getting bitten by. app_fields carries the raw material —
-- the saved draft row (or null) plus the deal/customer/lead_qual the helper
-- seeds from when there is no draft — and the TS helper decides.
drop function if exists public.processor_application_queue();
create function public.processor_application_queue()
returns table (
  deal_id                    uuid,
  deal_number                text,
  merchant_name              text,
  deal_status                text,
  deal_type                  text,
  customer_id                uuid,
  do_not_contact             boolean,
  assigned_closer_id         uuid,
  assigned_closer_name       text,
  app_sent_at                timestamptz,
  app_sent_by                uuid,
  app_sent_by_name           text,
  app_sent_attribution       text,
  app_sent_attribution_basis text,
  app_signed_at              timestamptz,
  app_signed_state           text,
  app_signed_checked_at      timestamptz,
  disclosure_signed_at       timestamptz,
  disclosure_state           text,
  statements_count           integer,
  statements_last_at         timestamptz,
  qa_decision                text,
  qa_decided_at              timestamptz,
  qa_decision_reason         text,
  days_since_app_sent        integer,
  first_call_due_at          timestamptz,
  attempts_since_sent        integer,
  last_attempt_at            timestamptz,
  last_conversation_at       timestamptz,
  app_row_exists             boolean,
  app_fields                 jsonb
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_ids uuid[];
  c_max constant int := 500;
begin
  if v_uid is null or not (public.is_processor(v_uid) or public.is_ops_staff(v_uid)) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select array_agg(d.id order by d.application_sent_at desc nulls last, d.created_at desc)
    into v_ids
    from public.deals d
   where d.deal_type = 'mca'
     and (
       d.application_sent_at is not null
       or exists (select 1 from public.mca_applications a where a.deal_id = d.id)
       or coalesce(public.deals_stage_rank(d.status), -1) >= 2
     );

  if v_ids is null then
    return;
  end if;
  if array_length(v_ids, 1) > c_max then
    v_ids := v_ids[1:c_max];
  end if;

  return query
  with calls as (
    -- REUSE the canonical call definition. Do not hand-roll a phone match here:
    -- deal_call_events already reconciles wavv / ghl / activity_log and dedupes
    -- the mirrors (see 20260916h).
    select e.deal_id, e.at, e.is_conversation
      from public.deal_call_events(v_ids) e
  ),
  agg as (
    select d.id,
           (select count(*)::int from calls k
             where k.deal_id = d.id
               and d.application_sent_at is not null
               and k.at >= d.application_sent_at)                       as attempts_since_sent,
           (select max(k.at) from calls k where k.deal_id = d.id)        as last_attempt_at,
           (select max(k.at) from calls k
             where k.deal_id = d.id and k.is_conversation)               as last_conversation_at
      from public.deals d
     where d.id = any (v_ids)
  )
  select
    d.id,
    d.deal_number,
    coalesce(nullif(btrim(c.business_name), ''),
             nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '')),
    d.status,
    d.deal_type,
    d.customer_id,
    coalesce(c.do_not_contact, false),
    d.assigned_closer_id,
    nullif(btrim(concat_ws(' ', cl.first_name, cl.last_name)), ''),
    d.application_sent_at,
    d.application_sent_by,
    nullif(btrim(concat_ws(' ', sp.first_name, sp.last_name)), ''),
    case when d.application_sent_at is null then null
         else coalesce(d.application_sent_attribution, 'unknown') end,
    d.application_sent_attribution_basis,
    sig.app_at,
    case
      when sig.app_at is not null then 'signed'
      when c.ghl_contact_id is null or c.ghl_docs_checked_at is null then 'unchecked'
      else 'not_signed'
    end,
    c.ghl_docs_checked_at,
    sig.disc_at,
    case
      when sig.disc_at is not null then 'signed'
      when c.ghl_contact_id is null or c.ghl_docs_checked_at is null then 'unchecked'
      else 'not_signed'
    end,
    bs.n,
    bs.last_at,
    q.decision,
    q.decision_at,
    q.decision_reason,
    case when d.application_sent_at is null then null
         else floor(extract(epoch from (now() - d.application_sent_at)) / 86400.0)::int
    end,
    d.first_call_due_at,
    a.attempts_since_sent,
    a.last_attempt_at,
    a.last_conversation_at,
    (app.id is not null),
    jsonb_build_object(
      -- The saved draft, verbatim, or null when none exists. The TS helper
      -- switches on exactly this: a row means "hydrate", null means "seed".
      'application', case when app.id is null then null else to_jsonb(app) end,
      -- What the helper's SEED branch reads off the deal + customer + lead payload.
      'deal', jsonb_build_object(
        'id', d.id,
        'deal_type', d.deal_type,
        'status', d.status,
        'amount_requested', d.amount_requested,
        'use_of_funds', d.use_of_funds,
        'lead_qual', coalesce(d.lead_qual, '{}'::jsonb)
      ),
      'customer', jsonb_build_object(
        'id', c.id,
        'business_name', c.business_name,
        'first_name', c.first_name,
        'last_name', c.last_name,
        'email', c.email,
        'phone', c.phone,
        'industry', c.industry,
        'monthly_revenue', c.monthly_revenue,
        'address_street', c.address_street,
        'address_city', c.address_city,
        'address_state', c.address_state,
        'address_zip', c.address_zip
      )
    )
  from public.deals d
  join public.customers c on c.id = d.customer_id
  join agg a on a.id = d.id
  left join public.profiles cl on cl.id = d.assigned_closer_id
  left join public.profiles sp on sp.id = d.application_sent_by
  left join public.deal_processor_qa q on q.deal_id = d.id
  left join lateral (
    select * from public.mca_applications ma where ma.deal_id = d.id
     order by ma.updated_at desc nulls last limit 1
  ) app on true
  left join lateral (
    -- customer_documents is a LOCAL table: an empty result is a real zero, not
    -- an unreadable one, so no third state is invented here.
    select count(*)::int as n, max(cd.created_at) as last_at
      from public.customer_documents cd
     where cd.customer_id = d.customer_id
       and cd.document_type = 'bank_statement'
  ) bs on true
  left join lateral (
    select max(gc.completed_seen_at) filter (where public.is_application_doc_name(gc.doc_name)) as app_at,
           max(gc.completed_seen_at) filter (where gc.doc_name ~* 'disclosure')                 as disc_at
      from public.ghl_doc_completions gc
     where gc.customer_id = d.customer_id
  ) sig on true
  where d.id = any (v_ids)
  order by d.application_sent_at desc nulls last, d.created_at desc;
end;
$function$;

revoke all on function public.processor_application_queue() from public, anon;
grant execute on function public.processor_application_queue() to authenticated, service_role;

comment on function public.processor_application_queue() is
  'Application-chase queue for the processor. Gated on is_processor OR is_ops_staff (the processor money-wall exemption is deliberate). Never computes partial-vs-complete: app_fields carries the raw draft + seed material and src/lib/applicationCompleteness.ts decides. Signature has three states because ghl_doc_completions is a lazy mirror, not a sweep.';

commit;
