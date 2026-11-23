-- Western Tutors pair chat policy fix
-- Run this after database/016_clear_chat_history.sql.
-- This lets either side of a booked session open the same regular student-tutor chat.

drop policy if exists "Students can create tutor chats" on public.chat_threads;
drop policy if exists "Students and booked tutors can create chats" on public.chat_threads;

create policy "Students and booked tutors can create chats"
  on public.chat_threads for insert
  with check (
    student_id = auth.uid()
    or exists (
      select 1
      from public.bookings
      where bookings.student_id = chat_threads.student_id
      and bookings.tutor_id = chat_threads.tutor_id
      and bookings.tutor_id = auth.uid()
    )
  );
