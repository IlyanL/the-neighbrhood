-- Reconstructed migration: applied live on 2026-08-23 but the original file was never
-- committed (migration drift). This recreates the current live behavior from the live
-- schema, not a byte-for-byte replay of the original SQL.
--
-- Guest browsing needs course discussion content to be readable without an account.
-- Widen the visible-rows SELECT policies from authenticated-only to anon + authenticated.
drop policy if exists "Verified users read visible course discussions" on public.course_discussions;
drop policy if exists "Authenticated users read visible course discussions" on public.course_discussions;
create policy "Authenticated users read visible course discussions"
  on public.course_discussions for select
  to anon, authenticated
  using (is_visible or private.is_neighbrhood_admin());

drop policy if exists "Verified users read visible course comments" on public.course_discussion_comments;
drop policy if exists "Authenticated users read visible course comments" on public.course_discussion_comments;
create policy "Authenticated users read visible course comments"
  on public.course_discussion_comments for select
  to anon, authenticated
  using (is_visible or private.is_neighbrhood_admin());

drop policy if exists "Verified users read discussion votes" on public.course_discussion_votes;
drop policy if exists "Authenticated users read discussion votes" on public.course_discussion_votes;
create policy "Authenticated users read discussion votes"
  on public.course_discussion_votes for select
  to anon, authenticated
  using (true);
