import assert from "node:assert/strict";
import test, { mock } from "node:test";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fake-project.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "fake-anon-key";
// Left unset for most of this file — the route only takes the "admin sees private columns"
// branch when a service role key is configured, which is exactly the branch one test opts
// into on its own (see below).
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

type AuthResult = { data: { user: null | { id: string; email: string; email_confirmed_at: string | null } }; error: { message: string } | null };
type QueryResult = { data: unknown; error: { message: string } | null };

function chainableQuery(onSelect: (columns: string) => void, resolve: (eqCalls: Array<[string, unknown]>) => QueryResult) {
  const eqCalls: Array<[string, unknown]> = [];
  const builder = {
    select(columns: string) {
      onSelect(columns);
      return builder;
    },
    eq(column: string, value: unknown) {
      eqCalls.push([column, value]);
      return builder;
    },
    order() {
      return builder;
    },
    limit() {
      return builder;
    },
    maybeSingle: async () => resolve(eqCalls),
    then(onFulfilled: (value: QueryResult) => unknown, onRejected?: (reason: unknown) => unknown) {
      return Promise.resolve(resolve(eqCalls)).then(onFulfilled, onRejected);
    },
  };
  return builder;
}

function fakeSupabase(opts: {
  authResult: AuthResult;
  role?: string | null;
  acceptedRows?: unknown[];
  ownRow?: unknown | null;
}) {
  const selectCalls: string[] = [];
  const client = {
    auth: { getUser: async () => opts.authResult },
    from(table: string) {
      if (table === "profiles") {
        return chainableQuery(
          (cols) => selectCalls.push(`profiles:${cols}`),
          () => ({ data: opts.role === undefined ? null : { role: opts.role }, error: null }),
        );
      }
      if (table === "tutor_profiles") {
        return chainableQuery(
          (cols) => selectCalls.push(`tutor_profiles:${cols}`),
          (eqCalls) => {
            const isOwnLookup = eqCalls.some(([col]) => col === "id");
            if (isOwnLookup) return { data: opts.ownRow ?? null, error: null };
            return { data: opts.acceptedRows ?? [], error: null };
          },
        );
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
  return { client, selectCalls };
}

// mock.module can only register a given specifier once per process, so the swappable client
// lives behind a mutable reference each test reassigns before calling the route, rather than
// re-mocking per test.
let currentClient: unknown = null;
mock.module("@supabase/supabase-js", {
  namedExports: { createClient: () => currentClient },
});
function installSupabaseMock(client: unknown) {
  currentClient = client;
}

// Mocked directly (rather than exercised through the real limiter) so this file's rate-limit
// behaviour does not depend on which test happens to reach it first — see the note in
// auth-signup-route.test.ts about lib/rate-limit.ts caching its client at module scope.
let currentRateLimit = { allowed: true, retryAfterSeconds: 0 };
mock.module("@/lib/rate-limit", {
  namedExports: { checkRateLimit: async () => currentRateLimit },
});

// Each test needs its own fresh module instance, since the route reads
// SUPABASE_SERVICE_ROLE_KEY into a module-level const at import time — a cache-busting query
// string forces Node to treat each import as a distinct module. Built via string
// concatenation (not a literal import() argument) so tsc doesn't try to resolve the
// synthetic specifier as a real module path; the real type comes from the type-only import.
const ROUTE_PATH = "../app/api/tutors/route.ts";
type RouteModule = typeof import("../app/api/tutors/route.ts");
async function importRoute(cacheBuster: string): Promise<RouteModule> {
  return import(ROUTE_PATH + `?case=${cacheBuster}`) as Promise<RouteModule>;
}

const VERIFIED_USER = { id: "student-1", email: "student@uwo.ca", email_confirmed_at: "2026-01-01T00:00:00Z" };

test("no Authorization header is rejected before any Supabase call", async () => {
  const { GET } = await import("../app/api/tutors/route.ts");
  const res = await GET(new Request("http://localhost/api/tutors"));
  assert.equal(res.status, 401);
});

test("a session Supabase doesn't recognize is rejected", async () => {
  const { client } = fakeSupabase({ authResult: { data: { user: null }, error: { message: "invalid" } } });
  installSupabaseMock(client);
  const { GET } = await importRoute("invalid-session");
  const res = await GET(new Request("http://localhost/api/tutors", { headers: { authorization: "Bearer x" } }));
  assert.equal(res.status, 401);
});

test("an unverified email is rejected even with a valid session", async () => {
  const { client } = fakeSupabase({
    authResult: { data: { user: { ...VERIFIED_USER, email_confirmed_at: null } }, error: null },
  });
  installSupabaseMock(client);
  const { GET } = await importRoute("unverified");
  const res = await GET(new Request("http://localhost/api/tutors", { headers: { authorization: "Bearer x" } }));
  assert.equal(res.status, 403);
});

test("a verified request is rate-limited before any tutor_profiles query runs", async () => {
  currentRateLimit = { allowed: false, retryAfterSeconds: 20 };
  try {
    const { client } = fakeSupabase({ authResult: { data: { user: VERIFIED_USER }, error: null } });
    installSupabaseMock(client);
    const { GET } = await importRoute("rate-limited");
    const res = await GET(new Request("http://localhost/api/tutors", { headers: { authorization: "Bearer x" } }));
    assert.equal(res.status, 429);
    assert.equal(res.headers.get("Retry-After"), "20");
  } finally {
    currentRateLimit = { allowed: true, retryAfterSeconds: 0 };
  }
});

test("a non-admin request never asks for the private application columns", async () => {
  const { client, selectCalls } = fakeSupabase({
    authResult: { data: { user: VERIFIED_USER }, error: null },
    role: "student",
    acceptedRows: [{ id: "t1", application_status: "accepted", is_verified: true }],
  });
  installSupabaseMock(client);
  const { GET } = await importRoute("non-admin");
  const res = await GET(new Request("http://localhost/api/tutors", { headers: { authorization: "Bearer x" } }));

  assert.equal(res.status, 200);
  const tutorProfileSelects = selectCalls.filter((c) => c.startsWith("tutor_profiles:"));
  assert.ok(tutorProfileSelects.length > 0);
  for (const call of tutorProfileSelects) {
    assert.doesNotMatch(call, /admin_notes|interview_start|resume_path|transcript_path/);
  }
});

test("an admin with a service role key configured receives the private application columns", async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role-key";
  try {
    const { client, selectCalls } = fakeSupabase({
      authResult: { data: { user: VERIFIED_USER }, error: null },
      role: "admin",
      acceptedRows: [{ id: "t1", application_status: "pending", is_verified: false, admin_notes: "under review" }],
    });
    installSupabaseMock(client);
    const { GET } = await importRoute("admin");
    const res = await GET(new Request("http://localhost/api/tutors", { headers: { authorization: "Bearer x" } }));

    assert.equal(res.status, 200);
    const tutorProfileSelects = selectCalls.filter((c) => c.startsWith("tutor_profiles:"));
    assert.equal(tutorProfileSelects.length, 1);
    assert.match(tutorProfileSelects[0], /admin_notes/);
  } finally {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
});
