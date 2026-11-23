-- Western Tutors profiles policy recursion fix
-- Run this after database/010_tutor_application_visibility.sql.
-- It removes profile policies that query profiles from inside profiles policies.

alter table public.profiles
  add column if not exists email text;

create or replace function public.is_admin(user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles
    where id = user_id
    and role = 'admin'
  );
$$;

grant execute on function public.is_admin(uuid) to authenticated;
grant execute on function public.is_admin(uuid) to anon;

drop policy if exists "Admins can read profiles" on public.profiles;
drop policy if exists "Admins can update profiles" on public.profiles;

create policy "Admins can read profiles"
  on public.profiles for select
  using (public.is_admin(auth.uid()));

create policy "Admins can update profiles"
  on public.profiles for update
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists "Admins can read all tutor profiles" on public.tutor_profiles;
drop policy if exists "Admins can update tutor applications" on public.tutor_profiles;
drop policy if exists "Admins can verify tutor profiles" on public.tutor_profiles;

create policy "Admins can read all tutor profiles"
  on public.tutor_profiles for select
  using (public.is_admin(auth.uid()));

create policy "Admins can update tutor applications"
  on public.tutor_profiles for update
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists "Admins can read tutor courses" on public.tutor_courses;
drop policy if exists "Admins can read tutor availability" on public.tutor_availability;

create policy "Admins can read tutor courses"
  on public.tutor_courses for select
  using (public.is_admin(auth.uid()));

create policy "Admins can read tutor availability"
  on public.tutor_availability for select
  using (public.is_admin(auth.uid()));

drop policy if exists "Admins can read all bookings" on public.bookings;
drop policy if exists "Admins can update all bookings" on public.bookings;

create policy "Admins can read all bookings"
  on public.bookings for select
  using (public.is_admin(auth.uid()));

create policy "Admins can update all bookings"
  on public.bookings for update
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists "Admins can create notifications" on public.notifications;

create policy "Admins can create notifications"
  on public.notifications for insert
  with check (public.is_admin(auth.uid()));

drop policy if exists "Admins can read tutor documents" on storage.objects;

create policy "Admins can read tutor documents"
  on storage.objects for select
  using (
    bucket_id = 'tutor-documents'
    and public.is_admin(auth.uid())
  );

insert into public.profiles (id, full_name, role, email)
select
  auth_user.id,
  coalesce(auth_user.raw_user_meta_data->>'full_name', ''),
  'admin',
  lower(auth_user.email)
from auth.users auth_user
where lower(auth_user.email) = 'owner@example.com'
on conflict (id) do update
set
  role = 'admin',
  email = excluded.email;

delete from public.student_profiles student_profile
using auth.users auth_user
where student_profile.id = auth_user.id
and lower(auth_user.email) = 'owner@example.com';
