-- Owner rule (Jul 12 2026): BOTH required Rail-2 items — bank statements AND
-- the driver's license — carry the same 24-hour deadline. Optional items
-- (voided check, proof of ownership) carry none.

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
         'Driver''s license (photo of the front)', 'requested',
         now() + interval '24 hours', null, true),
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

-- Backfill: outstanding license requests pick up the 24h clock; outstanding
-- optional items lose any stray deadline.
update public.deal_doc_requests
  set due_at = now() + interval '24 hours'
  where doc_type = 'id' and status = 'requested' and due_at is null;

update public.deal_doc_requests
  set due_at = null
  where doc_type in ('voided_check', 'business_license') and status = 'requested';
