-- lender_programs goes multi-product.
--
-- Until today every one of the 112 rows was product_type='mca'. That made a
-- missing product_type filter accidentally correct, so before writing the first
-- non-MCA row all 11 consumers were re-audited: underwrite-deal:2066,
-- recommend-lenders:264, score-lead:303, deal-assistant:260,
-- funderAvailability.ts:353, FunderQualifier:237, QualificationPanel:88,
-- LendersListPage:96, LenderDetailPage:260, FunderMatrixPage:47 and :94.
-- All 11 filter product_type. No Postgres function or view reads the table.
--
-- 1) CHECK on product_type
--
-- product_type was bare `text NOT NULL DEFAULT 'mca'` with nothing enforcing it,
-- so 'sba' and 'sba_loan' would both insert and split the data across two
-- spellings no query joins. We already have that failure live one table over:
-- lenders.lender_types and lenders.category->'products' disagree in BOTH
-- directions (49 lenders carry term_loan in category only, 3 in the enum only)
-- because two processes wrote two vocabularies nobody reconciled. Constrain it
-- now, at 112 rows and one value, not later at 130 and five.
--
-- Values match lenders.category->'products' so the funder-side vocabularies
-- agree from the start.
--
-- KNOWN DIVERGENCE, recorded deliberately rather than silently resolved:
-- deals.products_interested spells commercial real estate 'cre'; category and
-- this constraint spell it 'real_estate_cre'. The funder side and the
-- merchant-demand side therefore disagree on exactly one product. No CRE rows
-- exist on either side today, so it costs nothing now. Reconcile before the
-- first CRE deal, not after.
--
-- 2) Three nullable columns
--
-- All three are NULLABLE WITH NO DEFAULT and that is load-bearing:
-- LenderDetailPage.tsx:333 inserts a fixed key set, so a NOT NULL column with
-- no default breaks "create approval criteria" for every new lender. Exact
-- precedent: 20260706_lender_programs_important_details_nullable.sql.
--
-- They exist because the MCA-shaped doc columns cannot express credit-product
-- requirements:
--   * doc_tax_financials is a 3-value enum. SBA needs "2 years business AND
--     2 years personal" (ROK and Elite want 3 of each). A tri-state cannot.
--   * The single most common non-MCA rule has no home at all: "YTD P&L +
--     balance sheet over $100K" (UCS term $100K, UCS LOC $150K, GoKapital
--     $150K). Today it hides in doc_conditions free text where nothing reads it.
--   * Ten new booleans would mean ten edits across seven hand-maintained column
--     lists. An array is one.
--
-- Adding these to PROGRAM_SELECT (src/data/lenderPrograms.ts:134) and
-- PROGRAM_FIELDS (:97) MUST happen in the same commit. persistMca() writes
-- every PROGRAM_FIELDS key on every save from a row fetched with
-- PROGRAM_SELECT; a column in one list but not the other is silently NULLed on
-- the next "Save Changes". Nothing enforces that lockstep — no test, no type.

alter table public.lender_programs
  add column doc_tax_returns          jsonb,
  add column doc_financials_threshold numeric,
  add column doc_extras               text[];

comment on column public.lender_programs.doc_tax_returns is
  'Years of tax returns required, by filer: {"business_years":2,"personal_years":2}. null = none required / not recorded. Supersedes doc_tax_financials for credit products, which cannot express per-filer years.';

comment on column public.lender_programs.doc_financials_threshold is
  'Funded amount at or above which YTD P&L + balance sheet become required. null = no threshold rule recorded. e.g. UCS term loan = 100000.';

comment on column public.lender_programs.doc_extras is
  'Additional required documents not covered by a doc_* column. Slugs: debt_schedule, personal_financial_statement, equipment_invoice, reo_schedule, business_plan, purchase_agreement, rent_roll, appraisal, credit_report, customer_list. null = none recorded.';

alter table public.lender_programs
  add constraint lender_programs_product_type_check
  check (product_type in (
    'mca',
    'term_loan',
    'line_of_credit',
    'sba_loan',
    'equipment_financing',
    'invoice_factoring',
    'real_estate_cre'
  ));
