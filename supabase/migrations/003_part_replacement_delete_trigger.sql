-- MMS-024 (Part A of B): DELETE trigger on part_replacements.
-- Mirror image of trg_part_replacements_after_insert -- undoes its effects
-- when a part_replacements row is removed. Safe to re-run: CREATE OR
-- REPLACE FUNCTION + DROP TRIGGER IF EXISTS before CREATE TRIGGER.
-- Does NOT touch the existing INSERT trigger/function or any table
-- structure.

begin;

-- After a part_replacements row is deleted:
--   1) always restore the stock it had consumed, even if the machine/part
--      link no longer exists (the stock pool is independent of the link).
--   2) recompute the affected machine_parts row's schedule from whatever
--      replacement history remains, so next_due_date/last_replaced_at
--      always reflect the CURRENT true history -- including the case
--      where the most recent replacement itself is the one being deleted
--      (product owner's decision option ข+ค). If no replacement is left
--      for that (machine_id, part_id) pair, both columns go back to NULL
--      ("ยังไม่เคยเปลี่ยน").
create or replace function fn_after_part_replacement_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_date date;
begin
  -- Always restore stock -- unconditional, regardless of whether a
  -- machine_parts link still exists for this part.
  update spare_parts
     set stock_qty = stock_qty + old.qty_used
   where id = old.part_id;

  -- This is an AFTER DELETE trigger, so the just-deleted row is already
  -- gone from the table -- a plain MAX() here only sees the survivors for
  -- this exact (machine_id, part_id) pair.
  select max(replaced_at)
    into v_prev_date
    from part_replacements
   where machine_id = old.machine_id
     and part_id = old.part_id;

  if v_prev_date is not null then
    -- A previous replacement remains: roll the schedule back to it.
    update machine_parts mp
       set last_replaced_at = v_prev_date,
           next_due_date = (
             v_prev_date
             + (coalesce(mp.lifespan_override_days, sp.default_lifespan_days) || ' days')::interval
           )::date
      from spare_parts sp
     where sp.id = mp.part_id
       and mp.machine_id = old.machine_id
       and mp.part_id = old.part_id;
  else
    -- No replacement left for this pair -- back to "never replaced".
    -- (No-op if the machine_parts row itself no longer exists.)
    update machine_parts
       set last_replaced_at = null,
           next_due_date = null
     where machine_id = old.machine_id
       and part_id = old.part_id;
  end if;

  return old;
end;
$$;

drop trigger if exists trg_part_replacements_after_delete on part_replacements;
create trigger trg_part_replacements_after_delete
  after delete on part_replacements
  for each row
  execute function fn_after_part_replacement_delete();

commit;
