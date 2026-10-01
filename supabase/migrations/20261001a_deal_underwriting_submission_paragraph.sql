-- Submission paragraph: the one copy-and-pasteable paragraph a closer attaches to a
-- funder submission. Tells the story honestly INCLUDING the bad parts (collections,
-- settlement servicers, NSFs) while still making the case for the merchant.
--
-- Why this exists: Spirit Drilling (MF-2026-0442) was declined by two funders over
-- recurring RAM Payment debits. The underwriter ALREADY computed that RAM is a
-- debt-settlement servicer, that it is NOT a 4th MCA position, and that it was
-- excluded from the position count — but that intelligence only ever reached our own
-- internal narrative. Getting ahead of it in the submission is the difference between
-- a decline and a conversation.
--
-- Both columns are NULLABLE and additive: every underwriting row written before this
-- migration keeps rendering, and the UI must null-check them.
alter table public.deal_underwriting
  add column if not exists submission_paragraph text,
  add column if not exists submission_facts jsonb;

comment on column public.deal_underwriting.submission_paragraph is
  'Funder-facing. ONE paragraph, pasteable without editing. Discloses the adverse '
  'facts plainly and advocates for the merchant. Never names another funder, never '
  'mentions a disqualification, a doc gap, or our internal analysis. Uses VERIFIED '
  '(bank-derived) revenue, never stated. NULL on rows written before 2026-10-01 and '
  'on any run where the writer could not be produced.';

comment on column public.deal_underwriting.submission_facts is
  'The code-computed fact set the paragraph was written from — every figure the model '
  'was permitted to use, so a human can verify the paragraph invented nothing. Code '
  'computes ground truth; the model only phrases it.';
