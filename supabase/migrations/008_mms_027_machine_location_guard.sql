-- MMS-027 follow-up: enforce canonical machine section values.
-- This migration validates existing rows and aborts rather than normalizing data.

begin;

do $$
begin
  if exists (
    select 1
    from public.machines
    where location is null
       or location not in ('REL', 'GP', 'FA', 'CAL')
  ) then
    raise exception using
      errcode = 'check_violation',
      message = 'MMS-027 preflight failed: machines.location contains NULL or a value outside REL, GP, FA, CAL. No data was changed.';
  end if;
end;
$$;

alter table public.machines
  alter column location set not null;

alter table public.machines
  drop constraint if exists machines_location_check;

alter table public.machines
  add constraint machines_location_check
  check (location in ('REL', 'GP', 'FA', 'CAL'));

commit;
