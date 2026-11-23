-- Close a free-session bypass: a signed-in participant could reopen a finished booking.
--
-- 20260829000000_protect_booking_payment_and_participant_fields.sql locked down *which*
-- columns a participant may write, and deliberately left `status` grantable because browser
-- code legitimately updates it. What it did not add is any rule about *which transition* a
-- participant may make, and the RLS policies ("Students can update own bookings" / "Tutors
-- can update own bookings") only check participation.
--
-- Verified against the live database on 2026-09-10, as the student on an existing booking:
--   update public.bookings set status = 'confirmed' -> SUCCEEDED
--   update public.bookings set status = 'completed' -> SUCCEEDED
--
-- This app is instant-book: app/page.tsx inserts a booking already `confirmed`, so
-- self-confirming is not itself the hole. Reopening a terminal booking is:
--
--   1. Book and pay.
--   2. Cancel more than 12 hours out, through /api/payments/cancel-booking, for a FULL
--      refund. The booking becomes status='cancelled', payment_status='refunded'.
--   3. From the browser console, against the public anon key:
--        supabase.from('bookings').update({ status: 'confirmed' }).eq('id', myBookingId)
--   4. Attend the session for free.
--
-- Step 3 is what this migration stops. `payment_status` stays 'refunded' throughout — the
-- 2026-08-29 column grants hold — but nothing reads it: lib/classroom/policy.ts's
-- classroomJoinState and the LiveKit token route both gate purely on status = 'confirmed'.
-- The same trick flips a 'completed' session back to 'confirmed' to regain a live video
-- room, and setting 'declined' directly made a session vanish while skipping the
-- cancellation fee that /api/payments/cancel-booking computes.
--
--
-- WHY THIS DOES NOT USE current_user
--
-- private.protect_booking_participant_fields (2026-08-29) gates itself on
--   if current_user not in ('authenticated', 'anon') then return new; end if;
-- intending "let the SECURITY DEFINER booking RPCs through, guard direct client writes".
-- That check does not do what it reads like. Inside a SECURITY DEFINER function
-- current_user is the function OWNER, so in that trigger current_user is always `postgres`
-- and the guard returns early on every single call. Measured on the live database from a
-- simulated PostgREST session:
--
--   current_user = postgres | session_user = postgres | role GUC = authenticated
--   request.jwt.claims = {"sub": "...", "role": "authenticated"}
--   request.jwt.claim.role = <unset>
--
-- Two consequences. First, the `role` GUC — not current_user — is the signal that survives
-- the definer switch, so this function uses it. Second, `request.jwt.claim.role` (singular)
-- is unset on this project, so the `is_service_role` variable in the 2026-08-29 trigger is
-- always false as well. That trigger's protection of payment_status/tutor_id/requested_start
-- is real but comes entirely from its column GRANTs, not from its trigger body. Worth
-- revisiting on its own; it is out of scope here and the grants do currently hold the line.
--
-- Because there is no reliable "am I inside a trusted function" signal, this guard does not
-- try to detect one. It enumerates every legal transition instead, which is strictly
-- stronger: a future SECURITY DEFINER function cannot silently introduce an illegal one
-- either. The three vetted RPCs each still enforce their own actor rules on top of this.

create or replace function private.enforce_booking_status_transition()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  -- Survives the SECURITY DEFINER switch, unlike current_user. PostgREST issues
  -- `set local role authenticated` / `service_role`; a direct maintenance connection
  -- leaves it unset or at the login role.
  effective_role text := coalesce(current_setting('role', true), '');
  is_admin boolean := private.is_neighbrhood_admin();
  actor uuid := (select auth.uid());
begin
  -- `before update of status` fires whenever the column is named in the UPDATE, even if the
  -- value is unchanged. A re-send of the same status is a no-op, not a transition — the
  -- classroom's "end" action can legitimately re-end an already-completed session.
  if new.status is not distinct from old.status then
    return new;
  end if;

  -- Anything that is not a browser session: the service role (every payments route, which
  -- does its own authorization) and direct database connections.
  if effective_role not in ('authenticated', 'anon') then
    return new;
  end if;

  if is_admin then
    return new;
  end if;

  -- Terminal. A finished, cancelled or declined session never reopens for a participant.
  -- This is the step-3 bypass above.
  if old.status in ('completed', 'cancelled', 'declined') then
    raise exception 'A % session cannot change status.', old.status
      using errcode = '42501';
  end if;

  -- Cancellation has to go through /api/payments/cancel-booking, which computes the refund
  -- and the 12-hour cancellation fee against Stripe. A direct write here would cancel the
  -- session while skipping both. That route acts as the service role and is let through
  -- above. 'declined' from 'confirmed' was a side door to the same result and is barred by
  -- the transition table below.
  if new.status = 'cancelled' then
    raise exception 'Cancel this session through the app so the refund is handled.'
      using errcode = '42501';
  end if;

  -- Either participant may finish a confirmed session: the overdue sweep in app/page.tsx
  -- (whichever participant loads their sessions first past the end time) and the tutor's
  -- "end classroom" action in app/api/classrooms/[bookingId]/route.ts both do this.
  if new.status = 'completed' then
    if old.status <> 'confirmed' then
      raise exception 'Only a confirmed session can be completed.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- public.request_booking_time_change: tutor only, confirmed -> time_change_requested.
  if new.status = 'time_change_requested' then
    if old.status <> 'confirmed' then
      raise exception 'Only a confirmed session can have a new time proposed.'
        using errcode = '42501';
    end if;
    if actor is distinct from new.tutor_id then
      raise exception 'Only the tutor can propose a new time for this session.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.status = 'confirmed' then
    -- public.move_booking_time (student accepts) and public.decline_booking_time_change
    -- (either participant declines, restoring time_change_previous_status) both land here.
    if old.status = 'time_change_requested' then
      if actor is distinct from new.student_id and actor is distinct from new.tutor_id then
        raise exception 'Only a participant can settle this time change.'
          using errcode = '42501';
      end if;
      return new;
    end if;
    -- Accepting a request is the tutor's call alone. Vestigial under instant-book, kept
    -- because the 'requested' default and its RLS insert policy still exist.
    if old.status = 'requested' then
      if actor is distinct from new.tutor_id then
        raise exception 'Only the tutor can accept this session.'
          using errcode = '42501';
      end if;
      return new;
    end if;
    raise exception 'This session cannot be confirmed from %.', old.status
      using errcode = '42501';
  end if;

  if new.status = 'declined' then
    if old.status <> 'requested' then
      raise exception 'Only a pending request can be declined.'
        using errcode = '42501';
    end if;
    if actor is distinct from new.tutor_id then
      raise exception 'Only the tutor can decline this session.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- decline_booking_time_change restores coalesce(time_change_previous_status,'confirmed'),
  -- which request_booking_time_change can only ever have set to 'confirmed'. Allowed
  -- defensively in case an older row carries 'requested'.
  if new.status = 'requested' and old.status = 'time_change_requested' then
    if actor is distinct from new.student_id and actor is distinct from new.tutor_id then
      raise exception 'Only a participant can settle this time change.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  raise exception 'Unsupported session status change: % -> %.', old.status, new.status
    using errcode = '42501';
end;
$$;

revoke all on function private.enforce_booking_status_transition() from public;

-- Trigger names fire in alphabetical order, so this runs before
-- protect_booking_participant_fields. Either raising is fine; both use errcode 42501, which
-- PostgREST surfaces as a 403.
drop trigger if exists enforce_booking_status_transition on public.bookings;
create trigger enforce_booking_status_transition
before update of status on public.bookings
for each row execute function private.enforce_booking_status_transition();

-- INSERT is deliberately untouched. Instant-book writes status='confirmed' on insert, and
-- the existing claim_tutor_slot_before_booking trigger already vets that path.
--
-- Applied 2026-09-10 and verified against the live database, simulating a signed-in student
-- (role GUC `authenticated` + request.jwt.claims) inside a rolled-back transaction:
--   cancelled  -> confirmed (the bypass)     : BLOCKED (42501)
--   completed  -> confirmed                  : BLOCKED (42501)
--   confirmed  -> cancelled (fee dodge)      : BLOCKED (42501)
--   confirmed  -> declined  (fee dodge)      : BLOCKED (42501)
--   confirmed  -> completed (overdue sweep)  : allowed
--   completed  -> completed (re-end no-op)   : allowed
--   topic edit on a completed booking        : allowed
--   the three time-change RPCs               : allowed
