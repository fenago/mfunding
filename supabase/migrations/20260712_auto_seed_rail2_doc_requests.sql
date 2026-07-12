-- =============================================================================
-- The merchant flow is built around the Revenue Playbook's two rails:
--   Rail 1 (e-sign via GHL): Merchant Funding Application + Broker Compensation
--           Disclosure (funder agreement later, at offer stage).
--   Rail 2 (upload): last 4 months bank statements, owner photo ID, voided
--           business check, proof of business ownership.
--
-- In the playbook, the upload link goes out WITH the application (MCA 04 fires
-- at application_sent). This trigger makes the portal match that moment: when
-- an MCA-family deal first reaches application_sent, seed the four standard
-- Rail-2 upload requests automatically — the merchant's checklist appears at
-- the same time the email upload link arrives. Idempotent: only seeds when the
-- deal has no doc requests yet, and only once per deal.
--
-- Bank statements get the 24-hour due date (owner rule); the rest carry no due
-- date. requested_by is NULL (system-seeded). The existing deal_doc_requests
-- INSERT trigger produces the merchant notifications.
-- =============================================================================

create or replace function public.seed_rail2_doc_requests()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if NEW.status = 'application_sent'
       and OLD.status is distinct from NEW.status
       and coalesce(NEW.deal_type, 'mca') <> 'vcf'
       and not exists (select 1 from public.deal_doc_requests r where r.deal_id = NEW.id)
    then
      insert into public.deal_doc_requests
        (deal_id, customer_id, doc_type, label, status, due_at, requested_by)
      values
        (NEW.id, NEW.customer_id, 'bank_statement',
         'Last 4 months of business bank statements', 'requested',
         now() + interval '24 hours', null),
        (NEW.id, NEW.customer_id, 'id',
         'Driver''s license (photo of the front)', 'requested', null, null),
        (NEW.id, NEW.customer_id, 'voided_check',
         'Voided business check', 'requested', null, null),
        (NEW.id, NEW.customer_id, 'business_license',
         'Proof of business ownership', 'requested', null, null);
    end if;
  exception when others then
    -- Seeding must never break the stage move.
    raise warning 'seed_rail2_doc_requests failed for deal %: %', NEW.id, sqlerrm;
  end;
  return NEW;
end;
$$;

drop trigger if exists trg_seed_rail2_doc_requests on public.deals;
create trigger trg_seed_rail2_doc_requests
  after update of status on public.deals
  for each row
  execute function public.seed_rail2_doc_requests();
