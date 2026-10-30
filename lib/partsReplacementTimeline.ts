import { DUE_SOON_DAYS } from "@/lib/machineStatus";
import { computeDueDiffDays, computeDueDisplay, type DueDisplay } from "@/lib/pmDueDate";

export const TIMELINE_WINDOW_YEARS = 11;
export const MAX_TIMELINE_YEARS = 30;

export function installationYear(installDate: string | null): number | null {
  if (!installDate) return null;
  const year = Number(installDate.slice(0, 4));
  return Number.isInteger(year) && year >= 1 && year <= 9999 ? year : null;
}

export function defaultTimelineRange(installDate: string | null, now: Date = new Date()) {
  const startYear = installationYear(installDate) ?? now.getFullYear() - 9;
  // Old machines open at their first 30 years, not a recent rolling window.
  // A future installation still needs a nonempty range starting at installation.
  const endYear = Math.min(9999, startYear + MAX_TIMELINE_YEARS - 1, Math.max(startYear, now.getFullYear() + 1));
  return { startYear, endYear };
}

export type TimelinePart = {
  part_code: string;
  part_name: string;
  default_lifespan_days: number | null;
  stock_tracking_enabled: boolean;
};
export type TimelineLink = {
  id: string;
  part_id: string;
  next_due_date: string | null;
  lifespan_override_days: number | null;
  schedule_disabled: boolean;
  spare_parts: TimelinePart | TimelinePart[] | null;
};
export type TimelineReplacement = {
  id: string;
  part_id: string;
  replaced_at: string;
  replaced_by: string | null;
  qty_used: number;
  unit_cost: number | string;
  total_cost: number | string;
  reason: string | null;
  spare_parts: TimelinePart | TimelinePart[] | null;
};
export type TimelineRow = {
  partId: string;
  part: TimelinePart | null;
  link: TimelineLink | null;
  byYear: Map<number, TimelineReplacement[]>;
};

export function localCalendarDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function validateTimelineRange(start: string, end: string, installDate: string | null = null): string | null {
  if (![start, end].every((year) => /^\d+$/.test(year) && Number(year) >= 1 && Number(year) <= 9999)) {
    return "กรุณาระบุปี ค.ศ. เป็นจำนวนเต็มระหว่าง 1–9999 ทั้งสองช่อง";
  }
  const minimum = installationYear(installDate);
  if (minimum !== null && Number(start) < minimum) return `ปีเริ่มต้นต้องไม่ก่อนปีที่ติดตั้งเครื่องจักร (${minimum})`;
  if (Number(end) < Number(start)) return "ปีสิ้นสุดต้องไม่น้อยกว่าปีเริ่มต้น";
  if (Number(end) - Number(start) + 1 > MAX_TIMELINE_YEARS) return "เลือกช่วงปีได้ไม่เกิน 30 ปี";
  return null;
}

export function timelineYears(startYear: number, endYear: number): number[] {
  if (validateTimelineRange(String(startYear), String(endYear))) return [];
  return Array.from({ length: endYear - startYear + 1 }, (_, i) => startYear + i);
}

export type TimelineVisibility = { machineId: string; hiddenPartIds: Set<string> };

// Keep opt-outs for surviving IDs on reload; new parts default to selected.
// A different machine always starts with all its own parts selected.
export function reconcileTimelineVisibility(
  previous: TimelineVisibility,
  machineId: string,
  availableIds: Iterable<string>
): TimelineVisibility {
  const available = new Set(availableIds);
  return {
    machineId,
    hiddenPartIds: new Set(previous.machineId === machineId
      ? Array.from(previous.hiddenPartIds).filter((id) => available.has(id)) : []),
  };
}

// Both database values are DATEs, not instants. At Dec 31 the installation
// anniversary has passed, so completed years = column year - install year.
export function systemYears(installDate: string | null, year: number): number | null {
  if (!installDate) return null;
  const installedYear = installationYear(installDate);
  return installedYear !== null && year >= installedYear
    ? year - installedYear
    : null;
}

function normalizePart(value: TimelineLink["spare_parts"]): TimelinePart | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

export function buildTimelineRows(
  links: TimelineLink[],
  replacements: TimelineReplacement[],
  today: string
): TimelineRow[] {
  const rows = new Map<string, TimelineRow>();
  for (const link of links) {
    rows.set(link.part_id, {
      partId: link.part_id, part: normalizePart(link.spare_parts), link, byYear: new Map(),
    });
  }
  const seenIds = new Set<string>();
  for (const entry of replacements) {
    if (seenIds.has(entry.id)) continue;
    seenIds.add(entry.id);
    let row = rows.get(entry.part_id);
    if (!row) {
      row = { partId: entry.part_id, part: normalizePart(entry.spare_parts), link: null, byYear: new Map() };
      rows.set(entry.part_id, row);
    }
    row.part ??= normalizePart(entry.spare_parts);
    // A future-dated record must never look like an already completed event.
    // Compare DATE strings directly, avoiding UTC parsing/year-boundary shifts.
    if (entry.replaced_at > today) continue;
    const year = Number(entry.replaced_at.slice(0, 4));
    const entries = row.byYear.get(year) ?? [];
    entries.push(entry);
    row.byYear.set(year, entries);
  }
  for (const row of rows.values()) {
    for (const entries of row.byYear.values()) {
      entries.sort((a, b) => b.replaced_at.localeCompare(a.replaced_at) || a.id.localeCompare(b.id));
    }
  }
  return Array.from(rows.values()).sort((a, b) =>
    (a.part?.part_code ?? a.partId).localeCompare(b.part?.part_code ?? b.partId, "th", { numeric: true })
  );
}

const neutral = "border border-slate-200 bg-slate-100 text-slate-700";
export function timelineRecommendation(row: TimelineRow, now: Date = new Date()): DueDisplay {
  const link = row.link;
  if (!link) return { label: "ไม่ได้ผูกกับเครื่องแล้ว", className: neutral };
  const days = link.schedule_disabled ? null : link.lifespan_override_days ?? row.part?.default_lifespan_days ?? null;
  if (days === null) return { label: "ไม่กำหนดรอบ", className: neutral };
  if (!link.next_due_date) return { label: "ยังไม่มีวันครบกำหนด", className: neutral };
  const display = computeDueDisplay(link.next_due_date, now);
  const diff = computeDueDiffDays(link.next_due_date, now)!;
  if (diff < 0) return { ...display, label: "แนะนำเปลี่ยน" };
  // Reuse today's and due-soon labels/colours and the existing 7-day threshold.
  return diff > DUE_SOON_DAYS ? { ...display, label: "ตามรอบ" } : display;
}
