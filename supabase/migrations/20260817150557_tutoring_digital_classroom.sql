-- Phase 5: participant-only tutoring classrooms and private learning artifacts.

alter table public.bookings
  add column if not exists duration_minutes integer not null default 60;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'bookings_duration_minutes_check'
      and conrelid = 'public.bookings'::regclass
  ) then
    alter table public.bookings
      add constraint bookings_duration_minutes_check
      check (duration_minutes between 15 and 240);
  end if;
end $$;

update public.bookings
set duration_minutes = greatest(15, least(240, round(extract(epoch from (requested_end - requested_start)) / 60)::integer))
where requested_end is not null and requested_end > requested_start;

create table if not exists public.tutoring_classrooms (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id) on delete cascade,
  livekit_room_name text not null unique default ('lk_' || encode(gen_random_bytes(18), 'hex')),
  liveblocks_room_id text not null unique default ('lb_' || encode(gen_random_bytes(18), 'hex')),
  status text not null default 'scheduled' check (status in ('scheduled', 'live', 'ended', 'cancelled')),
  scheduled_start timestamptz not null,
  duration_minutes integer not null check (duration_minutes between 15 and 240),
  first_started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.classroom_artifacts (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.tutoring_classrooms(id) on delete cascade,
  kind text not null check (kind in ('whiteboard', 'shared_notes', 'export')),
  provider_reference text,
  storage_path text,
  display_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.classroom_files (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.tutoring_classrooms(id) on delete cascade,
  uploader_id uuid not null references public.profiles(id) on delete restrict,
  storage_path text not null unique,
  display_name text not null check (char_length(display_name) between 1 and 180),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 20971520),
  board_placement jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.classroom_audit_events (
  id bigint generated always as identity primary key,
  classroom_id uuid not null references public.tutoring_classrooms(id) on delete cascade,
  participant_id uuid not null references public.profiles(id) on delete restrict,
  event_type text not null check (event_type in ('joined', 'left', 'started', 'ended', 'upload', 'delete')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists tutoring_classrooms_status_start_idx
  on public.tutoring_classrooms(status, scheduled_start);
create unique index if not exists classroom_artifacts_primary_kind_unique
  on public.classroom_artifacts(classroom_id, kind)
  where kind in ('whiteboard', 'shared_notes');
create index if not exists classroom_artifacts_classroom_idx
  on public.classroom_artifacts(classroom_id);
create index if not exists classroom_files_classroom_created_idx
  on public.classroom_files(classroom_id, created_at desc);
create index if not exists classroom_files_uploader_idx
  on public.classroom_files(uploader_id);
create index if not exists classroom_audit_classroom_created_idx
  on public.classroom_audit_events(classroom_id, created_at desc);
create index if not exists classroom_audit_participant_idx
  on public.classroom_audit_events(participant_id);

create schema if not exists private;
revoke all on schema private from public;

create or replace function private.set_classroom_booking_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  booking_record public.bookings%rowtype;
begin
  select * into booking_record
  from public.bookings
  where id = new.booking_id;

  if not found then
    raise exception 'Classroom booking is unavailable';
  end if;

  new.scheduled_start := booking_record.requested_start;
  new.duration_minutes := booking_record.duration_minutes;
  new.status := case when booking_record.status = 'completed' then 'ended' else 'scheduled' end;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.guard_classroom_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  booking_record public.bookings%rowtype;
begin
  if new.id <> old.id
     or new.booking_id <> old.booking_id
     or new.livekit_room_name <> old.livekit_room_name
     or new.liveblocks_room_id <> old.liveblocks_room_id
     or new.scheduled_start <> old.scheduled_start
     or new.duration_minutes <> old.duration_minutes then
    raise exception 'Classroom identity and schedule are immutable';
  end if;

  select * into booking_record from public.bookings where id = old.booking_id;
  if not found then raise exception 'Classroom booking is unavailable'; end if;

  if new.status is distinct from old.status then
    if old.status = 'scheduled' and new.status = 'live' then
      if booking_record.status <> 'confirmed' then
        raise exception 'Only confirmed sessions can start';
      end if;
      new.first_started_at := coalesce(old.first_started_at, now());
    elsif old.status in ('scheduled', 'live') and new.status = 'ended' then
      if (select auth.uid()) <> booking_record.tutor_id then
        raise exception 'Only the assigned tutor can end the classroom';
      end if;
      new.ended_at := coalesce(old.ended_at, now());
    elsif new.status = 'cancelled' and booking_record.status = 'cancelled' then
      new.ended_at := coalesce(old.ended_at, now());
    else
      raise exception 'Invalid classroom lifecycle transition';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_classroom_booking_fields on public.tutoring_classrooms;
create trigger set_classroom_booking_fields
  before insert on public.tutoring_classrooms
  for each row execute function private.set_classroom_booking_fields();

drop trigger if exists guard_classroom_update on public.tutoring_classrooms;
create trigger guard_classroom_update
  before update on public.tutoring_classrooms
  for each row execute function private.guard_classroom_update();

alter table public.tutoring_classrooms enable row level security;
alter table public.classroom_artifacts enable row level security;
alter table public.classroom_files enable row level security;
alter table public.classroom_audit_events enable row level security;

revoke all on table public.tutoring_classrooms, public.classroom_artifacts, public.classroom_files, public.classroom_audit_events from anon;
revoke all on table public.tutoring_classrooms, public.classroom_artifacts, public.classroom_files, public.classroom_audit_events from authenticated;
grant select, insert, update on table public.tutoring_classrooms to authenticated;
grant select, insert, update on table public.classroom_artifacts to authenticated;
grant select, insert, delete on table public.classroom_files to authenticated;
grant select, insert on table public.classroom_audit_events to authenticated;
grant usage, select on sequence public.classroom_audit_events_id_seq to authenticated;

create policy "Classroom participants can read classrooms"
  on public.tutoring_classrooms for select to authenticated
  using (exists (
    select 1 from public.bookings booking
    where booking.id = tutoring_classrooms.booking_id
      and ((select auth.uid()) = booking.student_id or (select auth.uid()) = booking.tutor_id)
  ));

create policy "Eligible booking participants can provision classrooms"
  on public.tutoring_classrooms for insert to authenticated
  with check (exists (
    select 1 from public.bookings booking
    where booking.id = tutoring_classrooms.booking_id
      and booking.status in ('confirmed', 'completed')
      and ((select auth.uid()) = booking.student_id or (select auth.uid()) = booking.tutor_id)
  ));

create policy "Classroom participants can advance lifecycle"
  on public.tutoring_classrooms for update to authenticated
  using (exists (
    select 1 from public.bookings booking
    where booking.id = tutoring_classrooms.booking_id
      and ((select auth.uid()) = booking.student_id or (select auth.uid()) = booking.tutor_id)
  ))
  with check (exists (
    select 1 from public.bookings booking
    where booking.id = tutoring_classrooms.booking_id
      and ((select auth.uid()) = booking.student_id or (select auth.uid()) = booking.tutor_id)
  ));

create policy "Classroom participants can read artifacts"
  on public.classroom_artifacts for select to authenticated
  using (exists (
    select 1 from public.tutoring_classrooms classroom
    join public.bookings booking on booking.id = classroom.booking_id
    where classroom.id = classroom_artifacts.classroom_id
      and ((select auth.uid()) = booking.student_id or (select auth.uid()) = booking.tutor_id)
  ));

create policy "Live classroom participants can create artifacts"
  on public.classroom_artifacts for insert to authenticated
  with check (exists (
    select 1 from public.tutoring_classrooms classroom
    join public.bookings booking on booking.id = classroom.booking_id
    where classroom.id = classroom_artifacts.classroom_id
      and classroom.status in ('scheduled', 'live')
      and ((select auth.uid()) = booking.student_id or (select auth.uid()) = booking.tutor_id)
  ));

create policy "Live classroom participants can update artifacts"
  on public.classroom_artifacts for update to authenticated
  using (exists (
    select 1 from public.tutoring_classrooms classroom
    join public.bookings booking on booking.id = classroom.booking_id
    where classroom.id = classroom_artifacts.classroom_id
      and classroom.status in ('scheduled', 'live')
      and ((select auth.uid()) = booking.student_id or (select auth.uid()) = booking.tutor_id)
  ))
  with check (exists (
    select 1 from public.tutoring_classrooms classroom
    join public.bookings booking on booking.id = classroom.booking_id
    where classroom.id = classroom_artifacts.classroom_id
      and classroom.status in ('scheduled', 'live')
      and ((select auth.uid()) = booking.student_id or (select auth.uid()) = booking.tutor_id)
  ));

create policy "Classroom participants can read files"
  on public.classroom_files for select to authenticated
  using (exists (
    select 1 from public.tutoring_classrooms classroom
    join public.bookings booking on booking.id = classroom.booking_id
    where classroom.id = classroom_files.classroom_id
      and ((select auth.uid()) = booking.student_id or (select auth.uid()) = booking.tutor_id)
  ));

create policy "Classroom participants can add own files"
  on public.classroom_files for insert to authenticated
  with check ((select auth.uid()) = uploader_id and exists (
    select 1 from public.tutoring_classrooms classroom
    join public.bookings booking on booking.id = classroom.booking_id
    where classroom.id = classroom_files.classroom_id
      and classroom.status in ('scheduled', 'live')
      and ((select auth.uid()) = booking.student_id or (select auth.uid()) = booking.tutor_id)
  ));

create policy "Uploaders can delete own classroom files"
  on public.classroom_files for delete to authenticated
  using ((select auth.uid()) = uploader_id and exists (
    select 1 from public.tutoring_classrooms classroom
    join public.bookings booking on booking.id = classroom.booking_id
    where classroom.id = classroom_files.classroom_id
      and ((select auth.uid()) = booking.student_id or (select auth.uid()) = booking.tutor_id)
  ));

create policy "Classroom participants can read audit events"
  on public.classroom_audit_events for select to authenticated
  using (exists (
    select 1 from public.tutoring_classrooms classroom
    join public.bookings booking on booking.id = classroom.booking_id
    where classroom.id = classroom_audit_events.classroom_id
      and ((select auth.uid()) = booking.student_id or (select auth.uid()) = booking.tutor_id)
  ));

create policy "Classroom participants can add own audit events"
  on public.classroom_audit_events for insert to authenticated
  with check ((select auth.uid()) = participant_id and exists (
    select 1 from public.tutoring_classrooms classroom
    join public.bookings booking on booking.id = classroom.booking_id
    where classroom.id = classroom_audit_events.classroom_id
      and ((select auth.uid()) = booking.student_id or (select auth.uid()) = booking.tutor_id)
  ));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'classroom-files',
  'classroom-files',
  false,
  20971520,
  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/plain', 'text/markdown']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Classroom participants can read private objects"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'classroom-files'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and exists (
      select 1 from public.tutoring_classrooms classroom
      join public.bookings booking on booking.id = classroom.booking_id
      where classroom.id = ((storage.foldername(name))[1])::uuid
        and ((select auth.uid()) = booking.student_id or (select auth.uid()) = booking.tutor_id)
    )
  );

create policy "Classroom participants can upload own private objects"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'classroom-files'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and exists (
      select 1 from public.tutoring_classrooms classroom
      join public.bookings booking on booking.id = classroom.booking_id
      where classroom.id = ((storage.foldername(name))[1])::uuid
        and classroom.status in ('scheduled', 'live')
        and ((select auth.uid()) = booking.student_id or (select auth.uid()) = booking.tutor_id)
    )
  );

create policy "Uploaders can delete own private classroom objects"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'classroom-files'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and exists (
      select 1 from public.tutoring_classrooms classroom
      join public.bookings booking on booking.id = classroom.booking_id
      where classroom.id = ((storage.foldername(name))[1])::uuid
        and ((select auth.uid()) = booking.student_id or (select auth.uid()) = booking.tutor_id)
    )
  );

revoke all on function private.set_classroom_booking_fields() from public;
revoke all on function private.guard_classroom_update() from public;

alter table public.chat_messages
  add column if not exists classroom_file_id uuid references public.classroom_files(id) on delete set null;

create index if not exists chat_messages_classroom_file_idx
  on public.chat_messages(classroom_file_id)
  where classroom_file_id is not null;
