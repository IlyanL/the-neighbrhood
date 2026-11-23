-- Western Tutors owner admin cleanup
-- Run this after database/007_cleanup_admin_and_booking_edits.sql if the owner account still appears as a student.

update public.profiles profile
set
  role = 'admin',
  email = lower(auth_user.email)
from auth.users auth_user
where profile.id = auth_user.id
and lower(auth_user.email) = 'owner@example.com';

delete from public.student_profiles student_profile
using auth.users auth_user
where student_profile.id = auth_user.id
and lower(auth_user.email) = 'owner@example.com';
