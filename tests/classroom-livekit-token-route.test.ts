import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { fakeSupabaseClient } from "./support/fake-supabase.ts";
import { fakeBooking, fakeContext, installClassroomServerMock } from "./support/classroom-fixtures.ts";

const hooks = installClassroomServerMock();

let currentRateLimit = { allowed: true, retryAfterSeconds: 0 };
mock.module("@/lib/rate-limit", {
  namedExports: { checkRateLimit: async () => currentRateLimit },
});

process.env.LIVEKIT_URL = "wss://fake.livekit.cloud";
process.env.LIVEKIT_API_KEY = "fake-key";
process.env.LIVEKIT_API_SECRET = "fake-secret";

const { POST } = await import("../app/api/classrooms/[bookingId]/livekit-token/route.ts");

function paramsFor(bookingId: string) {
  return { params: Promise.resolve({ bookingId }) };
}

test("rate-limited before checking the join window", async () => {
  currentRateLimit = { allowed: false, retryAfterSeconds: 4 };
  try {
    hooks.authorizeClassroomRequest = async () => fakeContext({ supabase: fakeSupabaseClient({}) });
    const res = await POST(new Request("http://localhost/api/classrooms/b1/livekit-token", { method: "POST" }), paramsFor("b1"));
    assert.equal(res.status, 429);
  } finally {
    currentRateLimit = { allowed: true, retryAfterSeconds: 0 };
  }
});

test("outside the join window, no token is issued", async () => {
  hooks.authorizeClassroomRequest = async () => fakeContext({ supabase: fakeSupabaseClient({}) });
  hooks.joinStateForContext = () => ({ canJoin: false, access: "interactive", opensAt: "", scheduledStart: "", scheduledEnd: "", isBeforeWindow: true, isLate: false });
  const res = await POST(new Request("http://localhost/api/classrooms/b1/livekit-token", { method: "POST" }), paramsFor("b1"));
  assert.equal(res.status, 409);
});

test("a non-confirmed booking is not open for live entry even if canJoin is somehow true", async () => {
  hooks.authorizeClassroomRequest = async () => fakeContext({
    booking: fakeBooking({ status: "completed" }),
    supabase: fakeSupabaseClient({}),
  });
  const res = await POST(new Request("http://localhost/api/classrooms/b1/livekit-token", { method: "POST" }), paramsFor("b1"));
  assert.equal(res.status, 409);
});

test("within the join window, a real signed token is issued for the classroom's room", async () => {
  hooks.authorizeClassroomRequest = async () => fakeContext({ supabase: fakeSupabaseClient({}) });
  hooks.ensureClassroom = async () => ({ id: "classroom-1", livekit_room_name: "the-room" });
  const res = await POST(new Request("http://localhost/api/classrooms/b1/livekit-token", { method: "POST" }), paramsFor("b1"));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.url, "wss://fake.livekit.cloud");
  assert.equal(typeof body.token, "string");
  // A LiveKit access token is a JWT: three base64url segments.
  assert.match(body.token, /^[\w-]+\.[\w-]+\.[\w-]+$/);
});
