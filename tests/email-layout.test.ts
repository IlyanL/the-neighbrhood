import assert from "node:assert/strict";
import test from "node:test";
import { formatSessionTime, renderEmail, sessionDetails, siteLink, SUPPORT_EMAIL } from "../lib/notifications/email-layout.ts";
import { buildNotificationEmail } from "../lib/notifications/server.ts";

test("every notification email carries the logo, a link back to the site and a support address", () => {
  const mail = buildNotificationEmail({
    kind: "booking_confirmed",
    title: "Your CALC 1000 session is confirmed",
    body: "Your Online session with Priya Shah for CALC 1000 is booked. A calendar invite is attached.",
    path: "/?view=My%20Sessions&booking=b1",
    recipientName: "Maya Chen",
    ics: { method: "REQUEST" },
  });

  assert.match(mail.html, /logo-mark\.png/);
  assert.match(mail.html, /My%20Sessions&amp;booking=b1/);
  assert.ok(mail.html.includes(SUPPORT_EMAIL));
  assert.ok(mail.text.includes("Hi Maya,"), "greets by first name only");
  assert.ok(mail.text.includes("See your session: "), "the plain-text part keeps the link");
  // The calendar sentence moves out of the prose into the dedicated note, so it is said once.
  assert.equal(mail.text.match(/calendar invite/gi)?.length, 1);
});

test("user-supplied text cannot inject markup into the html part", () => {
  const mail = renderEmail({
    preheader: "x",
    heading: "<script>alert(1)</script>",
    paragraphs: ['"><img src=x onerror=alert(1)>'],
    details: [{ label: "Topic", value: "<b>bold</b>" }],
    reason: "r",
  });
  assert.ok(!mail.html.includes("<script>alert"));
  assert.ok(!mail.html.includes("<img src=x"));
  assert.ok(!mail.html.includes("<b>bold</b>"));
});

test("session times read in Eastern time, in the product's own style", () => {
  // 20:30 UTC on Sep 3 2026 is 4:30 p.m. in Toronto (EDT).
  assert.equal(formatSessionTime("2026-09-03T20:30:00Z"), "Thu Sep 3 · 4:30 p.m.");
  assert.equal(formatSessionTime("not a date"), null);
  assert.deepEqual(
    sessionDetails({ courseCode: "CALC 1000", deliveryMode: "Online", withLabel: "Tutor", withName: "Priya Shah" }).map((row) => row.label),
    ["Course", "Format", "Tutor"],
  );
});

test("relative app paths become absolute links; absolute ones are left alone", () => {
  assert.match(siteLink("/?view=Chat"), /^https?:\/\/[^/]+\/\?view=Chat$/);
  assert.equal(siteLink("https://example.org/x"), "https://example.org/x");
});
