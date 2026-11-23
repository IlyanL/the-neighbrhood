-- Western Tutors notification bell and time-change request support
-- Run this after database/012_reviews_one_per_tutor.sql.

alter table public.notifications
  add column if not exists booking_id uuid references public.bookings(id) on delete cascade,
  add column if not exists path text;

alter table public.bookings
  add column if not exists proposed_start timestamptz,
  add column if not exists proposed_by uuid references public.profiles(id) on delete set null;

alter table public.bookings
  drop constraint if exists bookings_status_check;

alter table public.bookings
  add constraint bookings_status_check
  check (status in ('requested', 'confirmed', 'time_change_requested', 'declined', 'completed', 'cancelled'));

drop policy if exists "Booking participants can create notifications" on public.notifications;

create policy "Booking participants can create notifications"
  on public.notifications for insert
  with check (
    booking_id is not null
    and exists (
      select 1
      from public.bookings
      where bookings.id = notifications.booking_id
      and (bookings.student_id = auth.uid() or bookings.tutor_id = auth.uid())
      and (notifications.user_id = bookings.student_id or notifications.user_id = bookings.tutor_id)
    )
  );
