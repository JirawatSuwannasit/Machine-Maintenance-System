import { DUE_SOON_DAYS } from "@/lib/machineStatus";

// Parses a "YYYY-MM-DD" date string as a local-time calendar day --
// new Date("YYYY-MM-DD") parses as UTC midnight, which can shift to the
// wrong day once converted to local time.
export function parseIsoDateAsLocalDay(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function toLocalDayStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function formatDateThai(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

// Number of calendar days from `referenceDate` to `nextDueDate` (negative
// once overdue), or null when there is no due date yet.
export function computeDueDiffDays(
  nextDueDate: string | null,
  referenceDate: Date = new Date()
): number | null {
  if (!nextDueDate) return null;
  const today = toLocalDayStart(referenceDate);
  const due = parseIsoDateAsLocalDay(nextDueDate);
  return Math.round((due.getTime() - today.getTime()) / 86400000);
}

export type DueDisplay = { label: string; className: string };

// Shared by app/pm/plans/page.tsx (MMS-012) and app/pm/page.tsx (MMS-014) so
// the due-date urgency colour/label logic never drifts between the two pages.
export function computeDueDisplay(
  nextDueDate: string | null,
  referenceDate: Date = new Date()
): DueDisplay {
  if (!nextDueDate) {
    return {
      label: "รอทำครั้งแรก",
      className: "bg-gray-100 text-gray-700 border border-gray-200",
    };
  }

  const today = toLocalDayStart(referenceDate);
  const due = parseIsoDateAsLocalDay(nextDueDate);
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86400000);

  if (diffDays < 0) {
    return {
      label: `เลยกำหนด ${Math.abs(diffDays)} วัน`,
      className: "bg-red-100 text-red-800 border border-red-200",
    };
  }
  if (diffDays === 0) {
    return {
      label: "ครบกำหนดวันนี้",
      className: "bg-yellow-100 text-yellow-800 border border-yellow-200",
    };
  }
  if (diffDays <= DUE_SOON_DAYS) {
    return {
      label: `อีก ${diffDays} วัน`,
      className: "bg-yellow-100 text-yellow-800 border border-yellow-200",
    };
  }
  return {
    label: formatDateThai(nextDueDate),
    className: "bg-green-100 text-green-800 border border-green-200",
  };
}
