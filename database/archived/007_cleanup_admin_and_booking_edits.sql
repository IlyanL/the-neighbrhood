-- Western Tutors cleanup/admin/booking edit migration
-- Run this after database/006_admin_and_private_tutor_docs.sql.
-- It hardens the owner admin account, removes a test account, and allows students to adjust/cancel their bookings.

update public.profiles
set role = 'admin', email = 'owner@example.com'
where lower(email) = 'owner@example.com';

delete from auth.users
where lower(email) = 'test-account@example.com';

drop policy if exists "Students can update own bookings" on public.bookings;

create policy "Students can update own bookings"
  on public.bookings for update
  using (auth.uid() = student_id)
  with check (auth.uid() = student_id);
