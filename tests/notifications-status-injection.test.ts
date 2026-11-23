// #6: `status` on a booking_status_changed notification reaches the recipient as the SUBJECT
// LINE of an email sent from our own verified sending domain, and as notifications.title.
// It used to be taken from the request body with no validation, so any student on a booking
// could have arbitrary text delivered to their tutor as a transactional email from us.
//
// Own file, not notifications-route-configured.test.ts: reaching the booking branches needs
// @/lib/notifications/server mocked wholesale (the shared payments fixture does not export
// adminClient/getChatThread), and lib/notifications/server.ts reads its env into a
// module-level const at first import, so "configured" has to be a process-level fact.
// `node --test` runs each file as its own process.
import assert from "node:assert/strict";
import test, { mock } from "node:test";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fake-project.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role-key";

const STUDENT_ID = "student-1";
const TUTOR_ID = "tutor-1";

let bookingStatus = "cancelled";
const notifications: Array<{ title: string; body: string; eventKey: string }> = [];

mock.module("@supabase/supabase-js", {
  namedExports: { createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: STUDENT_ID } }, error: null }) } }) },
});

mock.module("@/lib/rate-limit", {
  namedExports: { checkRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }) },
});

mock.module("@/lib/notifications/server", {
  namedExports: {
    adminClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: STUDENT_ID } }, error: null }) } }),
    buildBookingIcs: async () => ({ content: "", method: "REQUEST", sequence: 0 }),
    createNotification: async (params: { title: string; body: string; eventKey: string }) => {
      notifications.push({ title: params.title, body: params.body, eventKey: params.eventKey });
      return "sent";
    },
    getBooking: async () => ({
      id: "booking-1",
      student_id: STUDENT_ID,
      tutor_id: TUTOR_ID,
      course_code: "CS 1027",
      requested_start: new Date(Date.now() + 86_400_000).toISOString(),
      delivery_mode: "Online",
      status: bookingStatus,
      topic: null,
      payment_status: "paid",
      updated_at: "2026-09-10T00:00:00.000Z",
    }),
    getChatThread: async () => null,
    getProfile: async (userId: string) => ({
      id: userId,
      full_name: userId === STUDENT_ID ? "A Student" : "A Tutor",
      email: `${userId}@uwo.ca`,
      role: "student",
    }),
  },
});

const { POST } = await import("../app/api/notifications/route.ts");

function statusChange(status: unknown) {
  notifications.length = 0;
  return POST(new Request("http://localhost/api/notifications", {
    method: "POST",
    headers: { authorization: "Bearer x" },
    body: JSON.stringify({ kind: "booking_status_changed", bookingId: "booking-1", status }),
  }));
}

test("an attacker-supplied status never reaches the email subject", async () => {
  bookingStatus = "cancelled";
  const phish = "cancelled — re-book now at https://evil.example/login";

  const res = await statusChange(phish);

  assert.equal(res.status, 200);
  assert.equal(notifications.length, 1);
  const sent = notifications[0]!;
  assert.doesNotMatch(sent.title, /evil\.example/, "the injected text must not reach the subject line");
  assert.doesNotMatch(sent.body, /evil\.example/, "the injected text must not reach the email body");
  // Falls back to the database's own value for the booking.
  assert.equal(sent.title, "Session cancelled");
});

test("a status that is not a booking status at all falls back to the stored one", async () => {
  bookingStatus = "completed";

  for (const bogus of [{ toString: "nope" }, 42, "", "DROP TABLE bookings", null]) {
    const res = await statusChange(bogus);
    assert.equal(res.status, 200);
    assert.equal(notifications[0]?.title, "Session completed", `rejected input ${JSON.stringify(bogus)} should fall back`);
  }
});

test("a legitimate status is still used verbatim", async () => {
  bookingStatus = "confirmed";

  const res = await statusChange("declined");

  assert.equal(res.status, 200);
  assert.equal(notifications[0]?.title, "Session declined");
});
