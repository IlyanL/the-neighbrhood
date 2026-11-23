import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { called, fakeSupabaseClient } from "./support/fake-supabase.ts";
import { fakeBooking, fakeContext, installClassroomServerMock } from "./support/classroom-fixtures.ts";

const hooks = installClassroomServerMock();

let currentRateLimit = { allowed: true, retryAfterSeconds: 0 };
mock.module("@/lib/rate-limit", {
  namedExports: { checkRateLimit: async () => currentRateLimit },
});

mock.module("@/lib/classroom/config", {
  namedExports: { classroomProviderStatus: () => ({ livekit: true, liveblocks: true }) },
});

const { GET, POST } = await import("../app/api/classrooms/[bookingId]/route.ts");

function paramsFor(bookingId: string) {
  return { params: Promise.resolve({ bookingId }) };
}

function postRequest(body: unknown) {
  return new Request("http://localhost/api/classrooms/b1", { method: "POST", body: JSON.stringify(body) });
}

test("GET returns the classroom payload without provisioning a new classroom", async () => {
  let provisioned = false;
  hooks.authorizeClassroomRequest = async () => fakeContext({ supabase: fakeSupabaseClient({}) });
  hooks.ensureClassroom = async () => {
    provisioned = true;
    throw new Error("GET must not provision — it should call getClassroom");
  };
  const res = await GET(new Request("http://localhost/api/classrooms/b1"), paramsFor("b1"));
  assert.equal(res.status, 200);
  assert.equal(provisioned, false);
});

test("POST is rate-limited before touching the classroom", async () => {
  currentRateLimit = { allowed: false, retryAfterSeconds: 11 };
  try {
    hooks.authorizeClassroomRequest = async () => fakeContext({ supabase: fakeSupabaseClient({}) });
    const res = await POST(postRequest({ action: "provision" }), paramsFor("b1"));
    assert.equal(res.status, 429);
    assert.equal(res.headers.get("retry-after"), "11");
  } finally {
    currentRateLimit = { allowed: true, retryAfterSeconds: 0 };
  }
});

test("start outside the join window is rejected with 409", async () => {
  hooks.authorizeClassroomRequest = async () => fakeContext({ supabase: fakeSupabaseClient({}) });
  hooks.joinStateForContext = () => ({ canJoin: false, access: "interactive", opensAt: "", scheduledStart: "", scheduledEnd: "", isBeforeWindow: true, isLate: false });
  const res = await POST(postRequest({ action: "start" }), paramsFor("b1"));
  assert.equal(res.status, 409);
});

test("start records an audit event and flips a scheduled classroom to live", async () => {
  let classroomsUpdated = false;
  let auditInserted = false;
  hooks.authorizeClassroomRequest = async () => fakeContext({
    booking: fakeBooking({ status: "confirmed" }),
    supabase: fakeSupabaseClient({
      tables: {
        tutoring_classrooms: (calls) => {
          classroomsUpdated = called(calls, "update");
          return { data: null, error: null };
        },
        classroom_audit_events: () => {
          auditInserted = true;
          return { data: null, error: null };
        },
      },
    }),
  });
  hooks.joinStateForContext = () => ({ canJoin: true, access: "interactive", opensAt: "", scheduledStart: "", scheduledEnd: "", isBeforeWindow: false, isLate: false });
  hooks.ensureClassroom = async () => ({ id: "classroom-1", status: "scheduled" });
  const res = await POST(postRequest({ action: "start" }), paramsFor("b1"));
  assert.equal(res.status, 200);
  assert.equal(classroomsUpdated, true);
  assert.equal(auditInserted, true);
});

test("only the tutor can end the classroom", async () => {
  hooks.authorizeClassroomRequest = async () => fakeContext({ participantRole: "student", supabase: fakeSupabaseClient({}) });
  const res = await POST(postRequest({ action: "end" }), paramsFor("b1"));
  assert.equal(res.status, 403);
});

test("the tutor ending the classroom marks the booking completed and returns a summary URL", async () => {
  let bookingCompleted = false;
  hooks.authorizeClassroomRequest = async () => fakeContext({
    participantRole: "tutor",
    supabase: fakeSupabaseClient({
      tables: {
        tutoring_classrooms: () => ({ data: null, error: null }),
        bookings: (calls) => {
          bookingCompleted = called(calls, "update");
          return { data: null, error: null };
        },
        classroom_audit_events: () => ({ data: null, error: null }),
      },
    }),
  });
  hooks.ensureClassroom = async () => ({ id: "classroom-1", status: "live" });
  const res = await POST(postRequest({ action: "end" }), paramsFor("b1"));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(bookingCompleted, true);
  assert.match(body.summaryUrl, /\/classroom\/b1\/summary$/);
});

test("an unrecognized action is rejected", async () => {
  hooks.authorizeClassroomRequest = async () => fakeContext({ supabase: fakeSupabaseClient({}) });
  const res = await POST(postRequest({ action: "teleport" }), paramsFor("b1"));
  assert.equal(res.status, 400);
});
