-- The Neighbrhood platform foundation
-- Run this after database/019_favorites_payments_and_booking_focus.sql.
-- This migration adds Courses, Housing, and Clubs without changing the existing tutoring tables.

create schema if not exists private;

create or replace function private.is_neighbrhood_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'admin'
  );
$$;

revoke all on function private.is_neighbrhood_admin() from public;
grant usage on schema private to anon, authenticated;
grant execute on function private.is_neighbrhood_admin() to anon, authenticated;

-- Courses

create table if not exists public.western_courses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  faculty text not null,
  department text,
  level text not null,
  description text not null default '',
  terms text not null default '',
  credits numeric(3, 1),
  prerequisites text,
  antirequisites text,
  official_url text,
  tags text[] not null default '{}',
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.professors (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  department text,
  faculty text,
  profile_url text,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.course_professors (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.western_courses(id) on delete cascade,
  professor_id uuid not null references public.professors(id) on delete cascade,
  academic_year text,
  term text,
  created_at timestamptz not null default now(),
  unique (course_id, professor_id, academic_year, term)
);

create table if not exists public.student_course_statuses (
  student_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid not null references public.western_courses(id) on delete cascade,
  status text not null check (status in ('interested', 'selected', 'enrolled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (student_id, course_id)
);

create table if not exists public.course_reviews (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.western_courses(id) on delete cascade,
  professor_id uuid references public.professors(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  workload text not null check (workload in ('Light', 'Moderate', 'Heavy')),
  body text not null check (char_length(body) between 10 and 4000),
  is_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists course_reviews_one_course_review_per_student
  on public.course_reviews (course_id, student_id)
  where professor_id is null;

create unique index if not exists course_reviews_one_professor_review_per_student
  on public.course_reviews (course_id, professor_id, student_id)
  where professor_id is not null;

create table if not exists public.course_discussions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.western_courses(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  post_type text not null default 'question' check (post_type in ('question', 'tip', 'warning', 'resource', 'experience')),
  title text not null check (char_length(title) between 3 and 180),
  body text not null check (char_length(body) between 3 and 8000),
  is_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.course_discussion_comments (
  id uuid primary key default gen_random_uuid(),
  discussion_id uuid not null references public.course_discussions(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  parent_comment_id uuid references public.course_discussion_comments(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  is_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.course_discussion_votes (
  discussion_id uuid not null references public.course_discussions(id) on delete cascade,
  voter_id uuid not null references public.profiles(id) on delete cascade,
  vote smallint not null check (vote in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (discussion_id, voter_id)
);

-- Housing

create table if not exists public.housing_listings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 5 and 140),
  description text not null check (char_length(description) between 20 and 6000),
  listing_type text not null check (listing_type in ('Room', 'Sublet', 'Lease assignment', 'Entire unit', 'Roommate wanted')),
  area text not null,
  address_approximate text,
  monthly_price_cents integer not null check (monthly_price_cents > 0),
  bedroom_count numeric(3, 1) not null check (bedroom_count > 0),
  bathroom_count numeric(3, 1) check (bathroom_count > 0),
  available_from date not null,
  available_until date,
  furnished boolean not null default false,
  utilities_included boolean not null default false,
  distance_to_campus text,
  image_urls text[] not null default '{}',
  moderation_status text not null default 'pending' check (moderation_status in ('pending', 'active', 'rejected', 'removed', 'expired')),
  is_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (available_until is null or available_until >= available_from)
);

create table if not exists public.saved_housing_listings (
  student_id uuid not null references public.profiles(id) on delete cascade,
  listing_id uuid not null references public.housing_listings(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (student_id, listing_id)
);

create table if not exists public.housing_reports (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.housing_listings(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (reason in ('suspected_scam', 'misleading', 'duplicate', 'harassment', 'unavailable', 'other')),
  details text,
  status text not null default 'open' check (status in ('open', 'reviewing', 'resolved', 'dismissed')),
  created_at timestamptz not null default now(),
  unique (listing_id, reporter_id)
);

-- Clubs and events

create table if not exists public.clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  category text not null,
  description text not null default '',
  contact_email text,
  website_url text,
  instagram_url text,
  logo_url text,
  membership_details text,
  moderation_status text not null default 'pending' check (moderation_status in ('pending', 'active', 'rejected', 'archived')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.club_events (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  title text not null,
  description text not null default '',
  event_type text not null default 'event' check (event_type in ('event', 'application_deadline', 'recruitment', 'meeting')),
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text,
  external_url text,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at)
);

create table if not exists public.club_follows (
  student_id uuid not null references public.profiles(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (student_id, club_id)
);

-- Index every ownership and relationship field used by RLS or common browse queries.

create index if not exists course_professors_course_id_idx on public.course_professors (course_id);
create index if not exists course_professors_professor_id_idx on public.course_professors (professor_id);
create index if not exists student_course_statuses_student_id_idx on public.student_course_statuses (student_id);
create index if not exists course_reviews_course_id_idx on public.course_reviews (course_id);
create index if not exists course_reviews_student_id_idx on public.course_reviews (student_id);
create index if not exists course_discussions_course_id_idx on public.course_discussions (course_id, created_at desc);
create index if not exists course_discussions_author_id_idx on public.course_discussions (author_id);
create index if not exists course_discussion_comments_discussion_id_idx on public.course_discussion_comments (discussion_id, created_at);
create index if not exists course_discussion_comments_author_id_idx on public.course_discussion_comments (author_id);
create index if not exists housing_listings_owner_id_idx on public.housing_listings (owner_id);
create index if not exists housing_listings_browse_idx on public.housing_listings (moderation_status, monthly_price_cents, available_from);
create index if not exists housing_reports_listing_id_idx on public.housing_reports (listing_id);
create index if not exists club_events_club_id_idx on public.club_events (club_id, starts_at);
create index if not exists club_follows_student_id_idx on public.club_follows (student_id);

-- All public-schema tables exposed to the Data API have RLS enabled.

alter table public.western_courses enable row level security;
alter table public.professors enable row level security;
alter table public.course_professors enable row level security;
alter table public.student_course_statuses enable row level security;
alter table public.course_reviews enable row level security;
alter table public.course_discussions enable row level security;
alter table public.course_discussion_comments enable row level security;
alter table public.course_discussion_votes enable row level security;
alter table public.housing_listings enable row level security;
alter table public.saved_housing_listings enable row level security;
alter table public.housing_reports enable row level security;
alter table public.clubs enable row level security;
alter table public.club_events enable row level security;
alter table public.club_follows enable row level security;

-- Public course discovery; only admins can maintain canonical course and professor records.

create policy "Published Western courses are public" on public.western_courses
  for select to anon, authenticated using (is_published or private.is_neighbrhood_admin());
create policy "Admins manage Western courses" on public.western_courses
  for all to authenticated using (private.is_neighbrhood_admin()) with check (private.is_neighbrhood_admin());

create policy "Published professors are public" on public.professors
  for select to anon, authenticated using (is_published or private.is_neighbrhood_admin());
create policy "Admins manage professors" on public.professors
  for all to authenticated using (private.is_neighbrhood_admin()) with check (private.is_neighbrhood_admin());

create policy "Published course professor links are public" on public.course_professors
  for select to anon, authenticated using (
    exists (select 1 from public.western_courses where id = course_id and is_published)
    and exists (select 1 from public.professors where id = professor_id and is_published)
  );
create policy "Admins manage course professor links" on public.course_professors
  for all to authenticated using (private.is_neighbrhood_admin()) with check (private.is_neighbrhood_admin());

create policy "Students read own course statuses" on public.student_course_statuses
  for select to authenticated using ((select auth.uid()) = student_id);
create policy "Students add own course statuses" on public.student_course_statuses
  for insert to authenticated with check ((select auth.uid()) = student_id);
create policy "Students update own course statuses" on public.student_course_statuses
  for update to authenticated using ((select auth.uid()) = student_id) with check ((select auth.uid()) = student_id);
create policy "Students remove own course statuses" on public.student_course_statuses
  for delete to authenticated using ((select auth.uid()) = student_id);

create policy "Visible course reviews are public" on public.course_reviews
  for select to anon, authenticated using (is_visible or private.is_neighbrhood_admin());
create policy "Students create own course reviews" on public.course_reviews
  for insert to authenticated with check ((select auth.uid()) = student_id and is_visible = true);
create policy "Students update own course reviews" on public.course_reviews
  for update to authenticated using ((select auth.uid()) = student_id) with check ((select auth.uid()) = student_id);
create policy "Students delete own course reviews" on public.course_reviews
  for delete to authenticated using ((select auth.uid()) = student_id or private.is_neighbrhood_admin());

create policy "Visible course discussions are public" on public.course_discussions
  for select to anon, authenticated using (is_visible or private.is_neighbrhood_admin());
create policy "Students create own discussions" on public.course_discussions
  for insert to authenticated with check ((select auth.uid()) = author_id and is_visible = true);
create policy "Students update own discussions" on public.course_discussions
  for update to authenticated using ((select auth.uid()) = author_id) with check ((select auth.uid()) = author_id);
create policy "Students delete own discussions" on public.course_discussions
  for delete to authenticated using ((select auth.uid()) = author_id or private.is_neighbrhood_admin());

create policy "Visible course comments are public" on public.course_discussion_comments
  for select to anon, authenticated using (is_visible or private.is_neighbrhood_admin());
create policy "Students create own comments" on public.course_discussion_comments
  for insert to authenticated with check ((select auth.uid()) = author_id and is_visible = true);
create policy "Students update own comments" on public.course_discussion_comments
  for update to authenticated using ((select auth.uid()) = author_id) with check ((select auth.uid()) = author_id);
create policy "Students delete own comments" on public.course_discussion_comments
  for delete to authenticated using ((select auth.uid()) = author_id or private.is_neighbrhood_admin());

create policy "Discussion votes are public" on public.course_discussion_votes
  for select to anon, authenticated using (true);
create policy "Students add own discussion votes" on public.course_discussion_votes
  for insert to authenticated with check ((select auth.uid()) = voter_id);
create policy "Students update own discussion votes" on public.course_discussion_votes
  for update to authenticated using ((select auth.uid()) = voter_id) with check ((select auth.uid()) = voter_id);
create policy "Students remove own discussion votes" on public.course_discussion_votes
  for delete to authenticated using ((select auth.uid()) = voter_id);

-- Housing is public only after moderation. Owners can still see and manage their pending listings.

create policy "Active housing listings are public" on public.housing_listings
  for select to anon, authenticated using (moderation_status = 'active' or (select auth.uid()) = owner_id or private.is_neighbrhood_admin());
create policy "Students create pending housing listings" on public.housing_listings
  for insert to authenticated with check ((select auth.uid()) = owner_id and moderation_status = 'pending' and is_verified = false);
create policy "Owners update own housing listings" on public.housing_listings
  for update to authenticated using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id and moderation_status = 'pending' and is_verified = false);
create policy "Owners delete own housing listings" on public.housing_listings
  for delete to authenticated using ((select auth.uid()) = owner_id or private.is_neighbrhood_admin());
create policy "Admins moderate housing listings" on public.housing_listings
  for update to authenticated using (private.is_neighbrhood_admin()) with check (private.is_neighbrhood_admin());

create policy "Students read own saved listings" on public.saved_housing_listings
  for select to authenticated using ((select auth.uid()) = student_id);
create policy "Students save housing listings" on public.saved_housing_listings
  for insert to authenticated with check ((select auth.uid()) = student_id);
create policy "Students remove own saved listings" on public.saved_housing_listings
  for delete to authenticated using ((select auth.uid()) = student_id);

create policy "Students read own housing reports" on public.housing_reports
  for select to authenticated using ((select auth.uid()) = reporter_id or private.is_neighbrhood_admin());
create policy "Students report housing listings" on public.housing_reports
  for insert to authenticated with check ((select auth.uid()) = reporter_id and status = 'open');
create policy "Admins manage housing reports" on public.housing_reports
  for update to authenticated using (private.is_neighbrhood_admin()) with check (private.is_neighbrhood_admin());

-- Clubs and events are public only after moderation/publication.

create policy "Active clubs are public" on public.clubs
  for select to anon, authenticated using (moderation_status = 'active' or created_by = (select auth.uid()) or private.is_neighbrhood_admin());
create policy "Students propose clubs" on public.clubs
  for insert to authenticated with check (created_by = (select auth.uid()) and moderation_status = 'pending');
create policy "Club creators update pending clubs" on public.clubs
  for update to authenticated using (created_by = (select auth.uid()) and moderation_status = 'pending')
  with check (created_by = (select auth.uid()) and moderation_status = 'pending');
create policy "Admins manage clubs" on public.clubs
  for all to authenticated using (private.is_neighbrhood_admin()) with check (private.is_neighbrhood_admin());

create policy "Published club events are public" on public.club_events
  for select to anon, authenticated using (is_published or private.is_neighbrhood_admin());
create policy "Admins manage club events" on public.club_events
  for all to authenticated using (private.is_neighbrhood_admin()) with check (private.is_neighbrhood_admin());

create policy "Students read own club follows" on public.club_follows
  for select to authenticated using ((select auth.uid()) = student_id);
create policy "Students follow clubs" on public.club_follows
  for insert to authenticated with check ((select auth.uid()) = student_id);
create policy "Students unfollow clubs" on public.club_follows
  for delete to authenticated using ((select auth.uid()) = student_id);

-- Explicit Data API grants. RLS still decides which rows each request can access.

grant select on table public.western_courses, public.professors, public.course_professors,
  public.course_reviews, public.course_discussions, public.course_discussion_comments,
  public.course_discussion_votes, public.housing_listings, public.clubs, public.club_events
  to anon;

grant select, insert, update, delete on table public.western_courses, public.professors,
  public.course_professors, public.student_course_statuses, public.course_reviews,
  public.course_discussions, public.course_discussion_comments, public.course_discussion_votes,
  public.housing_listings, public.saved_housing_listings, public.housing_reports,
  public.clubs, public.club_events, public.club_follows
  to authenticated;

-- Starter records keep the first course browse experience useful after migration.
-- They are unpublished until an admin verifies the facts against Western's official calendar.

insert into public.western_courses (code, title, faculty, level, description, terms, tags, is_published)
values
  ('COMPSCI 1026A', 'Computer Science Fundamentals I', 'Science', '1000 level', 'An introduction to programming and problem solving.', 'Fall · Winter', array['Programming', 'First year'], false),
  ('MOS 1021A', 'Introduction to Consumer Behaviour', 'Social Science', '1000 level', 'An introduction to consumer behaviour and marketing decisions.', 'Fall · Winter', array['Marketing', 'MOS'], false),
  ('PSYCH 1002B', 'Introduction to Psychology', 'Social Science', '1000 level', 'A broad introduction to topics in psychology.', 'Winter', array['Psychology', 'First year'], false),
  ('CALCULUS 1000A', 'Calculus I', 'Science', '1000 level', 'An introduction to limits, derivatives, and applications.', 'Fall · Winter', array['Calculus', 'STEM'], false)
on conflict (code) do nothing;
