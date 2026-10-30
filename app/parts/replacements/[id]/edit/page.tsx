"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAccess } from "@/components/AccessContext";
import { supabase } from "@/lib/supabase";
import { localCalendarDate } from "@/lib/partsReplacementTimeline";
import { replacementEditValues, replacementEditPayload, validateReplacementEdit, type ReplacementEditValues, type ReplacementSavedValues } from "@/lib/partReplacementEdit";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Machine = { machine_code: string; machine_name: string };
type Part = { part_code: string; part_name: string };
type RecordRow = ReplacementSavedValues & {
  id: string; machine_id: string; part_id: string; breakdown_id: string | null; stock_deducted: boolean;
  machines: Machine | Machine[] | null; spare_parts: Part | Part[] | null;
};
const SELECT = "id, machine_id, part_id, breakdown_id, stock_deducted, replaced_at, replaced_by, qty_used, unit_cost, total_cost, reason, notes, machines(machine_code, machine_name), spare_parts(part_code, part_name)";
const inputClass = "mt-1 block min-h-[44px] w-full min-w-0 rounded-md border border-primary/20 px-3 py-2 focus:border-accent focus:outline-accent";
function one<T>(value: T | T[] | null): T | null { return Array.isArray(value) ? value[0] ?? null : value; }

export default function ReplacementHistoryEditPage() {
  const access = useAccess();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [record, setRecord] = useState<RecordRow | null>(null);
  const [values, setValues] = useState<ReplacementEditValues | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [reload, setReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [errors, setErrors] = useState<ReturnType<typeof validateReplacementEdit>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (access.role !== "admin") return;
    setLoading(true); setReady(false); setLoadError(null); setSaveError(null); setConflict(false);
    async function load() {
      if (!UUID.test(params.id)) { setLoadError("ไม่พบประวัติการเปลี่ยนอะไหล่นี้"); setLoading(false); return; }
      try {
        const [result, readiness] = await Promise.all([
          supabase.from("part_replacements").select(SELECT).eq("id", params.id).maybeSingle(),
          supabase.rpc("part_replacement_history_edit_ready"),
        ]);
        if (cancelled) return;
        if (result.error) setLoadError("ไม่สามารถโหลดประวัติการเปลี่ยนอะไหล่ได้ กรุณาลองใหม่");
        else if (!result.data) setLoadError("ไม่พบประวัติการเปลี่ยนอะไหล่นี้");
        else {
          const row = result.data as unknown as RecordRow;
          setRecord(row); setValues(replacementEditValues(row)); setErrors({});
          setReady(!readiness.error && readiness.data === true);
        }
      } catch { if (!cancelled) setLoadError("ไม่สามารถโหลดประวัติการเปลี่ยนอะไหล่ได้ กรุณาลองใหม่"); }
      if (!cancelled) setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [access.role, params.id, reload]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current || !record || !values || !ready || conflict || access.role !== "admin") return;
    const validation = validateReplacementEdit(values);
    setErrors(validation); setSaveError(null);
    if (Object.keys(validation).length) return;
    savingRef.current = true; setSaving(true);
    try {
      // Missing/disabled migration must never fall through to an unsafe UPDATE.
      const check = await supabase.rpc("part_replacement_history_edit_ready");
      if (check.error || check.data !== true) { setReady(false); return; }
      let query = supabase.from("part_replacements").update(replacementEditPayload(values, record))
        .eq("id", record.id).eq("machine_id", record.machine_id).eq("part_id", record.part_id);
      // Optimistic concurrency: a stale form cannot overwrite another correction.
      for (const field of ["replaced_at", "replaced_by", "qty_used", "unit_cost", "reason", "notes"] as const) {
        query = record[field] === null ? query.is(field, null) : query.eq(field, record[field]);
      }
      const { data, error } = await query.select("id").maybeSingle();
      if (error) setSaveError("ไม่สามารถบันทึกการแก้ไขได้ กรุณาลองใหม่ หากยังไม่สำเร็จให้ติดต่อผู้ดูแลระบบ");
      else if (!data) { setConflict(true); setSaveError("ข้อมูลหรือสิทธิ์ถูกเปลี่ยนระหว่างแก้ไข กรุณาโหลดข้อมูลล่าสุดก่อนแก้ไขอีกครั้ง"); }
      else {
        router.push(`/machines/${record.machine_id}?tab=parts&replacement_updated=1&part=${record.part_id}`);
        router.refresh();
      }
    } catch { setSaveError("ไม่สามารถบันทึกการแก้ไขได้ กรุณาลองใหม่"); }
    finally { savingRef.current = false; setSaving(false); }
  }

  if (access.role !== "admin") return <div className="p-4"><h1 className="text-xl font-bold">ไม่มีสิทธิ์ดำเนินการ</h1><p className="mt-2">การแก้ไขประวัติรายการนี้สำหรับผู้ดูแลระบบเท่านั้น</p></div>;
  if (loading) return <p role="status" className="p-4">กำลังโหลดประวัติการเปลี่ยนอะไหล่...</p>;
  if (loadError || !record || !values) return <div role="alert" className="p-4"><p>{loadError ?? "ไม่พบประวัติการเปลี่ยนอะไหล่นี้"}</p><button type="button" onClick={() => setReload((n) => n + 1)} className="mt-3 min-h-[44px] rounded-md border px-4">ลองใหม่</button></div>;
  const machine = one(record.machines); const part = one(record.spare_parts);
  const back = `/machines/${record.machine_id}?tab=parts&part=${record.part_id}`;
  const total = Number(values.qty_used) * Number(values.unit_cost);
  function change(field: keyof ReplacementEditValues, value: string) {
    setValues((previous) => previous ? { ...previous, [field]: value } : previous);
    setErrors((previous) => ({ ...previous, [field]: undefined }));
  }
  const errorText = (field: keyof ReplacementEditValues) => errors[field] && <p role="alert" className="mt-1 text-sm text-red-700">{errors[field]}</p>;
  return <div className="mx-auto max-w-xl p-4">
    <h1 className="text-xl font-bold">แก้ไขประวัติการเปลี่ยนอะไหล่</h1>
    <div className="mt-4 space-y-2 rounded-lg border border-primary/10 bg-white p-4 text-sm">
      <p className="break-words">เครื่องจักร: {machine?.machine_code ?? "-"} — {machine?.machine_name ?? "-"}</p>
      <p className="break-words">อะไหล่: {part?.part_code ?? "-"} — {part?.part_name ?? "-"}</p>
      {record.breakdown_id && <Link className="block min-h-[44px] py-3 text-accent" href={`/breakdowns/${record.breakdown_id}`}>ดูใบแจ้งเสียที่เกี่ยวข้อง</Link>}
      <p className="text-primary/60">{record.stock_deducted ? "รายการนี้เคยตัดสต๊อก การแก้จำนวนจะปรับสต๊อกตามส่วนต่าง" : "รายการนี้ไม่ได้ตัดสต๊อก การแก้จำนวนจะไม่ปรับสต๊อก"}</p>
    </div>
    {!ready && <div role="alert" className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">ระบบยังไม่พร้อมสำหรับการแก้ไขประวัติ กรุณาติดต่อผู้ดูแลระบบ<button type="button" onClick={() => setReload((n) => n + 1)} className="mt-2 block min-h-[44px] rounded-md border px-3">ตรวจสอบอีกครั้ง</button></div>}
    <form onSubmit={save} noValidate className="mt-4 space-y-4 rounded-lg border border-primary/10 bg-white p-4">
      <div><label htmlFor="replacement_date" className="text-sm font-medium">วันที่เปลี่ยนอะไหล่</label><input disabled={saving} id="replacement_date" type="date" required max={localCalendarDate(new Date())} value={values.replaced_at} onChange={(e) => change("replaced_at", e.target.value)} className={inputClass} />{errorText("replaced_at")}</div>
      <div><label htmlFor="replacement_person" className="text-sm font-medium">ผู้เปลี่ยน</label><input disabled={saving} id="replacement_person" type="text" value={values.replaced_by} onChange={(e) => change("replaced_by", e.target.value)} className={inputClass} /></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label htmlFor="replacement_qty" className="text-sm font-medium">จำนวนที่ใช้</label><input disabled={saving} id="replacement_qty" type="number" min="1" step="1" required value={values.qty_used} onChange={(e) => change("qty_used", e.target.value)} className={inputClass} />{errorText("qty_used")}</div>
        <div><label htmlFor="replacement_cost" className="text-sm font-medium">ราคาต่อหน่วย (บาท)</label><input disabled={saving} id="replacement_cost" type="number" min="0" step="0.01" required value={values.unit_cost} onChange={(e) => change("unit_cost", e.target.value)} className={inputClass} />{errorText("unit_cost")}</div>
      </div>
      <div><label htmlFor="replacement_reason" className="text-sm font-medium">สาเหตุการเปลี่ยน</label><select disabled={saving} id="replacement_reason" value={values.reason} onChange={(e) => change("reason", e.target.value)} className={inputClass}><option value="">ไม่ระบุ</option><option value="planned">ตามรอบ</option><option value="breakdown">เครื่องเสีย</option></select>{errorText("reason")}</div>
      <div><label htmlFor="replacement_notes" className="text-sm font-medium">หมายเหตุ</label><textarea disabled={saving} id="replacement_notes" rows={3} value={values.notes} onChange={(e) => change("notes", e.target.value)} className={inputClass} /></div>
      <p className="text-sm font-semibold">ราคารวม: <output>{(Number.isFinite(total) && total >= 0 ? total : 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท</output></p>
      <p className="text-xs text-primary/60">ราคารวมที่บันทึกจะคำนวณโดยระบบจากจำนวนและราคาต่อหน่วย</p>
      {saveError && <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{saveError}</div>}
      {conflict && <button type="button" onClick={() => setReload((n) => n + 1)} className="min-h-[44px] rounded-md border px-3 text-sm">โหลดข้อมูลล่าสุด</button>}
      <div className="grid grid-cols-2 gap-3">
        <button type="submit" disabled={saving || !ready || conflict} className="min-h-[48px] rounded-md bg-accent px-3 text-sm font-medium text-white disabled:opacity-50">{saving ? "กำลังบันทึก..." : "บันทึกการแก้ไข"}</button>
        <button type="button" onClick={() => router.push(back)} disabled={saving} className="min-h-[48px] rounded-md border border-primary/20 px-3 text-sm font-medium disabled:opacity-50">ยกเลิก</button>
      </div>
    </form>
  </div>;
}
