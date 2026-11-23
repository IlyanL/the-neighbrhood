import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { fakeSupabaseClient } from "./support/fake-supabase.ts";
import { installTurnstileMock } from "./support/turnstile-fixture.ts";

const turnstile = installTurnstileMock();

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fake-project.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "fake-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role-key";
process.env.RESEND_API_KEY = "fake-resend-key";
process.env.NEXT_PUBLIC_SITE_URL = "https://neighbrhood.example";
delete process.env.VERCEL_URL;
delete process.env.VERCEL_PROJECT_PRODUCTION_URL;

let currentClient: unknown = null;
mock.module("@supabase/supabase-js", {
  namedExports: { createClient: () => currentClient },
});

const { POST: SIGNUP } = await import("../app/api/auth/signup/route.ts");
const { POST: RESEND } = await import("../app/api/auth/resend-verification/route.ts");

const signupUrl = "http://localhost/api/auth/signup";
const resendUrl = "http://localhost/api/auth/resend-verification";

/** Captures what would have gone to Resend, so a test can read the email we actually send. */
type SentEmail = { to: string; subject: string; text: string; html?: string };
function captureResend(): { sent: SentEmail[]; restore: () => void } {
  const sent: SentEmail[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("https://api.resend.com/")) {
      sent.push(JSON.parse(String(init?.body)) as SentEmail);
      return new Response(JSON.stringify({ id: "email_1" }), { status: 200 });
    }
    throw new Error(`unexpected fetch to ${url}`);
  }) as typeof globalThis.fetch;
  return { sent, restore: () => { globalThis.fetch = original; } };
}

const allowEveryRateLimit = () => ({ data: [{ allowed: true, retry_after_seconds: 0 }], error: null });

function post(url: string, body: unknown) {
  return new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

test("signup refuses a request that fails the Turnstile bot check", async () => {
  currentClient = fakeSupabaseClient({ rpc: allowEveryRateLimit });
  turnstile.result = { ok: false, status: 400, error: "Complete the verification challenge and try again." };
  try {
    const res = await SIGNUP(post(signupUrl, { fullName: "Sam Patel", email: "sam@uwo.ca", password: "longenough1", turnstileToken: "bad" }));
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "Complete the verification challenge and try again." });
  } finally {
    turnstile.result = { ok: true };
  }
});

test("signup refuses an address that is not a Western one", async () => {
  currentClient = fakeSupabaseClient({ rpc: allowEveryRateLimit });
  const res = await SIGNUP(post(signupUrl, { fullName: "Sam Patel", email: "sam@gmail.com", password: "longenough1" }));
  assert.equal(res.status, 400);
});

test("signup refuses a password under the shared minimum", async () => {
  currentClient = fakeSupabaseClient({ rpc: allowEveryRateLimit });
  const res = await SIGNUP(post(signupUrl, { fullName: "Sam Patel", email: "sam@uwo.ca", password: "short" }));
  assert.equal(res.status, 400);
});

test("signup refuses a request with no name to show other students", async () => {
  currentClient = fakeSupabaseClient({ rpc: allowEveryRateLimit });
  const res = await SIGNUP(post(signupUrl, { fullName: "   ", email: "sam@uwo.ca", password: "longenough1" }));
  assert.equal(res.status, 400);
});

test("signup mails a link to our own confirm page, not Supabase's action_link", async () => {
  const resend = captureResend();
  let generateLinkArgs: Record<string, unknown> | null = null;
  currentClient = fakeSupabaseClient({
    rpc: allowEveryRateLimit,
    generateLink: (params) => {
      generateLinkArgs = params;
      return {
        data: { properties: { hashed_token: "token-abc", action_link: "https://fake-project.supabase.co/auth/v1/verify?token=token-abc" } },
        error: null,
      };
    },
  });

  const res = await SIGNUP(post(signupUrl, { fullName: "Sam Patel", email: "Sam@UWO.ca", password: "longenough1" }));
  resend.restore();

  assert.equal(res.status, 200);
  assert.equal(generateLinkArgs!.type, "signup");
  // The address is normalised before it reaches Supabase, so casing cannot fork an account.
  assert.equal(generateLinkArgs!.email, "sam@uwo.ca");

  assert.equal(resend.sent.length, 1);
  const email = resend.sent[0];
  assert.equal(email.to, "sam@uwo.ca");
  const expectedLink = "https://neighbrhood.example/auth/confirm?token_hash=token-abc&type=signup";
  assert.ok(email.text.includes(expectedLink), "the plain-text part carries the confirm link");
  // `&` is an entity in the html part — that is what makes the href resolve to the same URL.
  assert.ok(email.html?.includes(expectedLink.replace("&", "&amp;")), "the html part carries the confirm link");
  // Supabase's own verify URL must never reach the inbox: the token is exchanged on our page.
  assert.ok(!email.text.includes("/auth/v1/verify"), "no Supabase action_link in the email");
});

test("signing up with an address that is already registered answers exactly like a new one", async () => {
  const resend = captureResend();
  currentClient = fakeSupabaseClient({
    rpc: (fn) => (fn === "unverified_signup_id"
      // Registered and already verified: nothing to re-send.
      ? { data: null, error: null }
      : allowEveryRateLimit()) as { data: unknown; error: unknown },
    generateLink: () => ({ data: null, error: { message: "User already registered" } }),
  });

  const res = await SIGNUP(post(signupUrl, { fullName: "Sam Patel", email: "sam@uwo.ca", password: "longenough1" }));
  resend.restore();

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(resend.sent.length, 0, "a verified account is not mailed a fresh sign-in link");
});

test("signing up again on an unverified address re-sends the link instead of dead-ending", async () => {
  const resend = captureResend();
  currentClient = fakeSupabaseClient({
    rpc: (fn) => (fn === "unverified_signup_id"
      ? { data: "user-1", error: null }
      : allowEveryRateLimit()) as { data: unknown; error: unknown },
    generateLink: (params) => (params.type === "signup"
      ? { data: null, error: { message: "User already registered" } }
      : { data: { properties: { hashed_token: "token-xyz" } }, error: null }),
  });

  const res = await SIGNUP(post(signupUrl, { fullName: "Sam Patel", email: "sam@uwo.ca", password: "longenough1" }));
  resend.restore();

  assert.equal(res.status, 200);
  assert.equal(resend.sent.length, 1);
  assert.ok(resend.sent[0].text.includes("token_hash=token-xyz&type=magiclink"));
});

test("resend sends nothing when the address has no unverified signup, and says nothing either way", async () => {
  const resend = captureResend();
  currentClient = fakeSupabaseClient({
    rpc: (fn) => (fn === "unverified_signup_id"
      ? { data: null, error: null }
      : allowEveryRateLimit()) as { data: unknown; error: unknown },
  });

  const res = await RESEND(post(resendUrl, { email: "stranger@uwo.ca" }));
  resend.restore();

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(resend.sent.length, 0, "a verified stranger is never mailed a passwordless link");
});

test("resend answers ok for an address that could never have an account here", async () => {
  currentClient = fakeSupabaseClient({ rpc: allowEveryRateLimit });
  const res = await RESEND(post(resendUrl, { email: "someone@gmail.com" }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

// Rate limiting is not asserted here on purpose: lib/rate-limit.ts caches its Supabase client
// at module scope, so the first test in this file that reaches the limiter fixes the fake for
// every test after it. checkRateLimit's own allow/deny behaviour is covered by
// tests/rate-limit.test.ts and tests/rate-limit-configured.test.ts.
