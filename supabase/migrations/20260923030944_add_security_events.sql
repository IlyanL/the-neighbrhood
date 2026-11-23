-- Security-events log (P1.6): admin moderation decisions, denied admin-route access
-- attempts, and tutor-application approve/decline decisions.
--
-- Tutor approve/decline is the odd one out: it happens as a direct client update
-- against tutor_profiles under RLS (app/page.tsx's updateTutorApplication), never
-- through an API route, so app code has nothing to hook. A trigger is the only way
-- to capture it.

create table if not exists public.security_events (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null check (event_type in (
    'housing_moderation_decision',
    'housing_report_decision',
    'course_report_decision',
    'admin_access_denied',
    'tutor_application_decision'
  )),
  target_type text,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists security_events_created_idx
  on public.security_events(created_at desc);
create index if not exists security_events_actor_idx
  on public.security_events(actor_id);

alter table public.security_events enable row level security;

revoke all on table public.security_events from anon;
revoke all on table public.security_events from authenticated;

-- Only select is granted to authenticated (gated by the admin-only policy below).
-- No insert/update/delete policy exists for anon or authenticated on purpose:
-- writes come only from a server-side service-role client (the admin routes
-- already hold one) or from the SECURITY DEFINER trigger below — nobody should
-- be able to write their own audit trail.
grant select on table public.security_events to authenticated;
grant usage, select on sequence public.security_events_id_seq to authenticated;

create policy "Admins can read security events"
  on public.security_events for select to authenticated
  using (private.is_neighbrhood_admin());

create or replace function private.log_tutor_application_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.application_status is distinct from old.application_status then
    insert into public.security_events (actor_id, event_type, target_type, target_id, metadata)
    values (
      auth.uid(),
      'tutor_application_decision',
      'tutor_profile',
      new.id::text,
      jsonb_build_object('from', old.application_status, 'to', new.application_status)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists tutor_application_decision_audit on public.tutor_profiles;
create trigger tutor_application_decision_audit
  after update on public.tutor_profiles
  for each row
  execute function private.log_tutor_application_decision();
