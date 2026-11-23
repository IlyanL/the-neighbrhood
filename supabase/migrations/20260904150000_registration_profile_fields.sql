-- Registration step 3 ("Tell us who you are") needs two things public.profiles did not have.
--
-- `preferred_name` is the prototype's own field: what a tutor, a thread or a landlord should
-- call you, as distinct from the name on the transcript check.
--
-- `registered_at` is what stops a half-finished signup from leaving a permanently blank
-- profile. Sign-in reads it; null sends the account back to step 3 rather than Home, so a
-- closed tab between the verification email and the profile form is resumable. Existing
-- accounts are backfilled from created_at — nobody who joined before this step existed
-- should be bounced into it.

alter table public.profiles
  add column if not exists preferred_name text,
  add column if not exists registered_at timestamptz;

update public.profiles
set registered_at = created_at
where registered_at is null;

-- 20260830152932 revoked blanket UPDATE on profiles and re-granted it column by column, so a
-- new column is not writable by its own owner until it is named here.
grant update (preferred_name, registered_at) on table public.profiles to authenticated;

-- "Send it again" on step 2 must only ever mail an address whose signup is still unverified;
-- re-mailing a confirmed account would turn the button into an unrequested passwordless login
-- for anyone who can type someone else's address into the signup form.
--
-- auth.users is not reachable through PostgREST, hence a definer function in public with
-- EXECUTE granted to service_role alone. Supabase's default privileges hand EXECUTE on new
-- public functions to anon and authenticated, so both need an explicit revoke — the revoke
-- from PUBLIC alone would not cover them.
create or replace function public.unverified_signup_id(p_email text)
returns uuid
language sql
security definer
set search_path to ''
as $$
  select id
  from auth.users
  where lower(email) = lower(trim(p_email))
    and email_confirmed_at is null
  limit 1;
$$;

revoke all on function public.unverified_signup_id(text) from public;
revoke all on function public.unverified_signup_id(text) from anon;
revoke all on function public.unverified_signup_id(text) from authenticated;
grant execute on function public.unverified_signup_id(text) to service_role;
