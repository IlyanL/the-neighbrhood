-- Phase 4: capability convergence, coherent course post values, safe bookings, and API hardening.
alter table public.course_discussions drop constraint if exists course_discussions_post_type_check;
alter table public.course_discussions add constraint course_discussions_post_type_check check (post_type in ('question', 'discussion', 'tip', 'warning', 'resource', 'experience'));

create unique index if not exists tutor_availability_tutor_start_unique on public.tutor_availability (tutor_id, starts_at);

alter table public.profiles disable trigger protect_profile_role_change;
update public.profiles profile set role = 'student'
where profile.role = 'tutor' and not exists (
  select 1 from public.tutor_profiles tutor where tutor.id = profile.id and tutor.application_status = 'accepted' and tutor.is_verified = true
);
update public.profiles profile set role = 'tutor'
where profile.role <> 'admin' and exists (
  select 1 from public.tutor_profiles tutor where tutor.id = profile.id and tutor.application_status = 'accepted' and tutor.is_verified = true
);
alter table public.profiles enable trigger protect_profile_role_change;

create schema if not exists private;
create or replace function private.claim_tutor_slot_for_booking() returns trigger language plpgsql security definer set search_path = '' as $$
declare claimed_slot uuid;
begin
  if new.student_id <> (select auth.uid()) then raise exception using errcode = '42501', message = 'A booking can only be created for the signed-in student.'; end if;
  if new.student_id = new.tutor_id then raise exception using errcode = '22023', message = 'You cannot book your own tutor profile.'; end if;
  if not exists (select 1 from public.tutor_profiles tutor where tutor.id = new.tutor_id and tutor.application_status = 'accepted' and tutor.is_verified = true) then
    raise exception using errcode = '22023', message = 'This tutor is not available for booking.';
  end if;
  update public.tutor_availability availability set is_booked = true
  where availability.tutor_id = new.tutor_id and availability.starts_at = new.requested_start and availability.is_booked = false and availability.starts_at > now()
  returning availability.id into claimed_slot;
  if claimed_slot is null then raise exception using errcode = 'P0001', message = 'That time was just booked or is no longer available.'; end if;
  return new;
end; $$;
revoke all on function private.claim_tutor_slot_for_booking() from public, anon, authenticated;
drop trigger if exists claim_tutor_slot_before_booking on public.bookings;
create trigger claim_tutor_slot_before_booking before insert on public.bookings for each row execute function private.claim_tutor_slot_for_booking();

create or replace function private.release_tutor_slot_after_booking() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status in ('requested', 'confirmed', 'time_change_requested') and new.status in ('cancelled', 'declined') then
    update public.tutor_availability availability set is_booked = false
    where availability.tutor_id = old.tutor_id and availability.starts_at = old.requested_start
      and not exists (select 1 from public.bookings booking where booking.id <> new.id and booking.tutor_id = old.tutor_id and booking.requested_start = old.requested_start and booking.status in ('requested', 'confirmed', 'time_change_requested'));
  end if;
  return new;
end; $$;
revoke all on function private.release_tutor_slot_after_booking() from public, anon, authenticated;
drop trigger if exists release_tutor_slot_after_booking on public.bookings;
create trigger release_tutor_slot_after_booking after update of status on public.bookings for each row execute function private.release_tutor_slot_after_booking();

revoke all on table public.google_oauth_states from anon, authenticated;
revoke all on table public.payments from anon, authenticated;
revoke all on table public.booking_payments from anon, authenticated;
revoke all on table public.bookings from anon;
revoke all on table public.chat_threads from anon;
revoke all on table public.chat_messages from anon;
revoke all on table public.tutor_availability from anon;
grant select on table public.tutor_availability to anon;
grant select, insert, update on table public.bookings to authenticated;
grant select, insert, update on table public.chat_threads to authenticated;
grant select, insert on table public.chat_messages to authenticated;
grant select, insert, update, delete on table public.tutor_availability to authenticated;

drop policy if exists "Students and tutors can read own bookings" on public.bookings;
create policy "Booking participants can read bookings" on public.bookings for select to authenticated using ((select auth.uid()) = student_id or (select auth.uid()) = tutor_id);
drop policy if exists "Students can request bookings" on public.bookings;
create policy "Students can request bookings" on public.bookings for insert to authenticated with check ((select auth.uid()) = student_id);
drop policy if exists "Chat participants can read threads" on public.chat_threads;
create policy "Chat participants can read threads" on public.chat_threads for select to authenticated using ((select auth.uid()) = student_id or (select auth.uid()) = tutor_id);
drop policy if exists "Chat participants can read messages" on public.chat_messages;
create policy "Chat participants can read messages" on public.chat_messages for select to authenticated using (exists (select 1 from public.chat_threads thread where thread.id = chat_messages.thread_id and ((select auth.uid()) = thread.student_id or (select auth.uid()) = thread.tutor_id)));
drop policy if exists "Chat participants can send messages" on public.chat_messages;
create policy "Chat participants can send messages" on public.chat_messages for insert to authenticated with check (sender_id = (select auth.uid()) and exists (select 1 from public.chat_threads thread where thread.id = chat_messages.thread_id and ((select auth.uid()) = thread.student_id or (select auth.uid()) = thread.tutor_id)));
