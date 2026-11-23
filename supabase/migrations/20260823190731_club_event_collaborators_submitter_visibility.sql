-- Reconstructed migration: applied live on 2026-08-23 but the original file was never
-- committed (migration drift). This recreates the current live behavior from the live
-- schema, not a byte-for-byte replay of the original SQL.
--
-- Collaborative multi-club events: a submitter can attach other clubs to their own
-- pending event, and everyone who can already see the event (published, own
-- submission, or a manager/admin of the primary club) can see its collaborators too.
drop policy if exists "Collaborators visible with their event" on public.club_event_collaborators;
create policy "Collaborators visible with their event"
  on public.club_event_collaborators for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.club_events ce
      where ce.id = club_event_collaborators.event_id
        and (
          ce.is_published
          or ce.submitted_by = (select auth.uid())
          or private.is_club_manager(ce.club_id)
          or private.is_neighbrhood_admin()
        )
    )
  );

drop policy if exists "Managers and admins add collaborators to their events" on public.club_event_collaborators;
create policy "Managers and admins add collaborators to their events"
  on public.club_event_collaborators for insert
  to authenticated
  with check (
    private.is_club_manager(club_id)
    or private.is_neighbrhood_admin()
    or exists (
      select 1 from public.club_events ce
      where ce.id = club_event_collaborators.event_id
        and ce.submitted_by = (select auth.uid())
    )
  );

drop policy if exists "Managers and admins remove collaborators from their events" on public.club_event_collaborators;
create policy "Managers and admins remove collaborators from their events"
  on public.club_event_collaborators for delete
  to authenticated
  using (
    private.is_club_manager(club_id)
    or private.is_neighbrhood_admin()
  );
