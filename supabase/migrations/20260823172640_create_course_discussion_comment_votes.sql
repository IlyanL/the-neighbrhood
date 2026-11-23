-- Reconstructed migration: applied live on 2026-08-23 but the original file was never
-- committed (migration drift). This recreates the current live behavior from the live
-- schema, not a byte-for-byte replay of the original SQL.
--
-- Give every discussion reply (not just the original post) its own "helpful" vote,
-- mirroring course_discussion_votes exactly.
create table if not exists public.course_discussion_comment_votes (
  comment_id uuid not null references public.course_discussion_comments(id) on delete cascade,
  voter_id uuid not null references public.profiles(id) on delete cascade,
  vote smallint not null check (vote = any (array[-1, 1])),
  created_at timestamptz not null default now(),
  primary key (comment_id, voter_id)
);

alter table public.course_discussion_comment_votes enable row level security;

drop policy if exists "Authenticated users read comment votes" on public.course_discussion_comment_votes;
create policy "Authenticated users read comment votes"
  on public.course_discussion_comment_votes for select
  to anon, authenticated
  using (true);

drop policy if exists "Students add own comment votes" on public.course_discussion_comment_votes;
create policy "Students add own comment votes"
  on public.course_discussion_comment_votes for insert
  to authenticated
  with check ((select auth.uid()) = voter_id);

drop policy if exists "Students update own comment votes" on public.course_discussion_comment_votes;
create policy "Students update own comment votes"
  on public.course_discussion_comment_votes for update
  to authenticated
  using ((select auth.uid()) = voter_id);

drop policy if exists "Students remove own comment votes" on public.course_discussion_comment_votes;
create policy "Students remove own comment votes"
  on public.course_discussion_comment_votes for delete
  to authenticated
  using ((select auth.uid()) = voter_id);

grant select on table public.course_discussion_comment_votes to anon;
