-- funder_directives — the reader that 'other' never had.
--
-- THE FAILURE, MEASURED. On 2026-09-17 Scott Villavicencio at Uplyft Capital
-- replied to submission dbd565ba-12ec-4728-bb2a-9f525da3be0c (MF-2026-0196):
-- "Effective immediately, please send all new deal submissions to
-- submissions@uplyftcapital.com. Please stop sending submissions to
-- underwriting@uplyftcapital.com, as that inbox is now reserved for internal
-- underwriting communication."
--
-- The pipeline received it, classified it, and wrote response_summary =
-- "Funder is notifying the ISO to update their submission email to
-- submissions@uplyftcapital.com and stop using the old underwriting inbox
-- immediately." Then it set response_type = 'other' and stopped. On 2026-09-29
-- MF-2026-0385 (Miami Concierge Network LLC) and MF-2026-0366 (Volcy Marketing
-- Consultant Services, LLC) both went to underwriting@uplyftcapital.com. Both
-- are still sitting at response_at IS NULL. The system extracted the
-- instruction, understood it, wrote down what it meant, and had no path from
-- there to anything happening.
--
-- WHY A TABLE AND NOT A response_type VALUE OR A requires_action BOOLEAN:
--
--  1. SCOPE. The instruction is about the FUNDER, not about that submission. On
--     deal_submissions it is one row inside one deal, and the next submission to
--     that funder is a different row with nothing on it. That is precisely the
--     mechanism that lost it: whoever submitted MF-2026-0366 had no reason to
--     open MF-2026-0196's card. Keyed on lender_id, it is in front of every
--     future submission to Uplyft.
--  2. LIFECYCLE. An enum value has no state. Once written it is written, and
--     "a human read this and applied it" is indistinguishable from "nobody ever
--     looked". status + resolved_by + resolved_at is the difference between a
--     label and a queue.
--  3. COUNTABILITY. "Does this funder have anything outstanding?" has to be one
--     indexed read at submit time, and "how many are outstanding?" has to be a
--     number a dashboard tile can show. A scattered enum answers neither.
--  4. EVIDENCE SEPARATE FROM CONCLUSION. evidence_quote and matched_phrases
--     mean the human judges the funder's own words and the detection itself,
--     not our paraphrase of them. That is required, not nice to have — see the
--     next paragraph.
--
-- NOTHING HERE IS EVER AUTO-APPLIED. An inbound email saying "send submissions
-- to this new address" is UNTRUSTED INPUT. Applying it automatically would mean
-- anyone who can spoof or compromise one reply thread redirects a merchant's
-- signed application and bank statements to a mailbox they control, with our
-- own system doing the forwarding. There is no trusted-sender exemption either,
-- because the attack is a reply INSIDE a known thread from a known domain. So
-- this table holds proposals. A person applies them, by hand, in the funder
-- recipe. Nothing in this migration grants write access to lenders or
-- funder_submission_profiles, and nothing should.

create table if not exists public.funder_directives (
  id uuid primary key default gen_random_uuid(),
  lender_id uuid not null references public.lenders(id) on delete cascade,

  -- The evidence. funder_reply_id is the captured FULL body this came out of;
  -- without it a row is an assertion with nothing behind it.
  funder_reply_id uuid references public.funder_replies(id) on delete set null,
  deal_submission_id uuid references public.deal_submissions(id) on delete set null,
  deal_id uuid references public.deals(id) on delete set null,

  kind text not null check (kind in (
    'submission_email_change',  -- a new submissions inbox / a retired one
    'use_portal',               -- stop emailing, submit through the portal
    'new_required_docs',        -- future packages must include something new
    'contact_change'            -- who to deal with has changed
  )),

  status text not null default 'open' check (status in ('open', 'applied', 'dismissed')),

  -- 'rule' is the only value the code writes today. 'llm' and 'manual' exist
  -- because a human-entered directive is a real need and an LLM-assisted one is
  -- a plausible next step — but see the check at the bottom of this file: an
  -- allowed value that nothing produces is its own defect, so these two are
  -- deliberately recorded here as NOT YET WRITTEN rather than quietly permitted.
  detected_by text not null default 'rule' check (detected_by in ('rule', 'llm', 'manual')),

  -- The machine-checkable facts, when the rule could read them. Either may be
  -- null: a funder who says "stop using X" without naming a replacement, or
  -- names a replacement without retiring anything, is a real email. A null here
  -- means NOT READ, never "none" — the submit-time guard branches on that.
  retired_email text,
  new_email text,

  -- Which patterns fired. A human reviewing a false positive can see WHICH rule
  -- misfired instead of re-deriving it from the sentence.
  matched_phrases text[] not null default '{}',

  -- One sentence written by the RULE, not by a model. The LLM's own summary of
  -- the same reply already exists on deal_submissions.response_summary; it is
  -- not what this row is built on, because the classifier is best-effort and
  -- wrapped in a bare catch, so an outage degrades it to silence — and silence
  -- here reads as "nothing actionable", which is the bug being fixed.
  summary text not null,
  -- The funder's own words. This is what a human reads before changing a
  -- destination, and it is NOT NULL on purpose: a directive with no quotable
  -- evidence is exactly the thing nobody should act on.
  evidence_quote text not null,

  from_email text,
  received_at timestamptz,
  created_at timestamptz not null default now(),

  -- Resolution is a human act, and it is recorded as one.
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id),
  resolution_note text,

  -- One row per (reply, kind) so re-detection — the live hook, the backfill, and
  -- the nightly safety-net scan all see the same email — is idempotent.
  unique (funder_reply_id, kind)
);

comment on table public.funder_directives is
  'Funder replies that change HOW WE SUBMIT (new submissions inbox, portal-only, new required docs, contact change). PROPOSALS ONLY — never auto-applied; an inbound email is untrusted input and auto-applying an address change is a one-email route to a merchant''s bank statements. A human applies it in the funder recipe and marks the row applied.';
comment on column public.funder_directives.new_email is
  'The address the funder named as the new destination. NULL means NOT READ, not "none" — the submit-time guard must not treat an unread address as an absent one.';
comment on column public.funder_directives.retired_email is
  'The address the funder told us to stop using. NULL means NOT READ. The submit-time HARD BLOCK fires only when the resolved destination equals THIS value, because that is the one case that is a provable contradiction rather than a judgement call.';
comment on column public.funder_directives.evidence_quote is
  'The funder''s own sentence(s), verbatim. NOT NULL: a directive nobody can quote is not one a human should act on.';
comment on column public.funder_directives.detected_by is
  '''rule'' is the only value written today. The flag is produced by deterministic patterns and never by an LLM — a provider outage must not be able to turn an actionable reply into a silent non-actionable one.';

create index if not exists funder_directives_open_by_lender_idx
  on public.funder_directives (lender_id) where status = 'open';
create index if not exists funder_directives_status_created_idx
  on public.funder_directives (status, created_at desc);
create index if not exists funder_directives_reply_idx
  on public.funder_directives (funder_reply_id);

alter table public.funder_directives enable row level security;

-- READ: ops staff AND closers.
--
-- ⚠️ THE CLOSER CLAUSE IS THE WHOLE POINT, DO NOT "TIDY" IT AWAY.
--
-- is_ops_staff() is admin + super_admin + employee. The person who actually
-- sends submissions is Kristine (kristinegidoc1103@gmail.com), whose role is
-- `closer` — 4 of the 38 submissions on record, including one on 2026-09-30 —
-- and there are currently ZERO admin and ZERO employee profiles in this
-- project. Copying the funder_replies policy verbatim would have hidden this
-- queue from the only non-owner who submits, and the warning would have
-- rendered for nobody. A banner on a page nobody can open is the same blind
-- spot one layer out.
--
-- There is no money-wall concern here: a row names a funder, an inbox and a
-- quote. It carries no merchant economics.
create policy "Ops staff and closers read funder_directives"
  on public.funder_directives for select
  using (
    (select public.is_ops_staff((select auth.uid()))) or
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.role = 'closer'::user_role
    )
  );

-- WRITE: ops staff only. Resolving a directive — above all DISMISSING one — is
-- the security-relevant act, because a dismissed row stops warning anybody. It
-- stays with admin/super_admin. Detection itself runs service-role from the
-- edge functions and bypasses this.
create policy "Ops staff write funder_directives"
  on public.funder_directives for insert
  with check ((select public.is_ops_staff((select auth.uid()))));
create policy "Ops staff update funder_directives"
  on public.funder_directives for update
  using ((select public.is_ops_staff((select auth.uid()))))
  with check ((select public.is_ops_staff((select auth.uid()))));

-- Resolution must be attributable. A row that says 'applied' with nobody's name
-- on it is the same unreadable state as 'open' — worse, because it looks handled.
create or replace function public.funder_directives_resolution_guard()
returns trigger
language plpgsql
security invoker
set search_path to 'public'
as $$
begin
  if new.status <> 'open' and old.status = 'open' then
    new.resolved_at := coalesce(new.resolved_at, now());
    new.resolved_by := coalesce(new.resolved_by, auth.uid());
    if new.resolved_by is null then
      raise exception 'funder_directives.%: cannot resolve to % with no resolved_by — a resolution with nobody''s name on it looks handled and warns nobody', new.id, new.status;
    end if;
  end if;
  -- Re-opening clears the resolution rather than leaving a stale signature on it.
  if new.status = 'open' and old.status <> 'open' then
    new.resolved_at := null;
    new.resolved_by := null;
  end if;
  return new;
end;
$$;

drop trigger if exists funder_directives_resolution_guard_trg on public.funder_directives;
create trigger funder_directives_resolution_guard_trg
  before update on public.funder_directives
  for each row execute function public.funder_directives_resolution_guard();

-- NOTE ON THE CHECK VALUES ABOVE.
--
-- Three of the four `kind` values are produced by detectDirectives() in
-- supabase/functions/_shared/funderDirective.ts as of this migration, and
-- 'submission_email_change', 'use_portal' and 'contact_change' have each fired
-- on real captured replies (4 of 156, listed below). 'new_required_docs' has a
-- rule and has fired on NOTHING yet — it is permitted here because the rule
-- that writes it ships in the same change, not on the chance something might
-- write it later.
--
-- Of `detected_by`, only 'rule' is written. 'llm' and 'manual' are permitted
-- and unproduced, which is the defect this project named earlier today. They
-- are kept because the frontend's Add-by-hand path is the obvious next step and
-- splitting the enum later costs a migration — but they are called out, here,
-- in writing, as values nothing currently produces.
--
-- What the detector finds in the existing 156 captured replies:
--   598cfc5c  Uplyft Capital     submission_email_change  (THE case above)
--   1cfbfd86  True Advance       submission_email_change  submissions@trueadvancefunding.com
--   b9ead23a  InstaGreen Capital submission_email_change + use_portal
--   9ae239cc  Funding Metrics    submission_email_change + use_portal + contact_change
-- and nothing on the other 152, including every decline.
