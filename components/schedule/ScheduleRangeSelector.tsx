"use client";

import {
  SCHEDULE_RANGE_OPTIONS,
  type ScheduleRange,
} from "@/lib/scheduleRange";

export default function ScheduleRangeSelector({
  value,
  onChange,
}: {
  value: ScheduleRange;
  onChange: (value: ScheduleRange) => void;
}) {
  return (
    <label className="flex min-h-[44px] items-center gap-2 text-sm text-primary">
      <span className="whitespace-nowrap">ช่วงเวลา</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as ScheduleRange)}
        className="min-h-[44px] rounded-md border border-primary/20 bg-white px-3 py-2 font-medium text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        aria-label="เลือกช่วงเวลากำหนดการ"
      >
        {SCHEDULE_RANGE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
