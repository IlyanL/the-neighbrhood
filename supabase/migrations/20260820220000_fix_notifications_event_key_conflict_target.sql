-- The event_key unique index was created as a PARTIAL index (where event_key is not null),
-- which Postgres cannot use as an ON CONFLICT (event_key) inference target unless the
-- conflicting INSERT also specifies a matching WHERE predicate. supabase-js's .upsert()
-- cannot express that, so every idempotent notification upsert has been failing with
-- "42P10: no unique or exclusion constraint matching the ON CONFLICT specification" since
-- this index was introduced. A plain (non-partial) unique constraint still allows multiple
-- NULL event_key rows (standard Postgres unique semantics treat NULLs as distinct), so the
-- direct-insert classroom-message/file notifications that never set event_key are unaffected.

drop index if exists public.notifications_event_key_unique;

alter table public.notifications
  add constraint notifications_event_key_unique unique (event_key);
