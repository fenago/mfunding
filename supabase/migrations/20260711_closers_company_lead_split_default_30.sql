-- Momentum Standard company-lead split is now 30% (was 35%).
-- Change the column default and migrate any legacy seed closers still at 35.
ALTER TABLE closers ALTER COLUMN company_lead_split SET DEFAULT 30;
UPDATE closers SET company_lead_split = 30 WHERE company_lead_split = 35;
