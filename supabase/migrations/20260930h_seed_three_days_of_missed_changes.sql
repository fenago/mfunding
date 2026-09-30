-- Seed the processor feed with the last THREE DAYS of real changes.
--
-- WHY A SEED AT ALL: the feature exists because of a change that was missed
-- TODAY (Bankers LLC / MF-2026-0425, 16:54 — the merchant correcting his
-- corporate name, email and phone). Shipping the triggers alone would leave
-- that miss un-surfaced forever: an empty feed on day one says "nothing has
-- changed", which is the same lie the processor was already being told.
--
-- WHY ONLY THREE DAYS, when the feed window is thirty: a badge's first
-- impression decides whether it is ever trusted. Thirty days would open at ~75
-- unread cards, which reads as a backlog to dismiss in one click rather than a
-- queue to work — and the older half is genuinely dead (those merchants have
-- since been called, funded or parked). Three days is what is still actionable.
--
-- Everything goes through raise_processor_notification(), so the seed obeys the
-- same open-stage gate and the same dedupe keys as the live triggers — the four
-- `merchant:signed — MCA — Broker Compensation Disclosure` rows in this window
-- collapse per deal exactly as Bankers' 84-second pair does, and the document
-- rows roll up into 10-minute buckets. Re-running this file is a no-op.
--
-- Nothing is marked read: these are, precisely, the things nobody has seen.

do $$
declare
  r record;
  v_detail text;
  v_doc    text;
  v_funder text;
  v_deal   uuid;
  v_label  text;
begin
  -- ── merchant replies / signatures / funder replies ──
  for r in
    select al.id, al.entity_id, al.subject, al.content, al.created_at,
           d.customer_id
      from public.activity_log al
      join public.deals d on d.id = al.entity_id
     where al.entity_type = 'deal'
       and al.created_at > now() - interval '3 days'
       and (al.subject = 'merchant:reply'
            or al.subject like 'merchant:signed%'
            or al.subject like 'ghl:funder-reply%')
     order by al.created_at asc
  loop
    if r.subject = 'merchant:reply' then
      v_detail := btrim(regexp_replace(coalesce(r.content, ''), '^\s*\[[^\]]*\]\s*', ''));
      v_detail := split_part(v_detail, ': "', 1);
      if v_detail = '' then
        v_detail := 'The merchant replied — open the deal to read it.';
      end if;
      perform public.raise_processor_notification(
        'reply:' || r.id::text, 'merchant_reply', r.entity_id, r.customer_id,
        'Merchant replied', v_detail, r.created_at, 'activity_log', r.id, null);

    elsif r.subject like 'merchant:signed%' then
      v_doc := btrim(regexp_replace(r.subject, '^merchant:signed\s*[—-]?\s*', ''));
      if v_doc = '' then v_doc := 'a document'; end if;
      perform public.raise_processor_notification(
        'signed:' || r.entity_id::text || ':' || lower(v_doc), 'merchant_signed',
        r.entity_id, r.customer_id, 'Merchant signed a document', v_doc,
        r.created_at, 'activity_log', r.id, null);

    else
      v_funder := btrim(regexp_replace(r.subject, '^ghl:funder-reply\s*[—-]?\s*', ''));
      v_detail := split_part(btrim(coalesce(r.content, '')), ': "', 1);
      perform public.raise_processor_notification(
        'funderreply:' || r.id::text, 'funder_reply', r.entity_id, r.customer_id,
        case when v_funder = '' then 'A funder replied' else v_funder || ' replied' end,
        nullif(v_detail, ''), r.created_at, 'activity_log', r.id, null);
    end if;
  end loop;

  -- ── documents, rolled up the same way the trigger rolls them ──
  for r in
    select cd.id, cd.customer_id, cd.document_type, cd.created_at, cd.uploaded_by
      from public.customer_documents cd
     where cd.created_at > now() - interval '3 days'
       and cd.customer_id is not null
     order by cd.created_at asc
  loop
    select d.id into v_deal
      from public.deals d
     where d.customer_id = r.customer_id
       and d.status = any (public.processor_notifiable_stages())
     order by d.created_at desc
     limit 1;
    continue when v_deal is null;

    v_label := case r.document_type::text
                 when 'bank_statement' then 'bank statement'
                 when 'voided_check'   then 'voided check'
                 when 'application'    then 'application'
                 when 'id'             then 'ID'
                 else coalesce(nullif(r.document_type::text, ''), 'document')
               end;

    perform public.raise_processor_notification(
      'docs:' || v_deal::text || ':'
        || floor(extract(epoch from r.created_at) / 600)::bigint::text,
      'documents', v_deal, r.customer_id, 'Documents arrived', v_label,
      r.created_at, 'customer_documents', r.id, r.uploaded_by);
  end loop;
end $$;
