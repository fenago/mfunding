-- ONE MERCHANT, MANY GHL CONTACTS — the identity set, and why it has to exist.
--
-- THE INCIDENT (2026-09-18, Miami Concierge Network LLC / MF-2026-0385).
-- Our side was clean: one customer, one deal. GHL held THREE contacts for the
-- same company. The merchant signed two Broker Compensation Disclosures at
-- 18:18:39 and 19:08:52 UTC — and every surface in the app told the owner
-- "Nothing sent yet", while he had the furious customer on the phone.
--
-- Nothing was broken in the usual sense. Each half worked exactly as written:
--
--   push-application-to-ghl   upserts BY THE APPLICATION'S EMAIL
--                             (mca_applications.business_email = the icloud one)
--                             -> contact O0BD4U…, and re-points customers +
--                             deals at it.
--   send-merchant-email       pre-flights with ensureContactEmail() against
--                             CUSTOMERS.EMAIL (the gmail one), finds the linked
--                             contact doesn't carry it, "heals" by upserting by
--                             email -> contact rq8qq3…, and re-points customers
--                             + deals BACK.
--
-- Two writers, two different email columns, ONE single-valued pointer. They took
-- turns overwriting it (19:06:20 -> O0BD4U…, 19:06:47 -> rq8qq3…), and whoever
-- moved last decided what every reader could see. All eight documents had landed
-- on O0BD4U…; every read asked about rq8qq3…, correctly got nothing back, and
-- reported that nothing as "nothing sent".
--
-- THE FIX IS NOT TO PICK A WINNER. A merchant legitimately has several contact
-- records in a CRM (two emails, a second owner, a spouse on the same company),
-- and deduplicating the CRM is the owner's call, not ours. What we can do is
-- stop pretending a merchant IS one contact id:
--
--   1. customers.ghl_contact_ids — every GHL contact id we have EVER resolved
--      for this merchant. Append-only.
--   2. Triggers that append on both tables, so an existing writer that clobbers
--      the primary pointer can no longer LOSE the id it overwrote. That fixes
--      the divergence for every send path at once, without touching ten
--      functions and hoping the eleventh remembers.
--   3. merchant_ghl_identity() — the one resolver, so writes and reads answer
--      "who is this merchant in GHL?" the same way.
--   4. customer_ids_for_ghl() — the reverse direction, for a sweep holding a
--      recipient id/email that needs to find the merchant behind it.
--
-- Nothing here merges or deletes a GHL contact. We make OUR side resilient to
-- the duplication and surface it, rather than hiding it behind a confident blank.

begin;

-- ── 1. The identity set ──────────────────────────────────────────────────────

alter table public.customers
  add column if not exists ghl_contact_ids text[] not null default '{}';

comment on column public.customers.ghl_contact_ids is
  'Every GHL contact id ever resolved for this merchant, primary included. '
  'Append-only (see customers_track_ghl_contact_id). Reads must union across '
  'ALL of these — a document/upload filed against any one of them belongs to '
  'this merchant. ghl_contact_id remains the single "write here by default" '
  'pointer; this is the set that makes losing one impossible.';

alter table public.customers
  add column if not exists ghl_contacts_synced_at timestamptz;

comment on column public.customers.ghl_contacts_synced_at is
  'Last time we ASKED GHL which contacts carry this merchant''s emails/phones '
  '(the discovery pass in _shared/merchantIdentity.ts). NULL means we have '
  'never looked — which is not the same as "there are no others".';

create index if not exists customers_ghl_contact_ids_gin
  on public.customers using gin (ghl_contact_ids);

-- ── 2. Backfill from what we already hold ────────────────────────────────────
-- Both pointers, across every deal. This alone recovers ids that the ping-pong
-- above has already overwritten, as long as one of the two tables still holds it.

update public.customers c
   set ghl_contact_ids = (
     select array_agg(distinct x)
       from unnest(
         c.ghl_contact_ids
         || case when c.ghl_contact_id is null then '{}'::text[] else array[c.ghl_contact_id] end
         || coalesce((
              select array_agg(distinct d.ghl_contact_id)
                from public.deals d
               where d.customer_id = c.id and d.ghl_contact_id is not null
            ), '{}'::text[])
       ) as t(x)
      where x is not null and btrim(x) <> ''
   )
 where c.ghl_contact_id is not null
    or exists (select 1 from public.deals d
                where d.customer_id = c.id and d.ghl_contact_id is not null);

-- ── 3. Append-only triggers — an overwrite can no longer lose an id ──────────

create or replace function public.customers_track_ghl_contact_id()
returns trigger
language plpgsql
as $$
begin
  if new.ghl_contact_id is not null and btrim(new.ghl_contact_id) <> ''
     and not (new.ghl_contact_id = any (coalesce(new.ghl_contact_ids, '{}'::text[])))
  then
    new.ghl_contact_ids := coalesce(new.ghl_contact_ids, '{}'::text[]) || new.ghl_contact_id;
  end if;
  return new;
end;
$$;

drop trigger if exists customers_track_ghl_contact_id on public.customers;
create trigger customers_track_ghl_contact_id
  before insert or update of ghl_contact_id, ghl_contact_ids on public.customers
  for each row execute function public.customers_track_ghl_contact_id();

-- The deal pointer is written independently of the customer pointer (that is the
-- whole bug), so it feeds the same set.
create or replace function public.deals_track_ghl_contact_id()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.ghl_contact_id is not null and btrim(new.ghl_contact_id) <> ''
     and new.customer_id is not null
  then
    update public.customers c
       set ghl_contact_ids = coalesce(c.ghl_contact_ids, '{}'::text[]) || new.ghl_contact_id
     where c.id = new.customer_id
       and not (new.ghl_contact_id = any (coalesce(c.ghl_contact_ids, '{}'::text[])));
  end if;
  return null;
end;
$$;

drop trigger if exists deals_track_ghl_contact_id on public.deals;
create trigger deals_track_ghl_contact_id
  after insert or update of ghl_contact_id on public.deals
  for each row execute function public.deals_track_ghl_contact_id();

-- ── 4. Helpers ───────────────────────────────────────────────────────────────

-- Last 10 digits — the only phone comparison that survives +1 / (305) 298-4193 /
-- 3052984193 all being the same number.
create or replace function public.phone_last10(p text)
returns text
language sql
immutable
as $$
  select nullif(right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 10), '');
$$;

-- Record a contact id we just resolved during a send. NEVER clobbers the
-- primary: clobbering is how the two pointers diverged in the first place.
create or replace function public.customer_add_ghl_contact(
  p_customer_id uuid,
  p_contact_id  text
) returns text[]
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ids text[];
begin
  if p_customer_id is null or p_contact_id is null or btrim(p_contact_id) = '' then
    return '{}'::text[];
  end if;
  update public.customers c
     set ghl_contact_ids = case
           when p_contact_id = any (coalesce(c.ghl_contact_ids, '{}'::text[]))
             then c.ghl_contact_ids
           else coalesce(c.ghl_contact_ids, '{}'::text[]) || p_contact_id
         end
   where c.id = p_customer_id
  returning c.ghl_contact_ids into v_ids;
  return coalesce(v_ids, '{}'::text[]);
end;
$$;

-- ── 5. merchant_ghl_identity — the one resolver ──────────────────────────────
-- Everything we know that could identify this merchant inside GHL. Note that
-- mca_applications' emails are included deliberately: the application's
-- business_email is the address push-application-to-ghl actually sends to, and
-- it is exactly the one that diverges from customers.email.
create or replace function public.merchant_ghl_identity(p_customer_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'customer_id',   c.id,
    'business_name', c.business_name,
    'primary_contact_id', c.ghl_contact_id,
    'contact_ids', coalesce((
      select array_agg(distinct x)
        from unnest(
          coalesce(c.ghl_contact_ids, '{}'::text[])
          || case when c.ghl_contact_id is null then '{}'::text[] else array[c.ghl_contact_id] end
          || coalesce((select array_agg(d.ghl_contact_id) from public.deals d
                        where d.customer_id = c.id and d.ghl_contact_id is not null), '{}'::text[])
        ) t(x)
       where x is not null and btrim(x) <> ''
    ), '{}'::text[]),
    'emails', coalesce((
      select array_agg(distinct lower(btrim(x)))
        from unnest(
          array[c.email]
          || coalesce(c.additional_emails, '{}'::text[])
          || coalesce((select array_agg(a.business_email) from public.mca_applications a
                        where a.customer_id = c.id and a.business_email is not null), '{}'::text[])
          || coalesce((select array_agg(a.owner_email) from public.mca_applications a
                        where a.customer_id = c.id and a.owner_email is not null), '{}'::text[])
        ) t(x)
       where x is not null and btrim(x) <> '' and x like '%@%'
    ), '{}'::text[]),
    'phones', coalesce((
      select array_agg(distinct public.phone_last10(x))
        from unnest(array[c.phone] || coalesce(c.additional_phones, '{}'::text[])) t(x)
       where public.phone_last10(x) is not null
    ), '{}'::text[]),
    'contacts_synced_at', c.ghl_contacts_synced_at
  )
  from public.customers c
  where c.id = p_customer_id;
$$;

-- ── 6. The reverse direction ─────────────────────────────────────────────────
-- A sweep holds a document recipient (a contact id, and the email GHL prints on
-- the recipient record) and needs the merchant behind it. Returns ONE ROW PER
-- MATCH, deliberately: an email that resolves to two customers is ambiguous, and
-- the caller must see that rather than be handed a silent first-row guess.
create or replace function public.customer_ids_for_ghl(
  p_contact_ids text[] default '{}',
  p_emails      text[] default '{}'
) returns table(key text, kind text, customer_id uuid, business_name text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select c.ghl_contact_id, 'contact', c.id, c.business_name
    from public.customers c
   where c.ghl_contact_id = any (p_contact_ids)
  union
  select x, 'contact', c.id, c.business_name
    from public.customers c, unnest(coalesce(c.ghl_contact_ids, '{}'::text[])) t(x)
   where x = any (p_contact_ids)
  union
  select d.ghl_contact_id, 'contact', c.id, c.business_name
    from public.deals d join public.customers c on c.id = d.customer_id
   where d.ghl_contact_id = any (p_contact_ids)
  union
  select lower(btrim(c.email)), 'email', c.id, c.business_name
    from public.customers c
   where lower(btrim(c.email)) = any (p_emails)
  union
  select lower(btrim(x)), 'email', c.id, c.business_name
    from public.customers c, unnest(coalesce(c.additional_emails, '{}'::text[])) t(x)
   where lower(btrim(x)) = any (p_emails)
  union
  select lower(btrim(a.business_email)), 'email', c.id, c.business_name
    from public.mca_applications a join public.customers c on c.id = a.customer_id
   where lower(btrim(a.business_email)) = any (p_emails)
  union
  select lower(btrim(a.owner_email)), 'email', c.id, c.business_name
    from public.mca_applications a join public.customers c on c.id = a.customer_id
   where lower(btrim(a.owner_email)) = any (p_emails);
$$;

-- ── 7. The readability stamp now follows the SET, not the single pointer ─────
-- A customer with no primary pointer but a known alias HAS been looked at by a
-- complete crawl, and saying "unchecked" about them would understate what we
-- actually know.
create or replace function public.ghl_docs_mark_checked(
  p_checked_at timestamptz default now()
) returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_n integer;
begin
  if auth.uid() is not null then
    raise exception 'ghl_docs_mark_checked is service-role only' using errcode = '42501';
  end if;

  -- A complete crawl of the location's completed documents has seen every
  -- signature that exists, so absence is established for every contact we know
  -- about. A customer with NO contact id at all is untouched: there is nothing
  -- to have looked at, and they stay honestly 'unchecked'.
  update public.customers c
     set ghl_docs_checked_at = p_checked_at
   where c.ghl_contact_id is not null
      or coalesce(array_length(c.ghl_contact_ids, 1), 0) > 0;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- deal_application_status() decides 'unchecked' vs 'not_signed' from
-- c.ghl_contact_id alone. Same widening, same reason.
CREATE OR REPLACE FUNCTION public.deal_application_status(p_deal_ids uuid[])
 RETURNS TABLE(deal_id uuid, app_sent_at timestamp with time zone, app_sent_by uuid, app_sent_by_name text, app_sent_attribution text, app_sent_attribution_basis text, born_at_application_sent boolean, app_signed_at timestamp with time zone, app_signed_state text, app_signed_checked_at timestamp with time zone, disclosure_signed_at timestamp with time zone, disclosure_state text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    d.id,
    d.application_sent_at,
    -- A phantom stamp is not a send, so it has no sender. This is the rule the
    -- readers already apply to a deal that was never sent — nothing to
    -- attribute, so NULL. Without it MF-2026-0324 reads "sent by Carlos Marquez".
    case when d.application_sent_at is null or ph.yes then null
         else coalesce(d.application_sent_by, d.assigned_closer_id) end,
    case when d.application_sent_at is null or ph.yes then null
         else coalesce(
           nullif(btrim(concat_ws(' ', sp.first_name, sp.last_name)), ''),
           nullif(btrim(concat_ws(' ', cl.first_name, cl.last_name)), '')
         ) end,
    case
      when d.application_sent_at is null or ph.yes then null
      when d.application_sent_attribution is not null then d.application_sent_attribution
      when d.assigned_closer_id is not null then 'assumed_owner'
      else 'unknown'
    end,
    case
      when ph.yes then
        'no send recorded here — the GHL opportunity mirror stamped this stage when the deal was created; any send happened inside GHL'
      when d.application_sent_at is null then null
      when d.application_sent_attribution is not null then d.application_sent_attribution_basis
      when d.assigned_closer_id is not null then
        'assumed: nobody recorded who sent it — this is the closer the deal is assigned to'
      else 'no record of who sent it, and the deal has no assigned closer'
    end,
    ph.yes,
    sig.app_signed_at,
    case
      when sig.app_signed_at is not null then 'signed'
      when not known.any_contact or c.ghl_docs_checked_at is null then 'unchecked'
      else 'not_signed'
    end,
    c.ghl_docs_checked_at,
    sig.disclosure_signed_at,
    case
      when sig.disclosure_signed_at is not null then 'signed'
      when not known.any_contact or c.ghl_docs_checked_at is null then 'unchecked'
      else 'not_signed'
    end
  from public.deals d
  join public.customers c on c.id = d.customer_id
  left join public.profiles sp on sp.id = d.application_sent_by
  left join public.profiles cl on cl.id = d.assigned_closer_id
  left join public.customer_application_signatures sig on sig.customer_id = d.customer_id
  left join lateral (
    select public.is_phantom_application_send(
             d.application_sent_at, d.created_at, d.created_by) as yes
  ) ph on true
  -- "Do we know ANY GHL contact for this merchant?" — the set, not the pointer.
  left join lateral (
    select (c.ghl_contact_id is not null
            or coalesce(array_length(c.ghl_contact_ids, 1), 0) > 0) as any_contact
  ) known on true
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

grant execute on function public.merchant_ghl_identity(uuid) to authenticated, service_role;
grant execute on function public.customer_ids_for_ghl(text[], text[]) to authenticated, service_role;
grant execute on function public.customer_add_ghl_contact(uuid, text) to service_role;
grant execute on function public.phone_last10(text) to authenticated, service_role;

commit;
