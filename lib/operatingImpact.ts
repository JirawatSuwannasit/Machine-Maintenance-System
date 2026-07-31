export type OperatingImpact = "running" | "limited" | "stopped";

export const OPERATING_IMPACT_OPTIONS: Array<{
  value: OperatingImpact;
  label: string;
  description: string;
}> = [
  {
    value: "running",
    label: "ยังใช้งานได้",
    description: "มีอาการผิดปกติ แต่เครื่องยังสามารถทำงานต่อได้",
  },
  {
    value: "limited",
    label: "เดินเครื่องได้แบบจำกัด",
    description: "เครื่องยังทำงานได้ แต่มีข้อจำกัดหรือประสิทธิภาพลดลง",
  },
  {
    value: "stopped",
    label: "เครื่องหยุด / ใช้งานไม่ได้",
    description: "ต้องหยุดเครื่องหรือไม่สามารถใช้งานได้",
  },
];

export const OPERATING_IMPACT_LABELS: Record<OperatingImpact, string> = {
  running: "ยังใช้งานได้",
  limited: "เดินเครื่องได้แบบจำกัด",
  stopped: "เครื่องหยุด / ใช้งานไม่ได้",
};

export function isOperatingImpact(value: string): value is OperatingImpact {
  return value === "running" || value === "limited" || value === "stopped";
}

export const OPERATING_IMPACT_BADGE_CLASSES: Record<OperatingImpact, string> = {
  running: "bg-green-100 text-green-800 border border-green-200",
  limited: "bg-amber-100 text-amber-800 border border-amber-200",
  stopped: "bg-red-100 text-red-800 border border-red-200",
};
