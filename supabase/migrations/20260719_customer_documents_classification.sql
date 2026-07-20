-- Persist the content-classifier's verdict on the document row itself, so the
-- Deal Documents modal can show "what is this?" (type + confidence + one-line
-- evidence + bank-account hint) without re-running the model, and "Analyze all"
-- can target rows where classification IS NULL.
-- Shape: { type, confidence, evidence, bank_hint, model, authority, classified_at }
-- (already applied live 2026-07-19; file recorded for the canonical schema)
alter table public.customer_documents
  add column if not exists classification jsonb;
