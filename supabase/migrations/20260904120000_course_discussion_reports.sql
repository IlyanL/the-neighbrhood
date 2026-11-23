-- Per-message reporting for course-talk threads.
--
-- The thread screen gives the main post and every reply its own "Report this
-- message" menu. Reporting is a *record*, not a moderation action: the message
-- stays visible to everyone and only an admin flipping `is_visible` on the
-- underlying row ever hides it. Shaped after `housing_reports`, which this
-- mirrors policy for policy.
--
-- `comment_id IS NULL` means the report is against the thread's own opening
-- post; a non-null `comment_id` means it is against that reply.

create table if not exists public.course_discussion_reports (
  id uuid primary key default gen_random_uuid(),
  discussion_id uuid not null references public.course_discussions(id) on delete cascade,
  comment_id uuid references public.course_discussion_comments(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null default 'other',
  details text,
  status text not null default 'open' check (status in ('open', 'reviewing', 'resolved', 'dismissed')),
  created_at timestamptz not null default now()
);

-- One report per person per message. `nulls not distinct` is what makes this
-- hold for the opening post too, where `comment_id` is null (Postgres 15+).
create unique index if not exists course_discussion_reports_one_per_reporter
  on public.course_discussion_reports (reporter_id, discussion_id, comment_id)
  nulls not distinct;

create index if not exists course_discussion_reports_status_idx
  on public.course_discussion_reports (status, created_at desc);
create index if not exists course_discussion_reports_discussion_idx
  on public.course_discussion_reports (discussion_id);

alter table public.course_discussion_reports enable row level security;

-- Reporters file their own, always at 'open'; only an admin can move a status.
drop policy if exists "Students report course messages" on public.course_discussion_reports;
create policy "Students report course messages" on public.course_discussion_reports
  for insert to authenticated
  with check (((select auth.uid()) = reporter_id) and status = 'open');

drop policy if exists "Students read own course reports" on public.course_discussion_reports;
create policy "Students read own course reports" on public.course_discussion_reports
  for select to authenticated
  using (((select auth.uid()) = reporter_id) or private.is_neighbrhood_admin());

drop policy if exists "Admins manage course reports" on public.course_discussion_reports;
create policy "Admins manage course reports" on public.course_discussion_reports
  for update to authenticated
  using (private.is_neighbrhood_admin())
  with check (private.is_neighbrhood_admin());

-- A policy without a grant is never evaluated. Signed-out visitors get nothing.
revoke all on public.course_discussion_reports from anon;
grant select, insert, update on public.course_discussion_reports to authenticated;
grant select, insert, update, delete on public.course_discussion_reports to service_role;
