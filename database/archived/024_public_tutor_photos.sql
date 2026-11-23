-- Public tutor cards may retrieve only the photo subfolder for accepted,
-- verified tutors. Resume, transcript, and application files remain private.
drop policy if exists "Accepted tutor photos can be served" on storage.objects;
create policy "Accepted tutor photos can be served"
on storage.objects for select
to anon, authenticated
using (
  bucket_id = 'tutor-documents'
  and (storage.foldername(name))[2] = 'photo'
  and exists (
    select 1
    from public.tutor_profiles tutor
    where tutor.id::text = (storage.foldername(name))[1]
      and tutor.application_status = 'accepted'
      and tutor.is_verified = true
  )
);
