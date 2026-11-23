import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { fakeSupabaseClient } from "./support/fake-supabase.ts";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fake-project.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role-key";
process.env.CRON_SECRET = "the-real-cron-secret";

let currentClient: unknown = null;
mock.module("@supabase/supabase-js", {
  namedExports: { createClient: () => currentClient },
});

let syncCatalogsCalls = 0;
let syncClubsCalls = 0;
const courseBatchCalls: Array<{ offset?: number; limit?: number }> = [];

mock.module("@/lib/catalog-sync", {
  namedExports: {
    syncWesternCatalogs: async () => {
      syncCatalogsCalls += 1;
      return { clubs: { seen: 1, written: 1 }, courses: { seen: 1, written: 1, nextOffset: null } };
    },
    syncWesternClubs: async () => {
      syncClubsCalls += 1;
      return { seen: 2, written: 2 };
    },
    syncWesternCourseBatch: async (_client: unknown, options: { offset?: number; limit?: number }) => {
      courseBatchCalls.push(options);
      return { seen: 3, written: 3, processedSubjects: 1, totalSubjects: 5, nextOffset: 1 };
    },
  },
});

const { GET, POST } = await import("../app/api/catalog-sync/route.ts");

const ADMIN_USER = { id: "admin-1", email: "admin@uwo.ca", email_confirmed_at: "2026-01-01T00:00:00Z" };

test("GET (the cron entry point) without the cron secret is rejected", async () => {
  const res = await GET(new Request("http://localhost/api/catalog-sync"));
  assert.equal(res.status, 403);
});

test("GET with the correct cron secret runs the full sync", async () => {
  currentClient = fakeSupabaseClient({});
  const before = syncCatalogsCalls;
  const res = await GET(new Request("http://localhost/api/catalog-sync", {
    headers: { authorization: "Bearer the-real-cron-secret" },
  }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(syncCatalogsCalls, before + 1);
});

test("GET with an incorrect cron secret is rejected, not silently truncated-compared", async () => {
  const res = await GET(new Request("http://localhost/api/catalog-sync", {
    headers: { authorization: "Bearer the-real-cron-secret-but-longer" },
  }));
  assert.equal(res.status, 403);
});

test("POST with neither a valid session nor the cron secret is rejected", async () => {
  currentClient = fakeSupabaseClient({
    authUser: null,
  });
  const res = await POST(new Request("http://localhost/api/catalog-sync", {
    method: "POST",
    headers: { authorization: "Bearer not-the-secret-and-not-a-session" },
  }));
  assert.equal(res.status, 403);
});

test("POST from a non-admin session is rejected", async () => {
  currentClient = fakeSupabaseClient({
    authUser: ADMIN_USER,
    tables: { profiles: () => ({ data: { role: "student" }, error: null }) },
  });
  const res = await POST(new Request("http://localhost/api/catalog-sync", {
    method: "POST",
    headers: { authorization: "Bearer session-token" },
  }));
  assert.equal(res.status, 403);
});

test("POST from an admin session runs the sync", async () => {
  currentClient = fakeSupabaseClient({
    authUser: ADMIN_USER,
    tables: { profiles: () => ({ data: { role: "admin" }, error: null }) },
  });
  const before = syncCatalogsCalls;
  const res = await POST(new Request("http://localhost/api/catalog-sync", {
    method: "POST",
    headers: { authorization: "Bearer session-token" },
  }));
  assert.equal(res.status, 200);
  assert.equal(syncCatalogsCalls, before + 1);
});

test("?catalog=clubs dispatches to syncWesternClubs only", async () => {
  currentClient = fakeSupabaseClient({});
  const before = syncClubsCalls;
  const res = await GET(new Request("http://localhost/api/catalog-sync?catalog=clubs", {
    headers: { authorization: "Bearer the-real-cron-secret" },
  }));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(syncClubsCalls, before + 1);
  assert.deepEqual(body.clubs, { seen: 2, written: 2 });
});

test("?catalog=courses dispatches to syncWesternCourseBatch with the requested offset", async () => {
  currentClient = fakeSupabaseClient({});
  courseBatchCalls.length = 0;
  const res = await GET(new Request("http://localhost/api/catalog-sync?catalog=courses&offset=40", {
    headers: { authorization: "Bearer the-real-cron-secret" },
  }));
  assert.equal(res.status, 200);
  assert.equal(courseBatchCalls.length, 1);
  assert.equal(courseBatchCalls[0].offset, 40);
});
