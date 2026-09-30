/**
 * no-absence-from-failed-read
 *
 * THE DEFECT CLASS THIS EXISTS TO CATCH
 *
 * A read fails, and the UI renders the failure as a fact about a person.
 * Six incidents in one week, all the same bug wearing different clothes:
 *
 *   "No documents on file yet — chase the bank statements"   (the read failed;
 *                                                             he'd sent two)
 *   "no submission address recorded"                (the setter's role can't
 *                                                    read that table)
 *   44 merchants shown "nothing to sign"            (a limit=20 over 268 docs)
 *   "nothing submitted yet" + a live Send button    (a failed submissions read;
 *                                                    would have double-sent)
 *   "2 backward stage moves — clean"                (queried a column nobody
 *                                                    writes; the answer was 28)
 *
 * The shape is always the same: a read's `error` is never looked at, and the
 * `data` it did not return is coalesced into an empty value that then renders
 * as a statement about what a merchant, a setter or a funder did or did not do.
 *
 *     const { data } = await supabase.from("deals").select("*");
 *     setDeals(data ?? []);          // ← a failed read is now "no deals"
 *
 * WHAT IT FLAGS (deliberately narrow — see "WHAT IT DOES NOT FLAG")
 *
 *   1. `errorDiscarded` — destructuring a Supabase read WITHOUT binding `error`,
 *      or binding it and never referencing it. The read cannot fail loudly
 *      because nothing in the function can tell that it did.
 *
 *   2. `emptyIsNotZero` — coalescing (`??`, `||`) one of THOSE unchecked
 *      bindings into `[]`, `0`, `{}`, `""` or `false`. This is the line where
 *      the failure stops being a failure and becomes a fact.
 *
 * WHAT IT DOES NOT FLAG, ON PURPOSE
 *
 * `?? []` and `?? 0` appear ~1,200 times in src/ and nearly all of them are
 * arithmetic on values already known to be loaded (`(d.amount ?? 0) * 0.08`).
 * Flagging those would bury the ~dozen that are accusations. So the rule only
 * fires on a value traced back to a read whose error nobody looked at. Handle
 * the error — `if (error) return { state: "unreadable", why: error.message }`
 * — and the coalesce below it stops being a lie, and stops being reported.
 *
 * The honest rendering is always THREE states: loaded / genuinely empty /
 * couldn't read. See src/lib/readable.ts and the memory
 * `readers-must-distinguish-unreadable`.
 */
"use strict";

// A member call anywhere in the callee chain that marks this as a READ of
// external state: PostgREST tables/views, RPCs and edge functions.
const READ_ROOTS = new Set(["from", "rpc", "invoke"]);

// The bindings a Supabase read hands back that can be mistaken for an answer.
// `error` is the one that tells them apart, which is why it is not in here.
const PAYLOAD_KEYS = new Set(["data", "count"]);

// Right-hand sides that turn "we don't know" into "there is none".
const EMPTY_LITERALS = new Set(["[]", "0", "{}", '""', "''", "``", "false"]);

/** Is this CallExpression part of a `.from(…)` / `.rpc(…)` / `.invoke(…)` chain? */
function isReadChain(node) {
  for (let n = node; n; ) {
    if (n.type === "CallExpression") {
      const c = n.callee;
      if (
        c.type === "MemberExpression" &&
        c.property.type === "Identifier" &&
        READ_ROOTS.has(c.property.name)
      ) {
        return true;
      }
      n = c.type === "MemberExpression" ? c.object : null;
    } else if (n.type === "MemberExpression") {
      n = n.object;
    } else if (n.type === "AwaitExpression" || n.type === "TSNonNullExpression") {
      n = n.argument ?? n.expression;
    } else {
      return false;
    }
  }
  return false;
}

/** The identifier a member/optional-chain expression is rooted at, or null. */
function rootIdentifier(node) {
  for (let n = node; n; ) {
    switch (n.type) {
      case "Identifier":
        return n.name;
      case "MemberExpression":
      case "OptionalMemberExpression":
        n = n.object;
        break;
      case "ChainExpression":
        n = n.expression;
        break;
      case "TSNonNullExpression":
      case "TSAsExpression":
        n = n.expression;
        break;
      case "CallExpression":
      case "OptionalCallExpression":
        n = n.callee;
        break;
      default:
        return null;
    }
  }
  return null;
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "An empty read is not a zero — a read whose error is discarded must not be coalesced into an empty value",
    },
    schema: [],
    messages: {
      errorDiscarded:
        "This read's `error` is {{how}}, so a failure here is indistinguishable from an empty result. " +
        "An empty read is not a zero. Distinguish unreadable from empty — see readers-must-distinguish-unreadable.",
      emptyIsNotZero:
        "`{{name}}` comes from a read whose error nobody checked, so `{{op}} {{empty}}` renders a FAILED read as a fact " +
        "(\"no documents\", \"never dialled\", \"nothing submitted\"). An empty read is not a zero. " +
        "Distinguish unreadable from empty — see readers-must-distinguish-unreadable.",
    },
  },

  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();

    // Bindings destructured out of a read whose error went unexamined, keyed by
    // the Variable object so shadowing in another scope can't cross-contaminate.
    const tainted = new Map(); // Variable -> { name }
    const pendingCoalesce = []; // { node, name, op, empty, variable }

    /** Resolve an identifier name to its Variable from the scope at `node`. */
    function resolve(node, name) {
      let scope = sourceCode.getScope ? sourceCode.getScope(node) : context.getScope();
      for (; scope; scope = scope.upper) {
        const v = scope.variables.find((x) => x.name === name);
        if (v) return v;
      }
      return null;
    }

    return {
      VariableDeclarator(node) {
        if (node.id.type !== "ObjectPattern" || !node.init) return;
        if (!isReadChain(node.init)) return;

        let errorProp = null;
        const payloadProps = [];
        for (const p of node.id.properties) {
          if (p.type !== "Property" || p.key.type !== "Identifier") continue;
          if (p.key.name === "error") errorProp = p;
          else if (PAYLOAD_KEYS.has(p.key.name) && p.value.type === "Identifier") {
            payloadProps.push(p.value);
          }
        }
        // Nothing was taken from the read that could be mistaken for an answer.
        if (payloadProps.length === 0) return;

        let how = null;
        if (!errorProp) {
          how = "never destructured";
        } else if (errorProp.value.type === "Identifier") {
          const scope = sourceCode.getScope ? sourceCode.getScope(node) : context.getScope();
          const v = scope.variables.find((x) => x.name === errorProp.value.name);
          // `references` includes the write from the destructure itself.
          const reads = v ? v.references.filter((r) => r.isRead()) : [];
          if (reads.length === 0) how = "bound but never read";
        }
        if (!how) return;

        context.report({ node: node.id, messageId: "errorDiscarded", data: { how } });
        for (const ident of payloadProps) {
          const v = resolve(ident, ident.name);
          if (v) tainted.set(v, { name: ident.name });
        }
      },

      LogicalExpression(node) {
        if (node.operator !== "??" && node.operator !== "||") return;
        const empty = sourceCode.getText(node.right).replace(/\s+/g, "");
        if (!EMPTY_LITERALS.has(empty)) return;
        const name = rootIdentifier(node.left);
        if (!name) return;
        const variable = resolve(node.left, name);
        if (!variable) return;
        pendingCoalesce.push({ node, name, op: node.operator, empty, variable });
      },

      "Program:exit"() {
        for (const c of pendingCoalesce) {
          if (!tainted.has(c.variable)) continue;
          context.report({
            node: c.node,
            messageId: "emptyIsNotZero",
            data: { name: c.name, op: c.op, empty: c.empty },
          });
        }
      },
    };
  },
};
