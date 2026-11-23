-- Western Tutors tutor application visibility fix
-- Run this after database/009_tutor_storage.sql.
-- It makes sure the owner account is a real database admin and can see pending tutor applications.

alter table public.profiles
  add column if not exists email text;

alter table public.tutor_profiles
  add column if not exists photo_url text,
  add column if not exists resume_file_name text,
  add column if not exists transcript_file_name text,
  add column if not exists resume_path text,
  add column if not exists transcript_path text;

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

drop policy if exists "Admins can read all tutor profiles" on public.tutor_profiles;
drop policy if exists "Admins can update tutor applications" on public.tutor_profiles;
drop policy if exists "Admins can verify tutor profiles" on public.tutor_profiles;

create policy "Admins can read all tutor profiles"
  on public.tutor_profiles for select
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
    )
  );

create policy "Admins can update tutor applications"
  on public.tutor_profiles for update
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
    )
  );

drop policy if exists "Admins can read tutor courses" on public.tutor_courses;
drop policy if exists "Admins can read tutor availability" on public.tutor_availability;

create policy "Admins can read tutor courses"
  on public.tutor_courses for select
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
    )
  );

create policy "Admins can read tutor availability"
  on public.tutor_availability for select
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
    )
  );
