-- Commission approval + hold/unpaid + notify closer (ADDITIVE)
-- Adds approval audit columns and two new payment_status values: 'approved', 'on_hold'.
-- Existing statuses (pending/funder_paid/closer_paid/completed/clawback) keep working.

alter table public.commissions
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references public.profiles(id) on delete set null,
  add column if not exists hold_reason text;

-- Expand the payment_status check to allow the two new lifecycle states.
alter table public.commissions drop constraint if exists commissions_payment_status_check;
alter table public.commissions add constraint commissions_payment_status_check
  check (payment_status = any (array[
    'pending','approved','on_hold','funder_paid','closer_paid','completed','clawback'
  ]::text[]));

comment on column public.commissions.approved_at is 'When a super-admin approved the commission for payout.';
comment on column public.commissions.approved_by is 'Super-admin (profiles.id) who approved the commission.';
comment on column public.commissions.hold_reason is 'Reason the commission is on hold / unpaid; cleared on release.';

-- RLS note: existing "Super admins can manage commissions" (cmd=ALL) already covers
-- UPDATE of these new columns; closers have SELECT-only on their own rows and thus
-- CANNOT approve, pay, or release their own commissions. No policy change needed.
