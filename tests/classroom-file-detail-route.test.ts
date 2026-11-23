import assert from "node:assert/strict";
import test from "node:test";
import { fakeSupabaseClient } from "./support/fake-supabase.ts";
import { fakeContext, fakeUser, TUTOR_ID, installClassroomServerMock } from "./support/classroom-fixtures.ts";

const hooks = installClassroomServerMock();

const { GET, DELETE } = await import("../app/api/classrooms/[bookingId]/files/[fileId]/route.ts");

function paramsFor(bookingId: string, fileId: string) {
  return { params: Promise.resolve({ bookingId, fileId }) };
}

const FILE_ROW = {
  id: "f1",
  classroom_id: "classroom-1",
  uploader_id: "student-1",
  storage_path: "classroom-1/student-1/x-notes.pdf",
  display_name: "notes.pdf",
  mime_type: "application/pdf",
  size_bytes: 10,
  created_at: "2026-01-01T00:00:00Z",
};

test("a file that doesn't belong to this classroom's booking is 404, not leaked", async () => {
  hooks.authorizeClassroomRequest = async () => fakeContext({
    supabase: fakeSupabaseClient({
      tables: { classroom_files: () => ({ data: null, error: null }) },
    }),
  });
  const res = await GET(new Request("http://localhost/api/classrooms/b1/files/f1"), paramsFor("b1", "f1"));
  assert.equal(res.status, 404);
});

test("GET returns a short-lived signed URL for an authorized file", async () => {
  hooks.authorizeClassroomRequest = async () => fakeContext({
    supabase: fakeSupabaseClient({
      tables: { classroom_files: () => ({ data: FILE_ROW, error: null }) },
      storage: {
        "classroom-files": {
          createSignedUrl: async (path, expiresIn) => {
            assert.equal(path, FILE_ROW.storage_path);
            assert.equal(expiresIn, 120);
            return { data: { signedUrl: "https://signed.example/f1" }, error: null };
          },
        },
      },
    }),
  });
  const res = await GET(new Request("http://localhost/api/classrooms/b1/files/f1"), paramsFor("b1", "f1"));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.url, "https://signed.example/f1");
  assert.equal(body.expiresInSeconds, 120);
});

test("DELETE by someone other than the uploader is forbidden", async () => {
  hooks.authorizeClassroomRequest = async () => fakeContext({
    user: fakeUser(TUTOR_ID),
    participantRole: "tutor",
    supabase: fakeSupabaseClient({
      tables: { classroom_files: () => ({ data: FILE_ROW, error: null }) },
    }),
  });
  const res = await DELETE(new Request("http://localhost/api/classrooms/b1/files/f1", { method: "DELETE" }), paramsFor("b1", "f1"));
  assert.equal(res.status, 403);
});

test("DELETE by the uploader removes the storage object, the row, and logs an audit event", async () => {
  let removedPaths: string[] | undefined;
  let deletedFileId: unknown;
  let auditLogged = false;
  hooks.authorizeClassroomRequest = async () => fakeContext({
    supabase: fakeSupabaseClient({
      tables: {
        classroom_files: (calls) => {
          const deleteCall = calls.find((c) => c.method === "delete");
          const eqCall = calls.find((c) => c.method === "eq");
          if (deleteCall) deletedFileId = eqCall?.args[1];
          return { data: FILE_ROW, error: null };
        },
        classroom_audit_events: () => {
          auditLogged = true;
          return { data: null, error: null };
        },
      },
      storage: {
        "classroom-files": {
          remove: async (paths) => {
            removedPaths = paths;
            return { error: null };
          },
        },
      },
    }),
  });
  const res = await DELETE(new Request("http://localhost/api/classrooms/b1/files/f1", { method: "DELETE" }), paramsFor("b1", "f1"));
  assert.equal(res.status, 200);
  assert.deepEqual(removedPaths, [FILE_ROW.storage_path]);
  assert.equal(deletedFileId, FILE_ROW.id);
  assert.equal(auditLogged, true);
});
