// deno test supabase/functions/_shared/instantly.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import { classifyVerifyFailure, isVerdict } from "./instantly.ts";

Deno.test("verify refusals: 'No credits available' is UNAVAILABLE, not a rate limit", () => {
  // the exact live body seen 2026-11-16
  assertEquals(classifyVerifyFailure(403, "No credits available"), "unavailable");
  assertEquals(classifyVerifyFailure(403, "Forbidden"), "unavailable");
  assertEquals(classifyVerifyFailure(403, ""), "unavailable");
  assertEquals(classifyVerifyFailure(401, "Unauthorized"), "unavailable");
  assertEquals(classifyVerifyFailure(402, "Payment Required"), "unavailable");
  assertEquals(classifyVerifyFailure(429, "anything"), "rate_limited");
  assertEquals(classifyVerifyFailure(403, "Rate limit exceeded"), "rate_limited");
  assertEquals(classifyVerifyFailure(403, "Too many requests"), "rate_limited");
  assertEquals(classifyVerifyFailure(500, "oops"), null);
  assertEquals(classifyVerifyFailure(200, ""), null);
});

Deno.test("only a real verdict may be stored", () => {
  assert(isVerdict({ health: "verified", raw: "verified", catchAll: false }));
  assert(isVerdict({ health: "invalid", raw: "invalid", catchAll: false }));
  assert(!isVerdict({ health: "unknown", raw: null, catchAll: false, unavailable: true }));
  assert(!isVerdict({ health: "unknown", raw: null, catchAll: false, rateLimited: true }));
  assert(!isVerdict({ health: "unknown", raw: "pending", catchAll: false, error: "did not resolve" }));
});
