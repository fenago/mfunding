-- synergy_intake_log — the "did every lead email actually become a deal?" ledger.
--
-- WHY THIS EXISTS (real incident, 2026-07-13): a parser bug rejected inbound
-- live-transfer emails. Three Synergy leads arrived; only two became deals. The
-- third (Detroit Mobile Car Repair LLC) was found ONLY because the owner eyeballed
-- the GHL inbox. Nothing in the system compared "emails received" against "deals
-- created", so a 2am failure would have killed that lead silently.
--
-- One row per inbound lead EMAIL we have seen, keyed by the GHL email-record id
-- (stable + unique, and directly re-fetchable via
-- GET /conversations/messages/email/{id}). live-transfer-intake upserts a row on
-- EVERY terminal path (created / deduped / rejected); the synergy-reconcile sweep
-- lists the robot contact's recent inbound emails and treats any lead-looking
-- email with no row — or a row stuck at 'rejected' — as a gap to auto-recover and,
-- failing that, to alert on.
--
-- outcome:
--   created     — a customer + deal were created from this email
--   deduped     — same merchant already had a recent deal; record refreshed, no 2nd deal
--   rejected    — parsed, but no valid merchant could be extracted (dropped)
--   unprocessed — the sweep found this email and could NOT recover it (needs a human)

create table if not exists public.synergy_intake_log (
  ghl_email_record_id text primary key,
  ghl_conversation_id text,
  ghl_contact_id      text,
  from_email          text,
  subject             text,
  received_at         timestamptz,
  outcome             text not null
    check (outcome in ('created', 'deduped', 'rejected', 'unprocessed')),
  deal_id             uuid references public.deals(id) on delete set null,
  customer_id         uuid references public.customers(id) on delete set null,
  reject_reason       text,
  recovered_at        timestamptz,
  -- Alert-spam guard: the sweep runs every 15 minutes. A lead that genuinely
  -- needs a human would otherwise re-alert 96 times a day. The sweep only
  -- re-includes an unrecoverable row in the digest after a cooldown.
  last_alert_at       timestamptz,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.synergy_intake_log is
  'One row per inbound Synergy/vendor lead email seen (PK = GHL email-record id). Written by live-transfer-intake on every terminal path; read by synergy-reconcile to prove every lead email produced a deal.';

create index if not exists synergy_intake_log_outcome_received_idx
  on public.synergy_intake_log (outcome, received_at desc);
create index if not exists synergy_intake_log_received_idx
  on public.synergy_intake_log (received_at desc);

create or replace function public.touch_synergy_intake_log()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists synergy_intake_log_touch on public.synergy_intake_log;
create trigger synergy_intake_log_touch
  before update on public.synergy_intake_log
  for each row execute function public.touch_synergy_intake_log();

-- RLS: staff may READ (it is an observability surface, same as the sync log).
-- Writes are service-role only (edge functions bypass RLS) — no policy grants
-- insert/update/delete to any signed-in role.
alter table public.synergy_intake_log enable row level security;

drop policy if exists "Staff read synergy intake log" on public.synergy_intake_log;
create policy "Staff read synergy intake log" on public.synergy_intake_log
  for select to authenticated
  using (exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and p.role in ('closer', 'admin', 'super_admin')
  ));
