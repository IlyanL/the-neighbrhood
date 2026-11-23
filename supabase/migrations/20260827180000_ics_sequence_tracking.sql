-- Tracks how many calendar-invite revisions a booking has had, so a time change or
-- cancellation can be sent as an update to the original .ics invite (same UID, higher
-- SEQUENCE) instead of going stale. See lib/notifications/server.ts sendCalendarInvites.
alter table public.bookings add column if not exists ics_sequence integer not null default 0;
