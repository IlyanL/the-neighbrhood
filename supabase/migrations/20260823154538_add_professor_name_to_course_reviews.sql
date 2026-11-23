-- Reconstructed migration: applied live on 2026-08-23 but the original file was never
-- committed (migration drift). This recreates the current live behavior from the live
-- schema, not a byte-for-byte replay of the original SQL.
--
-- Free-text professor name shown as a prefix on a course review, instead of the
-- structured `professors` table relation this session tried and reverted.
alter table public.course_reviews add column if not exists professor_name text;
