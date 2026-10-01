// ─────────────────────────────────────────────────────────────────────────────
// Which products a funder does — ONE definition, read by every surface.
//
// ⚠ BEFORE YOU MIRROR THIS INTO `functions/_shared/`: `ProductId` is NOT the
// same list as `underwrite-deal`'s KNOWN_PRODUCTS, and merging them is the one
// mistake this file invites.
//
//   ProductId (here) ................... 9 — what a FUNDER CAN OFFER
//   KNOWN_PRODUCTS (underwrite-deal) ... 7 — what the MODEL MAY CLAIM of a deal
//   lender_programs.product_type CHECK . the same 7
//
// The two extra are `consumer` and `startup_robs_401k`. They are legitimate
// funder products and must stay here; they are NOT legitimate product signals,
// because no `lender_programs` row can ever carry them. Widen KNOWN_PRODUCTS to
// these 9 and the failure half-works, which is the worst kind: the matcher reads
// `category.products` off the lender row, which CAN contain them, so a
// `consumer` signal would score funders and match no program. It would render,
// look right, and be wrong where nobody checks.
//
// So: share the canonical ids, the labels and the DB-enum aliases below. Leave
// the model-shorthand aliases (`loc`, `factoring`, `real_estate`) and the
// whitelist next to the prompt that produces them — they are a property of that
// prompt's vocabulary, not of the schema. A product addition then touches both
// files; a prompt-wording change touches one.
//
// The catalog answers this question in two columns that were populated by
// different processes and never reconciled, and they disagree in BOTH
// directions:
//
//   product        in category only   in lender_types only   both
//   term_loan            49                    3               8
//   line_of_credit       31                    3              16
//   sba_loan             23                    1               6
//   mca                   3                   10              90
//
// `category->'products'` is the richer column, but it is NOT a superset — seven
// lenders have no `products` key at all, one of them a live vendor (Value
// Capital Funding, the debt-relief referral). Reading either column alone
// silently drops live funders, and a funder missing from a cheat sheet is
// invisible by nature: nobody questions the row that isn't there.
//
// So: UNION the two. The union can only ever add a funder to a product, never
// remove one, which is the property that makes this safe to adopt everywhere.
//
// Vocabulary is `category->'products'` spelling (`sba_loan`,
// `equipment_financing`), because that also matches `deals.products_interested`
// and the `lender_programs.product_type` CHECK. The `lender_types` enum spells
// several of them differently and folds three separate values into MCA — that
// mapping lives here and NOWHERE else. It previously existed twice (this file
// and LenderCatalogPage's own PRODUCTS array); a third copy is how the
// lead-source dropdown drifted from SOURCE_MAP and rendered 76% of the book
// blank.
// ─────────────────────────────────────────────────────────────────────────────

export type ProductId =
  | "mca"
  | "term_loan"
  | "line_of_credit"
  | "sba_loan"
  | "equipment_financing"
  | "invoice_factoring"
  | "real_estate_cre"
  | "consumer"
  | "startup_robs_401k";

export const PRODUCT_LABEL: Record<ProductId, string> = {
  mca: "MCA",
  term_loan: "Term loan",
  line_of_credit: "Line of credit",
  sba_loan: "SBA loan",
  equipment_financing: "Equipment financing",
  invoice_factoring: "Invoice factoring",
  real_estate_cre: "Real estate / CRE",
  consumer: "Consumer",
  startup_robs_401k: "Startup / ROBS 401k",
};

// Compact labels for dense table cells (the Funder Guide products column). Same
// keys, same single definition — a caller that wants short text must not write
// its own map, which is how `productLabels` in funderGuideService ended up a
// third union with a fourth label vocabulary.
export const PRODUCT_LABEL_SHORT: Record<ProductId, string> = {
  mca: "MCA",
  term_loan: "Term",
  line_of_credit: "LOC",
  sba_loan: "SBA",
  equipment_financing: "Equipment",
  invoice_factoring: "Factoring",
  real_estate_cre: "CRE",
  consumer: "Consumer",
  startup_robs_401k: "Startup/ROBS",
};

// `lender_types` enum value → canonical product. MCA absorbs revenue_based and
// working_capital: all three are purchases of future receivables and none of
// them is ever called a loan. `other` maps to nothing on purpose.
const TYPE_ALIAS: Record<string, ProductId> = {
  mca: "mca",
  revenue_based: "mca",
  working_capital: "mca",
  term_loan: "term_loan",
  line_of_credit: "line_of_credit",
  sba: "sba_loan",
  sba_loan: "sba_loan",
  equipment: "equipment_financing",
  equipment_financing: "equipment_financing",
  invoice_factoring: "invoice_factoring",
  real_estate_cre: "real_estate_cre",
  cre: "real_estate_cre",
  consumer: "consumer",
  startup: "startup_robs_401k",
  startup_robs_401k: "startup_robs_401k",
};

export type ProductSource = { lender_types?: string[] | null; category?: { products?: unknown } | null };

const canon = (raw: unknown): ProductId | null => {
  const k = String(raw ?? "")
    .toLowerCase()
    .trim();
  return k === "" ? null : (TYPE_ALIAS[k] ?? null);
};

/**
 * Every product a funder is recorded as doing — the union of `lender_types` and
 * `category->'products'`, in canonical spelling. Shape-checked rather than
 * trusted: `category` is jsonb and `products` has been seen absent, empty, and
 * (in older rows) not an array.
 */
export function productsOf(l: ProductSource): ProductId[] {
  const out = new Set<ProductId>();
  for (const t of Array.isArray(l.lender_types) ? l.lender_types : []) {
    const p = canon(t);
    if (p) out.add(p);
  }
  const fromCategory = l.category?.products;
  for (const t of Array.isArray(fromCategory) ? fromCategory : []) {
    const p = canon(t);
    if (p) out.add(p);
  }
  return [...out];
}

export const hasProduct = (l: ProductSource, p: ProductId): boolean => productsOf(l).includes(p);
export const hasAnyProduct = (l: ProductSource, ps: ProductId[]): boolean => {
  const mine = productsOf(l);
  return ps.some((p) => mine.includes(p));
};

// The columns a caller must SELECT for productsOf() to be able to answer. A
// caller that forgets one gets a silently narrower answer, so it's spelled once.
export const PRODUCT_SOURCE_COLUMNS = "lender_types, category";
