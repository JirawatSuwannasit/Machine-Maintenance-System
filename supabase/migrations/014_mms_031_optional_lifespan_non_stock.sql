-- MMS-031: optional replacement schedules and non-stock spare parts.
-- Existing parts/replacements retain stocked behavior; no quantities/history are reset.
begin;

alter table public.spare_parts
  alter column default_lifespan_days drop not null,
  add column if not exists stock_tracking_enabled boolean not null default true;

alter table public.machine_parts
  add column if not exists schedule_disabled boolean not null default false;

alter table public.part_replacements
  add column if not exists stock_deducted boolean not null default true;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'machine_parts_lifespan_override_positive'
      and conrelid = 'public.machine_parts'::regclass
  ) then
    alter table public.machine_parts
      add constraint machine_parts_lifespan_override_positive
      check (lifespan_override_days is null or lifespan_override_days > 0);
  end if;
end;
$$;

-- Recompute one link from the actual latest replacement history whenever its
-- schedule settings are inserted/changed. NULL override means inherit; the
-- explicit flag is the only way to disable a machine-specific schedule.
create or replace function public.fn_set_machine_part_schedule()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_latest date;
  v_default_days integer;
  v_effective_days integer;
begin
  select max(pr.replaced_at)
    into v_latest
    from public.part_replacements pr
   where pr.machine_id = new.machine_id
     and pr.part_id = new.part_id;

  select sp.default_lifespan_days
    into v_default_days
    from public.spare_parts sp
   where sp.id = new.part_id;

  new.last_replaced_at := v_latest;
  v_effective_days := coalesce(new.lifespan_override_days, v_default_days);

  if new.schedule_disabled or v_latest is null or v_effective_days is null then
    new.next_due_date := null;
  else
    new.next_due_date := (v_latest + v_effective_days)::date;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_machine_parts_set_schedule on public.machine_parts;
create trigger trg_machine_parts_set_schedule
  before insert or update of lifespan_override_days, schedule_disabled
  on public.machine_parts
  for each row
  execute function public.fn_set_machine_part_schedule();

-- Stamp inventory behavior from the current master setting. Frontend values
-- are deliberately ignored so every transaction has an authoritative snapshot.
create or replace function public.fn_set_part_replacement_stock_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select sp.stock_tracking_enabled
    into new.stock_deducted
    from public.spare_parts sp
   where sp.id = new.part_id;
  return new;
end;
$$;

drop trigger if exists trg_part_replacements_before_insert_stock_snapshot
  on public.part_replacements;
create trigger trg_part_replacements_before_insert_stock_snapshot
  before insert on public.part_replacements
  for each row
  execute function public.fn_set_part_replacement_stock_snapshot();

-- Replace the original INSERT trigger function without creating a competing
-- stock trigger. Schedule dates come from MAX(replaced_at), not insertion order.
create or replace function public.fn_after_part_replacement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.machine_parts
     set lifespan_override_days = lifespan_override_days
   where machine_id = new.machine_id
     and part_id = new.part_id;

  if new.stock_deducted then
    update public.spare_parts
       set stock_qty = stock_qty - new.qty_used
     where id = new.part_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_part_replacements_after_insert on public.part_replacements;
create trigger trg_part_replacements_after_insert
  after insert on public.part_replacements
  for each row
  execute function public.fn_after_part_replacement();

-- DELETE reverses the historical transaction snapshot, even if the part's
-- current stock-tracking mode has since changed.
create or replace function public.fn_after_part_replacement_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.stock_deducted then
    update public.spare_parts
       set stock_qty = stock_qty + old.qty_used
     where id = old.part_id;
  end if;

  update public.machine_parts
     set lifespan_override_days = lifespan_override_days
   where machine_id = old.machine_id
     and part_id = old.part_id;

  return old;
end;
$$;

drop trigger if exists trg_part_replacements_after_delete on public.part_replacements;
create trigger trg_part_replacements_after_delete
  after delete on public.part_replacements
  for each row
  execute function public.fn_after_part_replacement_delete();

-- A default lifespan change immediately refreshes every affected link. This
-- does not touch replacement history and does not recurse into spare_parts.
create or replace function public.fn_recompute_part_links_after_lifespan_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.default_lifespan_days is distinct from old.default_lifespan_days then
    update public.machine_parts
       set lifespan_override_days = lifespan_override_days
     where part_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_spare_parts_recompute_links on public.spare_parts;
create trigger trg_spare_parts_recompute_links
  after update of default_lifespan_days on public.spare_parts
  for each row
  execute function public.fn_recompute_part_links_after_lifespan_change();

commit;
