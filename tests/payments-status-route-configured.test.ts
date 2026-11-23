import assert from "node:assert/strict";
import test, { mock } from "node:test";

process.env.STRIPE_SECRET_KEY = "sk_test_fake";

mock.module("@/lib/rate-limit", {
  namedExports: { checkRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }) },
});

const { GET } = await import("../app/api/payments/status/route.ts");

test("reports configured when STRIPE_SECRET_KEY is set", async () => {
  const res = await GET(new Request("http://localhost/api/payments/status"));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.configured, true);
});
