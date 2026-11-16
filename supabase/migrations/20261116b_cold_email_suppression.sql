-- 20261116b_cold_email_suppression — company-level suppression keys on the
-- Instantly event ledger, so instantly-enroll can enforce the compliance ruling
-- (2026-11-16): never enroll anyone who replied in any way, unsubscribed,
-- bounced, or whose COMPANY triggered stop-for-company — re-checked at enroll time.
alter table public.instantly_event_log
  add column if not exists lead_domain text generated always as (nullif(lower(split_part(lead_email, '@', 2)), '')) stored,
  add column if not exists company_norm text;   -- coldEmail.ts normCompany(), written by instantly-event-hook

create index if not exists instantly_event_log_domain_idx  on public.instantly_event_log (lead_domain)  where lead_domain is not null;
create index if not exists instantly_event_log_company_idx on public.instantly_event_log (company_norm) where company_norm is not null;
