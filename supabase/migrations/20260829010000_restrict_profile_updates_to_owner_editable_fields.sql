-- `authenticated` could update every column of public.profiles, including `email`.
-- profiles.email is the address createNotification delivers to, so combined with the
-- notifications endpoint that made it an arbitrary-recipient relay from the verified
-- Resend sending domain: point your own profile at any address, then trigger notifications.
-- `id` and `created_at` were likewise editable.
--
-- `role` was already covered by the protect_profile_role_change trigger; this closes the
-- rest with column-level grants, which PostgREST rejects before a row is ever touched.
--
-- The grant list is exactly the payload app/page.tsx:1614-1623 sends when a user saves
-- their profile. Nothing client-side writes email, id, or created_at.
revoke update on table public.profiles from authenticated;

grant update (
  full_name,
  major,
  year,
  faculty,
  bio,
  interests
) on table public.profiles to authenticated;

-- Applied 2026-08-29 and verified against the live database, simulating a signed-in user
-- via `set local role authenticated` inside a rolled-back transaction:
--   rewrite own email       : BLOCKED (42501)
--   self-promote to admin   : BLOCKED (42501)
--   legitimate profile save : allowed
