"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { DUE_SOON_DAYS } from "@/lib/machineStatus";
import PmPlanForm, {
  type PmPlanMachineOption,
  type PmPlanRecord,
} from "@/components/pm/PmPlanForm";

type MachineRelation = { machine_code: string; machine_name: string };

type PmPlanRow = {
  id: string;
  machine_id: string;
  pm_name: string;
  frequency_days: number;
  checklist: string[];
  last_done_date: string | null;
  next_due_date: string | null;
  is_active: boolean;
  machines: MachineRelation | null;
};

// Without generated Database types, postgrest-js infers every embedded
// relation as an array regardless of actual FK cardinality, even though a
// to-one FK (pm_plans.machine_id -> machines.id) returns a plain object at
// runtime. Handle both shapes so a broken/missing join never crashes the
// page. checklist is jsonb and needs the same defensive treatment.
type RawPmPlanRow = Omit<PmPlanRow, "machines" | "checklist"> & {
  machines: MachineRelation | MachineRelation[] | null;
  checklist: unknown;
};

function normalizeMachineRelation(
  machines: RawPmPlanRow["machines"]
): MachineRelation | null {
  if (!machines) return null;
  if (Array.isArray(machines)) return machines[0] ?? null;
  return machines;
}

function normalizeChecklist(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

const PM_PLAN_SELECT =
  "id, machine_id, pm_name, frequency_days, checklist, last_done_date, next_due_date, is_active, machines(machine_code, machine_name)";

// Parses a "YYYY-MM-DD" date string as a local-time calendar day, matching
// lib/machineStatus.ts -- new Date("YYYY-MM-DD") parses as UTC midnight,
// which can shift to the wrong day once converted to local time.
function parseIsoDateAsLocalDay(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toLocalDayStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// Sort buckets: 0 = overdue, 1 = never done (next_due_date is null), 2 = upcoming.
function dueBucket(nextDueDate: string | null, today: Date): number {
  if (!nextDueDate) return 1;
  return parseIsoDateAsLocalDay(nextDueDate) < today ? 0 : 2;
}

// Overdue plans first (soonest/most-overdue next_due_date first), then
// never-done plans, then the rest (soonest upcoming first). Inactive plans
// always sort after active ones, regardless of due date.
function sortPlans(rows: PmPlanRow[]): PmPlanRow[] {
  const today = toLocalDayStart(new Date());
  return [...rows].sort((a, b) => {
    if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
    const bucketDiff =
      dueBucket(a.next_due_date, today) - dueBucket(b.next_due_date, today);
    if (bucketDiff !== 0) return bucketDiff;
    if (a.next_due_date && b.next_due_date) {
      return a.next_due_date < b.next_due_date
        ? -1
        : a.next_due_date > b.next_due_date
          ? 1
          : 0;
    }
    return 0;
  });
}

function formatDateThai(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

function formatLastDone(lastDoneDate: string | null): string {
  return lastDoneDate ? formatDateThai(lastDoneDate) : "ยังไม่เคยทำ";
}

function formatFrequency(days: number): string {
  return `ทุก ${days} วัน`;
}

type DueDisplay = { label: string; className: string };

function computeDueDisplay(nextDueDate: string | null): DueDisplay {
  if (!nextDueDate) {
    return {
      label: "รอทำครั้งแรก",
      className: "bg-gray-100 text-gray-700 border border-gray-200",
    };
  }

  const today = toLocalDayStart(new Date());
  const due = parseIsoDateAsLocalDay(nextDueDate);
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86400000);

  if (diffDays < 0) {
    return {
      label: `เลยกำหนด ${Math.abs(diffDays)} วัน`,
      className: "bg-red-100 text-red-800 border border-red-200",
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

function DueBadge({ nextDueDate }: { nextDueDate: string | null }) {
  const display = computeDueDisplay(nextDueDate);
  return (
    <span
      className={`inline-flex w-fit items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${display.className}`}
    >
      {display.label}
    </span>
  );
}

function ActivePlanBadge({ isActive }: { isActive: boolean }) {
  return (
    <span
      className={`inline-flex w-fit items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${
        isActive
          ? "bg-green-100 text-green-800 border border-green-200"
          : "bg-gray-100 text-gray-700 border border-gray-200"
      }`}
    >
      {isActive ? "เปิดใช้งาน" : "ปิดใช้งาน"}
    </span>
  );
}

type MachineOption = PmPlanMachineOption;

type FetchResult =
  | { ok: true; plans: PmPlanRow[]; machines: MachineOption[] }
  | { ok: false; message: string };

async function fetchPmPlansData(): Promise<FetchResult> {
  const [plansRes, machinesRes] = await Promise.all([
    supabase.from("pm_plans").select(PM_PLAN_SELECT),
    supabase
      .from("machines")
      .select("id, machine_code, machine_name, status")
      .order("machine_code", { ascending: true }),
  ]);

  const firstError = plansRes.error ?? machinesRes.error;
  if (firstError) {
    return { ok: false, message: firstError.message };
  }

  const plans = sortPlans(
    ((plansRes.data ?? []) as RawPmPlanRow[]).map((row) => ({
      ...row,
      machines: normalizeMachineRelation(row.machines),
      checklist: normalizeChecklist(row.checklist),
    }))
  );

  return {
    ok: true,
    plans,
    machines: (machinesRes.data ?? []) as MachineOption[],
  };
}

function LoadingSkeleton() {
  return (
    <div className="mt-6 animate-pulse space-y-3">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="h-16 rounded-lg bg-primary/10" />
      ))}
    </div>
  );
}

export default function PmPlansPage() {
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [plans, setPlans] = useState<PmPlanRow[]>([]);
  const [machines, setMachines] = useState<MachineOption[]>([]);

  const [machineFilterId, setMachineFilterId] = useState("");
  const [activeOnly, setActiveOnly] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [editingPlan, setEditingPlan] = useState<PmPlanRow | null>(null);

  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const result = await fetchPmPlansData();
      if (cancelled) return;

      if (result.ok) {
        setPlans(result.plans);
        setMachines(result.machines);
        setError(null);
      } else {
        setError(result.message);
      }
      setInitialLoading(false);
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!successMessage) return;
    const timer = setTimeout(() => setSuccessMessage(null), 3000);
    return () => clearTimeout(timer);
  }, [successMessage]);

  async function refresh() {
    const result = await fetchPmPlansData();
    if (result.ok) {
      setPlans(result.plans);
      setMachines(result.machines);
      setError(null);
    } else {
      setError(result.message);
    }
  }

  function handleAddClick() {
    setEditingPlan(null);
    setShowForm(true);
  }

  function handleEditClick(plan: PmPlanRow) {
    setEditingPlan(plan);
    setShowForm(true);
  }

  function handleFormCancel() {
    setShowForm(false);
    setEditingPlan(null);
  }

  async function handleFormSuccess() {
    const wasEditing = editingPlan !== null;
    setShowForm(false);
    setEditingPlan(null);
    await refresh();
    setSuccessMessage(
      wasEditing ? "บันทึกการแก้ไขแผน PM แล้ว" : "เพิ่มแผน PM แล้ว"
    );
  }

  async function handleToggleActive(plan: PmPlanRow) {
    if (plan.is_active) {
      const confirmed = window.confirm(
        "ปิดใช้งานแผนนี้? จะไม่แสดงบนบอร์ดสถานะและรายการงานถึงกำหนด"
      );
      if (!confirmed) return;
    }

    setActionError(null);
    setTogglingId(plan.id);

    const { error: toggleError } = await supabase
      .from("pm_plans")
      .update({ is_active: !plan.is_active })
      .eq("id", plan.id);

    setTogglingId(null);

    if (toggleError) {
      setActionError(toggleError.message);
      return;
    }

    setPlans((prev) =>
      sortPlans(
        prev.map((row) =>
          row.id === plan.id ? { ...row, is_active: !row.is_active } : row
        )
      )
    );
  }

  const filteredPlans = useMemo(() => {
    return plans.filter((plan) => {
      if (machineFilterId && plan.machine_id !== machineFilterId) return false;
      if (activeOnly && !plan.is_active) return false;
      return true;
    });
  }, [plans, machineFilterId, activeOnly]);

  const editingPlanRecord: PmPlanRecord | undefined = editingPlan ?? undefined;

  return (
    <div className="p-4">
      {successMessage && (
        <div className="fixed inset-x-4 top-16 z-[60] mx-auto max-w-sm rounded-md bg-green-600 px-4 py-3 text-center text-sm text-white shadow-lg md:left-1/2 md:right-auto md:top-4 md:-translate-x-1/2">
          {successMessage}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">แผน PM</h1>
        <button
          type="button"
          onClick={handleAddClick}
          className="flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-md bg-accent px-4 text-sm font-medium text-white hover:bg-accent/90"
        >
          + เพิ่มแผน PM
        </button>
      </div>

      {initialLoading ? (
        <LoadingSkeleton />
      ) : error ? (
        <div className="mt-6 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <pre className="whitespace-pre-wrap break-all font-mono text-xs">
            {error}
          </pre>
        </div>
      ) : plans.length === 0 ? (
        <div className="mt-10 flex flex-col items-center gap-4 text-center">
          <p className="text-primary/70">ยังไม่มีแผน PM</p>
          <button
            type="button"
            onClick={handleAddClick}
            className="flex min-h-[44px] items-center justify-center rounded-md bg-accent px-6 text-sm font-medium text-white hover:bg-accent/90"
          >
            + เพิ่มแผน PM
          </button>
        </div>
      ) : (
        <>
          {/* Filters */}
          <div className="mt-4 flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
            <div>
              <label className="block text-xs font-medium text-primary/60">
                เครื่องจักร
              </label>
              <select
                value={machineFilterId}
                onChange={(event) => setMachineFilterId(event.target.value)}
                className="mt-1 min-h-[44px] w-full rounded-md border border-primary/20 px-3 py-2 text-sm text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent md:w-auto"
              >
                <option value="">ทุกเครื่อง</option>
                {machines.map((machine) => (
                  <option key={machine.id} value={machine.id}>
                    {machine.machine_code} — {machine.machine_name}
                  </option>
                ))}
              </select>
            </div>

            <label className="flex min-h-[44px] items-center gap-2 text-sm text-primary">
              <input
                type="checkbox"
                checked={activeOnly}
                onChange={(event) => setActiveOnly(event.target.checked)}
                className="h-4 w-4 rounded border-primary/30 text-accent focus:ring-accent"
              />
              แสดงเฉพาะแผนที่เปิดใช้งาน
            </label>
          </div>

          {actionError && (
            <div className="mt-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
              {actionError}
            </div>
          )}

          {/* Content */}
          {filteredPlans.length === 0 ? (
            <p className="mt-10 text-center text-primary/70">
              ไม่พบแผน PM ตามเงื่อนไขที่เลือก
            </p>
          ) : (
            <>
              {/* Desktop table */}
              <div className="mt-6 hidden overflow-x-auto md:block">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-primary/10 text-left text-primary/60">
                      <th className="py-2 pr-4 font-medium">เครื่องจักร</th>
                      <th className="py-2 pr-4 font-medium">ชื่องาน PM</th>
                      <th className="py-2 pr-4 font-medium">รอบ</th>
                      <th className="py-2 pr-4 font-medium">ทำล่าสุด</th>
                      <th className="py-2 pr-4 font-medium">
                        กำหนดครั้งถัดไป
                      </th>
                      <th className="py-2 pr-4 font-medium">สถานะแผน</th>
                      <th className="py-2 pr-4 font-medium">จัดการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPlans.map((plan) => {
                      const machineCode = plan.machines?.machine_code ?? "-";
                      const machineName =
                        plan.machines?.machine_name ??
                        "(ไม่พบข้อมูลเครื่องจักร)";
                      const isToggling = togglingId === plan.id;
                      return (
                        <tr
                          key={plan.id}
                          className={`border-b border-primary/5 ${
                            plan.is_active ? "" : "opacity-60"
                          }`}
                        >
                          <td className="py-3 pr-4">
                            <span className="break-words font-bold text-primary">
                              {machineCode}
                            </span>
                            <span className="block break-words text-xs text-primary/60">
                              {machineName}
                            </span>
                          </td>
                          <td className="max-w-xs break-words py-3 pr-4 text-primary/80">
                            {plan.pm_name}
                          </td>
                          <td className="whitespace-nowrap py-3 pr-4 text-primary/70">
                            {formatFrequency(plan.frequency_days)}
                          </td>
                          <td className="whitespace-nowrap py-3 pr-4 text-primary/70">
                            {formatLastDone(plan.last_done_date)}
                          </td>
                          <td className="py-3 pr-4">
                            <DueBadge nextDueDate={plan.next_due_date} />
                          </td>
                          <td className="py-3 pr-4">
                            <ActivePlanBadge isActive={plan.is_active} />
                          </td>
                          <td className="py-3 pr-4">
                            <div className="flex flex-wrap gap-2">
                              {plan.is_active && (
                                <Link
                                  href={`/pm/record?plan=${plan.id}`}
                                  className="flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent/90"
                                >
                                  ทำ PM
                                </Link>
                              )}
                              <button
                                type="button"
                                onClick={() => handleEditClick(plan)}
                                className="flex min-h-[44px] items-center justify-center rounded-md border border-primary/20 px-3 text-xs font-medium text-primary hover:bg-primary/5"
                              >
                                แก้ไข
                              </button>
                              <button
                                type="button"
                                onClick={() => handleToggleActive(plan)}
                                disabled={isToggling}
                                className={`flex min-h-[44px] items-center justify-center rounded-md border px-3 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-70 ${
                                  plan.is_active
                                    ? "border-red-300 text-red-700 hover:bg-red-50"
                                    : "border-green-300 text-green-700 hover:bg-green-50"
                                }`}
                              >
                                {isToggling
                                  ? "กำลังบันทึก..."
                                  : plan.is_active
                                    ? "ปิดใช้งาน"
                                    : "เปิดใช้งาน"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="mt-6 space-y-3 md:hidden">
                {filteredPlans.map((plan) => {
                  const machineCode = plan.machines?.machine_code ?? "-";
                  const machineName =
                    plan.machines?.machine_name ?? "(ไม่พบข้อมูลเครื่องจักร)";
                  const isToggling = togglingId === plan.id;
                  return (
                    <div
                      key={plan.id}
                      className={`rounded-lg border border-primary/10 bg-white p-4 shadow-sm ${
                        plan.is_active ? "" : "opacity-60"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="break-words text-base font-bold text-primary">
                            {machineCode}
                          </p>
                          <p className="break-words text-sm text-primary/70">
                            {machineName}
                          </p>
                        </div>
                        <ActivePlanBadge isActive={plan.is_active} />
                      </div>

                      <p className="mt-2 break-words text-sm font-medium text-primary">
                        {plan.pm_name}
                      </p>
                      <p className="mt-1 text-xs text-primary/60">
                        {formatFrequency(plan.frequency_days)}
                      </p>

                      <p className="mt-3 text-xs text-primary/60">
                        ทำล่าสุด: {formatLastDone(plan.last_done_date)}
                      </p>
                      <div className="mt-2">
                        <DueBadge nextDueDate={plan.next_due_date} />
                      </div>

                      <div className="mt-3 space-y-2">
                        {plan.is_active && (
                          <Link
                            href={`/pm/record?plan=${plan.id}`}
                            className="flex min-h-[44px] items-center justify-center rounded-md bg-accent px-3 text-sm font-medium text-white hover:bg-accent/90"
                          >
                            ทำ PM
                          </Link>
                        )}
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => handleEditClick(plan)}
                            className="flex min-h-[44px] flex-1 items-center justify-center rounded-md border border-primary/20 px-3 text-xs font-medium text-primary hover:bg-primary/5"
                          >
                            แก้ไข
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleActive(plan)}
                            disabled={isToggling}
                            className={`flex min-h-[44px] flex-1 items-center justify-center rounded-md border px-3 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-70 ${
                              plan.is_active
                                ? "border-red-300 text-red-700 hover:bg-red-50"
                                : "border-green-300 text-green-700 hover:bg-green-50"
                            }`}
                          >
                            {isToggling
                              ? "กำลังบันทึก..."
                              : plan.is_active
                                ? "ปิดใช้งาน"
                                : "เปิดใช้งาน"}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}

      {/* Add/edit modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-lg">
            <h2 className="text-lg font-bold text-primary">
              {editingPlan ? "แก้ไขแผน PM" : "เพิ่มแผน PM"}
            </h2>
            <div className="mt-4">
              <PmPlanForm
                plan={editingPlanRecord}
                machineOptions={machines}
                onSuccess={handleFormSuccess}
                onCancel={handleFormCancel}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
