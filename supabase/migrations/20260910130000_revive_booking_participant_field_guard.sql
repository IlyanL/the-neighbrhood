-- private.protect_booking_participant_fields has never blocked anything. Revive it.
--
-- 20260829000000_protect_booking_payment_and_participant_fields.sql added it as a "second
-- line of defense" behind the column GRANTs, guarding payment_status, student_id, tutor_id,
-- requested_start, requested_end and ics_sequence. Its two escape hatches read:
--
--   is_service_role := coalesce(current_setting('request.jwt.claim.role', true),'') = 'service_role';
--   if current_user not in ('authenticated', 'anon') then return new; end if;
--
-- Both are inoperative on this project, measured on the live database from a simulated
-- PostgREST session (role GUC `authenticated`, request.jwt.claims set):
--
--   current_user = postgres | session_user = postgres | role GUC = authenticated
--   request.jwt.claim.role = <unset>
--
--   * The function is SECURITY DEFINER, so current_user inside it is the function OWNER,
--     `postgres` — never 'authenticated'. The second guard therefore returns early on every
--     call, and the body below it is unreachable.
--   * `request.jwt.claim.role` (singular) is not set by this project's PostgREST, so
--     is_service_role is always false as well.
--
-- The protection those columns actually have today comes entirely from the column GRANTs in
-- the same migration (`revoke update ... grant update (status, topic, session_notes,
-- updated_at)`), which are real and which the RLS suite covers. The trigger is decoration.
-- That is fine until someone widens the grants again — which is exactly the regression the
-- trigger was added to survive.
--
-- THE FIX: SECURITY INVOKER.
--
-- Switching the function to SECURITY INVOKER makes current_user mean what the original
-- author wrote it to mean:
--   * a direct PostgREST write runs as `authenticated`/`anon` -> the guard applies;
--   * the service role runs as `service_role` -> early return;
--   * public.move_booking_time and the other vetted RPCs are SECURITY DEFINER owned by
--     postgres, so inside them current_user is `postgres` -> early return.
--
-- That last case is load-bearing and is why this cannot simply switch to the `role` GUC the
-- way 20260910120000's status guard does: move_booking_time legitimately rewrites
-- requested_start, which is one of the columns guarded here. The role GUC stays
-- 'authenticated' inside a SECURITY DEFINER function, so a GUC-based check would break
-- rescheduling outright. current_user is the only signal that distinguishes the two, and it
-- only distinguishes them when the function is SECURITY INVOKER.
--
-- SECURITY INVOKER is safe here: the body reads only NEW/OLD and calls
-- private.is_neighbrhood_admin(), which is itself SECURITY DEFINER and on which
-- `authenticated` already holds USAGE on the schema and EXECUTE (both verified).
--
-- is_service_role is rewritten against the `role` GUC as well, so it reports correctly
-- rather than being dead weight. Either check alone would let the service role through.

create or replace function private.protect_booking_participant_fields()
returns trigger
language plpgsql
security invoker
set search_path = public, private
as $$
declare
  -- Correct on this project, unlike request.jwt.claim.role (singular), which is unset.
  -- Redundant with the current_user check below now that this is SECURITY INVOKER, kept
  -- because a service-role write should be self-evidently allowed at the top of the guard.
  is_service_role boolean := coalesce(current_setting('role', true), '') = 'service_role';
  is_admin boolean := private.is_neighbrhood_admin();
begin
  -- The payments routes and the notification/admin paths all act through the service role,
  -- which is server-side only and already does its own authorization.
  if is_service_role or is_admin then
    return new;
  end if;

  -- public.move_booking_time and the other vetted booking functions are SECURITY DEFINER,
  -- so inside them current_user is the function owner (`postgres`) rather than
  -- `authenticated`. Those functions verify the caller themselves (move_booking_time checks
  -- auth.uid() = student_id), so let them through — this trigger exists to stop *direct*
  -- table writes from a client, which is the only path that skips those checks.
  --
  -- This line only works because the function is SECURITY INVOKER. See the header.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if
    new.payment_status is distinct from old.payment_status
    or new.payment_total_cents is distinct from old.payment_total_cents
    or new.payment_platform_fee_cents is distinct from old.payment_platform_fee_cents
    or new.student_id is distinct from old.student_id
    or new.tutor_id is distinct from old.tutor_id
    or new.requested_start is distinct from old.requested_start
    or new.requested_end is distinct from old.requested_end
    or new.ics_sequence is distinct from old.ics_sequence
  then
    raise exception 'Payment, participant, and scheduling fields cannot be changed directly'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function private.protect_booking_participant_fields() from public;

-- The trigger itself is unchanged; only the function body/volatility is replaced above.
--
-- Applied 2026-09-10 and verified against the live database inside rolled-back transactions.
-- With the column grants temporarily widened (grant update on bookings to authenticated) so
-- the trigger is actually reachable, as a signed-in student:
--   payment_status -> 'paid'       : BLOCKED (42501) by the trigger  [previously ALLOWED]
--   tutor_id rewrite               : BLOCKED (42501) by the trigger  [previously ALLOWED]
--   requested_start rewrite        : BLOCKED (42501) by the trigger  [previously ALLOWED]
-- And with the grants left as they ship:
--   public.move_booking_time       : still succeeds (rewrites requested_start)
--   ordinary status/topic edits    : unaffected
