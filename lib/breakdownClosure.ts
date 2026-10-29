export function toDateTimeLocal(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

export function fromDateTimeLocal(value: string): string {
  return new Date(value).toISOString();
}

export function computeDowntimePreview(reportedAtIso: string, closedAtIso: string): number | null {
  const minutes = Math.floor(
    (new Date(closedAtIso).getTime() - new Date(reportedAtIso).getTime()) / 60_000
  );
  return minutes >= 0 ? minutes : null;
}

// Validate before conversion so an empty/invalid local value never throws or
// falls back to the save timestamp. Compare instants in the browser timezone.
export function validateClosedAtLocal(
  value: string,
  reportedAtIso: string,
  now: Date = new Date()
): string | null {
  if (!value) return "กรุณาระบุวันเวลาปิดงานจริง";
  const closedAt = new Date(value).getTime();
  if (!Number.isFinite(closedAt)) return "กรุณาระบุวันเวลาปิดงานจริงให้ถูกต้อง";
  if (closedAt < new Date(reportedAtIso).getTime()) {
    return "วันเวลาปิดงานต้องไม่น้อยกว่าวันเวลาที่แจ้งเสีย";
  }
  if (closedAt > now.getTime()) {
    return "ไม่สามารถเลือกวันเวลาปิดงานในอนาคตได้";
  }
  return null;
}
