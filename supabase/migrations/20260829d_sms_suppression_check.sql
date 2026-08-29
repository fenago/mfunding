-- One suppression gate for SMS sending, and the close of the additional_phones
-- hole.
--
-- TWO PROBLEMS THIS SOLVES.
--
-- 1. THE GAP. customers.additional_phones is text[], and callers were matching
--    its entries by exact string form. A merchant whose alt number is stored
--    '(818) 883-2908' would not match a send to '8188832908', so a customer on
--    do_not_contact could be texted on their second number. This is the same
--    class of bug that already produced one live DND bypass on the PRIMARY
--    phone: "no customer found" silently reads as "nobody has opted out".
--
-- 2. THE COUPLING. Suppression has genuinely been TWO checks — sms_opt_outs
--    (keyed by phone, the only record for the purchased/UCC book) and
--    customers.do_not_contact (keyed by person, the only thing that catches a
--    merchant who opted out from a different number). Neither is a superset, so
--    every caller had to remember both, and "we added a proper opt-out table"
--    is exactly the kind of change that invites deleting the older check as
--    redundant. A rule every caller must remember is a rule that eventually
--    gets forgotten, so this collapses both into one call that cannot be
--    half-performed.
--
-- FAILS LOUD, NEVER OPEN. An unparseable phone RAISES rather than returning
-- "not suppressed" — a guard that answers "allowed" when it actually means
-- "I could not tell" is how the original bypass shipped. Callers must not wrap
-- this in a handler that degrades to allow.

-- Normalizes a whole text[] of phones so an index can be built over it.
-- IMMUTABLE and STRICT-safe; NULL entries are dropped rather than propagated.
create or replace function public.sms_normalize_phones(p text[])
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    array(
      select public.sms_normalize_phone(x)
        from unnest(coalesce(p, '{}'::text[])) as x
       where public.sms_normalize_phone(x) is not null
    ),
    '{}'::text[]
  );
$$;

comment on function public.sms_normalize_phones(text[]) is
  'Array form of sms_normalize_phone, so customers.additional_phones can be indexed and compared in canonical form instead of by exact stored spelling.';

-- Both sides of the customer lookup are indexed: the guard runs on EVERY send,
-- so it must not seq-scan the book.
-- NOT partial: a `where phone is not null` predicate stops the planner matching
-- this index against `sms_normalize_phone(phone) = $1`, which silently made it
-- dead weight. Verified in use via EXPLAIN.
create index if not exists customers_phone_norm_idx
  on public.customers (public.sms_normalize_phone(phone));
create index if not exists customers_additional_phones_norm_idx
  on public.customers using gin (public.sms_normalize_phones(additional_phones));

-- ── The gate ─────────────────────────────────────────────────────────────────
-- Returns exactly one row.
--   suppressed  — do NOT send when true.
--   reason      — 'opted_out' (phone is on the SMS suppression list) or
--                 'do_not_contact' (the person who owns this number is DNC),
--                 NULL when clear.
--   customer_id — the owning customer when one was resolved, else NULL. NULL
--                 here means "no customer owns this number", NOT "safe".
--
-- SECURITY DEFINER so the answer does not depend on the caller's RLS: a guard
-- that returns different verdicts for different roles is not a guard.
create or replace function public.sms_suppression_check(p_phone text)
returns table (suppressed boolean, reason text, customer_id uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_norm text;
  v_cust uuid;
  v_dnc  boolean;
begin
  v_norm := public.sms_normalize_phone(p_phone);

  -- Unreadable input must never present as "clear to send".
  if v_norm is null then
    raise exception 'sms_suppression_check: could not normalize phone % — refusing to report a suppression verdict for an unparseable number', coalesce(quote_literal(p_phone), 'NULL')
      using errcode = 'invalid_parameter_value';
  end if;

  -- 1. Phone-level opt-out. Primary key lookup. This is the ONLY record that
  --    exists for a number with no customers row, which is most of the book.
  if exists (select 1 from public.sms_opt_outs o where o.phone = v_norm) then
    return query
      select true, 'opted_out'::text,
             (select c.id
                from public.customers c
               where public.sms_normalize_phone(c.phone) = v_norm
                  or public.sms_normalize_phones(c.additional_phones) @> array[v_norm]
               order by c.created_at desc nulls last
               limit 1);
    return;
  end if;

  -- 2. Person-level DNC, across the primary phone AND additional_phones, both
  --    compared in canonical form. When a number appears on more than one
  --    customer, a suppressed record WINS — ambiguity resolves toward not
  --    sending.
  select c.id, c.do_not_contact
    into v_cust, v_dnc
    from public.customers c
   where public.sms_normalize_phone(c.phone) = v_norm
      -- @> (containment), NOT = ANY(): only the containment operator can reach
      -- the GIN index. = ANY() forces a seq scan over the whole book.
      or public.sms_normalize_phones(c.additional_phones) @> array[v_norm]
   order by c.do_not_contact desc, c.created_at desc nulls last
   limit 1;

  if coalesce(v_dnc, false) then
    return query select true, 'do_not_contact'::text, v_cust;
    return;
  end if;

  return query select false, null::text, v_cust;
end;
$$;

comment on function public.sms_suppression_check(text) is
  'THE send gate. One call answers both suppression questions: sms_opt_outs (phone-level, the only record for numbers with no customers row) AND customers.do_not_contact (person-level, across phone + additional_phones in canonical form). Returns (suppressed, reason, customer_id). RAISES on an unparseable phone rather than reporting "clear" — never wrap this in a handler that degrades to allow.';

-- SERVICE_ROLE ONLY, deliberately. This is SECURITY DEFINER, so it answers
-- regardless of the caller's RLS — and `authenticated` in this app includes
-- MERCHANTS (profiles.role = 'user'), not just staff. Exposed to them over
-- /rest/v1/rpc it would let anyone probe arbitrary phone numbers to learn which
-- ones belong to our customers, and hand back the internal customer_id with
-- each hit. The only caller that needs it is the sms-send edge function, which
-- is service_role. A staff-facing opt-out audit page must read sms_opt_outs
-- directly, where the staff-only SELECT policy correctly excludes merchants.
revoke all on function public.sms_suppression_check(text) from public, anon, authenticated;
grant execute on function public.sms_suppression_check(text) to service_role;
revoke all on function public.sms_normalize_phones(text[]) from public, anon;
grant execute on function public.sms_normalize_phones(text[]) to authenticated, service_role;
