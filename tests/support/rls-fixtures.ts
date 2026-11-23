// Shared fixture builders for tests/rls/*.rls.test.ts. Every row created here lives only
// inside the caller's withRollback() transaction (see rls-client.ts) and is discarded when
// it ends -- these never touch real data.
import { asPostgres, asService, asUser, createUser, type QueryFn } from "./rls-client.ts";

export type BookingFixture = { studentId: string; tutorId: string; bookingId: string };

/**
 * A confirmable booking between a fresh student and a fresh, fully-accepted tutor, with the
 * two half-hour availability slots it needs already open. Mirrors what a real booking
 * requires: `claim_tutor_slot_for_booking` (the BEFORE INSERT trigger on `bookings`) checks
 * the tutor is accepted+verified and claims two matching `tutor_availability` rows.
 */
export async function createBookingFixture(query: QueryFn): Promise<BookingFixture> {
  const studentId = await createUser(query, "student");
  const tutorId = await createUser(query, "tutor");

  // Approving a tutor application is normally an admin-only action (protect_tutor_moderation_fields
  // forces new tutor_profiles rows to pending/unverified for anyone else) -- go in as the
  // service-role client would, the same way the real admin route does.
  await asService(query);
  await query(
    `insert into tutor_profiles (id, display_name, year, gpa_range, application_status, is_verified)
     values ($1, 'RLS Test Tutor', '3rd year', '3.5-4.0', 'accepted', true)`,
    [tutorId],
  );
  await asPostgres(query);

  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  start.setUTCMinutes(0, 0, 0);
  const startIso = start.toISOString();
  const secondHalfIso = new Date(start.getTime() + 30 * 60 * 1000).toISOString();

  await query(
    `insert into tutor_availability (tutor_id, starts_at, is_booked) values ($1, $2, false), ($1, $3, false)`,
    [tutorId, startIso, secondHalfIso],
  );

  // claim_tutor_slot_for_booking requires auth.uid() = student_id regardless of role --
  // the postgres connection role bypasses RLS but not this explicit trigger check.
  await asUser(query, studentId);
  const result = await query(
    `insert into bookings (student_id, tutor_id, course_code, requested_start, delivery_mode)
     values ($1, $2, 'CS 1026', $3, 'Online') returning id`,
    [studentId, tutorId, startIso],
  );
  await asPostgres(query);

  return { studentId, tutorId, bookingId: (result.rows[0] as { id: string }).id };
}
