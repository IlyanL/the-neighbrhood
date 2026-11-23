import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { called, fakeSupabaseClient } from "./support/fake-supabase.ts";
import { fakeBooking, fakeContext, installClassroomServerMock } from "./support/classroom-fixtures.ts";

const hooks = installClassroomServerMock();

let currentRateLimit = { allowed: true, retryAfterSeconds: 0 };
mock.module("@/lib/rate-limit", {
  namedExports: { checkRateLimit: async () => currentRateLimit },
});

const { GET, POST } = await import("../app/api/classrooms/[bookingId]/files/route.ts");

function paramsFor(bookingId: string) {
  return { params: Promise.resolve({ bookingId }) };
}

function textFile(name: string, type: string, content: string) {
  return new File([content], name, { type });
}

test("GET with no classroom yet returns an empty file list", async () => {
  hooks.authorizeClassroomRequest = async () => fakeContext({ supabase: fakeSupabaseClient({}) });
  hooks.getClassroom = async () => null;
  const res = await GET(new Request("http://localhost/api/classrooms/b1/files"), paramsFor("b1"));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(body.files, []);
});

test("GET lists files for an existing classroom", async () => {
  hooks.authorizeClassroomRequest = async () => fakeContext({
    supabase: fakeSupabaseClient({
      tables: { classroom_files: () => ({ data: [{ id: "f1", display_name: "notes.pdf" }], error: null }) },
    }),
  });
  const res = await GET(new Request("http://localhost/api/classrooms/b1/files"), paramsFor("b1"));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.files.length, 1);
});

test("POST is rate-limited before validating the file", async () => {
  currentRateLimit = { allowed: false, retryAfterSeconds: 30 };
  try {
    hooks.authorizeClassroomRequest = async () => fakeContext({ supabase: fakeSupabaseClient({}) });
    const form = new FormData();
    form.set("file", textFile("x.pdf", "application/pdf", "hi"));
    const res = await POST(new Request("http://localhost/api/classrooms/b1/files", { method: "POST", body: form }), paramsFor("b1"));
    assert.equal(res.status, 429);
  } finally {
    currentRateLimit = { allowed: true, retryAfterSeconds: 0 };
  }
});

test("POST rejects an upload whose declared Content-Length is over the cap, before formData is read", async () => {
  hooks.authorizeClassroomRequest = async () => fakeContext({ supabase: fakeSupabaseClient({}) });
  const form = new FormData();
  form.set("file", textFile("huge.pdf", "application/pdf", "hi"));
  const res = await POST(
    new Request("http://localhost/api/classrooms/b1/files", {
      method: "POST",
      headers: { "content-length": String(21 * 1024 * 1024) },
      body: form,
    }),
    paramsFor("b1"),
  );
  assert.equal(res.status, 413);
});

test("POST rejects uploads to a completed (read-only) classroom", async () => {
  hooks.authorizeClassroomRequest = async () => fakeContext({
    booking: fakeBooking({ status: "completed" }),
    supabase: fakeSupabaseClient({}),
  });
  const form = new FormData();
  form.set("file", textFile("x.pdf", "application/pdf", "hi"));
  const res = await POST(new Request("http://localhost/api/classrooms/b1/files", { method: "POST", body: form }), paramsFor("b1"));
  assert.equal(res.status, 409);
});

test("POST rejects a disallowed file type before ever touching storage", async () => {
  let storageTouched = false;
  hooks.authorizeClassroomRequest = async () => fakeContext({
    supabase: fakeSupabaseClient({
      storage: {
        "classroom-files": {
          upload: async () => {
            storageTouched = true;
            return { error: null };
          },
        },
      },
    }),
  });
  const form = new FormData();
  form.set("file", textFile("virus.exe", "application/x-msdownload", "hi"));
  const res = await POST(new Request("http://localhost/api/classrooms/b1/files", { method: "POST", body: form }), paramsFor("b1"));
  assert.equal(res.status, 400);
  assert.equal(storageTouched, false);
});

test("a valid upload stores the file, records it, and notifies the other participant", async () => {
  let notified = false;
  hooks.notifyOtherParticipant = async () => {
    notified = true;
  };
  hooks.authorizeClassroomRequest = async () => fakeContext({
    supabase: fakeSupabaseClient({
      tables: {
        classroom_files: () => ({ data: { id: "f1", classroom_id: "classroom-1", uploader_id: "student-1", display_name: "notes.pdf", mime_type: "application/pdf", size_bytes: 2, created_at: "2026-01-01T00:00:00Z", board_placement: null }, error: null }),
        classroom_messages: () => ({ data: null, error: null }),
        classroom_audit_events: (calls) => {
          assert.ok(called(calls, "insert"));
          return { data: null, error: null };
        },
      },
      storage: {
        "classroom-files": {
          upload: async () => ({ error: null }),
        },
      },
    }),
  });
  const form = new FormData();
  form.set("file", textFile("notes.pdf", "application/pdf", "hi"));
  const res = await POST(new Request("http://localhost/api/classrooms/b1/files", { method: "POST", body: form }), paramsFor("b1"));
  const body = await res.json();
  assert.equal(res.status, 201);
  assert.equal(body.file.display_name, "notes.pdf");
  assert.equal(notified, true);
});
