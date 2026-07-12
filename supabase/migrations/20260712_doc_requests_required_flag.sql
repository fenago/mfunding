-- =============================================================================
-- Rail-2 requirement tiers (owner decision, Jul 12 2026):
--   REQUIRED:  last 4 months bank statements (the most critical), owner photo ID
--   OPTIONAL (but encouraged): voided business check, proof of business ownership
--
-- deal_doc_requests gains `required` (default true — closer-requested docs are
-- asks unless marked otherwise). The auto-seed trigger seeds the two optional
-- items as required=false. Existing rows of those two types are backfilled.
-- (House rule preserved: the voided check never blocks anything.)
-- =============================================================================

alter table public.deal_doc_requests
  add column if not exists required boolean not null default true;

update public.deal_doc_requests
  set required = false
  where doc_type in ('voided_check', 'business_license');

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
        (deal_id, customer_id, doc_type, label, status, due_at, requested_by, required)
      values
        (NEW.id, NEW.customer_id, 'bank_statement',
         'Last 4 months of business bank statements', 'requested',
         now() + interval '24 hours', null, true),
        (NEW.id, NEW.customer_id, 'id',
         'Driver''s license (photo of the front)', 'requested', null, null, true),
        (NEW.id, NEW.customer_id, 'voided_check',
         'Voided business check', 'requested', null, null, false),
        (NEW.id, NEW.customer_id, 'business_license',
         'Proof of business ownership', 'requested', null, null, false);
    end if;
  exception when others then
    raise warning 'seed_rail2_doc_requests failed for deal %: %', NEW.id, sqlerrm;
  end;
  return NEW;
end;
$$;
