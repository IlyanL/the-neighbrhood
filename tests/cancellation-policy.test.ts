import assert from "node:assert/strict";
import test from "node:test";
import {
  CANCELLATION_FEE_CENTS,
  RESCHEDULE_FEE_CENTS,
  FEE_WINDOW_HOURS,
  computeFeeCents,
  hoursUntil,
} from "../lib/payments/cancellation-policy.ts";

const NOW = new Date("2026-01-10T12:00:00.000Z");

function isoHoursFromNow(hours: number): string {
  return new Date(NOW.getTime() + hours * 60 * 60 * 1000).toISOString();
}

test("hoursUntil is positive for a future time and negative for a past one", () => {
  assert.equal(hoursUntil(isoHoursFromNow(5), NOW), 5);
  assert.equal(hoursUntil(isoHoursFromNow(-5), NOW), -5);
});

test("a non-student actor never owes a fee, even inside the window on a paid booking", () => {
  const fee = computeFeeCents({
    actorIsStudent: false,
    isPaid: true,
    requestedStartIso: isoHoursFromNow(1),
    action: "cancel",
    now: NOW,
  });
  assert.equal(fee, 0);
});

test("an unpaid booking never owes a fee, even inside the window", () => {
  const fee = computeFeeCents({
    actorIsStudent: true,
    isPaid: false,
    requestedStartIso: isoHoursFromNow(1),
    action: "cancel",
    now: NOW,
  });
  assert.equal(fee, 0);
});

test("a student cancelling a paid booking inside the window owes the cancellation fee", () => {
  const fee = computeFeeCents({
    actorIsStudent: true,
    isPaid: true,
    requestedStartIso: isoHoursFromNow(FEE_WINDOW_HOURS - 1),
    action: "cancel",
    now: NOW,
  });
  assert.equal(fee, CANCELLATION_FEE_CENTS);
});

test("a student rescheduling a paid booking inside the window owes the (lower) reschedule fee", () => {
  const fee = computeFeeCents({
    actorIsStudent: true,
    isPaid: true,
    requestedStartIso: isoHoursFromNow(FEE_WINDOW_HOURS - 1),
    action: "reschedule",
    now: NOW,
  });
  assert.equal(fee, RESCHEDULE_FEE_CENTS);
  assert.ok(RESCHEDULE_FEE_CENTS < CANCELLATION_FEE_CENTS);
});

test("a student acting well outside the window owes nothing", () => {
  const fee = computeFeeCents({
    actorIsStudent: true,
    isPaid: true,
    requestedStartIso: isoHoursFromNow(FEE_WINDOW_HOURS + 1),
    action: "cancel",
    now: NOW,
  });
  assert.equal(fee, 0);
});

test("the boundary is inclusive of the window's edge — exactly FEE_WINDOW_HOURS out owes nothing", () => {
  // The source uses `>=` when comparing hoursUntil to FEE_WINDOW_HOURS, so a session that is
  // exactly on the boundary counts as "still outside the fee window", not "just inside it".
  // Worth pinning down explicitly: flipping that comparison would silently start charging
  // students who reschedule exactly 12 hours out.
  const fee = computeFeeCents({
    actorIsStudent: true,
    isPaid: true,
    requestedStartIso: isoHoursFromNow(FEE_WINDOW_HOURS),
    action: "cancel",
    now: NOW,
  });
  assert.equal(fee, 0);
});

test("one second inside the boundary owes the fee", () => {
  const fee = computeFeeCents({
    actorIsStudent: true,
    isPaid: true,
    requestedStartIso: isoHoursFromNow(FEE_WINDOW_HOURS - 1 / 3600),
    action: "cancel",
    now: NOW,
  });
  assert.equal(fee, CANCELLATION_FEE_CENTS);
});
