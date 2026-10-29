-- MMS-030: distinguish repaired and administratively closed/unrepaired work.
-- Review and run manually; no legacy outcome is inferred or backfilled.
begin;

alter table public.breakdowns
  add column if not exists closure_outcome text,
  add column if not exists no_repair_reason text,
  add column if not exists impact_cleared_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'breakdowns_closure_outcome_check'
      and conrelid = 'public.breakdowns'::regclass
  ) then
    alter table public.breakdowns
      add constraint breakdowns_closure_outcome_check
      check (closure_outcome is null or closure_outcome in ('repaired', 'not_repaired'));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'breakdowns_no_repair_reason_check'
      and conrelid = 'public.breakdowns'::regclass
  ) then
    alter table public.breakdowns
      add constraint breakdowns_no_repair_reason_check
      check (
        closure_outcome is distinct from 'not_repaired'
        or nullif(btrim(no_repair_reason), '') is not null
      );
  end if;
end;
$$;

create or replace function public.fn_set_closed_breakdown_downtime()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'closed'
     and new.closure_outcome is distinct from 'not_repaired'
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

-- The trigger created by migration 012 already calls this function. Recreate
-- it defensively so this migration is safe when applied after schema restores.
drop trigger if exists trg_set_closed_breakdown_downtime on public.breakdowns;
create trigger trg_set_closed_breakdown_downtime
  before insert or update on public.breakdowns
  for each row
  execute function public.fn_set_closed_breakdown_downtime();

commit;
