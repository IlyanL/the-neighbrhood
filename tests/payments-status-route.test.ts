import assert from "node:assert/strict";
import test, { mock } from "node:test";

// lib/stripe/client.ts reads STRIPE_SECRET_KEY into a module-level const at import time, so
// "configured" has to be a process-level fact — see payments-status-route-configured.test.ts
// for that case. `node --test` runs each file as its own process.
delete process.env.STRIPE_SECRET_KEY;

// Mocked directly rather than exercised through the real limiter — see the note in
// auth-signup-route.test.ts about lib/rate-limit.ts caching its client at module scope.
let currentRateLimit = { allowed: true, retryAfterSeconds: 0 };
mock.module("@/lib/rate-limit", {
  namedExports: { checkRateLimit: async () => currentRateLimit },
});

const { GET } = await import("../app/api/payments/status/route.ts");

function statusRequest() {
  return new Request("http://localhost/api/payments/status");
}

test("reports unconfigured when STRIPE_SECRET_KEY is not set", async () => {
  const res = await GET(statusRequest());
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.configured, false);
});

test("rate limited clients get a 429 instead of a config answer", async () => {
  currentRateLimit = { allowed: false, retryAfterSeconds: 10 };
  try {
    const res = await GET(statusRequest());
    assert.equal(res.status, 429);
    assert.equal(res.headers.get("Retry-After"), "10");
  } finally {
    currentRateLimit = { allowed: true, retryAfterSeconds: 0 };
  }
});
