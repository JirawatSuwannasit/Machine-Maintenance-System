-- MMS-037: safe in-place historical corrections. Review/apply manually.
-- No backfill, RLS changes, or changes to the existing INSERT/DELETE triggers.
begin;

create or replace function public.fn_guard_part_replacement_update()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.machine_id is distinct from old.machine_id
     or new.part_id is distinct from old.part_id
     or new.stock_deducted is distinct from old.stock_deducted
     or new.created_at is distinct from old.created_at then
    raise exception using errcode = 'check_violation',
      message = 'Historical replacement identity and stock snapshot cannot be changed';
  end if;
  if new.breakdown_id is distinct from old.breakdown_id then
    -- Preserve the existing FK ON DELETE SET NULL behavior, while rejecting
    -- direct reassignment/unlinking of a replacement from a surviving breakdown.
    if not (pg_trigger_depth() > 1 and old.breakdown_id is not null
            and new.breakdown_id is null and not exists (
              select 1 from public.breakdowns where id = old.breakdown_id
            )) then
      raise exception using errcode = 'check_violation',
        message = 'Historical breakdown association cannot be changed';
    end if;
  end if;
  if new.unit_cost < 0 then
    raise exception using errcode = 'check_violation', message = 'Unit cost must not be negative';
  end if;
  if new.replaced_at is distinct from old.replaced_at then
    -- Serialize date corrections of different history rows for this link.
    -- The AFTER trigger then invokes MMS-031's volatile MAX(history) schedule
    -- function after the lock is acquired, seeing earlier committed edits.
    perform 1 from public.machine_parts
      where machine_id = old.machine_id and part_id = old.part_id for update;
  end if;
  return new;
end;
$$;

create or replace function public.fn_after_part_replacement_update()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.replaced_at is distinct from old.replaced_at then
    -- Reuse MMS-031's authoritative latest-history/override/disabled logic.
    update public.machine_parts set lifespan_override_days = lifespan_override_days
      where machine_id = old.machine_id and part_id = old.part_id;
  end if;
  if old.stock_deducted and new.qty_used is distinct from old.qty_used then
    -- Atomic delta based on the HISTORICAL snapshot, never the current mode.
    -- Widen intermediates so valid final integer stock does not overflow early.
    update public.spare_parts
      set stock_qty = (stock_qty::bigint + old.qty_used::bigint - new.qty_used::bigint)::integer
      where id = old.part_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_part_replacements_before_update_guard on public.part_replacements;
create trigger trg_part_replacements_before_update_guard
  before update on public.part_replacements for each row
  execute function public.fn_guard_part_replacement_update();
drop trigger if exists trg_part_replacements_after_update on public.part_replacements;
create trigger trg_part_replacements_after_update
  after update on public.part_replacements for each row
  execute function public.fn_after_part_replacement_update();

-- The Preview must not send an unsafe ordinary UPDATE before this migration
-- has been applied. This read-only readiness probe preserves admin-only editing.
create or replace function public.part_replacement_history_edit_ready()
returns boolean language sql stable set search_path = ''
as $$
  select public.is_app_admin() and
    (select count(*) = 2 from pg_catalog.pg_trigger
      where tgrelid = 'public.part_replacements'::regclass
        and tgname in ('trg_part_replacements_before_update_guard', 'trg_part_replacements_after_update')
        and tgenabled in ('O', 'A') and not tgisinternal);
$$;

revoke all on function public.fn_guard_part_replacement_update() from public, anon, authenticated;
revoke all on function public.fn_after_part_replacement_update() from public, anon, authenticated;
revoke all on function public.part_replacement_history_edit_ready() from public, anon;
grant execute on function public.part_replacement_history_edit_ready() to authenticated;

-- Make the new read-only RPC discoverable after manual application in Supabase.
notify pgrst, 'reload schema';

commit;
