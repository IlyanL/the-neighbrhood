import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("clicking a Home feed item switches session perspective, not just the tab, so tutor requests are actually visible", () => {
  const source = read("app/components/views/sessions-view.tsx");
  assert.match(source, /focusedSession\.tutorId === props\.currentUserId && focusedSession\.studentId !== props\.currentUserId/);
  assert.match(source, /setSessionPerspective\("tutor"\)/);
});

test("the tutor perspective toggle shows \"As a tutor\" before \"As a student\"", () => {
  const source = read("app/components/views/sessions-view.tsx");
  const tutorIndex = source.indexOf(">As a tutor<");
  const studentIndex = source.indexOf(">As a student<");
  assert.ok(tutorIndex > -1 && studentIndex > -1 && tutorIndex < studentIndex);
});

test("club cards line up regardless of content length", () => {
  // The old card reserved a fixed min-height per line to keep a row even. The
  // redesign's group card is the design system's `.nb-tutor` tile in an
  // auto-fill grid, whose rows stretch to the tallest card on their own.
  const view = read("app/components/phase-two.tsx");
  assert.match(view, /function ClubCard\(\{ club, nextEvent, onOpen, followed, onFollow \}/);
  assert.match(view, /className="nb-tutor"/);
  const ds = read("app/components/neighbrhood-ds.css");
  assert.match(ds, /\.nb-tutors \{[^}]*display: grid/);
});

test("clubs and housing both expose a filter for the student's own saved/followed items", () => {
  const source = read("app/components/phase-two.tsx");
  assert.match(source, /followedOnly.*setFollowedOnly/);
  /* Housing's saved filter is the redesign's chip row: "all", a listing type,
     or "saved", single-select — it replaced a separate savedOnly toggle. */
  assert.match(source, /chip === "saved" \? saved\.has\(item\.id\)/);
  assert.match(source, /userId \? \[\{ value: "saved", label: "Saved" \}\]/);
});

test("tutor availability is set by dragging across a week grid, not one datetime picker at a time", () => {
  const source = read("app/components/views/availability.tsx");
  assert.match(source, /AVAILABILITY_GRID_SLOTS/);
  assert.match(source, /function beginDrag/);
  assert.match(source, /function continueDrag/);
  assert.doesNotMatch(source, /Add a future time slot/);
});

test("the availability grid offers half-hour start times through midnight and the sidebar form can shrink instead of overflowing into the session list", () => {
  const source = read("app/components/views/availability.tsx");
  assert.match(source, /length: 32 \}, \(_, index\) => \(\{ hour: 8 \+ Math\.floor\(index \/ 2\), minute: \(index % 2\) \* 30/);
  assert.match(source, /className="nb-avail__scroll"/);
  const cssSource = read("app/globals.css");
  /* The student-side picker's old `.availability-*` chrome went with the tutor
     detail redesign; the manager's grid is the DS one and nothing else. */
  assert.doesNotMatch(cssSource, /\.availability-grid/);
  const dsSource = read("app/components/neighbrhood-ds.css");
  assert.match(dsSource, /\.nb-avail__scroll \{ overflow-x: auto;/);
});

test("the availability week always starts on Monday regardless of what day it is today", () => {
  const source = read("app/components/views/availability.tsx");
  assert.match(source, /function mondayOf\(date: Date\)/);
  assert.match(source, /day === 0 \? -6 : 1 - day/);
  assert.match(source, /const start = mondayOf\(new Date\(\)\);/);
});

test("a half-hour mark is only offered to students when the following half-hour is also open (2:00-3:30 marked yields only 2:00 and 2:30 as bookable starts)", () => {
  const source = read("app/page.tsx");
  assert.match(source, /const open = new Set\(slots\.filter\(\(slot\) => !slot\.is_booked\)\.map/);
  assert.match(source, /const starts = Array\.from\(open\)\.filter\(\(iso\) => open\.has\(new Date\(new Date\(iso\)\.getTime\(\) \+ 30 \* 60 \* 1000\)\.toISOString\(\)\)\)/);
  assert.match(source, /availability: bookableStartTimes\(row\.tutor_availability \?\? \[\]\)/);
  assert.doesNotMatch(source, /availability: futureSlots\(\(row\.tutor_availability/);
});

test("booking one half-hour option atomically consumes both segments so the overlapping option can never be double-booked", () => {
  const migration = read("supabase/migrations/20260819200000_half_hour_booking_segments.sql");
  assert.match(migration, /starts_at = new\.requested_start \+ interval '30 minutes'/);
  assert.match(migration, /claimed_second_half is null/);
  assert.match(migration, /starts_at = old\.requested_start \+ interval '30 minutes'/);
});

/* The theme boot script must not be a JSX <script> in <head>. Ad-blocking extensions
   append their own script into <head> before React hydrates, React matches this element
   against the extension's tag, and every page in the app logs "A tree hydrated but some
   attributes … didn't match". A JSX <script> anywhere outside <head> makes React warn
   instead ("Scripts inside React components are never executed"), so the script travels
   as markup inside a hidden wrapper: server-rendered it is a real script tag that runs
   during parse, and on a client navigation React only sets innerHTML, which never
   executes — by which time the theme is applied anyway. */
test("the theme boot script ships as markup in the body, not a script element in the head", () => {
  const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(layout, /<script\s+(suppressHydrationWarning|dangerouslySetInnerHTML)/);
  assert.match(layout, /<div hidden suppressHydrationWarning dangerouslySetInnerHTML=\{\{ __html: `<script>\$\{themeBootScript\}/);
  assert.match(layout, /<body[^>]*suppressHydrationWarning/);
});
