// Regression test for the Phase 1 critical bug (docs/production-readiness.md): a signed-in
// student could run `supabase.from('bookings').update({ payment_status: 'paid' })` from the
// browser console and get a free session. The same gap let them reassign `tutor_id` (into a
// private classroom with an arbitrary person) or `requested_start`. Fixed with column-level
// GRANTs (authenticated may only touch session_notes/status/topic/updated_at) plus a
// `protect_booking_participant_fields` trigger as a second line of defense.
import assert from "node:assert/strict";
import test from "node:test";
import { asPostgres, asUser, attempt, withRollback } from "../support/rls-client.ts";
import { createBookingFixture } from "../support/rls-fixtures.ts";

// The fixture inserts at the `requested` default. Move it to whatever state a case needs on
// the postgres connection, which the status guard lets through by design.
async function setStatus(
  query: (sql: string, params?: unknown[]) => Promise<unknown>,
  bookingId: string,
  status: string,
) {
  await asPostgres(query as never);
  await query("update bookings set status = $1 where id = $2", [status, bookingId]);
}

test("a student cannot set their own booking to paid", async () => {
  await withRollback(async (query) => {
    const { studentId, bookingId } = await createBookingFixture(query);
    await asUser(query, studentId);

    const result = await attempt(query, "update bookings set payment_status = 'paid' where id = $1", [
      bookingId,
    ]);

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "42501");
  });
});

test("a student cannot reassign their booking to a different tutor", async () => {
  await withRollback(async (query) => {
    const { studentId, bookingId } = await createBookingFixture(query);
    const { tutorId: otherTutorId } = await createBookingFixture(query);
    await asUser(query, studentId);

    const result = await attempt(query, "update bookings set tutor_id = $1 where id = $2", [
      otherTutorId,
      bookingId,
    ]);

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "42501");
  });
});

test("a student cannot rewrite their booking's requested_start directly", async () => {
  await withRollback(async (query) => {
    const { studentId, bookingId } = await createBookingFixture(query);
    await asUser(query, studentId);

    const result = await attempt(query, "update bookings set requested_start = now() where id = $1", [
      bookingId,
    ]);

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "42501");
  });
});

// --- status transition guard -------------------------------------------------------
// 20260910120000_enforce_booking_status_transitions.sql. The column GRANTs above decide
// *which* columns a participant may write; these decide which transitions are legal.
// Previously any participant could set `status` to any value, and the bypass was:
//   book and pay -> cancel >12h out for a full refund -> set status back to 'confirmed'
//   -> attend free, because classroom access reads status and never reads payment_status.

test("a student cannot reopen a cancelled booking (the refund-then-rejoin bypass)", async () => {
  await withRollback(async (query) => {
    const { studentId, bookingId } = await createBookingFixture(query);
    await setStatus(query, bookingId, "cancelled");
    await asUser(query, studentId);

    const result = await attempt(query, "update bookings set status = 'confirmed' where id = $1", [
      bookingId,
    ]);

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "42501");
  });
});

test("a student cannot reopen a completed booking to regain the live classroom", async () => {
  await withRollback(async (query) => {
    const { studentId, bookingId } = await createBookingFixture(query);
    await setStatus(query, bookingId, "completed");
    await asUser(query, studentId);

    const result = await attempt(query, "update bookings set status = 'confirmed' where id = $1", [
      bookingId,
    ]);

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "42501");
  });
});

// Cancelling has to go through /api/payments/cancel-booking (service role), which computes
// the refund and the 12-hour fee. Writing the status directly skipped both.
test("a participant cannot cancel a booking by writing the status directly", async () => {
  await withRollback(async (query) => {
    const { studentId, bookingId } = await createBookingFixture(query);
    await setStatus(query, bookingId, "confirmed");
    await asUser(query, studentId);

    const result = await attempt(query, "update bookings set status = 'cancelled' where id = $1", [
      bookingId,
    ]);

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "42501");
  });
});

// 'declined' was the side door to the same result, minus the cancellation fee.
test("a student cannot decline their own booking to dodge the cancellation fee", async () => {
  await withRollback(async (query) => {
    const { studentId, bookingId } = await createBookingFixture(query);
    await setStatus(query, bookingId, "confirmed");
    await asUser(query, studentId);

    const result = await attempt(query, "update bookings set status = 'declined' where id = $1", [
      bookingId,
    ]);

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "42501");
  });
});

test("only the tutor may propose a new time", async () => {
  await withRollback(async (query) => {
    const { studentId, tutorId, bookingId } = await createBookingFixture(query);
    await setStatus(query, bookingId, "confirmed");

    await asUser(query, studentId);
    const asStudent = await attempt(
      query,
      "update bookings set status = 'time_change_requested' where id = $1",
      [bookingId],
    );
    assert.equal(asStudent.ok, false, "a student must not be able to propose a new time");
    if (!asStudent.ok) assert.equal(asStudent.code, "42501");

    await setStatus(query, bookingId, "confirmed");
    await asUser(query, tutorId);
    const asTutor = await attempt(
      query,
      "update bookings set status = 'time_change_requested' where id = $1 returning status",
      [bookingId],
    );
    assert.equal(asTutor.ok, true, "request_booking_time_change's transition must still work");
  });
});

// The overdue sweep in app/page.tsx and the tutor's "end classroom" action both do this.
test("either participant can still finish a confirmed session", async () => {
  await withRollback(async (query) => {
    const { studentId, bookingId } = await createBookingFixture(query);
    await setStatus(query, bookingId, "confirmed");
    await asUser(query, studentId);

    const result = await attempt(
      query,
      "update bookings set status = 'completed' where id = $1 returning status",
      [bookingId],
    );

    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.rows[0]?.status, "completed");
  });
});

// The guard is `before update of status`, so it must not interfere with the other columns
// the 2026-08-29 grants still allow a participant to edit.
test("a participant can still edit the topic on a completed booking", async () => {
  await withRollback(async (query) => {
    const { studentId, bookingId } = await createBookingFixture(query);
    await setStatus(query, bookingId, "completed");
    await asUser(query, studentId);

    const result = await attempt(query, "update bookings set topic = 'revision' where id = $1", [
      bookingId,
    ]);

    assert.equal(result.ok, true);
  });
});

// --- the trigger, independent of the column grants -----------------------------------
// Everything above is enforced by the column GRANTs, which reject the statement before the
// trigger ever runs — so those tests pass whether or not the trigger works. It did not:
// private.protect_booking_participant_fields was SECURITY DEFINER, and its
// `current_user not in ('authenticated','anon')` escape hatch therefore compared against the
// function's OWNER (`postgres`) and returned early on every call. Fixed by
// 20260910130000_revive_booking_participant_field_guard.sql (SECURITY INVOKER).
//
// Widening the grants inside the rolled-back transaction is what makes the trigger the thing
// actually under test. Before that migration every case here SUCCEEDED.
for (const [label, sql] of [
  ["payment_status", "update bookings set payment_status = 'paid' where id = $1"],
  ["requested_start", "update bookings set requested_start = now() where id = $1"],
  ["ics_sequence", "update bookings set ics_sequence = 99 where id = $1"],
] as const) {
  test(`the participant-field trigger blocks ${label} even if the column grants are widened`, async () => {
    await withRollback(async (query) => {
      const { studentId, bookingId } = await createBookingFixture(query);
      await asPostgres(query);
      await query("grant update on table bookings to authenticated");
      await asUser(query, studentId);

      const result = await attempt(query, sql, [bookingId]);

      assert.equal(result.ok, false, `${label} must be refused by the trigger, not only by the grants`);
      if (!result.ok) assert.equal(result.code, "42501");
    });
  });
}

// The load-bearing case for that fix: move_booking_time is SECURITY DEFINER and owned by
// postgres, and it legitimately rewrites requested_start. A `role`-GUC-based guard would
// break rescheduling outright; only current_user distinguishes it from a direct write.
test("move_booking_time can still rewrite requested_start through the guard", async () => {
  await withRollback(async (query) => {
    const { studentId, tutorId, bookingId } = await createBookingFixture(query);
    await setStatus(query, bookingId, "confirmed");

    const newStart = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    newStart.setUTCMinutes(0, 0, 0);
    await asPostgres(query);
    await query(
      `insert into tutor_availability (tutor_id, starts_at, is_booked)
       values ($1, $2, false), ($1, $3, false)`,
      [tutorId, newStart.toISOString(), new Date(newStart.getTime() + 30 * 60_000).toISOString()],
    );

    await asUser(query, studentId);
    const result = await attempt(query, "select id from move_booking_time($1, $2)", [
      bookingId,
      newStart.toISOString(),
    ]);

    assert.equal(result.ok, true, "rescheduling must still work through the vetted RPC");
  });
});

// --- #7: session length ---------------------------------------------------------------
// bookings.duration_minutes allowed 15..240 while app/api/payments/checkout/route.ts charged
// tutor_profiles.hourly_rate_cents flat and lib/notifications/ics.ts hardcoded a 60-minute
// event. A 120-minute booking would have been billed for one hour. Pinned to 60 by
// 20260910140000_lock_booking_duration_to_one_hour.sql; if that is ever relaxed, the price
// and the calendar invite have to become duration-aware in the same change.
test("a booking cannot be given a duration the flat hourly price would undercharge", async () => {
  await withRollback(async (query) => {
    const { bookingId } = await createBookingFixture(query);
    await asPostgres(query);

    const result = await attempt(query, "update bookings set duration_minutes = 120 where id = $1", [
      bookingId,
    ]);

    assert.equal(result.ok, false, "duration_minutes is pinned to 60 while the price is flat");
    if (!result.ok) assert.equal(result.code, "23514"); // check_violation
  });
});
