-- Enable Supabase Realtime (Postgres logical replication over WebSocket) for the
-- tables the classroom UI needs to react to instantly instead of polling:
-- classroom_messages (chat) and bookings/tutoring_classrooms (status changes
-- that end the 10s "waiting to join" poll). RLS already restricts these to
-- booking participants; Realtime enforces the same policies per-connection.
alter publication supabase_realtime add table public.classroom_messages;
alter publication supabase_realtime add table public.tutoring_classrooms;
alter publication supabase_realtime add table public.bookings;
