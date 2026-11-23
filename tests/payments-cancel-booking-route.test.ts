import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { fakeSupabaseClient } from "./support/fake-supabase.ts";
import { fakeStripe, installNotificationsServerMock, installStripeClientMock } from "./support/payments-fixtures.ts";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fake-project.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role-key";

const notificationHooks = installNotificationsServerMock();
const stripeMock = installStripeClientMock();
stripeMock.set(fakeStripe());

let currentClient: unknown = null;
mock.module("@supabase/supabase-js", {
  namedExports: { createClient: () => currentClient },
});

const { POST } = await import("../app/api/payments/cancel-booking/route.ts");

const STUDENT_ID = "student-1";
const TUTOR_ID = "tutor-1";

function postRequest(bookingId: string) {
  return new Request("http://localhost/api/payments/cancel-booking", {
    method: "POST",
    headers: { authorization: "Bearer x" },
    body: JSON.stringify({ bookingId }),
  });
}

// More than 12 hours out, so no cancellation fee applies regardless of who cancels.
const FAR_OUT_START = new Date(Date.now() + 48 * 60 * 60_000).toISOString();
// Inside the 12-hour fee window.
const SOON_START = new Date(Date.now() + 2 * 60 * 60_000).toISOString();

function unpaidBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: "booking-1",
    student_id: STUDENT_ID,
    tutor_id: TUTOR_ID,
    course_code: "CS 1027",
    requested_start: FAR_OUT_START,
    delivery_mode: "online",
    topic: null,
    status: "confirmed",
    payment_status: "unpaid",
    ...overrides,
  };
}

test("a non-participant, non-admin caller cannot cancel someone else's booking", async () => {
  currentClient = fakeSupabaseClient({
    authUser: { id: "stranger" },
    tables: {
      bookings: () => ({ data: unpaidBooking(), error: null }),
      profiles: () => ({ data: { role: "student" }, error: null }),
    },
  });
  const res = await POST(postRequest("booking-1"));
  assert.equal(res.status, 403);
});

test("an admin can cancel a booking they're not a participant in", async () => {
  currentClient = fakeSupabaseClient({
    authUser: { id: "admin-1" },
    tables: {
      bookings: () => ({ data: unpaidBooking(), error: null }),
      profiles: () => ({ data: { role: "admin" }, error: null }),
    },
  });
  const res = await POST(postRequest("booking-1"));
  assert.equal(res.status, 200);
});

test("an already-cancelled booking is a no-op, not a double refund attempt", async () => {
  let refundAttempted = false;
  stripeMock.set(fakeStripe({ refundsCreate: async () => { refundAttempted = true; return {}; } }));
  currentClient = fakeSupabaseClient({
    authUser: { id: STUDENT_ID },
    tables: {
      bookings: () => ({ data: unpaidBooking({ status: "cancelled" }), error: null }),
      profiles: () => ({ data: { role: "student" }, error: null }),
    },
  });
  const res = await POST(postRequest("booking-1"));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(body, { ok: true, refunded: false, refundedCents: 0, feeCents: 0 });
  assert.equal(refundAttempted, false);
  stripeMock.set(fakeStripe());
});

test("a tutor cancelling a paid, imminent booking still gets a full refund — no fee is a student-initiated-only concept", async () => {
  let refundArgs: unknown;
  stripeMock.set(fakeStripe({
    checkoutSessionRetrieve: async () => ({ payment_intent: "pi_fake" }),
    refundsCreate: async (params) => {
      refundArgs = params;
      return {};
    },
  }));
  currentClient = fakeSupabaseClient({
    authUser: { id: TUTOR_ID },
    tables: {
      bookings: () => ({ data: unpaidBooking({ requested_start: SOON_START, payment_status: "paid" }), error: null }),
      profiles: () => ({ data: { role: "student" }, error: null }),
      booking_payments: () => ({ data: { id: "pay-1", stripe_checkout_session_id: "cs_1", amount_cents: 5000, refund_amount_cents: 0 }, error: null }),
    },
  });
  const res = await POST(postRequest("booking-1"));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.refunded, true);
  assert.equal(body.refundedCents, 5000);
  assert.equal(body.feeCents, 0);
  assert.deepEqual(refundArgs, { payment_intent: "pi_fake", amount: 5000 });
});

test("a student cancelling a paid booking inside the 12-hour window is refunded the amount minus the cancellation fee", async () => {
  let refundArgs: { amount: number } | undefined;
  stripeMock.set(fakeStripe({
    checkoutSessionRetrieve: async () => ({ payment_intent: "pi_fake" }),
    refundsCreate: async (params) => {
      refundArgs = params;
      return {};
    },
  }));
  currentClient = fakeSupabaseClient({
    authUser: { id: STUDENT_ID },
    tables: {
      bookings: () => ({ data: unpaidBooking({ requested_start: SOON_START, payment_status: "paid" }), error: null }),
      profiles: () => ({ data: { role: "student" }, error: null }),
      booking_payments: () => ({ data: { id: "pay-1", stripe_checkout_session_id: "cs_1", amount_cents: 5000, refund_amount_cents: 0 }, error: null }),
    },
  });
  const res = await POST(postRequest("booking-1"));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.feeCents, 1000);
  assert.equal(body.refundedCents, 4000);
  assert.equal(refundArgs?.amount, 4000);
});

test("a student cancelling a paid booking well outside the window is refunded in full", async () => {
  stripeMock.set(fakeStripe({
    checkoutSessionRetrieve: async () => ({ payment_intent: "pi_fake" }),
  }));
  currentClient = fakeSupabaseClient({
    authUser: { id: STUDENT_ID },
    tables: {
      bookings: () => ({ data: unpaidBooking({ requested_start: FAR_OUT_START, payment_status: "paid" }), error: null }),
      profiles: () => ({ data: { role: "student" }, error: null }),
      booking_payments: () => ({ data: { id: "pay-1", stripe_checkout_session_id: "cs_1", amount_cents: 5000, refund_amount_cents: 0 }, error: null }),
    },
  });
  const res = await POST(postRequest("booking-1"));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.feeCents, 0);
  assert.equal(body.refundedCents, 5000);
});

test("cancelling an unpaid booking marks it cancelled without attempting any refund", async () => {
  let refundAttempted = false;
  let bookingUpdateArgs: unknown;
  stripeMock.set(fakeStripe({ refundsCreate: async () => { refundAttempted = true; return {}; } }));
  currentClient = fakeSupabaseClient({
    authUser: { id: STUDENT_ID },
    tables: {
      bookings: (calls) => {
        const updateCall = calls.find((c) => c.method === "update");
        if (updateCall) bookingUpdateArgs = updateCall.args[0];
        return { data: unpaidBooking(), error: null };
      },
      profiles: () => ({ data: { role: "student" }, error: null }),
    },
  });
  const res = await POST(postRequest("booking-1"));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.refunded, false);
  assert.equal(refundAttempted, false);
  assert.deepEqual(bookingUpdateArgs, { status: "cancelled", payment_status: "unpaid" });
  stripeMock.set(fakeStripe());
});

test("both participants are notified with a CANCEL calendar invite attached", async () => {
  let tutorNotified = false;
  let studentNotified: { kind: string } | undefined;
  notificationHooks.buildBookingIcs = async (params) => {
    assert.equal((params as { method?: string }).method, "CANCEL");
    return "ICS";
  };
  notificationHooks.createNotification = async (params) => {
    const p = params as { userId: string; kind: string };
    if (p.userId === TUTOR_ID) tutorNotified = true;
    if (p.userId === STUDENT_ID) studentNotified = { kind: p.kind };
    return {};
  };
  currentClient = fakeSupabaseClient({
    authUser: { id: STUDENT_ID },
    tables: {
      bookings: () => ({ data: unpaidBooking(), error: null }),
      profiles: () => ({ data: { role: "student" }, error: null }),
    },
  });
  const res = await POST(postRequest("booking-1"));
  assert.equal(res.status, 200);
  assert.equal(tutorNotified, true);
  assert.equal(studentNotified?.kind, "booking_status_changed");
});

// A session the tutor already marked completed used to stay refundable: the only status
// guard was `=== "cancelled"`, and by then hoursUntil(requested_start) is negative, so the
// 12-hour window withheld just the $10 cancellation fee and refunded the rest. A delivered
// $60 session refunded $50 and the tutor was left holding nothing.
test("a student cannot cancel — or get refunded for — a session that already happened", async () => {
  let refundAttempted = false;
  stripeMock.set(fakeStripe({
    checkoutSessionRetrieve: async () => ({ payment_intent: "pi_fake" }),
    refundsCreate: async () => {
      refundAttempted = true;
      return {};
    },
  }));
  currentClient = fakeSupabaseClient({
    authUser: { id: STUDENT_ID },
    tables: {
      bookings: () => ({ data: unpaidBooking({ status: "completed", payment_status: "paid", requested_start: SOON_START }), error: null }),
      profiles: () => ({ data: { role: "student" }, error: null }),
      booking_payments: () => ({ data: { id: "pay-1", stripe_checkout_session_id: "cs_1", amount_cents: 6000, refund_amount_cents: 0 }, error: null }),
    },
  });
  const res = await POST(postRequest("booking-1"));
  const body = await res.json();
  assert.equal(res.status, 409);
  assert.equal(body.ok, false);
  assert.match(body.error, /already taken place/i);
  assert.equal(refundAttempted, false, "a delivered session must never reach Stripe");
});

// The dispute path: "the tutor never showed up" still needs a way to refund a session the
// overdue sweep has already flipped to completed.
test("an admin can still cancel and refund a completed session for a dispute", async () => {
  let refundArgs: { amount: number } | undefined;
  stripeMock.set(fakeStripe({
    checkoutSessionRetrieve: async () => ({ payment_intent: "pi_fake" }),
    refundsCreate: async (params) => {
      refundArgs = params as { amount: number };
      return {};
    },
  }));
  currentClient = fakeSupabaseClient({
    authUser: { id: "admin-1" },
    tables: {
      bookings: () => ({ data: unpaidBooking({ status: "completed", payment_status: "paid", requested_start: SOON_START }), error: null }),
      profiles: () => ({ data: { role: "admin" }, error: null }),
      booking_payments: () => ({ data: { id: "pay-1", stripe_checkout_session_id: "cs_1", amount_cents: 6000, refund_amount_cents: 0 }, error: null }),
    },
  });
  const res = await POST(postRequest("booking-1"));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  // An admin is not the student, so computeFeeCents withholds nothing: a full refund.
  assert.equal(refundArgs?.amount, 6000);
});
