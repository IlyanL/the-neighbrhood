import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { callArgs, called, fakeSupabaseClient } from "./support/fake-supabase.ts";
import { fakeStripe, installStripeClientMock } from "./support/payments-fixtures.ts";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fake-project.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role-key";
process.env.NEXT_PUBLIC_APP_URL = "https://theneighbrhood.ca";

const stripeMock = installStripeClientMock();

let currentClient: unknown = null;
mock.module("@supabase/supabase-js", {
  namedExports: { createClient: () => currentClient },
});

// Mocked directly rather than exercised through the real limiter: lib/rate-limit.ts caches its
// own Supabase client at module scope on first call, which would otherwise fix the fake client
// from whichever test happens to reach the limiter first for every test after it (see the note
// in auth-signup-route.test.ts). Same pattern already used by liveblocks-auth-route.test.ts.
let currentRateLimit = { allowed: true, retryAfterSeconds: 0 };
mock.module("@/lib/rate-limit", {
  namedExports: { checkRateLimit: async () => currentRateLimit },
});

const { POST } = await import("../app/api/payments/checkout/route.ts");

const STUDENT_ID = "student-1";

function postRequest(body: unknown, headers: Record<string, string> = { authorization: "Bearer x" }) {
  return new Request("http://localhost/api/payments/checkout", { method: "POST", headers, body: JSON.stringify(body) });
}

const CONFIRMED_UNPAID_BOOKING = {
  id: "booking-1",
  student_id: STUDENT_ID,
  tutor_id: "tutor-1",
  course_code: "CS 1027",
  status: "confirmed",
  payment_status: "unpaid",
};

test("Stripe not configured is reported distinctly from an auth failure", async () => {
  stripeMock.set(null);
  currentClient = fakeSupabaseClient({});
  const res = await POST(postRequest({ bookingId: "booking-1" }));
  assert.equal(res.status, 400);
});

test("no Authorization header is rejected", async () => {
  stripeMock.set(fakeStripe());
  currentClient = fakeSupabaseClient({});
  const res = await POST(postRequest({ bookingId: "booking-1" }, {}));
  assert.equal(res.status, 401);
});

test("an invalid session is rejected", async () => {
  stripeMock.set(fakeStripe());
  currentClient = fakeSupabaseClient({ authUser: null });
  const res = await POST(postRequest({ bookingId: "booking-1" }));
  assert.equal(res.status, 401);
});

test("rate limited before the booking is even looked up", async () => {
  currentRateLimit = { allowed: false, retryAfterSeconds: 45 };
  try {
    stripeMock.set(fakeStripe());
    currentClient = fakeSupabaseClient({ authUser: { id: STUDENT_ID } });
    const res = await POST(postRequest({ bookingId: "booking-1" }));
    assert.equal(res.status, 429);
    assert.equal(res.headers.get("Retry-After"), "45");
  } finally {
    currentRateLimit = { allowed: true, retryAfterSeconds: 0 };
  }
});

test("a booking that doesn't exist is 404", async () => {
  stripeMock.set(fakeStripe());
  currentClient = fakeSupabaseClient({
    authUser: { id: STUDENT_ID },
    tables: { bookings: () => ({ data: null, error: null }) },
  });
  const res = await POST(postRequest({ bookingId: "nope" }));
  assert.equal(res.status, 404);
});

test("only the student on the booking can start payment for it", async () => {
  stripeMock.set(fakeStripe());
  currentClient = fakeSupabaseClient({
    authUser: { id: "someone-else" },
    tables: { bookings: () => ({ data: CONFIRMED_UNPAID_BOOKING, error: null }) },
  });
  const res = await POST(postRequest({ bookingId: "booking-1" }));
  assert.equal(res.status, 403);
});

test("an unconfirmed booking cannot be paid for yet", async () => {
  stripeMock.set(fakeStripe());
  currentClient = fakeSupabaseClient({
    authUser: { id: STUDENT_ID },
    tables: { bookings: () => ({ data: { ...CONFIRMED_UNPAID_BOOKING, status: "requested" }, error: null }) },
  });
  const res = await POST(postRequest({ bookingId: "booking-1" }));
  assert.equal(res.status, 409);
});

test("an already-paid booking is not charged twice", async () => {
  stripeMock.set(fakeStripe());
  currentClient = fakeSupabaseClient({
    authUser: { id: STUDENT_ID },
    tables: { bookings: () => ({ data: { ...CONFIRMED_UNPAID_BOOKING, payment_status: "paid" }, error: null }) },
  });
  const res = await POST(postRequest({ bookingId: "booking-1" }));
  assert.equal(res.status, 409);
});

test("a tutor with no hourly rate set blocks checkout rather than charging $0", async () => {
  stripeMock.set(fakeStripe());
  currentClient = fakeSupabaseClient({
    authUser: { id: STUDENT_ID },
    tables: {
      bookings: () => ({ data: CONFIRMED_UNPAID_BOOKING, error: null }),
      tutor_profiles: () => ({ data: { display_name: "Tara Tutor", hourly_rate_cents: 0 }, error: null }),
    },
  });
  const res = await POST(postRequest({ bookingId: "booking-1" }));
  assert.equal(res.status, 400);
});

test("a valid checkout supersedes any stale pending payment, charges the tutor's real rate, and records the new pending row", async () => {
  let checkoutCreateParams: unknown;
  let pendingSuperseded = false;
  let insertedPaymentRow: unknown[] | undefined;
  let bookingUpdateArgs: unknown[] | undefined;

  stripeMock.set(fakeStripe({
    checkoutSessionCreate: async (params) => {
      checkoutCreateParams = params;
      return { id: "cs_test_new", url: "https://checkout.stripe.com/new" };
    },
  }));
  currentClient = fakeSupabaseClient({
    authUser: { id: STUDENT_ID },
    tables: {
      bookings: (calls) => {
        if (called(calls, "update")) bookingUpdateArgs = callArgs(calls, "update");
        return { data: CONFIRMED_UNPAID_BOOKING, error: null };
      },
      tutor_profiles: () => ({ data: { display_name: "Tara Tutor", hourly_rate_cents: 5000 }, error: null }),
      booking_payments: (calls) => {
        if (called(calls, "update")) pendingSuperseded = true;
        if (called(calls, "insert")) insertedPaymentRow = callArgs(calls, "insert");
        return { data: null, error: null };
      },
    },
  });

  const res = await POST(postRequest({ bookingId: "booking-1" }));
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.url, "https://checkout.stripe.com/new");
  assert.equal(pendingSuperseded, true);
  assert.equal((checkoutCreateParams as { line_items: Array<{ price_data: { unit_amount: number } }> }).line_items[0].price_data.unit_amount, 5000);
  assert.ok(insertedPaymentRow);
  const row = insertedPaymentRow![0] as { amount_cents: number; status: string; stripe_checkout_session_id: string };
  assert.equal(row.amount_cents, 5000);
  assert.equal(row.status, "pending");
  assert.equal(row.stripe_checkout_session_id, "cs_test_new");
  assert.deepEqual(bookingUpdateArgs, [{ payment_status: "stripe_pending", payment_total_cents: 5000, payment_platform_fee_cents: 0 }]);
});
