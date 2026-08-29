-- sms_opt_outs — phone-level SMS suppression list.
--
-- WHY THIS EXISTS. The STOP trigger in 20260829_sms_messages.sql can only set
-- customers.do_not_contact when the inbound message matched a customers row by
-- phone. Most of what we text is a purchased/UCC dialing book with no customers
-- row at all, so for the majority of the book a STOP had nowhere to be recorded
-- and the only evidence was the raw sms_messages row. That made the send guard
-- a query every caller had to remember to write correctly. This table turns it
-- into a primary-key lookup that cannot be forgotten:
--
--   select 1 from public.sms_opt_outs
--    where phone = public.sms_normalize_phone($1);
--
-- Callers MUST go through sms_normalize_phone on the read side too — see the
-- note on the function below; that is the one way this can still fail.

-- ── Normalization ────────────────────────────────────────────────────────────
-- The suppression list is keyed by phone STRING, so writer and reader must
-- agree on the exact spelling of a number or the lookup silently misses and we
-- text someone who said STOP. Inbound phones arrive in whatever shape the far
-- end used ('+18434098518', '(843) 409-8518', '843-409-8518'), so both sides go
-- through this one function rather than each hand-rolling a format.
--
-- IMMUTABLE so it can be used in indexes and inlined by the planner.
create or replace function public.sms_normalize_phone(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p is null then null
    -- 10-digit NANP: assume US/CA, add the country code.
    when length(regexp_replace(p, '[^0-9]', '', 'g')) = 10
      then '+1' || regexp_replace(p, '[^0-9]', '', 'g')
    -- 11 digits already starting with the NANP country code.
    when length(regexp_replace(p, '[^0-9]', '', 'g')) = 11
     and left(regexp_replace(p, '[^0-9]', '', 'g'), 1) = '1'
      then '+' || regexp_replace(p, '[^0-9]', '', 'g')
    -- Other plausible E.164 lengths (international) — keep, just canonicalise.
    when length(regexp_replace(p, '[^0-9]', '', 'g')) between 7 and 15
      then '+' || regexp_replace(p, '[^0-9]', '', 'g')
    -- Short codes (< 7 digits) are not E.164 and must not get a '+'. Kept as
    -- bare digits so a short code can still be suppressed without colliding
    -- with a real number.
    else nullif(regexp_replace(p, '[^0-9]', '', 'g'), '')
  end;
$$;

comment on function public.sms_normalize_phone(text) is
  'Canonicalises a phone to the exact string form used as the sms_opt_outs primary key (E.164 +1XXXXXXXXXX for NANP; bare digits for short codes). BOTH the STOP trigger that writes the suppression row AND every send-time guard that reads it must call this — an unnormalised lookup misses the row and texts someone who opted out.';

grant execute on function public.sms_normalize_phone(text) to authenticated, service_role;

-- ── Table ────────────────────────────────────────────────────────────────────
create table if not exists public.sms_opt_outs (
  phone        text primary key,
  opted_out_at timestamptz not null default now(),
  source       text default 'sms_stop',
  -- ON DELETE SET NULL, deliberately: the opt-out must outlive the message that
  -- caused it. The spec left the delete rule unstated, which defaults to
  -- NO ACTION — that would make an opt-out row BLOCK deletion of its own
  -- sms_messages row, breaking test cleanup and any future retention prune, and
  -- worse, would tempt someone to delete the opt-out to get rid of the message.
  -- A suppression record is never worth less than the message that produced it.
  message_id   uuid references public.sms_messages(id) on delete set null
);

comment on table public.sms_opt_outs is
  'Phone-level SMS suppression list. Written by the STOP trigger on sms_messages for EVERY inbound opt-out, whether or not the number matches a customers row — this is the only opt-out record that exists for the purchased/UCC book. Read before every send via sms_normalize_phone(). Service-role writes only.';
comment on column public.sms_opt_outs.phone is
  'Primary key, normalized by sms_normalize_phone(). Never write a raw phone here.';
comment on column public.sms_opt_outs.opted_out_at is
  'When they FIRST opted out (a repeat STOP does not refresh it — see the ON CONFLICT DO NOTHING in sms_messages_stop_optout). The earliest opt-out is the legally significant date.';
comment on column public.sms_opt_outs.message_id is
  'The inbound sms_messages row that triggered it. Nullable and ON DELETE SET NULL: the suppression survives deletion of the message.';

create index if not exists sms_opt_outs_opted_out_at_idx
  on public.sms_opt_outs (opted_out_at desc);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.sms_opt_outs enable row level security;

drop policy if exists sms_opt_outs_staff_read on public.sms_opt_outs;
create policy sms_opt_outs_staff_read on public.sms_opt_outs
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('closer','employee','admin','super_admin')
    )
  );

-- Same lockdown as sms_messages: strip the default write grant, SELECT only.
revoke all on table public.sms_opt_outs from anon;
revoke all on table public.sms_opt_outs from authenticated;
grant select on table public.sms_opt_outs to authenticated;
grant all    on table public.sms_opt_outs to service_role;

-- ── STOP / START handling ────────────────────────────────────────────────────
-- Replaces the version in 20260829_sms_messages.sql. Two changes:
--   1. EVERY inbound STOP now writes sms_opt_outs, matched customer or not.
--      The customers.do_not_contact flip still happens when one is matched.
--   2. START/UNSTOP/YES lifts the suppression (TCPA permits opt-back-in).
--
-- Still deliberately does NOT swallow errors: a failed opt-out surfaces as a
-- failed insert the bridge retries. A dropped message is recoverable; an
-- ignored STOP is a TCPA violation.
create or replace function public.sms_messages_stop_optout()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_keyword     text;
  v_phone       text;
  v_prev_dnc    boolean;
  v_prev_reason text;
begin
  if new.direction <> 'inbound' then
    return null;
  end if;

  -- Punctuation-stripped whole-string match, so 'Stop.' and 'STOP!' count and
  -- 'STOP ALL' folds to STOPALL. Whole-string only: 'please stop texting' does
  -- NOT trip it.
  v_keyword := upper(regexp_replace(coalesce(new.body, ''), '[^A-Za-z]', '', 'g'));
  v_phone   := public.sms_normalize_phone(new.phone);

  if v_phone is null then
    return null;
  end if;

  -- ── OPT OUT ───────────────────────────────────────────────────────────────
  if v_keyword in ('STOP','STOPALL','UNSUBSCRIBE','CANCEL','QUIT','END','OPTOUT') then

    -- Unconditional: this is the whole point of the table. A number with no
    -- customers row still gets suppressed here.
    -- DO NOTHING (not DO UPDATE) so opted_out_at keeps the FIRST opt-out date,
    -- which is the one that matters legally. A re-subscribe deletes the row, so
    -- a later STOP correctly starts a fresh record.
    insert into public.sms_opt_outs (phone, opted_out_at, source, message_id)
    values (v_phone, now(), 'sms_stop', new.id)
    on conflict (phone) do nothing;

    if new.customer_id is not null then
      select c.do_not_contact, c.do_not_contact_reason
        into v_prev_dnc, v_prev_reason
        from public.customers c
       where c.id = new.customer_id;

      update public.customers
         set do_not_contact        = true,
             do_not_contact_reason = 'SMS opt-out (STOP)',
             updated_at            = now()
       where id = new.customer_id;

      insert into public.activity_log (entity_type, entity_id, interaction_type, subject, content, logged_by)
      values (
        'customer', new.customer_id, 'sms', 'SMS opt-out (STOP)',
        format(
          'Inbound SMS from %s matched opt-out keyword %s. do_not_contact set to true and %s added to the SMS suppression list. Message body: %L. Previous do_not_contact=%s, previous reason=%s.',
          new.phone, v_keyword, v_phone, new.body,
          coalesce(v_prev_dnc::text, 'unknown'),
          coalesce(quote_literal(v_prev_reason), 'none')
        ),
        null
      );
    end if;

    return null;
  end if;

  -- ── OPT BACK IN ───────────────────────────────────────────────────────────
  -- CTIA-standard opt-in keywords. Lifting SMS suppression is safe; silently
  -- resurrecting someone into the dialer is not, so do_not_contact is cleared
  -- ONLY when we were the ones who set it (reason is exactly our STOP string).
  -- A merchant suppressed for any other reason — manual DNC, a merge, a
  -- complaint — stays suppressed, because a START text is consent to be texted
  -- again, not a blanket reversal of an unrelated business decision.
  if v_keyword in ('START','UNSTOP','YES') then
    delete from public.sms_opt_outs where phone = v_phone;

    if new.customer_id is not null then
      update public.customers
         set do_not_contact        = false,
             do_not_contact_reason = null,
             updated_at            = now()
       where id = new.customer_id
         and do_not_contact_reason = 'SMS opt-out (STOP)';

      insert into public.activity_log (entity_type, entity_id, interaction_type, subject, content, logged_by)
      values (
        'customer', new.customer_id, 'sms', 'SMS opt-in (START)',
        format(
          'Inbound SMS from %s matched opt-in keyword %s. %s removed from the SMS suppression list. do_not_contact cleared only if it had been set by an SMS STOP. Message body: %L.',
          new.phone, v_keyword, v_phone, new.body
        ),
        null
      );
    end if;

    return null;
  end if;

  return null;
end;
$$;

comment on function public.sms_messages_stop_optout() is
  'AFTER INSERT on sms_messages. Inbound STOP/STOPALL/UNSUBSCRIBE/CANCEL/QUIT/END/OPTOUT: always upserts sms_opt_outs (matched customer or not), and additionally flips customers.do_not_contact + activity_log when a customer matched. Inbound START/UNSTOP/YES: lifts the suppression, and clears do_not_contact ONLY when its reason was our own SMS STOP. Compliance path — does not swallow errors.';
