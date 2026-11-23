import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { callArgs, called, fakeSupabaseClient } from "./support/fake-supabase.ts";
import { ClassroomRequestError, fakeBooking, fakeContext, installClassroomServerMock } from "./support/classroom-fixtures.ts";

const hooks = installClassroomServerMock();

let currentRateLimit = { allowed: true, retryAfterSeconds: 0 };
mock.module("@/lib/rate-limit", {
  namedExports: { checkRateLimit: async () => currentRateLimit },
});

const { GET, POST } = await import("../app/api/classrooms/[bookingId]/messages/route.ts");

function paramsFor(bookingId: string) {
  return { params: Promise.resolve({ bookingId }) };
}

test("an unauthorized request maps the thrown ClassroomRequestError to its status", async () => {
  hooks.authorizeClassroomRequest = async () => {
    throw new ClassroomRequestError(404, "This classroom is unavailable.");
  };
  const res = await GET(new Request("http://localhost/api/classrooms/b1/messages"), paramsFor("b1"));
  assert.equal(res.status, 404);
});

test("GET with no messages and no ?since marks file notifications read", async () => {
  let notificationsUpdated = false;
  hooks.authorizeClassroomRequest = async () => fakeContext({
    supabase: fakeSupabaseClient({
      tables: {
        classroom_messages: () => ({ data: [], error: null }),
        notifications: (calls) => {
          notificationsUpdated = called(calls, "update");
          return { data: null, error: null };
        },
      },
    }),
  });
  const res = await GET(new Request("http://localhost/api/classrooms/b1/messages"), paramsFor("b1"));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(body.messages, []);
  assert.equal(notificationsUpdated, true);
});

test("GET with ?since does not re-mark notifications read on every idle poll", async () => {
  let notificationsTouched = false;
  hooks.authorizeClassroomRequest = async () => fakeContext({
    supabase: fakeSupabaseClient({
      tables: {
        classroom_messages: () => ({ data: [], error: null }),
        notifications: () => {
          notificationsTouched = true;
          return { data: null, error: null };
        },
      },
    }),
  });
  const res = await GET(new Request("http://localhost/api/classrooms/b1/messages?since=2026-01-01T00:00:00Z"), paramsFor("b1"));
  assert.equal(res.status, 200);
  assert.equal(notificationsTouched, false);
});

test("GET resolves sender names onto returned messages", async () => {
  hooks.authorizeClassroomRequest = async () => fakeContext({
    booking: fakeBooking(),
    supabase: fakeSupabaseClient({
      tables: {
        classroom_messages: () => ({
          data: [{ id: "m1", classroom_id: "classroom-1", sender_id: "tutor-1", body: "hi", created_at: "2026-01-01T00:00:00Z", classroom_file_id: null }],
          error: null,
        }),
        notifications: () => ({ data: null, error: null }),
      },
    }),
  });
  const res = await GET(new Request("http://localhost/api/classrooms/b1/messages"), paramsFor("b1"));
  const body = await res.json();
  assert.equal(body.messages[0].senderName, "Tara Tutor");
});

test("POST is rate-limited before the body is even read", async () => {
  currentRateLimit = { allowed: false, retryAfterSeconds: 5 };
  try {
    hooks.authorizeClassroomRequest = async () => fakeContext({ supabase: fakeSupabaseClient({}) });
    const res = await POST(new Request("http://localhost/api/classrooms/b1/messages", { method: "POST" }), paramsFor("b1"));
    assert.equal(res.status, 429);
    assert.equal(res.headers.get("retry-after"), "5");
  } finally {
    currentRateLimit = { allowed: true, retryAfterSeconds: 0 };
  }
});

test("POST rejects an empty message", async () => {
  hooks.authorizeClassroomRequest = async () => fakeContext({ supabase: fakeSupabaseClient({}) });
  const res = await POST(new Request("http://localhost/api/classrooms/b1/messages", {
    method: "POST",
    body: JSON.stringify({ body: "   " }),
  }), paramsFor("b1"));
  assert.equal(res.status, 400);
});

test("POST rejects a message over 4000 characters", async () => {
  hooks.authorizeClassroomRequest = async () => fakeContext({ supabase: fakeSupabaseClient({}) });
  const res = await POST(new Request("http://localhost/api/classrooms/b1/messages", {
    method: "POST",
    body: JSON.stringify({ body: "x".repeat(4001) }),
  }), paramsFor("b1"));
  assert.equal(res.status, 400);
});

test("POST with a valid message inserts it and labels it with the sender's name", async () => {
  let insertArgs: unknown[] | undefined;
  hooks.authorizeClassroomRequest = async () => fakeContext({
    supabase: fakeSupabaseClient({
      tables: {
        classroom_messages: (calls) => {
          insertArgs = callArgs(calls, "insert");
          return { data: { id: "m2", classroom_id: "classroom-1", sender_id: "student-1", body: "hello", created_at: "2026-01-01T00:00:00Z", classroom_file_id: null }, error: null };
        },
      },
    }),
  });
  const res = await POST(new Request("http://localhost/api/classrooms/b1/messages", {
    method: "POST",
    body: JSON.stringify({ body: "hello" }),
  }), paramsFor("b1"));
  const body = await res.json();
  assert.equal(res.status, 201);
  assert.equal(body.message.senderName, "Sam Student");
  assert.ok(insertArgs);
  assert.equal((insertArgs![0] as { body: string }).body, "hello");
});
