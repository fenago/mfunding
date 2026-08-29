-- Widens SMS opt-out detection beyond an exact keyword, WITHOUT the false
-- positives a naive prefix match would produce.
--
-- THE GAP. The original matcher required the whole message to equal a keyword,
-- so "stop texting me" — an unmistakable opt-out — did not suppress anyone.
-- For the purchased/UCC book, where most numbers have no customers row, there
-- is no do_not_contact fallback, so we would have kept texting.
--
-- WHY NOT JUST PREFIX-MATCH. The obvious fix (does the punctuation-stripped
-- body START WITH a keyword) was measured against realistic merchant replies
-- and misfired on 5 of 6:
--     "Stop by tomorrow and we can sign"     -> STOPBYTOMORROW...   fires
--     "Stopped by your office today"         -> STOPPEDBY...        fires
--     "End of month I will have statements"  -> ENDOFMONTH...       fires
--     "Cancel that, I found the paperwork"   -> CANCELTHAT...       fires
--     "Quit my job last year to start this"  -> QUITMYJOB...        fires
-- Every one of those is a live merchant, and a false opt-out writes a row to
-- sms_opt_outs that nothing but an inbound START will clear — we would go
-- silently unreachable on people who were actively engaging. Stripping the
-- spaces is what does the damage: it destroys the word boundary that separates
-- "stop" from "stopped" and "end" from "end of month".
--
-- THE RULE. Match on WORDS, in three tiers, and record which tier fired in
-- sms_opt_outs.source so an inferred opt-out stays auditable and reversible:
--   1. exact  — the whole message is a keyword ("STOP", "Stop!", "STOP ALL").
--   2. phrase — the FIRST WORD is an unambiguous opt-out verb. Deliberately
--      only STOP/UNSUBSCRIBE/OPTOUT/REMOVE: END, CANCEL and QUIT are common
--      openers in ordinary MCA replies and are safe ONLY as tier 1.
--   3. phrase — the message contains a standard opt-out phrase anywhere
--      ("remove me", "take me off", "do not text", "stop texting").
--
-- ASYMMETRY IS INTENTIONAL. Opt-OUT matching is liberal, because a missed
-- opt-out is silent, accrues per-message legal exposure, and the person cannot
-- fix it. Opt-IN matching stays strictly exact, because wrongly clearing a
-- suppression puts us back to texting someone who asked us not to. When in
-- doubt, both tiers fail toward "stay suppressed".

-- ── Shared matcher ───────────────────────────────────────────────────────────
-- Returns NULL (no opt-out), 'exact', or 'phrase'. This is deliberately a
-- database function rather than logic each caller re-implements: the trigger
-- that WRITES the suppression and anything that READS or explains it must agree
-- forever, and a copied keyword list drifts the first time one side is edited.
create or replace function public.sms_optout_match(body text)
returns text
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_clean text;
  v_norm  text;   -- 'STOP TEXTING ME'  (words, single-spaced)
  v_blob  text;   -- 'STOPTEXTINGME'    (letters only)
  v_first text;
begin
  -- Drop apostrophes FIRST so "don't" folds to DONT rather than splitting into
  -- "DON T", then reduce every other non-letter run to a single space.
  v_clean := translate(coalesce(body, ''), chr(39) || chr(8217), '');
  v_norm  := btrim(regexp_replace(upper(v_clean), '[^A-Z]+', ' ', 'g'));
  v_blob  := regexp_replace(upper(v_clean), '[^A-Z]', '', 'g');

  if v_blob = '' then
    return null;
  end if;

  -- TIER 1 — whole message is the keyword. Unambiguous, always honoured.
  if v_blob in ('STOP','STOPALL','UNSUBSCRIBE','CANCEL','QUIT','END','OPTOUT') then
    return 'exact';
  end if;

  -- An explicit "don't stop" outranks everything below: it is the one phrasing
  -- where the opt-out verb means the opposite.
  if v_norm like 'DONT STOP%' or v_norm like 'DO NOT STOP%' then
    return null;
  end if;

  v_first := split_part(v_norm, ' ', 1);

  -- TIER 2 — leading opt-out verb, matched as a WORD.
  -- "STOPPED BY..." does not match because STOPPED <> STOP. "STOP BY ..." would
  -- match, so it is carved out explicitly: it is the one common English opener
  -- where STOP means a visit, not a request to cease.
  if v_first in ('STOP','UNSUBSCRIBE','OPTOUT','REMOVE')
     and v_norm not like 'STOP BY %' and v_norm <> 'STOP BY' then
    return 'phrase';
  end if;

  -- TIER 3 — standard opt-out phrasing anywhere in the message.
  if v_norm like '%REMOVE ME%'
     or v_norm like '%TAKE ME OFF%'
     or v_norm like '%DO NOT TEXT%'    or v_norm like '%DONT TEXT%'
     or v_norm like '%DO NOT CONTACT%' or v_norm like '%DONT CONTACT%'
     or v_norm like '%DO NOT MESSAGE%' or v_norm like '%DONT MESSAGE%'
     or v_norm like '%STOP TEXTING%'   or v_norm like '%STOP MESSAGING%'
     or v_norm like '%STOP CONTACTING%'
     or v_norm like '%NO MORE TEXT%'
     or v_norm like '%OPT ME OUT%'
     or v_norm like '%UNSUBSCRIBE%' then
    return 'phrase';
  end if;

  return null;
end;
$fn$;

comment on function public.sms_optout_match(text) is
  'Shared SMS opt-out matcher. Returns NULL, ''exact'' (whole message is a keyword) or ''phrase'' (leading opt-out verb, or a standard opt-out phrase). Word-boundary based on purpose: a prefix match over the punctuation-stripped body misfires on real merchant replies like "Stopped by your office" and "End of month I will have statements". Single source of truth — the STOP trigger and any send-side guard must both call this rather than reimplementing the keyword list.';

-- Opt-IN stays exact-only. Widening this is the dangerous direction: a loose
-- match un-suppresses someone who asked us to stop.
create or replace function public.sms_optin_match(body text)
returns text
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_blob text;
begin
  v_blob := regexp_replace(upper(translate(coalesce(body, ''), chr(39) || chr(8217), '')), '[^A-Z]', '', 'g');
  if v_blob in ('START','UNSTOP','YES') then
    return 'exact';
  end if;
  return null;
end;
$fn$;

comment on function public.sms_optin_match(text) is
  'Shared SMS opt-in matcher. Exact whole-message START/UNSTOP/YES only — deliberately NOT widened, because a false opt-in resumes texting someone who opted out.';

grant execute on function public.sms_optout_match(text) to authenticated, service_role;
grant execute on function public.sms_optin_match(text)  to authenticated, service_role;

-- ── Trigger now uses the shared matchers ─────────────────────────────────────
create or replace function public.sms_messages_stop_optout()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tier        text;
  v_phone       text;
  v_source      text;
  v_prev_dnc    boolean;
  v_prev_reason text;
begin
  if new.direction <> 'inbound' then
    return null;
  end if;

  v_phone := public.sms_normalize_phone(new.phone);
  if v_phone is null then
    return null;
  end if;

  -- ── OPT OUT ───────────────────────────────────────────────────────────────
  v_tier := public.sms_optout_match(new.body);
  if v_tier is not null then
    -- source records HOW it matched, so the audit page can tell a certain
    -- opt-out from an inferred one and an inferred false positive can be found
    -- and reversed without trawling message bodies.
    v_source := case when v_tier = 'exact' then 'sms_stop' else 'sms_stop_phrase' end;

    -- Unconditional: a number with no customers row still gets suppressed.
    -- DO NOTHING keeps the FIRST opt-out date, which is the one that matters.
    insert into public.sms_opt_outs (phone, opted_out_at, source, message_id)
    values (v_phone, now(), v_source, new.id)
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
          'Inbound SMS from %s matched an opt-out (%s match). do_not_contact set to true and %s added to the SMS suppression list. Message body: %L. Previous do_not_contact=%s, previous reason=%s.',
          new.phone, v_tier, v_phone, new.body,
          coalesce(v_prev_dnc::text, 'unknown'),
          coalesce(quote_literal(v_prev_reason), 'none')
        ),
        null
      );
    end if;

    return null;
  end if;

  -- ── OPT BACK IN ───────────────────────────────────────────────────────────
  if public.sms_optin_match(new.body) is not null then
    delete from public.sms_opt_outs where phone = v_phone;

    -- Only undo what an SMS STOP set. A merchant suppressed for any other
    -- reason (manual DNC, litigation risk, a merge) stays suppressed: a START
    -- is consent to be texted again, not a reversal of an unrelated decision.
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
          'Inbound SMS from %s matched an opt-in keyword. %s removed from the SMS suppression list. do_not_contact cleared only if it had been set by an SMS STOP. Message body: %L.',
          new.phone, v_phone, new.body
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
  'AFTER INSERT on sms_messages. Inbound opt-out (see sms_optout_match): always upserts sms_opt_outs with source sms_stop (exact) or sms_stop_phrase (inferred), and additionally flips customers.do_not_contact + activity_log when a customer matched. Inbound START/UNSTOP/YES lifts the suppression and clears do_not_contact ONLY when its reason was our own SMS STOP. Compliance path — does not swallow errors.';
