-- MMS-028: derive every PM schedule exclusively from actual PM history.

begin;

comment on column public.pm_plans.start_date is
  'Deprecated after MMS-028. Retained for backward compatibility. PM scheduling is derived from pm_records.done_date.';

create or replace function public.set_pm_plan_next_due_date()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.last_done_date is not null then
    new.next_due_date := new.last_done_date + new.frequency_days;
  else
    new.next_due_date := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_pm_plans_set_next_due_date on public.pm_plans;
create trigger trg_pm_plans_set_next_due_date
  before insert or update of frequency_days, last_done_date
  on public.pm_plans
  for each row
  execute function public.set_pm_plan_next_due_date();

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

  update public.pm_plans as plan
     set last_done_date = latest_done_date,
         next_due_date = case
           when latest_done_date is not null
             then latest_done_date + plan.frequency_days
           else null
         end
   where plan.id = target_plan_id;
end;
$$;

create or replace function public.fn_recompute_pm_plan_after_record_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.recompute_pm_plan_schedule(old.pm_plan_id);
    return old;
  end if;

  perform public.recompute_pm_plan_schedule(new.pm_plan_id);

  if tg_op = 'UPDATE' and old.pm_plan_id is distinct from new.pm_plan_id then
    perform public.recompute_pm_plan_schedule(old.pm_plan_id);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_pm_records_after_insert on public.pm_records;
drop trigger if exists trg_pm_records_after_update on public.pm_records;
drop trigger if exists trg_pm_records_after_change on public.pm_records;

drop function if exists public.fn_update_pm_plan_after_record();
drop function if exists public.fn_recompute_pm_plan_after_record_update();

create trigger trg_pm_records_after_change
  after insert or update or delete on public.pm_records
  for each row
  execute function public.fn_recompute_pm_plan_after_record_change();

-- Normalize every existing plan without altering its retained start_date.
with latest_history as (
  select plan.id as plan_id, max(record.done_date) as latest_done_date
    from public.pm_plans as plan
    left join public.pm_records as record on record.pm_plan_id = plan.id
   group by plan.id
)
update public.pm_plans as plan
   set last_done_date = history.latest_done_date,
       next_due_date = case
         when history.latest_done_date is not null
           then history.latest_done_date + plan.frequency_days
         else null
       end
  from latest_history as history
 where history.plan_id = plan.id;

revoke all on function public.recompute_pm_plan_schedule(uuid)
  from public, anon, authenticated;
revoke all on function public.fn_recompute_pm_plan_after_record_change()
  from public, anon, authenticated;
revoke all on function public.set_pm_plan_next_due_date()
  from public, anon, authenticated;

commit;
