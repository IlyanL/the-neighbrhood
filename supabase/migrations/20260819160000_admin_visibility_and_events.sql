-- Admins previously had no way to read housing_reports (only an update policy existed),
-- so the new admin reports queue could not load without a service-role key configured.
create policy "Admins read housing reports" on public.housing_reports
  for select to authenticated using (private.is_neighbrhood_admin());
