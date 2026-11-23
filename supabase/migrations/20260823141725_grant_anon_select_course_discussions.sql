-- Reconstructed migration: applied live on 2026-08-23 but the original file was never
-- committed (migration drift). This recreates the current live behavior from the live
-- schema, not a byte-for-byte replay of the original SQL.
--
-- An RLS policy allowing anon to select is not enough on its own -- table access to
-- anon was previously revoked wholesale in phase_two_trust_and_community, so anon also
-- needs an explicit GRANT SELECT alongside the widened policy from the prior migration.
grant select on table
  public.course_discussions,
  public.course_discussion_comments,
  public.course_discussion_votes
to anon;
