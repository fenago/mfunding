-- Add 'closer' to the user_role enum (applied live via MCP 2026-06-28; kept in VC).
-- Closers get operational backend access (deals, customers, renewals, docs, tools,
-- playbook) but not financials/analytics/config (those stay super_admin-gated).
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'closer' BEFORE 'admin';
