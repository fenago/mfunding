-- EMAIL HEALTH, ESTABLISHED AT INTAKE — not discovered nine minutes into an application.
--
-- Companion to 20260713_customers_email_deliverability.sql. That migration recorded a
-- BOUNCE (proof, after the fact). This one adds VERIFICATION (prediction, before the
-- fact) via Instantly, and wires it to fire the moment a lead lands.
--
-- Verified live against the real project before shipping:
--   klbreen3@yahoo.com       (dead — deal MF-2026-0029)   → invalid
--   sabin.ricoh101@yahoo.com (a SECOND dead lead address) → invalid
--   vnnautorepair@yahoo.com  (GHL actually delivered it)  → verified
-- The signal discriminates on the same domain that burned us, so it is safe to gate on.
--
-- STATUS VOCABULARY (customers.email_status):
--   verified  — a real, reachable mailbox (or one GHL has demonstrably delivered to)
--   catch_all — the domain accepts everything: we genuinely CANNOT tell. NOT a pass.
--   risky     — Instantly is not confident
--   invalid   — the mailbox does not exist → refuse to send, get a new address
--   bounced   — PROVEN dead: a real send hard-bounced. Outranks every value above.
--   unknown   — we asked and got no verdict. Never blocks anything.
-- A verification NEVER overwrites 'bounced' (evidence beats a guess).

alter table public.customers
  add column if not exists email_verified_at timestamptz;

comment on column public.customers.email_verified_at is
  'Last time Instantly verified customers.email (email_status carries the verdict).';

-- Widen the vocabulary. 'ok' was the first cut of this idea (GHL delivered to it);
-- that is exactly what 'verified' means, so fold it in and retire the old value.
alter table public.customers drop constraint if exists customers_email_status_check;
update public.customers set email_status = 'verified' where email_status = 'ok';
alter table public.customers
  add constraint customers_email_status_check
  check (email_status is null or email_status in
    ('verified', 'catch_all', 'risky', 'invalid', 'bounced', 'unknown'));

-- ── FIRE VERIFICATION AT INTAKE, FROM THE DATABASE ───────────────────────────
-- Deliberately a TRIGGER rather than a call inside live-transfer-intake: leads reach
-- this table by several roads (live transfer, /apply, mca-intake, bulk import, a closer
-- typing one in), and a hook on any single road would silently miss the others. The row
-- appearing in `customers` IS the event, so that is what we hang the check on.
--
-- It also closes the loop on the FIX: the closer gets the merchant's real address on the
-- phone and edits it on the deal — the UPDATE re-fires this trigger and the new address
-- is verified within seconds, with no button to remember to press.
--
-- pg_net makes the call ASYNCHRONOUSLY: the insert commits immediately and the lead is
-- never delayed, let alone blocked, by a verification. A lead is worth far more.
create extension if not exists pg_net;

create or replace function public.verify_customer_email_async()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_secret text;
  v_anon   text;
begin
  if new.email is null or new.email = '' then
    return new;
  end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'GHL_WEBHOOK_SECRET';
  select decrypted_secret into v_anon   from vault.decrypted_secrets where name = 'SUPABASE_ANON_KEY';
  if v_secret is null or v_anon is null then
    raise warning 'verify_customer_email_async: vault secrets unavailable, skipping verification for %', new.id;
    return new;
  end if;

  perform net.http_post(
    url := 'https://ehibjeonqpqskhcvizow.supabase.co/functions/v1/verify-merchant-email?secret=' || v_secret,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_anon
    ),
    body := jsonb_build_object('customerId', new.id, 'source', 'intake_trigger'),
    timeout_milliseconds := 55000
  );
  return new;
end $$;

drop trigger if exists customers_verify_email on public.customers;
create trigger customers_verify_email
  after insert or update of email on public.customers
  for each row
  when (new.email is not null and new.email <> '')
  execute function public.verify_customer_email_async();
