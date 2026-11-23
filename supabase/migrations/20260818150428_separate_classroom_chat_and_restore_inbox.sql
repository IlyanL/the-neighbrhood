-- Keep live-classroom chat private to its classroom and allow the main Inbox
-- to carry tutoring, housing, and event conversations between Western users.

alter table public.chat_threads
  add column if not exists context_type text not null default 'tutoring',
  add column if not exists context_id uuid,
  add column if not exists context_title text;

alter table public.chat_threads drop constraint if exists chat_threads_context_type_check;
alter table public.chat_threads
  add constraint chat_threads_context_type_check
  check (context_type in ('tutoring', 'housing', 'event', 'classroom'));

-- A conversation recipient is any verified network profile, not necessarily a tutor.
alter table public.chat_threads drop constraint if exists chat_threads_tutor_id_fkey;
alter table public.chat_threads
  add constraint chat_threads_tutor_id_fkey
  foreign key (tutor_id) references public.profiles(id) on delete cascade;

update public.chat_threads thread
set context_type = 'classroom',
    context_id = classroom.id,
    context_title = coalesce(thread.context_title, booking.course_code || ' classroom')
from public.tutoring_classrooms classroom
join public.bookings booking on booking.id = classroom.booking_id
where thread.booking_id = classroom.booking_id
  and thread.context_type = 'tutoring';

create table if not exists public.classroom_messages (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.tutoring_classrooms(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  classroom_file_id uuid references public.classroom_files(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists classroom_messages_classroom_created_idx
  on public.classroom_messages(classroom_id, created_at);

-- Preserve messages already sent from a live classroom while removing them
-- from the user-facing Inbox model.
insert into public.classroom_messages (id, classroom_id, sender_id, body, classroom_file_id, created_at)
select message.id, classroom.id, message.sender_id, message.body, message.classroom_file_id, message.created_at
from public.chat_messages message
join public.chat_threads thread on thread.id = message.thread_id
join public.tutoring_classrooms classroom on classroom.booking_id = thread.booking_id
where thread.context_type = 'classroom'
on conflict (id) do nothing;

alter table public.classroom_messages enable row level security;
revoke all on table public.classroom_messages from anon, authenticated;
grant select, insert on table public.classroom_messages to authenticated;

create policy "Classroom participants can read classroom messages"
  on public.classroom_messages for select to authenticated
  using (exists (
    select 1
    from public.tutoring_classrooms classroom
    join public.bookings booking on booking.id = classroom.booking_id
    where classroom.id = classroom_messages.classroom_id
      and ((select auth.uid()) = booking.student_id or (select auth.uid()) = booking.tutor_id)
  ));

create policy "Classroom participants can send classroom messages"
  on public.classroom_messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and exists (
      select 1
      from public.tutoring_classrooms classroom
      join public.bookings booking on booking.id = classroom.booking_id
      where classroom.id = classroom_messages.classroom_id
        and ((select auth.uid()) = booking.student_id or (select auth.uid()) = booking.tutor_id)
    )
  );

drop policy if exists "Students and booked tutors can create chats" on public.chat_threads;
create policy "Users can start valid inbox conversations"
  on public.chat_threads for insert to authenticated
  with check (
    student_id = (select auth.uid())
    and student_id <> tutor_id
    and context_type <> 'classroom'
    and (
      (
        context_type = 'tutoring'
        and (
          (context_id is null and exists (
            select 1 from public.tutor_profiles tutor
            where tutor.id = tutor_id
              and tutor.application_status = 'accepted'
              and tutor.is_verified = true
          ))
          or exists (
            select 1 from public.bookings booking
            where booking.id = context_id
              and booking.student_id = student_id
              and booking.tutor_id = tutor_id
          )
        )
      )
      or (
        context_type = 'housing'
        and exists (
          select 1 from public.housing_listings listing
          where listing.id = context_id
            and listing.owner_id = tutor_id
            and listing.moderation_status = 'active'
        )
      )
      or (
        context_type = 'event'
        and exists (
          select 1
          from public.club_events event
          join public.clubs club on club.id = event.club_id
          where event.id = context_id
            and event.is_published = true
            and club.created_by = tutor_id
        )
      )
    )
  );

drop policy if exists "Chat participants can update threads" on public.chat_threads;
create policy "Inbox participants can update threads"
  on public.chat_threads for update to authenticated
  using ((select auth.uid()) = student_id or (select auth.uid()) = tutor_id)
  with check ((select auth.uid()) = student_id or (select auth.uid()) = tutor_id);

create or replace function private.guard_inbox_thread_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id
     or new.student_id <> old.student_id
     or new.tutor_id <> old.tutor_id
     or new.booking_id is distinct from old.booking_id
     or new.context_type <> old.context_type
     or new.context_id is distinct from old.context_id
     or new.context_title is distinct from old.context_title then
    raise exception 'Inbox conversation identity is immutable';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_inbox_thread_identity() from public, anon, authenticated;
drop trigger if exists guard_inbox_thread_identity on public.chat_threads;
create trigger guard_inbox_thread_identity
  before update on public.chat_threads
  for each row execute function private.guard_inbox_thread_identity();

create index if not exists chat_threads_participant_context_idx
  on public.chat_threads(student_id, tutor_id, context_type, context_id, updated_at desc);
