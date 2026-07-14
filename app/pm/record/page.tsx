"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type MachineRelation = { machine_code: string; machine_name: string };

type PmPlanDetail = {
  id: string;
  machine_id: string;
  pm_name: string;
  frequency_days: number;
  checklist: string[];
  last_done_date: string | null;
  next_due_date: string | null;
  machines: MachineRelation | null;
};

// Same defensive pattern as app/pm/plans/page.tsx: without generated
// Database types, postgrest-js infers every embedded relation as an array
// regardless of actual FK cardinality, even though a to-one FK
// (pm_plans.machine_id -> machines.id) returns a plain object at runtime.
// checklist is jsonb and needs the same defensive treatment.
type RawPmPlanDetail = Omit<PmPlanDetail, "machines" | "checklist"> & {
  machines: MachineRelation | MachineRelation[] | null;
  checklist: unknown;
};

function normalizeMachineRelation(
  machines: RawPmPlanDetail["machines"]
): MachineRelation | null {
  if (!machines) return null;
  if (Array.isArray(machines)) return machines[0] ?? null;
  return machines;
}

function normalizeChecklist(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function normalizePlan(raw: RawPmPlanDetail): PmPlanDetail {
  return {
    ...raw,
    machines: normalizeMachineRelation(raw.machines),
    checklist: normalizeChecklist(raw.checklist),
  };
}

const PM_PLAN_SELECT =
  "id, machine_id, pm_name, frequency_days, checklist, last_done_date, next_due_date, machines(machine_code, machine_name)";

function formatDateThai(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

function formatFrequency(days: number): string {
  return `ทุก ${days} วัน`;
}

// Supabase serializes `numeric` columns as JSON strings to avoid float
// precision loss, so always coerce before display.
function formatMoneyThai(value: number | string): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  const safeNum = Number.isFinite(num) ? num : 0;
  return `${safeNum.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} บาท`;
}

function todayIsoDate(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const inputClassName =
  "mt-1 block w-full min-h-[44px] rounded-md border border-primary/20 px-3 py-2 text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

type LoadState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; message: string }
  | { status: "loaded"; plan: PmPlanDetail };

type ChecklistEntry = { item: string; ok: boolean; note: string };

type SubmitResult = {
  nextDueDate: string | null;
  passCount: number;
  issueCount: number;
  pmCost: number;
};

function PageHeading() {
  return <h1 className="text-2xl font-bold">บันทึกผล PM</h1>;
}

function LoadingSkeleton() {
  return (
    <div className="mt-4 max-w-lg animate-pulse space-y-4">
      <div className="h-8 w-48 rounded-md bg-primary/10" />
      <div className="h-24 rounded-lg bg-primary/10" />
      <div className="h-32 rounded-lg bg-primary/10" />
    </div>
  );
}

function PmRecordPageInner() {
  const searchParams = useSearchParams();
  const planId = searchParams.get("plan");

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [checklistState, setChecklistState] = useState<ChecklistEntry[]>([]);

  const [doneDate, setDoneDate] = useState(todayIsoDate());
  const [doneBy, setDoneBy] = useState("");
  const [pmCost, setPmCost] = useState<number | "">(0);
  const [notes, setNotes] = useState("");

  const [doneDateError, setDoneDateError] = useState<string | null>(null);
  const [doneByError, setDoneByError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [submitResult, setSubmitResult] = useState<SubmitResult | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!planId || !UUID_REGEX.test(planId)) {
        setState({ status: "not-found" });
        return;
      }

      const { data, error } = await supabase
        .from("pm_plans")
        .select(PM_PLAN_SELECT)
        .eq("id", planId)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        if (error.code === "PGRST116") {
          setState({ status: "not-found" });
        } else {
          setState({ status: "error", message: error.message });
        }
        return;
      }
      if (!data) {
        setState({ status: "not-found" });
        return;
      }

      const plan = normalizePlan(data as unknown as RawPmPlanDetail);
      setChecklistState(
        plan.checklist.map((item) => ({ item, ok: true, note: "" }))
      );
      setState({ status: "loaded", plan });
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [planId]);

  function handleToggleChecklistItem(index: number, ok: boolean) {
    setChecklistState((prev) =>
      prev.map((entry, i) => (i === index ? { ...entry, ok } : entry))
    );
  }

  function handleChecklistNoteChange(index: number, note: string) {
    setChecklistState((prev) =>
      prev.map((entry, i) => (i === index ? { ...entry, note } : entry))
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.status !== "loaded") return;

    let hasError = false;
    if (doneDate.trim() === "") {
      setDoneDateError("กรุณาระบุวันที่ทำ");
      hasError = true;
    } else {
      setDoneDateError(null);
    }

    const trimmedDoneBy = doneBy.trim();
    if (trimmedDoneBy === "") {
      setDoneByError("กรุณาระบุผู้ทำ");
      hasError = true;
    } else {
      setDoneByError(null);
    }

    const pmCostValue = pmCost === "" ? 0 : Number(pmCost);
    if (!Number.isFinite(pmCostValue) || pmCostValue < 0) {
      setFormError("ค่าใช้จ่ายในการทำ PM ต้องไม่ติดลบ");
      hasError = true;
    } else {
      setFormError(null);
    }

    if (hasError) return;

    setSubmitting(true);
    setFormError(null);

    const checklistResult = checklistState.map((entry) => ({
      item: entry.item,
      ok: entry.ok,
      note: entry.note.trim(),
    }));

    // last_done_date and next_due_date on pm_plans are owned entirely by
    // trg_pm_records_after_insert (supabase/migrations/001_init.sql): it
    // fires AFTER INSERT ON pm_records and rolls the plan's schedule
    // forward. This insert must never touch pm_plans directly -- the
    // database does that automatically.
    const { error } = await supabase.from("pm_records").insert({
      pm_plan_id: state.plan.id,
      machine_id: state.plan.machine_id,
      done_date: doneDate,
      done_by: trimmedDoneBy,
      pm_cost: pmCostValue,
      checklist_result: checklistResult,
      notes: notes.trim() === "" ? null : notes.trim(),
    });

    if (error) {
      setFormError(error.message);
      setSubmitting(false);
      return;
    }

    // Re-query the plan from the database (never compute the date in JS) --
    // this is the acceptance test that trg_pm_records_after_insert actually
    // fired. If next_due_date still comes back NULL, that means the trigger
    // did not run and an admin needs to know, not a silently wrong date.
    const { data: refreshedPlan } = await supabase
      .from("pm_plans")
      .select(PM_PLAN_SELECT)
      .eq("id", state.plan.id)
      .maybeSingle();

    const passCount = checklistState.filter((entry) => entry.ok).length;
    const issueCount = checklistState.length - passCount;

    setSubmitResult({
      nextDueDate: refreshedPlan
        ? normalizePlan(refreshedPlan as unknown as RawPmPlanDetail)
            .next_due_date
        : null,
      passCount,
      issueCount,
      pmCost: pmCostValue,
    });
    setSubmitting(false);
  }

  if (state.status === "loading") {
    return (
      <div className="p-4">
        <PageHeading />
        <LoadingSkeleton />
      </div>
    );
  }

  if (state.status === "not-found") {
    return (
      <div className="p-4">
        <PageHeading />
        <div className="mt-10 flex flex-col items-center gap-4 text-center">
          <p className="text-primary/70">ไม่พบแผน PM นี้</p>
          <Link
            href="/pm/plans"
            className="flex min-h-[44px] items-center justify-center rounded-md bg-accent px-6 text-sm font-medium text-white hover:bg-accent/90"
          >
            กลับหน้าแผน PM
          </Link>
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="p-4">
        <PageHeading />
        <div className="mt-6 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <pre className="whitespace-pre-wrap break-all font-mono text-xs">
            {state.message}
          </pre>
        </div>
      </div>
    );
  }

  const plan = state.plan;

  return (
    <div className="p-4">
      <PageHeading />

      {submitResult ? (
        <div className="mt-4 max-w-lg space-y-4">
          <div className="rounded-lg border border-green-300 bg-green-50 p-4 text-center">
            <p className="text-lg font-bold text-green-800">
              ✅ บันทึกผล PM แล้ว
            </p>
            {submitResult.nextDueDate ? (
              <p className="mt-2 text-sm text-primary">
                กำหนดครั้งถัดไป: {formatDateThai(submitResult.nextDueDate)}
              </p>
            ) : (
              <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                กำหนดครั้งถัดไปยังไม่ถูกคำนวณ — กรุณาแจ้งผู้ดูแลระบบ
              </p>
            )}
          </div>

          <div className="rounded-lg border border-primary/10 bg-white p-4">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-primary/60">จำนวนรายการที่ผ่าน</dt>
                <dd className="text-primary">
                  {submitResult.passCount} รายการ
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-primary/60">จำนวนที่พบปัญหา</dt>
                <dd className="text-primary">
                  {submitResult.issueCount} รายการ
                </dd>
              </div>
              <div className="flex justify-between gap-4 border-t border-primary/10 pt-2">
                <dt className="text-primary/60">ค่าใช้จ่ายในการทำ PM</dt>
                <dd className="font-bold text-primary">
                  {formatMoneyThai(submitResult.pmCost)}
                </dd>
              </div>
            </dl>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href="/pm"
              className="flex min-h-[44px] flex-1 items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-white hover:bg-accent/90"
            >
              กลับหน้างาน PM
            </Link>
            <Link
              href={`/machines/${plan.machine_id}`}
              className="flex min-h-[44px] flex-1 items-center justify-center rounded-md border border-primary/20 px-4 text-sm font-medium text-primary hover:bg-primary/5"
            >
              ดูประวัติเครื่องนี้
            </Link>
          </div>
        </div>
      ) : (
        <div className="mt-4 max-w-lg">
          {/* Always-visible, read-only header */}
          <div className="rounded-lg border border-primary/10 bg-white p-4 shadow-sm">
            <p className="text-lg font-bold text-primary">{plan.pm_name}</p>
            <Link
              href={`/machines/${plan.machine_id}`}
              className="mt-1 inline-block hover:underline"
            >
              <span className="text-sm font-medium text-primary">
                {plan.machines?.machine_code ?? "-"}
              </span>
              <span className="text-sm text-primary/70">
                {" "}
                — {plan.machines?.machine_name ?? "(ไม่พบข้อมูลเครื่องจักร)"}
              </span>
            </Link>

            <dl className="mt-3 space-y-1.5 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-primary/60">รอบ</dt>
                <dd className="text-right text-primary">
                  {formatFrequency(plan.frequency_days)}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-primary/60">ทำล่าสุด</dt>
                <dd className="text-right text-primary">
                  {plan.last_done_date
                    ? formatDateThai(plan.last_done_date)
                    : "-"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-primary/60">
                  กำหนดครั้งถัดไป (ปัจจุบัน)
                </dt>
                <dd className="text-right text-primary">
                  {plan.next_due_date
                    ? formatDateThai(plan.next_due_date)
                    : "รอทำครั้งแรก"}
                </dd>
              </div>
            </dl>
          </div>

          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            {/* Checklist */}
            <div>
              <h2 className="text-sm font-semibold text-primary/70">
                รายการตรวจ
              </h2>
              {plan.checklist.length === 0 ? (
                <p className="mt-2 text-sm text-primary/60">
                  แผนนี้ไม่มีรายการตรวจ
                </p>
              ) : (
                <div className="mt-2 space-y-3">
                  {checklistState.map((entry, index) => (
                    <div
                      key={index}
                      className={`rounded-lg border p-3 ${
                        entry.ok
                          ? "border-primary/10 bg-white"
                          : "border-amber-300 bg-amber-50"
                      }`}
                    >
                      <p className="break-words text-sm font-medium text-primary">
                        {entry.item}
                      </p>
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            handleToggleChecklistItem(index, true)
                          }
                          className={`flex min-h-[44px] flex-1 items-center justify-center rounded-md border px-3 text-sm font-medium ${
                            entry.ok
                              ? "border-green-300 bg-green-100 text-green-800"
                              : "border-primary/20 text-primary/60 hover:bg-primary/5"
                          }`}
                        >
                          ✓ ผ่าน
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleToggleChecklistItem(index, false)
                          }
                          className={`flex min-h-[44px] flex-1 items-center justify-center rounded-md border px-3 text-sm font-medium ${
                            !entry.ok
                              ? "border-red-300 bg-red-100 text-red-800"
                              : "border-primary/20 text-primary/60 hover:bg-primary/5"
                          }`}
                        >
                          ✗ พบปัญหา
                        </button>
                      </div>
                      <input
                        type="text"
                        value={entry.note}
                        onChange={(event) =>
                          handleChecklistNoteChange(index, event.target.value)
                        }
                        placeholder="หมายเหตุ (ถ้ามี)"
                        className={`${inputClassName} mt-2`}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label htmlFor="done_date" className="block text-sm font-medium">
                วันที่ทำ*
              </label>
              <input
                id="done_date"
                type="date"
                value={doneDate}
                onChange={(event) => setDoneDate(event.target.value)}
                className={inputClassName}
              />
              {doneDateError && (
                <p className="mt-1 text-sm text-red-700">{doneDateError}</p>
              )}
            </div>

            <div>
              <label htmlFor="done_by" className="block text-sm font-medium">
                ผู้ทำ*
              </label>
              <input
                id="done_by"
                type="text"
                value={doneBy}
                onChange={(event) => setDoneBy(event.target.value)}
                className={inputClassName}
              />
              {doneByError && (
                <p className="mt-1 text-sm text-red-700">{doneByError}</p>
              )}
            </div>

            <div>
              <label htmlFor="pm_cost" className="block text-sm font-medium">
                ค่าใช้จ่ายในการทำ PM (บาท)
              </label>
              <input
                id="pm_cost"
                type="number"
                min="0"
                step="0.01"
                value={pmCost}
                onChange={(event) =>
                  setPmCost(
                    event.target.value === "" ? "" : Number(event.target.value)
                  )
                }
                className={inputClassName}
              />
              <p className="mt-1 text-xs text-primary/50">
                ค่าวัสดุสิ้นเปลือง/ค่าแรง/ค่าจ้างภายนอกของงาน PM ครั้งนี้ —
                ถ้าเปลี่ยนอะไหล่ด้วย ให้บันทึกแยกในเมนูอะไหล่
                เพื่อไม่ให้ต้นทุนถูกนับซ้ำ
              </p>
            </div>

            <div>
              <label htmlFor="notes" className="block text-sm font-medium">
                หมายเหตุ / สิ่งผิดปกติที่พบ
              </label>
              <textarea
                id="notes"
                rows={3}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                className={inputClassName}
              />
            </div>

            {formError && (
              <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
                {formError}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="flex min-h-[48px] w-full items-center justify-center rounded-md bg-accent px-6 text-base font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
            >
              {submitting ? "กำลังบันทึก..." : "บันทึกผล PM"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

export default function PmRecordPage() {
  return (
    <Suspense
      fallback={
        <div className="p-4">
          <PageHeading />
          <LoadingSkeleton />
        </div>
      }
    >
      <PmRecordPageInner />
    </Suspense>
  );
}
