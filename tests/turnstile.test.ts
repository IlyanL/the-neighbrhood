import assert from "node:assert/strict";
import test from "node:test";
import { verifyTurnstileToken } from "../lib/turnstile.ts";

const originalFetch = globalThis.fetch;
const originalSecret = process.env.TURNSTILE_SECRET_KEY;

function stubSiteverify(respond: (body: URLSearchParams) => Response) {
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    return respond(new URLSearchParams(String(init?.body ?? "")));
  }) as typeof globalThis.fetch;
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env.TURNSTILE_SECRET_KEY = originalSecret;
});

test("fails closed when no secret key is configured", async () => {
  delete process.env.TURNSTILE_SECRET_KEY;
  const result = await verifyTurnstileToken("some-token", "signup");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 503);
});

test("rejects a missing or empty token without calling Cloudflare", async () => {
  process.env.TURNSTILE_SECRET_KEY = "test-secret";
  let called = false;
  globalThis.fetch = (async () => { called = true; throw new Error("should not be called"); }) as typeof globalThis.fetch;
  const result = await verifyTurnstileToken(undefined, "signup");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 400);
  assert.equal(called, false);
});

test("passes the token and secret to siteverify and accepts a matching action", async () => {
  process.env.TURNSTILE_SECRET_KEY = "test-secret";
  let seen: URLSearchParams | null = null;
  stubSiteverify((body) => {
    seen = body;
    return new Response(JSON.stringify({ success: true, action: "signup" }), { status: 200 });
  });

  const result = await verifyTurnstileToken("a-real-token", "signup");
  assert.equal(result.ok, true);
  assert.equal(seen!.get("secret"), "test-secret");
  assert.equal(seen!.get("response"), "a-real-token");
});

test("rejects a token issued for a different action", async () => {
  process.env.TURNSTILE_SECRET_KEY = "test-secret";
  // A token minted for the sign-up widget should not authorize the password-reset endpoint.
  stubSiteverify(() => new Response(JSON.stringify({ success: true, action: "signup" }), { status: 200 }));
  const result = await verifyTurnstileToken("a-real-token", "reset_password");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 400);
});

test("rejects when Cloudflare reports the token failed", async () => {
  process.env.TURNSTILE_SECRET_KEY = "test-secret";
  stubSiteverify(() => new Response(JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] }), { status: 200 }));
  const result = await verifyTurnstileToken("bad-token", "signup");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 400);
});

test("fails closed when Cloudflare's endpoint cannot be reached", async () => {
  process.env.TURNSTILE_SECRET_KEY = "test-secret";
  globalThis.fetch = (async () => { throw new Error("network down"); }) as typeof globalThis.fetch;
  const result = await verifyTurnstileToken("a-real-token", "signup");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 503);
});
