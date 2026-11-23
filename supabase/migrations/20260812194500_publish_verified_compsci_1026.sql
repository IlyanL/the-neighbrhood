-- Publish only the seed course whose current Western Calendar record was verified.
-- The other draft records stay hidden until an authoritative course page is attached.
update public.western_courses
set
  title = 'Computer Science Fundamentals I',
  department = 'Computer Science',
  description = 'The nature of Computer Science as a discipline; the design and analysis of algorithms and their implementation as modular, reliable, well-documented programs written in a modern programming language. Intended for students with little or no background in programming.',
  terms = 'A/B',
  credits = 0.50,
  official_url = 'https://www.westerncalendar.uwo.ca/Courses.cfm?ArchiveID=&CourseAcadCalendarID=MAIN_006440_1&SelectedCalendar=Live',
  tags = array['programming', 'algorithms', 'computer science'],
  is_published = true,
  updated_at = now()
where code = 'COMPSCI 1026A';
