-- MMS-004: initial database schema.
-- Run this once in the Supabase SQL Editor on a fresh project.
-- Re-running the sample data section will fail on the unique
-- constraints (machine_code / part_code) by design -- see the
-- separate reset snippet supplied alongside this migration.

begin;

create extension if not exists pgcrypto;

-- ============================================================
-- TABLES
-- ============================================================

create table if not exists machines (
  id uuid primary key default gen_random_uuid(),
  machine_code text unique not null,
  machine_name text not null,
  category text,
  location text,
  install_date date,
  status text not null default 'active'
    check (status in ('active', 'inactive', 'scrapped')),
  created_at timestamptz default now()
);

create table if not exists breakdowns (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references machines(id) on delete cascade,
  reported_at timestamptz not null default now(),
  symptom text not null,
  cause text,
  action_taken text,
  downtime_minutes integer,
  -- labor/outsourcing cost only; part costs live in part_replacements
  -- to avoid double counting
  repair_cost numeric(12,2) not null default 0,
  technician text,
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'closed')),
  closed_at timestamptz
);

create table if not exists pm_plans (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references machines(id) on delete cascade,
  pm_name text not null,
  frequency_days integer not null check (frequency_days > 0),
  checklist jsonb default '[]'::jsonb,
  -- last_done_date / next_due_date are maintained by trg_pm_records_after_insert
  last_done_date date,
  next_due_date date,
  is_active boolean not null default true
);

create table if not exists pm_records (
  id uuid primary key default gen_random_uuid(),
  pm_plan_id uuid not null references pm_plans(id) on delete cascade,
  -- denormalized for fast per-machine history queries
  machine_id uuid not null references machines(id) on delete cascade,
  done_date date not null,
  done_by text,
  checklist_result jsonb,
  pm_cost numeric(12,2) not null default 0,
  notes text,
  created_at timestamptz default now()
);

create table if not exists spare_parts (
  id uuid primary key default gen_random_uuid(),
  part_code text unique not null,
  part_name text not null,
  default_lifespan_days integer not null check (default_lifespan_days > 0),
  unit_cost numeric(12,2) not null default 0,
  -- one shared stock pool across all machines
  stock_qty integer not null default 0,
  min_stock integer not null default 1,
  created_at timestamptz default now()
);

-- Junction table between machines and spare_parts.
-- A machine-specific part is one row; a common part shared by N machines
-- is N rows. Replacement-cycle tracking lives here (per machine-part pair)
-- because each machine replaces the same part on its own schedule.
create table if not exists machine_parts (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references machines(id) on delete cascade,
  part_id uuid not null references spare_parts(id) on delete cascade,
  -- null = use spare_parts.default_lifespan_days
  lifespan_override_days integer,
  -- maintained by trg_part_replacements_after_insert
  last_replaced_at date,
  next_due_date date,
  created_at timestamptz default now(),
  unique (machine_id, part_id)
);

create table if not exists part_replacements (
  id uuid primary key default gen_random_uuid(),
  part_id uuid not null references spare_parts(id) on delete cascade,
  machine_id uuid not null references machines(id) on delete cascade,
  replaced_at date not null,
  replaced_by text,
  reason text check (reason in ('planned', 'breakdown')),
  qty_used integer not null default 1 check (qty_used > 0),
  -- price snapshot at replacement time; prefilled from spare_parts.unit_cost
  -- but editable, so later master-price changes never rewrite history
  unit_cost numeric(12,2) not null default 0,
  total_cost numeric(12,2) generated always as (qty_used * unit_cost) stored,
  breakdown_id uuid references breakdowns(id) on delete set null,
  notes text,
  created_at timestamptz default now()
);

-- ============================================================
-- INDEXES
-- ============================================================

create index if not exists idx_breakdowns_machine_id on breakdowns(machine_id);
create index if not exists idx_breakdowns_status on breakdowns(status);
create index if not exists idx_pm_records_machine_id on pm_records(machine_id);
create index if not exists idx_pm_records_pm_plan_id on pm_records(pm_plan_id);
create index if not exists idx_pm_plans_machine_id on pm_plans(machine_id);
create index if not exists idx_machine_parts_machine_id on machine_parts(machine_id);
create index if not exists idx_machine_parts_part_id on machine_parts(part_id);
create index if not exists idx_part_replacements_machine_id on part_replacements(machine_id);
create index if not exists idx_part_replacements_part_id on part_replacements(part_id);
create index if not exists idx_part_replacements_breakdown_id on part_replacements(breakdown_id);
create index if not exists idx_pm_plans_next_due_date on pm_plans(next_due_date);
create index if not exists idx_machine_parts_next_due_date on machine_parts(next_due_date);

-- ============================================================
-- TRIGGERS
-- ============================================================

-- After a PM is recorded, roll the plan's schedule forward.
create or replace function fn_update_pm_plan_after_record()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update pm_plans
     set last_done_date = new.done_date,
         next_due_date  = (new.done_date + (frequency_days || ' days')::interval)::date
   where id = new.pm_plan_id;
  return new;
end;
$$;

drop trigger if exists trg_pm_records_after_insert on pm_records;
create trigger trg_pm_records_after_insert
  after insert on pm_records
  for each row
  execute function fn_update_pm_plan_after_record();

-- After a part is replaced: update only the matching machine+part
-- schedule (other machines sharing the same common part are untouched),
-- and decrement the shared stock pool. Stock is allowed to go negative;
-- the UI warns but still saves.
create or replace function fn_after_part_replacement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update machine_parts mp
     set last_replaced_at = new.replaced_at,
         next_due_date = (
           new.replaced_at
           + (coalesce(mp.lifespan_override_days, sp.default_lifespan_days) || ' days')::interval
         )::date
    from spare_parts sp
   where sp.id = new.part_id
     and mp.machine_id = new.machine_id
     and mp.part_id = new.part_id;

  update spare_parts
     set stock_qty = stock_qty - new.qty_used
   where id = new.part_id;

  return new;
end;
$$;

drop trigger if exists trg_part_replacements_after_insert on part_replacements;
create trigger trg_part_replacements_after_insert
  after insert on part_replacements
  for each row
  execute function fn_after_part_replacement();

-- ============================================================
-- ROW LEVEL SECURITY
-- Full access for the `authenticated` role only; no anonymous access.
-- ============================================================

alter table machines enable row level security;
alter table breakdowns enable row level security;
alter table pm_plans enable row level security;
alter table pm_records enable row level security;
alter table spare_parts enable row level security;
alter table machine_parts enable row level security;
alter table part_replacements enable row level security;

drop policy if exists authenticated_full_access on machines;
create policy authenticated_full_access on machines
  for all to authenticated using (true) with check (true);

drop policy if exists authenticated_full_access on breakdowns;
create policy authenticated_full_access on breakdowns
  for all to authenticated using (true) with check (true);

drop policy if exists authenticated_full_access on pm_plans;
create policy authenticated_full_access on pm_plans
  for all to authenticated using (true) with check (true);

drop policy if exists authenticated_full_access on pm_records;
create policy authenticated_full_access on pm_records
  for all to authenticated using (true) with check (true);

drop policy if exists authenticated_full_access on spare_parts;
create policy authenticated_full_access on spare_parts
  for all to authenticated using (true) with check (true);

drop policy if exists authenticated_full_access on machine_parts;
create policy authenticated_full_access on machine_parts
  for all to authenticated using (true) with check (true);

drop policy if exists authenticated_full_access on part_replacements;
create policy authenticated_full_access on part_replacements
  for all to authenticated using (true) with check (true);

-- ============================================================
-- SAMPLE DATA
-- ============================================================

do $$
declare
  v_ts01_id uuid;
  v_ts02_id uuid;
  v_cmm01_id uuid;
  v_f100_id uuid;
  v_b200_id uuid;
  v_s300_id uuid;
begin
  insert into machines (machine_code, machine_name, category, status)
    values ('TS-01', 'เครื่องทดสอบแรงดึง', 'TS', 'active')
    returning id into v_ts01_id;

  insert into machines (machine_code, machine_name, category, status)
    values ('TS-02', 'เครื่องทดสอบแรงดึง 2', 'TS', 'active')
    returning id into v_ts02_id;

  insert into machines (machine_code, machine_name, category, status)
    values ('CMM-01', 'เครื่องวัด CMM', 'CMM', 'active')
    returning id into v_cmm01_id;

  insert into pm_plans (machine_id, pm_name, frequency_days, checklist)
    values (v_ts01_id, 'PM รายเดือน', 30, '["เช็คน้ำมัน","ทำความสะอาด filter"]'::jsonb);

  insert into pm_plans (machine_id, pm_name, frequency_days, checklist)
    values (v_cmm01_id, 'PM ราย 6 เดือน', 180, '["สอบเทียบ","เช็คระบบลม"]'::jsonb);

  insert into spare_parts (part_code, part_name, default_lifespan_days, unit_cost, stock_qty, min_stock)
    values ('F-100', 'Filter', 90, 350, 10, 3)
    returning id into v_f100_id;

  insert into spare_parts (part_code, part_name, default_lifespan_days, unit_cost, stock_qty, min_stock)
    values ('B-200', 'Belt', 180, 1200, 4, 2)
    returning id into v_b200_id;

  insert into spare_parts (part_code, part_name, default_lifespan_days, unit_cost, stock_qty, min_stock)
    values ('S-300', 'Sensor', 365, 4500, 1, 2)
    returning id into v_s300_id;

  -- F-100 is the common part: shared by TS-01 and TS-02
  insert into machine_parts (machine_id, part_id) values (v_ts01_id, v_f100_id);
  insert into machine_parts (machine_id, part_id) values (v_ts02_id, v_f100_id);

  -- B-200 belongs to TS-01 only, with a shorter override lifespan
  insert into machine_parts (machine_id, part_id, lifespan_override_days)
    values (v_ts01_id, v_b200_id, 120);

  -- S-300 belongs to CMM-01 only
  insert into machine_parts (machine_id, part_id) values (v_cmm01_id, v_s300_id);
end $$;

commit;
