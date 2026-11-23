// booking_payments holds the actual Stripe-backed payment records (separate from
// bookings.payment_status, covered by the bookings guard test). Only the webhook route's
// service-role client is meant to write these. `pg_policies` shows one SELECT policy
// ("Users can read own booking payments") and nothing else -- but a policy alone does
// nothing without a matching GRANT (see docs/production-readiness.md's "Supabase grants vs
// RLS" note), and `information_schema.role_table_grants` shows *no* grants at all for
// `authenticated`/`anon` on this table, not even SELECT. So today, a signed-in user can't
// read their own payment record through this table either -- more restrictive than the
// policy alone implies, but still fail-safe. This test documents current behaviour; it
// isn't a claim that the SELECT policy being unreachable is correct product behaviour.
import assert from "node:assert/strict";
import test from "node:test";
import { asUser, attempt, withRollback } from "../support/rls-client.ts";
import { createBookingFixture } from "../support/rls-fixtures.ts";

test("a student cannot insert their own booking_payments row", async () => {
  await withRollback(async (query) => {
    const { studentId, tutorId, bookingId } = await createBookingFixture(query);
    await asUser(query, studentId);

    const result = await attempt(
      query,
      "insert into booking_payments (booking_id, student_id, tutor_id, amount_cents) values ($1, $2, $3, 0)",
      [bookingId, studentId, tutorId],
    );

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "42501");
  });
});

test("a student cannot mark their own booking_payments row paid", async () => {
  await withRollback(async (query) => {
    const { studentId, tutorId, bookingId } = await createBookingFixture(query);

    // Create the payment record the way the webhook route does: service-role, bypassing RLS.
    const insert = await query(
      "insert into booking_payments (booking_id, student_id, tutor_id, amount_cents) values ($1, $2, $3, 5000) returning id",
      [bookingId, studentId, tutorId],
    );
    const paymentId = (insert.rows[0] as { id: string }).id;

    await asUser(query, studentId);
    const result = await attempt(query, "update booking_payments set amount_cents = 0 where id = $1", [
      paymentId,
    ]);

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "42501");
  });
});

test("a student cannot currently read their own booking_payments row (documents the missing SELECT grant above)", async () => {
  await withRollback(async (query) => {
    const { studentId, tutorId, bookingId } = await createBookingFixture(query);
    await query(
      "insert into booking_payments (booking_id, student_id, tutor_id, amount_cents) values ($1, $2, $3, 5000)",
      [bookingId, studentId, tutorId],
    );

    await asUser(query, studentId);
    const result = await attempt(query, "select * from booking_payments where booking_id = $1", [
      bookingId,
    ]);

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "42501");
  });
});
