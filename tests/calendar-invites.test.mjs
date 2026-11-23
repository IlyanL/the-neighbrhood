import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("the .ics invite is the only calendar mechanism in the app — there is no Google Calendar OAuth path left to defer to", () => {
  const source = read("lib/notifications/server.ts");
  assert.match(source, /export async function buildBookingIcs/);
  assert.doesNotMatch(source, /google_calendar_connections/);
});

test("Google Calendar integration was fully removed, not left as dead/unreachable code", () => {
  assert.equal(existsSync(new URL("../app/api/google-calendar", import.meta.url)), false);
});

test("a recipient gets one email with both the session details and the calendar file, not two separate emails", () => {
  const server = read("lib/notifications/server.ts");
  // sendEmail accepts an optional ics attachment, and createNotification forwards its own
  // ics param straight through — the caller builds the invite once and attaches it to the
  // same notification email, instead of firing a second, calendar-only email afterward.
  //
  // These match loosely on purpose. The previous version asserted sendEmail's exact
  // parameter list, so adding an idempotency key — which changed nothing about this
  // behaviour — failed the test. Like the rest of this suite it still only reads source
  // text; `node --test` has no TypeScript loader, which is why none of these tests can
  // execute the code they describe. Replacing that is its own piece of work.
  assert.match(server, /export async function sendEmail\(/);
  assert.match(server, /ics\?: \{ content: string; method: "REQUEST" \| "CANCEL" \}/);
  // The body is now the rendered branded email (mail.text / mail.html) rather than the raw
  // one-line params.body, but the ics still rides along on the same call.
  assert.match(server, /await sendEmail\(\s*params\.emailTo,\s*params\.title,\s*mail\.text,\s*params\.ics/);
});

test("every path that can leave a booking confirmed builds the invite once and gives each of the student and tutor their own single combined email", () => {
  const source = read("app/api/notifications/route.ts");
  const buildCalls = source.match(/await buildBookingIcs\(/g) ?? [];
  const notifyCalls = source.match(/eventKey: `booking-confirmed:\$\{booking\.id\}:(student|tutor)`|eventKey: `booking-status:\$\{booking\.id\}:confirmed:\$\{booking\.updated_at\}:(student|tutor)`|eventKey: `time-change-accepted:\$\{booking\.id\}:\$\{booking\.updated_at\}:(student|tutor)`/g) ?? [];
  // Three confirmation paths (direct booking, tutor accepting a request, accepting a proposed
  // time change) each build one invite and notify both the student and tutor with it.
  assert.equal(buildCalls.length, 3);
  assert.equal(notifyCalls.length, 6);
});

test("a student's self-serve reschedule and a booking cancellation both re-send the invite, once each, folded into the existing notification email", () => {
  const reschedule = read("app/api/payments/reschedule-booking/route.ts");
  const cancel = read("app/api/payments/cancel-booking/route.ts");
  assert.match(reschedule, /await buildBookingIcs\(/);
  assert.match(cancel, /await buildBookingIcs\(/);
  assert.match(cancel, /method: "CANCEL"/);
  // Each route builds the invite exactly once per event, not once per recipient.
  assert.equal((reschedule.match(/await buildBookingIcs\(/g) ?? []).length, 1);
  assert.equal((cancel.match(/await buildBookingIcs\(/g) ?? []).length, 1);
});

// The ICS builder itself (BEGIN:VEVENT, METHOD/STATUS mapping, attendees, RFC 5545 line
// folding, SEQUENCE) now has real behavioural coverage in tests/ics.test.ts, which imports
// and calls lib/notifications/ics.ts directly instead of regex-matching its source text.

test("the invite's SEQUENCE persists on the booking row and increases on every send, which is what makes an update replace the original invite instead of duplicating it", () => {
  const server = read("lib/notifications/server.ts");
  const migration = read("supabase/migrations/20260827180000_ics_sequence_tracking.sql");
  assert.match(migration, /alter table public\.bookings add column if not exists ics_sequence integer not null default 0/);
  assert.match(server, /select\("ics_sequence"\)/);
  assert.match(server, /update\(\{ ics_sequence: sequence \+ 1 \}\)/);
});
