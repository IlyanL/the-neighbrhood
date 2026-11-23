-- Reconstructed migration: applied live on 2026-08-23 but the original file was never
-- committed (migration drift). This recreates the current live behavior from the live
-- schema, not a byte-for-byte replay of the original SQL.
--
-- A submitter needs to see their own pending/declined submission (not yet published,
-- so the general "published events are public" policy doesn't cover it).
drop policy if exists "Submitters read their own submissions" on public.club_events;
create policy "Submitters read their own submissions"
  on public.club_events for select
  to authenticated
  using (submitted_by = (select auth.uid()));
