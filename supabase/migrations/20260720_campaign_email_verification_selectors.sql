-- Selectors for the email-verify-sweep: which campaign-attributed merchant emails
-- still need an Instantly verdict, and how big the backlog is. Centralised in SQL so
-- the sweep driver and the Campaign Audit agree on exactly one definition.
--
-- "Needs a check" = the address is real text, is NOT a proven bounce (bounce is sticky
-- evidence — never re-litigated), the customer is attributed to at least one campaign
-- (a deal with campaign_id), AND one of:
--   • never checked (email_status is null), or
--   • last verdict was 'unknown' (unresolved) and it's been >12h since we asked. An
--     'unknown' is often a stubborn catch-all/greylist that keeps not resolving, so a
--     long backoff avoids burning credits re-checking it hourly. A RATE-LIMITED check is
--     different — it's never recorded (email_checked_at unchanged), so it stays in the
--     queue and retries on the very next run regardless of this backoff.
--   • the stamp is stale (>30 days) — an address can die after it was verified.

create or replace function public.select_campaign_emails_to_verify(p_limit int default 8)
returns table(customer_id uuid, email text)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.email
  from customers c
  where c.email is not null
    and c.email <> ''
    and coalesce(c.email_status, '') <> 'bounced'
    and exists (
      select 1 from deals d
      where d.customer_id = c.id and d.campaign_id is not null
    )
    and (
      c.email_status is null
      or (c.email_status = 'unknown'
          and (c.email_checked_at is null or c.email_checked_at < now() - interval '12 hours'))
      or c.email_checked_at is null
      or c.email_checked_at < now() - interval '30 days'
    )
  order by c.email_checked_at asc nulls first, c.created_at desc
  limit greatest(1, p_limit);
$$;

create or replace function public.campaign_email_verification_backlog()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from customers c
  where c.email is not null
    and c.email <> ''
    and coalesce(c.email_status, '') <> 'bounced'
    and exists (
      select 1 from deals d
      where d.customer_id = c.id and d.campaign_id is not null
    )
    and (
      c.email_status is null
      or (c.email_status = 'unknown'
          and (c.email_checked_at is null or c.email_checked_at < now() - interval '12 hours'))
      or c.email_checked_at is null
      or c.email_checked_at < now() - interval '30 days'
    );
$$;

revoke all on function public.select_campaign_emails_to_verify(int) from public, anon, authenticated;
revoke all on function public.campaign_email_verification_backlog() from public, anon, authenticated;
grant execute on function public.select_campaign_emails_to_verify(int) to service_role;
grant execute on function public.campaign_email_verification_backlog() to service_role;
