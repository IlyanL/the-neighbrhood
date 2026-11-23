import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { callArgs, fakeSupabaseClient } from "./support/fake-supabase.ts";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fake-project.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "fake-anon-key";
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

let currentClient: unknown = null;
mock.module("@supabase/supabase-js", {
  namedExports: { createClient: () => currentClient },
});

const { GET, PATCH } = await import("../app/api/admin/housing/route.ts");

const ADMIN_USER = { id: "admin-1", email: "admin@uwo.ca", email_confirmed_at: "2026-01-01T00:00:00Z" };

test("no token is rejected before any query runs", async () => {
  const res = await GET(new Request("http://localhost/api/admin/housing"));
  assert.equal(res.status, 403);
});

test("a non-admin is rejected even with a valid session", async () => {
  currentClient = fakeSupabaseClient({
    authUser: ADMIN_USER,
    tables: {
      profiles: () => ({ data: { role: "student" }, error: null }),
      security_events: () => ({ data: null, error: null }),
    },
  });
  const res = await GET(new Request("http://localhost/api/admin/housing", { headers: { authorization: "Bearer x" } }));
  assert.equal(res.status, 403);
});

test("an admin gets the listing list", async () => {
  currentClient = fakeSupabaseClient({
    authUser: ADMIN_USER,
    tables: {
      profiles: () => ({ data: { role: "admin" }, error: null }),
      housing_listings: () => ({ data: [{ id: "l1", title: "Room near campus" }], error: null }),
    },
  });
  const res = await GET(new Request("http://localhost/api/admin/housing", { headers: { authorization: "Bearer x" } }));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(body.listings, [{ id: "l1", title: "Room near campus" }]);
});

test("PATCH rejects a non-admin before reading the body", async () => {
  currentClient = fakeSupabaseClient({
    authUser: ADMIN_USER,
    tables: {
      profiles: () => ({ data: { role: "student" }, error: null }),
      security_events: () => ({ data: null, error: null }),
    },
  });
  const res = await PATCH(new Request("http://localhost/api/admin/housing", {
    method: "PATCH",
    headers: { authorization: "Bearer x" },
    body: JSON.stringify({ id: "l1", status: "removed" }),
  }));
  assert.equal(res.status, 403);
});

test("PATCH rejects an invalid moderation status", async () => {
  currentClient = fakeSupabaseClient({
    authUser: ADMIN_USER,
    tables: { profiles: () => ({ data: { role: "admin" }, error: null }) },
  });
  const res = await PATCH(new Request("http://localhost/api/admin/housing", {
    method: "PATCH",
    headers: { authorization: "Bearer x" },
    body: JSON.stringify({ id: "l1", status: "on-fire" }),
  }));
  assert.equal(res.status, 400);
});

test("PATCH with a valid decision updates the listing's moderation_status", async () => {
  let updateArgs: unknown[] | undefined;
  currentClient = fakeSupabaseClient({
    authUser: ADMIN_USER,
    tables: {
      profiles: () => ({ data: { role: "admin" }, error: null }),
      housing_listings: (calls) => {
        updateArgs = callArgs(calls, "update");
        return { data: null, error: null };
      },
      security_events: () => ({ data: null, error: null }),
    },
  });
  const res = await PATCH(new Request("http://localhost/api/admin/housing", {
    method: "PATCH",
    headers: { authorization: "Bearer x" },
    body: JSON.stringify({ id: "l1", status: "removed" }),
  }));
  assert.equal(res.status, 200);
  assert.deepEqual(updateArgs, [{ moderation_status: "removed" }]);
});
