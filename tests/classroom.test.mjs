import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const policy = await import(new URL("../lib/classroom/policy.ts", import.meta.url));

test("classroom lifecycle exposes confirmed sessions and completed materials only", () => {
  const start = "2026-08-17T18:00:00.000Z";
  assert.equal(policy.classroomAccessMode({ status: "requested", requestedStart: start }), "unavailable");
  assert.equal(policy.classroomAccessMode({ status: "confirmed", requestedStart: start }), "interactive");
  assert.equal(policy.classroomAccessMode({ status: "completed", requestedStart: start }), "read-only");
});

test("a student's classroom window opens ten minutes before start and closes ten minutes after", () => {
  const input = { status: "confirmed", requestedStart: "2026-08-17T18:00:00.000Z", durationMinutes: 60 };
  assert.equal(policy.classroomJoinState(input, "student", new Date("2026-08-17T17:49:59.000Z")).canJoin, false);
  assert.equal(policy.classroomJoinState(input, "student", new Date("2026-08-17T17:50:00.000Z")).canJoin, true);
  const withinWindow = policy.classroomJoinState(input, "student", new Date("2026-08-17T18:09:00.000Z"));
  assert.equal(withinWindow.canJoin, true);
  assert.equal(withinWindow.access, "interactive");
  const afterWindow = policy.classroomJoinState(input, "student", new Date("2026-08-17T18:11:00.000Z"));
  assert.equal(afterWindow.canJoin, false);
  assert.equal(afterWindow.access, "read-only");
});

test("a tutor can open a confirmed classroom at any time, before the window and long after it", () => {
  const input = { status: "confirmed", requestedStart: "2026-08-17T18:00:00.000Z", durationMinutes: 60 };
  const early = policy.classroomJoinState(input, "tutor", new Date("2026-08-17T09:00:00.000Z"));
  assert.equal(early.canJoin, true);
  assert.equal(early.access, "interactive");
  const late = policy.classroomJoinState(input, "tutor", new Date("2026-08-17T20:00:00.000Z"));
  assert.equal(late.canJoin, true);
  assert.equal(late.access, "interactive");
  assert.equal(late.isLate, true);
});

test("file policy sanitizes names and rejects unsafe types and oversize uploads", () => {
  assert.equal(policy.sanitizeClassroomFileName("../../ Quiz / answers?.pdf"), "Quiz - answers.pdf");
  assert.equal(policy.validateClassroomFile({ name: "notes.md", size: 100, type: "text/markdown" }).ok, true);
  assert.equal(policy.validateClassroomFile({ name: "macro.exe", size: 100, type: "application/x-msdownload" }).ok, false);
  assert.equal(policy.validateClassroomFile({ name: "large.pdf", size: 21 * 1024 * 1024, type: "application/pdf" }).ok, false);
});

test("only the assigned tutor can end a classroom", () => {
  assert.equal(policy.canEndClassroom("tutor-id", "tutor-id"), true);
  assert.equal(policy.canEndClassroom("student-id", "tutor-id"), false);
});

test("database migration enforces one participant-only classroom and private files", () => {
  const migration = read("supabase/migrations/20260817150557_tutoring_digital_classroom.sql");
  assert.match(migration, /booking_id uuid not null unique references public\.bookings/);
  assert.match(migration, /Only the assigned tutor can end the classroom/);
  assert.match(migration, /Classroom participants can read classrooms/);
  assert.match(migration, /defaultAccesses|classroom-files/);
  assert.match(migration, /public = false/);
  assert.match(migration, /\(select auth\.uid\(\)\)/);
  assert.doesNotMatch(migration, /is_admin|role = 'admin'/);
});

test("provider tokens derive identity and room from server-authorized records", () => {
  const server = read("lib/classroom/server.ts");
  const media = read("app/api/classrooms/[bookingId]/livekit-token/route.ts");
  const collaboration = read("app/api/liveblocks-auth/route.ts");
  assert.match(server, /auth\.getUser\(token\)/);
  assert.match(server, /userId === booking\.student_id/);
  assert.match(server, /userId === booking\.tutor_id/);
  assert.match(media, /room: classroom\.livekit_room_name/);
  assert.match(media, /ttl: "10m"/);
  assert.match(collaboration, /defaultAccesses: \[\]/);
  assert.match(collaboration, /context\.booking\.student_id/);
  assert.match(collaboration, /context\.booking\.tutor_id/);
});

test("classroom chat and files stay inside the classroom instead of the Inbox", () => {
  const files = read("app/api/classrooms/[bookingId]/files/route.ts");
  const messages = read("app/api/classrooms/[bookingId]/messages/route.ts");
  const migration = read("supabase/migrations/20260818150428_separate_classroom_chat_and_restore_inbox.sql");
  assert.match(files, /classroom_file_id: inserted\.data\.id/);
  assert.match(files, /from\("classroom_messages"\)/);
  assert.match(files, /notifyOtherParticipant/);
  assert.match(messages, /from\("classroom_messages"\)/);
  assert.match(messages, /classroom_id: classroom\.id/);
  assert.doesNotMatch(messages, /chat_threads|chat_messages/);
  assert.match(migration, /Classroom participants can read classroom messages/);
});

test("the workspace-connected bubble is not rendered over the shared workspace", () => {
  const room = read("app/components/classroom/collaboration-room.tsx");
  const classroom = read("app/components/classroom/classroom-client.tsx");
  assert.doesNotMatch(room, /WorkspaceConnectionStatus/);
  assert.doesNotMatch(classroom, /WorkspaceConnectionStatus/);
});

test("LiveKit classroom controls are rendered inside a LayoutContextProvider", () => {
  const classroom = read("app/components/classroom/classroom-client.tsx");
  const providerStart = classroom.indexOf("<LayoutContextProvider>");
  const liveClassroom = classroom.indexOf("<LiveClassroom");
  const providerEnd = classroom.indexOf("</LayoutContextProvider>");
  assert.ok(providerStart >= 0 && liveClassroom > providerStart && liveClassroom < providerEnd);
});

test("whiteboard files use participant-authorized signed URLs without persisting credentials", () => {
  const fileElement = read("app/components/classroom/excalidraw-file-element.ts");
  assert.match(fileElement, /Authorization: `Bearer \$\{params\.accessToken\}`/);
  assert.match(fileElement, /files\/\$\{encodeURIComponent\(params\.fileId\)\}/);
  assert.doesNotMatch(fileElement, /customData:\s*\{[^}]*\burl\b/);
  assert.doesNotMatch(fileElement, /customData:\s*\{[^}]*accessToken/);
  assert.doesNotMatch(fileElement, /customData:\s*\{[^}]*signedUrl/);
});

test("the local-to-remote sync forwarder never publishes binary file bytes to Yjs", () => {
  const sync = read("app/components/classroom/use-yjs-excalidraw-store.ts");
  assert.match(sync, /excalidrawAPI\.onChange\(\(elements\) =>/);
  assert.doesNotMatch(sync, /excalidrawAPI\.onChange\(\([^)]*files[^)]*\)/);
});

test("whiteboard exposes the full drawing toolset without suppressing Excalidraw's stock UI", () => {
  const board = read("app/components/classroom/whiteboard.tsx");
  assert.match(board, /<Excalidraw\b/);
  assert.doesNotMatch(board, /UIOptions=\{\{[^}]*toolbar/);
  assert.match(board, /viewModeEnabled=\{props\.readOnly\}/);
  assert.match(board, /Insert or edit a LaTeX equation/);
  assert.match(board, /Upload or place a secure session file/);
  assert.match(board, /createPortal/);
});

test("the room's board is full-bleed and every other layer floats over it", () => {
  // The board used to be a boxed grid cell with the header and side column beside it,
  // which is nothing like the prototype. Everything now rides over a full-bleed board,
  // and Excalidraw's own four corners are moved out of the floating layers' way.
  const styles = read("app/components/neighbrhood-ds.css");
  assert.match(styles, /\.nb-room__board \{[^}]*position: absolute; inset: 0;/);
  assert.match(styles, /\.nb-room__scrim \{[^}]*background: var\(--scrim-top\);/);
  assert.match(styles, /\.nb-room__side \{[^}]*position: absolute;/);
  assert.match(styles, /\.nb-room__notice \{[^}]*position: absolute;/);
  assert.match(styles, /\.nb-room__board \.excalidraw \.App-menu_top \{/);
  assert.match(styles, /\.nb-room__board \.excalidraw \.App-menu_bottom \{/);
});

test("the room draws both participant slots even when only one person has joined", () => {
  const classroom = read("app/components/classroom/classroom-client.tsx");
  assert.match(classroom, /not here yet/);
  assert.match(classroom, /<RoomTile track=\{theirs\}/);
  assert.match(classroom, /<RoomTile track=\{mine\}/);
});

test("classroom workspace keeps Phase 5 tools focused and excludes executable code", () => {
  const classroom = read("app/components/classroom/classroom-client.tsx");
  const notes = read("app/components/classroom/shared-notes.tsx");
  assert.match(classroom, />Text editor</);
  assert.match(classroom, />Files</);
  assert.match(classroom, />Whiteboard</);
  assert.match(classroom, />Chat</);
  assert.doesNotMatch(classroom, /Code Editor/);
  assert.match(notes, /toggleCodeBlock/);
  assert.doesNotMatch(notes, /eval\(|new Function/);
});

test("whiteboard hydration merges remote elements instead of clobbering the local scene", () => {
  const sync = read("app/components/classroom/use-yjs-excalidraw-store.ts");
  assert.match(sync, /reconcileElements\(/);
  assert.doesNotMatch(sync, /updateScene\(\{\s*elements:\s*remoteElements/);
  assert.match(sync, /setLocalStateField\("user"/);
});

test("browser-only collaboration libraries are not evaluated during server rendering", () => {
  const loader = read("app/components/classroom/classroom-loader.tsx");
  const livePage = read("app/classroom/[bookingId]/page.tsx");
  const summaryPage = read("app/classroom/[bookingId]/summary/page.tsx");
  assert.match(loader, /ssr: false/);
  assert.match(loader, /import\("@\/app\/components\/classroom\/classroom-client"\)/);
  assert.match(livePage, /ClassroomLoader/);
  assert.match(summaryPage, /ClassroomLoader/);
});

/* The room once rendered as a blank page for a whole release. LiveKit's stylesheet is
   imported from classroom-client.tsx, so it lands after globals.css, and its
   `.lk-room-container { height: 100% }` sits on the same element as
   `.classroom-livekit-root`. A single-class app selector ties on specificity and loses
   on order; `height: 100%` then resolves against <body>, which has only `min-height`,
   so it computes to 0 — and every layer inside `.nb-room` is absolutely positioned, so
   nothing at all is drawn. These assertions exist so the doubled class is not tidied
   away, and so a new app rule sharing an element with a `.lk-*` class gets the same
   treatment rather than silently losing. */
test("app rules that share an element with a LiveKit class outrank LiveKit's own", () => {
  const css = read("app/globals.css");
  assert.match(css, /\.classroom-livekit-root\.classroom-livekit-root\s*\{[^}]*height:\s*100dvh/);
  assert.match(css, /\.classroom-prejoin \.lk-form-control\.lk-form-control\s*\{/);
});

/* PreJoin's camera-off state is a 320px stock silhouette, and it renders no label
   element at all — `userLabel` only becomes a placeholder, which is invisible because
   the name field is always pre-filled. Both are drawn in CSS over LiveKit's markup. */
test("the lobby's device card replaces LiveKit's stock camera-off art and labels its name field", () => {
  const css = read("app/globals.css");
  const client = read("app/components/classroom/classroom-client.tsx");
  assert.match(css, /\.lk-camera-off-note > svg \{[^}]*display:\s*none/);
  assert.match(css, /--prejoin-initials/);
  assert.match(css, /\.lk-username-container::before \{[^}]*content: "How your name shows in the room"/);
  assert.match(client, /--prejoin-initials/);
});
