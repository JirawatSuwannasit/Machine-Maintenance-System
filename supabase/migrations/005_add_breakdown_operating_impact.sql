-- MMS-028: keep work-order workflow separate from its effect on operation.
alter table breakdowns
  add column if not exists operating_impact text;

update breakdowns
set operating_impact = 'stopped'
where operating_impact is null;

alter table breakdowns
  alter column operating_impact set default 'stopped';

alter table breakdowns
  alter column operating_impact set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'breakdowns_operating_impact_check'
      and conrelid = 'breakdowns'::regclass
  ) then
    alter table breakdowns
      add constraint breakdowns_operating_impact_check
      check (operating_impact in ('running', 'limited', 'stopped'));
  end if;
end
$$;
