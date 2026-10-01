// Regression tests for the deterministic padding policy.
// The fixtures are the REAL padding_deposits arrays persisted by underwrite-deal on
// deal MF-2026-0442 (Spirit Drilling Fluids), deal_underwriting v10 and v5.
import { tallyPadding } from "./paddingPolicy.ts";

// Local assert — this is the repo's first Deno test and there is no deno.json /
// import map, so an external assertion library would be the only inline-specifier
// dependency in _shared. Not worth it for one comparison.
function assertEquals(actual: unknown, expected: unknown, msg?: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg ? msg + ": " : ""}expected ${e}, got ${a}`);
}

// v10, May 2026 — the run that caused the incident. The $40,000 online transfer is
// listed TWICE, once as internal_transfer and once as round_number (the second
// entry's desc being the model's own commentary, not a statement descriptor).
// May's deposits were $81,051.23; the raw sum of this array is $98,770.19.
const v10May = [
  { date: "05/15", desc: "Online Transfer From Personal Line of Credit Spirit Loan", amount: 40000, category: "internal_transfer" },
  { date: "05/15", desc: "Round-number $40,000 transfer in", amount: 40000, category: "round_number" },
  { date: "05/14", desc: "United Healthcar Hist Rtn 260514 - returned ACH debit credited back", amount: 16028.01, category: "reversal" },
  { date: "05/13", desc: "Online Transfer Ref #Ib0Y38B9Lb From BusinessLine Line of Credit Cover Ally Pmt 5/13/26", amount: 1800, category: "internal_transfer" },
  { date: "05/27", desc: "Intuit Financing Hist Rtn 260527 - returned debit credited back", amount: 942.18, category: "reversal" },
];

Deno.test("the duplicate (date, amount) entry is collapsed, not double-subtracted", () => {
  const t = tallyPadding(v10May);
  assertEquals(t.duplicatesCollapsed, 1);
  assertEquals(t.duplicateDollars, 40000);
});

Deno.test("the collapsed entry keeps the MECHANICAL category over the judged one", () => {
  const t = tallyPadding(v10May);
  // internal_transfer (keyed on "Online Transfer From") outranks round_number.
  assertEquals(t.deductedByCategory["internal_transfer"], 41800);
  assertEquals(t.flaggedByCategory["round_number"], undefined);
});

Deno.test("padding no longer exceeds the month's deposits — the incident cannot recur", () => {
  const MAY_DEPOSITS = 81051.23;
  const rawSum = v10May.reduce((s, p) => s + p.amount, 0);
  // What the old code did: summed the array as-is and blew past the deposits.
  assertEquals(Math.round(rawSum * 100) / 100, 98770.19);
  assertEquals(rawSum > MAY_DEPOSITS, true);
  // What it does now.
  const t = tallyPadding(v10May);
  assertEquals(t.deducted, 58770.19);
  assertEquals(t.deducted < MAY_DEPOSITS, true);
});

Deno.test("round_number is reported but never deducted", () => {
  const t = tallyPadding([
    { date: "07/14", desc: "WT Fed#00102 American National /Org=Oil and Gas Pro Consulting Serv", amount: 24000, category: "round_number" },
    { date: "07/22", desc: "FC Marketplace L Hist Rtn 260722 Ekue33194051", amount: 1975.35, category: "reversal" },
  ]);
  // The $24,000 customer wire that one run stripped out of a drilling-fluids
  // company's revenue must not move a dollar.
  assertEquals(t.deducted, 1975.35);
  assertEquals(t.flaggedOnly, 24000);
  assertEquals(t.deductedItemCount, 1);
});

Deno.test("two equal amounts on DIFFERENT dates are two credits, not a duplicate", () => {
  // The real recurring $1,975.35 FC Marketplace return, in two different months.
  const t = tallyPadding([
    { date: "07/22", desc: "FC Marketplace L Hist Rtn 260722", amount: 1975.35, category: "reversal" },
    { date: "08/21", desc: "FC Marketplace L Hist Rtn 260821", amount: 1975.35, category: "reversal" },
  ]);
  assertEquals(t.duplicatesCollapsed, 0);
  assertEquals(t.deducted, 3950.7);
});

Deno.test("UNDATED equal amounts are kept apart (a wrong merge would UNDER-state padding)", () => {
  const t = tallyPadding([
    { desc: "Zelle in", amount: 500, category: "zelle" },
    { desc: "Zelle in", amount: 500, category: "zelle" },
  ]);
  assertEquals(t.duplicatesCollapsed, 0);
  assertEquals(t.deducted, 1000);
});

Deno.test("zero and negative amounts are ignored, not counted as padding", () => {
  const t = tallyPadding([
    { date: "05/01", desc: "x", amount: 0, category: "reversal" },
    { date: "05/02", desc: "y", amount: undefined, category: "reversal" },
  ]);
  assertEquals(t.deducted, 0);
  assertEquals(t.deductedItemCount, 0);
});

Deno.test("an unknown/missing category still deducts (it is not silently dropped)", () => {
  const t = tallyPadding([{ date: "05/01", desc: "x", amount: 250 }]);
  assertEquals(t.deducted, 250);
  assertEquals(t.deductedByCategory["uncategorized"], 250);
});
