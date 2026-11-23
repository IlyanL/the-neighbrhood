import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isAllowedAccountEmail, isApprovedLegacyEmail, isWesternEmail, MIN_PASSWORD_LENGTH, normalizeWesternEmail, safeAppReturnPath } from "../lib/auth-policy.ts";

const root = new URL("../", import.meta.url);
const source = async (path) => readFile(new URL(path, root), "utf8");

test("Western email policy rejects suffix and subdomain spoofing", () => {
  assert.equal(normalizeWesternEmail(" Student@UWO.CA "), "student@uwo.ca");
  assert.equal(isWesternEmail("student@uwo.ca"), true);
  assert.equal(isWesternEmail("student@uwo.ca.example.com"), false);
  assert.equal(isWesternEmail("student@fakeuwo.ca"), false);
  assert.equal(isWesternEmail("@uwo.ca"), false);
  assert.equal(isApprovedLegacyEmail(" test-account@example.com "), true);
  assert.equal(isApprovedLegacyEmail("someone@gmail.com"), false);
  assert.equal(isAllowedAccountEmail("owner@example.com"), true);
  assert.equal(isAllowedAccountEmail("student@uwo.ca"), true);
  assert.equal(isAllowedAccountEmail("someone@gmail.com"), false);
  assert.equal(MIN_PASSWORD_LENGTH, 8);
});

test("post-auth redirects stay on this application", () => {
  assert.equal(safeAppReturnPath("/?view=Chat&thread=abc"), "/?view=Chat&thread=abc");
  assert.equal(safeAppReturnPath("//evil.example/path"), "/?view=Home");
  assert.equal(safeAppReturnPath("https://evil.example/path"), "/?view=Home");
});

test("completed whiteboards never publish local Yjs mutations", async () => {
  const hook = await source("app/components/classroom/use-yjs-excalidraw-store.ts");
  const board = await source("app/components/classroom/whiteboard.tsx");
  assert.match(board, /readOnly: props\.readOnly/);
  assert.match(hook, /if \(!readOnly\) \{\s*cleanups\.push\(excalidrawAPI\.onChange/);
  assert.match(hook, /else if \(!readOnly\)/);
});

test("notification delivery uses a database idempotency key", async () => {
  const route = await source("app/api/notifications/route.ts");
  const server = await source("lib/notifications/server.ts");
  const migration = await source("supabase/migrations/20260818193000_phase6_notification_integrity.sql");
  assert.match(server, /onConflict: "event_key", ignoreDuplicates: true/);
  assert.match(route, /chat-message:\$\{payload\.messageId\}/);
  assert.match(migration, /notifications_event_key_unique/);
});

test("active tutoring UI contains no demo mutation path or leftover placeholder payment state", async () => {
  const page = await source("app/page.tsx");
  assert.doesNotMatch(page, /demo-booking|demo-review|source === "Demo"/);
  assert.doesNotMatch(page, /placeholder_pending|placeholder_complete/);
});
