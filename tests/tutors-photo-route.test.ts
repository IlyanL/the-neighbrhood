import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { fakeSupabaseClient } from "./support/fake-supabase.ts";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fake-project.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role-key";

let currentClient: unknown = null;
mock.module("@supabase/supabase-js", {
  namedExports: { createClient: () => currentClient },
});

const { GET } = await import("../app/api/tutors/[id]/photo/route.ts");

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

test("no tutor row (unaccepted/unverified/missing) returns 404, not a redirect", async () => {
  currentClient = fakeSupabaseClient({
    tables: { tutor_profiles: () => ({ data: null, error: null }) },
  });
  const res = await GET(new Request("http://localhost/api/tutors/t1/photo"), paramsFor("t1"));
  assert.equal(res.status, 404);
});

test("a photo_url pointing outside that tutor's own folder is rejected as an invalid path", async () => {
  currentClient = fakeSupabaseClient({
    tables: {
      tutor_profiles: () => ({
        data: { id: "t1", photo_url: "someone-else/photo/x.jpg", application_status: "accepted", is_verified: true },
        error: null,
      }),
    },
  });
  const res = await GET(new Request("http://localhost/api/tutors/t1/photo"), paramsFor("t1"));
  assert.equal(res.status, 404);
});

test("a valid same-tutor photo path resolves to a signed URL redirect", async () => {
  currentClient = fakeSupabaseClient({
    tables: {
      tutor_profiles: () => ({
        data: { id: "t1", photo_url: "t1/photo/headshot.jpg", application_status: "accepted", is_verified: true },
        error: null,
      }),
    },
    storage: {
      "tutor-documents": {
        createSignedUrl: async (path) => {
          assert.equal(path, "t1/photo/headshot.jpg");
          return { data: { signedUrl: "https://signed.example/t1-headshot" }, error: null };
        },
      },
    },
  });
  const res = await GET(new Request("http://localhost/api/tutors/t1/photo"), paramsFor("t1"));
  assert.equal(res.status, 307);
  assert.equal(res.headers.get("location"), "https://signed.example/t1-headshot");
});
