import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("checkout session amount is computed server-side from the tutor's stored rate, not trusted from the client", () => {
  const source = read("app/api/payments/checkout/route.ts");
  assert.match(source, /tutorProfile\?\.hourly_rate_cents/);
  assert.doesNotMatch(source, /body\.amountCents/);
  assert.match(source, /booking\.student_id !== actorId/);
  assert.match(source, /booking\.status !== "confirmed"/);
  assert.match(source, /platform_fee_cents: 0/);
});

test("webhook is the source of truth and requires a verified Stripe signature", () => {
  const source = read("app/api/payments/webhook/route.ts");
  assert.match(source, /stripe\.webhooks\.constructEvent\(rawBody, signature, webhookSecret\)/);
  assert.match(source, /checkout\.session\.completed/);
  assert.match(source, /checkout\.session\.expired/);
});

test("cancelling a paid booking refunds through Stripe before the booking is marked cancelled", () => {
  const source = read("app/api/payments/cancel-booking/route.ts");
  assert.match(source, /booking\.payment_status === "paid"/);
  assert.match(source, /stripe\.refunds\.create\({ payment_intent: paymentIntentId, amount: refundCents }\)/);
  assert.match(source, /cancelBookingRow\(supabase, booking\.id/);
  const bookingsData = read("lib/data/bookings.ts");
  assert.match(bookingsData, /status: "cancelled"/);
});

test("a student cancelling within the fee window has the fee withheld server-side, not trusted from the client", () => {
  const source = read("app/api/payments/cancel-booking/route.ts");
  assert.match(source, /computeFeeCents/);
  assert.match(source, /const actorIsStudent = actorId === booking\.student_id/);
});

test("cancellation flows through the refund-aware API route instead of a direct client-side status update", () => {
  const source = read("app/page.tsx");
  assert.match(source, /if \(status === "cancelled"\) {/);
  assert.match(source, /fetch\("\/api\/payments\/cancel-booking"/);
});

test("the sessions list has no separate pay action, since payment now happens during booking", () => {
  const source = read("app/page.tsx");
  assert.doesNotMatch(source, /Pay for session/);
  assert.doesNotMatch(source, /Complete payment/);
});
