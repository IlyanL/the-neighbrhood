-- Postgres re-evaluates a volatile function call inside an RLS policy once per row. So
-- `auth.uid() = student_id` calls auth.uid() for every row scanned, while
-- `(select auth.uid()) = student_id` is a scalar subquery Postgres hoists into an InitPlan
-- and evaluates exactly once per query. Identical meaning, very different cost — and the
-- gap widens as tables grow, which is precisely the "will it fall over with more users"
-- concern. Supabase's own linter flags this as auth_rls_initplan.
--
-- Most policies already did this; 35 did not. Rewritten in place with ALTER POLICY rather
-- than DROP/CREATE so no policy is ever momentarily absent.
--
-- A first attempt at the detection used a case-sensitive pattern and reported 95 policies,
-- because Postgres renders an existing wrap as "( SELECT auth.uid() AS uid)" in upper case.
-- Rewriting those would have produced "( SELECT (select auth.uid()) AS uid)". The dry run
-- caught it; the corrected case-insensitive count was 35, matching the linter exactly.
do $$
declare
  r record;
  new_qual text;
  new_check text;
  fixed int := 0;
begin
  for r in
    select c.relname as tbl, p.polname as pol,
           pg_get_expr(p.polqual, p.polrelid) as q,
           pg_get_expr(p.polwithcheck, p.polrelid) as w
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and (pg_get_expr(p.polqual, p.polrelid) ~* '(?<!select\s)auth\.(uid|jwt|role)\(\)'
        or pg_get_expr(p.polwithcheck, p.polrelid) ~* '(?<!select\s)auth\.(uid|jwt|role)\(\)')
  loop
    new_qual  := regexp_replace(r.q, '(?<!select\s)(auth\.(uid|jwt|role)\(\))', '(select \1)', 'gi');
    new_check := regexp_replace(r.w, '(?<!select\s)(auth\.(uid|jwt|role)\(\))', '(select \1)', 'gi');

    if r.q is not null and r.w is not null then
      execute format('alter policy %I on public.%I using (%s) with check (%s)', r.pol, r.tbl, new_qual, new_check);
    elsif r.q is not null then
      execute format('alter policy %I on public.%I using (%s)', r.pol, r.tbl, new_qual);
    else
      -- INSERT policies have only WITH CHECK.
      execute format('alter policy %I on public.%I with check (%s)', r.pol, r.tbl, new_check);
    end if;
    fixed := fixed + 1;
  end loop;

  raise notice 'rewrote % policies', fixed;
end $$;

-- Applied 2026-08-30 and verified against the live database:
--   policies still unwrapped    : 0
--   accidentally double-wrapped : 0
--   a student still sees exactly their own 15 of 22 bookings (scoped, not opened up)
