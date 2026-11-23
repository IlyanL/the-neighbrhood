import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { fakeSupabaseClient } from "./support/fake-supabase.ts";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fake-project.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "fake-anon-key";

let currentClient: unknown = null;
mock.module("@supabase/supabase-js", {
  namedExports: { createClient: () => currentClient },
});

let currentRateLimit = { allowed: true, retryAfterSeconds: 0 };
mock.module("@/lib/rate-limit", {
  namedExports: { checkRateLimit: async () => currentRateLimit },
});

const { POST } = await import("../app/api/tutors/documents/route.ts");

const VERIFIED_USER = { id: "tutor-1", email: "tutor@uwo.ca", email_confirmed_at: "2026-01-01T00:00:00Z" };

function uploadRequest(opts: { headers?: Record<string, string>; body?: BodyInit } = {}) {
  return new Request("http://localhost/api/tutors/documents", {
    method: "POST",
    headers: { authorization: "Bearer x", ...opts.headers },
    body: opts.body,
  });
}

test("no Authorization header is rejected before any Supabase call", async () => {
  const res = await POST(new Request("http://localhost/api/tutors/documents", { method: "POST" }));
  assert.equal(res.status, 401);
});

test("a declared Content-Length above every upload kind's cap is rejected before formData is read", async () => {
  currentClient = fakeSupabaseClient({ authUser: VERIFIED_USER });
  const form = new FormData();
  form.set("kind", "resume");
  form.set("file", new File(["x"], "resume.pdf", { type: "application/pdf" }));
  // The real cap is 10 MB (the larger of the photo/document limits) — declare more than that.
  const res = await POST(uploadRequest({ headers: { "content-length": String(11 * 1024 * 1024) }, body: form }));
  assert.equal(res.status, 413);
});

test("a request within the size cap but missing a file is a 400, not a crash", async () => {
  currentClient = fakeSupabaseClient({ authUser: VERIFIED_USER });
  const form = new FormData();
  form.set("kind", "resume");
  const res = await POST(uploadRequest({ body: form }));
  assert.equal(res.status, 400);
});

test("rate limited before formData is ever read", async () => {
  currentRateLimit = { allowed: false, retryAfterSeconds: 60 };
  try {
    currentClient = fakeSupabaseClient({ authUser: VERIFIED_USER });
    const res = await POST(uploadRequest({ headers: { "content-length": String(500 * 1024 * 1024) } }));
    assert.equal(res.status, 429);
  } finally {
    currentRateLimit = { allowed: true, retryAfterSeconds: 0 };
  }
});
