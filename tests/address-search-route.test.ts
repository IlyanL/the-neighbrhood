import assert from "node:assert/strict";
import test, { afterEach, mock } from "node:test";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fake-project.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "fake-anon-key";

type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

let currentAuthUser: { id: string } | null = null;
let currentRateLimit: RateLimitResult = { allowed: true, retryAfterSeconds: 0 };

mock.module("@supabase/supabase-js", {
  namedExports: {
    createClient: () => ({
      auth: {
        getUser: async () => (currentAuthUser
          ? { data: { user: currentAuthUser }, error: null }
          : { data: { user: null }, error: { message: "invalid" } }),
      },
    }),
  },
});

mock.module("@/lib/rate-limit", {
  namedExports: {
    checkRateLimit: async () => currentRateLimit,
  },
});

const { GET } = await import("../app/api/address-search/route.ts");

const originalFetch = global.fetch;
let fetchCalls: Array<{ url: string }> = [];

afterEach(() => {
  global.fetch = originalFetch;
  fetchCalls = [];
  currentAuthUser = null;
  currentRateLimit = { allowed: true, retryAfterSeconds: 0 };
});

function refusingFetch(): typeof fetch {
  return (() => {
    throw new Error("upstream Nominatim should not have been called");
  }) as typeof fetch;
}

function recordingFetch(rows: Array<{ place_id: number; display_name: string }>): typeof fetch {
  return ((url: string | URL) => {
    fetchCalls.push({ url: String(url) });
    return Promise.resolve(new Response(JSON.stringify(rows), { status: 200 }));
  }) as typeof fetch;
}

test("no Authorization header is rejected and never reaches the upstream service", async () => {
  global.fetch = refusingFetch();
  const res = await GET(new Request("http://localhost/api/address-search?q=123+Main+St"));
  assert.equal(res.status, 401);
});

test("a session Supabase doesn't recognize is rejected and never reaches the upstream service", async () => {
  global.fetch = refusingFetch();
  currentAuthUser = null;
  const res = await GET(new Request("http://localhost/api/address-search?q=123+Main+St", {
    headers: { authorization: "Bearer x" },
  }));
  assert.equal(res.status, 401);
});

test("a rate-limited caller gets 429 with Retry-After and never reaches the upstream service", async () => {
  global.fetch = refusingFetch();
  currentAuthUser = { id: "student-1" };
  currentRateLimit = { allowed: false, retryAfterSeconds: 17 };
  const res = await GET(new Request("http://localhost/api/address-search?q=123+Main+St", {
    headers: { authorization: "Bearer x" },
  }));
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("retry-after"), "17");
});

test("a query under 3 characters short-circuits to an empty list without calling upstream", async () => {
  global.fetch = refusingFetch();
  currentAuthUser = { id: "student-1" };
  const res = await GET(new Request("http://localhost/api/address-search?q=12", {
    headers: { authorization: "Bearer x" },
  }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { suggestions: [] });
});

test("a valid query calls the upstream service and maps its response shape", async () => {
  global.fetch = recordingFetch([{ place_id: 42, display_name: "123 Main St, London, ON" }]);
  currentAuthUser = { id: "student-1" };
  const res = await GET(new Request("http://localhost/api/address-search?q=123+Main+St", {
    headers: { authorization: "Bearer x" },
  }));
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.deepEqual(body.suggestions, [{ id: "42", label: "123 Main St, London, ON" }]);
  assert.equal(fetchCalls.length, 1);
  assert.match(fetchCalls[0].url, /^https:\/\/nominatim\.openstreetmap\.org\/search\?/);
  assert.match(fetchCalls[0].url, /q=123\+Main\+St/);
  assert.match(fetchCalls[0].url, /countrycodes=ca/);
});
