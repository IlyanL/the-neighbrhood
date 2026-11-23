// Regression test for the Phase 1 "profile hijacking" bug: a user could edit every column
// of their own profiles row, including `email` (the notification delivery target) and
// `role` (self-promotion to admin). Fixed with column-level GRANTs -- `authenticated` may
// only touch bio/faculty/full_name/interests/major/year. `email` and `role` were never
// granted at all, so this is enforced before RLS or the `protect_profile_role_change`
// trigger even run; it's the same defense-in-depth pattern as the bookings guard.
import assert from "node:assert/strict";
import test from "node:test";
import { asUser, attempt, createUser, withRollback } from "../support/rls-client.ts";

test("a user cannot promote their own role to admin", async () => {
  await withRollback(async (query) => {
    const userId = await createUser(query, "self-promoter");
    await asUser(query, userId);

    const result = await attempt(query, "update profiles set role = 'admin' where id = $1", [userId]);

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "42501");
  });
});

test("a user cannot rewrite their own email", async () => {
  await withRollback(async (query) => {
    const userId = await createUser(query, "email-rewriter");
    await asUser(query, userId);

    const result = await attempt(query, "update profiles set email = 'attacker@uwo.ca' where id = $1", [
      userId,
    ]);

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "42501");
  });
});

test("a user can still edit their own display fields", async () => {
  await withRollback(async (query) => {
    const userId = await createUser(query, "self-editor");
    await asUser(query, userId);

    const result = await attempt(
      query,
      "update profiles set full_name = 'Test Name', major = 'Computer Science' where id = $1 returning full_name",
      [userId],
    );

    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.rows[0]?.full_name, "Test Name");
  });
});
