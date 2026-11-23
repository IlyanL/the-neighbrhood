import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { installTurnstileMock } from "./support/turnstile-fixture.ts";

const turnstile = installTurnstileMock();

let currentRateLimit = { allowed: true, retryAfterSeconds: 0 };
mock.module("@/lib/rate-limit", {
  namedExports: { checkRateLimit: async () => currentRateLimit },
});

type Sent = { to: string; subject: string; text: string; html?: string; replyTo?: string };
const sent: Sent[] = [];
let sendResult = "sent";
mock.module("@/lib/notifications/server", {
  namedExports: {
    sendEmail: async (to: string, subject: string, text: string, _ics: unknown, _key: string, html?: string, replyTo?: string) => {
      sent.push({ to, subject, text, html, replyTo });
      return sendResult;
    },
  },
});

const { POST } = await import("../app/api/contact/route.ts");

const valid = { name: "Maya Chen", email: "Maya@uwo.ca", topic: "Bug report", message: "The book button does nothing on CALC 1000.", turnstileToken: "ok" };
const post = (body: unknown) => POST(new Request("http://localhost/api/contact", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
}));

test("a valid message goes to the support inbox only, with reply-to set to the sender", async () => {
  sent.length = 0;
  const res = await post(valid);
  assert.equal(res.status, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "support@theneighbrhood.ca");
  assert.equal(sent[0].replyTo, "maya@uwo.ca");
  assert.equal(sent[0].subject, "[Contact] Bug report · Maya Chen");
  assert.ok(sent[0].text.includes("The book button does nothing"));
});

test("a newline in the name cannot add a header to the subject line", async () => {
  sent.length = 0;
  await post({ ...valid, name: "Maya\r\nBcc: victim@example.com" });
  assert.ok(!/[\r\n]/.test(sent[0].subject));
});

test("the message is escaped in the html part", async () => {
  sent.length = 0;
  await post({ ...valid, message: "<script>alert(1)</script> please help" });
  assert.ok(!sent[0].html?.includes("<script>alert"));
});

test("a filled honeypot looks like success but sends nothing", async () => {
  sent.length = 0;
  const res = await post({ ...valid, website: "http://spam.example" });
  assert.equal(res.status, 200);
  assert.equal(sent.length, 0);
});

test("bad input, a failed bot check and rate limiting all refuse without sending", async () => {
  sent.length = 0;
  assert.equal((await post({ ...valid, topic: "Free money" })).status, 400);
  assert.equal((await post({ ...valid, email: "not-an-email" })).status, 400);
  assert.equal((await post({ ...valid, message: "hi" })).status, 400);

  turnstile.result = { ok: false, status: 400, error: "Complete the verification challenge and try again." };
  assert.equal((await post(valid)).status, 400);
  turnstile.result = { ok: true };

  currentRateLimit = { allowed: false, retryAfterSeconds: 900 };
  assert.equal((await post(valid)).status, 429);
  currentRateLimit = { allowed: true, retryAfterSeconds: 0 };

  assert.equal(sent.length, 0);
});

test("a failed send tells the visitor to email support instead", async () => {
  sendResult = "failed";
  const res = await post(valid);
  sendResult = "sent";
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /support@theneighbrhood\.ca/);
});
