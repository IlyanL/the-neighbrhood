import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { fakeBooking, fakeClassroomRecord, fakeUser, installClassroomServerMock, STUDENT_ID } from "./support/classroom-fixtures.ts";

const hooks = installClassroomServerMock();

let currentRateLimit = { allowed: true, retryAfterSeconds: 0 };
mock.module("@/lib/rate-limit", {
  namedExports: { checkRateLimit: async () => currentRateLimit },
});

let upsertRoomCalls: Array<{ roomId: string; options: unknown }> = [];
const identifyUserCalls: Array<{ userId: string; options: unknown }> = [];
mock.module("@liveblocks/node", {
  namedExports: {
    Liveblocks: class {
      async upsertRoom(roomId: string, options: unknown) {
        upsertRoomCalls.push({ roomId, options });
        return {};
      }
      async identifyUser(userId: string, options: unknown) {
        identifyUserCalls.push({ userId, options });
        return { body: JSON.stringify({ token: "fake-liveblocks-token" }), status: 200 };
      }
    },
  },
});

process.env.LIVEBLOCKS_SECRET_KEY = "sk_fake_liveblocks_secret";

const { POST } = await import("../app/api/liveblocks-auth/route.ts");

// The route caches upsertRoom calls per classroom id + access signature (module-level Map, to
// skip redundant Liveblocks calls on reconnect) — distinct classroom ids per test sidestep
// that cache instead of relying on each test's access level happening to differ.
let classroomIdCounter = 0;
function roomContext(overrides: { readOnly?: boolean } = {}) {
  classroomIdCounter += 1;
  return {
    token: "tok",
    user: fakeUser(STUDENT_ID),
    supabase: {},
    booking: fakeBooking({ status: overrides.readOnly ? "completed" : "confirmed" }),
    participantRole: "student" as const,
    classroom: fakeClassroomRecord({ id: `classroom-${classroomIdCounter}`, status: overrides.readOnly ? "ended" : "live" }),
  };
}

test("a room with no body is rejected before authorizing", async () => {
  const res = await POST(new Request("http://localhost/api/liveblocks-auth", { method: "POST", body: JSON.stringify({}) }));
  assert.equal(res.status, 400);
});

test("rate-limited before touching Liveblocks", async () => {
  currentRateLimit = { allowed: false, retryAfterSeconds: 6 };
  try {
    hooks.authorizeClassroomRoom = async () => roomContext();
    upsertRoomCalls = [];
    const res = await POST(new Request("http://localhost/api/liveblocks-auth", { method: "POST", body: JSON.stringify({ room: "lb-room-1" }) }));
    assert.equal(res.status, 429);
    assert.equal(upsertRoomCalls.length, 0);
  } finally {
    currentRateLimit = { allowed: true, retryAfterSeconds: 0 };
  }
});

test("an active classroom grants write access to both participants", async () => {
  hooks.authorizeClassroomRoom = async () => roomContext();
  upsertRoomCalls = [];
  const res = await POST(new Request("http://localhost/api/liveblocks-auth", { method: "POST", body: JSON.stringify({ room: "lb-room-1" }) }));
  assert.equal(res.status, 200);
  assert.equal(upsertRoomCalls.length, 1);
  const usersAccesses = (upsertRoomCalls[0].options as { update: { usersAccesses: Record<string, string[]> } }).update.usersAccesses;
  assert.deepEqual(usersAccesses[fakeBooking().student_id], ["*:write"]);
  assert.deepEqual(usersAccesses[fakeBooking().tutor_id], ["*:write"]);
});

test("a completed/ended classroom grants read-only access instead", async () => {
  hooks.authorizeClassroomRoom = async () => roomContext({ readOnly: true });
  upsertRoomCalls = [];
  const res = await POST(new Request("http://localhost/api/liveblocks-auth", { method: "POST", body: JSON.stringify({ room: "lb-room-1" }) }));
  assert.equal(res.status, 200);
  const usersAccesses = (upsertRoomCalls[0].options as { update: { usersAccesses: Record<string, string[]> } }).update.usersAccesses;
  assert.deepEqual(usersAccesses[fakeBooking().student_id], ["*:read"]);
});
