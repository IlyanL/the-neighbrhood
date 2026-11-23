-- Replace the legacy public SECURITY DEFINER admin RPC with the existing
-- private, zero-argument role check. The private function checks auth.uid()
-- internally and is not exposed through the Data API.

drop policy if exists "Admins can read all bookings" on public.bookings;
create policy "Admins can read all bookings" on public.bookings
  for select to authenticated using (private.is_neighbrhood_admin());

drop policy if exists "Admins can update all bookings" on public.bookings;
create policy "Admins can update all bookings" on public.bookings
  for update to authenticated
  using (private.is_neighbrhood_admin())
  with check (private.is_neighbrhood_admin());

drop policy if exists "Admins can read calendar connection status" on public.google_calendar_connections;
create policy "Admins can read calendar connection status" on public.google_calendar_connections
  for select to authenticated using (private.is_neighbrhood_admin());

drop policy if exists "Admins can create notifications" on public.notifications;
create policy "Admins can create notifications" on public.notifications
  for insert to authenticated with check (private.is_neighbrhood_admin());

drop policy if exists "Admins can read profiles" on public.profiles;
create policy "Admins can read profiles" on public.profiles
  for select to authenticated using (private.is_neighbrhood_admin());

drop policy if exists "Admins can update profiles" on public.profiles;
create policy "Admins can update profiles" on public.profiles
  for update to authenticated
  using (private.is_neighbrhood_admin())
  with check (private.is_neighbrhood_admin());

drop policy if exists "Admins can read tutor availability" on public.tutor_availability;
create policy "Admins can read tutor availability" on public.tutor_availability
  for select to authenticated using (private.is_neighbrhood_admin());

drop policy if exists "Admins can read tutor courses" on public.tutor_courses;
create policy "Admins can read tutor courses" on public.tutor_courses
  for select to authenticated using (private.is_neighbrhood_admin());

drop policy if exists "Admins can read all tutor profiles" on public.tutor_profiles;
create policy "Admins can read all tutor profiles" on public.tutor_profiles
  for select to authenticated using (private.is_neighbrhood_admin());

drop policy if exists "Admins can update tutor applications" on public.tutor_profiles;
create policy "Admins can update tutor applications" on public.tutor_profiles
  for update to authenticated
  using (private.is_neighbrhood_admin())
  with check (private.is_neighbrhood_admin());

drop function if exists public.is_admin(uuid);
