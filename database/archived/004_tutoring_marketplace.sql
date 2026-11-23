-- Western Tutors marketplace migration
-- Run this in Supabase SQL Editor after the existing CourseForge SQL files.
-- It keeps the old course tables intact and adds the tutoring marketplace tables.

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('student', 'creator', 'tutor', 'admin'));

create table if not exists public.tutor_profiles (
  id uuid primary key references public.profiles(id) on delete cascade,
  display_name text not null,
  photo_url text,
  year text not null,
  gpa_range text not null,
  hourly_rate_cents integer not null default 0 check (hourly_rate_cents >= 0),
  bio text not null default '',
  delivery_modes text[] not null default array['In person', 'Online'],
  is_verified boolean not null default false,
  response_minutes integer not null default 30 check (response_minutes >= 0),
  rating numeric(2, 1) not null default 0 check (rating >= 0 and rating <= 5),
  review_count integer not null default 0 check (review_count >= 0),
  session_count integer not null default 0 check (session_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tutor_courses (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references public.tutor_profiles(id) on delete cascade,
  course_code text not null,
  created_at timestamptz not null default now(),
  unique (tutor_id, course_code)
);

create table if not exists public.tutor_availability (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references public.tutor_profiles(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz,
  delivery_mode text not null default 'In person' check (delivery_mode in ('In person', 'Online')),
  is_booked boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  tutor_id uuid not null references public.tutor_profiles(id) on delete cascade,
  course_code text not null,
  requested_start timestamptz not null,
  requested_end timestamptz,
  delivery_mode text not null check (delivery_mode in ('In person', 'Online')),
  status text not null default 'requested' check (status in ('requested', 'confirmed', 'declined', 'completed', 'cancelled')),
  topic text,
  meet_link text,
  session_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.booking_messages (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.session_notes (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  tutor_id uuid not null references public.tutor_profiles(id) on delete cascade,
  summary text not null,
  next_steps text,
  created_at timestamptz not null default now()
);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  tutor_id uuid not null references public.tutor_profiles(id) on delete cascade,
  rating integer not null check (rating >= 1 and rating <= 5),
  body text,
  created_at timestamptz not null default now(),
  unique (booking_id, student_id)
);

create table if not exists public.booking_payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  student_id uuid references public.profiles(id) on delete set null,
  tutor_id uuid references public.tutor_profiles(id) on delete set null,
  stripe_checkout_session_id text unique,
  amount_cents integer not null check (amount_cents >= 0),
  platform_fee_cents integer not null default 0 check (platform_fee_cents >= 0),
  tutor_payout_cents integer not null default 0 check (tutor_payout_cents >= 0),
  status text not null default 'pending' check (status in ('pending', 'paid', 'refunded', 'failed')),
  created_at timestamptz not null default now()
);

alter table public.tutor_profiles enable row level security;
alter table public.tutor_courses enable row level security;
alter table public.tutor_availability enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_messages enable row level security;
alter table public.session_notes enable row level security;
alter table public.reviews enable row level security;
alter table public.booking_payments enable row level security;

create policy "Verified and pending tutor profiles are public"
  on public.tutor_profiles for select
  using (true);

create policy "Tutors can upsert own profile"
  on public.tutor_profiles for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "Tutor courses are public"
  on public.tutor_courses for select
  using (true);

create policy "Tutors can manage own course list"
  on public.tutor_courses for all
  using (auth.uid() = tutor_id)
  with check (auth.uid() = tutor_id);

create policy "Tutor availability is public"
  on public.tutor_availability for select
  using (true);

create policy "Tutors can manage own availability"
  on public.tutor_availability for all
  using (auth.uid() = tutor_id)
  with check (auth.uid() = tutor_id);

create policy "Students and tutors can read own bookings"
  on public.bookings for select
  using (auth.uid() = student_id or auth.uid() = tutor_id);

create policy "Students can request bookings"
  on public.bookings for insert
  with check (auth.uid() = student_id);

create policy "Tutors can update own bookings"
  on public.bookings for update
  using (auth.uid() = tutor_id)
  with check (auth.uid() = tutor_id);

create policy "Booking participants can read messages"
  on public.booking_messages for select
  using (
    exists (
      select 1 from public.bookings
      where bookings.id = booking_messages.booking_id
      and (bookings.student_id = auth.uid() or bookings.tutor_id = auth.uid())
    )
  );

create policy "Booking participants can send messages"
  on public.booking_messages for insert
  with check (
    auth.uid() = sender_id
    and exists (
      select 1 from public.bookings
      where bookings.id = booking_messages.booking_id
      and (bookings.student_id = auth.uid() or bookings.tutor_id = auth.uid())
    )
  );

create policy "Booking participants can read session notes"
  on public.session_notes for select
  using (
    exists (
      select 1 from public.bookings
      where bookings.id = session_notes.booking_id
      and (bookings.student_id = auth.uid() or bookings.tutor_id = auth.uid())
    )
  );

create policy "Tutors can create session notes"
  on public.session_notes for insert
  with check (auth.uid() = tutor_id);

create policy "Reviews are public"
  on public.reviews for select
  using (true);

create policy "Students can review own completed bookings"
  on public.reviews for insert
  with check (
    auth.uid() = student_id
    and exists (
      select 1 from public.bookings
      where bookings.id = reviews.booking_id
      and bookings.student_id = auth.uid()
      and bookings.status = 'completed'
    )
  );

create policy "Users can read own booking payments"
  on public.booking_payments for select
  using (auth.uid() = student_id or auth.uid() = tutor_id);

create policy "Admins can read all tutor profiles"
  on public.tutor_profiles for select
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
    )
  );

create policy "Admins can verify tutor profiles"
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
