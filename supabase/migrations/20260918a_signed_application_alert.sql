-- 20260918a_signed_application_alert
--
-- "Can we get a pop-up and a badge when the application is actually SIGNED?"
-- asked the morning after a merchant signed and nobody saw it for hours.
--
-- Three pieces, all of them read-side. Nothing here writes a completion —
-- ghl-doc-sweep and ghl-docs-status remain the only writers.
--
--   1. ghl_doc_completions joins the realtime publication. It was NOT in
--      supabase_realtime, so a postgres_changes subscription on it would have
--      been a silent no-op forever: subscribed, never fired, and indistinguishable
--      from "nobody has signed anything". This is the whole reason the alert can
--      exist at all.
--   2. A select policy for the people who actually chase a signature. The table
--      was ops-staff-only, and realtime enforces RLS per subscriber, so a
--      processor or the deal's own closer would have received nothing. The new
--      policy is the SAME visibility rule deal_application_status() already
--      applies (processor, or my book / unassigned) — not a wider one.
--   3. Two functions the UI reads:
--      · application_signature_alert(document_id) — "is this completion an
--        APPLICATION signature I'm allowed to see, and whose deal is it?"
--        The doc-name rule stays in ONE place: is_application_doc_name().
--        The client never re-implements it; a TS mirror of that rule has already
--        drifted four times, once missing '04C MCA PARTIAL' (the default send).
--      · signed_apps_awaiting_statements() — the badge count.
--
-- WHY THE DISCLOSURE MUST NOT FIRE EITHER OF THESE
-- 'MCA — Broker Compensation Disclosure' is a separate one-page document. On
-- 2026-09-16 one merchant signed it twice and believed he was done while his
-- application sat untouched. An alert that fired on the disclosure would tell
-- the floor the same lie. is_application_doc_name() rejects /disclosure/i before
-- anything else, and both functions below go through it.

begin;

-- ── 1. Publish the table for realtime ────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'ghl_doc_completions'
  ) then
    alter publication supabase_realtime add table public.ghl_doc_completions;
  end if;
end $$;

-- ── 2. Who may see a completion ──────────────────────────────────────────────
-- Existing policy (admin_select_ghl_doc_completions) covers ops staff and is
-- left alone. This adds the two audiences that were locked out of their own
-- signatures: the processor who chases statements, and the closer whose deal it
-- is. Same predicate shape as deal_application_status()'s tail.
drop policy if exists closer_select_ghl_doc_completions on public.ghl_doc_completions;
create policy closer_select_ghl_doc_completions
  on public.ghl_doc_completions
  for select
  using (
    public.is_processor((select auth.uid()))
    or exists (
      select 1
        from public.deals d
       where d.customer_id = ghl_doc_completions.customer_id
         and (
           d.assigned_closer_id is null
           or d.assigned_closer_id = (select auth.uid())
           or d.created_by = (select auth.uid())
           or d.assigned_closer_id = any (public.my_closer_ids((select auth.uid())))
         )
    )
  );

-- ── 3a. Resolve one completion into an alert (or into nothing) ───────────────
-- Returns AT MOST ONE ROW. Zero rows means one of: not an application, not a
-- completion we hold, or not mine to see. The caller shows nothing in all three
-- cases — an alert is an interruption, and silence is the right default for a
-- signature that is not mine.
--
-- The deal choice mirrors ghl-doc-sweep's own (newest non-declined deal for the
-- customer) with one tie-break added: a live deal outranks a dead one. United
-- Resource Systems carries both, and the note belongs on the live one.
create or replace function public.application_signature_alert(p_document_id text)
returns table(
  document_id text,
  doc_name text,
  signed_at timestamptz,
  seen_at timestamptz,
  customer_id uuid,
  business_name text,
  contact_name text,
  deal_id uuid,
  deal_number text,
  deal_status text,
  /** Bank statements already on file for this merchant. 0 = the chase is on. */
  statements_count integer,
  /** True when the deal is assigned to the caller — "yours" vs "the floor's". */
  is_mine boolean
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
  select
    gc.document_id,
    gc.doc_name,
    gc.signed_at,
    gc.completed_seen_at,
    gc.customer_id,
    nullif(btrim(c.business_name), ''),
    nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''),
    d.id,
    d.deal_number,
    d.status,
    coalesce(bs.n, 0),
    coalesce(
      d.assigned_closer_id = v_uid
      or d.assigned_closer_id = any (public.my_closer_ids(v_uid)),
      false
    )
  from public.ghl_doc_completions gc
  join public.customers c on c.id = gc.customer_id
  left join lateral (
    select dd.*
      from public.deals dd
     where dd.customer_id = gc.customer_id
     order by (dd.status not in ('dead', 'declined')) desc, dd.created_at desc
     limit 1
  ) d on true
  left join lateral (
    -- customer_documents is a LOCAL table, so an empty result is a real zero.
    select count(*)::int as n
      from public.customer_documents cd
     where cd.customer_id = gc.customer_id
       and cd.document_type = 'bank_statement'
  ) bs on true
  where gc.document_id = p_document_id
    -- THE one definition of "this is the application".
    and public.is_application_doc_name(gc.doc_name)
    and (
      public.is_ops_staff(v_uid)
      or public.is_processor(v_uid)
      or d.assigned_closer_id is null
      or d.assigned_closer_id = v_uid
      or d.created_by = v_uid
      or d.assigned_closer_id = any (public.my_closer_ids(v_uid))
    );
end;
$function$;

grant execute on function public.application_signature_alert(text) to authenticated;

-- ── 3b. The badge count ──────────────────────────────────────────────────────
-- WHAT THE BADGE MEANS: merchants who have SIGNED their application and have
-- NO bank statements on file. That is the one queue where a signature turns
-- into work: the merchant has done their part, the funder cannot be submitted
-- to without statements, and nothing else in the app counts this.
--
-- Counted by MERCHANT, not by deal: a duplicate deal on one customer is one
-- chase, not two, and inflating the badge would train people to ignore it.
--
-- Terminal deals are excluded (dead / declined / funded / renewal_eligible) —
-- there is no statement to chase on a deal that is over. A merchant parked in
-- 'nurture' IS counted: a signed application sitting in nurture with no
-- statements is precisely the deal nobody is chasing.
--
-- No third state is invented here. customer_documents and
-- customer_application_signatures are both local tables, so an empty result is
-- a real zero. UNREADABLE lives one layer up: a caller that cannot run this
-- function at all (error, no session) must render "unknown", never 0 — which is
-- why the null-session case raises instead of returning a confident zero.
create or replace function public.signed_apps_awaiting_statements()
returns integer
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_n integer;
begin
  if v_uid is null then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select count(distinct d.customer_id)::int
    into v_n
    from public.deals d
    join public.customer_application_signatures sig on sig.customer_id = d.customer_id
   where d.deal_type = 'mca'
     and sig.app_signed_at is not null
     and d.status not in ('dead', 'declined', 'funded', 'renewal_eligible')
     and not exists (
       select 1 from public.customer_documents cd
        where cd.customer_id = d.customer_id
          and cd.document_type = 'bank_statement'
     )
     and (
       public.is_ops_staff(v_uid)
       or public.is_processor(v_uid)
       or d.assigned_closer_id is null
       or d.assigned_closer_id = v_uid
       or d.created_by = v_uid
       or d.assigned_closer_id = any (public.my_closer_ids(v_uid))
     );

  return coalesce(v_n, 0);
end;
$function$;

grant execute on function public.signed_apps_awaiting_statements() to authenticated;

commit;
