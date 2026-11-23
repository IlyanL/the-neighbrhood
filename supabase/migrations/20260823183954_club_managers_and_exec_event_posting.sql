-- Reconstructed migration: applied live on 2026-08-23 but the original file was never
-- committed (migration drift). This recreates the current live behavior from the live
-- schema, not a byte-for-byte replay of the original SQL.
--
-- Trusted club managers/execs can post and manage events for their own club directly,
-- without going through the admin-review queue added in a later migration.
create table if not exists public.club_managers (
  club_id uuid not null references public.clubs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (club_id, user_id)
);

alter table public.club_managers enable row level security;

create or replace function private.is_club_manager(target_club_id uuid)
returns boolean
language sql
stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.clubs
    where id = target_club_id and created_by = (select auth.uid())
  ) or exists (
    select 1 from public.club_managers
    where club_id = target_club_id and user_id = (select auth.uid())
  );
$$;

drop policy if exists "Admins assign club managers" on public.club_managers;
create policy "Admins assign club managers"
  on public.club_managers for insert
  to authenticated
  with check (private.is_neighbrhood_admin());

drop policy if exists "Admins remove club managers" on public.club_managers;
create policy "Admins remove club managers"
  on public.club_managers for delete
  to authenticated
  using (private.is_neighbrhood_admin());

drop policy if exists "Managers and admins read club manager rows" on public.club_managers;
create policy "Managers and admins read club manager rows"
  on public.club_managers for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or private.is_club_manager(club_id)
    or private.is_neighbrhood_admin()
  );

drop policy if exists "Club managers create their club's events" on public.club_events;
create policy "Club managers create their club's events"
  on public.club_events for insert
  to authenticated
  with check (private.is_club_manager(club_id));

drop policy if exists "Club managers update their club's events" on public.club_events;
create policy "Club managers update their club's events"
  on public.club_events for update
  to authenticated
  using (private.is_club_manager(club_id));

drop policy if exists "Club managers delete their club's events" on public.club_events;
create policy "Club managers delete their club's events"
  on public.club_events for delete
  to authenticated
  using (private.is_club_manager(club_id));
