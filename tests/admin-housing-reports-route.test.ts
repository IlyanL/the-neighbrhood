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

const { GET, PATCH } = await import("../app/api/admin/housing-reports/route.ts");

const ADMIN_USER = { id: "admin-1", email: "admin@uwo.ca", email_confirmed_at: "2026-01-01T00:00:00Z" };

test("a non-admin cannot list reports", async () => {
  currentClient = fakeSupabaseClient({
    authUser: ADMIN_USER,
    tables: {
      profiles: () => ({ data: { role: "student" }, error: null }),
      security_events: () => ({ data: null, error: null }),
    },
  });
  const res = await GET(new Request("http://localhost/api/admin/housing-reports", { headers: { authorization: "Bearer x" } }));
  assert.equal(res.status, 403);
});

test("PATCH rejects a decision that isn't one of the allowed statuses", async () => {
  currentClient = fakeSupabaseClient({
    authUser: ADMIN_USER,
    tables: { profiles: () => ({ data: { role: "admin" }, error: null }) },
  });
  const res = await PATCH(new Request("http://localhost/api/admin/housing-reports", {
    method: "PATCH",
    headers: { authorization: "Bearer x" },
    body: JSON.stringify({ id: "r1", status: "ignored" }),
  }));
  assert.equal(res.status, 400);
});

test("resolving a report without removeListing never touches housing_listings", async () => {
  let touchedListings = false;
  currentClient = fakeSupabaseClient({
    authUser: ADMIN_USER,
    tables: {
      profiles: () => ({ data: { role: "admin" }, error: null }),
      housing_reports: () => ({ data: { listing_id: "l1" }, error: null }),
      housing_listings: () => {
        touchedListings = true;
        return { data: null, error: null };
      },
      security_events: () => ({ data: null, error: null }),
    },
  });
  const res = await PATCH(new Request("http://localhost/api/admin/housing-reports", {
    method: "PATCH",
    headers: { authorization: "Bearer x" },
    body: JSON.stringify({ id: "r1", status: "resolved" }),
  }));
  assert.equal(res.status, 200);
  assert.equal(touchedListings, false);
});

test("resolving a report with removeListing marks the linked listing removed", async () => {
  let listingUpdateArgs: unknown[] | undefined;
  currentClient = fakeSupabaseClient({
    authUser: ADMIN_USER,
    tables: {
      profiles: () => ({ data: { role: "admin" }, error: null }),
      housing_reports: () => ({ data: { listing_id: "l1" }, error: null }),
      housing_listings: (calls) => {
        listingUpdateArgs = callArgs(calls, "update");
        return { data: null, error: null };
      },
      security_events: () => ({ data: null, error: null }),
    },
  });
  const res = await PATCH(new Request("http://localhost/api/admin/housing-reports", {
    method: "PATCH",
    headers: { authorization: "Bearer x" },
    body: JSON.stringify({ id: "r1", status: "resolved", removeListing: true }),
  }));
  assert.equal(res.status, 200);
  assert.deepEqual(listingUpdateArgs, [{ moderation_status: "removed" }]);
});
