-- MMS-027 Stage B: role and machine-section authorization cutover.
-- Bootstrap was confirmed with at least one admin and only REL/CAL locations.
-- This migration changes authorization only and does not modify business data.

begin;

-- Remove the historical permissive policies. Leaving any one of these in
-- place would OR with the policies below and bypass the new restrictions.
drop policy if exists authenticated_full_access on public.machines;
drop policy if exists authenticated_full_access on public.breakdowns;
drop policy if exists authenticated_full_access on public.pm_plans;
drop policy if exists authenticated_full_access on public.pm_records;
drop policy if exists authenticated_full_access on public.spare_parts;
drop policy if exists authenticated_full_access on public.machine_parts;
drop policy if exists authenticated_full_access on public.part_replacements;

-- Every valid admin/user can read every section. Pending or missing access
-- rows fail has_app_access() and therefore cannot read maintenance data.
create policy machines_read_valid_access on public.machines
  for select to authenticated using (public.has_app_access());
create policy breakdowns_read_valid_access on public.breakdowns
  for select to authenticated using (public.has_app_access());
create policy pm_plans_read_valid_access on public.pm_plans
  for select to authenticated using (public.has_app_access());
create policy pm_records_read_valid_access on public.pm_records
  for select to authenticated using (public.has_app_access());
create policy spare_parts_read_valid_access on public.spare_parts
  for select to authenticated using (public.has_app_access());
create policy machine_parts_read_valid_access on public.machine_parts
  for select to authenticated using (public.has_app_access());
create policy part_replacements_read_valid_access on public.part_replacements
  for select to authenticated using (public.has_app_access());

-- Admin-only master/configuration writes.
create policy machines_admin_insert on public.machines
  for insert to authenticated with check (public.is_app_admin());
create policy machines_admin_update on public.machines
  for update to authenticated
  using (public.is_app_admin()) with check (public.is_app_admin());
create policy machines_admin_delete on public.machines
  for delete to authenticated using (public.is_app_admin());

create policy pm_plans_admin_insert on public.pm_plans
  for insert to authenticated with check (public.is_app_admin());
create policy pm_plans_admin_update on public.pm_plans
  for update to authenticated
  using (public.is_app_admin()) with check (public.is_app_admin());
create policy pm_plans_admin_delete on public.pm_plans
  for delete to authenticated using (public.is_app_admin());

create policy spare_parts_admin_insert on public.spare_parts
  for insert to authenticated with check (public.is_app_admin());
create policy spare_parts_admin_update on public.spare_parts
  for update to authenticated
  using (public.is_app_admin()) with check (public.is_app_admin());
create policy spare_parts_admin_delete on public.spare_parts
  for delete to authenticated using (public.is_app_admin());

create policy machine_parts_admin_insert on public.machine_parts
  for insert to authenticated with check (public.is_app_admin());
create policy machine_parts_admin_update on public.machine_parts
  for update to authenticated
  using (public.is_app_admin()) with check (public.is_app_admin());
create policy machine_parts_admin_delete on public.machine_parts
  for delete to authenticated using (public.is_app_admin());

-- Breakdown transactions: admins work everywhere; users only on a machine in
-- their assigned section. UPDATE checks both old and new machine references.
create policy breakdowns_work_insert on public.breakdowns
  for insert to authenticated
  with check (public.can_work_on_machine(machine_id));
create policy breakdowns_work_update on public.breakdowns
  for update to authenticated
  using (public.can_work_on_machine(machine_id))
  with check (public.can_work_on_machine(machine_id));
create policy breakdowns_admin_delete on public.breakdowns
  for delete to authenticated using (public.is_app_admin());
create policy breakdowns_user_delete_open on public.breakdowns
  for delete to authenticated
  using (
    public.current_app_role() = 'user'
    and status = 'open'
    and public.can_work_on_machine(machine_id)
  );

-- PM execution is insert-only in the current application. The correlated
-- plan check prevents forged machine_id/pm_plan_id combinations.
create policy pm_records_work_insert on public.pm_records
  for insert to authenticated
  with check (
    public.can_work_on_machine(machine_id)
    and exists (
      select 1
      from public.pm_plans as plan
      where plan.id = pm_plan_id
        and plan.machine_id = machine_id
    )
  );
create policy pm_records_admin_update on public.pm_records
  for update to authenticated
  using (public.is_app_admin()) with check (public.is_app_admin());
create policy pm_records_admin_delete on public.pm_records
  for delete to authenticated using (public.is_app_admin());

-- Part replacement edit is the existing DELETE-old then INSERT-new workflow.
-- A supplied breakdown must belong to the same machine.
create policy part_replacements_work_insert on public.part_replacements
  for insert to authenticated
  with check (
    public.can_work_on_machine(machine_id)
    and (
      breakdown_id is null
      or exists (
        select 1
        from public.breakdowns as breakdown
        where breakdown.id = breakdown_id
          and breakdown.machine_id = machine_id
      )
    )
  );
create policy part_replacements_work_delete on public.part_replacements
  for delete to authenticated using (public.can_work_on_machine(machine_id));
create policy part_replacements_admin_update on public.part_replacements
  for update to authenticated
  using (public.is_app_admin()) with check (public.is_app_admin());

-- Trigger functions must update read-only master tables without granting users
-- direct UPDATE. Harden the existing narrow functions with an empty search
-- path and fully qualified relations while preserving their calculations.
create or replace function public.fn_update_pm_plan_after_record()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.pm_plans
     set last_done_date = new.done_date,
         next_due_date = (
           new.done_date + (frequency_days || ' days')::interval
         )::date
   where id = new.pm_plan_id;
  return new;
end;
$$;

create or replace function public.fn_after_part_replacement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.machine_parts as machine_part
     set last_replaced_at = new.replaced_at,
         next_due_date = (
           new.replaced_at
           + (coalesce(machine_part.lifespan_override_days, part.default_lifespan_days) || ' days')::interval
         )::date
    from public.spare_parts as part
   where part.id = new.part_id
     and machine_part.machine_id = new.machine_id
     and machine_part.part_id = new.part_id;

  update public.spare_parts
     set stock_qty = stock_qty - new.qty_used
   where id = new.part_id;
  return new;
end;
$$;

create or replace function public.fn_after_part_replacement_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_date date;
begin
  update public.spare_parts
     set stock_qty = stock_qty + old.qty_used
   where id = old.part_id;

  select max(replaced_at)
    into previous_date
    from public.part_replacements
   where machine_id = old.machine_id
     and part_id = old.part_id;

  if previous_date is not null then
    update public.machine_parts as machine_part
       set last_replaced_at = previous_date,
           next_due_date = (
             previous_date
             + (coalesce(machine_part.lifespan_override_days, part.default_lifespan_days) || ' days')::interval
           )::date
      from public.spare_parts as part
     where part.id = machine_part.part_id
       and machine_part.machine_id = old.machine_id
       and machine_part.part_id = old.part_id;
  else
    update public.machine_parts
       set last_replaced_at = null,
           next_due_date = null
     where machine_id = old.machine_id
       and part_id = old.part_id;
  end if;
  return old;
end;
$$;

revoke all on function public.fn_update_pm_plan_after_record() from public, anon, authenticated;
revoke all on function public.fn_after_part_replacement() from public, anon, authenticated;
revoke all on function public.fn_after_part_replacement_delete() from public, anon, authenticated;

commit;
