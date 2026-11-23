-- Close a payment bypass: a signed-in student could mark their own booking paid.
--
-- Three facts combined into the hole:
--   1. 20260812231500_phase4_product_correctness.sql granted table-wide UPDATE on
--      public.bookings to `authenticated`, with no column list.
--   2. database/007_cleanup_admin_and_booking_edits.sql's "Students can update own
--      bookings" policy checks only `auth.uid() = student_id` — no column restriction —
--      and was never dropped by a later migration.
--   3. No BEFORE UPDATE guard trigger existed on public.bookings.
--
-- So this succeeded from any student's browser console, against the public anon key:
--   supabase.from('bookings').update({ payment_status: 'paid' }).eq('id', myBookingId)
--
-- The same gap also allowed rewriting tutor_id (granting a private classroom with an
-- arbitrary person, since classroom access is granted purely on student_id/tutor_id
-- membership and the verified-tutor check lives only in the INSERT trigger) and
-- requested_start (bypassing slot-claiming in public.move_booking_time).
--
-- Modelled on private.protect_tutor_moderation_fields, which already solves exactly this
-- shape for public.tutor_profiles (20260812193000_lock_down_tutor_application_data.sql).

create or replace function private.protect_booking_participant_fields()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  is_service_role boolean := coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role';
  is_admin boolean := private.is_neighbrhood_admin();
begin
  -- The payments routes and the notification/admin paths all act through the service role,
  -- which is server-side only and already does its own authorization.
  if is_service_role or is_admin then
    return new;
  end if;

  -- public.move_booking_time and the other vetted booking functions are SECURITY DEFINER,
  -- so inside them current_user is the function owner rather than `authenticated`. Those
  -- functions already verify the caller themselves (move_booking_time checks
  -- auth.uid() = student_id), so let them through — this trigger exists to stop *direct*
  -- table writes from a client, which is the only path that skips those checks.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if
    new.payment_status is distinct from old.payment_status
    or new.payment_total_cents is distinct from old.payment_total_cents
    or new.payment_platform_fee_cents is distinct from old.payment_platform_fee_cents
    -- NB: refund_amount_cents lives on booking_payments, not here. An earlier draft of this
    -- migration guarded it on bookings; PL/pgSQL only resolves NEW.<col> at runtime, so that
    -- would have thrown on every booking update rather than failing at creation.
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

drop trigger if exists protect_booking_participant_fields on public.bookings;
create trigger protect_booking_participant_fields
before update on public.bookings
for each row execute function private.protect_booking_participant_fields();

-- Second layer, independent of the trigger. PostgreSQL grants are column-aware: revoking
-- the blanket UPDATE and re-granting only the columns a participant may legitimately edit
-- means PostgREST rejects a request naming any other column before a row is ever touched.
--
-- The list is deliberately minimal. Browser code updates exactly one column on this table
-- (`status`, at app/page.tsx:864 and :2048); everything else reaches bookings either
-- through the service role or through the SECURITY DEFINER functions above, and neither
-- needs a grant to `authenticated` — a SECURITY DEFINER function runs with its owner's
-- privileges, and that owner is `postgres`. The remaining columns are listed only because
-- they are plainly non-sensitive and cheap insurance against a path not covered by tests.
revoke update on table public.bookings from authenticated;

grant update (
  status,
  topic,
  session_notes,
  updated_at
) on table public.bookings to authenticated;

-- Applied 2026-08-29 and verified against the live database, simulating a signed-in
-- student via `set local role authenticated` inside a rolled-back transaction:
--   payment_status -> paid  : BLOCKED (42501)
--   tutor_id rewrite        : BLOCKED (42501)
--   requested_start rewrite : BLOCKED (42501)
--   legitimate status edit  : allowed
--   reschedule through a postgres-owned SECURITY DEFINER function : allowed
-- Pre-existing data was also checked: 3 paid bookings, 3 matching booking_payments rows,
-- so the gap was never exploited before it was closed.
