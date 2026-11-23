// notifications has a full table-level INSERT grant for `authenticated` -- unlike the
// bookings/profiles guards, there's no column-grant backstop here. The
// "Booking participants can create notifications" policy is the *only* thing stopping one
// user from writing a notification into someone else's feed (a phishing/spam vector, and
// exactly the kind of attacker-controlled write the Phase 1 "email flooding" fix was about
// on the API side -- this is the same shape one layer down, at the table itself).
import assert from "node:assert/strict";
import test from "node:test";
import { asUser, attempt, createUser, withRollback } from "../support/rls-client.ts";
import { createBookingFixture } from "../support/rls-fixtures.ts";

test("a non-participant cannot forge a notification onto someone else's booking", async () => {
  await withRollback(async (query) => {
    const { studentId, bookingId } = await createBookingFixture(query);
    const outsiderId = await createUser(query, "outsider");
    await asUser(query, outsiderId);

    const result = await attempt(
      query,
      `insert into notifications (user_id, booking_id, kind, title, body)
       values ($1, $2, 'booking_update', 'You have a new session', 'Forged notification')`,
      [studentId, bookingId],
    );

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "42501");
  });
});

test("a participant cannot address a notification to someone outside the booking", async () => {
  await withRollback(async (query) => {
    const { studentId, bookingId } = await createBookingFixture(query);
    const outsiderId = await createUser(query, "outsider");
    await asUser(query, studentId);

    const result = await attempt(
      query,
      `insert into notifications (user_id, booking_id, kind, title, body)
       values ($1, $2, 'booking_update', 'You have a new session', 'Misaddressed notification')`,
      [outsiderId, bookingId],
    );

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "42501");
  });
});

test("a participant can still notify themselves about their own booking", async () => {
  await withRollback(async (query) => {
    const { studentId, bookingId } = await createBookingFixture(query);
    await asUser(query, studentId);

    const result = await attempt(
      query,
      `insert into notifications (user_id, booking_id, kind, title, body)
       values ($1, $2, 'booking_update', 'You have a new session', 'Real notification')
       returning user_id`,
      [studentId, bookingId],
    );

    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.rows[0]?.user_id, studentId);
  });
});
