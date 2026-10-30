import { localCalendarDate } from "@/lib/partsReplacementTimeline";

export type ReplacementEditValues = {
  replaced_at: string;
  replaced_by: string;
  qty_used: string;
  unit_cost: string;
  reason: string;
  notes: string;
};
export type ReplacementSavedValues = {
  replaced_at: string;
  replaced_by: string | null;
  qty_used: number;
  unit_cost: number | string;
  reason: string | null;
  notes: string | null;
};

export function replacementEditValues(row: ReplacementSavedValues): ReplacementEditValues {
  return { replaced_at: row.replaced_at, replaced_by: row.replaced_by ?? "", qty_used: String(row.qty_used),
    unit_cost: String(row.unit_cost), reason: row.reason ?? "", notes: row.notes ?? "" };
}

export function validateReplacementEdit(values: ReplacementEditValues, now: Date = new Date()) {
  const errors: Partial<Record<keyof ReplacementEditValues, string>> = {};
  const date = values.replaced_at;
  const parsed = new Date(`${date}T12:00:00`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || (parsed.getFullYear() !== Number(date.slice(0, 4)) || parsed.getMonth() + 1 !== Number(date.slice(5, 7)) || parsed.getDate() !== Number(date.slice(8, 10)) || parsed.getFullYear() < 1) || date > localCalendarDate(now)) {
    errors.replaced_at = "กรุณาระบุวันที่เปลี่ยนอะไหล่ให้ถูกต้องและไม่เป็นวันในอนาคต";
  }
  const qty = Number(values.qty_used);
  if (!/^\d+$/.test(values.qty_used) || !Number.isInteger(qty) || qty < 1 || qty > 2147483647) {
    errors.qty_used = "จำนวนที่ใช้ต้องเป็นจำนวนเต็มตั้งแต่ 1 ถึง 2,147,483,647";
  }
  const price = Number(values.unit_cost);
  if (!/^\d+(\.\d{1,2})?$/.test(values.unit_cost) || !Number.isFinite(price) || price < 0 || price > 9999999999.99) {
    errors.unit_cost = "กรุณาระบุราคาไม่ติดลบ ทศนิยมไม่เกิน 2 ตำแหน่ง และไม่เกิน 9,999,999,999.99 บาท";
  }
  if (!errors.qty_used && !errors.unit_cost) {
    const cents = BigInt(values.unit_cost.split(".")[0]) * BigInt(100) + BigInt((values.unit_cost.split(".")[1] ?? "").padEnd(2, "0"));
    if (BigInt(qty) * cents > BigInt("999999999999")) errors.unit_cost = "ราคารวมเกินขอบเขตที่ระบบรองรับ";
  }
  if (!["", "planned", "breakdown"].includes(values.reason)) errors.reason = "กรุณาเลือกสาเหตุการเปลี่ยนให้ถูกต้อง";
  return errors;
}

// Explicit allowlist: never send identity, snapshot or the generated total.
// Unchanged text preserves the database's original NULL/empty/whitespace value.
export function replacementEditPayload(values: ReplacementEditValues, original: ReplacementSavedValues) {
  return {
    replaced_at: values.replaced_at,
    replaced_by: values.replaced_by === (original.replaced_by ?? "") ? original.replaced_by : values.replaced_by.trim() || null,
    qty_used: Number(values.qty_used), unit_cost: values.unit_cost,
    reason: values.reason || null,
    notes: values.notes === (original.notes ?? "") ? original.notes : values.notes.trim() || null,
  };
}
