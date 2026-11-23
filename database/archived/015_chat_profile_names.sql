-- Western Tutors chat participant names
-- Run this after database/014_chat_and_session_files.sql.

drop policy if exists "Chat participants can read profile names" on public.profiles;

create policy "Chat participants can read profile names"
  on public.profiles for select
  using (
    id = auth.uid()
    or exists (
      select 1
      from public.chat_threads
      where (chat_threads.student_id = auth.uid() or chat_threads.tutor_id = auth.uid())
      and (profiles.id = chat_threads.student_id or profiles.id = chat_threads.tutor_id)
    )
    or exists (
      select 1
      from public.bookings
      where (bookings.student_id = auth.uid() or bookings.tutor_id = auth.uid())
      and (profiles.id = bookings.student_id or profiles.id = bookings.tutor_id)
    )
  );
