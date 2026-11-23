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

const { GET, PATCH } = await import("../app/api/admin/course-reports/route.ts");

const ADMIN_USER = { id: "admin-1", email: "admin@uwo.ca", email_confirmed_at: "2026-01-01T00:00:00Z" };
const url = "http://localhost/api/admin/course-reports";

test("a non-admin cannot list reported course messages", async () => {
  currentClient = fakeSupabaseClient({
    authUser: ADMIN_USER,
    tables: {
      profiles: () => ({ data: { role: "student" }, error: null }),
      security_events: () => ({ data: null, error: null }),
    },
  });
  const res = await GET(new Request(url, { headers: { authorization: "Bearer x" } }));
  assert.equal(res.status, 403);
});

test("PATCH rejects a decision that isn't one of the allowed statuses", async () => {
  currentClient = fakeSupabaseClient({
    authUser: ADMIN_USER,
    tables: { profiles: () => ({ data: { role: "admin" }, error: null }) },
  });
  const res = await PATCH(new Request(url, {
    method: "PATCH",
    headers: { authorization: "Bearer x" },
    body: JSON.stringify({ id: "r1", status: "ignored" }),
  }));
  assert.equal(res.status, 400);
});

test("resolving a report without hideMessage leaves both the post and the reply visible", async () => {
  let touchedDiscussions = false;
  let touchedComments = false;
  currentClient = fakeSupabaseClient({
    authUser: ADMIN_USER,
    tables: {
      profiles: () => ({ data: { role: "admin" }, error: null }),
      course_discussion_reports: () => ({ data: { discussion_id: "d1", comment_id: null }, error: null }),
      course_discussions: () => { touchedDiscussions = true; return { data: null, error: null }; },
      course_discussion_comments: () => { touchedComments = true; return { data: null, error: null }; },
      security_events: () => ({ data: null, error: null }),
    },
  });
  const res = await PATCH(new Request(url, {
    method: "PATCH",
    headers: { authorization: "Bearer x" },
    body: JSON.stringify({ id: "r1", status: "resolved" }),
  }));
  assert.equal(res.status, 200);
  assert.equal(touchedDiscussions, false);
  assert.equal(touchedComments, false);
});

test("hiding a report against the opening post takes the whole discussion down", async () => {
  let discussionUpdateArgs: unknown[] | undefined;
  currentClient = fakeSupabaseClient({
    authUser: ADMIN_USER,
    tables: {
      profiles: () => ({ data: { role: "admin" }, error: null }),
      course_discussion_reports: () => ({ data: { discussion_id: "d1", comment_id: null }, error: null }),
      course_discussions: (calls) => {
        discussionUpdateArgs = callArgs(calls, "update");
        return { data: null, error: null };
      },
      security_events: () => ({ data: null, error: null }),
    },
  });
  const res = await PATCH(new Request(url, {
    method: "PATCH",
    headers: { authorization: "Bearer x" },
    body: JSON.stringify({ id: "r1", status: "resolved", hideMessage: true }),
  }));
  assert.equal(res.status, 200);
  assert.deepEqual(discussionUpdateArgs, [{ is_visible: false }]);
});

test("hiding a report against a reply hides only that comment", async () => {
  let commentUpdateArgs: unknown[] | undefined;
  let touchedDiscussions = false;
  currentClient = fakeSupabaseClient({
    authUser: ADMIN_USER,
    tables: {
      profiles: () => ({ data: { role: "admin" }, error: null }),
      course_discussion_reports: () => ({ data: { discussion_id: "d1", comment_id: "c1" }, error: null }),
      course_discussion_comments: (calls) => {
        commentUpdateArgs = callArgs(calls, "update");
        return { data: null, error: null };
      },
      course_discussions: () => { touchedDiscussions = true; return { data: null, error: null }; },
      security_events: () => ({ data: null, error: null }),
    },
  });
  const res = await PATCH(new Request(url, {
    method: "PATCH",
    headers: { authorization: "Bearer x" },
    body: JSON.stringify({ id: "r1", status: "resolved", hideMessage: true }),
  }));
  assert.equal(res.status, 200);
  assert.deepEqual(commentUpdateArgs, [{ is_visible: false }]);
  assert.equal(touchedDiscussions, false);
});
