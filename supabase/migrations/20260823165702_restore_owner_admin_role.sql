-- Reconstructed migration: applied live on 2026-08-23 but the original file was never
-- committed (migration drift). This recreates the current live behavior from the live
-- schema, not a byte-for-byte replay of the original SQL.
--
-- One-off data fix: this account's admin role kept getting silently reset to 'student'
-- by a bug in the app's profile-load fallback (fixed properly in app/page.tsx, see
-- the loadUserProfile .maybeSingle()/upsert fix). Restore it here.
update public.profiles set role = 'admin' where email = 'owner@example.com';
