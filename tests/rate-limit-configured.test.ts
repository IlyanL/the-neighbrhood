import assert from "node:assert/strict";
import test, { mock } from "node:test";

// A separate file from rate-limit.test.ts on purpose: lib/rate-limit.ts reads its env vars
// and builds its Supabase client once, at first call, and caches it — so "configured" vs
// "unconfigured" has to be a process-level fact, not something toggled mid-file. `node --test`
// runs each file as its own process, which is what makes both versions possible at all.
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fake-project.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role-key";

let nextRpcResult: { data: unknown; error: { message: string } | null } = { data: null, error: null };

mock.module("@supabase/supabase-js", {
  namedExports: {
    createClient: () => ({
      rpc: async () => nextRpcResult,
    }),
  },
});

const { checkRateLimit } = await import("../lib/rate-limit.ts");

test("an allowed result from the RPC passes through with its retry-after value", async () => {
  nextRpcResult = { data: [{ allowed: true, retry_after_seconds: 0 }], error: null };
  const result = await checkRateLimit("k", 5, 1000);
  assert.deepEqual(result, { allowed: true, retryAfterSeconds: 0 });
});

test("a blocked result from the RPC is passed through, not silently allowed", async () => {
  nextRpcResult = { data: [{ allowed: false, retry_after_seconds: 42 }], error: null };
  const result = await checkRateLimit("k", 5, 1000);
  assert.deepEqual(result, { allowed: false, retryAfterSeconds: 42 });
});

test("an RPC error fails open — a transient database blip must not become an outage of every rate-limited endpoint", async () => {
  nextRpcResult = { data: null, error: { message: "connection reset" } };
  const result = await checkRateLimit("k", 5, 1000);
  assert.deepEqual(result, { allowed: true, retryAfterSeconds: 0 });
});

test("a malformed row (missing/non-boolean allowed) fails open rather than throwing", async () => {
  nextRpcResult = { data: [{ allowed: "not-a-boolean", retry_after_seconds: 5 }], error: null };
  const result = await checkRateLimit("k", 5, 1000);
  assert.deepEqual(result, { allowed: true, retryAfterSeconds: 0 });
});

test("an empty row set fails open", async () => {
  nextRpcResult = { data: [], error: null };
  const result = await checkRateLimit("k", 5, 1000);
  assert.deepEqual(result, { allowed: true, retryAfterSeconds: 0 });
});
