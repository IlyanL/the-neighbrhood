-- CourseForge admin publishing policies
-- Run this in Supabase SQL Editor when you want admin accounts to approve courses.

drop policy if exists "Admins can read all courses" on public.courses;

create policy "Admins can read all courses"
  on public.courses for select
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
    )
  );

drop policy if exists "Admins can update all courses" on public.courses;

create policy "Admins can update all courses"
  on public.courses for update
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
    )
  )
  with check (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
    )
  );

drop policy if exists "Admins can read all lessons" on public.lessons;

create policy "Admins can read all lessons"
  on public.lessons for select
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
    )
  );

