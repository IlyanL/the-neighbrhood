-- Phase 2 trust and community boundary corrections.
-- This migration is intentionally data-preserving.

-- Every new account starts as a normal student. Tutor access is granted only
-- after an application is accepted by an administrator.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, role, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    'student',
    lower(new.email)
  )
  on conflict (id) do update
  set
    full_name = case
      when nullif(public.profiles.full_name, '') is null then excluded.full_name
      else public.profiles.full_name
    end,
    role = public.profiles.role,
    email = excluded.email;

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to supabase_auth_admin;

-- Course communities are part of the verified network. Keep the course
-- catalogue and deliberately published discovery content public, but require
-- an authenticated account for student posts, replies, and vote rows.
drop policy if exists "Visible course discussions are public" on public.course_discussions;
create policy "Verified users read visible course discussions"
  on public.course_discussions for select
  to authenticated
  using (is_visible or private.is_neighbrhood_admin());

drop policy if exists "Visible course comments are public" on public.course_discussion_comments;
create policy "Verified users read visible course comments"
  on public.course_discussion_comments for select
  to authenticated
  using (is_visible or private.is_neighbrhood_admin());

drop policy if exists "Discussion votes are public" on public.course_discussion_votes;
create policy "Verified users read discussion votes"
  on public.course_discussion_votes for select
  to authenticated
  using (true);

revoke all on table public.course_discussions from anon;
revoke all on table public.course_discussion_comments from anon;
revoke all on table public.course_discussion_votes from anon;

grant select, insert, update, delete on table
  public.course_discussions,
  public.course_discussion_comments,
  public.course_discussion_votes
to authenticated;

-- A public Storage bucket bypasses object RLS for downloads. The existing
-- mixed tutor bucket contains both photos and private application files, so it
-- must be private. Accepted public photos are exposed by the application only
-- after checking the tutor's accepted/verified record.
update storage.buckets
set public = false,
    file_size_limit = 10485760,
    allowed_mime_types = array[
      'image/jpeg', 'image/png', 'image/webp',
      'application/pdf', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]
where id = 'tutor-documents';

drop policy if exists "Public can read tutor photos" on storage.objects;

-- Normalize legacy public URLs to bucket-relative paths. This keeps the
-- database independent of the project hostname and lets the photo endpoint
-- validate a tutor row before issuing a short-lived signed URL.
update public.tutor_profiles
set photo_url = split_part(photo_url, '/object/public/tutor-documents/', 2)
where photo_url like '%/object/public/tutor-documents/%';

-- Storage policies use explicit roles and avoid the deprecated auth.role().
drop policy if exists "Tutors can read own documents" on storage.objects;
create policy "Tutors can read own documents"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'tutor-documents'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

drop policy if exists "Tutors can upload own documents" on storage.objects;
create policy "Tutors can upload own documents"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'tutor-documents'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

drop policy if exists "Tutors can update own documents" on storage.objects;
create policy "Tutors can update own documents"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'tutor-documents'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'tutor-documents'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

drop policy if exists "Tutors can delete own documents" on storage.objects;
create policy "Tutors can delete own documents"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'tutor-documents'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

drop policy if exists "Admins can read tutor documents" on storage.objects;
create policy "Admins can read tutor documents"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'tutor-documents' and private.is_neighbrhood_admin());

drop policy if exists "Session participants can read session files" on storage.objects;
create policy "Session participants can read session files"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'session-files'
    and exists (
      select 1 from public.bookings
      where bookings.id = ((storage.foldername(storage.objects.name))[1])::uuid
        and ((select auth.uid()) = bookings.student_id or (select auth.uid()) = bookings.tutor_id)
    )
  );

drop policy if exists "Session participants can upload session files" on storage.objects;
create policy "Session participants can upload session files"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'session-files'
    and exists (
      select 1 from public.bookings
      where bookings.id = ((storage.foldername(storage.objects.name))[1])::uuid
        and ((select auth.uid()) = bookings.student_id or (select auth.uid()) = bookings.tutor_id)
    )
  );
