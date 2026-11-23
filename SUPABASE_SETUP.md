# Connect The Neighbrhood to Supabase

## 1. Get your Supabase keys

In Supabase:

1. Open your project.
2. Go to **Project Settings**.
3. Go to **API**.
4. Copy your **Project URL**.
5. Copy your **anon public** key.

Do not use the `service_role` key in the browser app.

## 2. Add keys to the Next.js app

Open this file:

`.env.local`

Add:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-public-anon-key
```

Replace the example values with your real Supabase values.

Later, when you are ready for real email notifications, also add these server-only values to `.env.local`:

```bash
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
RESEND_API_KEY=your-resend-api-key
NOTIFICATION_FROM_EMAIL="The Neighbrhood <notifications@yourdomain.com>"
NEXT_PUBLIC_SITE_URL=https://your-deployed-domain.example
```

Do not use the service role key in browser code. The app only uses it on the server — the
notification route, and the signup routes that mint verification links.

`NEXT_PUBLIC_SITE_URL` is the origin the signup verification email's link is built against.
It is deliberately not taken from the incoming request's `Host` header, which an attacker can
set: that link carries a working single-use token, so pointing it at a host we have not
verified would hand out account access. On Vercel the platform's own `VERCEL_URL` /
`VERCEL_PROJECT_PRODUCTION_URL` stands in when this is unset, and in local development a
`localhost` request origin is trusted. Anywhere else, **signup refuses to send** until this is
set — that refusal is the intended behaviour, not a misconfiguration to work around.

## 3. Create the database tables

In Supabase:

1. Go to **SQL Editor**.
2. Click **New query**.
3. Paste everything from `database/archived/schema.sql`.
4. Click **Run**.

## 4. Add account/profile setup

In Supabase:

1. Go to **SQL Editor**.
2. Click **New query**.
3. Paste everything from `database/archived/002_auth_profiles.sql`.
4. Click **Run**.

This lets Supabase create a `profiles` row whenever someone signs up.

## 5. Add admin permissions

In Supabase:

1. Go to **SQL Editor**.
2. Click **New query**.
3. Paste everything from `database/archived/003_admin_publishing.sql`.
4. Click **Run**.

This keeps the older admin publishing permissions working while the app is being migrated.

## 6. Add tutoring marketplace tables

In Supabase:

1. Go to **SQL Editor**.
2. Click **New query**.
3. Paste everything from `database/archived/004_tutoring_marketplace.sql`.
4. Click **Run**.

This creates the new tables for tutor profiles, course codes, availability, bookings, messages, session notes, reviews, and booking payments.

## 7. Add final product flow fields

In Supabase:

1. Go to **SQL Editor**.
2. Click **New query**.
3. Paste everything from `database/archived/005_final_product_flows.sql`.
4. Click **Run**.

This adds student profiles, tutor application statuses, interview scheduling fields, admin checklist fields, booking intake fields, and notification records that can later power emails.

## 8. Add admin and private tutor document fields

In Supabase:

1. Go to **SQL Editor**.
2. Click **New query**.
3. Paste everything from `database/archived/006_admin_and_private_tutor_docs.sql`.
4. Click **Run**.

This adds profile emails for admin promotion and private resume/transcript filename fields for tutor applications.

## 9. Add cleanup and booking edit permissions

In Supabase:

1. Go to **SQL Editor**.
2. Click **New query**.
3. Paste everything from `database/archived/007_cleanup_admin_and_booking_edits.sql`.
4. Click **Run**.

This keeps `owner@example.com` as an admin, deletes the `test-account@example.com` test account from Supabase Auth, and allows students to cancel or request a different booking time.

## 10. Add tutor file storage

In Supabase:

1. Go to **SQL Editor**.
2. Click **New query**.
3. Paste everything from `database/archived/009_tutor_storage.sql`.
4. Click **Run**.

This creates the `tutor-documents` storage bucket and lets tutors upload profile photos, resumes, and transcripts. Profile photos can be shown publicly; resumes and transcripts are opened by admins through short-lived private links.

## 11. Fix tutor application visibility

In Supabase:

1. Go to **SQL Editor**.
2. Click **New query**.
3. Paste everything from `database/archived/010_tutor_application_visibility.sql`.
4. Click **Run**.

This makes sure `owner@example.com` is a real database admin, removes its student profile, and lets admins see pending tutor applications.

## 12. Fix profile policy recursion

In Supabase:

1. Go to **SQL Editor**.
2. Click **New query**.
3. Paste everything from `database/archived/011_fix_profiles_policy_recursion.sql`.
4. Click **Run**.

This fixes the Supabase error that says `infinite recursion detected in policy for relation "profiles"`.

## 13. Limit reviews to one per tutor

In Supabase:

1. Go to **SQL Editor**.
2. Click **New query**.
3. Paste everything from `database/archived/012_reviews_one_per_tutor.sql`.
4. Click **Run**.

This makes sure the same student cannot review the same tutor more than once.

## 14. Add notification bell and time-change requests

In Supabase:

1. Go to **SQL Editor**.
2. Click **New query**.
3. Paste everything from `database/archived/013_notification_bell_and_time_changes.sql`.
4. Click **Run**.

This lets notifications link to bookings and lets time changes wait for the other person to confirm.

## 15. Add chat, session files, and time-change declines

In Supabase:

1. Go to **SQL Editor**.
2. Click **New query**.
3. Paste everything from `database/archived/014_chat_and_session_files.sql`.
4. Click **Run**.

This adds student-tutor chats, session-linked chats, private session file uploads, and lets either person decline a proposed time change without cancelling the whole session.

## 16. Add chat participant names

In Supabase:

1. Go to **SQL Editor**.
2. Click **New query**.
3. Paste everything from `database/archived/015_chat_profile_names.sql`.
4. Click **Run**.

This lets tutors see the student's name in Chat, and lets students see the tutor's name.

## 17. Optional: clear old chat history

Only run this if you want a clean chat test after changing the chat system.

In Supabase:

1. Go to **SQL Editor**.
2. Click **New query**.
3. Paste everything from `database/archived/016_clear_chat_history.sql`.
4. Click **Run**.

This deletes old chat messages, old chat threads, and old chat notifications. It does not delete users, tutor profiles, bookings, reviews, or session files.

## 18. Fix tutor session chat shortcuts

In Supabase:

1. Go to **SQL Editor**.
2. Click **New query**.
3. Paste everything from `database/archived/017_pair_chat_policy_fix.sql`.
4. Click **Run**.

This lets tutors click **Message** from My Sessions and open the same regular chat they would have with that student anywhere else in the app.

## 19. Google Calendar and Google Meet foundation (removed)

`database/archived/018_google_calendar_meet.sql` originally added a tutor-side Google Calendar OAuth connection so confirmed sessions could sync to a tutor's calendar with a Meet link. As of 2026-08-27 this integration was fully removed: `supabase/migrations/20260827190000_remove_google_calendar_integration.sql` drops `google_calendar_connections`, `google_oauth_states`, and the related `bookings` columns (both tables were empty when dropped, so nothing was lost), and `app/api/google-calendar/` no longer exists in the codebase.

In its place, every confirmed/updated/cancelled session emails a universal `.ics` calendar invite to both the student and tutor via Resend, merged into the same email as the human-readable session details rather than a separate email (see `lib/notifications/server.ts`'s `buildBookingIcs` + `createNotification`) — no OAuth, no Google account, no per-tutor setup required. There is nothing left to configure for calendar sync; skip straight to Resend below.

Still remaining after this step:

- Create Resend, Stripe, LiveKit, Liveblocks, and tldraw accounts and add their keys to `.env.local` (and to Vercel for production). None of these can be created by an assistant — see the step-by-step guide at the end of this document.
- Finish live Stripe testing (a tutor confirming a session, a student paying, and a cancellation refund) after Stripe test keys are created.
- Add tutor payouts once you're ready to move real tutor money out of your own Stripe account (out of scope for the campus launch; Stripe currently collects into the platform account only).
- Add production deployment setup for Vercel once the database and payment flows are stable.

## 20. Add saved tutors and booking focus fields

In Supabase SQL Editor, run:

`database/archived/019_favorites_payments_and_booking_focus.sql`

This adds synchronized tutor favourites, placeholder payment fields, and notification links that open the correct session tab.

## 21. Add The Neighbrhood platform foundation

After migration 019, run:

`database/archived/020_neighbrhood_platform_foundation.sql`

This adds the Courses, professor reviews, course discussions, Housing, reporting, Clubs, events, and follow tables. Every exposed table has row-level security and explicit Data API grants. Starter courses remain unpublished until an admin verifies their details against Western's official calendar.

## 22. Add general profiles and tutor onboarding

After migration 020, run:

`database/archived/021_general_profiles_and_onboarding.sql`

This adds year, major, faculty, biography, and interests to the universal Neighbrhood profile. It also copies existing student/tutor information forward, separates tutor profiles from general profiles, and prevents users from promoting their own account role.

## 23. Restart the app

After changing `.env.local`, stop the local app and start it again:

```bash
npm run build
npm run start
```

## 24. Test the connection

Open:

`http://127.0.0.1:3021/supabase-test`

If everything is correct, it will say:

`Supabase is connected and the courses table is reachable.`

## 25. Test accounts

Open:

`http://localhost:3000/auth`

Create a student account first, then return to the homepage and request a tutoring session.

Create a tutor account next, verify the email, then fill in the **Tutor profile** subtab inside Tutoring. General signup information should already be filled in. The tutor application should appear in the admin page.

## 26. Make an admin account

Admins can promote another user from the **Admin** page by entering that user's email address.

You can also do it manually in Supabase by opening the `profiles` table and changing that user's `role` from `student` or `tutor` to `admin`.

## 27. Migrations status

Steps 1–22 above walk through `database/archived/002`–`021` — the project's original,
pre-2026-08-12 migration history. That directory is **archived, not runnable guidance**: this
repo has no `supabase/config.toml` and was never a CLI-linked local project (no `supabase
link`, no `supabase db push`), so there is no "replay these files into an empty project" path
to follow. `supabase/migrations/` (2026-08-12 onward) is the CLI-tracked, verified-applied
history from that point forward — confirmed via the Supabase MCP's `list_migrations` against
every file present. For anything earlier, or if you're setting up a fresh environment, treat
the **live project** (`<project-ref>`) as the only source of truth, checked directly via
the Supabase MCP connection (`information_schema`, `pg_policies`, etc.) rather than by
re-reading either migration directory. See `database/archived/README.md` and
`docs/production-readiness.md` ("Phase 5, part 1") for the full reconciliation.

## 28. Set up tutoring session payments (Stripe)

This step is required before "Pay for session" will work. It has both a "you do this" part and an "already done in code" part — see the beginner-friendly Stripe walkthrough this was delivered alongside for exact click-by-click instructions. In short:

1. Create a Stripe account and switch to **Test mode**.
2. Copy your test **Secret key** into `.env.local` as `STRIPE_SECRET_KEY`.
3. Add a webhook endpoint pointed at `/api/payments/webhook` listening for `checkout.session.completed` and `checkout.session.expired`, then copy its **Signing secret** into `.env.local` as `STRIPE_WEBHOOK_SECRET`.
4. Restart the app after editing `.env.local`.

Money flow in this app: a student requests a session for free, the tutor confirms it, then the student pays through a Stripe-hosted checkout page. Cancelling a paid, confirmed session automatically refunds the student — in full, unless the *student* is the one cancelling inside the 12-hour window before the session, in which case a cancellation fee is withheld (see `lib/payments/cancellation-policy.ts`; a tutor-initiated cancellation is always a full refund regardless of timing). The platform currently takes a 0% fee — the tutor's full hourly rate (minus any withheld cancellation fee) is charged. There is no tutor payout system yet; charged amounts sit in your Stripe account until you build that out.

## 29. One remaining dashboard setting (Pro plan only)

The Supabase security advisor flags one item that has no SQL fix: **leaked password protection**, which rejects sign-ups/password changes using a password already known to be compromised (checked against haveibeenpwned.org). This project's Supabase organization ("CourseForge") is currently on the **Free plan**, and this feature is gated to **Pro plan and above** — so it won't appear (or will show locked) until you upgrade. It is not "Authentication → Policies" (that page manages database row-level-security policies, a different thing); the real location, once available, is **Authentication → Sign In / Providers → Email**. This is a $25/month decision, not a quick toggle — worth deciding deliberately rather than as a launch-blocking checklist item.

One other advisor notice is informational only and doesn't need action: `public.payments` has RLS enabled with no policies, which is intentional — it's a leftover table from before the tutoring marketplace existed, superseded by `booking_payments`, and already has all client access revoked. (`google_oauth_states` no longer exists — it was dropped along with the rest of the Google Calendar integration; see step 19.)

Separately, on 2026-08-27 the security advisor flagged that five `SECURITY DEFINER` database functions (`approve_club_event`, `decline_club_event`, `move_booking_time`, `request_booking_time_change`, `decline_booking_time_change`) had regressed to being callable by anonymous/unauthenticated requests, even though each one's own internal logic already correctly rejected unauthorized callers. Fixed via `supabase/migrations/20260827200000_restrict_definer_functions_to_authenticated.sql`, restricting execution to signed-in users only. Worth knowing in case something similar happens again after a future migration replaces one of these functions without restating its grants — `CREATE OR REPLACE FUNCTION` doesn't reliably preserve prior grants.
