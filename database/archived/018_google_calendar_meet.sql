-- Western Tutors Google Calendar and Google Meet foundation
-- Run this after database/017_pair_chat_policy_fix.sql.

create table if not exists public.google_oauth_states (
  state text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.google_calendar_connections (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  google_account_email text,
  refresh_token text not null,
  access_token text,
  token_expires_at timestamptz,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.bookings
  add column if not exists google_calendar_event_id text,
  add column if not exists google_calendar_html_link text,
  add column if not exists google_calendar_status text default 'not_created';

alter table public.google_oauth_states enable row level security;
alter table public.google_calendar_connections enable row level security;

drop policy if exists "Users can read own calendar connection" on public.google_calendar_connections;
create policy "Users can read own calendar connection"
  on public.google_calendar_connections for select
  using (user_id = auth.uid());

drop policy if exists "Users can delete own calendar connection" on public.google_calendar_connections;
create policy "Users can delete own calendar connection"
  on public.google_calendar_connections for delete
  using (user_id = auth.uid());

drop policy if exists "Admins can read calendar connection status" on public.google_calendar_connections;
create policy "Admins can read calendar connection status"
  on public.google_calendar_connections for select
  using (public.is_admin(auth.uid()));
