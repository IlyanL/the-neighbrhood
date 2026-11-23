-- Reconstructed migration: applied live on 2026-08-12 but the original file was never
-- committed (migration drift). This recreates the current live behavior from the live
-- schema, not a byte-for-byte replay of the original SQL.
--
-- Gate course discovery content behind is_published so draft/unverified Western course
-- and professor records aren't visible until an admin publishes them.
drop policy if exists "Western courses are public" on public.western_courses;
drop policy if exists "Published Western courses are public" on public.western_courses;
create policy "Published Western courses are public"
  on public.western_courses for select
  to anon, authenticated
  using (is_published or private.is_neighbrhood_admin());

drop policy if exists "Admins manage Western courses" on public.western_courses;
create policy "Admins manage Western courses"
  on public.western_courses for all
  to authenticated
  using (private.is_neighbrhood_admin())
  with check (private.is_neighbrhood_admin());

drop policy if exists "Professors are public" on public.professors;
drop policy if exists "Published professors are public" on public.professors;
create policy "Published professors are public"
  on public.professors for select
  to anon, authenticated
  using (is_published or private.is_neighbrhood_admin());

drop policy if exists "Admins manage professors" on public.professors;
create policy "Admins manage professors"
  on public.professors for all
  to authenticated
  using (private.is_neighbrhood_admin())
  with check (private.is_neighbrhood_admin());
