import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { fakeSupabaseClient } from "./support/fake-supabase.ts";
import { installReportMock } from "./support/report-fixture.ts";
import { installTurnstileMock } from "./support/turnstile-fixture.ts";

installReportMock();
const turnstile = installTurnstileMock();

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fake-project.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role-key";
process.env.NEXT_PUBLIC_SITE_URL = "https://neighbrhood.example";
delete process.env.VERCEL_URL;
delete process.env.VERCEL_PROJECT_PRODUCTION_URL;

let currentClient: unknown = null;
mock.module("@supabase/supabase-js", {
  namedExports: { createClient: () => currentClient },
});

// Mocked directly rather than exercised through the real limiter's fake-Supabase RPC path:
// lib/rate-limit.ts caches its own client at module scope on first call, so the first test to
// reach it would otherwise fix the fake for every test after it (see the note in
// auth-signup-route.test.ts). Same pattern already used by liveblocks-auth-route.test.ts.
let currentRateLimit = { allowed: true, retryAfterSeconds: 0 };
mock.module("@/lib/rate-limit", {
  namedExports: { checkRateLimit: async () => currentRateLimit },
});

const { POST } = await import("../app/api/auth/reset-password/route.ts");

function post(body: unknown) {
  return new Request("http://localhost/api/auth/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("refuses a request that fails the Turnstile bot check, before touching Supabase", async () => {
  currentClient = fakeSupabaseClient({}); // would throw if the route called resetPasswordForEmail
  turnstile.result = { ok: false, status: 400, error: "Complete the verification challenge and try again." };
  try {
    const res = await POST(post({ email: "student@uwo.ca", turnstileToken: "bad" }));
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "Complete the verification challenge and try again." });
  } finally {
    turnstile.result = { ok: true };
  }
});

test("an address with no account gets exactly the same reply as one that exists", async () => {
  currentClient = fakeSupabaseClient({ resetPasswordForEmail: async () => ({ error: { message: "User not found" } }) });
  const res = await POST(post({ email: "stranger@uwo.ca" }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test("a real address gets the identical reply", async () => {
  currentClient = fakeSupabaseClient({ resetPasswordForEmail: async () => ({ error: null }) });
  const res = await POST(post({ email: "student@uwo.ca" }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test("the email is normalized and the redirect points back at /auth before reaching Supabase", async () => {
  let seenEmail = "";
  let seenParams: Record<string, unknown> = {};
  currentClient = fakeSupabaseClient({
    resetPasswordForEmail: async (email, params) => {
      seenEmail = email;
      seenParams = params;
      return { error: null };
    },
  });
  await POST(post({ email: " Student@UWO.CA " }));
  assert.equal(seenEmail, "student@uwo.ca");
  assert.equal(seenParams.redirectTo, "https://neighbrhood.example/auth");
});

test("an empty or missing email is answered the same way without ever touching Supabase", async () => {
  // No resetPasswordForEmail handler registered — the fake throws if the route calls it.
  currentClient = fakeSupabaseClient({});
  const res = await POST(post({}));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test("a malformed body is a 400, not a 500", async () => {
  currentClient = fakeSupabaseClient({});
  const res = await POST(new Request("http://localhost/api/auth/reset-password", { method: "POST", body: "not json" }));
  assert.equal(res.status, 400);
});

test("rate limiting returns 429 with a Retry-After header rather than reaching Supabase", async () => {
  currentRateLimit = { allowed: false, retryAfterSeconds: 90 };
  try {
    currentClient = fakeSupabaseClient({}); // would throw if the route called resetPasswordForEmail
    const res = await POST(post({ email: "student@uwo.ca" }));
    assert.equal(res.status, 429);
    assert.equal(res.headers.get("Retry-After"), "90");
  } finally {
    currentRateLimit = { allowed: true, retryAfterSeconds: 0 };
  }
});
