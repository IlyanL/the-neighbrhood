-- Google Calendar OAuth is removed in favour of the universal .ics invite
-- (see lib/notifications/server.ts sendCalendarInvites). Both tables were empty at removal time.
drop table if exists public.google_calendar_connections;
drop table if exists public.google_oauth_states;

alter table public.bookings
  drop column if exists google_calendar_event_id,
  drop column if exists google_calendar_html_link,
  drop column if exists google_calendar_status,
  drop column if exists meet_link;
