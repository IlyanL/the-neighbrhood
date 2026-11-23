import assert from "node:assert/strict";
import test from "node:test";

// This file's process has no NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY set, so
// lib/rate-limit.ts's internal client never gets constructed and every call takes the
// "not configured" branch below. That is deliberately a real, unmocked code path — it is
// what local dev without a service role key actually hits. `node --test` runs each test
// file as its own process, so this doesn't affect other test files that do set these vars.
const { checkRateLimit } = await import("../lib/rate-limit.ts");

test("when unconfigured, every call is allowed rather than locking a developer out of their own app", async () => {
  const result = await checkRateLimit("some-key", 5, 60_000);
  assert.deepEqual(result, { allowed: true, retryAfterSeconds: 0 });
});

test("the unconfigured branch never talks to the network — repeated calls stay allowed", async () => {
  for (let i = 0; i < 10; i++) {
    const result = await checkRateLimit("burst-key", 1, 1000);
    assert.equal(result.allowed, true);
  }
});
