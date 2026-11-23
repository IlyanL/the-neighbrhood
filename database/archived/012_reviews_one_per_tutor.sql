-- Western Tutors review protection
-- Run this after database/011_fix_profiles_policy_recursion.sql.
-- It limits each student to one review per tutor.

with ranked_reviews as (
  select
    id,
    row_number() over (
      partition by student_id, tutor_id
      order by created_at desc, id desc
    ) as review_rank
  from public.reviews
)
delete from public.reviews
where id in (
  select id
  from ranked_reviews
  where review_rank > 1
);

create unique index if not exists reviews_one_per_student_tutor
  on public.reviews (student_id, tutor_id);
