import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { called, fakeSupabaseClient } from "./support/fake-supabase.ts";
import { fakeStripe, installStripeClientMock } from "./support/payments-fixtures.ts";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fake-project.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role-key";

const stripeMock = installStripeClientMock();

let currentClient: unknown = null;
mock.module("@supabase/supabase-js", {
  namedExports: { createClient: () => currentClient },
});

const { GET } = await import("../app/api/payments/confirm/route.ts");

const STUDENT_ID = "student-1";

function getRequest(sessionId?: string) {
  const url = sessionId ? `http://localhost/api/payments/confirm?session_id=${sessionId}` : "http://localhost/api/payments/confirm";
  return new Request(url, { headers: { authorization: "Bearer x" } });
}

test("no session_id is rejected", async () => {
  stripeMock.set(fakeStripe());
  currentClient = fakeSupabaseClient({ authUser: { id: STUDENT_ID } });
  const res = await GET(getRequest());
  assert.equal(res.status, 400);
});

test("a payment row that isn't this student's own is not found — no cross-account confirmation", async () => {
  stripeMock.set(fakeStripe());
  currentClient = fakeSupabaseClient({
    authUser: { id: STUDENT_ID },
    tables: {
      booking_payments: () => ({ data: { id: "p1", booking_id: "b1", student_id: "someone-else", status: "pending", amount_cents: 5000 }, error: null }),
    },
  });
  const res = await GET(getRequest("cs_test_1"));
  assert.equal(res.status, 404);
});

test("an already-paid row short-circuits without calling Stripe again", async () => {
  let stripeCalled = false;
  stripeMock.set(fakeStripe({
    checkoutSessionRetrieve: async () => {
      stripeCalled = true;
      return { payment_status: "paid" };
    },
  }));
  currentClient = fakeSupabaseClient({
    authUser: { id: STUDENT_ID },
    tables: {
      booking_payments: () => ({ data: { id: "p1", booking_id: "b1", student_id: STUDENT_ID, status: "paid", amount_cents: 5000 }, error: null }),
    },
  });
  const res = await GET(getRequest("cs_test_1"));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.status, "paid");
  assert.equal(stripeCalled, false);
});

test("a pending row whose Stripe session isn't actually paid yet stays pending, and nothing is written", async () => {
  let paymentsWritten = false;
  let bookingsWritten = false;
  stripeMock.set(fakeStripe({
    checkoutSessionRetrieve: async () => ({ payment_status: "unpaid" }),
  }));
  currentClient = fakeSupabaseClient({
    authUser: { id: STUDENT_ID },
    tables: {
      booking_payments: (calls) => {
        if (called(calls, "update")) paymentsWritten = true;
        return { data: { id: "p1", booking_id: "b1", student_id: STUDENT_ID, status: "pending", amount_cents: 5000 }, error: null };
      },
      bookings: () => {
        bookingsWritten = true;
        return { data: null, error: null };
      },
    },
  });
  const res = await GET(getRequest("cs_test_1"));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.status, "pending");
  assert.equal(paymentsWritten, false);
  assert.equal(bookingsWritten, false);
});

test("a pending row whose Stripe session is now paid marks the payment and booking paid", async () => {
  let paymentUpdateArgs: unknown;
  let bookingUpdateArgs: unknown;
  stripeMock.set(fakeStripe({
    checkoutSessionRetrieve: async () => ({ payment_status: "paid" }),
  }));
  currentClient = fakeSupabaseClient({
    authUser: { id: STUDENT_ID },
    tables: {
      booking_payments: (calls) => {
        const updateCall = calls.find((c) => c.method === "update");
        if (updateCall) paymentUpdateArgs = updateCall.args[0];
        return { data: { id: "p1", booking_id: "b1", student_id: STUDENT_ID, status: "pending", amount_cents: 5000 }, error: null };
      },
      bookings: (calls) => {
        const updateCall = calls.find((c) => c.method === "update");
        if (updateCall) bookingUpdateArgs = updateCall.args[0];
        return { data: null, error: null };
      },
    },
  });
  const res = await GET(getRequest("cs_test_1"));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.status, "paid");
  assert.deepEqual(paymentUpdateArgs, { status: "paid" });
  assert.deepEqual(bookingUpdateArgs, { payment_status: "paid" });
});
