-- Western Tutors chat, session file drops, and safer time-change declines
-- Run this after database/013_notification_bell_and_time_changes.sql.

alter table public.bookings
  add column if not exists time_change_previous_status text;

create table if not exists public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  tutor_id uuid not null references public.tutor_profiles(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists chat_threads_pair_no_booking_unique
  on public.chat_threads(student_id, tutor_id)
  where booking_id is null;

create unique index if not exists chat_threads_booking_unique
  on public.chat_threads(booking_id)
  where booking_id is not null;

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.session_files (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  uploader_id uuid not null references public.profiles(id) on delete cascade,
  file_name text not null,
  file_path text not null,
  created_at timestamptz not null default now()
);

alter table public.notifications
  add column if not exists thread_id uuid references public.chat_threads(id) on delete cascade;

alter table public.chat_threads enable row level security;
alter table public.chat_messages enable row level security;
alter table public.session_files enable row level security;

drop policy if exists "Chat participants can read threads" on public.chat_threads;
create policy "Chat participants can read threads"
  on public.chat_threads for select
  using (student_id = auth.uid() or tutor_id = auth.uid());

drop policy if exists "Students can create tutor chats" on public.chat_threads;
create policy "Students can create tutor chats"
  on public.chat_threads for insert
  with check (
    student_id = auth.uid()
    or exists (
      select 1 from public.bookings
      where bookings.id = chat_threads.booking_id
      and bookings.student_id = chat_threads.student_id
      and bookings.tutor_id = chat_threads.tutor_id
      and bookings.tutor_id = auth.uid()
    )
  );

drop policy if exists "Chat participants can update threads" on public.chat_threads;
create policy "Chat participants can update threads"
  on public.chat_threads for update
  using (student_id = auth.uid() or tutor_id = auth.uid())
  with check (student_id = auth.uid() or tutor_id = auth.uid());

drop policy if exists "Chat participants can read messages" on public.chat_messages;
create policy "Chat participants can read messages"
  on public.chat_messages for select
  using (
    exists (
      select 1 from public.chat_threads
      where chat_threads.id = chat_messages.thread_id
      and (chat_threads.student_id = auth.uid() or chat_threads.tutor_id = auth.uid())
    )
  );

drop policy if exists "Chat participants can send messages" on public.chat_messages;
create policy "Chat participants can send messages"
  on public.chat_messages for insert
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.chat_threads
      where chat_threads.id = chat_messages.thread_id
      and (chat_threads.student_id = auth.uid() or chat_threads.tutor_id = auth.uid())
    )
  );

drop policy if exists "Session participants can read files" on public.session_files;
create policy "Session participants can read files"
  on public.session_files for select
  using (
    exists (
      select 1 from public.bookings
      where bookings.id = session_files.booking_id
      and (bookings.student_id = auth.uid() or bookings.tutor_id = auth.uid())
    )
  );

drop policy if exists "Session participants can add files" on public.session_files;
create policy "Session participants can add files"
  on public.session_files for insert
  with check (
    uploader_id = auth.uid()
    and exists (
      select 1 from public.bookings
      where bookings.id = session_files.booking_id
      and (bookings.student_id = auth.uid() or bookings.tutor_id = auth.uid())
    )
  );

insert into storage.buckets (id, name, public)
values ('session-files', 'session-files', false)
on conflict (id) do nothing;

drop policy if exists "Session participants can upload session files" on storage.objects;
create policy "Session participants can upload session files"
  on storage.objects for insert
  with check (
    bucket_id = 'session-files'
    and auth.role() = 'authenticated'
    and exists (
      select 1 from public.bookings
      where bookings.id = (storage.foldername(name))[1]::uuid
      and (bookings.student_id = auth.uid() or bookings.tutor_id = auth.uid())
    )
  );

drop policy if exists "Session participants can read session files" on storage.objects;
create policy "Session participants can read session files"
  on storage.objects for select
  using (
    bucket_id = 'session-files'
    and auth.role() = 'authenticated'
    and exists (
      select 1 from public.bookings
      where bookings.id = (storage.foldername(name))[1]::uuid
      and (bookings.student_id = auth.uid() or bookings.tutor_id = auth.uid())
    )
  );

drop policy if exists "Chat participants can create notifications" on public.notifications;
create policy "Chat participants can create notifications"
  on public.notifications for insert
  with check (
    thread_id is not null
    and exists (
      select 1
      from public.chat_threads
      where chat_threads.id = notifications.thread_id
      and (chat_threads.student_id = auth.uid() or chat_threads.tutor_id = auth.uid())
      and (notifications.user_id = chat_threads.student_id or notifications.user_id = chat_threads.tutor_id)
    )
  );
