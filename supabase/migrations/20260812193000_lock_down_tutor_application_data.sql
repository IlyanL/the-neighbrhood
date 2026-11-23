-- Keep public tutor discovery useful without exposing moderation or document data.
-- Applicants may edit their application, but only admins may change review outcomes.

create or replace function private.protect_tutor_moderation_fields()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  is_service_role boolean := coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role';
  is_admin boolean := private.is_neighbrhood_admin();
begin
  if is_service_role or is_admin then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.application_status := 'pending';
    new.is_verified := false;
    new.interview_start := null;
    new.interview_mode := null;
    new.interview_link := null;
    new.admin_notes := null;
    new.decline_reason := null;
    new.transcript_reviewed := false;
    new.resume_reviewed := false;
    new.interview_completed := false;
    new.references_checked := false;
    new.approved_at := null;
  elsif
    new.application_status is distinct from old.application_status
    or new.is_verified is distinct from old.is_verified
    or new.interview_start is distinct from old.interview_start
    or new.interview_mode is distinct from old.interview_mode
    or new.interview_link is distinct from old.interview_link
    or new.admin_notes is distinct from old.admin_notes
    or new.decline_reason is distinct from old.decline_reason
    or new.transcript_reviewed is distinct from old.transcript_reviewed
    or new.resume_reviewed is distinct from old.resume_reviewed
    or new.interview_completed is distinct from old.interview_completed
    or new.references_checked is distinct from old.references_checked
    or new.approved_at is distinct from old.approved_at
  then
    raise exception 'Tutor moderation fields may only be changed by an administrator'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function private.protect_tutor_moderation_fields() from public;

drop trigger if exists protect_tutor_moderation_fields on public.tutor_profiles;
create trigger protect_tutor_moderation_fields
before insert or update on public.tutor_profiles
for each row execute function private.protect_tutor_moderation_fields();

-- PostgreSQL grants are column-aware. Public clients can only request fields that
-- belong on an accepted tutor card; private review fields are served by an
-- authenticated, role-aware route.
revoke select on public.tutor_profiles from anon, authenticated;
grant select (
  id,
  display_name,
  photo_url,
  year,
  gpa_range,
  hourly_rate_cents,
  bio,
  delivery_modes,
  is_verified,
  response_minutes,
  rating,
  review_count,
  session_count,
  created_at,
  updated_at,
  university,
  major,
  gpa_percent,
  headline,
  teaching_style,
  languages,
  campus_locations,
  application_status
) on public.tutor_profiles to anon, authenticated;

drop policy if exists "Tutor courses are public" on public.tutor_courses;
create policy "Accepted tutor courses are public"
on public.tutor_courses for select
to anon, authenticated
using (
  exists (
    select 1 from public.tutor_profiles
    where tutor_profiles.id = tutor_courses.tutor_id
      and tutor_profiles.application_status = 'accepted'
      and tutor_profiles.is_verified = true
  )
);

drop policy if exists "Tutor availability is public" on public.tutor_availability;
create policy "Accepted tutor availability is public"
on public.tutor_availability for select
to anon, authenticated
using (
  exists (
    select 1 from public.tutor_profiles
    where tutor_profiles.id = tutor_availability.tutor_id
      and tutor_profiles.application_status = 'accepted'
      and tutor_profiles.is_verified = true
  )
);
