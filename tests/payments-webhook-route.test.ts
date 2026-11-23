import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { called, fakeSupabaseClient } from "./support/fake-supabase.ts";
import { fakeStripe, installNotificationsServerMock, installStripeClientMock } from "./support/payments-fixtures.ts";
import { installReportMock } from "./support/report-fixture.ts";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fake-project.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role-key";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_fake";

const notificationHooks = installNotificationsServerMock();
const stripeMock = installStripeClientMock();
const reportedFailures = installReportMock();

let currentClient: unknown = null;
mock.module("@supabase/supabase-js", {
  namedExports: { createClient: () => currentClient },
});

const { POST } = await import("../app/api/payments/webhook/route.ts");

function webhookRequest(body: string, signature: string | null = "t=1,v1=fake") {
  const headers: Record<string, string> = {};
  if (signature) headers["stripe-signature"] = signature;
  return new Request("http://localhost/api/payments/webhook", { method: "POST", headers, body });
}

test("a missing signature header is rejected before the body is even parsed as an event", async () => {
  stripeMock.set(fakeStripe());
  currentClient = fakeSupabaseClient({});
  const res = await POST(webhookRequest("{}", null));
  assert.equal(res.status, 400);
});

test("a signature that fails verification is rejected — this is the only thing standing between the endpoint and forged payment events", async () => {
  reportedFailures.length = 0;
  stripeMock.set(fakeStripe({
    webhooksConstructEvent: () => {
      throw new Error("No signatures found matching the expected signature for payload");
    },
  }));
  currentClient = fakeSupabaseClient({});
  const res = await POST(webhookRequest("{}"));
  assert.equal(res.status, 400);
  const body = await res.json();
  // Deliberately vague per the route's own comment — must not leak the real Stripe error text.
  assert.equal(body.error, "Invalid signature");
  // A wrong STRIPE_WEBHOOK_SECRET looks identical to internet noise, which is exactly the case
  // that must not go unreported — otherwise every real payment silently fails to record.
  assert.equal(reportedFailures.length, 1);
  assert.equal(reportedFailures[0].context, "stripeWebhookSignature");
});

test("checkout.session.completed with no bookingId in metadata is a safe no-op", async () => {
  let bookingsTouched = false;
  stripeMock.set(fakeStripe({
    webhooksConstructEvent: () => ({ type: "checkout.session.completed", data: { object: { id: "cs_1", metadata: {} } } }),
  }));
  currentClient = fakeSupabaseClient({
    tables: { bookings: () => { bookingsTouched = true; return { data: null, error: null }; } },
  });
  const res = await POST(webhookRequest("{}"));
  assert.equal(res.status, 200);
  assert.equal(bookingsTouched, false);
});

test("checkout.session.completed for an already-paid payment row does not write a duplicate notification", async () => {
  let notified = false;
  notificationHooks.createNotification = async () => {
    notified = true;
    return {};
  };
  stripeMock.set(fakeStripe({
    webhooksConstructEvent: () => ({
      type: "checkout.session.completed",
      data: { object: { id: "cs_1", metadata: { bookingId: "booking-1" }, amount_total: 5000 } },
    }),
  }));
  currentClient = fakeSupabaseClient({
    tables: {
      booking_payments: () => ({ data: { id: "pay-1", status: "paid" }, error: null }),
    },
  });
  const res = await POST(webhookRequest("{}"));
  assert.equal(res.status, 200);
  assert.equal(notified, false);
});

test("checkout.session.completed marks the payment and booking paid, and emails the student a receipt", async () => {
  let paymentMarkedPaid = false;
  let bookingMarkedPaid = false;
  let receiptTo: string | undefined;
  notificationHooks.getBooking = async () => ({ id: "booking-1", student_id: "student-1", course_code: "CS 1027" });
  notificationHooks.getProfile = async (userId) => ({ id: userId, email: `${userId}@uwo.ca`, full_name: "Sam Student" });
  notificationHooks.createNotification = async (params) => {
    const p = params as { emailTo?: string; kind: string };
    receiptTo = p.emailTo;
    assert.equal(p.kind, "payment_succeeded");
    return {};
  };
  stripeMock.set(fakeStripe({
    webhooksConstructEvent: () => ({
      type: "checkout.session.completed",
      data: { object: { id: "cs_1", metadata: { bookingId: "booking-1" }, amount_total: 5000 } },
    }),
  }));
  currentClient = fakeSupabaseClient({
    tables: {
      booking_payments: (calls) => {
        if (called(calls, "update")) paymentMarkedPaid = true;
        return { data: { id: "pay-1", status: "pending" }, error: null };
      },
      bookings: (calls) => {
        if (called(calls, "update")) bookingMarkedPaid = true;
        return { data: null, error: null };
      },
    },
  });
  const res = await POST(webhookRequest("{}"));
  assert.equal(res.status, 200);
  assert.equal(paymentMarkedPaid, true);
  assert.equal(bookingMarkedPaid, true);
  assert.equal(receiptTo, "student-1@uwo.ca");
});

test("checkout.session.expired marks the payment and booking failed", async () => {
  let paymentFailed = false;
  let bookingFailed = false;
  stripeMock.set(fakeStripe({
    webhooksConstructEvent: () => ({
      type: "checkout.session.expired",
      data: { object: { id: "cs_1", metadata: { bookingId: "booking-1" } } },
    }),
  }));
  currentClient = fakeSupabaseClient({
    tables: {
      booking_payments: (calls) => {
        if (called(calls, "update")) paymentFailed = true;
        return { data: null, error: null };
      },
      bookings: (calls) => {
        if (called(calls, "update")) bookingFailed = true;
        return { data: null, error: null };
      },
    },
  });
  const res = await POST(webhookRequest("{}"));
  assert.equal(res.status, 200);
  assert.equal(paymentFailed, true);
  assert.equal(bookingFailed, true);
});

test("an event type the route doesn't act on still returns 200 (received)", async () => {
  stripeMock.set(fakeStripe({
    webhooksConstructEvent: () => ({ type: "customer.created", data: { object: {} } }),
  }));
  currentClient = fakeSupabaseClient({});
  const res = await POST(webhookRequest("{}"));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.received, true);
});

// --- #5: a failed write must not be answered with 200 -------------------------------
// This handler used to `await` both Supabase writes without checking `error` and then return
// {received: true} unconditionally. A database blip during a real payment was therefore
// permanent and silent: charged in Stripe, shown as complete there, and stuck on
// `stripe_pending` in the app forever, because a 200 tells Stripe to stop retrying. On the
// Hobby plan the runtime logs are gone within the hour, so nobody would ever find it.

test("a database failure while recording a payment returns 5xx so Stripe redelivers", async () => {
  reportedFailures.length = 0;
  stripeMock.set(fakeStripe({
    webhooksConstructEvent: () => ({
      id: "evt_1",
      type: "checkout.session.completed",
      data: { object: { id: "cs_1", metadata: { bookingId: "booking-1" }, amount_total: 5000 } },
    }),
  }));
  currentClient = fakeSupabaseClient({
    tables: {
      booking_payments: () => ({ data: { id: "pay-1", status: "pending" }, error: null }),
      bookings: (calls) =>
        called(calls, "update")
          ? { data: null, error: { message: "could not serialize access" } }
          : { data: null, error: null },
    },
  });

  const res = await POST(webhookRequest("{}"));

  assert.equal(res.status, 500, "a 200 here would tell Stripe to stop retrying a payment we failed to record");
  assert.equal(reportedFailures.length, 1, "the failure must be reported, not swallowed");
});

// Ordering matters: booking_payments.status = 'paid' is the idempotency latch the handler
// reads on redelivery, so it has to be written last. Setting it first would mean a failure in
// between left the booking unpaid while every retry short-circuited on the latch.
test("the paid latch is not set when marking the booking paid fails", async () => {
  reportedFailures.length = 0;
  let latchWritten = false;
  stripeMock.set(fakeStripe({
    webhooksConstructEvent: () => ({
      id: "evt_1",
      type: "checkout.session.completed",
      data: { object: { id: "cs_1", metadata: { bookingId: "booking-1" }, amount_total: 5000 } },
    }),
  }));
  currentClient = fakeSupabaseClient({
    tables: {
      booking_payments: (calls) => {
        if (called(calls, "update")) latchWritten = true;
        return { data: { id: "pay-1", status: "pending" }, error: null };
      },
      bookings: (calls) =>
        called(calls, "update")
          ? { data: null, error: { message: "deadlock detected" } }
          : { data: null, error: null },
    },
  });

  const res = await POST(webhookRequest("{}"));

  assert.equal(res.status, 500);
  assert.equal(latchWritten, false, "the latch must not be set while the booking is still unpaid");
});

test("a failed booking_payments lookup is a 5xx, not a silently ignored 'no such payment'", async () => {
  reportedFailures.length = 0;
  stripeMock.set(fakeStripe({
    webhooksConstructEvent: () => ({
      id: "evt_1",
      type: "checkout.session.completed",
      data: { object: { id: "cs_1", metadata: { bookingId: "booking-1" }, amount_total: 5000 } },
    }),
  }));
  currentClient = fakeSupabaseClient({
    tables: {
      booking_payments: () => ({ data: null, error: { message: "connection reset" } }),
    },
  });

  const res = await POST(webhookRequest("{}"));

  assert.equal(res.status, 500);
  assert.equal(reportedFailures.length, 1);
});

test("a clean payment still returns 200 so Stripe stops retrying", async () => {
  reportedFailures.length = 0;
  notificationHooks.createNotification = async () => ({});
  stripeMock.set(fakeStripe({
    webhooksConstructEvent: () => ({
      id: "evt_1",
      type: "checkout.session.completed",
      data: { object: { id: "cs_1", metadata: { bookingId: "booking-1" }, amount_total: 5000 } },
    }),
  }));
  currentClient = fakeSupabaseClient({
    tables: {
      booking_payments: () => ({ data: { id: "pay-1", status: "pending" }, error: null }),
      bookings: () => ({ data: null, error: null }),
    },
  });

  const res = await POST(webhookRequest("{}"));

  assert.equal(res.status, 200);
  assert.equal(reportedFailures.length, 0);
});
