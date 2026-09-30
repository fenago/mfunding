/**
 * no-bare-masked-deal-field
 *
 * THE DEFECT
 *
 * `deal_row_for_caller` does not OMIT the money columns for a staff reader who
 * is not ops-staff, the creator or the assigned closer — it writes JSON **null**
 * over all eighteen. So `deal.amount_requested` is `null` for two completely
 * different reasons and the property cannot tell you which:
 *
 *   • the merchant never named an amount            → the answer IS nothing
 *   • the money wall withheld it from THIS reader   → you are not allowed to know
 *
 * And the ordinary defensive idioms make it worse rather than better, which is
 * the part that keeps catching people out:
 *
 *   deal.x ?? 0   -> 0        `??` FIRES on null — this is the damage, not a guard
 *   deal.x || 0   -> 0        ditto
 *   Number(deal.x) -> 0
 *   deal.x === undefined -> false    undefined checks sail straight through
 *   'x' in deal   -> true     presence checks pass
 *
 * `src/lib/maskedDeal.ts` exists so a consumer can tell the two apart:
 * `dealField()` / `dealFieldOf()` return `value | withheld` with no third arm.
 *
 * WHY THIS RULE ONLY FIRES IN MIGRATED FILES
 *
 * It flags a bare access ONLY in a file that already imports from
 * `@/lib/maskedDeal`. That is deliberate. A rule that flagged every existing
 * call site on day one would be downgraded to `warn` within the hour and become
 * furniture — which is how the sibling rule `no-absence-from-failed-read` nearly
 * went. Importing the accessor is the opt-in: once a file is migrated it is
 * protected, including against a SECOND field someone forgets to migrate, and
 * the clean set grows one file at a time instead of starting as noise.
 *
 * Reading these fields is still legitimate in plenty of places — a list page
 * querying `deals` directly is row-filtered by RLS, not field-masked, so its
 * nulls are real. Those files simply never import the accessor and are never
 * flagged.
 */
"use strict";

// Mirrors public.deal_money_keys(). The SERVER is the source of truth; this copy
// only decides what to lint. If they drift, the worst case is a missed warning,
// never a false claim in the product.
const MASKED_KEYS = new Set([
  "ai_lender_recommendations",
  "ai_recommended_at",
  "amount_funded",
  "amount_requested",
  "balance_override",
  "expected_value",
  "lead_grade",
  "lead_qual",
  "lead_score",
  "mca_score",
  "payback_amount",
  "paydown_percentage",
  "remittance_amount",
  "score_reasons",
  "score_version",
  "scored_at",
  "vcf_daily_debit",
  "vcf_total_balance",
]);

// Object names that hold a DEAL row.
//
// ⚠️ PRECISION OVER RECALL, ON PURPOSE. This rule is `error`, so one false
// positive blocks a build and gets the whole rule deleted — a rule that cries
// wolf is worse than no rule. The first draft included `row`, `d`, `found` and
// `detail`, and it immediately fired three times on `row.amount_requested` in
// QuickAppModal, where `row` is the **mca_applications patch being built**, not
// a deal. Those columns share a name and nothing else.
//
// So: only names that unambiguously mean a deal. `deal.amount_requested` inside
// a `.map((d) => …)` is NOT caught, and that is the accepted trade — a missed
// warning costs a follow-up, a false error costs the rule.
const DEAL_ISH = /^(deal|dealObj|dealForFunders|theDeal)$/;

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "In files that use the masked-field accessor, read the money columns through dealField()/dealFieldOf() — a bare property cannot tell a withheld null from a real one",
    },
    schema: [],
    messages: {
      bare:
        "`{{object}}.{{field}}` cannot tell a WITHHELD null from a real one — the money wall nulls this column for a reader who isn't assigned the deal, and `?? 0` fires on it. Use dealFieldOf({{object}}, \"{{field}}\") and handle `kind: \"withheld\"` (render a dash, don't compute). See src/lib/maskedDeal.ts.",
    },
  },

  create(context) {
    let usesAccessor = false;

    return {
      ImportDeclaration(node) {
        const src = String(node.source.value || "");
        if (src.endsWith("lib/maskedDeal") || src.endsWith("/maskedDeal")) usesAccessor = true;
      },

      MemberExpression(node) {
        if (!usesAccessor) return;                      // unmigrated file — stay silent
        if (node.computed) return;                      // deal[key] — can't resolve statically
        if (!node.property || node.property.type !== "Identifier") return;
        if (!MASKED_KEYS.has(node.property.name)) return;
        if (node.object.type !== "Identifier") return;  // only simple `x.field`
        if (!DEAL_ISH.test(node.object.name)) return;

        // Inside an object literal being BUILT (e.g. a patch or a payload), the
        // same identifier is a key, not a read. Keys are Property nodes, which
        // never reach here, so nothing extra is needed — noted so the next
        // person doesn't add a check that isn't required.
        context.report({
          node,
          messageId: "bare",
          data: { object: node.object.name, field: node.property.name },
        });
      },
    };
  },
};
