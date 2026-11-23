import assert from "node:assert/strict";
import test, { mock } from "node:test";

// No NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY set in this process, so
// lib/notifications/server.ts's adminClient() returns null — the real local-dev path. This is
// a separate file from notifications-route-configured.test.ts because that module reads its
// env vars into a const once, at first import, and `node --test` isolates env state per file
// by running each as its own process.

mock.module("@/lib/rate-limit", {
  namedExports: {
    checkRateLimit: async () => {
      throw new Error("the rate limiter should never be reached when adminClient() is unconfigured");
    },
  },
});

const { POST } = await import("../app/api/notifications/route.ts");

test("an unconfigured server skips sending rather than erroring, and never reaches auth or rate limiting", async () => {
  const res = await POST(new Request("http://localhost/api/notifications", {
    method: "POST",
    body: JSON.stringify({ kind: "booking_requested", bookingId: "b1" }),
  }));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.emailStatus, "skipped");
});
