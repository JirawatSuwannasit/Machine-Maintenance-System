# MMS-027 Stage B — Production runbook

## Verified bootstrap state

- Product owner confirmed one `admin` account with `section = NULL`.
- A `user` account is assigned to `REL`.
- Production machine locations are `REL` (17) and `CAL` (1); no unexpected,
  blank, or `NULL` values were reported.
- Role and section assignment remains Supabase Dashboard Table Editor only.

## Policy inventory before Stage B

Migration history contains one broad `authenticated_full_access` policy on
each of `machines`, `breakdowns`, `pm_plans`, `pm_records`, `spare_parts`,
`machine_parts`, and `part_replacements`. Each is `FOR ALL`, `USING (true)`,
`WITH CHECK (true)`. Confirm the live catalog immediately before applying:

```sql
SELECT schemaname, tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'user_access', 'machines', 'breakdowns', 'pm_plans', 'pm_records',
    'spare_parts', 'machine_parts', 'part_replacements'
  )
ORDER BY tablename, policyname;
```

Apply `supabase/migrations/007_mms_027_business_rls_cutover.sql` only after
saving that inventory. The migration changes policies/functions, not rows.

## Catalog verification after Stage B

```sql
-- No historical broad policy may remain.
SELECT tablename, policyname
FROM pg_policies
WHERE schemaname = 'public'
  AND policyname = 'authenticated_full_access';

-- Enumerate the final policies.
SELECT tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'user_access', 'machines', 'breakdowns', 'pm_plans', 'pm_records',
    'spare_parts', 'machine_parts', 'part_replacements'
  )
ORDER BY tablename, cmd, policyname;

-- Trigger functions must remain SECURITY DEFINER with an empty search_path.
SELECT n.nspname, p.proname, p.prosecdef, p.proconfig
FROM pg_proc AS p
JOIN pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'fn_update_pm_plan_after_record',
    'fn_after_part_replacement',
    'fn_after_part_replacement_delete'
  )
ORDER BY p.proname;
```

## Manual acceptance tests

Use test accounts and disposable test work orders through the Vercel Preview;
do not alter real production maintenance history merely to test authorization.

1. **Pending account:** create an Auth user but leave role/section `NULL`. Login
   and confirm only the Thai pending message, change-password, and logout appear.
   Direct SELECT from every maintenance table must return no rows.
2. **REL read:** login as the REL user and confirm REL and CAL machines/history/
   reports are visible.
3. **REL work:** on a designated REL test machine, create/edit/cancel an open
   breakdown; receive, close, reopen, edit, and re-close work; perform PM; and
   record a part replacement.
4. **Cross-section denial:** copy the CAL machine/work IDs and attempt the same
   mutations through direct Supabase requests. INSERT/UPDATE/DELETE must fail at
   RLS even if the UI is bypassed.
5. **Master denial:** as the REL user, attempt INSERT/UPDATE/DELETE on `machines`,
   `pm_plans`, `spare_parts`, and `machine_parts`. Every write must fail.
6. **Self-escalation:** as both REL user and application admin, attempt INSERT,
   UPDATE, and DELETE on `user_access`. Every write must fail.
7. **Admin:** confirm all existing workflows work on both REL and CAL and no
   `/admin/users` page/menu exists.
8. **PM trigger:** insert a PM record for the REL test machine and verify the
   related plan's `last_done_date` and `next_due_date` advance while a direct
   user UPDATE of `pm_plans` still fails.
9. **Part triggers:** insert a replacement and verify stock decreases and link
   dates advance. Exercise the existing delete-old-then-insert-new edit order;
   verify stock restoration/re-deduction and final dates. A direct user UPDATE
   of `spare_parts` or `machine_parts` must still fail.
10. **Mobile:** use Vercel Preview at 375px for pending, user, admin, breakdown,
    PM, and replacement screens and confirm there is no horizontal page scroll.

Record row IDs, expected outcomes, actual outcomes, and any PostgreSQL error
codes in the deployment record. Roll back/remove only disposable test data using
an application admin after trigger results have been verified.
