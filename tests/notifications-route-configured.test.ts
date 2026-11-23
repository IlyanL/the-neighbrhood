import assert from "node:assert/strict";
import test, { mock } from "node:test";

// Separate file from notifications-route.test.ts: lib/notifications/server.ts's adminClient()
// reads its env vars into a module-level const once, at first import, so "configured" has to
// be a process-level fact. `node --test` runs each file as its own process.
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fake-project.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role-key";

type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

let currentAuthUser: { id: string } | null = { id: "student-1" };
let burstResult: RateLimitResult = { allowed: true, retryAfterSeconds: 0 };
let dailyResult: RateLimitResult = { allowed: true, retryAfterSeconds: 0 };

mock.module("@supabase/supabase-js", {
  namedExports: {
    createClient: () => ({
      auth: {
        getUser: async () => (currentAuthUser
          ? { data: { user: currentAuthUser }, error: null }
          : { data: { user: null }, error: { message: "invalid" } }),
      },
    }),
  },
});

mock.module("@/lib/rate-limit", {
  namedExports: {
    checkRateLimit: async (key: string) => (key.startsWith("notify:burst:") ? burstResult : dailyResult),
  },
});

const { POST } = await import("../app/api/notifications/route.ts");

function postRequest(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/notifications", {
    method: "POST",
    headers,
    body: JSON.stringify({ kind: "booking_requested", bookingId: "b1" }),
  });
}

test("no Authorization header is rejected", async () => {
  const res = await POST(postRequest());
  assert.equal(res.status, 401);
});

test("a session Supabase doesn't recognize is rejected", async () => {
  currentAuthUser = null;
  try {
    const res = await POST(postRequest({ authorization: "Bearer x" }));
    assert.equal(res.status, 401);
  } finally {
    currentAuthUser = { id: "student-1" };
  }
});

test("the burst limit returns 429 with Retry-After", async () => {
  burstResult = { allowed: false, retryAfterSeconds: 9 };
  try {
    const res = await POST(postRequest({ authorization: "Bearer x" }));
    assert.equal(res.status, 429);
    assert.equal(res.headers.get("retry-after"), "9");
    const body = await res.json();
    assert.match(body.error, /Too many notifications/);
  } finally {
    burstResult = { allowed: true, retryAfterSeconds: 0 };
  }
});

test("the daily limit returns 429 with Retry-After, distinct from the burst limit", async () => {
  dailyResult = { allowed: false, retryAfterSeconds: 3600 };
  try {
    const res = await POST(postRequest({ authorization: "Bearer x" }));
    assert.equal(res.status, 429);
    assert.equal(res.headers.get("retry-after"), "3600");
    const body = await res.json();
    assert.match(body.error, /Daily notification limit/);
  } finally {
    dailyResult = { allowed: true, retryAfterSeconds: 0 };
  }
});
