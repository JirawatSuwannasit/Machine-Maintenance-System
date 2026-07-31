export type OperatingImpact = "running" | "limited" | "stopped";

export const OPERATING_IMPACT_OPTIONS: Array<{
  value: OperatingImpact;
  label: string;
  description: string;
}> = [
  { value: "running", label: "เดินเครื่องได้", description: "เครื่องจักรยังทำงานได้ตามปกติ" },
  { value: "limited", label: "เดินเครื่องได้แบบจำกัด", description: "ยังใช้งานได้ แต่มีข้อจำกัด" },
  { value: "stopped", label: "หยุดเครื่อง", description: "ไม่สามารถเดินเครื่องได้" },
];

export const OPERATING_IMPACT_LABELS: Record<OperatingImpact, string> = {
  running: "เดินเครื่องได้",
  limited: "เดินเครื่องได้แบบจำกัด",
  stopped: "หยุดเครื่อง",
};

export const OPERATING_IMPACT_BADGE_CLASSES: Record<OperatingImpact, string> = {
  running: "bg-green-100 text-green-800 border border-green-200",
  limited: "bg-amber-100 text-amber-800 border border-amber-200",
  stopped: "bg-red-100 text-red-800 border border-red-200",
};
