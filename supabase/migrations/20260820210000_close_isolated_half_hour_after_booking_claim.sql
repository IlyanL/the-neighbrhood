-- A leftover half-hour immediately before or after a newly booked hour can never be booked on its
-- own (sessions are always a full hour, booked in half-hour increments). When claim_tutor_slot_for_booking
-- claims the two half-hour segments for a new booking, also close (delete) any adjacent open segment
-- that the claim just isolated from every other open half-hour, matching the same invariant enforced
-- client-side in the tutor's own availability editor: every open half-hour must have at least one open
-- neighbor.

create or replace function private.claim_tutor_slot_for_booking()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  claimed_first_half uuid;
  claimed_second_half uuid;
  before_start timestamptz;
  after_start timestamptz;
  before_isolated boolean;
  after_isolated boolean;
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

  -- A leftover half-hour immediately before or after the newly booked hour can never be booked on its
  -- own (sessions are always a full hour), so close it if claiming this hour just isolated it from
  -- every other open half-hour.
  before_start := new.requested_start - interval '30 minutes';
  after_start := new.requested_start + interval '60 minutes';

  select exists (
    select 1 from public.tutor_availability availability
    where availability.tutor_id = new.tutor_id
      and availability.starts_at = before_start
      and availability.is_booked = false
  ) and not exists (
    select 1 from public.tutor_availability availability
    where availability.tutor_id = new.tutor_id
      and availability.starts_at = before_start - interval '30 minutes'
      and availability.is_booked = false
  ) into before_isolated;

  if before_isolated then
    delete from public.tutor_availability availability
    where availability.tutor_id = new.tutor_id
      and availability.starts_at = before_start
      and availability.is_booked = false;
  end if;

  select exists (
    select 1 from public.tutor_availability availability
    where availability.tutor_id = new.tutor_id
      and availability.starts_at = after_start
      and availability.is_booked = false
  ) and not exists (
    select 1 from public.tutor_availability availability
    where availability.tutor_id = new.tutor_id
      and availability.starts_at = after_start + interval '30 minutes'
      and availability.is_booked = false
  ) into after_isolated;

  if after_isolated then
    delete from public.tutor_availability availability
    where availability.tutor_id = new.tutor_id
      and availability.starts_at = after_start
      and availability.is_booked = false;
  end if;

  return new;
end;
$function$;
