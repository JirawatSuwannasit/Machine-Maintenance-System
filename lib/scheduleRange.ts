import { parseIsoDateAsLocalDay, toLocalDayStart } from "@/lib/pmDueDate";

export type ScheduleRange = "7d" | "1m" | "3m" | "6m";

export const DEFAULT_SCHEDULE_RANGE: ScheduleRange = "7d";

export const SCHEDULE_RANGE_OPTIONS: ReadonlyArray<{
  value: ScheduleRange;
  label: string;
}> = [
  { value: "7d", label: "7 วัน" },
  { value: "1m", label: "1 เดือน" },
  { value: "3m", label: "3 เดือน" },
  { value: "6m", label: "6 เดือน" },
];

export function getScheduleRangeLabel(range: ScheduleRange): string {
  return SCHEDULE_RANGE_OPTIONS.find((option) => option.value === range)!.label;
}

export function getScheduleCutoff(
  range: ScheduleRange,
  referenceDate: Date = new Date()
): Date {
  const today = toLocalDayStart(referenceDate);
  if (range === "7d") {
    today.setDate(today.getDate() + 7);
    return today;
  }

  const months = range === "1m" ? 1 : range === "3m" ? 3 : 6;
  const originalDay = today.getDate();
  today.setDate(1);
  today.setMonth(today.getMonth() + months);
  const lastDay = new Date(
    today.getFullYear(),
    today.getMonth() + 1,
    0
  ).getDate();
  today.setDate(Math.min(originalDay, lastDay));
  return today;
}

export function isDueWithinScheduleRange(
  dueDate: string,
  range: ScheduleRange,
  referenceDate: Date = new Date()
): boolean {
  return parseIsoDateAsLocalDay(dueDate) <= getScheduleCutoff(range, referenceDate);
}
