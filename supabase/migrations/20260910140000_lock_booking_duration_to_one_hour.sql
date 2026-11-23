-- Pin bookings.duration_minutes to 60, because the price does not depend on it.
--
-- public.bookings.duration_minutes allowed 15..240 and defaulted to 60. Parts of the app
-- honour it — lib/classroom/policy.ts's classroomJoinState computes the join window from it,
-- ensureClassroom copies it onto tutoring_classrooms, and the sessions list renders
-- `${durationMinutes} min` — but two places assume one hour outright:
--
--   * app/api/payments/checkout/route.ts charges tutor_profiles.hourly_rate_cents flat, and
--     labels the Stripe line item "1-hour session".
--   * lib/notifications/ics.ts sets SESSION_MINUTES = 60, so the calendar invite is always
--     a one-hour block.
--
-- A 120-minute booking with a $40/hr tutor would therefore have been charged $40 for two
-- hours of tutoring and put a one-hour event in both calendars. Nothing could produce one
-- today — the booking form has no duration field and the insert in app/page.tsx never sets
-- the column, so every row takes the default; all 26 existing bookings are 60 — but that is
-- a property of the current UI, not of the schema, and an admin edit or a later feature
-- would have started undercharging silently.
--
-- Two ways to close that: make the price duration-aware, or make the schema say what the
-- pricing code already assumes. Taking the second deliberately: variable-length sessions are
-- not a product yet, and a constraint is far harder to get wrong than a pricing formula that
-- nothing currently exercises.
--
-- TO LIFT THIS: relax the constraint AND make the price proportional in checkout/route.ts
-- AND thread duration through buildBookingIcs into lib/notifications/ics.ts. All three, or
-- the undercharge comes back. The comments in those two files point back here.
--
-- Verified before applying: select duration_minutes, count(*) from bookings group by 1
--   -> 60: 26 rows. Nothing in app/, lib/ or tests/ writes this column at all.

alter table public.bookings drop constraint if exists bookings_duration_minutes_check;

alter table public.bookings
  add constraint bookings_duration_minutes_check
  check (duration_minutes = 60);
