// Same bug shape as the bookings/profiles guards above, on a table that was never checked
// in Phase 1: `tutor_profiles` has a full table-level UPDATE grant for `authenticated` (no
// column-level restriction), so the ONLY thing stopping a tutor from self-approving their
// own application is the `protect_tutor_moderation_fields` trigger. Unlike bookings/profiles,
// there is no grant-level backstop here -- if this trigger has a gap, there's nothing else
// standing in the way of a pending or rejected applicant just marking themselves accepted.
import assert from "node:assert/strict";
import test from "node:test";
import { asUser, attempt, createUser, withRollback } from "../support/rls-client.ts";

test("a pending tutor cannot self-approve their own application", async () => {
  await withRollback(async (query) => {
    const tutorId = await createUser(query, "pending-tutor");
    // No asService() here -- inserting as the plain connection role is deliberate: the
    // moderation trigger forces INSERT rows to pending/unverified for anyone who isn't
    // service-role or an admin, which is exactly the starting state this test wants.
    await query(
      `insert into tutor_profiles (id, display_name, year, gpa_range)
       values ($1, 'Pending Tutor', '2nd year', '3.0-3.5')`,
      [tutorId],
    );

    await asUser(query, tutorId);
    const result = await attempt(
      query,
      "update tutor_profiles set application_status = 'accepted', is_verified = true where id = $1",
      [tutorId],
    );

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "42501");
  });
});

test("a tutor can still edit their own listing details", async () => {
  await withRollback(async (query) => {
    const tutorId = await createUser(query, "self-editor-tutor");
    await query(
      `insert into tutor_profiles (id, display_name, year, gpa_range)
       values ($1, 'Pending Tutor', '2nd year', '3.0-3.5')`,
      [tutorId],
    );

    await asUser(query, tutorId);
    const result = await attempt(
      query,
      "update tutor_profiles set display_name = 'Updated Name' where id = $1 returning display_name",
      [tutorId],
    );

    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.rows[0]?.display_name, "Updated Name");
  });
});
