-- MMS-007 (revised): add machine asset fields.
-- Safe to run on a database that already has machines/data in it. Column
-- adds use IF NOT EXISTS and the unique constraint is added through a
-- guarded DO block, so re-running this script does not error.

begin;

alter table machines add column if not exists model text;
alter table machines add column if not exists serial_no text;
alter table machines add column if not exists manufacturer text;
alter table machines add column if not exists purchase_date date;

-- Display-only field: warranty_expiry does NOT feed the status light
-- logic. That logic stays based on breakdowns, pm_plans, and
-- machine_parts only (see lib/machineStatus.ts).
alter table machines add column if not exists warranty_expiry date;

-- serial_no is nullable + unique: Postgres treats NULLs as distinct, so
-- any number of machines can have no serial number, but any serial
-- number that IS entered must be unique across the system.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'machines_serial_no_key'
  ) then
    alter table machines
      add constraint machines_serial_no_key unique (serial_no);
  end if;
end $$;

commit;
