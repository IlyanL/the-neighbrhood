-- Western Tutors saved tutors, placeholder payments, and focused booking notifications
-- Run this after database/018_google_calendar_meet.sql.

create table if not exists public.tutor_favorites (
  student_id uuid not null references public.profiles(id) on delete cascade,
  tutor_id uuid not null references public.tutor_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (student_id, tutor_id)
);

alter table public.bookings
  add column if not exists payment_status text not null default 'placeholder_pending',
  add column if not exists payment_total_cents integer not null default 0,
  add column if not exists payment_platform_fee_cents integer not null default 0,
  add column if not exists booking_policy_acknowledged_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'bookings_payment_status_check'
  ) then
    alter table public.bookings
      add constraint bookings_payment_status_check
      check (payment_status in ('placeholder_pending', 'placeholder_complete', 'stripe_pending', 'paid', 'refunded', 'failed'));
  end if;
end $$;

alter table public.notifications
  add column if not exists session_tab text;

alter table public.tutor_favorites enable row level security;

drop policy if exists "Students can read own favorite tutors" on public.tutor_favorites;
create policy "Students can read own favorite tutors"
  on public.tutor_favorites for select
  using (student_id = auth.uid());

drop policy if exists "Students can save favorite tutors" on public.tutor_favorites;
create policy "Students can save favorite tutors"
  on public.tutor_favorites for insert
  with check (student_id = auth.uid());

drop policy if exists "Students can remove own favorite tutors" on public.tutor_favorites;
create policy "Students can remove own favorite tutors"
  on public.tutor_favorites for delete
  using (student_id = auth.uid());
