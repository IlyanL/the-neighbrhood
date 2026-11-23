# Archived — historical only

These 24 files (plus `schema.sql`) are the project's original migration history, from the
CourseForge bootstrap through the early Neighbrhood platform work. They are **not
authoritative** and should not be run against the live project.

- `supabase/migrations/` (2026-08-12 onward) is the CLI-tracked, verified-applied history
  going forward — every file in it is confirmed present in the live project's
  `supabase_migrations.schema_migrations` table.
- For anything before 2026-08-12, **the live database itself is the source of truth**, not
  either directory. `022_phase3_course_privacy.sql` and `023_phase4_product_correctness.sql`
  here genuinely diverge from their same-named files in `supabase/migrations/` — the live
  schema turned out to be a blend of both, confirmed by querying `pg_policies` directly. See
  `docs/production-readiness.md` ("Phase 5, part 1") for the full comparison.
- `024_public_tutor_photos.sql` is byte-identical to its `supabase/migrations` counterpart —
  no conflict there.

Always verify against `information_schema`/`pg_policies` on the live project
(`<project-ref>`, via the Supabase MCP) before trusting anything named here, per
`AGENTS.md`.
