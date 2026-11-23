-- Western Tutors admin/profile refinement migration
-- Run this after database/005_final_product_flows.sql.
-- Adds profile emails for admin promotion and private tutor resume/transcript fields.

alter table public.profiles
  add column if not exists email text;

create unique index if not exists profiles_email_unique
  on public.profiles (lower(email))
  where email is not null;

alter table public.tutor_profiles
  add column if not exists resume_file_name text,
  add column if not exists transcript_file_name text;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'role', 'student'),
    lower(new.email)
  )
  on conflict (id) do update
  set
    full_name = excluded.full_name,
    role = excluded.role,
    email = excluded.email;

  return new;
end;
$$;

drop policy if exists "Admins can read profiles" on public.profiles;
drop policy if exists "Admins can update profiles" on public.profiles;

create policy "Admins can read profiles"
  on public.profiles for select
  using (
    exists (
      select 1 from public.profiles admin_profile
      where admin_profile.id = auth.uid()
      and admin_profile.role = 'admin'
    )
  );

create policy "Admins can update profiles"
  on public.profiles for update
  using (
    exists (
      select 1 from public.profiles admin_profile
      where admin_profile.id = auth.uid()
      and admin_profile.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles admin_profile
      where admin_profile.id = auth.uid()
      and admin_profile.role = 'admin'
    )
  );
