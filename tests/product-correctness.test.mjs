import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("capability derivation requires an accepted and verified tutor profile", () => {
  const source = read("lib/account-capabilities.ts");
  assert.match(source, /applicationStatus === "accepted" && profile\.isVerified === true/);
  assert.match(source, /isAdmin: input\.role === "admin"/);
  assert.match(source, /canUseStudentTutoring: true/);
});

test("Inbox is global while tutoring keeps capability-specific destinations", () => {
  const source = read("app/page.tsx");
  // The three tutoring destinations now ride the redesign's on-stage sub-tab
  // row (`tutoringSubTabs`) instead of the old in-page `tutoring-topnav`.
  assert.match(source, /label: "Find a tutor", selected: activeView === "View Tutors"/);
  assert.match(source, /label: "Sessions", selected: activeView === "My Sessions"/);
  assert.match(source, /label="Messages" glyph=\{NB_MESSAGES_GLYPH\} onClick=\{\(\) => goTo\("Chat"\)\}/);
  assert.doesNotMatch(source, /tutoring-topnav/);
  assert.match(source, /accountCapabilities\.isApprovedTutor \? "Tutor profile"/);
  assert.match(source, /: "Become a tutor"/);
});

test("course discussion values share a typed client source and matching database constraint", () => {
  const types = read("lib/course-post-types.ts");
  const migration = read("database/archived/023_phase4_product_correctness.sql");
  for (const value of ["question", "discussion"]) {
    assert.match(types, new RegExp(`value: "${value}"`));
    assert.match(migration, new RegExp(`'${value}'`));
  }
});

test("booking migration atomically claims a unique unbooked slot", () => {
  const migration = read("database/archived/023_phase4_product_correctness.sql");
  assert.match(migration, /unique index if not exists tutor_availability_tutor_start_unique/);
  assert.match(migration, /set is_booked = true/);
  assert.match(migration, /availability\.is_booked = false/);
  assert.match(migration, /before insert on public\.bookings/);
});

test("approved tutors retain separate student and tutor session views", () => {
  const source = read("app/components/views/sessions-view.tsx");
  assert.match(source, /sessionPerspective/);
  assert.match(source, />As a student</);
  assert.match(source, />As a tutor</);
});

test("session messages preserve booking and tutoring context", () => {
  const source = read("app/page.tsx");
  assert.match(source, /contextId: session\.id/);
  assert.match(source, /booking_id: bookingId \?\? null, context_type: contextType/);
});

test("housing and event details can open contextual Inbox conversations", () => {
  const page = read("app/page.tsx");
  const discovery = read("app/components/phase-two.tsx");
  const migration = read("supabase/migrations/20260818150428_separate_classroom_chat_and_restore_inbox.sql");
  assert.match(discovery, /Message about this listing/);
  assert.match(discovery, /Message organizer/);
  assert.match(page, /startContextConversation\(listing\.owner_id, "housing"/);
  assert.match(page, /startContextConversation\(organizerId, "event"/);
  assert.match(migration, /context_type in \('tutoring', 'housing', 'event', 'classroom'\)/);
  assert.match(migration, /Users can start valid inbox conversations/);
});

test("account shell exposes requested admin, tutoring, and notification behavior", () => {
  const page = read("app/page.tsx");
  const home = read("app/components/phase-two.tsx");
  /* Admin lives in the account menu, which is now `NbAccountMenu`'s items array. */
  assert.match(page, /accountCapabilities\.isAdmin \? \[\{ label: "Admin", onSelect: \(\) => goTo\("Admin"\) \}\] : \[\]/);
  /* The nav bar's Create menu is gone. Each of the three things it started is
     reached on the screen that owns it, and "Become a tutor" from the account
     rail, so none of the behaviour left with the menu. */
  assert.doesNotMatch(page, /className="create-menu"/);
  assert.match(page, /"Become a tutor"/);
  assert.match(home, /Post a housing opportunity/);
  assert.match(home, /action="Post an event"/);
  assert.match(page, /current\.filter\(\(item\) => item\.id !== notificationId\)/);
  assert.match(home, /filter === "tutoring"/);
  assert.match(home, /className="nb-feed__item"/);
});

test("explore owns courses, combines clubs and events, and housing accepts student opportunities", () => {
  const page = read("app/page.tsx");
  const views = read("app/components/phase-two.tsx");
  const navigation = read("app/components/product-navigation.ts");
  assert.doesNotMatch(page, /<NavButton active=\{activeView === "Courses"\}/);
  // Courses is reached from the nav bar's own six links, defined once in nb-chrome.
  assert.match(read("app/components/nb-chrome.tsx"), /\{ label: "Courses", view: "Courses" \}/);
  assert.match(views, /\{ key: "courses", label: "Courses" \}/);
  assert.match(views, /\{ key: "clubs", label: "Clubs & events" \}/);
  assert.match(views, /Post a housing opportunity/);
  assert.match(views, /Roommate wanted/);
  assert.match(views, /moderation_status: "pending"/);
  assert.match(navigation, /compose\?: "housing"/);
});

test("accepted verified tutors are fetched explicitly for discovery", () => {
  const route = read("app/api/tutors/route.ts");
  assert.match(route, /\.eq\("application_status", "accepted"\)/);
  assert.match(route, /\.eq\("is_verified", true\)/);
});

test("existing tutor edits avoid permission-heavy upsert and admin replaces apply in account menu", () => {
  const page = read("app/page.tsx");
  const serverAuth = read("lib/supabase/server-auth.ts");
  assert.match(page, /hasExistingTutorProfile\s*\? await supabase\.from\("tutor_profiles"\)\.update/);
  assert.match(page, /accountCapabilities\.isAdmin \? \[\{ label: "Admin", onSelect: \(\) => goTo\("Admin"\) \}\] : \[\]/);
  assert.match(serverAuth, /NEXT_PUBLIC_SUPABASE_ANON_KEY/);
});

test("dual-role session rows are unique and availability is managed from tutor profile", () => {
  const page = read("app/page.tsx");
  const profileViews = read("app/components/views/profile-views.tsx");
  assert.match(page, /new Map\(\[\.\.\.studentBookings, \.\.\.tutorBookings\]\.map\(\(booking\) => \[booking\.id, booking\]\)\)/);
  assert.match(profileViews, /<TutorAvailabilityManager profile=\{props\.tutorProfile\}/);
});

test("public tutor photos expose only accepted verified photo folders", () => {
  const route = read("app/api/tutors/[id]/photo/route.ts");
  const migration = read("database/archived/024_public_tutor_photos.sql");
  assert.match(route, /NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  assert.match(migration, /\(storage\.foldername\(name\)\)\[2\] = 'photo'/);
  assert.match(migration, /application_status = 'accepted'/);
  assert.match(migration, /is_verified = true/);
});

test("course catalogue sync is resumable and the directory uses filters with two status buttons", () => {
  const sync = read("lib/catalog-sync.ts");
  const route = read("app/api/catalog-sync/route.ts");
  const views = read("app/components/phase-two.tsx");
  assert.match(sync, /syncWesternCourseBatch/);
  assert.match(sync, /nextOffset/);
  assert.match(sync, /new Map\(allCourses\.map/);
  assert.match(route, /catalog === "courses"/);
  assert.match(views, />Subject<select/);
  assert.match(views, />Level<select/);
  /* The redesign replaced the "My courses" select with a chip row, and the
     two status buttons with DS toggles — the nine-glyph rule leaves no heart
     or check to draw them with. */
  assert.match(views, /courseStatusChips/);
  assert.match(views, /aria-pressed=\{interested\}.*>Interested</);
  assert.match(views, /aria-pressed=\{enrolled\}.*"Enrolled" : "Enrol"/);
  assert.doesNotMatch(views, /<option value="selected">Selected<\/option>/);
  assert.match(views, /\.range\(start, start \+ 999\)/);
});

test("a course thread opens as its own screen with its own stage header", () => {
  const view = read("app/components/phase-two.tsx");
  // The thread body used to expand inside the index card. It is a screen now,
  // so the index card only navigates and the replies live on the thread.
  assert.doesNotMatch(view, /Hide replies/);
  assert.match(view, /if \(activeThread && selected\) \{/);
  assert.match(view, /className="nb-tdetail"/);
  assert.match(view, /back: \{ label: `← All \$\{code\} threads`/);
  // Both shells hand the thread's own header to the stage.
  assert.match(view, /header=\{courseThreadHeader \?\? \{/);
  assert.match(read("app/page.tsx"), /\? courseThreadHeader \?\? \{/);
  assert.match(read("app/page.tsx"), /onThreadHeader=\{setCourseThreadHeader\}/);
});

test("reporting a course message records a row and never hides the message", () => {
  const view = read("app/components/phase-two.tsx");
  assert.match(view, /from\("course_discussion_reports"\)\.insert\(\{ discussion_id: activeThread\.id, comment_id: commentId, reporter_id: userId, reason: "other", status: "open" \}\)/);
  assert.match(view, /Reported · pending review/);
  // A second report from the same person trips the one-per-reporter index and
  // must read as "already reported", not as a failure.
  assert.match(view, /error\.code !== "23505"/);
  // Nothing in the view sets is_visible — only the admin route does.
  assert.doesNotMatch(view, /course_discussions"\)\.update\(\{ is_visible/);
  const route = read("app/api/admin/course-reports/route.ts");
  assert.match(route, /requireAdminProfile/);
  assert.match(route, /body\.hideMessage/);
  assert.match(route, /course_discussion_comments"\)\.update\(\{ is_visible: false \}\)/);
});

test("the thread aside prints only figures the app can actually know", () => {
  const view = read("app/components/phase-two.tsx");
  assert.match(view, /Tutors teaching it/);
  assert.match(view, /from\("tutor_courses"\)\.select\("tutor_id", \{ count: "exact", head: true \}\)/);
  // student_course_statuses is readable only by its own owner, so the
  // prototype's "Students following" figure is deliberately absent.
  assert.doesNotMatch(view, /Students following/);
});
