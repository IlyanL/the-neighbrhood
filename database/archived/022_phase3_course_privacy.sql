-- Phase 3: course communities stay inside the authenticated Western network.
-- Published course catalogue data remains public; discussion content does not.

drop policy if exists "Visible course discussions are public" on public.course_discussions;
drop policy if exists "Verified users read visible course discussions" on public.course_discussions;
create policy "Authenticated users read visible course discussions" on public.course_discussions
  for select to authenticated
  using (is_visible or private.is_neighbrhood_admin());

drop policy if exists "Visible course comments are public" on public.course_discussion_comments;
drop policy if exists "Verified users read visible course comments" on public.course_discussion_comments;
create policy "Authenticated users read visible course comments" on public.course_discussion_comments
  for select to authenticated
  using (is_visible or private.is_neighbrhood_admin());

drop policy if exists "Discussion votes are public" on public.course_discussion_votes;
drop policy if exists "Verified users read discussion votes" on public.course_discussion_votes;
create policy "Authenticated users read discussion votes" on public.course_discussion_votes
  for select to authenticated
  using (true);

grant select, insert, update, delete on public.course_discussions to authenticated;
grant select, insert, update, delete on public.course_discussion_comments to authenticated;
grant select, insert, update, delete on public.course_discussion_votes to authenticated;
revoke all on public.course_discussions from anon;
revoke all on public.course_discussion_comments from anon;
revoke all on public.course_discussion_votes from anon;
