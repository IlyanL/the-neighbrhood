import assert from "node:assert/strict";
import test from "node:test";
import { resolveSiteOrigin } from "../lib/auth/site-origin.ts";
import { buildVerificationEmail, confirmUrl } from "../lib/auth/verification.ts";

function withEnv(vars: Record<string, string | undefined>, run: () => void) {
  const keys = ["NEXT_PUBLIC_SITE_URL", "SITE_URL", "VERCEL_PROJECT_PRODUCTION_URL", "VERCEL_URL"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const key of keys) delete process.env[key];
  for (const [key, value] of Object.entries(vars)) if (value !== undefined) process.env[key] = value;
  try {
    run();
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

const withHost = (host: string) => new Request(`https://${host}/api/auth/signup`);

test("a configured site URL wins, and its trailing slash is dropped", () => {
  withEnv({ NEXT_PUBLIC_SITE_URL: "https://neighbrhood.example/" }, () => {
    assert.equal(resolveSiteOrigin(withHost("evil.example")), "https://neighbrhood.example");
  });
});

test("with nothing configured, the platform's own domain is used rather than the request host", () => {
  withEnv({ VERCEL_PROJECT_PRODUCTION_URL: "neighbrhood.vercel.app" }, () => {
    assert.equal(resolveSiteOrigin(withHost("evil.example")), "https://neighbrhood.vercel.app");
  });
});

test("an unrecognised request host yields no origin at all, so no link is mailed", () => {
  // The whole point: a spoofed Host header must not put an attacker's domain in front of a
  // working verification token. The routes treat null as "refuse to send".
  withEnv({}, () => {
    assert.equal(resolveSiteOrigin(withHost("evil.example")), null);
  });
});

test("localhost is trusted so development can send links without configuration", () => {
  withEnv({}, () => {
    assert.equal(resolveSiteOrigin(new Request("http://localhost:3022/api/auth/signup")), "http://localhost:3022");
  });
});

test("the verification email carries the link in both the text and the html part", () => {
  const link = confirmUrl("https://neighbrhood.example", "token-abc", "signup");
  const mail = buildVerificationEmail({ link, purpose: "signup" });
  assert.ok(mail.text.includes(link));
  // Escaped in the html part — `&amp;` is what makes the href resolve back to this same URL.
  assert.ok(mail.html.includes(link.replace(/&/g, "&amp;")));
  assert.ok(mail.subject.length > 0);
});

test("a resent link says so rather than repeating the first-time wording", () => {
  const link = confirmUrl("https://neighbrhood.example", "token-abc", "magiclink");
  const first = buildVerificationEmail({ link, purpose: "signup" });
  const again = buildVerificationEmail({ link, purpose: "resend" });
  assert.notEqual(first.subject, again.subject);
  assert.ok(again.text.startsWith("Verify your email."));
});

test("the confirm link escapes a token that would otherwise break out of the html attribute", () => {
  const mail = buildVerificationEmail({ link: confirmUrl("https://x.example", 'a"><script>', "signup"), purpose: "signup" });
  assert.ok(!mail.html.includes("<script>"));
});
