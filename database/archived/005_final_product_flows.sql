-- Western Tutors final product flow migration
-- Run this after database/004_tutoring_marketplace.sql.
-- It adds profile creation, tutor review/interviews, booking intake, and notification-ready tables.

create table if not exists public.student_profiles (
  id uuid primary key references public.profiles(id) on delete cascade,
  display_name text,
  major text,
  year text,
  courses_interested text[] not null default '{}',
  learning_mode text not null default 'Any' check (learning_mode in ('Online', 'In person', 'Any')),
  goals text,
  availability_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tutor_profiles
  add column if not exists university text not null default 'Western University',
  add column if not exists major text not null default 'Undeclared',
  add column if not exists gpa_percent integer check (gpa_percent is null or (gpa_percent >= 0 and gpa_percent <= 100)),
  add column if not exists headline text,
  add column if not exists teaching_style text,
  add column if not exists languages text,
  add column if not exists campus_locations text,
  add column if not exists application_status text not null default 'pending',
  add column if not exists interview_start timestamptz,
  add column if not exists interview_mode text check (interview_mode is null or interview_mode in ('Online', 'In person', 'Any')),
  add column if not exists interview_link text,
  add column if not exists admin_notes text,
  add column if not exists decline_reason text,
  add column if not exists transcript_reviewed boolean not null default false,
  add column if not exists resume_reviewed boolean not null default false,
  add column if not exists interview_completed boolean not null default false,
  add column if not exists references_checked boolean not null default false,
  add column if not exists approved_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tutor_profiles_application_status_check'
  ) then
    alter table public.tutor_profiles
      add constraint tutor_profiles_application_status_check
      check (application_status in ('pending', 'interview_scheduled', 'accepted', 'declined'));
  end if;
end $$;

alter table public.bookings
  add column if not exists urgency text,
  add column if not exists goals text;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null,
  email_to text,
  email_status text not null default 'pending' check (email_status in ('pending', 'sent', 'failed', 'skipped')),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.student_profiles enable row level security;
alter table public.notifications enable row level security;

drop policy if exists "Verified and pending tutor profiles are public" on public.tutor_profiles;
drop policy if exists "Accepted tutor profiles are public" on public.tutor_profiles;
drop policy if exists "Tutors can read own profile" on public.tutor_profiles;
drop policy if exists "Admins can read all tutor profiles" on public.tutor_profiles;
drop policy if exists "Admins can verify tutor profiles" on public.tutor_profiles;

create policy "Accepted tutor profiles are public"
  on public.tutor_profiles for select
  using (application_status = 'accepted' and is_verified = true);

create policy "Tutors can read own profile"
  on public.tutor_profiles for select
  using (auth.uid() = id);

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

drop policy if exists "Users can read own student profile" on public.student_profiles;
drop policy if exists "Users can upsert own student profile" on public.student_profiles;

create policy "Users can read own student profile"
  on public.student_profiles for select
  using (auth.uid() = id);

create policy "Users can upsert own student profile"
  on public.student_profiles for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "Admins can read all bookings" on public.bookings;
drop policy if exists "Admins can update all bookings" on public.bookings;

create policy "Admins can read all bookings"
  on public.bookings for select
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
    )
  );

create policy "Admins can update all bookings"
  on public.bookings for update
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

drop policy if exists "Users can read own notifications" on public.notifications;
drop policy if exists "Users can update own notifications" on public.notifications;
drop policy if exists "Admins can create notifications" on public.notifications;

create policy "Users can read own notifications"
  on public.notifications for select
  using (auth.uid() = user_id);

create policy "Users can update own notifications"
  on public.notifications for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Admins can create notifications"
  on public.notifications for insert
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
    )
  );
