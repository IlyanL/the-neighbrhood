-- Phase 6: idempotent user-facing notifications and focused read-path indexes.

alter table public.notifications add column if not exists event_key text;
create unique index if not exists notifications_event_key_unique
  on public.notifications (event_key)
  where event_key is not null;

create index if not exists bookings_student_start_idx on public.bookings (student_id, requested_start desc);
create index if not exists bookings_tutor_start_idx on public.bookings (tutor_id, requested_start desc);
create index if not exists bookings_proposed_by_idx on public.bookings (proposed_by) where proposed_by is not null;
create index if not exists notifications_user_unread_idx on public.notifications (user_id, created_at desc) where read_at is null;
create index if not exists notifications_booking_id_idx on public.notifications (booking_id) where booking_id is not null;
create index if not exists notifications_thread_id_idx on public.notifications (thread_id) where thread_id is not null;
create index if not exists chat_messages_thread_created_idx on public.chat_messages (thread_id, created_at);
create index if not exists chat_messages_sender_id_idx on public.chat_messages (sender_id);
