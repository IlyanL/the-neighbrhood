-- The @uwo.ca restriction was enforced only in the browser (app/auth/page.tsx), which then
-- called supabase.auth.signUp directly with the public anon key. Anyone could POST to the
-- project's /auth/v1/signup endpoint with any address and get a working account, then read
-- and post community content, message students, and create bookings — none of which check
-- the email domain in RLS.
--
-- This mirrors isAllowedAccountEmail in lib/auth-policy.ts. The two lists must stay in
-- sync; the TypeScript copy remains for fast client-side feedback, but this one is the
-- control. BEFORE INSERT only, so existing accounts are unaffected.
create or replace function private.enforce_allowed_signup_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(new.email, '')));
begin
  -- No address at all: leave it to Supabase Auth's own validation rather than masking it.
  if v_email = '' then
    return new;
  end if;

  if split_part(v_email, '@', 2) = 'uwo.ca' then
    return new;
  end if;

  -- Mirrors APPROVED_LEGACY_EMAILS in lib/auth-policy.ts.
  if v_email in ('test-account@example.com', 'owner@example.com') then
    return new;
  end if;

  raise exception 'Sign-ups are limited to Western University (@uwo.ca) email addresses.'
    using errcode = '42501';
end;
$$;

revoke all on function private.enforce_allowed_signup_email() from public;

drop trigger if exists enforce_allowed_signup_email on auth.users;
create trigger enforce_allowed_signup_email
before insert on auth.users
for each row execute function private.enforce_allowed_signup_email();

-- Applied 2026-08-29 and verified against the live database inside a rolled-back
-- transaction, inserting directly into auth.users the way the signup endpoint does:
--   attacker@example.com  : BLOCKED (42501)
--   newstudent@uwo.ca     : accepted
--   owner@example.com : passed the policy and hit the existing-account unique
--                           constraint (23505) instead, confirming case-insensitivity
-- Account count unchanged at 6 afterwards.
--
-- NOTE: three existing accounts predate this and are not on the allow-list —
-- old-project@example.com, old-project-info@example.com, cofounder@example.com.
-- They are left in place deliberately; this trigger only governs new signups.
