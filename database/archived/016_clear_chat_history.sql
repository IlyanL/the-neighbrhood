-- Western Tutors chat cleanup
-- Optional one-time reset after switching to one regular chat per student-tutor pair.

delete from public.notifications
where kind = 'chat_message'
or thread_id is not null
or path = '/?view=Chat';

delete from public.chat_messages;
delete from public.chat_threads;
