import { supabase } from "@/lib/supabase";
import type { TimelineLink, TimelineReplacement } from "@/lib/partsReplacementTimeline";

const PART_FIELDS = "part_code, part_name, default_lifespan_days, stock_tracking_enabled";
const PAGE_SIZE = 500;

async function readAll<T extends { id: string }>(
  table: "machine_parts" | "part_replacements",
  columns: string,
  machineId: string,
  signal?: AbortSignal
): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | null = null;
  while (true) {
    if (signal?.aborted) throw new Error("Cancelled");
    let query = supabase.from(table).select(columns).eq("machine_id", machineId)
      .order("id", { ascending: true }).limit(PAGE_SIZE);
    if (cursor !== null) query = query.gt("id", cursor);
    if (signal) query = query.abortSignal(signal);
    const { data, error } = await query;
    if (error) throw error;
    const batch = (data ?? []) as unknown as T[];
    if (batch.length === 0) return rows;
    const nextCursor = batch[batch.length - 1].id;
    if (nextCursor === cursor) throw new Error("Pagination did not advance");
    rows.push(...batch);
    cursor = nextCursor;
    // Continue even for a short batch: the server's row cap may be lower
    // than PAGE_SIZE. Primary-key ordering avoids ambiguous date ties and
    // offset shifts; only an empty next page proves that we've finished.
  }
}

export async function fetchPartsReplacementTimeline(machineId: string, signal?: AbortSignal) {
  const [links, replacements] = await Promise.all([
    readAll<TimelineLink>("machine_parts",
      `id, part_id, next_due_date, lifespan_override_days, schedule_disabled, spare_parts(${PART_FIELDS})`, machineId, signal),
    readAll<TimelineReplacement>("part_replacements",
      `id, part_id, replaced_at, replaced_by, qty_used, unit_cost, total_cost, reason, spare_parts(${PART_FIELDS})`, machineId, signal),
  ]);
  return { links, replacements };
}
