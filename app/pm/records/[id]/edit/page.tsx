"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";
import { useAccess } from "@/components/AccessContext";

type ChecklistEntry = { item: string; ok: boolean; note: string };
type PlanRelation = { pm_name: string; checklist: unknown };
type MachineRelation = { machine_code: string; machine_name: string };

type PmRecord = {
  id: string;
  pm_plan_id: string;
  machine_id: string;
  done_date: string;
  done_by: string | null;
  checklist_result: ChecklistEntry[];
  pm_cost: number | string;
  notes: string | null;
  pm_plans: PlanRelation | null;
  machines: MachineRelation | null;
};

type RawPmRecord = Omit<PmRecord, "checklist_result" | "pm_plans" | "machines"> & {
  checklist_result: unknown;
  pm_plans: PlanRelation | PlanRelation[] | null;
  machines: MachineRelation | MachineRelation[] | null;
};

type LoadState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; message: string }
  | { status: "loaded"; record: PmRecord };

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECORD_SELECT =
  "id, pm_plan_id, machine_id, done_date, done_by, checklist_result, pm_cost, notes, pm_plans(pm_name, checklist), machines(machine_code, machine_name)";
const inputClassName =
  "mt-1 block min-h-[44px] w-full rounded-md border border-primary/20 px-3 py-2 text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

function normalizeRelation<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function normalizeChecklistResult(value: unknown): ChecklistEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (entry): entry is Record<string, unknown> =>
        typeof entry === "object" && entry !== null
    )
    .map((entry) => ({
      item: typeof entry.item === "string" ? entry.item : "",
      ok: entry.ok === true,
      note: typeof entry.note === "string" ? entry.note : "",
    }));
}

function normalizeRecord(raw: RawPmRecord): PmRecord {
  return {
    ...raw,
    checklist_result: normalizeChecklistResult(raw.checklist_result),
    pm_plans: normalizeRelation(raw.pm_plans),
    machines: normalizeRelation(raw.machines),
  };
}

export default function EditPmRecordPage() {
  const access = useAccess();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [doneDate, setDoneDate] = useState("");
  const [doneBy, setDoneBy] = useState("");
  const [pmCost, setPmCost] = useState("0");
  const [notes, setNotes] = useState("");
  const [checklist, setChecklist] = useState<ChecklistEntry[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!UUID_REGEX.test(params.id)) {
        setState({ status: "not-found" });
        return;
      }

      const { data, error } = await supabase
        .from("pm_records")
        .select(RECORD_SELECT)
        .eq("id", params.id)
        .maybeSingle();

      if (cancelled) return;
      if (error) {
        setState({ status: "error", message: error.message });
        return;
      }
      if (!data) {
        setState({ status: "not-found" });
        return;
      }

      const record = normalizeRecord(data as unknown as RawPmRecord);
      setDoneDate(record.done_date);
      setDoneBy(record.done_by ?? "");
      setPmCost(String(record.pm_cost ?? 0));
      setNotes(record.notes ?? "");
      // The saved result is historical truth. Never replace it with the
      // plan's potentially edited current checklist.
      setChecklist(record.checklist_result);
      setState({ status: "loaded", record });
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  function updateChecklist(index: number, patch: Partial<ChecklistEntry>) {
    setChecklist((previous) =>
      previous.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, ...patch } : entry
      )
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.status !== "loaded" || submitting) return;

    const trimmedDoneBy = doneBy.trim();
    const parsedCost = pmCost.trim() === "" ? 0 : Number(pmCost);
    if (!doneDate) {
      setFormError("กรุณาระบุวันที่ทำ PM");
      return;
    }
    if (!trimmedDoneBy) {
      setFormError("กรุณาระบุผู้ทำ");
      return;
    }
    if (!Number.isFinite(parsedCost) || parsedCost < 0) {
      setFormError("ค่าใช้จ่าย PM ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป");
      return;
    }

    setSubmitting(true);
    setFormError(null);
    const { error } = await supabase
      .from("pm_records")
      .update({
        done_date: doneDate,
        done_by: trimmedDoneBy,
        checklist_result: checklist.map((entry) => ({
          ...entry,
          note: entry.note.trim(),
        })),
        pm_cost: parsedCost,
        notes: notes.trim() || null,
      })
      .eq("id", state.record.id);

    if (error) {
      setFormError(error.message);
      setSubmitting(false);
      return;
    }

    router.push(`/machines/${state.record.machine_id}?tab=pm&updated=1`);
  }

  if (state.status === "loading") {
    return <div className="p-4 text-primary/60">กำลังโหลด...</div>;
  }

  if (state.status === "not-found") {
    return (
      <div className="p-4 text-center">
        <h1 className="text-2xl font-bold">แก้ไขประวัติ PM</h1>
        <p className="mt-8 text-primary/70">ไม่พบประวัติ PM นี้</p>
        <Link href="/pm" className="mt-4 inline-flex min-h-[44px] items-center rounded-md bg-accent px-6 text-sm font-medium text-white">
          กลับหน้างาน PM
        </Link>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="p-4">
        <h1 className="text-2xl font-bold">แก้ไขประวัติ PM</h1>
        <div className="mt-6 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          {state.message}
        </div>
      </div>
    );
  }

  const record = state.record;
  if (access.role !== "admin") {
    return (
      <div className="p-4">
        <h1 className="text-2xl font-bold">แก้ไขประวัติ PM</h1>
        <p className="mt-6 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          เฉพาะผู้ดูแลระบบเท่านั้นที่แก้ไขประวัติ PM ได้
        </p>
      </div>
    );
  }

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold">แก้ไขประวัติ PM</h1>
      <div className="mt-4 max-w-lg rounded-lg border border-primary/10 bg-white p-4 shadow-sm">
        <p className="break-words text-lg font-bold text-primary">
          {record.pm_plans?.pm_name ?? "-"}
        </p>
        <p className="mt-1 break-words text-sm text-primary/70">
          {record.machines?.machine_code ?? "-"} — {record.machines?.machine_name ?? "(ไม่พบข้อมูลเครื่องจักร)"}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="mt-4 max-w-lg space-y-4">
        <div>
          <label htmlFor="edit_pm_done_date" className="block text-sm font-medium">วันที่ทำ PM*</label>
          <input id="edit_pm_done_date" type="date" value={doneDate} onChange={(event) => setDoneDate(event.target.value)} className={inputClassName} />
        </div>
        <div>
          <label htmlFor="edit_pm_done_by" className="block text-sm font-medium">ผู้ทำ*</label>
          <input id="edit_pm_done_by" type="text" value={doneBy} onChange={(event) => setDoneBy(event.target.value)} className={inputClassName} />
        </div>

        <div>
          <h2 className="text-sm font-semibold text-primary/70">รายการตรวจ</h2>
          {checklist.length === 0 ? (
            <p className="mt-2 text-sm text-primary/60">ประวัตินี้ไม่มีผลรายการตรวจ</p>
          ) : (
            <div className="mt-2 space-y-3">
              {checklist.map((entry, index) => (
                <div key={`${entry.item}-${index}`} className={`rounded-lg border p-3 ${entry.ok ? "border-primary/10 bg-white" : "border-amber-300 bg-amber-50"}`}>
                  <p className="break-words text-sm font-medium text-primary">{entry.item}</p>
                  <div className="mt-2 flex gap-2">
                    <button type="button" onClick={() => updateChecklist(index, { ok: true })} className={`flex min-h-[44px] flex-1 items-center justify-center rounded-md border px-2 text-sm font-medium ${entry.ok ? "border-green-300 bg-green-100 text-green-800" : "border-primary/20 text-primary/60"}`}>✓ ปกติ</button>
                    <button type="button" onClick={() => updateChecklist(index, { ok: false })} className={`flex min-h-[44px] flex-1 items-center justify-center rounded-md border px-2 text-sm font-medium ${!entry.ok ? "border-red-300 bg-red-100 text-red-800" : "border-primary/20 text-primary/60"}`}>✗ พบปัญหา</button>
                  </div>
                  <input type="text" value={entry.note} onChange={(event) => updateChecklist(index, { note: event.target.value })} placeholder="หมายเหตุ (ถ้ามี)" className={`${inputClassName} mt-2`} />
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <label htmlFor="edit_pm_cost" className="block text-sm font-medium">ค่าใช้จ่าย PM (บาท)</label>
          <input id="edit_pm_cost" type="number" min={0} step="0.01" value={pmCost} onChange={(event) => setPmCost(event.target.value)} className={inputClassName} />
        </div>
        <div>
          <label htmlFor="edit_pm_notes" className="block text-sm font-medium">หมายเหตุ</label>
          <textarea id="edit_pm_notes" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} className={inputClassName} />
        </div>

        {formError && <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">{formError}</div>}
        <div className="flex flex-col gap-3 sm:flex-row">
          <button type="submit" disabled={submitting} className="flex min-h-[44px] flex-1 items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-white disabled:opacity-70">
            {submitting ? "กำลังบันทึก..." : "บันทึก"}
          </button>
          <Link href={`/machines/${record.machine_id}?tab=pm`} className="flex min-h-[44px] flex-1 items-center justify-center rounded-md border border-primary/20 px-4 text-sm font-medium text-primary">
            ยกเลิก
          </Link>
        </div>
      </form>
    </div>
  );
}
