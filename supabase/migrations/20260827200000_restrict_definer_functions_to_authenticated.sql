-- These SECURITY DEFINER functions already reject unauthenticated/unauthorized callers
-- internally (auth.uid() checks, private.is_neighbrhood_admin()), but the database grant
-- itself had regressed to allowing anon/PUBLIC to call them at all — likely lost when a
-- later migration replaced the function body without restating the original revoke/grant.
-- Restrict to authenticated only, matching the original intent (see
-- 20260821000000_booking_time_move_and_cancellation_fees.sql for move_booking_time).
revoke execute on function public.approve_club_event(uuid) from public, anon;
revoke execute on function public.decline_club_event(uuid) from public, anon;
revoke execute on function public.decline_booking_time_change(uuid) from public, anon;
revoke execute on function public.move_booking_time(uuid, timestamptz) from public, anon;
revoke execute on function public.request_booking_time_change(uuid, timestamptz) from public, anon;

grant execute on function public.approve_club_event(uuid) to authenticated;
grant execute on function public.decline_club_event(uuid) to authenticated;
grant execute on function public.decline_booking_time_change(uuid) to authenticated;
grant execute on function public.move_booking_time(uuid, timestamptz) to authenticated;
grant execute on function public.request_booking_time_change(uuid, timestamptz) to authenticated;
