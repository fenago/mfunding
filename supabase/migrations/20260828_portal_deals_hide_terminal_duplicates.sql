-- 20260828_portal_deals_hide_terminal_duplicates.sql
-- Applied to ehibjeonqpqskhcvizow 2026-08-28 as remote migration
-- 20260828155725_portal_deals_hide_terminal_duplicates.
--
-- get_my_portal_deals(): stop showing merchants their retired duplicate deals.
--
-- WHY: the RPC had no terminal-status filter, and PortalDashboardPage renders
-- every row it returns (src/pages/portal/PortalDashboardPage.tsx maps `deals`
-- straight to cards). After the 2026-08-28 duplicate-deal reconcile
-- (20260828_merge_duplicate_deal_pairs.sql) the soft-retired mirror deals
-- (status 'dead') sit on the SAME customer as the live deal, so two merchants
-- with active portal logins each saw a dead deal card:
--   ANDRADE'S STONE INC → MF-2026-0255 (application_sent) + MF-2026-0256 (dead)
--   Nothing But Waste   → MF-2026-0033 (application_sent) + MF-2026-0034 (dead)
--                                                        + MF-2026-0242 (dead)
-- merchant_step_key('mca','dead') returns NULL, so those cards render as
-- unlabelled stubs. They are pure bookkeeping artifacts of the merge and should
-- never have been merchant-facing.
--
-- 'declined' is excluded for the same reason: a declined deal is a closed
-- outcome, not something the merchant should keep staring at in their tracker.
--
-- 'nurture' is DELIBERATELY KEPT. A parked deal is a real, revivable deal the
-- merchant should still see. This is not a stylistic preference — measured at
-- the time of writing, ~52 merchants with portal logins have a 'nurture' deal
-- as their ONLY deal. Adding 'nurture' to this list would blank the portal
-- dashboard for every one of them. If anyone is ever tempted to "tidy" this
-- filter, re-run that count first.
--
-- Everything else about the function is unchanged: identical signature and
-- column list, STABLE SECURITY DEFINER, search_path = public. CREATE OR REPLACE
-- preserves the existing ACL and ownership (verified after apply: owner
-- postgres; EXECUTE to postgres, authenticated, service_role, and the
-- pre-existing PUBLIC grant).
--
-- SECURITY NOTE (pre-existing, NOT introduced here): the Supabase linter flags
-- this function under anon_/authenticated_security_definer_function_executable,
-- because its ACL carries the default PUBLIC EXECUTE grant. That predates this
-- change — CREATE OR REPLACE does not touch ACLs — and it is one of 99
-- SECURITY DEFINER functions in `public` with the same house pattern. It is not
-- exploitable here: for an anon caller auth.uid() is NULL, and `c.user_id =
-- auth.uid()` never matches, so the function returns zero rows.

create or replace function public.get_my_portal_deals()
returns table(
  id uuid, deal_number text, deal_type text, status text,
  amount_requested numeric, amount_funded numeric, created_at timestamp with time zone,
  contacted_at timestamp with time zone, qualified_at timestamp with time zone,
  application_sent_at timestamp with time zone, docs_collected_at timestamp with time zone,
  bank_statements_at timestamp with time zone, submitted_at timestamp with time zone,
  offer_received_at timestamp with time zone, offer_presented_at timestamp with time zone,
  offer_accepted_at timestamp with time zone, funded_at timestamp with time zone,
  declined_at timestamp with time zone, nurture_at timestamp with time zone,
  stips_promised_by date, paydown_percentage numeric,
  payback_amount numeric, remittance_amount numeric, remittance_frequency text,
  first_remittance_date date, balance_override numeric, balance_as_of timestamp with time zone,
  renewal_eligible boolean, estimated_paydown_pct numeric, renewal_interest_expressed boolean
)
language sql
stable security definer
set search_path to 'public'
as $function$
  select
    d.id, d.deal_number, d.deal_type, d.status,
    d.amount_requested, d.amount_funded, d.created_at,
    d.contacted_at, d.qualified_at, d.application_sent_at,
    d.docs_collected_at, d.bank_statements_at, d.submitted_at,
    d.offer_received_at, d.offer_presented_at, d.offer_accepted_at,
    d.funded_at, d.declined_at, d.nurture_at,
    d.stips_promised_by, d.paydown_percentage,
    d.payback_amount, d.remittance_amount, d.remittance_frequency,
    d.first_remittance_date, d.balance_override, d.balance_as_of,
    (d.status = 'renewal_eligible' or coalesce(d.paydown_percentage, 0) >= 40) as renewal_eligible,
    public.estimate_paydown(d.id) as estimated_paydown_pct,
    exists (
      select 1 from public.activity_log a
      where a.entity_type = 'deal' and a.entity_id = d.id
        and a.interaction_type = 'note' and a.subject like 'renewal:interest%'
    ) as renewal_interest_expressed
  from public.deals d
  where d.customer_id in (
    select c.id from public.customers c where c.user_id = auth.uid()
  )
    -- Retired/closed deals are bookkeeping, not merchant-facing.
    -- 'nurture' is intentionally NOT in this list — see the header.
    and d.status not in ('dead', 'declined')
  order by d.created_at desc;
$function$;

-- ── VERIFICATION (all passed 2026-08-28) ────────────────────────────────────
-- Replaying the function's own WHERE clause per merchant:
--
--   BEFORE                                   AFTER
--   ANDRADE'S STONE INC                      ANDRADE'S STONE INC
--     MF-2026-0256  dead              →        (gone)
--     MF-2026-0255  application_sent  →        MF-2026-0255  application_sent
--   Nothing But Waste                        Nothing But Waste
--     MF-2026-0242  dead              →        (gone)
--     MF-2026-0034  dead              →        (gone)
--     MF-2026-0033  application_sent  →        MF-2026-0033  application_sent
--   Allman Homes LLC (nurture control)       Allman Homes LLC
--     MF-2026-0031  nurture           →        MF-2026-0031  nurture   (KEPT)
--
-- Fleet regression: ZERO merchants with a portal login are left seeing no deals
--   select c.business_name
--     from customers c join deals d on d.customer_id = c.id
--    where c.user_id is not null
--    group by 1, c.id
--   having count(*) filter (where d.status not in ('dead','declined')) = 0;
--   -- => 0 rows
--
-- Function properties after apply: prosecdef = true, provolatile = 's',
-- proconfig = {search_path=public}, owner = postgres, grants unchanged.
-- get_advisors(security): no new warning attributable to this change — the two
-- entries naming get_my_portal_deals are the pre-existing PUBLIC-EXECUTE
-- definer-function lints described in the header.
