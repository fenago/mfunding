// merchantDocArrived tests — the chase-stop decision, BOTH DIRECTIONS.
//
// The one thing this file exists to pin down: an UNREADABLE doc checklist must
// not behave like an EMPTY one. The old code read deal_doc_requests with
// `const { data } = await …`, dropped `.error`, and fell through to `rows = []`.
// From a single failed read that produced two wrong answers at once — a merchant
// released from the bank chase on no evidence, and the opposite mistake on the
// non-bank side — and neither was distinguishable in the log.
//
// A check nobody has watched fail is not a check, so each assert below has a
// matching negative: the `not_asked` / `outstanding` cases must stay GREEN while
// the `satisfied` / `unknown` cases go RED (i.e. stop the chase). Invert any one
// expectation and this file fails — that is how you make it go red once.
//
// Run: deno test --allow-none supabase/functions/_shared/merchantDocArrived.test.ts
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type ChecklistRead,
  decideChaseStops,
  type DocRequestRow,
  shouldStopBankChase,
  shouldStopNonBankChase,
} from "./merchantDocArrived.ts";

const rows = (...r: DocRequestRow[]): ChecklistRead => ({ kind: "rows", rows: r });

/** The live shape, read 2026-11-01: every one of the 88 deals carries exactly
 *  these four requests, and all four sit at 'requested'. */
const LIVE_SHAPE: DocRequestRow[] = [
  { doc_type: "bank_statement", status: "requested", required: true },
  { doc_type: "id", status: "requested", required: true },
  { doc_type: "business_license", status: "requested", required: false },
  { doc_type: "voided_check", status: "requested", required: false },
];

const fulfil = (list: DocRequestRow[], docType: string): DocRequestRow[] =>
  list.map((r) => (r.doc_type === docType ? { ...r, status: "uploaded" } : r));

// ── THE DEFECT: an unreadable checklist is NOT an empty one ───────────────────

Deno.test("an UNREADABLE checklist is never reported as 'nothing was asked'", () => {
  const unreadable = decideChaseStops({
    checklist: { kind: "unreadable", error: "statement timeout" },
    docType: "bank_statement",
  });
  assertEquals(unreadable.bank, "unknown");
  assertEquals(unreadable.nonBank, "unknown");
  assert(unreadable.basis.includes("UNREADABLE"), "the trail must name the failed read");
  assert(unreadable.basis.includes("statement timeout"), "the trail must quote the error");

  // An actually-empty read is a different answer, and must stay different.
  const empty = decideChaseStops({ checklist: rows(), docType: "bank_statement" });
  assertEquals(empty.bank, "satisfied");
  assertEquals(empty.nonBank, "not_asked");
  assert(unreadable.bank !== empty.bank || unreadable.nonBank !== empty.nonBank);
});

Deno.test("an unreadable checklist still stops the BANK chase for a statement", () => {
  // Justification is the row we just wrote, not the read that failed.
  const d = decideChaseStops({
    checklist: { kind: "unreadable", error: "connection terminated" },
    docType: "bank_statement",
  });
  assert(shouldStopBankChase(d, "bank_statement"), "a statement landed — MCA 06 must stop");
  // …but a photo ID landing tells us nothing about the statements.
  const d2 = decideChaseStops({
    checklist: { kind: "unreadable", error: "connection terminated" },
    docType: "id",
  });
  assertFalse(shouldStopBankChase(d2, "id"), "an ID must not stop the bank-statement chase");
});

Deno.test("an unreadable checklist NEVER stops the non-bank chase", () => {
  for (const docType of ["id", "voided_check", "other", "bank_statement"]) {
    const d = decideChaseStops({ checklist: { kind: "unreadable", error: "boom" }, docType });
    assertFalse(
      shouldStopNonBankChase(d),
      `one ${docType} arriving says nothing about the OTHER required non-bank asks`,
    );
  }
});

Deno.test("no deal scoped is its own state, not an empty checklist", () => {
  const d = decideChaseStops({ checklist: { kind: "no_deal" }, docType: "bank_statement" });
  assertEquals(d.bank, "unknown");
  assertEquals(d.nonBank, "unknown");
  assert(d.basis.includes("NOT read"));
  assertFalse(shouldStopNonBankChase(d));
});

// ── The live shape: the logged-out lane's real path ───────────────────────────

Deno.test("the live 4-request shape leaves BOTH chases running before anything lands", () => {
  const d = decideChaseStops({ checklist: rows(...LIVE_SHAPE), docType: "bank_statement" });
  assertEquals(d.bank, "outstanding");
  assertEquals(d.nonBank, "outstanding");
  assertFalse(shouldStopBankChase(d, "bank_statement"), "nothing is in yet — keep chasing");
  assertFalse(shouldStopNonBankChase(d));
});

Deno.test("flipping the bank request stops MCA 06 and ONLY MCA 06", () => {
  // This is what the logged-out lane's checklist fulfilment buys: without the
  // flip the row stays 'requested' and the assert above shows the chase runs on.
  const d = decideChaseStops({
    checklist: rows(...fulfil(LIVE_SHAPE, "bank_statement")),
    docType: "bank_statement",
  });
  assertEquals(d.bank, "satisfied");
  assertEquals(d.nonBank, "outstanding", "the required photo ID is still outstanding");
  assert(shouldStopBankChase(d, "bank_statement"));
  assertFalse(shouldStopNonBankChase(d), "MCA 05 must keep running until the ID is in");
});

Deno.test("the required non-bank ask gates MCA 05, the optional ones do not", () => {
  // Only `id` is required=true among the non-bank rows; business_license and
  // voided_check are optional and must not hold the chase open.
  const d = decideChaseStops({ checklist: rows(...fulfil(LIVE_SHAPE, "id")), docType: "id" });
  assertEquals(d.nonBank, "satisfied");
  assert(shouldStopNonBankChase(d));
  assertEquals(d.bank, "outstanding", "the statements are still missing");
  assertFalse(shouldStopBankChase(d, "id"));
});

Deno.test("a 'rejected' request is still outstanding", () => {
  const d = decideChaseStops({
    checklist: rows({ doc_type: "bank_statement", status: "rejected", required: true }),
    docType: "bank_statement",
  });
  assertEquals(d.bank, "outstanding");
  assertFalse(shouldStopBankChase(d, "bank_statement"), "a rejected statement has not satisfied the ask");
});

Deno.test("under_review and approved both count as in", () => {
  for (const status of ["uploaded", "under_review", "approved"]) {
    const d = decideChaseStops({
      checklist: rows({ doc_type: "bank_statement", status, required: true }),
      docType: "bank_statement",
    });
    assertEquals(d.bank, "satisfied", `status ${status} must count as in`);
  }
});

Deno.test("nothing asked + a non-statement upload stops nothing", () => {
  const d = decideChaseStops({ checklist: rows(), docType: "id" });
  assertEquals(d.bank, "not_asked");
  assertEquals(d.nonBank, "not_asked");
  assertFalse(shouldStopBankChase(d, "id"));
  assertFalse(shouldStopNonBankChase(d));
});

Deno.test("a required=null non-bank row does not gate MCA 05", () => {
  // `required` is nullable in the table; the rule is required === true.
  const d = decideChaseStops({
    checklist: rows({ doc_type: "id", status: "requested", required: null }),
    docType: "bank_statement",
  });
  assertEquals(d.nonBank, "not_asked");
});
