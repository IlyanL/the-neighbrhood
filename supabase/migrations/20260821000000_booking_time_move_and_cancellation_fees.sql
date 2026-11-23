-- Shared "move a confirmed booking's time" operation, used both when a student accepts a
-- tutor's proposed time and when a student self-serve reschedules a confirmed booking.
-- Claims the new half-hour pair (mirroring claim_tutor_slot_for_booking, including the
-- isolation-cleanup convention), releases the old pair (mirroring
-- release_tutor_slot_after_booking's NOT-EXISTS guard), and updates the booking row.
create or replace function public.move_booking_time(p_booking_id uuid, p_new_start timestamptz)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_booking public.bookings;
  v_old_start timestamptz;
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

  if v_booking.status = 'time_change_requested' then
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

revoke all on function public.move_booking_time(uuid, timestamptz) from public;
grant execute on function public.move_booking_time(uuid, timestamptz) to authenticated;

alter table public.booking_payments
  add column if not exists refund_amount_cents integer not null default 0;

alter table public.booking_payments
  add constraint booking_payments_refund_amount_cents_check check (refund_amount_cents >= 0);
