-- Reconstructed migration: applied live on 2026-08-23 but the original file was never
-- committed (migration drift). This recreates the current live behavior from the live
-- schema, not a byte-for-byte replay of the original SQL.
--
-- Self-serve event submission for students/execs who aren't yet a trusted club manager:
-- a submitted event stays unpublished until an admin approves or declines it. Approving
-- also grants the submitter club_manager status, so later events skip review (see
-- approve_club_event below and 20260823183954_club_managers_and_exec_event_posting.sql).
alter table public.club_events add column if not exists submitted_by uuid references public.profiles(id) on delete set null;
alter table public.club_events add column if not exists review_status text not null default 'approved';
alter table public.club_events drop constraint if exists club_events_review_status_check;
alter table public.club_events add constraint club_events_review_status_check
  check (review_status = any (array['pending', 'approved', 'declined']));

create table if not exists public.club_event_collaborators (
  event_id uuid not null references public.club_events(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  primary key (event_id, club_id)
);

alter table public.club_event_collaborators enable row level security;

drop policy if exists "Students submit pending club events" on public.club_events;
create policy "Students submit pending club events"
  on public.club_events for insert
  to authenticated
  with check (
    submitted_by = (select auth.uid())
    and is_published = false
    and review_status = 'pending'
  );

create or replace function public.approve_club_event(target_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  target_club_id uuid;
  submitter uuid;
begin
  if not private.is_neighbrhood_admin() then
    raise exception 'Only an admin can approve events.';
  end if;

  select club_id, submitted_by into target_club_id, submitter
  from public.club_events where id = target_event_id;

  if target_club_id is null then
    raise exception 'Event not found.';
  end if;

  update public.club_events
  set is_published = true, review_status = 'approved'
  where id = target_event_id;

  if submitter is not null then
    insert into public.club_managers (club_id, user_id)
    values (target_club_id, submitter)
    on conflict do nothing;

    insert into public.club_managers (club_id, user_id)
    select cec.club_id, submitter
    from public.club_event_collaborators cec
    where cec.event_id = target_event_id
    on conflict do nothing;
  end if;
end;
$function$;

create or replace function public.decline_club_event(target_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not private.is_neighbrhood_admin() then
    raise exception 'Only an admin can decline events.';
  end if;

  update public.club_events
  set review_status = 'declined'
  where id = target_event_id;
end;
$function$;
