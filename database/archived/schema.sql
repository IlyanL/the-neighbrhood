-- CourseForge starter database schema
-- Paste this into Supabase: SQL Editor -> New query -> Run.

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'student' check (role in ('student', 'creator', 'tutor', 'admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid references public.profiles(id) on delete set null,
  title text not null,
  category text not null,
  description text not null,
  price_cents integer not null default 0 check (price_cents >= 0),
  status text not null default 'draft' check (status in ('draft', 'published')),
  thumbnail_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null,
  content text not null default '',
  video_url text,
  lesson_order integer not null default 1,
  quiz_question text,
  quiz_answer text,
  created_at timestamptz not null default now()
);

create table if not exists public.enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (student_id, course_id)
);

create table if not exists public.lesson_progress (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  completed_at timestamptz not null default now(),
  unique (student_id, lesson_id)
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.profiles(id) on delete set null,
  course_id uuid references public.courses(id) on delete set null,
  stripe_checkout_session_id text unique,
  amount_cents integer not null check (amount_cents >= 0),
  platform_fee_cents integer not null default 0 check (platform_fee_cents >= 0),
  creator_payout_cents integer not null default 0 check (creator_payout_cents >= 0),
  status text not null default 'pending' check (status in ('pending', 'paid', 'refunded', 'failed')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.courses enable row level security;
alter table public.lessons enable row level security;
alter table public.enrollments enable row level security;
alter table public.lesson_progress enable row level security;
alter table public.payments enable row level security;

create policy "Published courses are public"
  on public.courses for select
  using (status = 'published');

create policy "Published lessons are public"
  on public.lessons for select
  using (
    exists (
      select 1
      from public.courses
      where courses.id = lessons.course_id
      and courses.status = 'published'
    )
  );

create policy "Users can read own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Users can read own enrollments"
  on public.enrollments for select
  using (auth.uid() = student_id);

create policy "Users can read own progress"
  on public.lesson_progress for select
  using (auth.uid() = student_id);

create policy "Users can insert own progress"
  on public.lesson_progress for insert
  with check (auth.uid() = student_id);

create policy "Creators can manage own courses"
  on public.courses for all
  using (auth.uid() = creator_id)
  with check (auth.uid() = creator_id);

create policy "Creators can manage own lessons"
  on public.lessons for all
  using (
    exists (
      select 1
      from public.courses
      where courses.id = lessons.course_id
      and courses.creator_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.courses
      where courses.id = lessons.course_id
      and courses.creator_id = auth.uid()
    )
  );

insert into public.courses (title, category, description, price_cents, status)
values
  (
    'ACCT101 Accounting Survival System',
    'Accounting',
    'A structured study package for journal entries, financial statements, and exam-style practice.',
    7900,
    'published'
  ),
  (
    'FIN200 Time Value of Money Sprint',
    'Finance',
    'Learn present value, future value, annuities, and calculator workflows through short lessons.',
    5900,
    'published'
  )
on conflict do nothing;
