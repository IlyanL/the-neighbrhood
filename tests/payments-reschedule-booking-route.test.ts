import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { fakeSupabaseClient } from "./support/fake-supabase.ts";
import { fakeStripe, installNotificationsServerMock, installStripeClientMock } from "./support/payments-fixtures.ts";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fake-project.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "fake-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role-key";

const notificationHooks = installNotificationsServerMock();
const stripeMock = installStripeClientMock();
stripeMock.set(fakeStripe());

let currentClient: unknown = null;
mock.module("@supabase/supabase-js", {
  namedExports: { createClient: () => currentClient },
});

const { POST } = await import("../app/api/payments/reschedule-booking/route.ts");

const STUDENT_ID = "student-1";
const TUTOR_ID = "tutor-1";
const FAR_OUT_START = new Date(Date.now() + 48 * 60 * 60_000).toISOString();
const SOON_START = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
const NEW_START = new Date(Date.now() + 72 * 60 * 60_000).toISOString();

function postRequest(body: unknown) {
  return new Request("http://localhost/api/payments/reschedule-booking", {
    method: "POST",
    headers: { authorization: "Bearer x" },
    body: JSON.stringify(body),
  });
}

function baseBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: "booking-1",
    student_id: STUDENT_ID,
    tutor_id: TUTOR_ID,
    course_code: "CS 1027",
    requested_start: FAR_OUT_START,
    status: "confirmed",
    payment_status: "unpaid",
    ...overrides,
  };
}

test("only the student can reschedule their own booking", async () => {
  currentClient = fakeSupabaseClient({
    authUser: { id: "someone-else" },
    tables: { bookings: () => ({ data: baseBooking(), error: null }) },
  });
  const res = await POST(postRequest({ bookingId: "booking-1", newStart: NEW_START }));
  assert.equal(res.status, 403);
});

test("when the slot move fails as taken, the caller gets a 409 with a clear message and no refund is attempted", async () => {
  let refundAttempted = false;
  stripeMock.set(fakeStripe({ refundsCreate: async () => { refundAttempted = true; return {}; } }));
  currentClient = fakeSupabaseClient({
    authUser: { id: STUDENT_ID },
    tables: { bookings: () => ({ data: baseBooking(), error: null }) },
    rpc: async () => ({ data: null, error: { message: "That slot was just booked by someone else" } }),
  });
  const res = await POST(postRequest({ bookingId: "booking-1", newStart: NEW_START }));
  assert.equal(res.status, 409);
  assert.equal(refundAttempted, false);
  stripeMock.set(fakeStripe());
});

test("rescheduling an unpaid booking outside the fee window moves the slot and refunds nothing", async () => {
  currentClient = fakeSupabaseClient({
    authUser: { id: STUDENT_ID },
    tables: { bookings: () => ({ data: baseBooking(), error: null }) },
    rpc: async () => ({ data: { requested_start: NEW_START, delivery_mode: "online", topic: null }, error: null }),
  });
  const res = await POST(postRequest({ bookingId: "booking-1", newStart: NEW_START }));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.feeCents, 0);
  assert.equal(body.requestedStart, NEW_START);
});

// This case previously asserted `refundArgs.amount === 500`, i.e. it pinned the bug in
// place: the reschedule fee was handed to stripe.refunds.create as the refund amount, so a
// student who rescheduled late was PAID the $5 penalty while the email told them it had
// been withheld. A reschedule now moves the time and touches no money at all.
test("rescheduling a paid booking inside the 12-hour window moves the slot without refunding the fee", async () => {
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
      bookings: () => ({ data: baseBooking({ requested_start: SOON_START, payment_status: "paid" }), error: null }),
      booking_payments: () => ({ data: { id: "pay-1", stripe_checkout_session_id: "cs_1", amount_cents: 5000, refund_amount_cents: 0 }, error: null }),
    },
    rpc: async () => ({ data: { requested_start: NEW_START, delivery_mode: "online", topic: null }, error: null }),
  });
  const res = await POST(postRequest({ bookingId: "booking-1", newStart: NEW_START }));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(refundAttempted, false, "a reschedule must never move money");
  assert.equal(body.feeCents, 0);
});

test("rescheduling a paid booking outside the fee window moves the slot with no fee withheld", async () => {
  let refundAttempted = false;
  stripeMock.set(fakeStripe({ refundsCreate: async () => { refundAttempted = true; return {}; } }));
  currentClient = fakeSupabaseClient({
    authUser: { id: STUDENT_ID },
    tables: {
      bookings: () => ({ data: baseBooking({ requested_start: FAR_OUT_START, payment_status: "paid" }), error: null }),
    },
    rpc: async () => ({ data: { requested_start: NEW_START, delivery_mode: "online", topic: null }, error: null }),
  });
  const res = await POST(postRequest({ bookingId: "booking-1", newStart: NEW_START }));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.feeCents, 0);
  assert.equal(refundAttempted, false);
});

test("both participants are notified of the new time with an updated (non-cancel) invite", async () => {
  let methodSeen: string | undefined;
  let tutorKind: string | undefined;
  notificationHooks.buildBookingIcs = async (params) => {
    methodSeen = (params as { method?: string }).method;
    return "ICS";
  };
  notificationHooks.createNotification = async (params) => {
    const p = params as { userId: string; kind: string };
    if (p.userId === TUTOR_ID) tutorKind = p.kind;
    return {};
  };
  currentClient = fakeSupabaseClient({
    authUser: { id: STUDENT_ID },
    tables: { bookings: () => ({ data: baseBooking(), error: null }) },
    rpc: async () => ({ data: { requested_start: NEW_START, delivery_mode: "online", topic: null }, error: null }),
  });
  const res = await POST(postRequest({ bookingId: "booking-1", newStart: NEW_START }));
  assert.equal(res.status, 200);
  assert.equal(methodSeen, undefined);
  assert.equal(tutorKind, "time_change_auto_confirmed");
});
