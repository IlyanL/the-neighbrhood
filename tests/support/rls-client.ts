// Phase 4 part 3: RLS tests against the live database (docs/production-readiness.md).
// These need a direct Postgres connection, not the Supabase JS client -- only a raw
// connection can run `set local role` and forge `request.jwt.claims` the way the
// project's own manual DO $$ verification technique does (see the doc's "Verifying a
// database change" section). This file is that technique, reusable from `node --test`.
import { Client, type QueryResult } from "pg";
import { randomUUID } from "node:crypto";

export type QueryFn = (sql: string, params?: unknown[]) => Promise<QueryResult>;

export type AttemptResult =
  | { ok: true; rows: QueryResult["rows"] }
  | { ok: false; code?: string; message: string };

function connectionString(): string {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    throw new Error(
      "SUPABASE_DB_URL is not set. These tests need a direct Postgres connection (to run " +
        "`set local role` and fake a JWT), which the app's anon/service-role keys don't " +
        "provide. Get it from the Supabase dashboard: Project Settings -> Database -> " +
        "Connection string -> Session pooler, `postgres` user -- then add it to .env.local " +
        "as SUPABASE_DB_URL=...",
    );
  }
  return url;
}

/**
 * Runs `fn` inside one Postgres transaction that is ALWAYS rolled back, success or
 * failure. Fixture rows created inside it and every attempted attack are discarded --
 * nothing this ever does is visible outside the test, and production data is never at risk.
 */
export async function withRollback<T>(fn: (query: QueryFn) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: connectionString() });
  await client.connect();
  const query: QueryFn = (sql, params) => client.query(sql, params);
  try {
    await query("begin");
    return await fn(query);
  } finally {
    await query("rollback").catch(() => {});
    await client.end();
  }
}

/** Simulates one signed-in user's request: their JWT `sub` claim, under the `authenticated` role. */
export async function asUser(query: QueryFn, userId: string): Promise<void> {
  await query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
  await query("set local role authenticated");
}

/**
 * Simulates the app's service-role client (what the payment webhook and admin routes use).
 * Several guard triggers explicitly exempt `request.jwt.claim.role = 'service_role'` --
 * fixture setup that needs to get past them (e.g. approving a tutor application) uses this
 * rather than fighting the trigger.
 */
export async function asService(query: QueryFn): Promise<void> {
  await query("select set_config('request.jwt.claim.role', 'service_role', true)");
}

/** Drops back to the connection's own role and clears any simulated identity. */
export async function asPostgres(query: QueryFn): Promise<void> {
  await query("reset role");
  await query("select set_config('request.jwt.claims', '', true)");
  await query("select set_config('request.jwt.claim.role', '', true)");
}

/**
 * Attempts one statement inside a savepoint, so a Postgres error (a denied grant, RLS
 * policy, or guard trigger -- exactly what these tests are checking for) doesn't abort the
 * whole transaction. Leaves the transaction exactly where it was before the attempt either
 * way: fixture rows survive an expected failure, and a successful attack is still rolled
 * back by the time the test asserts on it.
 */
export async function attempt(
  query: QueryFn,
  sql: string,
  params: unknown[] = [],
): Promise<AttemptResult> {
  await query("savepoint attempt");
  try {
    const result = await query(sql, params);
    await query("release savepoint attempt");
    return { ok: true, rows: result.rows };
  } catch (err) {
    await query("rollback to savepoint attempt");
    const pgErr = err as { code?: string; message?: string };
    return { ok: false, code: pgErr.code, message: pgErr.message ?? String(err) };
  }
}

/** A `@uwo.ca` address that won't collide with anything real or with another test run. */
export function fixtureEmail(label: string): string {
  return `rls-test-${label}-${randomUUID()}@uwo.ca`;
}

/**
 * Creates a throwaway `auth.users` row. `handle_new_user` (an AFTER INSERT trigger) creates
 * the matching `profiles` row automatically, exactly as it does for a real signup.
 */
export async function createUser(query: QueryFn, label: string): Promise<string> {
  const id = randomUUID();
  await query("insert into auth.users (id, email) values ($1, $2)", [id, fixtureEmail(label)]);
  return id;
}
