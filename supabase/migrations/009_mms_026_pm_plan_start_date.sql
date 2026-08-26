-- MMS-026: support backdated PM schedules while preserving legacy plans.

begin;

alter table public.pm_plans
  add column if not exists start_date date;

create or replace function public.set_pm_plan_next_due_date()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.last_done_date is not null then
    new.next_due_date := new.last_done_date + new.frequency_days;
  elsif new.start_date is not null then
    new.next_due_date := new.start_date + new.frequency_days;
  else
    new.next_due_date := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_pm_plans_set_next_due_date on public.pm_plans;
create trigger trg_pm_plans_set_next_due_date
  before insert or update of start_date, frequency_days, last_done_date
  on public.pm_plans
  for each row
  execute function public.set_pm_plan_next_due_date();

commit;
