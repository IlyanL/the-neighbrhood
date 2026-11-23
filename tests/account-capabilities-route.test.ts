import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { fakeSupabaseClient } from "./support/fake-supabase.ts";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fake-project.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "fake-anon-key";
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

let currentClient: unknown = null;
mock.module("@supabase/supabase-js", {
  namedExports: { createClient: () => currentClient },
});

// Mocked directly rather than exercised through the real limiter — see the note in
// auth-signup-route.test.ts about lib/rate-limit.ts caching its client at module scope.
let currentRateLimit = { allowed: true, retryAfterSeconds: 0 };
mock.module("@/lib/rate-limit", {
  namedExports: { checkRateLimit: async () => currentRateLimit },
});

const { GET } = await import("../app/api/account-capabilities/route.ts");

const VERIFIED_USER = { id: "u1", email: "student@uwo.ca", email_confirmed_at: "2026-01-01T00:00:00Z" };

test("no Authorization header is rejected", async () => {
  const res = await GET(new Request("http://localhost/api/account-capabilities"));
  assert.equal(res.status, 401);
});

test("an unverified email is rejected", async () => {
  currentClient = fakeSupabaseClient({
    authUser: { ...VERIFIED_USER, email_confirmed_at: null },
  });
  const res = await GET(new Request("http://localhost/api/account-capabilities", { headers: { authorization: "Bearer x" } }));
  assert.equal(res.status, 403);
});

test("rate limited before any capability lookup runs", async () => {
  currentRateLimit = { allowed: false, retryAfterSeconds: 15 };
  try {
    currentClient = fakeSupabaseClient({ authUser: VERIFIED_USER });
    const res = await GET(new Request("http://localhost/api/account-capabilities", { headers: { authorization: "Bearer x" } }));
    assert.equal(res.status, 429);
    assert.equal(res.headers.get("Retry-After"), "15");
  } finally {
    currentRateLimit = { allowed: true, retryAfterSeconds: 0 };
  }
});

test("an approved, verified tutor gets tutor-management capabilities derived from the real rules", async () => {
  currentClient = fakeSupabaseClient({
    authUser: VERIFIED_USER,
    tables: {
      profiles: () => ({ data: { role: "student" }, error: null }),
      tutor_profiles: () => ({ data: { application_status: "accepted", is_verified: true }, error: null }),
    },
  });
  const res = await GET(new Request("http://localhost/api/account-capabilities", { headers: { authorization: "Bearer x" } }));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.capabilities.isApprovedTutor, true);
  assert.equal(body.capabilities.canManageTutorProfile, true);
  assert.equal(body.capabilities.tutorState, "approved");
});

test("a plain student with no tutor application cannot manage a tutor profile", async () => {
  currentClient = fakeSupabaseClient({
    authUser: VERIFIED_USER,
    tables: {
      profiles: () => ({ data: { role: "student" }, error: null }),
      tutor_profiles: () => ({ data: null, error: null }),
    },
  });
  const res = await GET(new Request("http://localhost/api/account-capabilities", { headers: { authorization: "Bearer x" } }));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.capabilities.isApprovedTutor, false);
  assert.equal(body.capabilities.canManageTutorProfile, false);
  assert.equal(body.capabilities.canApplyToTutor, true);
  assert.equal(body.capabilities.tutorState, "none");
});
