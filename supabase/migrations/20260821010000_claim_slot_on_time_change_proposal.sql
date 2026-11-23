-- Bug: a tutor's proposed alternate time never claimed the underlying tutor_availability
-- half-hours, so that time stayed visibly "open" in every AvailabilityPicker while the
-- proposal was pending. A student could then book (or self-serve reschedule into) the exact
-- same time on an unrelated booking. When the original proposal was later accepted,
-- move_booking_time's claim step would correctly refuse the now-double-booked slot — but by
-- then the second booking already existed, confusing everyone involved.
--
-- Fix: claim the proposed half-hours the moment a time-change proposal is created (same
-- claim + isolation-cleanup logic used for a fresh booking), so the slot immediately
-- disappears from every picker. Declining releases the claim. Accepting must NOT try to
-- re-claim a pair it already holds, so move_booking_time is updated to skip its claim step
-- when the target time is the proposal it's accepting.

create or replace function public.request_booking_time_change(p_booking_id uuid, p_new_start timestamptz)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_booking public.bookings;
  claimed_first_half uuid;
  claimed_second_half uuid;
  before_start timestamptz;
  after_start timestamptz;
  before_isolated boolean;
  after_isolated boolean;
begin
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if v_booking.id is null then
    raise exception using errcode = 'P0002', message = 'Booking not found.';
  end if;

  if (select auth.uid()) is distinct from v_booking.tutor_id then
    raise exception using errcode = '42501', message = 'Only the tutor can propose a new time for this session.';
  end if;

  if v_booking.status <> 'confirmed' then
    raise exception using errcode = '22023', message = 'This session cannot be moved from its current status.';
  end if;

  if p_new_start = v_booking.requested_start then
    raise exception using errcode = '22023', message = 'That is already the scheduled time.';
  end if;

  update public.tutor_availability
  set is_booked = true
  where tutor_id = v_booking.tutor_id and starts_at = p_new_start
    and is_booked = false and starts_at > now()
  returning id into claimed_first_half;
  if claimed_first_half is null then
    raise exception using errcode = 'P0001', message = 'That time was just booked or is no longer available.';
  end if;

  update public.tutor_availability
  set is_booked = true
  where tutor_id = v_booking.tutor_id and starts_at = p_new_start + interval '30 minutes'
    and is_booked = false
  returning id into claimed_second_half;
  if claimed_second_half is null then
    raise exception using errcode = 'P0001', message = 'That time was just booked or is no longer available.';
  end if;

  before_start := p_new_start - interval '30 minutes';
  after_start := p_new_start + interval '60 minutes';

  select exists (
    select 1 from public.tutor_availability
    where tutor_id = v_booking.tutor_id and starts_at = before_start and is_booked = false
  ) and not exists (
    select 1 from public.tutor_availability
    where tutor_id = v_booking.tutor_id and starts_at = before_start - interval '30 minutes' and is_booked = false
  ) into before_isolated;

  if before_isolated then
    delete from public.tutor_availability
    where tutor_id = v_booking.tutor_id and starts_at = before_start and is_booked = false;
  end if;

  select exists (
    select 1 from public.tutor_availability
    where tutor_id = v_booking.tutor_id and starts_at = after_start and is_booked = false
  ) and not exists (
    select 1 from public.tutor_availability
    where tutor_id = v_booking.tutor_id and starts_at = after_start + interval '30 minutes' and is_booked = false
  ) into after_isolated;

  if after_isolated then
    delete from public.tutor_availability
    where tutor_id = v_booking.tutor_id and starts_at = after_start and is_booked = false;
  end if;

  update public.bookings
  set proposed_start = p_new_start,
      proposed_by = v_booking.tutor_id,
      time_change_previous_status = v_booking.status,
      status = 'time_change_requested'
  where id = v_booking.id
  returning * into v_booking;

  return v_booking;
end;
$function$;

revoke all on function public.request_booking_time_change(uuid, timestamptz) from public;
grant execute on function public.request_booking_time_change(uuid, timestamptz) to authenticated;

create or replace function public.decline_booking_time_change(p_booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_booking public.bookings;
  v_restored_status text;
begin
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if v_booking.id is null then
    raise exception using errcode = 'P0002', message = 'Booking not found.';
  end if;

  if (select auth.uid()) is distinct from v_booking.student_id and (select auth.uid()) is distinct from v_booking.tutor_id then
    raise exception using errcode = '42501', message = 'Only a participant on this booking can decline the proposed time.';
  end if;

  if v_booking.status <> 'time_change_requested' or v_booking.proposed_start is null then
    raise exception using errcode = '22023', message = 'There is no pending time change to decline.';
  end if;

  update public.tutor_availability availability
  set is_booked = false
  where availability.tutor_id = v_booking.tutor_id
    and availability.starts_at = v_booking.proposed_start
    and not exists (
      select 1 from public.bookings booking
      where booking.id <> v_booking.id
        and booking.tutor_id = v_booking.tutor_id
        and booking.requested_start in (availability.starts_at, availability.starts_at - interval '30 minutes')
        and booking.status in ('requested', 'confirmed', 'time_change_requested')
    );

  update public.tutor_availability availability
  set is_booked = false
  where availability.tutor_id = v_booking.tutor_id
    and availability.starts_at = v_booking.proposed_start + interval '30 minutes'
    and not exists (
      select 1 from public.bookings booking
      where booking.id <> v_booking.id
        and booking.tutor_id = v_booking.tutor_id
        and booking.requested_start in (availability.starts_at, availability.starts_at - interval '30 minutes')
        and booking.status in ('requested', 'confirmed', 'time_change_requested')
    );

  v_restored_status := coalesce(v_booking.time_change_previous_status, 'confirmed');

  update public.bookings
  set status = v_restored_status,
      proposed_start = null,
      proposed_by = null,
      time_change_previous_status = null
  where id = v_booking.id
  returning * into v_booking;

  return v_booking;
end;
$function$;

revoke all on function public.decline_booking_time_change(uuid) from public;
grant execute on function public.decline_booking_time_change(uuid) to authenticated;

-- Accepting a proposal moves into a time that request_booking_time_change already claimed,
-- so the claim step must be skipped for that exact case instead of re-claiming (and failing).
create or replace function public.move_booking_time(p_booking_id uuid, p_new_start timestamptz)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_booking public.bookings;
  v_old_start timestamptz;
  v_accepting_existing_proposal boolean;
  claimed_first_half uuid;
  claimed_second_half uuid;
  before_start timestamptz;
  after_start timestamptz;
  before_isolated boolean;
  after_isolated boolean;
begin
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if v_booking.id is null then
    raise exception using errcode = 'P0002', message = 'Booking not found.';
  end if;

  if (select auth.uid()) is distinct from v_booking.student_id then
    raise exception using errcode = '42501', message = 'Only the student can move this session to a new time.';
  end if;

  v_accepting_existing_proposal := v_booking.status = 'time_change_requested';

  if v_accepting_existing_proposal then
    if v_booking.proposed_start is distinct from p_new_start then
      raise exception using errcode = '22023', message = 'The proposed time has changed. Refresh and try again.';
    end if;
  elsif v_booking.status <> 'confirmed' then
    raise exception using errcode = '22023', message = 'This session cannot be moved from its current status.';
  end if;

  if p_new_start = v_booking.requested_start then
    raise exception using errcode = '22023', message = 'That is already the scheduled time.';
  end if;

  v_old_start := v_booking.requested_start;

  -- Accepting a pending proposal targets a slot request_booking_time_change already claimed;
  -- re-running the claim here would find it "unavailable" and fail. A fresh self-serve
  -- reschedule (no pending proposal) still needs to claim the new slot itself.
  if not v_accepting_existing_proposal then
    update public.tutor_availability
    set is_booked = true
    where tutor_id = v_booking.tutor_id and starts_at = p_new_start
      and is_booked = false and starts_at > now()
    returning id into claimed_first_half;
    if claimed_first_half is null then
      raise exception using errcode = 'P0001', message = 'That time was just booked or is no longer available.';
    end if;

    update public.tutor_availability
    set is_booked = true
    where tutor_id = v_booking.tutor_id and starts_at = p_new_start + interval '30 minutes'
      and is_booked = false
    returning id into claimed_second_half;
    if claimed_second_half is null then
      raise exception using errcode = 'P0001', message = 'That time was just booked or is no longer available.';
    end if;

    before_start := p_new_start - interval '30 minutes';
    after_start := p_new_start + interval '60 minutes';

    select exists (
      select 1 from public.tutor_availability
      where tutor_id = v_booking.tutor_id and starts_at = before_start and is_booked = false
    ) and not exists (
      select 1 from public.tutor_availability
      where tutor_id = v_booking.tutor_id and starts_at = before_start - interval '30 minutes' and is_booked = false
    ) into before_isolated;

    if before_isolated then
      delete from public.tutor_availability
      where tutor_id = v_booking.tutor_id and starts_at = before_start and is_booked = false;
    end if;

    select exists (
      select 1 from public.tutor_availability
      where tutor_id = v_booking.tutor_id and starts_at = after_start and is_booked = false
    ) and not exists (
      select 1 from public.tutor_availability
      where tutor_id = v_booking.tutor_id and starts_at = after_start + interval '30 minutes' and is_booked = false
    ) into after_isolated;

    if after_isolated then
      delete from public.tutor_availability
      where tutor_id = v_booking.tutor_id and starts_at = after_start and is_booked = false;
    end if;
  end if;

  update public.tutor_availability availability
  set is_booked = false
  where availability.tutor_id = v_booking.tutor_id
    and availability.starts_at = v_old_start
    and not exists (
      select 1 from public.bookings booking
      where booking.id <> v_booking.id
        and booking.tutor_id = v_booking.tutor_id
        and booking.requested_start in (availability.starts_at, availability.starts_at - interval '30 minutes')
        and booking.status in ('requested', 'confirmed', 'time_change_requested')
    );

  update public.tutor_availability availability
  set is_booked = false
  where availability.tutor_id = v_booking.tutor_id
    and availability.starts_at = v_old_start + interval '30 minutes'
    and not exists (
      select 1 from public.bookings booking
      where booking.id <> v_booking.id
        and booking.tutor_id = v_booking.tutor_id
        and booking.requested_start in (availability.starts_at, availability.starts_at - interval '30 minutes')
        and booking.status in ('requested', 'confirmed', 'time_change_requested')
    );

  update public.bookings
  set requested_start = p_new_start,
      proposed_start = null,
      proposed_by = null,
      time_change_previous_status = null,
      status = 'confirmed'
  where id = v_booking.id
  returning * into v_booking;

  return v_booking;
end;
$function$;
