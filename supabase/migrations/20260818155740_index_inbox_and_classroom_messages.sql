create index if not exists classroom_messages_sender_idx
  on public.classroom_messages(sender_id);
create index if not exists classroom_messages_file_idx
  on public.classroom_messages(classroom_file_id)
  where classroom_file_id is not null;
create index if not exists chat_threads_recipient_updated_idx
  on public.chat_threads(tutor_id, updated_at desc);
