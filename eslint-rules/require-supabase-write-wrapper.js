/**
 * require-supabase-write-wrapper
 *
 * Flags any Supabase table write — `.from(table).insert|update|upsert|delete(...)`
 * — that is NOT passed through the loud-by-default wrappers (mustWrite/tryWrite
 * in src/supabase/writes.ts). supabase-js returns errors instead of throwing and
 * an RLS-blocked UPDATE/DELETE returns "success, 0 rows", so unwrapped writes
 * fail invisibly. This rule makes the loud path the default.
 */
"use strict";

const WRITE_METHODS = new Set(["insert", "update", "upsert", "delete"]);
const WRAPPERS = new Set(["mustWrite", "tryWrite"]);

module.exports = {
  meta: {
    type: "problem",
    docs: { description: "Supabase writes must go through mustWrite()/tryWrite()" },
    schema: [],
    messages: {
      wrap:
        "Supabase .{{method}}() must be wrapped in mustWrite() or tryWrite() " +
        "(src/supabase/writes.ts) — a bare write swallows RLS/constraint failures.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        // Must be a `.insert|update|upsert|delete(...)` member call.
        if (callee.type !== "MemberExpression" || callee.property.type !== "Identifier") return;
        const method = callee.property.name;
        if (!WRITE_METHODS.has(method)) return;
        // ...called directly on a `.from(...)` result (that's how every supabase
        // table write is shaped; storage uses .upload/.remove, so it won't match).
        const obj = callee.object;
        const onFrom =
          obj.type === "CallExpression" &&
          obj.callee.type === "MemberExpression" &&
          obj.callee.property.type === "Identifier" &&
          obj.callee.property.name === "from";
        if (!onFrom) return;
        // OK if any ancestor is a call to a wrapper (the builder is its argument).
        for (let a = node.parent; a; a = a.parent) {
          if (
            a.type === "CallExpression" &&
            a.callee.type === "Identifier" &&
            WRAPPERS.has(a.callee.name)
          ) {
            return;
          }
        }
        context.report({ node, messageId: "wrap", data: { method } });
      },
    };
  },
};
