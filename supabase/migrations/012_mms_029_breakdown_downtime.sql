-- MMS-029: automatic downtime for closed, fully stopped breakdowns.
-- This migration includes a historical backfill and must be reviewed and run manually.
begin;

create or replace function public.fn_set_closed_breakdown_downtime()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'closed'
     and new.operating_impact = 'stopped'
     and new.downtime_minutes is null
     and new.closed_at is not null
     and new.closed_at >= new.reported_at then
    new.downtime_minutes := floor(
      extract(epoch from (new.closed_at - new.reported_at)) / 60
    )::integer;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_closed_breakdown_downtime on public.breakdowns;
create trigger trg_set_closed_breakdown_downtime
  before insert or update on public.breakdowns
  for each row
  execute function public.fn_set_closed_breakdown_downtime();

update public.breakdowns
set downtime_minutes = floor(
  extract(epoch from (closed_at - reported_at)) / 60
)::integer
where status = 'closed'
  and operating_impact = 'stopped'
  and downtime_minutes is null
  and closed_at is not null
  and closed_at >= reported_at;

commit;
