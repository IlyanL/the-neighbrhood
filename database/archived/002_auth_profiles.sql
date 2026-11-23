-- CourseForge auth/profile setup
-- Run this in Supabase SQL Editor after database/schema.sql.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'role', 'student')
  )
  on conflict (id) do update
  set
    full_name = excluded.full_name,
    role = excluded.role;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

drop policy if exists "Users can insert own profile" on public.profiles;

create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "Users can insert own enrollments" on public.enrollments;

create policy "Users can insert own enrollments"
  on public.enrollments for insert
  with check (auth.uid() = student_id);

