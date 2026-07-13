export type MachineStatus = "red" | "yellow" | "orange" | "green" | "gray";

// Number of days ahead a due date counts as "due soon" (orange).
// Change this single constant to retune the status rules.
export const DUE_SOON_DAYS = 7;

export const MACHINE_STATUS_ORDER: MachineStatus[] = [
  "red",
  "yellow",
  "orange",
  "green",
  "gray",
];

export const MACHINE_STATUS_COLORS: Record<MachineStatus, string> = {
  red: "#DC2626",
  yellow: "#EAB308",
  orange: "#F97316",
  green: "#16A34A",
  gray: "#9CA3AF",
};

export const MACHINE_STATUS_LABELS: Record<MachineStatus, string> = {
  red: "เสียอยู่",
  yellow: "เลยกำหนด",
  orange: "ใกล้ถึงรอบ",
  green: "ปกติ",
  gray: "ไม่ใช้งาน",
};

// Parses a "YYYY-MM-DD" date string as a local-time calendar day.
// `new Date("YYYY-MM-DD")` parses as UTC midnight, which can shift to the
// wrong day once converted to local time -- this avoids that pitfall.
function parseIsoDateAsLocalDay(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toLocalDayStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// Pure status calculation, shared by the status board (MMS-006) and the
// machine profile page (MMS-008). `dueDates` is the combined list of
// pm_plans.next_due_date and machine_parts.next_due_date for one machine.
export function computeMachineStatus(
  machineStatus: string,
  hasOpenBreakdown: boolean,
  dueDates: string[],
  referenceDate: Date = new Date()
): MachineStatus {
  if (machineStatus === "inactive" || machineStatus === "scrapped") {
    return "gray";
  }

  if (hasOpenBreakdown) {
    return "red";
  }

  const today = toLocalDayStart(referenceDate);
  const dueSoonThreshold = new Date(today);
  dueSoonThreshold.setDate(dueSoonThreshold.getDate() + DUE_SOON_DAYS);

  let isOverdue = false;
  let isDueSoon = false;

  for (const isoDate of dueDates) {
    const dueDate = parseIsoDateAsLocalDay(isoDate);
    if (dueDate < today) {
      isOverdue = true;
    } else if (dueDate <= dueSoonThreshold) {
      isDueSoon = true;
    }
  }

  if (isOverdue) {
    return "yellow";
  }
  if (isDueSoon) {
    return "orange";
  }
  return "green";
}
