import assert from "node:assert/strict";
import test from "node:test";
import { buildSessionInviteIcs, buildGenericEventIcs } from "../lib/notifications/ics.ts";

function unfold(ics: string): string {
  // Undo RFC 5545 line continuations (CRLF + a single leading space) before matching, since a
  // folded field's value can be split across physical lines at any octet boundary.
  return ics.replace(/\r\n /g, "");
}

function field(ics: string, name: string): string {
  const match = unfold(ics).match(new RegExp(`^${name}:(.*)$`, "m"));
  if (!match) throw new Error(`field ${name} not found in:\n${ics}`);
  return match[1];
}

const baseParams = {
  bookingId: "abc-123",
  courseCode: "CS 1027",
  deliveryMode: "Online",
  topic: "Recursion",
  requestedStartIso: "2026-03-01T15:00:00.000Z",
  organizerEmail: "organizer@theneighbrhood.ca",
  studentEmail: "student@uwo.ca",
  studentName: "Sam Student",
  tutorEmail: "tutor@uwo.ca",
  tutorName: "Tara Tutor",
};

test("a REQUEST invite is CONFIRMED and a CANCEL invite is CANCELLED", () => {
  const request = buildSessionInviteIcs({ ...baseParams, method: "REQUEST" });
  const cancel = buildSessionInviteIcs({ ...baseParams, method: "CANCEL" });
  assert.equal(field(request, "STATUS"), "CONFIRMED");
  assert.equal(field(request, "METHOD"), "REQUEST");
  assert.equal(field(cancel, "STATUS"), "CANCELLED");
  assert.equal(field(cancel, "METHOD"), "CANCEL");
});

test("method defaults to REQUEST when not given", () => {
  const ics = buildSessionInviteIcs(baseParams);
  assert.equal(field(ics, "METHOD"), "REQUEST");
});

test("SEQUENCE defaults to 0 and reflects an explicit value", () => {
  const defaulted = buildSessionInviteIcs(baseParams);
  const bumped = buildSessionInviteIcs({ ...baseParams, sequence: 3 });
  assert.equal(field(defaulted, "SEQUENCE"), "0");
  assert.equal(field(bumped, "SEQUENCE"), "3");
});

test("the UID is stable across sequences for the same booking, which is what tells a calendar app to replace rather than duplicate", () => {
  const first = buildSessionInviteIcs(baseParams);
  const second = buildSessionInviteIcs({ ...baseParams, sequence: 1 });
  assert.equal(field(first, "UID"), field(second, "UID"));
  assert.match(field(first, "UID"), /^booking-abc-123@theneighbrhood\.ca$/);
});

test("both attendees and the organizer are present", () => {
  const ics = unfold(buildSessionInviteIcs(baseParams));
  assert.match(ics, /ORGANIZER;CN=The Neighbrhood:mailto:organizer@theneighbrhood\.ca/);
  assert.match(ics, /ATTENDEE;CN=Sam Student;ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:student@uwo\.ca/);
  assert.match(ics, /ATTENDEE;CN=Tara Tutor;ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:tutor@uwo\.ca/);
});

test("special characters in free text are escaped per RFC 5545", () => {
  const ics = buildSessionInviteIcs({
    ...baseParams,
    courseCode: "CS 1027; Intro, Programming",
    topic: "A\\B\nnewline",
  });
  const description = field(ics, "DESCRIPTION");
  assert.doesNotMatch(description, /(?<!\\)[,;]/);
  assert.match(description, /A\\\\B\\nnewline/);
});

test("DTSTART/DTEND/DTSTAMP are UTC-formatted with punctuation and milliseconds stripped", () => {
  const ics = buildSessionInviteIcs(baseParams);
  const dtstart = field(ics, "DTSTART");
  const dtend = field(ics, "DTEND");
  assert.match(dtstart, /^\d{8}T\d{6}Z$/);
  assert.match(dtend, /^\d{8}T\d{6}Z$/);
  assert.equal(dtstart, "20260301T150000Z");
  // The session is fixed at 60 minutes.
  assert.equal(dtend, "20260301T160000Z");
});

test("a field long enough to need RFC 5545 line folding is folded with CRLF + a leading space, not left as one long line", () => {
  const ics = buildSessionInviteIcs({
    ...baseParams,
    topic: "A very long topic that pushes the DESCRIPTION field comfortably past the seventy five octet limit that RFC 5545 requires lines to fold at",
  });
  const rawLines = ics.split("\r\n");
  for (const line of rawLines) {
    if (!line.startsWith(" ")) {
      assert.ok(line.length <= 75, `unfolded line exceeded 75 octets: ${line}`);
    }
  }
  const foldedContinuation = rawLines.some((line) => line.startsWith(" "));
  assert.ok(foldedContinuation, "expected at least one folded continuation line");
});

test("a generic event omits DESCRIPTION and LOCATION when not given, and defaults the end time to +1h", () => {
  const ics = buildGenericEventIcs({
    id: "event-1",
    title: "Club fair",
    startsAtIso: "2026-04-01T18:00:00.000Z",
  });
  assert.doesNotMatch(ics, /\r\nDESCRIPTION:/);
  assert.doesNotMatch(ics, /\r\nLOCATION:/);
  assert.equal(field(ics, "DTSTART"), "20260401T180000Z");
  assert.equal(field(ics, "DTEND"), "20260401T190000Z");
  assert.equal(field(ics, "METHOD"), "PUBLISH");
  assert.equal(field(ics, "UID"), "event-event-1@theneighbrhood.ca");
});

test("a generic event includes DESCRIPTION and LOCATION when given, and respects an explicit end time", () => {
  const ics = buildGenericEventIcs({
    id: "event-2",
    title: "Study session",
    description: "Bring your notes",
    location: "UCC 145",
    startsAtIso: "2026-04-01T18:00:00.000Z",
    endsAtIso: "2026-04-01T20:00:00.000Z",
  });
  assert.equal(field(ics, "DESCRIPTION"), "Bring your notes");
  assert.equal(field(ics, "LOCATION"), "UCC 145");
  assert.equal(field(ics, "DTEND"), "20260401T200000Z");
});
