-- Tutor availability moved from hourly to half-hour marks. Every session is still a full hour, so
-- booking a start time must atomically consume BOTH of its half-hour segments (the start and the
-- following 30 minutes) — otherwise a student could separately book the overlapping half, double
-- booking the tutor. Cancelling/declining a booking must release both segments the same way.

create or replace function private.claim_tutor_slot_for_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed_first_half uuid;
  claimed_second_half uuid;
begin
  if new.student_id <> (select auth.uid()) then
    raise exception using errcode = '42501', message = 'A booking can only be created for the signed-in student.';
  end if;
  if new.student_id = new.tutor_id then
    raise exception using errcode = '22023', message = 'You cannot book your own tutor profile.';
  end if;
  if not exists (
    select 1 from public.tutor_profiles tutor
    where tutor.id = new.tutor_id
      and tutor.application_status = 'accepted'
      and tutor.is_verified = true
  ) then
    raise exception using errcode = '22023', message = 'This tutor is not available for booking.';
  end if;

  update public.tutor_availability availability
  set is_booked = true
  where availability.tutor_id = new.tutor_id
    and availability.starts_at = new.requested_start
    and availability.is_booked = false
    and availability.starts_at > now()
  returning availability.id into claimed_first_half;

  if claimed_first_half is null then
    raise exception using errcode = 'P0001', message = 'That time was just booked or is no longer available.';
  end if;

  update public.tutor_availability availability
  set is_booked = true
  where availability.tutor_id = new.tutor_id
    and availability.starts_at = new.requested_start + interval '30 minutes'
    and availability.is_booked = false
  returning availability.id into claimed_second_half;

  if claimed_second_half is null then
    raise exception using errcode = 'P0001', message = 'That time was just booked or is no longer available.';
  end if;

  return new;
end;
$$;

create or replace function private.release_tutor_slot_after_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status in ('requested', 'confirmed', 'time_change_requested')
     and new.status in ('cancelled', 'declined') then
    update public.tutor_availability availability
    set is_booked = false
    where availability.tutor_id = old.tutor_id
      and availability.starts_at = old.requested_start
      and not exists (
        select 1 from public.bookings booking
        where booking.id <> new.id
          and booking.tutor_id = old.tutor_id
          and booking.requested_start in (availability.starts_at, availability.starts_at - interval '30 minutes')
          and booking.status in ('requested', 'confirmed', 'time_change_requested')
      );

    update public.tutor_availability availability
    set is_booked = false
    where availability.tutor_id = old.tutor_id
      and availability.starts_at = old.requested_start + interval '30 minutes'
      and not exists (
        select 1 from public.bookings booking
        where booking.id <> new.id
          and booking.tutor_id = old.tutor_id
          and booking.requested_start in (availability.starts_at, availability.starts_at - interval '30 minutes')
          and booking.status in ('requested', 'confirmed', 'time_change_requested')
      );
  end if;
  return new;
end;
$$;
