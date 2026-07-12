-- Wave 4 — notification metadata on messages (owner-mandated notification bell).
--
-- The kind + action_path columns were introduced in
-- 20260712_merchant_notifications_v2.sql; this migration is the canonical,
-- self-contained statement of that change and reconciles one detail with the
-- team lead's spec: KEEP the deep link appended to the body too (email parity +
-- plain-text/fallback rendering both use it) while ALSO persisting the columns.
--
-- Idempotent / additive. No backfill (no real merchant notifications exist yet).
-- Nullable columns: NULL = person-to-person message; no RLS change needed.

alter table public.messages
  add column if not exists kind text,
  add column if not exists action_path text;

comment on column public.messages.kind is 'Notification producer kind (stage, doc_requested, doc_approved, doc_rejected, offer_received, signature_requested, signature_completed, renewal_milestone). NULL for person-to-person messages.';
comment on column public.messages.action_path is 'Portal deep-link path the notification opens (e.g. /portal/documents). NULL for person-to-person messages.';

-- Store kind + action_path in the columns AND keep the deep link in the body.
create or replace function public.notify_merchant(
  p_customer_id uuid,
  p_deal_id uuid,
  p_kind text,
  p_title text,
  p_body text,
  p_action_path text default '/portal'
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_to uuid;
  v_from uuid;
  v_body text;
  v_msg uuid;
begin
  select user_id into v_to from public.customers where id = p_customer_id;
  if v_to is null then
    return null;  -- merchant has no portal profile yet; nothing to deliver
  end if;

  if p_deal_id is not null then
    select assigned_closer_id into v_from from public.deals where id = p_deal_id;
  end if;
  if v_from is null then
    select id into v_from from public.profiles
      where role in ('super_admin','admin')
      order by (role = 'super_admin') desc, created_at asc nulls last limit 1;
  end if;
  if v_from is null then
    return null;
  end if;

  -- Column is the source of truth for the notification bell; the appended body
  -- link is the email-parity + plain-text fallback.
  v_body := p_body;
  if p_action_path is not null then
    v_body := v_body || E'\n\nOpen your portal: https://mfunding.net' || p_action_path;
  end if;

  insert into public.messages(from_user_id, to_user_id, subject, body, related_customer_id, status, kind, action_path)
    values (v_from, v_to, p_title, v_body, p_customer_id, 'unread', p_kind, p_action_path)
    returning id into v_msg;
  return v_msg;
end $$;
