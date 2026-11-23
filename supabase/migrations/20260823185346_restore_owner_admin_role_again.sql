-- Reconstructed migration: applied live on 2026-08-23 but the original file was never
-- committed (migration drift). This recreates the current live behavior from the live
-- schema, not a byte-for-byte replay of the original SQL.
--
-- Same fix as 20260823165702_restore_owner_admin_role.sql, applied again a
-- second time the same day -- the underlying app bug that reset this role wasn't
-- actually fixed in code until later, so it regressed once more before that fix landed.
update public.profiles set role = 'admin' where email = 'owner@example.com';
