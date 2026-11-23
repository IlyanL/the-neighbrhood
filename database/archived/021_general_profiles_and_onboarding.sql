-- The Neighbrhood general profiles and onboarding
-- Run this after database/020_neighbrhood_platform_foundation.sql.
-- Adds one universal student identity while keeping tutor_profiles separate.

alter table public.profiles
  add column if not exists major text,
  add column if not exists year text,
  add column if not exists faculty text,
  add column if not exists bio text not null default '',
  add column if not exists interests text[] not null default '{}';

-- Existing student and tutor information becomes the starting general profile.
update public.profiles profile
set
  major = coalesce(nullif(profile.major, ''), student.major),
  year = coalesce(nullif(profile.year, ''), student.year)
from public.student_profiles student
where profile.id = student.id;

update public.profiles profile
set
  major = coalesce(nullif(profile.major, ''), tutor.major),
  year = coalesce(nullif(profile.year, ''), tutor.year),
  bio = case when profile.bio = '' then coalesce(tutor.bio, '') else profile.bio end
from public.tutor_profiles tutor
where profile.id = tutor.id;

-- Signup metadata is copied into the public profile by the existing Auth trigger.
-- The requested account type is deliberately restricted to student or tutor:
-- user-editable metadata can never create an admin account.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, role, email, major, year, faculty)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    case when new.raw_user_meta_data->>'role' = 'tutor' then 'tutor' else 'student' end,
    lower(new.email),
    coalesce(new.raw_user_meta_data->>'major', ''),
    coalesce(new.raw_user_meta_data->>'year', 'First year'),
    coalesce(new.raw_user_meta_data->>'faculty', '')
  )
  on conflict (id) do update
  set
    full_name = excluded.full_name,
    role = case when public.profiles.role = 'admin' then 'admin' else excluded.role end,
    email = excluded.email,
    major = excluded.major,
    year = excluded.year,
    faculty = excluded.faculty;

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to supabase_auth_admin;

-- Prevent a signed-in user from promoting their own profiles.role value.
-- Admins can still use the existing admin account tool to change another user's role.
create or replace function private.protect_profile_role_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role is distinct from old.role and not private.is_neighbrhood_admin() then
    raise exception 'Only an admin can change an account role.';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_role_change on public.profiles;
create trigger protect_profile_role_change
  before update of role on public.profiles
  for each row execute function private.protect_profile_role_change();

revoke all on function private.protect_profile_role_change() from public;

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

grant select, update on table public.profiles to authenticated;
