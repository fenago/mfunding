# Product-aware submission recipes

**Status:** proposed, not built. Written 2026-10-30 at the owner's request.
**Trigger:** the Term & Line of Credit product line went live on `/admin/products`
with three funders, and none of them can be submitted to correctly, because a
submission recipe has no idea what product it is sending.

---

## 1. The problem, in one table

`funder_submission_profiles` is **one row per lender**. There is no product
dimension. The clearest proof is GoKapital, from their own published materials:

| Their product | Statements they want |
|---|---|
| Term loan | 3 months |
| Line of credit | 4 months |
| MCA | 6 months |
| Equipment | 6 months |
| SBA | 12 months |

Five numbers. One `max_statement_months` column. Whatever is in it is wrong for
four of their five products.

It is not only statement counts:

- **UCS** requires the application to have been signed **within the last 30
  days** on a term file, and we have nowhere to record an application-age rule
  at all.
- **1 West**'s rep said 3–4 months "depending on which lender picks it up", with
  driving licence and voided cheque deferred to closing rather than collected up
  front — a different stip *timing*, not a different stip list.
- **`active` is per-lender.** A funder can be live for advances and not yet
  approved for term, and today that is one boolean.

All three Term & LOC recipes are MCA-shaped right now — `required_stips` is
`application` + `bank_statement`. **A term file pushed through the submit flow
goes out on the advance recipe, and nothing anywhere says so.**

### The credit box is already product-aware. Only the recipe is not.

`lender_programs.product_type` exists and is populated: 112 `mca` rows, and 3
each of `term_loan`, `line_of_credit`, `sba_loan` and `equipment_financing`.
So we can already answer *"will this funder do a term loan, and on what terms"*.
We cannot answer *"and how do I send them one"*. That asymmetry is the whole bug.

Note `product_type` is **text, not an enum**. Any new work should either reuse
the same text values verbatim or introduce an enum and migrate both tables
together — never half.

---

## 2. A data problem sitting underneath the code problem

While fixing the outbound-email leak (commit `6e65dd5`) it turned out that
`funder_submission_profiles` **already has an `internal_notes` column**, and it
is in use: 27 of 37 profiles have it populated, against 19 with
`special_instructions`.

So the two fields were designed to be different things —
`special_instructions` funder-facing, `internal_notes` ours — and in practice
every author put internal content into the funder-facing one. That is why our
commission splits and their own buy rates ended up in 24 outbound emails.

The code fix is right for the data we have: **nothing in
`special_instructions` today is funder-facing, so none of it may be sent.** But
the shape to aim for is:

- `special_instructions` → rename it or empty it. A field that was wrong for
  years and is now never sent is a trap for the next person who fills it in
  expecting it to reach the funder.
- `internal_notes` → the single internal field, shown in the preview under
  "Internal — not sent to the funder".
- `body_template` → the only thing the funder reads. It already exists and is
  already rendered. If a funder genuinely needs a standing line, it goes here.

**Recommendation: do the content migration before adding product rules**, so we
are not duplicating a mislabelled field across a new table.

---

## 3. Three ways to add the product dimension

### Option A — add `product_type` to `funder_submission_profiles`

One recipe per (lender, product). Conceptually clean.

Against it: every one of the 37 existing rows needs backfilling to `'mca'`, and
then any funder doing two products needs two near-identical rows that will
drift. We watched exactly that happen this week — 1 West's `lender_types` and
`category.products` disagreed about invoice factoring because they are two
hand-maintained copies of one fact. It also reintroduces the fallback question
("what do I send if there is no row for this product?"), which lands you back at
base-plus-override having built it accidentally.

### Option B — base profile + a product override table ✅ **recommended**

Keep `funder_submission_profiles` as the base, exactly as it is. Add a child
table holding **only what differs** for a given product.

Why this one:

- **Additive. Zero migration risk.** All 37 rows keep working unchanged, and
  every MCA submission behaves identically on day one.
- **Overrides hold differences only**, so there is nothing to drift. GoKapital
  gets four small rows that each say one thing: the statement count.
- It answers *"what is different about a term file at this funder"* in one
  place, which is the question a closer actually asks.

### Option C — a JSONB `per_product` column

Against it: cannot be constrained, cannot be usefully indexed for "show me every
funder that takes term files", and needs a bespoke editor in the admin UI. The
one thing this codebase reliably demonstrates is that untyped text and JSONB
fields drift and then disagree — four different numbers for our 1 West
compensation share, across four columns, is this week's example.

---

## 4. Schema

```sql
create table funder_submission_product_rules (
  id          uuid primary key default gen_random_uuid(),
  lender_id   uuid not null references lenders(id) on delete cascade,
  -- Same vocabulary as lender_programs.product_type. Keep them identical.
  product_type text not null
    check (product_type in ('mca','term_loan','line_of_credit',
                            'sba_loan','equipment_financing')),

  -- EVERY column below is nullable, and null means "inherit the base profile".
  -- That is the whole mechanism: a rule records differences, not a recipe.
  method                 text,
  to_email               text,
  cc_emails              text[],
  required_stips         text[],
  attach_docs            text[],
  max_statement_months   int,
  subject_template       text,
  body_template          text,
  portal_url             text,
  portal_steps           text[],
  active                 boolean,

  -- New rules this product dimension makes expressible for the first time.
  application_max_age_days int,     -- UCS term: signed within 30 days
  stips_deferred_to_closing text[], -- 1 West: DL + voided cheque at closing
  analyst_call_required    boolean,  -- GoKapital term

  -- Internal only. Never rendered into an outbound body — see commit 6e65dd5.
  internal_notes text,

  -- Provenance is not optional here. Every other funder table in this schema
  -- needed it eventually and got it late.
  source_note  text not null,
  confirmed_on date,
  confirmed_by text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lender_id, product_type)
);
```

---

## 5. The resolver, and the part that matters most

```sql
create or replace function resolve_submission_recipe(
  p_lender uuid,
  p_product text
)
returns table (
  method text, to_email text, cc_emails text[],
  required_stips text[], attach_docs text[],
  max_statement_months int,
  subject_template text, body_template text,
  portal_url text, portal_steps text[],
  active boolean,
  application_max_age_days int,
  stips_deferred_to_closing text[],
  analyst_call_required boolean,
  internal_notes text,
  -- ── the three-state answer ──
  rule_source text,        -- 'product' | 'base_fallback'
  rule_basis  text         -- the source_note, or why there isn't one
)
language sql stable as $$
  select
    coalesce(r.method,               b.method),
    coalesce(r.to_email,             b.to_email),
    coalesce(r.cc_emails,            b.cc_emails),
    coalesce(r.required_stips,       b.required_stips),
    coalesce(r.attach_docs,          b.attach_docs),
    coalesce(r.max_statement_months, b.max_statement_months),
    coalesce(r.subject_template,     b.subject_template),
    coalesce(r.body_template,        b.body_template),
    coalesce(r.portal_url,           b.portal_url),
    coalesce(r.portal_steps,         b.portal_steps),
    coalesce(r.active,               b.active),
    r.application_max_age_days,
    r.stips_deferred_to_closing,
    r.analyst_call_required,
    coalesce(r.internal_notes,       b.internal_notes),
    case when r.id is not null then 'product' else 'base_fallback' end,
    coalesce(
      r.source_note,
      'No ' || p_product || ' rule on file for this funder. '
        || 'These are the funder''s general submission details, which were '
        || 'authored for advances.'
    )
  from funder_submission_profiles b
  left join funder_submission_product_rules r
    on r.lender_id = b.lender_id
   and r.product_type = p_product
  where b.lender_id = p_lender;
$$;
```

**`rule_source` is the point of this whole document.** Today a term file
silently gets the MCA recipe. After this change it still gets *something* —
blocking every non-MCA submission until somebody authors 37 rules would stop the
business — but the preview must say, in words, which it got:

> ⚠ **No term-loan rule on file for United Capital Source.** This is their
> general submission profile, authored for advances. The stips listed below are
> the advance stips. Check them against the Term & LOC checklist before sending.

That is the house rule — *an empty read must never render as a confirmed one* —
applied to recipes. A missing product rule is a gap in what we hold, and it has
to look like one.

---

## 6. Where `product` comes from — the gap nobody has noticed

`resolve_submission_recipe` needs a product, and **we cannot currently supply
one.** `deals.deal_type` is the only product field, the enum carries `mca` and
`vcf`, and **every deal row in the database is `mca`.** There is nowhere to
record that a deal is a term loan.

Minimum addition:

```sql
alter table deals add column product_type text
  check (product_type in ('mca','term_loan','line_of_credit',
                          'sba_loan','equipment_financing'));
-- existing rows: leave NULL rather than backfilling 'mca' by assumption.
```

and in `submit-to-funders`:

```ts
// A deal with no product recorded is not an MCA — it is a deal whose product
// nobody set. Default to the advance recipe because that is what the data is,
// but make the preview say the product was never recorded.
const product = deal.product_type ?? "mca";
const productAssumed = deal.product_type == null;
```

The product picker belongs on the deal, next to the amount — and ideally it is
the same list the `/admin/products` shelf is built from, so choosing "Momentum
Term & Line of Credit" on a deal is what sets it.

---

## 7. The deeper duplication, named so it is not rediscovered

The submission checklist a closer actually follows lives in
`src/components/admin/products/lines.ts` — hand-written TypeScript, one array
per product line. The recipe the submit function follows lives in
`funder_submission_profiles` — hand-maintained rows. **These are two independent
descriptions of the same thing and nothing keeps them honest.** The checklist on
the Term tab currently says things the recipe cannot express, which is correct
today only because a human reads one and a machine reads the other.

The end state is that the checklist is *generated from* the resolved recipe,
with the teaching copy (`why` text) kept alongside the rule rather than in a
separate file. That is a bigger change than this document proposes and should
not be attempted in the same pass — but every rule added to the new table should
be written with it in mind.

---

## 8. Rollout

| Phase | What ships | Risk |
|---|---|---|
| 0 | Migrate `special_instructions` content → `internal_notes`; empty the old field | None — it is already never sent |
| 1 | Table + resolver + `rule_source` banner in the preview. No rules authored yet | None. Every funder resolves to `base_fallback` = today's behaviour exactly |
| 2 | `deals.product_type` + the picker | Low. Null means "not recorded", which the preview says |
| 3 | Author rules for the three Term & LOC funders, and GoKapital's four statement counts | None — additive |
| 4 | Admin UI: a product tab on the funder record | None |
| 5 | Generate the product-line checklist from the resolved recipe | Large. Separate decision |

Phase 1 is deployable on its own and changes nothing observable except that a
non-MCA submission starts telling the truth about which recipe it used.

---

Related: commit `6e65dd5` (the outbound leak), the
`readers-must-distinguish-unreadable` and `funder-record-update-pattern`
memories, and `/admin/products` → Term & LOC → open questions.
