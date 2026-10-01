-- ── A bounce becomes a directive, and the ledger becomes readable ───────────
--
-- Written in the SAME migration as the writer that produces these values. A
-- permitted enum value that nothing emits is its own defect: it reads as a
-- supported case to the next person and has never once been exercised.

-- 1) The new kind + provenance.
--
-- 'address_undeliverable' is deliberately NOT 'submission_email_change'. The
-- funder did not tell us anything — their mail server refused us — and the two
-- lead to different next actions ("call them, they changed inboxes" vs "this
-- address is dead, find a live one"). funder-instruction-alert made the submit
-- guard key on `retired_email` rather than on the kind name precisely so this
-- row blocks sends without having to lie about where the claim came from.
--
-- 'observed' likewise is not 'rule': nothing parsed a sentence here. A remote
-- SMTP server stated a fact about one address, which is a stronger provenance
-- than any of the three that existed and deserves to be distinguishable.
alter table public.funder_directives drop constraint if exists funder_directives_kind_check;
alter table public.funder_directives add constraint funder_directives_kind_check
  check (kind = any (array[
    'submission_email_change','use_portal','new_required_docs','contact_change',
    'address_undeliverable'
  ]));

alter table public.funder_directives drop constraint if exists funder_directives_detected_by_check;
alter table public.funder_directives add constraint funder_directives_detected_by_check
  check (detected_by = any (array['rule','llm','manual','observed']));

-- 2) The ledger must be readable by the person who actually submits.
--
-- is_ops_staff() is admin + super_admin + employee, and this project has ZERO
-- admin and ZERO employee profiles. Kristine, who sends the submissions, is
-- role `closer` — 4 of the 38 submissions are hers, including one the day before
-- this was written. An ops-staff-only policy would have made the delivery ledger
-- invisible to the only non-owner who submits, which is the same shape as a
-- ledger nobody reads. Mirrors the clause funder-instruction-alert added to
-- funder_directives for the same reason.
drop policy if exists admin_select_email_delivery_events on public.email_delivery_events;
drop policy if exists "Ops staff and closers read email_delivery_events" on public.email_delivery_events;
create policy "Ops staff and closers read email_delivery_events"
  on public.email_delivery_events for select
  using (
    (select public.is_ops_staff((select auth.uid())))
    or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.role = 'closer'::user_role
    )
  );

-- 3) Dedupe key for the bounce writer.
--
-- These rows carry no funder_reply_id (there is no reply — a server refused us),
-- so the existing (funder_reply_id, kind) unique key cannot hold them apart.
-- One OPEN undeliverable row per lender per dead address is the right grain: a
-- funder whose inbox bounces every submission for a week should produce one
-- item in the queue, not seven.
create unique index if not exists funder_directives_open_undeliverable_uidx
  on public.funder_directives (lender_id, lower(retired_email))
  where kind = 'address_undeliverable' and status = 'open' and retired_email is not null;
