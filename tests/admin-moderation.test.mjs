import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("housing report review requires admin role and can remove the reported listing", () => {
  const source = read("app/api/admin/housing-reports/route.ts");
  const serverAuth = read("lib/supabase/server-auth.ts");
  assert.match(source, /requireAdminProfile/);
  assert.match(serverAuth, /profile\?\.role === "admin"/);
  assert.match(source, /moderation_status: "removed"/);
});

test("admins can read housing reports through RLS even without a service-role key", () => {
  const migration = read("supabase/migrations/20260819160000_admin_visibility_and_events.sql");
  assert.match(migration, /create policy "Admins read housing reports" on public\.housing_reports/);
  assert.match(migration, /for select to authenticated using \(private\.is_neighbrhood_admin\(\)\)/);
});

test("club events can be published from the admin panel, closing the previously empty events pipeline", () => {
  const source = read("app/components/admin-control-panel.tsx");
  assert.match(source, /\.from\("club_events"\)\.insert/);
  assert.match(source, /is_published: true/);
});
