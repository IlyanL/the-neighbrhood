-- Western Tutors Supabase Storage setup
-- Run this after database/008_force_owner_admin.sql.
-- Creates one bucket for tutor profile photos, resumes, and transcripts.

insert into storage.buckets (id, name, public)
values ('tutor-documents', 'tutor-documents', true)
on conflict (id) do update
set public = true;

alter table public.tutor_profiles
  add column if not exists photo_url text,
  add column if not exists resume_path text,
  add column if not exists transcript_path text;

drop policy if exists "Tutors can upload own documents" on storage.objects;
drop policy if exists "Tutors can update own documents" on storage.objects;
drop policy if exists "Tutors can read own documents" on storage.objects;
drop policy if exists "Admins can read tutor documents" on storage.objects;
drop policy if exists "Public can read tutor photos" on storage.objects;

create policy "Tutors can upload own documents"
  on storage.objects for insert
  with check (
    bucket_id = 'tutor-documents'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Tutors can update own documents"
  on storage.objects for update
  using (
    bucket_id = 'tutor-documents'
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'tutor-documents'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Tutors can read own documents"
  on storage.objects for select
  using (
    bucket_id = 'tutor-documents'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Admins can read tutor documents"
  on storage.objects for select
  using (
    bucket_id = 'tutor-documents'
    and exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
    )
  );

create policy "Public can read tutor photos"
  on storage.objects for select
  using (
    bucket_id = 'tutor-documents'
    and (storage.foldername(name))[2] = 'photo'
  );
