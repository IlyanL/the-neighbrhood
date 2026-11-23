-- P1.14: cover the 16 foreign keys the Supabase performance advisor flagged
-- as unindexed (2026-09-16). Without an index, "find the rows pointing at
-- this id" reads the whole table instead of jumping straight to matches.
-- booking_payments is the money-path table; the rest are lower-traffic.

CREATE INDEX IF NOT EXISTS booking_payments_booking_id_idx ON public.booking_payments (booking_id);
CREATE INDEX IF NOT EXISTS booking_payments_student_id_idx ON public.booking_payments (student_id);
CREATE INDEX IF NOT EXISTS booking_payments_tutor_id_idx ON public.booking_payments (tutor_id);
CREATE INDEX IF NOT EXISTS club_event_collaborators_club_id_idx ON public.club_event_collaborators (club_id);
CREATE INDEX IF NOT EXISTS club_events_submitted_by_idx ON public.club_events (submitted_by);
CREATE INDEX IF NOT EXISTS club_follows_club_id_idx ON public.club_follows (club_id);
CREATE INDEX IF NOT EXISTS club_managers_user_id_idx ON public.club_managers (user_id);
CREATE INDEX IF NOT EXISTS clubs_created_by_idx ON public.clubs (created_by);
CREATE INDEX IF NOT EXISTS course_discussion_comment_votes_voter_id_idx ON public.course_discussion_comment_votes (voter_id);
CREATE INDEX IF NOT EXISTS course_discussion_comments_parent_comment_id_idx ON public.course_discussion_comments (parent_comment_id);
CREATE INDEX IF NOT EXISTS course_discussion_reports_comment_id_idx ON public.course_discussion_reports (comment_id);
CREATE INDEX IF NOT EXISTS course_discussion_votes_voter_id_idx ON public.course_discussion_votes (voter_id);
CREATE INDEX IF NOT EXISTS housing_reports_reporter_id_idx ON public.housing_reports (reporter_id);
CREATE INDEX IF NOT EXISTS saved_housing_listings_listing_id_idx ON public.saved_housing_listings (listing_id);
CREATE INDEX IF NOT EXISTS student_course_statuses_course_id_idx ON public.student_course_statuses (course_id);
CREATE INDEX IF NOT EXISTS tutor_favorites_tutor_id_idx ON public.tutor_favorites (tutor_id);
