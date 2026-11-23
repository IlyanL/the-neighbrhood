import assert from "node:assert/strict";
import test from "node:test";
import {
  REVIEW_PROMPT_MAX_VIEWS,
  REVIEW_PROMPT_WINDOW_MS,
  isWithinReviewWindow,
  selectReviewableSessions,
} from "../app/components/review-prompts.ts";

const NOW = Date.parse("2026-09-10T18:00:00.000Z");
const hoursAgo = (hours: number) => new Date(NOW - hours * 60 * 60 * 1000).toISOString();

function booking(overrides: Partial<{ id: string; status: string; tutorId: string; requestedStartIso: string }> = {}) {
  return {
    id: "booking-1",
    status: "completed",
    tutorId: "tutor-1",
    requestedStartIso: hoursAgo(2),
    ...overrides,
  };
}

const student = { currentUserId: "student-1", reviewedTutorIds: new Set<string>(), now: NOW };

test("a finished, unreviewed hour is reviewable", () => {
  const result = selectReviewableSessions([booking()], student);
  assert.deepEqual(result.map((row) => row.id), ["booking-1"]);
});

test("an hour the student already reviewed the tutor for is not offered", () => {
  const result = selectReviewableSessions([booking()], { ...student, reviewedTutorIds: new Set(["tutor-1"]) });
  assert.deepEqual(result, []);
});

test("a tutor is never asked to review their own hour", () => {
  const result = selectReviewableSessions([booking({ tutorId: "student-1" })], student);
  assert.deepEqual(result, []);
});

test("an hour that has not finished is not offered", () => {
  for (const status of ["requested", "confirmed", "cancelled", "declined", "time_change_requested"]) {
    assert.deepEqual(selectReviewableSessions([booking({ status })], student), [], status);
  }
});

test("the prompt expires two days after the session", () => {
  assert.deepEqual(selectReviewableSessions([booking({ requestedStartIso: hoursAgo(47) })], student).length, 1);
  assert.deepEqual(selectReviewableSessions([booking({ requestedStartIso: hoursAgo(49) })], student), []);
});

test("several hours with one tutor collapse to the most recent", () => {
  const result = selectReviewableSessions([
    booking({ id: "old", requestedStartIso: hoursAgo(40) }),
    booking({ id: "recent", requestedStartIso: hoursAgo(3) }),
    booking({ id: "middle", requestedStartIso: hoursAgo(20) }),
  ], student);
  assert.deepEqual(result.map((row) => row.id), ["recent"]);
});

test("different tutors each get their own prompt", () => {
  const result = selectReviewableSessions([
    booking({ id: "a", tutorId: "tutor-1" }),
    booking({ id: "b", tutorId: "tutor-2" }),
  ], student);
  assert.deepEqual(result.map((row) => row.id).sort(), ["a", "b"]);
});

test("the review window is two days and the view budget is three", () => {
  assert.equal(REVIEW_PROMPT_WINDOW_MS, 2 * 24 * 60 * 60 * 1000);
  assert.equal(REVIEW_PROMPT_MAX_VIEWS, 3);
});

test("an unparseable session time keeps the prompt rather than dropping it", () => {
  assert.equal(isWithinReviewWindow(undefined, NOW), true);
  assert.equal(isWithinReviewWindow("not a date", NOW), true);
});
