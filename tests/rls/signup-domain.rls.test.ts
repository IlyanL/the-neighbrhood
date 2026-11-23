// Regression test for the Phase 1 "@uwo.ca enforced in the database" fix. It used to be
// browser-only, so anyone could sign up directly through Supabase Auth with any address.
// `enforce_allowed_signup_email` (a BEFORE INSERT trigger on auth.users) now rejects
// non-@uwo.ca addresses regardless of how the row gets inserted -- it fires for any role,
// which is why this doesn't need asUser()/asService() at all.
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { attempt, withRollback } from "../support/rls-client.ts";

test("a non-@uwo.ca signup is rejected", async () => {
  await withRollback(async (query) => {
    const result = await attempt(query, "insert into auth.users (id, email) values ($1, $2)", [
      randomUUID(),
      `rls-test-${randomUUID()}@gmail.com`,
    ]);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "42501");
      assert.match(result.message, /uwo\.ca/i);
    }
  });
});

test("a @uwo.ca signup is allowed", async () => {
  await withRollback(async (query) => {
    const result = await attempt(query, "insert into auth.users (id, email) values ($1, $2)", [
      randomUUID(),
      `rls-test-${randomUUID()}@uwo.ca`,
    ]);

    assert.equal(result.ok, true);
  });
});
