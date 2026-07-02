-- Add the 'employee' role to the user_role enum.
-- Applied to project ehibjeonqpqskhcvizow via the Supabase MCP tool.
-- NOTE: ALTER TYPE ... ADD VALUE must run in its own migration (it cannot be
-- used in the same transaction that references the new value), so the policies
-- that reference 'employee' live in a separate follow-up migration.
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'employee';
