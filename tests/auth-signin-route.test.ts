import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { fakeSupabaseClient } from "./support/fake-supabase.ts";
import { installReportMock } from "./support/report-fixture.ts";

installReportMock();

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fake-project.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "fake-anon-key";

let currentClient: unknown = null;
mock.module("@supabase/supabase-js", {
  namedExports: { createClient: () => currentClient },
});

// Mocked directly rather than exercised through the real limiter's fake-Supabase RPC path —
// lib/rate-limit.ts caches its own client at module scope on first call, so the first test to
// reach it would otherwise fix the fake for every test after it. Same pattern already used by
// auth-reset-password-route.test.ts.
let currentRateLimit = { allowed: true, retryAfterSeconds: 0 };
mock.module("@/lib/rate-limit", {
  namedExports: { checkRateLimit: async () => currentRateLimit },
});

const { POST } = await import("../app/api/auth/signin/route.ts");

function post(body: unknown) {
  return new Request("http://localhost/api/auth/signin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("a correct password returns the session and user, unwrapped", async () => {
  currentClient = fakeSupabaseClient({
    signInWithPassword: async ({ email, password }) => {
      assert.equal(email, "student@uwo.ca");
      assert.equal(password, "correct horse battery staple");
      return {
        data: {
          session: { access_token: "at-1", refresh_token: "rt-1" },
          user: { id: "user-1", email_confirmed_at: "2026-01-01T00:00:00Z" },
        },
        error: null,
      };
    },
  });
  const res = await POST(post({ email: " Student@UWO.CA ", password: "correct horse battery staple" }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    session: { access_token: "at-1", refresh_token: "rt-1" },
    user: { id: "user-1", email_confirmed_at: "2026-01-01T00:00:00Z" },
  });
});

test("a wrong password gets a generic message, not Supabase's own error text", async () => {
  currentClient = fakeSupabaseClient({
    signInWithPassword: async () => ({ data: { session: null, user: null }, error: { message: "Invalid login credentials" } }),
  });
  const res = await POST(post({ email: "student@uwo.ca", password: "wrong" }));
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: "That email or password didn't work. Try again, or use Forgot password." });
});

test("an address outside @uwo.ca never reaches Supabase", async () => {
  currentClient = fakeSupabaseClient({}); // would throw if the route called signInWithPassword
  const res = await POST(post({ email: "student@gmail.com", password: "whatever12" }));
  assert.equal(res.status, 400);
});

test("a missing password is a 400, not a call to Supabase", async () => {
  currentClient = fakeSupabaseClient({});
  const res = await POST(post({ email: "student@uwo.ca" }));
  assert.equal(res.status, 400);
});

test("a malformed body is a 400, not a 500", async () => {
  currentClient = fakeSupabaseClient({});
  const res = await POST(new Request("http://localhost/api/auth/signin", { method: "POST", body: "not json" }));
  assert.equal(res.status, 400);
});

test("per-account lockout returns 429 with Retry-After before Supabase ever sees the password", async () => {
  currentRateLimit = { allowed: false, retryAfterSeconds: 240 };
  try {
    currentClient = fakeSupabaseClient({}); // would throw if the route called signInWithPassword
    const res = await POST(post({ email: "student@uwo.ca", password: "even the correct one" }));
    assert.equal(res.status, 429);
    assert.equal(res.headers.get("Retry-After"), "240");
  } finally {
    currentRateLimit = { allowed: true, retryAfterSeconds: 0 };
  }
});
