-- funder_replies.attachment_count — how many files the FUNDER actually sent.
--
-- WHY: when a reply's body is nothing but quoted history (hit reply, attach a
-- file, type nothing), the honest summary is "replied with N attachments and no
-- typed text". Until now the funder path could not say N, so it fell back to
-- "open the email to see whether anything was attached" — true, but it makes a
-- human go looking for a number we could have recorded at capture.
--
-- ⚠️ NULLABLE, AND NULL IS NOT ZERO. This is the whole point of the column:
--
--     NULL → we did not record it. The capture path had no attachment data.
--     0    → the email carried no files. A measured, positive fact.
--
-- Three of the five capture sites (ghl-webhook ×2, vendor-conversation-sweep)
-- read a webhook payload or a conversation-message summary that has no
-- attachments field at all. They write NULL, and the UI must say "open the
-- email" for those — NOT "0 attachments", which would be us inventing the one
-- number a human acts on. Only poll-funder-replies and funder-decline-intel
-- hold the real email record, and only they write a count.
--
-- ⚠️ THE UI KEYS ON `=== null`, NEVER ON FALSY. `0` and `null` are both falsy in
-- JS, so `count ? … : …` collapses exactly the distinction this column exists to
-- preserve and we are back where we started. Same rule as everywhere else in
-- this codebase: unreadable is never zero.
--
-- ⚠️ POPULATED AT CAPTURE, FROM WHAT THE EMAIL CARRIED — never derived later
-- from a document sweep. "What did they send?" and "what did we successfully
-- file?" are different questions that will diverge (a download can fail, a type
-- can be unsupported, a dedupe can drop one), and answering the first with the
-- second is how a merchant gets told we have documents we do not have.

alter table public.funder_replies
  add column if not exists attachment_count int;

comment on column public.funder_replies.attachment_count is
  'How many files the funder''s email carried, recorded AT CAPTURE from the email '
  'record. NULL means the capture path had no attachment data (webhook / vendor '
  'sweep) — it does NOT mean zero. 0 means the email demonstrably carried none. '
  'Consumers must branch on IS NULL, never on falsiness.';

-- A sanity guard: a negative count is a bug, not data.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'funder_replies_attachment_count_nonneg'
  ) then
    alter table public.funder_replies
      add constraint funder_replies_attachment_count_nonneg
      check (attachment_count is null or attachment_count >= 0);
  end if;
end $$;
