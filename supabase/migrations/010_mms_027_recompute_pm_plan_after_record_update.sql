-- MMS-027: recompute PM schedules from the complete record history.

begin;

create or replace function public.recompute_pm_plan_schedule(target_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  latest_done_date date;
begin
  select max(record.done_date)
    into latest_done_date
    from public.pm_records as record
   where record.pm_plan_id = target_plan_id;

  -- MMS-026's BEFORE UPDATE trigger derives next_due_date from this value,
  -- or falls back to start_date when the plan has no PM history.
  update public.pm_plans
     set last_done_date = latest_done_date
   where id = target_plan_id;
end;
$$;

create or replace function public.fn_update_pm_plan_after_record()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.recompute_pm_plan_schedule(new.pm_plan_id);
  return new;
end;
$$;

create or replace function public.fn_recompute_pm_plan_after_record_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.recompute_pm_plan_schedule(new.pm_plan_id);

  if old.pm_plan_id is distinct from new.pm_plan_id then
    perform public.recompute_pm_plan_schedule(old.pm_plan_id);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_pm_records_after_update on public.pm_records;
create trigger trg_pm_records_after_update
  after update on public.pm_records
  for each row
  execute function public.fn_recompute_pm_plan_after_record_update();

revoke all on function public.recompute_pm_plan_schedule(uuid)
  from public, anon, authenticated;
revoke all on function public.fn_update_pm_plan_after_record()
  from public, anon, authenticated;
revoke all on function public.fn_recompute_pm_plan_after_record_update()
  from public, anon, authenticated;

commit;
